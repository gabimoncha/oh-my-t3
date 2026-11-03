import { offerMigration } from "../migrate/offer.ts";
import type { CliContext } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { runUpdate } from "../update/flow.ts";
import type { UpdateSeams } from "../update/flow.ts";

export const summary = "Update the omt CLI with the command of its channel, then sync the skills.";

export const usage = `Usage: omt update [--check] [--dry-run] [--yes] [--skills-only] [--project] [--json]

Update the omt CLI with the command of the channel that installed it (npm,
pnpm, or Bun global, or mise), then sync the skills in user scope and in
each recorded project with the new CLI. A skill that you edited stays as it
is, and the output names it. Asks the npm registry for the latest version.
Shows the plan first, then asks to apply it. Shows default settings changes
and asks before accepting them. User overrides stay unchanged. When old
.omt or oh-my-t3code folders remain, it offers omt migrate on a terminal,
and prints a hint with --yes, --json, or no terminal.

Options:
  --check        ask the registry and print the current version, the latest
                 version, the channel, and its update command; write nothing
  --dry-run      print the plan and write nothing
  --yes          apply the update and current defaults without asking
  --skills-only  skip the registry and the CLI update, and sync the skills
                 with the CLI that runs now; no network and no runner
  --project      only the current project: the channel of its shim, and
                 its skills
  --json         print one JSON object; needs --check, --dry-run, or --yes
  -h, --help     print this help
`;

export async function run(ctx: CliContext, seams: UpdateSeams = {}): Promise<number> {
  const { values } = parseArgs(ctx.argv, {
    check: { type: "boolean" },
    "dry-run": { type: "boolean" },
    yes: { type: "boolean" },
    "skills-only": { type: "boolean" },
    project: { type: "boolean" },
    json: { type: "boolean" },
  }, { maxPositionals: 0 });
  const options = {
    check: values.check === true,
    dryRun: values["dry-run"] === true,
    yes: values.yes === true,
    skillsOnly: values["skills-only"] === true,
    project: values.project === true,
    json: values.json === true,
  };
  if (options.check) {
    const other = [
      ["--dry-run", options.dryRun],
      ["--yes", options.yes],
      ["--skills-only", options.skillsOnly],
      ["--project", options.project],
    ].find(([, set]) => set === true);
    if (other !== undefined) throw usageError(`--check cannot be used with ${String(other[0])}`, "--check writes nothing; run it alone, or with --json");
  }
  if (options.json && !options.check && !options.dryRun && !options.yes) {
    throw usageError("--json needs --check, --dry-run, or --yes", "omt update asks before it applies, and JSON output cannot ask");
  }
  const code = await runUpdate(ctx, options, seams);
  if (code !== 0) return code;
  const offered = await offerMigration({ ...ctx, isTTY: seams.isTTY ?? ctx.isTTY, prompt: seams.prompt ?? ctx.prompt }, options);
  return offered;
}
