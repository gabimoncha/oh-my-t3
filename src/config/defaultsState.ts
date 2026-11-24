import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { findProjectRoot, manifestPath, omtDir, projectManifestPath, projectConfigPath, userConfigPath } from "../paths.ts";
import type { CliContext, ConfigLayer, DefaultsChange, OmtConfig } from "../types.ts";
import { projectWriteTarget, writeTargetFor } from "../install/fsops.ts";
import { confirmApply } from "../install/confirm.ts";
import { OmtError } from "../util/errors.ts";
import { lstatIfExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { DEFAULT_CONFIG, diffDefaults, formatValue } from "./defaults.ts";
import { parseJsonc, setJsoncValue } from "./jsonc.ts";
import { retiredKeyPaths, validateLayer, WORKFLOW_RULES } from "./validate.ts";

type Context = Pick<CliContext, "cwd" | "env" | "homedir">;
type Scope = "user" | "project";

function parseManifest(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new OmtError("manifest", `the install manifest ${path} is not valid JSON`, {
      hint: "fix or delete the file, then run the command again",
      cause,
    });
  }
  if (!isRecord(value)) {
    throw new OmtError("manifest", `the install manifest ${path} does not hold a JSON object`, {
      hint: "fix or delete the file, then run the command again",
    });
  }
  return value;
}

export interface DefaultsSnapshot {
  version: 1;
  cliVersion: string;
  config: OmtConfig;
}

export function defaultsSnapshotPath(ctx: Context, scope: Scope): string {
  return scope === "project" ? projectManifestPath(findProjectRoot(ctx.cwd)) : manifestPath(ctx.env, ctx.homedir);
}

// A complete defaults config sets every key that omt reads without a fallback. The accepted snapshot and the
// built-in defaults.jsonc must both be complete.
export function isCompleteDefaults(layer: ConfigLayer): boolean {
  if (layer.version !== 1 || layer.profile === undefined || layer.profiles === undefined || layer.roles === undefined ||
    layer.models === undefined || layer.limits === undefined ||
    layer.limits.maxDepth === undefined || layer.limits.maxReviewRounds === undefined ||
    layer.profiles.normal?.workflow === undefined || !Object.hasOwn(layer.profiles, layer.profile) ||
    layer.profiles[layer.profile] == null) return false;
  const workflow: Record<string, Record<string, unknown> | undefined> = layer.profiles.normal.workflow;
  for (const [group, rules] of Object.entries(WORKFLOW_RULES)) {
    const values = workflow[group];
    if (values == null || Object.keys(rules).some((key) => values[key] === undefined)) return false;
  }
  for (const role of Object.values(layer.roles)) {
    if (role === null || role.description === undefined || role.access === undefined || role.chain === undefined ||
      role.result === undefined || role.t3Role === undefined || role.interactionMode === undefined || role.runtimeMode === undefined) return false;
  }
  return !Object.values(layer.profiles).some((profile) => profile === null || profile.description === undefined);
}

// A snapshot from an older release lacks the workflow keys that a later release added. Each missing key takes
// its current default, so the snapshot stays valid, and the defaults review still lists the key as new.
export function withNewWorkflowKeys<T extends ConfigLayer>(layer: T): T {
  const workflow = layer.profiles?.normal?.workflow;
  if (workflow == null) return layer;
  const defaults: Record<string, Record<string, unknown>> = DEFAULT_CONFIG.profiles.normal?.workflow as unknown as Record<string, Record<string, unknown>>;
  const current: Record<string, Record<string, unknown> | undefined> = workflow as Record<string, Record<string, unknown> | undefined>;
  const filled: Record<string, Record<string, unknown>> = {};
  for (const group of Object.keys(WORKFLOW_RULES)) {
    const values = current[group];
    if (values == null) continue;
    filled[group] = { ...defaults[group], ...values };
  }
  return {
    ...layer,
    profiles: { ...layer.profiles, normal: { ...layer.profiles?.normal, workflow: { ...workflow, ...filled } } },
  } as T;
}

