import { resolve } from "node:path";
import type { CliContext } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
import { firstLine, git, ok, runTool, trimEnd } from "./exec.ts";
import type { ToolResult } from "./exec.ts";
import { gate } from "./gate.ts";
import type { Gate } from "./gate.ts";
import { openPrs, prAuthorOf, repoArg } from "./hosting.ts";
import type { OpenPr } from "./hosting.ts";
import { decide, maxPrFilesOf } from "./policy.ts";
import { readCheckout } from "./start.ts";

export interface PrOptions {
  title: string;
  bodyFile: string;
  profile: string | undefined;
  plan: string | undefined;
  base: string | undefined;
  ready: boolean;
  yes: boolean;
}

interface Body {
  args: string[];
  input: string | undefined;
}

async function readBody(ctx: CliContext, file: string): Promise<Body> {
  if (file === "-") return { args: ["--body-file", "-"], input: await ctx.readStdin() };
  const path = resolve(ctx.cwd, file);
  if ((await readFileIfExists(path)) === undefined) throw new OmtError("file_not_found", `--body-file: file not found: ${file}`);
  return { args: ["--body-file", path], input: undefined };
}

function rejected(result: ToolResult): string | undefined {
  const text = `${result.stderr}\n${result.stdout}`;
  if (!/\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first|stale info/i.test(text)) return undefined;
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => /rejected/i.test(line)) ?? firstLine(result);
}

// Pushes, and returns an `ask:` line when the remote rejects the push. Other failures throw.
function push(ctx: CliContext, args: string[]): string | undefined {
  const result = runTool(ctx, "git", ["push", ...args]);
  if (ok(result)) return undefined;
  const reason = rejected(result);
  if (reason !== undefined) return `ask: the push was rejected: ${reason}; a force push needs the owner's yes\n`;
  throw new OmtError("git_failed", `git push failed: ${firstLine(result)}`);
}

function createPr(ctx: CliContext, args: string[], input: string | undefined): string {
  const result = runTool(ctx, "gh", ["pr", "create", ...args], input === undefined ? {} : { input });
  if (!ok(result)) throw new OmtError("gh_failed", `gh pr create failed: ${firstLine(result)}`);
  const url = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "").at(-1);
  if (url === undefined) throw new OmtError("gh_failed", "gh pr create printed no URL");
  return url;
}

interface Ready {
  gate: Gate;
  remote: NonNullable<Gate["remote"]>;
  branch: string;
  base: string;
}

// The checks that `pr` and `stack` share: policy, origin, and base.
async function prepare(ctx: CliContext, options: PrOptions): Promise<Ready | string> {
  readCheckout(ctx);
  const policy = await gate(ctx, { profile: options.profile, plan: options.plan, yes: options.yes, actions: ["push", "pr"], hostFailure: "state" });
  if (policy.stop !== undefined) return policy.stop;
  const { remote, state } = policy;
  if (remote === undefined) return "ask: omt cannot read the owner from the origin remote URL\n";
  if (state.branch === undefined) return "ask: HEAD is detached\n";
  const base = options.base ?? policy.prs[0]?.baseRefName ?? state.defaultBranch;
  if (base === undefined || base === "") return "ask: no base branch\n";
  if (base === state.branch) return `ask: the base ${base} is the branch itself\n`;
  return { gate: policy, remote, branch: state.branch, base };
}

// Fetches the base, so that `refs/remotes/origin/<base>` is current. Returns an error line or undefined.
function fetchBase(ctx: CliContext, base: string): string | undefined {
  const fetched = runTool(ctx, "git", ["fetch", "--quiet", "origin", base]);
  return ok(fetched) ? undefined : firstLine(fetched);
}

function changedFiles(ctx: CliContext, args: string[]): number | string {
  const diff = runTool(ctx, "git", ["diff", "--name-only", "-z", ...args]);
  if (!ok(diff)) return firstLine(diff);
  return diff.stdout.split("\0").filter((path) => path !== "").length;
}

