import { findCheckoutRoot, findProjectRoot, ledgerPath, mainCheckoutOf, planPath } from "../paths.ts";
import {
  appendLedger,
  closes,
  isLedgerStatus,
  isTerminal,
  LEDGER_STATUSES,
  ledgerStats,
  openStarts,
  readLedger,
  requestId,
} from "../ledger/ledger.ts";
import type { PlanStatus } from "../plan/parse.ts";
import { parsePlan } from "../plan/parse.ts";
import type { CliContext, CommandRun, LedgerEntry, LedgerStats, Limits } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { parseArgs, positiveInt } from "../util/args.ts";
import { checkPlanSlug, checkUnitId } from "../util/ids.ts";
import { readFileIfExists } from "../util/fs.ts";
import { formatJson, renderTable } from "../util/output.ts";
import { loadEffectiveConfigReporting } from "./shared.ts";

export const summary = "Record and list delegation events in .omt/ledger.jsonl.";

export const usage = `Usage: omt ledger done <requestId|taskId> [--verdict <word>] [--status <status>] [--task-id <id>] [--note <text>]
       omt ledger settle-check
       omt ledger add --role <role> --status <status> [options]
       omt ledger list [--plan <slug>] [--json]
       omt ledger stats [--plan <slug>] [--json]
       omt ledger request-id --plan <slug> --unit <id> --role <role> [--round <n>] [--attempt <n>]

Subcommands:
  done              close the open start that omt brief --save recorded, by its
                    clientRequestId or task id; prints closed ... and a settle: line
  settle-check      print settle: allowed, or settle: no (linked worktree);
                    writes nothing
  add               append one entry to .omt/ledger.jsonl
  list              print the entries
  stats             print dispatched, active, and terminal counts, the limits,
                    and whether another task can be dispatched; with --plan,
                    a max-parallel limit in the plan header lowers max parallel
  request-id        print the canonical clientRequestId

Options for add:
  --role <role>               role name, any string (required)
  --status <status>           dispatched, completed, failed, cancelled,
                              interrupted, verified, or rejected (required)
  --plan <slug>               plan id
  --unit <id>                 unit id; dispatched needs --unit or --task-id
  --round <n>                 round number
  --attempt <n>               attempt number within the round
  --task-id <id>              T3 task id
  --client-request-id <id>    clientRequestId used for the dispatch
  --provider <id>             provider instance id
  --model <id>                model id
  --verdict <text>            result verdict
  --note <text>               free-form note

Options for done:
  --verdict <word>            the first word of the result block
  --status <status>           completed (default), failed, cancelled, or interrupted
  --task-id <id>              the T3 task id, recorded on the closing entry
  --note <text>               free-form note

Other options:
  --plan <slug>     with list and stats: only entries for this plan
  --json            with list and stats: print JSON
  -h, --help        print this help
`;

const OPTIONS = {
  role: { type: "string" },
  status: { type: "string" },
  plan: { type: "string" },
  unit: { type: "string" },
  round: { type: "string" },
  attempt: { type: "string" },
  "task-id": { type: "string" },
  "client-request-id": { type: "string" },
  provider: { type: "string" },
  model: { type: "string" },
  verdict: { type: "string" },
  note: { type: "string" },
  json: { type: "boolean" },
} as const;

type Values = ReturnType<typeof parseArgs<typeof OPTIONS>>["values"];

function required(flag: string, value: string | undefined, subcommand: string): string {
  if (value === undefined || value === "") throw usageError(`ledger ${subcommand} needs --${flag}`);
  return value;
}

function onlyFlags(subcommand: string, values: Values, allowed: readonly string[]): void {
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key)) throw usageError(`--${key} does not apply to ledger ${subcommand}`);
  }
}

