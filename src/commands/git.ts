import { behind } from "../git/behind.ts";
import { parseRemote, readBranchState } from "../git/branch.ts";
import { commit } from "../git/commit.ts";
import { loadConfigOrError } from "../git/gate.ts";
import { ACTIONS, decide, maxPrFilesOf } from "../git/policy.ts";
import type { Action } from "../git/policy.ts";
import { pr, stack } from "../git/pr.ts";
import { readCheckout, readStart, runIdFrom, writeStart } from "../git/start.ts";
import type { CliContext, CommandRun } from "../types.ts";
import { checkPositionals, parseArgs, positiveInt } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { checkPlanSlug } from "../util/ids.ts";
import { formatJson } from "../util/output.ts";

export const summary = "Check the git policy, catch up a branch, and commit, push, and open PRs within it.";

export const usage = `Usage: omt git check <commit|push|pr|merge> [--user <login>] [--host <host>]
                     [--pr-author <login>] [--plan <slug>] [--profile <name>] [--json]
       omt git behind [--ff]
       omt git start (--plan <slug> | --run <id>) [--force]
       omt git commit --message <text> (--plan <slug> | --run <id>) [--profile <name>]
                      [--path <path>]... [--include <path>]... [--yes]
       omt git pr --title <text> --body-file <file> (--plan <slug> | --run <id>)
                  [--profile <name>] [--base <branch>] [--ready] [--yes] [--force-with-lease]
       omt git pr --pr <number> (--plan <slug> | --run <id>) [--profile <name>] [--yes]
       omt git stack <sha>,<sha>... --title <text> --body-file <file> (--plan <slug> | --run <id>)
                     [--profile <name>] [--base <branch>] [--ready] [--yes]

Subcommands:
  check <action>  print the decision of the profile's workflow.git policy for
                  the action: auto (act with no question), ask (ask the owner
                  first), or off (do not act). Only the user's own repos and
                  PRs get auto: each origin URL is on --host and its owner is
                  --user or is in workflow.git.owners, each push URL names the
                  fetch URL's repo, and the PR author, when given, is --user.
                  --json also prints maxPrFiles, the most changed files in one
                  PR (0 means no limit, null means unset). Makes no network call.
  behind          count the commits of the default branch that HEAD lacks, with
                  no fetch. Prints "up to date with <name>", "fast-forwarded <n>
                  commits from <name>", "ask: <n> commits behind <name>; <reason>",
                  or "skipped: no default branch found"
  start           save the run's start record in this checkout's git dir: HEAD
                  and each path that is already changed, with its content hash.
                  Prints "start saved: <n> paths were already changed", or "kept
                  the start from <time>" when the record exists
  commit          commit only the paths that the run changed since start, with
                  git commit --only. Prints "committed <sha>: <n> files" and a
                  "left: <path>" line for each path changed before the run, or
                  "ask: <reason>", "off: <reason>", or "skipped: <reason>"
  pr              push the branch and open a draft PR, or report the open PR.
                  Prints "created <url> (draft|ready)", "updated <url>",
                  "split: <n> files, limit <m>; ...", "ask: <reason>", or
                  "off: <reason>"
  stack           check every slice, then push each slice branch <branch>-<k>
                  and open one PR per slice, each based on the slice below.
                  Prints one "created" or "updated" line per slice, bottom
                  first, and a "note:" line about gh stack

commit, pr, and stack apply the check decision with the profile of --profile,
else the plan header of --plan, else the config. They read the login with
"gh api --hostname <host> user -q .login" and the branch's open PRs with
"gh pr list", so they need gh when origin exists. pr and stack run git fetch
and git push, and gh contacts the git host. Each decision exits 0.

Options:
  --user <login>       with check: the user's GitHub login on --host
  --host <host>        with check: the host of the login (default github.com)
  --pr-author <login>  with check: the author of the branch's open PR
  --plan <slug>        use the plan's selected profile; with start, commit, pr,
                       and stack, also the id of the start record
  --run <id>           the id of the start record, for a run with no plan
  --profile <name>     override the selected profile for this command
  --ff                 with behind: fast-forward a clean tree
  --force              with start: replace an existing start record
  -m, --message <text> with commit: the commit message
  --path <path>        with commit: commit only these changed paths (repeatable)
  --include <path>     with commit: also commit a path that had changes before
                       the run and changed again (repeatable)
  --yes                with commit, pr, and stack: the user approved this action
                       in this run; turns an ask or an off into a go
  --title <text>       with pr and stack: the PR title
  --body-file <file>   with pr and stack: the PR body ("-" for stdin)
  --base <branch>      with pr and stack: the base branch (default: the open
                       PR's base, else the default branch)
  --ready              with pr and stack: open ready PRs, not drafts
  --pr <number>        with pr: the open PR that the push must update, such as
                       the PR under review; asks when it comes from a fork, is on
                       another branch, or is by another author, and never
                       creates a PR
  --force-with-lease   with pr: push with --force-with-lease; only after the
                       owner's yes for a force push
  --json               with check: print JSON
  -h, --help           print this help
`;

const SUBCOMMANDS = ["check", "behind", "start", "commit", "pr", "stack"] as const;

function required(value: string | undefined, flag: string, subcommand: string): string {
  if (value === undefined || value === "") throw usageError(`git ${subcommand} needs --${flag}`);
  return value;
}

