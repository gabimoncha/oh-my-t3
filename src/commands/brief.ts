import { createHash } from "node:crypto";
import { join } from "node:path";
import { renderBrief, briefTitle, TITLE_MAX } from "../brief/render.ts";
import type { BriefInput } from "../brief/render.ts";
import { findRoleTemplate, loadResultContract } from "../brief/templates.ts";
import { limitArg } from "../config/validate.ts";
import { requestId } from "../ledger/ledger.ts";
import { evidenceDir, findProjectRoot } from "../paths.ts";
import { findRole, harnessOptions, resolveRole, toRouteOutput } from "../routing/resolve.ts";
import type { BriefJsonOutput, CliContext, CommandRun } from "../types.ts";
import { parseArgs, positiveInt } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { pathExists, writeFileAtomic } from "../util/fs.ts";
import { formatJson } from "../util/output.ts";
import { againstOptions, checkAgainst, loadEffectiveConfigReporting, readCapabilities, readInput } from "./shared.ts";

export const summary = "Render a task brief for a role, or a delegate_task payload.";

export const usage = `Usage: omt brief <role> (--task <text> | --task-file <file>) [options]

Render the brief that a child agent gets for one task.

Options:
  --task <text>            the task
  --task-file <file>       read the task from a file (- for stdin)
  --context <text>         background the child needs
  --context-file <file>    read the context from a file (- for stdin)
  --scope <path>           a file or directory in scope; repeatable
  --done <text>            one done condition; repeatable
  --verify <command>       one verify command; repeatable
  --prior-file <file>      earlier rounds: findings, responses, objections
  --round <n>              review or fix round (default 1)
  --depth <n>              the child's depth (default 1)
  --max-depth <n>          override limits.maxDepth from the config (0 to 3)
  --plan <slug>            use the plan's profile; id for the header and request id
  --profile <name>         override the selected profile
  --unit <id>              unit id for the header and the request id
  --attempt <n>            attempt number for the request id (default 1)
  --title <text>           thread title for --json output
  --capabilities <file>    with --json: resolve the target against T3
  --against <value>        the provider or driver of the worker whose change the task
                           reviews, used with --json; auto reads it from the ledger and needs --plan
  --json                   print a ready delegate_task payload
  --save                   save the full brief; use a short task with --json
  -h, --help               print this help
`;

export const BRIEF_MAX_CHARS = 120_000;

function exclusive(textFlag: string, text: string | undefined, fileFlag: string, file: string | undefined): void {
  if (text !== undefined && file !== undefined) throw usageError(`use --${textFlag} or --${fileFlag}, not both`);
}

