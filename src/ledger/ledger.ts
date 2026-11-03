import { randomUUID } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LedgerEntry, LedgerStats, LedgerStatus, Limits } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { ensureDir, errorCode, openStateFile, readFileIfExists } from "../util/fs.ts";

export const LEDGER_STATUSES: readonly LedgerStatus[] = [
  "dispatched",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "verified",
  "rejected",
];

const TERMINAL: ReadonlySet<LedgerStatus> = new Set<LedgerStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "verified",
  "rejected",
]);

export function isTerminal(status: LedgerStatus): boolean {
  return TERMINAL.has(status);
}

const identity = (entry: LedgerEntry) => JSON.stringify([entry.plan, entry.unit, entry.role, entry.round ?? 1, entry.attempt ?? 1]);

// A terminal entry T closes a dispatched entry D by these rules, in order:
// 1. When both have a clientRequestId, only an equal one closes.
// 2. Otherwise, when T has a taskId, only an equal taskId closes.
// 3. Otherwise, both need a unit, and plan, unit, role, round, and attempt must match.
// `closedBy` indexes the same rules, so `closes` and `ledgerStats` always agree.
export function closes(terminal: LedgerEntry, dispatched: LedgerEntry): boolean {
  if (!TERMINAL.has(terminal.status) || dispatched.status !== "dispatched") return false;
  if (terminal.clientRequestId !== undefined && dispatched.clientRequestId !== undefined) {
    return terminal.clientRequestId === dispatched.clientRequestId;
  }
  if (terminal.taskId !== undefined) return terminal.taskId === dispatched.taskId;
  if (terminal.unit === undefined || dispatched.unit === undefined) return false;
  return identity(terminal) === identity(dispatched);
}

export function closedBy(entries: LedgerEntry[]): (dispatched: LedgerEntry) => boolean {
  const requests = new Set<string>();
  const tasksWithoutRequest = new Set<string>();
  const tasksWithRequest = new Set<string>();
  const identitiesWithoutRequest = new Set<string>();
  const identitiesWithRequest = new Set<string>();
  for (const entry of entries) {
    if (!TERMINAL.has(entry.status)) continue;
    const hasRequest = entry.clientRequestId !== undefined;
    if (entry.clientRequestId !== undefined) requests.add(entry.clientRequestId);
    if (entry.taskId !== undefined) (hasRequest ? tasksWithRequest : tasksWithoutRequest).add(entry.taskId);
    else if (entry.unit !== undefined) (hasRequest ? identitiesWithRequest : identitiesWithoutRequest).add(identity(entry));
  }
  return (dispatched) => {
    if (dispatched.status !== "dispatched") return false;
    const hasRequest = dispatched.clientRequestId !== undefined;
    if (dispatched.clientRequestId !== undefined && requests.has(dispatched.clientRequestId)) return true;
    if (dispatched.taskId !== undefined && (tasksWithoutRequest.has(dispatched.taskId) || (!hasRequest && tasksWithRequest.has(dispatched.taskId)))) {
      return true;
    }
    if (dispatched.unit === undefined) return false;
    const key = identity(dispatched);
    return identitiesWithoutRequest.has(key) || (!hasRequest && identitiesWithRequest.has(key));
  };
}

// The dispatched entries that no terminal entry closes, in file order.
export function openStarts(entries: LedgerEntry[], plan?: string): LedgerEntry[] {
  const selected = plan === undefined ? entries : entries.filter((entry) => entry.plan === plan);
  const closed = closedBy(selected);
  return selected.filter((entry) => entry.status === "dispatched" && !closed(entry));
}

const LOCK_WAIT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function readOwner(lock: string): Promise<{ pid: number; token: string } | undefined> {
  const text = await readFile(lock, "utf8").catch(() => undefined);
  const [pid, token] = (text ?? "").trim().split(" ");
  return pid === undefined || token === undefined || !/^\d+$/.test(pid) ? undefined : { pid: Number(pid), token };
}

// Serializes the read, check, and append of one dispatch, so two briefs cannot both take the last slot.
// A lock counts as stale only when it is old and its process is gone, and an owner removes only its own lock.
export async function withLedgerLock<T>(ledger: string, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const lock = join(dirname(ledger), "locks", "ledger.lock");
  await ensureDir(dirname(lock));
  const token = randomUUID();
  const deadline = now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(`${process.pid} ${token}\n`);
      await handle.close();
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => undefined);
      const owner = await readOwner(lock);
      if (info !== undefined && now() - info.mtimeMs > LOCK_STALE_MS && (owner === undefined || !processAlive(owner.pid))) {
        await unlink(lock).catch(() => undefined);
        continue;
      }
      if (now() >= deadline) {
        throw new OmtError("ledger_busy", `the ledger lock ${lock} is held`, { hint: "run the command again in a moment", exitCode: 75 });
      }
      await new Promise((done) => setTimeout(done, 25));
    }
  }
  try {
    return await fn();
  } finally {
    if ((await readOwner(lock))?.token === token) await unlink(lock).catch(() => undefined);
  }
}

export interface LedgerRead {
  entries: LedgerEntry[];
  warnings: string[];
}

export function isLedgerStatus(value: unknown): value is LedgerStatus {
  return typeof value === "string" && (LEDGER_STATUSES as readonly string[]).includes(value);
}

export async function appendLedger(path: string, entry: LedgerEntry): Promise<void> {
  const file = await openStateFile(dirname(dirname(path)), path);
  try {
    await file.appendFile(`${JSON.stringify(entry)}\n`);
  } finally {
    await file.close();
  }
}

function isEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.ts !== "string" || typeof record.role !== "string" || !isLedgerStatus(record.status)) return false;
  for (const key of ["plan", "unit", "taskId", "clientRequestId", "model", "verdict", "note", "targetKey"]) {
    if (record[key] !== undefined && typeof record[key] !== "string") return false;
  }
  for (const key of ["round", "attempt"]) {
    const number = record[key];
    if (number !== undefined && (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1)) return false;
  }
  return true;
}

export async function readLedger(path: string): Promise<LedgerRead> {
  const text = await readFileIfExists(path);
  const result: LedgerRead = { entries: [], warnings: [] };
  if (text === undefined) return result;
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    if (isEntry(value)) {
      result.entries.push(value);
    } else {
      result.warnings.push(`${path}:${index + 1}: skipped a malformed ledger line`);
    }
  });
  return result;
}

export function ledgerStats(
  entries: LedgerEntry[],
  limits: Pick<Limits, "maxParallel">,
  plan?: string,
): LedgerStats {
  const selected = plan === undefined ? entries : entries.filter((entry) => entry.plan === plan);
  const dispatchedEntries = selected.filter((entry) => entry.status === "dispatched");
  const terminalEntries = selected.filter((entry) => TERMINAL.has(entry.status));
  const dispatched = dispatchedEntries.length;
  const terminal = terminalEntries.length;
  const closed = closedBy(terminalEntries);
  const active = dispatchedEntries.filter((entry) => !closed(entry)).length;
  const stats: LedgerStats = {
    dispatched,
    active,
    terminal,
    limits: { maxParallel: limits.maxParallel },
    canDispatch: active < limits.maxParallel,
  };
  return plan === undefined ? stats : { plan, ...stats };
}

function sanitize(part: string, max: number): string {
  return part.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, max);
}

// Each part is capped so the round and attempt suffix always survives.
export function requestId(plan: string, unit: string, role: string, round = 1, attempt = 1): string {
  return ["omt", sanitize(plan, 64), sanitize(unit, 64), sanitize(role, 32), `r${round}`, `a${attempt}`].join(":");
}
