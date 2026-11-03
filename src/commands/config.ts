import { activeDefaults } from "../config/defaultsState.ts";
import { DEFAULT_CONFIG, formatValue } from "../config/defaults.ts";
import { startConfigEditor } from "../config/editor/server.ts";
import { explainConfig, sourceLabel } from "../config/explain.ts";
import type { ExplainEntry } from "../config/explain.ts";
import { loadConfig, mergeConfigLayers, readConfigLayers } from "../config/load.ts";
import { USER_STARTER_CONFIG } from "../config/starter.ts";
import { retiredProfileIssue } from "../config/validate.ts";
import { findProjectRoot, projectConfigPath, userConfigPath } from "../paths.ts";
import type { CliContext, CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { writeTargetFor } from "../install/fsops.ts";
import { pathExists, writeFileAtomic } from "../util/fs.ts";
import { formatJson } from "../util/output.ts";
import { formatIssue, loadConfigReporting, readCapabilities } from "./shared.ts";

export const summary = "Show, explain, edit, locate, validate, or create the omt config.";

export const usage = `Usage: omt config [show | explain | path | validate | init] [--json] [--defaults] [--force]
       omt config explain [--profile <name>] [--json]
       omt config edit --web [--no-open] [--capabilities <file>]

Subcommands:
  show              print the merged config as JSON before profile selection (default)
  explain           print the layer that sets each value: defaults, the user
                    or project config, or a profile and the file that declares it
  edit              with --web: edit the user and project config in a browser; a
                    local server on 127.0.0.1 runs until Ctrl-C or the tab closes
  path              print the user and project config paths
  validate          print config issues; exit 1 on any error
  init              write the starter user config

Options:
  --json            print validate or explain results as JSON
  --profile <name>  with explain: explain this profile instead of the selected one
  --web             with edit: start the editor and open it in the default browser
  --no-open         with edit: print the editor URL and open no browser
  --capabilities <file>
                    with edit: orchestrator_capabilities output (- for stdin);
                    the role editor lists the T3 providers, models, effort
                    levels, and fast mode from it
  --defaults        with show: print the installed release's current defaults
  --force           with init: overwrite an existing file
  -h, --help        print this help
`;

const SUBCOMMANDS = ["show", "explain", "edit", "path", "validate", "init"];

async function show(ctx: CliContext, defaults: boolean): Promise<number> {
  const loaded = await loadConfigReporting(ctx);
  ctx.stdout(formatJson(defaults ? DEFAULT_CONFIG : loaded.config));
  return 0;
}

function formatEntries(entries: ExplainEntry[]): string {
  return entries.map((entry) => {
    const lines = [`${entry.path.join(".")}  ${formatValue(entry.path, entry.value)}  ${sourceLabel(entry.source)}\n`];
    for (const over of entry.overridden) {
      lines.push(`  over ${sourceLabel(over.source)}: ${formatValue(entry.path, over.value)}\n`);
    }
    return lines.join("");
  }).join("");
}

async function explain(ctx: CliContext, profile: string | undefined, json: boolean): Promise<number> {
  const layers = await readConfigLayers(ctx);
  const loaded = mergeConfigLayers(layers, await activeDefaults(ctx));
  for (const issue of loaded.issues) ctx.stderr(formatIssue(issue));
  const retired = profile === undefined ? undefined : retiredProfileIssue(profile, "--profile", "");
  if (retired !== undefined) ctx.stderr(formatIssue(retired));
  const report = explainConfig(layers, loaded, profile);
  if (json) {
    ctx.stdout(formatJson(report));
    return 0;
  }
  const out: string[] = [];
  for (const layer of layers) out.push(`${layer.kind}: ${layer.path}\n`);
  out.push(`defaults: ${report.defaults.source}\n`);
  out.push(`profile: ${report.profile.name} (${report.profile.source})\n`);
  out.push("root:\n", formatEntries(report.root));
  if (report.removed.length > 0) {
    out.push("removed:\n");
    for (const entry of report.removed) out.push(`${entry.path.join(".")}  ${sourceLabel(entry.source)}\n`);
  }
  out.push("effective:\n", formatEntries(report.effective));
  ctx.stdout(out.join(""));
  return 0;
}

async function edit(ctx: CliContext, open: boolean, capabilities: string | undefined): Promise<number> {
  const caps = await readCapabilities(ctx, capabilities);
  const editor = await startConfigEditor(ctx, { open, ...(caps === undefined ? {} : { capabilities: caps }) });
  const stop = () => {
    void editor.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    ctx.stdout(`omt config editor: ${editor.url}\n`);
    ctx.stdout("Press Ctrl-C to stop. The editor also stops when you close its tab.\n");
    await editor.closed;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  ctx.stdout("editor stopped\n");
  return 0;
}

async function path(ctx: CliContext): Promise<number> {
  const user = userConfigPath(ctx.env, ctx.homedir);
  const project = projectConfigPath(findProjectRoot(ctx.cwd));
  const state = async (file: string) => ((await pathExists(file)) ? "present" : "absent");
  ctx.stdout(`user: ${user} (${await state(user)})\n`);
  ctx.stdout(`project: ${project} (${await state(project)})\n`);
  return 0;
}

async function validate(ctx: CliContext, json: boolean): Promise<number> {
  const { issues } = await loadConfig(ctx);
  const ok = !issues.some((issue) => issue.severity === "error");
  if (json) {
    ctx.stdout(formatJson({ ok, issues }));
  } else if (issues.length === 0) {
    ctx.stdout("config ok\n");
  } else {
    for (const issue of issues) ctx.stdout(formatIssue(issue));
  }
  return ok ? 0 : 1;
}

async function init(ctx: CliContext, force: boolean): Promise<number> {
  const target = userConfigPath(ctx.env, ctx.homedir);
  const exists = await pathExists(target);
  if (exists && !force) {
    throw new OmtError("exists", `${target} already exists`, { hint: "use --force to overwrite it" });
  }
  await writeFileAtomic(await writeTargetFor(target), USER_STARTER_CONFIG);
  ctx.stdout(`${exists ? "overwrite" : "create"} ${target}\n`);
  return 0;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    json: { type: "boolean" },
    defaults: { type: "boolean" },
    force: { type: "boolean" },
    profile: { type: "string" },
    web: { type: "boolean" },
    "no-open": { type: "boolean" },
    capabilities: { type: "string" },
  }, { maxPositionals: 1 });
  const sub = positionals[0] ?? "show";
  if (!SUBCOMMANDS.includes(sub)) {
    throw usageError(`unknown subcommand "${sub}"`, `use one of: ${SUBCOMMANDS.join(", ")}`);
  }
  if (values.profile !== undefined && sub !== "explain") throw usageError("--profile applies only to config explain");
  if ((values.web !== undefined || values["no-open"] !== undefined || values.capabilities !== undefined) && sub !== "edit") {
    throw usageError("--web, --no-open, and --capabilities apply only to config edit");
  }
  if (sub === "edit") {
    if (values.web !== true) throw usageError("config edit needs --web", "use omt config edit --web");
    return edit(ctx, values["no-open"] !== true, values.capabilities);
  }
  if (sub === "explain") return explain(ctx, values.profile, values.json === true);
  if (sub === "path") return path(ctx);
  if (sub === "validate") return validate(ctx, values.json === true);
  if (sub === "init") return init(ctx, values.force === true);
  return show(ctx, values.defaults === true);
};