async function check(ctx: CliContext, argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs(argv, {
    plan: { type: "string" },
    profile: { type: "string" },
    user: { type: "string" },
    host: { type: "string" },
    "pr-author": { type: "string" },
    json: { type: "boolean" },
  });
  checkPositionals(positionals, 1);
  const [actionArg] = positionals;
  if (actionArg === undefined || !(ACTIONS as readonly string[]).includes(actionArg)) {
    const what = actionArg === undefined ? "git check needs an action" : `unknown git action "${actionArg}"`;
    throw usageError(what, `use ${ACTIONS.join(", ")}`);
  }
  const action = actionArg as Action;
  if (values.plan !== undefined) checkPlanSlug(values.plan, "--plan");

  const loaded = await loadConfigOrError(ctx, values.profile, values.plan);
  const state = readBranchState(ctx);
  const remote = state.origin === undefined ? undefined : parseRemote(state.origin);
  const user = values.user;
  const prAuthor = values["pr-author"];
  const result = decide({ action, state, loaded, user, host: values.host ?? "github.com", prAuthor });
  const full = {
    action,
    decision: result.decision,
    branch: state.branch ?? null,
    defaultBranch: state.defaultBranch ?? null,
    host: remote?.host ?? null,
    owner: remote?.owner ?? null,
    repo: remote?.repo ?? null,
    user: user ?? null,
    prAuthor: prAuthor ?? null,
    key: result.key,
    value: result.value,
    reason: result.reason,
    maxPrFiles: maxPrFilesOf(loaded),
  };
  ctx.stdout(values.json === true ? formatJson(full) : `${full.decision}: ${full.reason}\n`);
  return 0;
}

const ID_OPTIONS = { plan: { type: "string" }, run: { type: "string" } } as const;
const PR_OPTIONS = {
  ...ID_OPTIONS,
  profile: { type: "string" },
  title: { type: "string" },
  "body-file": { type: "string" },
  base: { type: "string" },
  ready: { type: "boolean" },
  yes: { type: "boolean" },
} as const;

export const run: CommandRun = async (ctx) => {
  const [subcommand, ...argv] = ctx.argv;
  if (subcommand === undefined || !(SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    const what = subcommand === undefined ? "git needs a subcommand" : `unknown git subcommand "${subcommand}"`;
    throw usageError(what, `use ${SUBCOMMANDS.join(", ")}`);
  }
  if (subcommand === "check") return check(ctx, argv);
  if (subcommand === "behind") {
    const { values } = parseArgs(argv, { ff: { type: "boolean" } }, { maxPositionals: 0 });
    return behind(ctx, values.ff === true);
  }
  if (subcommand === "start") {
    const { values } = parseArgs(argv, { ...ID_OPTIONS, force: { type: "boolean" } }, { maxPositionals: 0 });
    const id = runIdFrom(values);
    const checkout = readCheckout(ctx);
    const existing = values.force === true ? undefined : await readStart(checkout, id);
    if (existing !== undefined) {
      ctx.stdout(`kept the start from ${existing.createdAt}\n`);
      return 0;
    }
    const record = await writeStart(ctx, checkout, id);
    const count = Object.keys(record.paths).length;
    ctx.stdout(`start saved: ${count} ${count === 1 ? "path was" : "paths were"} already changed\n`);
    return 0;
  }
  if (subcommand === "commit") {
    const { values } = parseArgs(argv, {
      ...ID_OPTIONS,
      profile: { type: "string" },
      message: { type: "string", short: "m" },
      path: { type: "string", multiple: true },
      include: { type: "string", multiple: true },
      yes: { type: "boolean" },
    }, { maxPositionals: 0 });
    const id = runIdFrom(values);
    return commit(ctx, {
      id,
      message: required(values.message, "message", "commit"),
      profile: values.profile,
      plan: values.plan,
      paths: values.path ?? [],
      includes: values.include ?? [],
      yes: values.yes === true,
    });
  }
  if (subcommand === "pr") {
    const { values } = parseArgs(argv, { ...PR_OPTIONS, "force-with-lease": { type: "boolean" }, pr: { type: "string" } }, { maxPositionals: 0 });
    runIdFrom(values);
    const prNumber = values.pr === undefined ? undefined : positiveInt("pr", values.pr);
    return pr(ctx, {
      title: prNumber === undefined ? required(values.title, "title", "pr") : values.title ?? "",
      bodyFile: prNumber === undefined ? required(values["body-file"], "body-file", "pr") : values["body-file"] ?? "",
      profile: values.profile,
      plan: values.plan,
      base: values.base,
      ready: values.ready === true,
      yes: values.yes === true,
      forceWithLease: values["force-with-lease"] === true,
      prNumber,
    });
  }
  const { values, positionals } = parseArgs(argv, PR_OPTIONS, { maxPositionals: 1 });
  runIdFrom(values);
  const [list] = positionals;
  if (list === undefined) throw usageError("git stack needs <sha>,<sha>...", "name the last commit of each lower slice, bottom first");
  return stack(ctx, list.split(","), {
    title: required(values.title, "title", "stack"),
    bodyFile: required(values["body-file"], "body-file", "stack"),
    profile: values.profile,
    plan: values.plan,
    base: values.base,
    ready: values.ready === true,
    yes: values.yes === true,
  });
};
