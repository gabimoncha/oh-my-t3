import type { CommandRun } from "../types.ts";
import { checkPositionals, parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { formatJson, renderTable } from "../util/output.ts";
import { loadConfigReporting, loadEffectiveConfigReporting } from "./shared.ts";

export const summary = "List workflow profiles and show their effective config.";

export const usage = `Usage: omt profile list [--json]
       omt profile show [<name>] [--plan <slug>] [--profile <name>] [--json]

Subcommands:
  list              print profile names and descriptions
  show [<name>]     print the effective workflow, limits, roles, and models

Options:
  --plan <slug>     with show: use the plan's selected profile
  --profile <name>  with show: override the selected profile for this command
  --json            print JSON
  -h, --help        print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    plan: { type: "string" },
    profile: { type: "string" },
    json: { type: "boolean" },
  });
  const [subcommand, name] = positionals;
  if (subcommand === "list") {
    checkPositionals(positionals, 1);
    if (values.plan !== undefined || values.profile !== undefined) throw usageError("--plan and --profile apply only to profile show");
    const { config } = await loadConfigReporting(ctx);
    const profiles = Object.entries(config.profiles).map(([name, profile]) => ({ name, description: profile.description }));
    ctx.stdout(values.json ? formatJson(profiles) : renderTable(["PROFILE", "DESCRIPTION"], profiles.map((profile) => [profile.name, profile.description])));
    return 0;
  }
  if (subcommand === "show") {
    checkPositionals(positionals, 2);
    if (name !== undefined && values.profile !== undefined) throw usageError("profile show accepts a name or --profile, not both");
    const { profile } = await loadEffectiveConfigReporting(ctx, { profile: name ?? values.profile, plan: values.plan });
    const { name: selected, source, t3Workflow, workflow, limits, roles, models } = profile;
    const output = { profile: selected, source, t3Workflow, workflow, limits, roles, models };
    ctx.stdout(values.json
      ? formatJson(output)
      : `profile: ${selected}\nsource: ${source}\nt3Workflow: ${t3Workflow}\n${formatJson({ workflow, limits, roles, models })}`);
    return 0;
  }
  throw usageError(subcommand === undefined ? "profile needs a subcommand: list or show" : `unknown profile subcommand "${subcommand}"`, "use list or show");
};
