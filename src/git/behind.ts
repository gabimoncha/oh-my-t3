import type { CliContext } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { findDefaultRef } from "./branch.ts";
import { firstLine, git, ok, runTool, trimEnd } from "./exec.ts";

function commits(n: number): string {
  return `${n} ${n === 1 ? "commit" : "commits"}`;
}

// Counts the commits of the default branch that HEAD lacks, with no fetch, and with --ff
// fast-forwards a clean tree whose HEAD is an ancestor of the default branch.
export function behind(ctx: CliContext, ff: boolean): number {
  const probe = runTool(ctx, "git", ["rev-parse", "--is-inside-work-tree"]);
  if (!ok(probe) || probe.stdout.trim() !== "true") {
    ctx.stdout("skipped: the current folder is not in a git work tree\n");
    return 0;
  }
  const target = findDefaultRef(ctx);
  if (target === undefined) {
    ctx.stdout("skipped: no default branch found\n");
    return 0;
  }
  const count = Number(trimEnd(git(ctx, ["rev-list", "--count", `HEAD..${target.ref}`])));
  if (count === 0) {
    ctx.stdout(`up to date with ${target.name}\n`);
    return 0;
  }
  const ask = (reason: string) => {
    ctx.stdout(`ask: ${commits(count)} behind ${target.name}; ${reason}\n`);
    return 0;
  };
  if (!ff) return ask("pass --ff to fast-forward");
  if (trimEnd(git(ctx, ["status", "--porcelain"])) !== "") return ask("the tree has uncommitted changes");
  const ancestor = runTool(ctx, "git", ["merge-base", "--is-ancestor", "HEAD", target.ref]);
  if (ancestor.status === 1) return ask(`the branch has commits that ${target.name} does not have`);
  if (!ok(ancestor)) throw new OmtError("git_failed", `git merge-base failed: ${firstLine(ancestor)}`);
  git(ctx, ["merge", "--ff-only", "--quiet", target.ref]);
  ctx.stdout(`fast-forwarded ${commits(count)} from ${target.name}\n`);
  return 0;
}