export async function pr(ctx: CliContext, options: PrOptions & { forceWithLease: boolean }): Promise<number> {
  const body = await readBody(ctx, options.bodyFile);
  const ready = await prepare(ctx, options);
  if (typeof ready === "string") {
    ctx.stdout(ready);
    return 0;
  }
  const { remote, branch, base } = ready;
  const limit = maxPrFilesOf(ready.gate.loaded);
  if (limit !== null && limit > 0) {
    const fetchError = fetchBase(ctx, base);
    const count = fetchError ?? changedFiles(ctx, [`refs/remotes/origin/${base}...HEAD`]);
    if (typeof count === "string") {
      ctx.stdout(`ask: cannot count the changed files: ${count}\n`);
      return 0;
    }
    if (count > limit) {
      ctx.stdout(`split: ${count} files, limit ${limit}; pick cut commits and run omt git stack <sha>,...\n`);
      return 0;
    }
  }
  const refused = push(ctx, [...(options.forceWithLease ? ["--force-with-lease"] : []), "origin", `HEAD:${branch}`]);
  if (refused !== undefined) {
    ctx.stdout(refused);
    return 0;
  }
  const open = ready.gate.prs[0];
  if (open !== undefined) {
    ctx.stdout(`updated ${open.url}\n`);
    return 0;
  }
  const url = createPr(ctx, [
    "--repo", repoArg(remote), "--base", base, "--head", branch, "--title", options.title, ...body.args,
    ...(options.ready ? [] : ["--draft"]),
  ], body.input);
  ctx.stdout(`created ${url} (${options.ready ? "ready" : "draft"})\n`);
  return 0;
}

interface Slice {
  name: string; // the branch of the slice
  from: string; // the ref below the slice
  to: string; // the last commit of the slice
  base: string; // the base branch of the slice's PR
  prs: OpenPr[];
}

function prNumber(url: string): string | undefined {
  return /\/pull\/(\d+)\/?$/.exec(url)?.[1];
}

