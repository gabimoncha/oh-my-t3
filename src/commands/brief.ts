import { createHash } from "node:crypto";
import { join } from "node:path";
import { renderBrief, briefTitle, TITLE_MAX } from "../brief/render.ts";
import type { BriefInput } from "../brief/render.ts";
import { findRoleTemplate, loadResultContract } from "../brief/templates.ts";
import { limitArg } from "../config/validate.ts";
import { appendLedger, closedBy, openStarts, readLedger, requestId, withLedgerLock } from "../ledger/ledger.ts";
import { parsePlan } from "../plan/parse.ts";
import { evidenceDir, findProjectRoot, ledgerPath, planPath } from "../paths.ts";
import { rungFamily, workerFamily } from "../routing/family.ts";
import { findRole, harnessOptions, resolveRole, toRouteOutput } from "../routing/resolve.ts";
import type { BriefJsonOutput, CliContext, CommandRun, LedgerEntry, ResolvedTarget, RoleResolution, Rung } from "../types.ts";
import { parseArgs, positiveInt } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
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
  --save                   save the full brief; use a short task with --json.
                           With --json, --plan, and --unit, it also checks the
                           parallel limit (exit 75 at the limit) and records the
                           start in the ledger; finish it with omt ledger done
  --fallback               with --json: use the next target that this unit, role,
                           and round have not tried; with --save the ledger
                           holds the tried targets and the attempt
  --tried <key>            with --fallback and without --save: a target key that
                           was tried already; repeatable
  --strict                 with --against: exit 1 when the chosen target is in
                           the family of the --against worker
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

interface Candidate {
  target: ResolvedTarget;
  rung: Rung;
  key: string;
}

export function targetKey(target: ResolvedTarget): string {
  return target.providerInstanceId !== undefined ? `${target.providerInstanceId}/${target.model}` : `driver:${target.driverKind ?? ""}/${target.model}`;
}

// The resolved order, with one more target for each rung that names only a driver: the same rung with
// providerInstanceId set to the driver. T3 checks a named instance again before it refuses it.
function candidates(resolution: RoleResolution): Candidate[] {
  return resolution.attempts.flatMap((attempt) => {
    const target = attempt.target;
    if (target === undefined) return [];
    const first = { target, rung: attempt.rung, key: targetKey(target) };
    if (target.providerInstanceId !== undefined || target.driverKind === undefined) return [first];
    const { driverKind, ...rest } = target;
    const retry = { ...rest, providerInstanceId: driverKind };
    return [first, { target: retry, rung: attempt.rung, key: targetKey(retry) }];
  });
}

function pick(name: string, list: Candidate[], tried: Set<string>): Candidate {
  const chosen = list.find((candidate) => !tried.has(candidate.key));
  if (chosen === undefined) {
    throw new OmtError("no_fallback", `no fallback left for ${name}; tried: ${[...tried].join(", ") || "none"}`);
  }
  return chosen;
}

