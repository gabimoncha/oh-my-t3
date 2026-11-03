import { PACKAGE_NAME } from "../brand.ts";
import { updateStatePath } from "../paths.ts";
import type { Env } from "../paths.ts";
import type { CliContext, UpdateMode } from "../types.ts";
import { errorMessage, OmtError } from "../util/errors.ts";
import { readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";

export type LatestResult = { ok: true; version: string } | { ok: false; error: string };

export interface UpdateState {
  checkedAt: string;
  latest?: string;
  error?: string;
  applyAttemptedFor?: string;
}

export interface DailyResult {
  current: string;
  latest?: string;
  outdated: boolean;
  checkedAt: string;
  cached: boolean;
  error?: string;
  mode: "check" | "apply";
  applyAttempted: boolean;
}

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DAILY_TIMEOUT_MS = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;
const VERSION = /^\d+\.\d+\.\d+$/;

function registryOf(env: Env): string {
  const registry = env.npm_config_registry || env.NPM_CONFIG_REGISTRY || DEFAULT_REGISTRY;
  return registry.replace(/\/+$/, "");
}

// Sends no cookie, token, or id, and reads no .npmrc.
export async function fetchLatest(opts: { env: Env; fetch?: typeof fetch; timeoutMs: number }): Promise<LatestResult> {
  const request = opts.fetch ?? fetch;
  const url = `${registryOf(opts.env)}/-/package/${PACKAGE_NAME}/dist-tags`;
  try {
    const response = await request(url, {
      headers: { accept: "application/json" },
      credentials: "omit",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!response.ok) return { ok: false, error: `${url} returned HTTP ${response.status}` };
    const body: unknown = await response.json();
    const latest = isRecord(body) ? body.latest : undefined;
    if (typeof latest !== "string" || !VERSION.test(latest)) {
      return { ok: false, error: `${url} returned no x.y.z latest version` };
    }
    return { ok: true, version: latest };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return { ok: false, error: `${url} did not answer in ${opts.timeoutMs} ms` };
    }
    return { ok: false, error: errorMessage(error) };
  }
}

function parts(version: string): number[] {
  if (!VERSION.test(version)) throw new OmtError("version", `not an x.y.z version: ${version}`);
  return version.split(".").map(Number);
}

export function compareVersions(a: string, b: string): number {
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = left[i]! - right[i]!;
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

function isNewer(latest: string | undefined, current: string): boolean {
  if (latest === undefined || !VERSION.test(latest) || !VERSION.test(current)) return false;
  return compareVersions(latest, current) > 0;
}

async function readState(ctx: CliContext): Promise<UpdateState | undefined> {
  let value: unknown;
  try {
    const text = await readFileIfExists(updateStatePath(ctx.env, ctx.homedir));
    if (text === undefined) return undefined;
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.checkedAt !== "string" || Number.isNaN(Date.parse(value.checkedAt))) return undefined;
  const state: UpdateState = { checkedAt: value.checkedAt };
  if (typeof value.latest === "string") state.latest = value.latest;
  if (typeof value.error === "string") state.error = value.error;
  if (typeof value.applyAttemptedFor === "string") state.applyAttemptedFor = value.applyAttemptedFor;
  return state;
}

async function writeState(ctx: CliContext, state: UpdateState): Promise<void> {
  await writeFileAtomic(updateStatePath(ctx.env, ctx.homedir), `${JSON.stringify(state, null, 2)}\n`);
}

function result(ctx: CliContext, state: UpdateState, mode: "check" | "apply", cached: boolean): DailyResult {
  const daily: DailyResult = {
    current: ctx.version,
    outdated: isNewer(state.latest, ctx.version),
    checkedAt: state.checkedAt,
    cached,
    mode,
    applyAttempted: state.latest !== undefined && state.applyAttemptedFor === state.latest,
  };
  if (state.latest !== undefined) daily.latest = state.latest;
  if (state.error !== undefined) daily.error = state.error;
  return daily;
}

// At most one request a day, and none unless mode is check or apply. Callers pass
// loadConfig(ctx).config.update, which drops the project layer's key, so a cloned
// repository cannot turn on network calls.
export async function dailyCheck(
  ctx: CliContext,
  opts: { mode: UpdateMode | undefined; fetch?: typeof fetch },
): Promise<DailyResult | undefined> {
  const mode = opts.mode;
  if (mode === undefined || mode === "off") return undefined;
  const previous = await readState(ctx);
  const now = ctx.now().getTime();
  if (previous !== undefined) {
    const age = now - Date.parse(previous.checkedAt);
    if (age >= 0 && age < DAY_MS) return result(ctx, previous, mode, true);
  }
  const latest = await fetchLatest({ env: ctx.env, timeoutMs: DAILY_TIMEOUT_MS, ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }) });
  const state: UpdateState = { checkedAt: new Date(now).toISOString() };
  if (latest.ok) state.latest = latest.version;
  else state.error = latest.error;
  if (previous?.applyAttemptedFor !== undefined) state.applyAttemptedFor = previous.applyAttemptedFor;
  try {
    await writeState(ctx, state);
  } catch {
    // The next run fetches again; the result is still valid.
  }
  return result(ctx, state, mode, false);
}

// Stops a second automatic update for the same version.
export async function recordApplyAttempt(ctx: CliContext, latest: string): Promise<void> {
  const state = (await readState(ctx)) ?? { checkedAt: ctx.now().toISOString() };
  state.applyAttemptedFor = latest;
  await writeState(ctx, state);
}
