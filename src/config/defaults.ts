import type { ConfigLayer, DefaultsChange, OmtConfig } from "../types.ts";
import { isRecord } from "../util/json.ts";
import { defaultsText } from "./defaultsText.ts" with { type: "macro" };
import { parseJsonc } from "./jsonc.ts";

export const RETIRED_BUILD_KEYS: readonly string[] = ["verify", "checkpoint", "stallMinutes"];
export const RETIRED_REVIEW_KEYS: readonly string[] = ["guardrails"];
// workflow.git held the git policy of the retired check, pr, and stack subcommands of omt git.
export const RETIRED_WORKFLOW_GROUPS: readonly string[] = ["git"];
// The ledger's parallel-limit check read maxParallel; T3 now tracks child tasks.
export const RETIRED_LIMIT_KEYS: readonly string[] = ["maxTasksPerRun", "maxParallel"];
export const RETIRED_ROLES: readonly string[] = ["verify", "quick", "deep", "plan", "grill", "guardrail"];
// A selection of a retired profile resolves to normal, which now runs the PR review steps.
export const RETIRED_PROFILES: readonly string[] = ["pr-review"];

// omt update of v0.7.1 rejects defaults without limits.maxParallel, both in `config show --defaults` and in the
// acceptedDefaults snapshot of an install manifest. Every later release drops the retired key with a warning, so it
// has no effect. Remove this once no supported install runs v0.7.1.
export function withUpdaterLimits<T extends { limits: object }>(config: T): T {
  return { ...config, limits: { maxParallel: 6, ...config.limits } };
}

// The values live in defaults.jsonc. test/defaults.test.ts checks that the file is a complete, valid config.
export const DEFAULT_CONFIG: OmtConfig = parseJsonc(defaultsText(), "src/config/defaults.jsonc") as OmtConfig;

function formatChain(chain: unknown[]): string {
  return chain.map((candidate) => {
    if (!isRecord(candidate)) return JSON.stringify(candidate);
    const driver = typeof candidate.driver === "string" ? candidate.driver : candidate.provider;
    const parts = [`${String(driver)}/${String(candidate.model)}`];
    if (typeof candidate.effort === "string") parts.push(candidate.effort);
    if (candidate.fast === true) parts.push("fast");
    if (candidate.fast === "ultra") parts.push("ultrafast");
    return parts.join(" ");
  }).join(", ");
}

export function formatValue(segments: string[], value: unknown): string {
  if (value === undefined) return "none";
  if (segments.at(-1) === "chain" && Array.isArray(value)) return formatChain(value);
  return JSON.stringify(value);
}

function own(record: Record<string, unknown> | undefined, key: string): unknown {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

// Model ids contain dots, so a change keeps its path as segments until it prints.
function collectChanges(from: unknown, to: unknown, segments: string[], out: { segments: string[]; from: unknown; to: unknown }[]): void {
  const a = isRecord(from) ? from : undefined;
  const b = isRecord(to) ? to : undefined;
  if ((a !== undefined || from === undefined) && (b !== undefined || to === undefined) && (a !== undefined || b !== undefined)) {
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      if (segments.length === 0 && key === "defaults") continue;
      collectChanges(own(a, key), own(b, key), [...segments, key], out);
    }
    return;
  }
  if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ segments, from, to });
}

// Arrays are leaves, so a model chain is one change.
export function configLeaves(value: unknown): string[][] {
  const out: string[][] = [];
  const walk = (node: unknown, segments: string[]) => {
    if (!isRecord(node)) {
      if (segments.length > 0) out.push(segments);
      return;
    }
    for (const key of Object.keys(node)) walk(node[key], [...segments, key]);
  };
  walk(value, []);
  return out;
}

// A layer overrides a path when it sets a value at the full path, or null at an ancestor.
export function overrides(layer: unknown, segments: string[]): boolean {
  let value = layer;
  for (const segment of segments) {
    if (value === null) return true;
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return false;
    value = value[segment];
  }
  return value !== undefined;
}

// `overrides` come in precedence order: the user layer first, then the project layer.
export function diffDefaults(
  from: OmtConfig,
  to: OmtConfig,
  overrideLayers: { source: string; layer: ConfigLayer }[],
): DefaultsChange[] {
  const raw: { segments: string[]; from: unknown; to: unknown }[] = [];
  collectChanges(from, to, [], raw);
  return raw.map((change) => {
    const result: DefaultsChange = {
      path: change.segments.join("."),
      from: formatValue(change.segments, change.from),
      to: formatValue(change.segments, change.to),
    };
    for (const { source, layer } of overrideLayers) {
      if (overrides(layer, change.segments)) result.overriddenBy = source;
    }
    return result;
  });
}
