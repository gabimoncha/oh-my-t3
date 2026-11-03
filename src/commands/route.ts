import { findRole, harnessOptions, resolveRole, toRouteOutput } from "../routing/resolve.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { formatJson } from "../util/output.ts";
import { againstOptions, checkAgainst, loadEffectiveConfigReporting, readCapabilities } from "./shared.ts";

export const summary = "Print delegate_task arguments for one role.";

export const usage = `Usage: omt route <role> [--capabilities <file>] [--against <provider|driver|auto>] [--plan <slug>] [--profile <name>] [--unit <id>]

Resolve one role and print JSON that maps onto delegate_task arguments.
Exits 1 when the role is unknown or unavailable.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin)
  --against <value>      the provider or driver of the worker whose change the task reviews;
                         auto reads the worker from .omt3/ledger.jsonl and needs --plan
  --plan <slug>          use the plan's selected profile; plan for --against auto
  --profile <name>       override the selected profile
  --unit <id>            unit for --against auto
  -h, --help             print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    against: { type: "string" },
    plan: { type: "string" },
    profile: { type: "string" },
    unit: { type: "string" },
  }, { maxPositionals: 1 });
  const [name] = positionals;
  if (name === undefined) throw usageError("route needs a <role>");
  checkAgainst(values);
  const { config } = await loadEffectiveConfigReporting(ctx, { plan: values.plan, profile: values.profile, allowMissingPlan: true });
  const role = findRole(config, name);
  const caps = await readCapabilities(ctx, values.capabilities);
  const resolution = resolveRole(name, role, caps, {
    ...harnessOptions(config.harnesses, config.roles),
    ...await againstOptions(ctx, config, role, values),
    models: config.models,
  });
  const output = toRouteOutput(resolution);
  ctx.stdout(formatJson(output));
  return output.status === "unavailable" ? 1 : 0;
};