export function parseDefaultsSnapshot(text: string, path: string): DefaultsSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OmtError("defaults_snapshot", `${path} is not valid JSON`, { hint: "restore the file or remove it, then run omt doctor" });
  }
  const raw = isRecord(value) ? value.config : undefined;
  const invalid = () => new OmtError("defaults_snapshot", `${path} does not contain valid accepted defaults`, {
    hint: "restore the file or remove it, then run omt doctor",
  });
  if (!isRecord(value) || value.version !== 1 || typeof value.cliVersion !== "string" || !isRecord(raw) || raw.update !== undefined) throw invalid();
  const { layer, issues } = validateLayer(raw, path);
  if (issues.some((issue) => issue.severity === "error") || !isCompleteDefaults(withNewWorkflowKeys(layer))) throw invalid();
  return { version: 1, cliVersion: value.cliVersion, config: layer as OmtConfig };
}

export async function activeDefaults(ctx: Context): Promise<{ config: OmtConfig; source: string }> {
  for (const scope of ["project", "user"] as const) {
    const path = defaultsSnapshotPath(ctx, scope);
    const text = await readFileIfExists(path);
    if (text !== undefined) {
      const manifest = parseManifest(text, path);
      if (manifest.acceptedDefaults !== undefined) {
        return { config: withNewWorkflowKeys(parseDefaultsSnapshot(JSON.stringify(manifest.acceptedDefaults), path).config), source: path };
      }
    }
  }
  return { config: DEFAULT_CONFIG, source: "current" };
}

export interface DefaultsPlan {
  path: string;
  before: string | undefined;
  changes: DefaultsChange[];
  firstReview: boolean;
  changed: boolean;
  target: OmtConfig;
}

export async function planDefaults(ctx: Context, scope: Scope, target: OmtConfig = DEFAULT_CONFIG): Promise<DefaultsPlan> {
  const path = defaultsSnapshotPath(ctx, scope);
  const before = await readFileIfExists(path);
  const manifest = before === undefined ? undefined : parseManifest(before, path);
  const snapshot = manifest?.acceptedDefaults !== undefined
    ? parseDefaultsSnapshot(JSON.stringify(manifest.acceptedDefaults), path)
    : undefined;
  const layers: { source: string; layer: ConfigLayer }[] = [];
  for (const configPath of [userConfigPath(ctx.env, ctx.homedir), projectConfigPath(findProjectRoot(ctx.cwd))]) {
    const text = await readFileIfExists(configPath);
    if (text === undefined) continue;
    const value = parseJsonc(text, configPath);
    layers.push({ source: configPath, layer: validateLayer(value, configPath).layer });
  }
  const changes = snapshot === undefined ? [] : diffDefaults(snapshot.config, target, layers);
  return {
    path, before, changes, target,
    firstReview: snapshot === undefined,
    changed: before !== undefined && (snapshot === undefined || changes.length > 0),
  };
}

export interface RetiredCleanup {
  configPath: string;
  keys: string[]; // dotted paths of the retired keys in the scope's config
  files: string[]; // files and folders of retired features
}

// The project state of retired features, by name in .omt3, with the note that the cleanup prints.
// omt ledger wrote ledger.jsonl, and omt lock and the ledger wrote their lock files in locks/.
const RETIRED_STATE: Readonly<Record<string, string>> = {
  "guardrails.md": "the empty $; the guardrails step is retired",
  "ledger.jsonl": "$; the ledger is retired",
  locks: "$; omt lock is retired",
};

// Removes what an earlier release left and this release ignores: each retired key of the scope's config, and in a
// project an empty .omt3/guardrails.md, .omt3/ledger.jsonl, and .omt3/locks/. None has an effect, so the cleanup asks
// nothing. A guardrails.md with text stays, because it holds proposals that the user may still want.
export async function cleanRetired(ctx: Context, scope: Scope, options: { dryRun: boolean }): Promise<RetiredCleanup> {
  const root = findProjectRoot(ctx.cwd);
  const configPath = scope === "project" ? projectConfigPath(root) : userConfigPath(ctx.env, ctx.homedir);
  const before = await readFileIfExists(configPath);
  const value = before === undefined ? undefined : parseJsonc(before, configPath);
  const keys = isRecord(value) ? [...new Set(retiredKeyPaths(value))] : [];
  const files: string[] = [];
  if (scope === "project") {
    // Each entry is checked without following a symlink: a link is removed itself, never its target.
    const guardrails = join(omtDir(root), "guardrails.md");
    if ((await lstatIfExists(guardrails))?.isFile() === true && (await readFileIfExists(guardrails))?.trim() === "") files.push(guardrails);
    for (const [name, kind] of [["ledger.jsonl", "file"], ["locks", "dir"]] as const) {
      const path = join(omtDir(root), name);
      const stat = await lstatIfExists(path);
      if (stat !== undefined && (stat.isSymbolicLink() || (kind === "file" ? stat.isFile() : stat.isDirectory()))) files.push(path);
    }
  }
  if (options.dryRun) return { configPath, keys, files };
  if (before !== undefined && keys.length > 0) {
    const after = keys.reduce((text, key) => setJsoncValue(text, key.split("."), undefined), before);
    await writeFileAtomic(scope === "project" ? await projectWriteTarget(root, configPath) : await writeTargetFor(configPath), after);
  }
  for (const file of files) await rm(join(await projectWriteTarget(root, dirname(file)), basename(file)), { recursive: true, force: true });
  return { configPath, keys, files };
}