async function readText(
  ctx: CliContext,
  text: string | undefined,
  flag: string,
  file: string | undefined,
): Promise<string | undefined> {
  if (text !== undefined) return text;
  if (file === undefined) return undefined;
  return readInput(ctx, flag, file);
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    task: { type: "string" },
    "task-file": { type: "string" },
    context: { type: "string" },
    "context-file": { type: "string" },
    scope: { type: "string", multiple: true },
    done: { type: "string", multiple: true },
    verify: { type: "string", multiple: true },
    "prior-file": { type: "string" },
    round: { type: "string" },
    depth: { type: "string" },
    "max-depth": { type: "string" },
    plan: { type: "string" },
    profile: { type: "string" },
    unit: { type: "string" },
    attempt: { type: "string" },
    title: { type: "string" },
    capabilities: { type: "string" },
    against: { type: "string" },
    json: { type: "boolean" },
    save: { type: "boolean" },
  }, { maxPositionals: 1 });
  const [name] = positionals;
  if (name === undefined) throw usageError("brief needs a <role>");
  exclusive("task", values.task, "task-file", values["task-file"]);
  exclusive("context", values.context, "context-file", values["context-file"]);
  if (values.task === undefined && values["task-file"] === undefined) {
    throw usageError("brief needs --task <text> or --task-file <file>");
  }
  const stdinFlags = [values["task-file"], values["context-file"], values["prior-file"], values.capabilities];
  if (stdinFlags.filter((file) => file === "-").length > 1) throw usageError("only one flag can read stdin (-)");
  const json = values.json === true;
  checkAgainst(values);

  const round = positiveInt("round", values.round) ?? 1;
  const depth = positiveInt("depth", values.depth) ?? 1;
  const attempt = positiveInt("attempt", values.attempt) ?? 1;
  const maxDepthFlag = values["max-depth"];
  const maxDepthOverride = maxDepthFlag === undefined ? undefined : limitArg("--max-depth", maxDepthFlag, "maxDepth");

  const { config, profile } = await loadEffectiveConfigReporting(ctx, { plan: values.plan, profile: values.profile, allowMissingPlan: true });
  const role = findRole(config, name);

  const maxDepth = maxDepthOverride ?? config.limits.maxDepth;
  if (depth > maxDepth) {
    throw usageError(`--depth ${depth} is greater than the max depth ${maxDepth}`, "pass --max-depth <n> to raise the limit (0 to 3)");
  }

  const task = (await readText(ctx, values.task, "task-file", values["task-file"])) ?? "";
  if (task.trim() === "") throw usageError("the task is empty");
  const context = await readText(ctx, values.context, "context-file", values["context-file"]);
  const prior = await readText(ctx, undefined, "prior-file", values["prior-file"]);

  const input: BriefInput = {
    role: name,
    task,
    scope: values.scope ?? [],
    done: values.done ?? [],
    verify: values.verify ?? [],
    round,
    depth,
    maxDepth,
    configuredMaxDepth: config.limits.maxDepth,
    access: role.access,
    interactionMode: role.interactionMode,
  };
  if (context !== undefined) input.context = context;
  if (prior !== undefined) input.prior = prior;
  if (values.plan !== undefined) input.plan = values.plan;
  if (values.profile !== undefined) input.profile = profile.name;
  if (values.unit !== undefined) input.unit = values.unit;

  const projectRoot = findProjectRoot(ctx.cwd);
  const localCli = join(projectRoot, ".omt", "bin", "omt");
  const cliCommand = await pathExists(localCli) ? shellWord(localCli) : "omt";
  input.cliCommand = cliCommand;
  if (role.access === "edit") input.evidenceDir = `${evidenceDir(projectRoot)}/`;

  const roots = { packageRoot: ctx.packageRoot, projectRoot, env: ctx.env, homedir: ctx.homedir };
  const persona = await findRoleTemplate(roots, name);
  const contract = await loadResultContract(ctx.packageRoot, role.result);
  const brief = renderBrief(input, persona.content, contract);
  if (brief.length > BRIEF_MAX_CHARS) {
    throw new OmtError("brief_too_long", `the brief has ${brief.length} characters; the limit is ${BRIEF_MAX_CHARS}`, {
      hint: "shorten --context or --prior-file, or point the child at files instead",
    });
  }
  const clientRequestId = values.plan !== undefined && values.unit !== undefined
    ? requestId(values.plan, values.unit, name, round, attempt) : undefined;
  const savedPath = values.save
    ? join(evidenceDir(projectRoot), "briefs", `${clientRequestId ?? `${name}-${createHash("sha256").update(brief).digest("hex").slice(0, 12)}`}.md`)
    : undefined;

  if (!json) {
    if (savedPath !== undefined) await writeFileAtomic(savedPath, brief);
    ctx.stdout(brief);
    return 0;
  }

  const caps = await readCapabilities(ctx, values.capabilities);
  const resolution = resolveRole(name, role, caps, {
    ...harnessOptions(config.harnesses, config.roles),
    ...await againstOptions(ctx, config, role, values),
    models: config.models,
  });
  for (const note of toRouteOutput(resolution).notes) ctx.stderr(`note: ${note}\n`);
  const args = resolution.delegateTask;
  if (args === undefined) {
    throw new OmtError("role_unavailable", `role ${name} is unavailable: no rung in its chain can run`, {
      hint: toRouteOutput(resolution).notes.join("\n      "),
    });
  }
  const output: BriefJsonOutput = {
    delegateTask: {
      task: brief,
      title: (values.title ?? briefTitle(name, task, values.unit, round)).slice(0, TITLE_MAX),
      target: args.target,
      role: args.role,
      interactionMode: args.interactionMode,
      runtimeMode: args.runtimeMode,
      mode: "async",
    },
    fallbacks: resolution.fallbacks,
  };
  if (clientRequestId !== undefined) {
    output.delegateTask.clientRequestId = clientRequestId;
  }
  if (savedPath !== undefined) {
    await writeFileAtomic(savedPath, brief);
    output.delegateTask.task = `Act as the ${name} sub-agent for this task. Your full brief is in the file ${savedPath}. Read it in full first, then follow it exactly. End with the result block that the brief defines.`;
    const fields = [
      ...(values.plan === undefined ? [] : ["--plan", values.plan]),
      ...(values.unit === undefined ? [] : ["--unit", values.unit]),
      "--role", name, "--round", String(round), "--attempt", String(attempt),
      "--status", "dispatched", "--task-id", "<taskId>",
      ...(clientRequestId === undefined ? [] : ["--client-request-id", clientRequestId]),
      "--provider", args.target.providerInstanceId ?? args.target.driverKind as string,
      "--model", args.target.model,
    ];
    output.ledger = { dispatched: `${cliCommand} ledger add ${fields.map((value) => value === "<taskId>" ? value : shellWord(value)).join(" ")}` };
  }
  ctx.stdout(formatJson(output));
  return 0;
};
