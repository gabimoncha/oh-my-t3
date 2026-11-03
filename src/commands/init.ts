import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_STARTER_CONFIG } from "../config/starter.ts";
import { withGitignoreLines } from "../install/project.ts";
import { findProjectRoot, omtDir, plansDir, projectConfigPath } from "../paths.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { ensureDir, pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { worktreeSummary } from "../worktree/check.ts";

export const summary = "Create .omt3/ in the project root with a starter config.";

export const usage = `Usage: omt init

Create what is missing in the project root: .omt3/config.jsonc,
.omt3/plans/, and .omt3/.gitignore. Add the lines that an existing
.omt3/.gitignore lacks. Never overwrites or removes anything else.
Then print the T3 worktree setup state of the current checkout, as
omt worktree check does.

Options:
  -h, --help        print this help
`;

export const run: CommandRun = async (ctx) => {
  parseArgs(ctx.argv, {}, { maxPositionals: 0 });
  const root = findProjectRoot(ctx.cwd);
  const configPath = projectConfigPath(root);
  if (await pathExists(configPath)) {
    ctx.stdout(`exists ${configPath}\n`);
  } else {
    await writeFileAtomic(configPath, PROJECT_STARTER_CONFIG);
    ctx.stdout(`create ${configPath}\n`);
  }
  const plans = plansDir(root);
  if (await pathExists(plans)) {
    ctx.stdout(`exists ${plans}\n`);
  } else {
    await ensureDir(plans);
    ctx.stdout(`create ${plans}\n`);
  }
  ctx.stdout(await initGitignore(join(omtDir(root), ".gitignore")));
  const worktree = await worktreeSummary(ctx);
  ctx.stdout(`worktree setup: ${worktree.status} ${worktree.message}\n`);
  return 0;
};

// An older omt wrote fewer lines, so an existing file gets the missing ones. A symlink keeps pointing at its
// target, and a dangling one stays as it is.
async function initGitignore(path: string): Promise<string> {
  const exists = await pathExists(path);
  const before = await readFileIfExists(path);
  if (exists && before === undefined) return `exists ${path}\n`;
  const after = withGitignoreLines(before);
  if (after === before) return `exists ${path}\n`;
  await writeFileAtomic(before === undefined ? path : await realpath(path), after);
  return `${before === undefined ? "create" : "update"} ${path}\n`;
}
