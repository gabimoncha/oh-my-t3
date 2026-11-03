import { confirmApply } from "../install/confirm.ts";
import { applyAndReport, migrationHasWork, planMigration, renderMigrationPlan } from "../migrate/migrate.ts";
import type { CliContext } from "../types.ts";
import { parseArgs } from "../util/args.ts";

export const summary = "Move the old .omt and oh-my-t3code folders to .omt3 and oh-my-t3.";

export const usage = `Usage: omt migrate [--yes] [--dry-run]

Move the state folders of earlier releases to their new names: <project>/.omt
to <project>/.omt3, and ~/.config/oh-my-t3code (or the one under
XDG_CONFIG_HOME) to ~/.config/oh-my-t3. OMT_CONFIG_DIR names its folder
itself, so migrate never moves it.

The list holds the current project (the main checkout of a linked worktree),
each project in projects.json, and the user folder. omt shows it and asks once.
For each project, migrate copies the folder, updates the hook command, the git
exclude block, the install manifest, and the skills, runs the shim and the
hook, and deletes the old folder. A failed check deletes the copy instead.

A project with an open ledger start, or whose shim runs another omt, is
skipped. When both folders exist, migrate moves the files that only the old
folder has, appends its missing ledger lines, asks about each file that
differs, and deletes the old folder when nothing is left.

Options:
  --yes             apply without a prompt
  --dry-run         print the list and change nothing
  -h, --help        print this help
`;

// The list, one confirmation, then each target.
export async function migrateFlow(ctx: CliContext, options: { yes: boolean; dryRun: boolean }): Promise<number> {
  const targets = await planMigration(ctx);
  if (targets.length === 0) {
    ctx.stdout("Nothing to migrate.\n");
    return 0;
  }
  ctx.stdout(`omt migrate:\n${renderMigrationPlan(targets)}`);
  if (options.dryRun || !migrationHasWork(targets)) return 0;
  if (!(await confirmApply(ctx, options.yes))) return 1;
  return applyAndReport(ctx, targets);
}

export async function run(ctx: CliContext): Promise<number> {
  const { values } = parseArgs(ctx.argv, { yes: { type: "boolean" }, "dry-run": { type: "boolean" } }, { maxPositionals: 0 });
  return migrateFlow(ctx, { yes: values.yes === true, dryRun: values["dry-run"] === true });
}