async function add(ctx: CliContext, root: string, values: Values) {
  onlyFlags("add", values, Object.keys(OPTIONS).filter((key) => key !== "json"));
  const role = required("role", values.role, "add");
  const status = required("status", values.status, "add");
  if (!isLedgerStatus(status)) {
    throw usageError(`invalid --status "${status}"`, `use one of: ${LEDGER_STATUSES.join(", ")}`);
  }
  if (status === "dispatched" && values["task-id"] === undefined && values.unit === undefined) {
    throw usageError("ledger add --status dispatched needs --task-id or --unit");
  }
  if (status === "dispatched" && values["task-id"] === undefined) {
    ctx.stderr("warning: this dispatched entry has no --task-id; result matching needs it\n");
  }
  const optional: Partial<LedgerEntry> = {
    plan: values.plan,
    unit: values.unit,
    round: positiveInt("round", values.round),
    attempt: positiveInt("attempt", values.attempt),
    taskId: values["task-id"],
    clientRequestId: values["client-request-id"],
    provider: values.provider,
    model: values.model,
    verdict: values.verdict,
    note: values.note,
  };
  const entry: LedgerEntry = { ts: ctx.now().toISOString(), role, status };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (entry as unknown as Record<string, unknown>)[key] = value;
  }
  const path = ledgerPath(root);
  const closesOne = isTerminal(status) ? (await readLedger(path)).entries.some((other) => closes(entry, other)) : true;
  await appendLedger(path, entry);
  ctx.stdout(formatJson(entry));
  if (!closesOne) ctx.stderr("omt: no dispatched entry matches; nothing was closed\n");
  return 0;
}

async function load(ctx: CliContext, root: string, plan: string | undefined): Promise<LedgerEntry[]> {
  const { entries, warnings } = await readLedger(ledgerPath(root));
  for (const warning of warnings) ctx.stderr(`warning: ${warning}\n`);
  return plan === undefined ? entries : entries.filter((entry) => entry.plan === plan);
}

function formatLedgerList(entries: LedgerEntry[]): string {
  const rows = entries.map((entry) => [
    entry.ts.slice(11, 19),
    entry.plan ?? "-",
    entry.unit ?? "-",
    entry.role,
    entry.round === undefined ? "-" : String(entry.round),
    entry.status,
    entry.verdict ?? "-",
    entry.taskId === undefined ? "-" : entry.taskId.slice(-12),
  ]);
  return renderTable(["TIME", "PLAN", "UNIT", "ROLE", "ROUND", "STATUS", "VERDICT", "TASK"], rows);
}

function effectiveLimits(limits: Limits, plan: PlanStatus | undefined) {
  const planMaxParallel = plan?.maxParallel;
  return {
    limits: { maxParallel: Math.min(limits.maxParallel, planMaxParallel ?? limits.maxParallel) },
    planMaxParallel,
  };
}

function formatLedgerStats(result: LedgerStats, limits: Limits, profile: string): string {
  const lines = [
    ...(result.plan === undefined ? [] : [`plan: ${result.plan}`]),
    `profile: ${profile}`,
    `dispatched: ${result.dispatched}`,
    `active: ${result.active}`,
    `terminal: ${result.terminal}`,
    result.planMaxParallel === undefined
      ? `max parallel: ${result.limits.maxParallel}`
      : `max parallel: ${result.limits.maxParallel} (plan ${result.planMaxParallel}, config ${limits.maxParallel})`,
    `can dispatch: ${result.canDispatch ? "yes" : "no"}`,
  ];
  return lines.map((line) => `${line}\n`).join("");
}

async function list(ctx: CliContext, root: string, values: Values) {
  onlyFlags("list", values, ["plan", "json"]);
  const entries = await load(ctx, root, values.plan);
  ctx.stdout(values.json ? formatJson(entries) : formatLedgerList(entries));
  return 0;
}

async function stats(ctx: CliContext, root: string, values: Values) {
  onlyFlags("stats", values, ["plan", "json"]);
  const markdown = values.plan === undefined ? undefined : await readFileIfExists(planPath(root, values.plan));
  const plan = markdown === undefined ? undefined : parsePlan(markdown);
  const { config, profile } = await loadEffectiveConfigReporting(ctx, { planProfile: plan?.profile });
  const { limits, planMaxParallel } = effectiveLimits(config.limits, plan);
  const result = ledgerStats(await load(ctx, root, undefined), limits, values.plan);
  if (planMaxParallel !== undefined) result.planMaxParallel = planMaxParallel;
  ctx.stdout(values.json ? formatJson(result) : formatLedgerStats(result, config.limits, profile.name));
  return 0;
}

