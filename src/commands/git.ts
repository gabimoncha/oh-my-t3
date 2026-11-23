import { commit } from "../git/commit.ts";
import { readCheckout, readStart, runIdFrom, writeStart } from "../git/start.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";

export const summary = "Record the files a run starts with, and commit only the files the run changed.";

export const usage = `Usage: omt git start (--plan <slug> | --run <id>) [--force]
       omt git commit --message <text> (--plan <slug> | --run <id>)
                      [--path <path>]... [--include <path>]...

Subcommands:
  start           save the run's start record in this checkout's git dir: HEAD
                  and each path that is already changed, with its content hash.
                  Prints "start saved: <n> paths were already changed", or "kept
                  the start from <time>" when the record exists
  commit          commit only the paths that the run changed since start, with
                  git commit --only. Prints "committed <sha>: <n> files" and a
                  "left: <path>" line for each path changed before the run, or
                  "ask: <reason>" or "skipped: <reason>"

Options:
  --plan <slug>        the id of the start record: the plan slug
  --run <id>           the id of the start record, for a run with no plan
  --force              with start: replace an existing start record
  -m, --message <text> with commit: the commit message
  --path <path>        with commit: commit only these changed paths (repeatable)
  --include <path>     with commit: also commit a path that had changes before
                       the run and changed again (repeatable)
  -h, --help           print this help
`;

const SUBCOMMANDS = ["start", "commit"] as const;
const ID_OPTIONS = { plan: { type: "string" }, run: { type: "string" } } as const;

export const run: CommandRun = async (ctx) => {
  const [subcommand, ...argv] = ctx.argv;
  if (subcommand === undefined || !(SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    const what = subcommand === undefined ? "git needs a subcommand" : `unknown git subcommand "${subcommand}"`;
    throw usageError(what, `use ${SUBCOMMANDS.join(", ")}`);
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
  const { values } = parseArgs(argv, {
    ...ID_OPTIONS,
    message: { type: "string", short: "m" },
    path: { type: "string", multiple: true },
    include: { type: "string", multiple: true },
  }, { maxPositionals: 0 });
  const id = runIdFrom(values);
  if (values.message === undefined || values.message === "") throw usageError("git commit needs --message");
  return commit(ctx, {
    id,
    message: values.message,
    paths: values.path ?? [],
    includes: values.include ?? [],
  });
};
