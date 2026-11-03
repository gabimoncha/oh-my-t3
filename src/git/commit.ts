import { posix } from "node:path";
import type { CliContext } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { firstLine, git, ok, runTool, trimEnd } from "./exec.ts";
import { gate } from "./gate.ts";
import { contentHash, readCheckout, readStart, readStatus, startHash } from "./start.ts";

export interface CommitOptions {
  id: string;
  message: string;
  profile: string | undefined;
  plan: string | undefined;
  paths: string[];
  includes: string[];
  yes: boolean;
}

// A --path or --include value, relative to the current folder, as a path below the top folder.
export function topPath(prefix: string, value: string, flag: string): string {
  const path = posix.normalize(posix.join(prefix, value.replaceAll("\\", "/"))).replace(/\/+$/, "");
  if (path === ".." || path.startsWith("../") || posix.isAbsolute(path)) throw usageError(`--${flag} "${value}" is outside the repository`);
  return path === "." ? "" : path;
}

function names(spec: string, path: string): boolean {
  return spec === "" || path === spec || path.startsWith(`${spec}/`);
}

// The paths that `git commit --dry-run --porcelain -z` would commit, one list per entry.
function wouldCommit(out: string): string[][] {
  const fields = out.split("\0");
  const entries: string[][] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field === undefined || field.length < 4) continue;
    const x = field[0] ?? " ";
    const paths = [field.slice(3)];
    if ("RC".includes(x) || "RC".includes(field[1] ?? " ")) {
      i++;
      const from = fields[i];
      if (from !== undefined && from !== "") paths.push(from);
    }
    if (!" ?!".includes(x)) entries.push(paths);
  }
  return entries;
}

export async function commit(ctx: CliContext, options: CommitOptions): Promise<number> {
  const checkout = readCheckout(ctx);
  const paths = options.paths.map((value) => topPath(checkout.prefix, value, "path"));
  const includes = options.includes.map((value) => topPath(checkout.prefix, value, "include"));
  const policy = await gate(ctx, { profile: options.profile, plan: options.plan, yes: options.yes, actions: ["commit"], hostFailure: "owner" });
  if (policy.stop !== undefined) {
    ctx.stdout(policy.stop);
    return 0;
  }
  const ask = (reason: string) => {
    ctx.stdout(`ask: ${reason}\n`);
    return 0;
  };

  const start = await readStart(checkout, options.id);
  if (start === undefined) return ask("no start record; run omt git start before the first edit");
  const status = readStatus(ctx, checkout.top);
  const owned: string[] = [];
  const before: string[] = []; // paths changed before the run that the run changed again
  for (const path of status.keys()) {
    const hash = startHash(start, path);
    if (hash === undefined) owned.push(path);
    else if ((await contentHash(checkout.top, path)) !== hash) before.push(path);
  }
  for (const include of includes) {
    if (!before.includes(include)) return ask(`${include} is not a path that had changes before the run and changed again`);
  }
  const candidates = [...owned, ...before].sort();
  let selected = candidates;
  if (paths.length > 0) {
    for (const spec of paths) {
      if (!candidates.some((path) => names(spec, path))) return ask(`${spec === "" ? "." : spec} is not a path that this run changed`);
    }
    selected = candidates.filter((path) => paths.some((spec) => names(spec, path)));
  }
  const conflict = selected.find((path) => before.includes(path) && !includes.includes(path));
  if (conflict !== undefined) return ask(`${conflict} had changes before the run, and the run changed it too`);
  if (selected.length === 0) {
    ctx.stdout("skipped: the run changed no paths since omt git start\n");
    return 0;
  }

  const top = { cwd: checkout.top };
  const added = selected.filter((path) => status.get(path)?.x === "?");
  const unstage = () => {
    if (added.length > 0) runTool(ctx, "git", ["--literal-pathspecs", "reset", "-q", "--", ...added], top);
  };
  if (added.length > 0) git(ctx, ["--literal-pathspecs", "add", "--", ...added], top);
  const dry = runTool(ctx, "git", ["--literal-pathspecs", "commit", "--dry-run", "--porcelain", "-z", "--only", "--", ...selected], top);
  if (!ok(dry)) {
    unstage();
    throw new OmtError("git_failed", `git commit --dry-run failed: ${firstLine(dry)}`);
  }
  const entries = wouldCommit(dry.stdout);
  const extra = entries.flat().find((path) => !selected.includes(path));
  if (extra !== undefined) {
    unstage();
    return ask(`the commit would also take ${extra}`);
  }
  const done = runTool(ctx, "git", ["--literal-pathspecs", "commit", "--only", "-m", options.message, "--", ...selected], top);
  if (!ok(done)) {
    unstage();
    throw new OmtError("git_failed", `git commit failed: ${firstLine(done)}`);
  }
  const sha = trimEnd(git(ctx, ["rev-parse", "--short", "HEAD"], top));
  ctx.stdout(`committed ${sha}: ${entries.length} ${entries.length === 1 ? "file" : "files"}\n`);
  for (const path of [...readStatus(ctx, checkout.top).keys()].sort()) {
    if (startHash(start, path) !== undefined) ctx.stdout(`left: ${path}\n`);
  }
  return 0;
}