const DONE_STATUSES = ["completed", "failed", "cancelled", "interrupted"];

// T3 runs the project's settle script in a settled thread's worktree, and a child that shares a linked
// worktree has that worktree, so a run in a linked worktree settles no child.
function settleLine(ctx: CliContext): string {
  const checkout = findCheckoutRoot(ctx.cwd);
  const linked = checkout !== undefined && mainCheckoutOf(checkout) !== undefined;
  return linked ? "settle: no (linked worktree)\n" : "settle: allowed\n";
}

async function done(ctx: CliContext, root: string, values: Values, id: string | undefined) {
  onlyFlags("done", values, ["verdict", "status", "task-id", "note"]);
  if (id === undefined || id === "") throw usageError("ledger done needs a <requestId> or <taskId>");
  const status = values.status ?? "completed";
  if (!DONE_STATUSES.includes(status) || !isLedgerStatus(status)) {
    throw usageError(`invalid --status "${status}"`, `use one of: ${DONE_STATUSES.join(", ")}`);
  }
  const path = ledgerPath(root);
  const { entries } = await readLedger(path);
  const start = openStarts(entries).findLast((entry) => entry.clientRequestId === id || entry.taskId === id);
  if (start === undefined) throw new OmtError("no_open_child", `no open child matches ${id}`);
  const entry: LedgerEntry = { ts: ctx.now().toISOString(), role: start.role, status };
  const fields: Partial<LedgerEntry> = {
    plan: start.plan,
    unit: start.unit,
    round: start.round,
    attempt: start.attempt,
    clientRequestId: start.clientRequestId,
    taskId: values["task-id"] ?? start.taskId ?? (start.clientRequestId === undefined ? id : undefined),
    provider: start.provider,
    model: start.model,
    verdict: values.verdict,
    note: values.note,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (entry as unknown as Record<string, unknown>)[key] = value;
  }
  await appendLedger(path, entry);
  ctx.stdout(`closed ${start.unit ?? "-"} ${start.role} r${start.round ?? 1} a${start.attempt ?? 1}\n${settleLine(ctx)}`);
  return 0;
}

function printRequestId(ctx: CliContext, values: Values) {
  onlyFlags("request-id", values, ["plan", "unit", "role", "round", "attempt"]);
  const id = requestId(
    required("plan", values.plan, "request-id"),
    required("unit", values.unit, "request-id"),
    required("role", values.role, "request-id"),
    positiveInt("round", values.round),
    positiveInt("attempt", values.attempt),
  );
  ctx.stdout(`${id}\n`);
  return 0;
}

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, OPTIONS, { maxPositionals: 2 });
  const [subcommand, id] = positionals;
  if (id !== undefined && subcommand !== "done") throw usageError(`unexpected argument "${id}"`);
  if (values.plan !== undefined) checkPlanSlug(values.plan, "--plan");
  if (values.unit !== undefined) checkUnitId(values.unit);
  const root = findProjectRoot(ctx.cwd);
  switch (subcommand) {
    case "done":
      return done(ctx, root, values, id);
    case "settle-check":
      onlyFlags("settle-check", values, []);
      ctx.stdout(settleLine(ctx));
      return 0;
    case "add":
      return add(ctx, root, values);
    case "list":
      return list(ctx, root, values);
    case "stats":
      return stats(ctx, root, values);
    case "request-id":
      return printRequestId(ctx, values);
    case undefined:
      throw usageError("ledger needs a subcommand: done, settle-check, add, list, stats, or request-id");
    default:
      throw usageError(`unknown ledger subcommand "${subcommand}"`, "use done, settle-check, add, list, stats, or request-id");
  }
};