export async function stack(ctx: CliContext, cuts: string[], options: PrOptions): Promise<number> {
  const body = await readBody(ctx, options.bodyFile);
  if (cuts.length === 0 || cuts.some((cut) => cut === "")) throw usageError("git stack needs <sha>,<sha>...", "name the last commit of each lower slice, bottom first");
  const ready = await prepare(ctx, options);
  const stop = (text: string) => {
    ctx.stdout(text.endsWith("\n") ? text : `${text}\n`);
    return 0;
  };
  if (typeof ready === "string") return stop(ready);
  const { remote, branch, base } = ready;
  const commitOf = (rev: string) => {
    const result = runTool(ctx, "git", ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    return ok(result) ? result.stdout.trim() : undefined;
  };
  const shas: string[] = [];
  for (const cut of cuts) {
    const sha = commitOf(cut);
    if (sha === undefined) return stop(`ask: ${cut} is not a commit`);
    shas.push(sha);
  }
  const head = commitOf("HEAD");
  if (head === undefined) return stop("ask: HEAD has no commit");
  const fetchError = fetchBase(ctx, base);
  if (fetchError !== undefined) return stop(`ask: cannot read origin/${base}: ${fetchError}`);
  const baseRef = `refs/remotes/origin/${base}`;
  const points = [...shas, head];
  const labels = [...cuts, "HEAD"];
  for (let i = 0; i < shas.length; i++) {
    const next = points[i + 1] as string;
    const ancestor = runTool(ctx, "git", ["merge-base", "--is-ancestor", shas[i] as string, next]);
    if (!ok(ancestor) || shas[i] === next) return stop(`ask: ${cuts[i]} is not an ancestor of ${labels[i + 1]}; list the cuts bottom first`);
  }
  const bottom = runTool(ctx, "git", ["rev-list", "--count", `${baseRef}..${shas[0] as string}`]);
  if (!ok(bottom) || bottom.stdout.trim() === "0") return stop(`ask: the first slice has no commits on top of origin/${base}`);

  const total = points.length;
  const slices: Slice[] = points.map((to, k) => ({
    name: k === total - 1 ? branch : `${branch}-${k + 1}`,
    from: k === 0 ? baseRef : points[k - 1] as string,
    to,
    base: k === 0 ? base : `${branch}-${k}`,
    prs: k === total - 1 ? ready.gate.prs : [],
  }));
  const limit = maxPrFilesOf(ready.gate.loaded);
  if (limit !== null && limit > 0) {
    for (const [k, slice] of slices.entries()) {
      const count = changedFiles(ctx, k === 0 ? [`${slice.from}...${slice.to}`] : [slice.from, slice.to]);
      if (typeof count === "string") return stop(`ask: cannot count the changed files: ${count}`);
      if (count > limit) return stop(`split: slice ${k + 1} of ${total} changes ${count} files, limit ${limit}; pick more cut commits`);
    }
  }
  const lower = slices.slice(0, -1);
  const remoteHeads = runTool(ctx, "git", ["ls-remote", "--heads", "origin", ...lower.map((slice) => `refs/heads/${slice.name}`)]);
  if (!ok(remoteHeads)) return stop(`ask: cannot read the branches of origin: ${firstLine(remoteHeads)}`);
  const onRemote = new Map<string, string>();
  for (const row of remoteHeads.stdout.split(/\r?\n/)) {
    const [sha, ref] = row.split("\t");
    if (sha !== undefined && ref?.startsWith("refs/heads/")) onRemote.set(ref.slice("refs/heads/".length), sha);
  }
  const { state, loaded, user } = ready.gate;
  for (const slice of lower) {
    const there = onRemote.get(slice.name);
    if (there !== undefined && there !== slice.to) return stop(`ask: ${slice.name} exists on origin at another commit`);
    const local = commitOf(`refs/heads/${slice.name}`);
    if (local !== undefined && local !== slice.to) return stop(`ask: the branch ${slice.name} exists here at another commit`);
    const prs = openPrs(ctx, remote, slice.name);
    if (!prs.ok) return stop(`ask: ${prs.reason}`);
    slice.prs = prs.value;
    const decision = decide({
      action: "push",
      state: { ...state, branch: slice.name },
      loaded,
      user,
      host: remote.host,
      prAuthor: prAuthorOf(prs.value, user),
    });
    if (decision.decision !== "auto" && (!options.yes || decision.kind === "state")) return stop(`${decision.decision}: ${decision.reason}`);
  }

  for (const slice of lower) {
    if (commitOf(`refs/heads/${slice.name}`) === undefined) git(ctx, ["branch", slice.name, slice.to]);
    const refused = push(ctx, ["origin", `${slice.name}:${slice.name}`]);
    if (refused !== undefined) return stop(refused);
  }
  const refused = push(ctx, ["origin", `HEAD:${branch}`]);
  if (refused !== undefined) return stop(refused);

  const draft = options.ready ? [] : ["--draft"];
  const kind = options.ready ? "ready" : "draft";
  const numbers: string[] = [];
  for (const [k, slice] of slices.entries()) {
    const open = slice.prs[0];
    if (open !== undefined) {
      if (k === total - 1 && open.baseRefName !== slice.base) {
        const edit = runTool(ctx, "gh", ["pr", "edit", String(open.number), "--repo", repoArg(remote), "--base", slice.base]);
        if (!ok(edit)) throw new OmtError("gh_failed", `gh pr edit failed: ${firstLine(edit)}`);
      }
      numbers.push(String(open.number));
      ctx.stdout(`updated ${open.url}\n`);
      continue;
    }
    const top = k === total - 1;
    let input = body.input;
    let bodyArgs = body.args;
    if (!top) {
      const log = trimEnd(git(ctx, ["log", "--reverse", "--format=%s", `${slice.from}..${slice.to}`]));
      input = `Part ${k + 1} of ${total}: ${options.title}\n\n${log.split("\n").map((subject) => `- ${subject}`).join("\n")}\n`;
      bodyArgs = ["--body-file", "-"];
    }
    const title = top ? options.title : `${options.title} (${k + 1}/${total})`;
    const url = createPr(ctx, ["--repo", repoArg(remote), "--base", slice.base, "--head", slice.name, "--title", title, ...bodyArgs, ...draft], input);
    const number = prNumber(url);
    if (number !== undefined) numbers.push(number);
    ctx.stdout(`created ${url} (${kind})\n`);
  }

  const env = { GH_REPO: repoArg(remote) };
  if (ok(runTool(ctx, "gh", ["stack", "--help"], { env }))) {
    const link = runTool(ctx, "gh", ["stack", "link", "--base", base, ...numbers], { env });
    if (!ok(link)) ctx.stdout(`note: gh stack link failed: ${firstLine(link)}; the PRs have chained bases only\n`);
  } else {
    ctx.stdout("note: gh stack is not installed; the PRs have chained bases only\n");
  }
  return 0;
}