export function formatRetiredCleanup(cleanup: RetiredCleanup, dryRun: boolean): string {
  const verb = dryRun ? "would remove" : "removed";
  let text = "";
  if (cleanup.keys.length > 0) text += `${verb} the retired keys from ${cleanup.configPath}: ${cleanup.keys.join(", ")}\n`;
  for (const file of cleanup.files) text += `${verb} ${(RETIRED_STATE[basename(file)] ?? "$").replace("$", file)}\n`;
  return text;
}

export function formatDefaultsPlan(plan: DefaultsPlan): string {
  if (!plan.changed) return "defaults: current\n";
  let text = "Default settings update:\n";
  if (plan.firstReview) {
    text += "  No previous defaults snapshot is available. Current role choices:\n";
    for (const [name, role] of Object.entries(plan.target.roles)) text += `  ${name}: ${formatValue(["chain"], role.chain)}\n`;
  }
  for (const change of plan.changes) {
    const overridden = change.overriddenBy === undefined ? "" : ` (overridden by ${change.overriddenBy})`;
    text += `  ${change.path}: ${change.from} -> ${change.to}${overridden}\n`;
  }
  return text;
}

export async function applyDefaults(ctx: CliContext, scope: Scope, plan: DefaultsPlan): Promise<void> {
  if ((await readFileIfExists(plan.path)) !== plan.before) {
    throw new OmtError("defaults_changed", "the defaults changed while confirmation was open; nothing was written", { hint: "run the command again" });
  }
  const root = findProjectRoot(ctx.cwd);
  const target = scope === "project" ? await projectWriteTarget(root, plan.path) : await writeTargetFor(plan.path);
  const snapshot: DefaultsSnapshot = { version: 1, cliVersion: ctx.version, config: plan.target };
  const manifest = JSON.parse(plan.before ?? "null") as unknown;
  if (!isRecord(manifest)) throw new OmtError("defaults_install", "install omt before accepting defaults", { hint: "run omt install" });
  await writeFileAtomic(target, `${JSON.stringify({ ...manifest, acceptedDefaults: snapshot }, null, 2)}\n`);
}

export async function reviewDefaults(
  ctx: CliContext,
  scope: Scope,
  options: { yes: boolean; dryRun: boolean; json: boolean },
  target: OmtConfig = DEFAULT_CONFIG,
): Promise<{ changed: boolean; applied: boolean; changes: DefaultsChange[] }> {
  const say = options.json ? ctx.stderr : ctx.stdout;
  say(formatRetiredCleanup(await cleanRetired(ctx, scope, { dryRun: options.dryRun }), options.dryRun));
  const plan = await planDefaults(ctx, scope, target);
  const result = { changed: plan.changed, applied: false, changes: plan.changes };
  if (!plan.changed) return result;
  say(formatDefaultsPlan(plan));
  if (options.dryRun) {
    say("Dry run: nothing was written.\n");
    return result;
  }
  if ((options.json && !options.yes) || (!ctx.isTTY && !options.yes)) {
    say("Run omt doctor --yes after reviewing the changes to apply them.\n");
    return result;
  }
  if (!options.yes && !(await confirmApply({ ...ctx, prompt: () => ctx.prompt("Use the current defaults? [y/N] ") }, false))) return result;
  await applyDefaults(ctx, scope, plan);
  result.applied = true;
  say("Default settings updated. User overrides are unchanged.\n");
  return result;
}
