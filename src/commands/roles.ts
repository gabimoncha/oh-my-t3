import { resolve } from "node:path";
import { formatRolesTable } from "../routing/format.ts";
import { formatRolesHtml } from "../routing/html.ts";
import { resolveAll } from "../routing/resolve.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { writeFileAtomic } from "../util/fs.ts";
import { formatJson } from "../util/output.ts";
import { loadEffectiveConfigReporting, readCapabilities } from "./shared.ts";

export const summary = "Resolve every role to a provider, model, and options.";

export const usage = `Usage: omt roles [--capabilities <file>] [--role <name>]... [--plan <slug>] [--profile <name>] [--json | --html <file>]

Load the config, resolve each role chain, and print a table.

Options:
  --capabilities <file>  orchestrator_capabilities output (- for stdin)
  --role <name>          resolve only this role; repeatable
  --plan <slug>          use the plan's selected profile
  --profile <name>       override the selected profile
  --json                 print the roles report as JSON
  --html <file>          write the roles as an HTML card for T3 html_render, and print the path
  -h, --help             print this help
`;

export const run: CommandRun = async (ctx) => {
  const { values } = parseArgs(ctx.argv, {
    capabilities: { type: "string" },
    role: { type: "string", multiple: true },
    plan: { type: "string" },
    profile: { type: "string" },
    json: { type: "boolean" },
    html: { type: "string" },
  }, { maxPositionals: 0 });
  if (values.json === true && values.html !== undefined) throw usageError("use --json or --html, not both");
  const { config } = await loadEffectiveConfigReporting(ctx, { plan: values.plan, profile: values.profile, allowMissingPlan: true });
  const caps = await readCapabilities(ctx, values.capabilities);
  const report = resolveAll(config, caps, values.role, config.harnesses);
  if (values.html !== undefined) {
    const file = resolve(ctx.cwd, values.html);
    await writeFileAtomic(file, formatRolesHtml(report, config.profile));
    ctx.stdout(`${file}\n`);
    return 0;
  }
  ctx.stdout(values.json ? formatJson(report) : formatRolesTable(report));
  return 0;
};