async function planMaxParallel(root: string, plan: string): Promise<number | undefined> {
  const markdown = await readFileIfExists(planPath(root, plan));
  return markdown === undefined ? undefined : parsePlan(markdown).maxParallel;
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
    fallback: { type: "boolean" },
    tried: { type: "string", multiple: true },
    strict: { type: "boolean" },
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
  const fallback = values.fallback === true;
  const recording = json && values.save === true && values.plan !== undefined && values.unit !== undefined;
  if ((fallback || values.strict === true) && !json) throw usageError("--fallback and --strict need --json");
  if (values.tried !== undefined && !fallback) throw usageError("--tried needs --fallback");
  if (values.strict === true && values.against === undefined) throw usageError("--strict needs --against");
  if (fallback && recording && values.attempt !== undefined) {
    throw usageError("--fallback with --save picks the attempt from the ledger; leave out --attempt");
  }
  if (fallback && recording && values.tried !== undefined) {
    throw usageError("--fallback with --save reads the tried targets from the ledger; leave out --tried");
  }
  if (fallback && !recording && values.attempt === undefined) {
    throw usageError("--fallback without --save, --plan, and --unit needs --attempt <n>");
  }

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
  const briefFile = (id: string | undefined) =>
    join(evidenceDir(projectRoot), "briefs", `${id ?? `${name}-${createHash("sha256").update(brief).digest("hex").slice(0, 12)}`}.md`);

  if (!json) {
    const id = values.plan !== undefined && values.unit !== undefined ? requestId(values.plan, values.unit, name, round, attempt) : undefined;
    if (values.save) await writeFileAtomic(briefFile(id), brief);
    ctx.stdout(brief);
    return 0;
  }

  const caps = await readCapabilities(ctx, values.capabilities);
  const against = await againstOptions(ctx, config, role, values);
  const resolution = resolveRole(name, role, caps, {
    ...harnessOptions(config.harnesses, config.roles),
    ...against,
    models: config.models,
  });
  for (const note of toRouteOutput(resolution).notes) ctx.stderr(`note: ${note}\n`);
  const args = resolution.delegateTask;
  if (args === undefined) {
    throw new OmtError("role_unavailable", `role ${name} is unavailable: no rung in its chain can run`, {
      hint: toRouteOutput(resolution).notes.join("\n      "),
    });
  }
  const list = candidates(resolution);
  const strictFamily = values.strict === true && against.against !== undefined && role.crossFamily === true
    ? workerFamily(against.against, caps, against.drivers) : undefined;
  const checkStrict = (chosen: Candidate) => {
    if (strictFamily !== undefined && rungFamily(chosen.rung, caps, against.drivers) === strictFamily) {
      throw new OmtError("same_family", `no ${name} target outside ${strictFamily} is left`, {
        hint: "a review from the author's own family does not count; tell the user which targets failed",
      });
    }
  };

  const emit = async (chosen: Candidate, chosenAttempt: number, record: boolean) => {
    const clientRequestId = values.plan !== undefined && values.unit !== undefined
      ? requestId(values.plan, values.unit, name, round, chosenAttempt) : undefined;
    const output: BriefJsonOutput = {
      delegateTask: {
        task: brief,
        title: (values.title ?? briefTitle(name, task, values.unit, round)).slice(0, TITLE_MAX),
        target: chosen.target,
        role: args.role,
        interactionMode: args.interactionMode,
        runtimeMode: args.runtimeMode,
        mode: "async",
      },
      fallbacks: list.slice(list.indexOf(chosen) + 1).map((candidate) => candidate.target),
      targetKey: chosen.key,
    };
    if (clientRequestId !== undefined) output.delegateTask.clientRequestId = clientRequestId;
    if (values.save) {
      const savedPath = briefFile(clientRequestId);
      await writeFileAtomic(savedPath, brief);
      output.delegateTask.task = `Act as the ${name} sub-agent for this task. Your full brief is in the file ${savedPath}. Read it in full first, then follow it exactly. End with the result block that the brief defines.`;
    }
    if (record && clientRequestId !== undefined) {
      output.ledger = { done: `${cliCommand} ledger done ${shellWord(clientRequestId)} --verdict <VERDICT>` };
    }
    return output;
  };

  if (!recording) {
    const tried = new Set(values.tried ?? []);
    const chosen = fallback ? pick(name, list, tried) : (list[0] as Candidate);
    checkStrict(chosen);
    ctx.stdout(formatJson(await emit(chosen, attempt, false)));
    return 0;
  }

  const plan = values.plan as string;
  const unit = values.unit as string;
  const ledger = ledgerPath(projectRoot);
  const now = () => ctx.now().getTime();
  const output = await withLedgerLock(ledger, now, async () => {
    const { entries } = await readLedger(ledger);
    const open = openStarts(entries, plan);
    if (!fallback) {
      const id = requestId(plan, unit, name, round, attempt);
      const resent = open.find((entry) => entry.clientRequestId === id);
      if (resent !== undefined) {
        const chosen = list.find((candidate) => candidate.key === resent.targetKey) ?? (list[0] as Candidate);
        return emit(chosen, attempt, true);
      }
    }
    const same = (entry: LedgerEntry) =>
      entry.status === "dispatched" && entry.plan === plan && entry.unit === unit && entry.role === name && (entry.round ?? 1) === round;
    let chosenAttempt = attempt;
    let chosen = list[0] as Candidate;
    const superseded: LedgerEntry[] = [];
    if (fallback) {
      const earlier = entries.filter(same);
      if (earlier.length === 0) {
        throw new OmtError("no_attempt", `--fallback found no earlier ${name} attempt of ${plan} ${unit} r${round}`, {
          hint: "run the brief without --fallback first",
        });
      }
      chosenAttempt = Math.max(...earlier.map((entry) => entry.attempt ?? 1)) + 1;
      chosen = pick(name, list, new Set(earlier.flatMap((entry) => (entry.targetKey === undefined ? [] : [entry.targetKey]))));
      for (const entry of open.filter(same)) {
        superseded.push({
          ts: ctx.now().toISOString(),
          role: name,
          status: "failed",
          plan,
          unit,
          round,
          attempt: entry.attempt ?? 1,
          ...(entry.clientRequestId === undefined ? {} : { clientRequestId: entry.clientRequestId }),
          ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
          note: `superseded by attempt ${chosenAttempt}`,
        });
      }
    }
    checkStrict(chosen);
    const closed = closedBy([...entries, ...superseded]);
    const active = entries.filter((entry) => entry.plan === plan && entry.status === "dispatched" && !closed(entry)).length;
    const headerLimit = await planMaxParallel(projectRoot, plan);
    const maxParallel = Math.min(config.limits.maxParallel, headerLimit ?? config.limits.maxParallel);
    if (active >= maxParallel) {
      throw new OmtError("dispatch_limit", `limit: ${active} of ${maxParallel} children are active; run this command again after one ends`, {
        exitCode: 75,
      });
    }
    for (const entry of superseded) await appendLedger(ledger, entry);
    const result = await emit(chosen, chosenAttempt, true);
    const start: LedgerEntry = {
      ts: ctx.now().toISOString(),
      role: name,
      status: "dispatched",
      plan,
      unit,
      round,
      attempt: chosenAttempt,
      clientRequestId: result.delegateTask.clientRequestId as string,
      provider: chosen.target.providerInstanceId ?? chosen.target.driverKind as string,
      model: chosen.target.model,
      targetKey: chosen.key,
    };
    await appendLedger(ledger, start);
    return result;
  });
  ctx.stdout(formatJson(output));
  return 0;
};
