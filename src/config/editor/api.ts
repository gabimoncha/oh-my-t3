import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { readConfigTarget, writeConfigTarget } from "../target.ts";
import type { ConfigTarget } from "../target.ts";
import { findProjectRoot, projectConfigPath, userConfigPath } from "../../paths.ts";
import { EFFORT_LADDER } from "../../types.ts";
import type { Capabilities, CliContext, ConfigIssue, OmtConfig, ProfileConfig } from "../../types.ts";
import { OmtError } from "../../util/errors.ts";
import { readFileIfExists } from "../../util/fs.ts";
import { isRecord } from "../../util/json.ts";
import { plural } from "../../util/output.ts";
import { configLeaves, DEFAULT_CONFIG } from "../defaults.ts";
import { activeDefaults, isCompleteDefaults } from "../defaultsState.ts";
import { explainConfig } from "../explain.ts";
import type { ExplainEntry, ExplainReport, ExplainSource } from "../explain.ts";
import { parseJsonc, setJsoncValue } from "../jsonc.ts";
import { layerFromText, mergeConfigLayers } from "../load.ts";
import type { ConfigFileLayer, MergeStep } from "../load.ts";
import {
  ACCESS_VALUES,
  CHAIN_MAX,
  CHAIN_MIN,
  DESCRIPTION_MAX,
  HARNESSES_MAX,
  HARNESSES_MIN,
  INTERACTION_MODE_VALUES,
  LIMIT_KEYS,
  LIMIT_RANGES,
  MODEL_KEYS,
  MODEL_MAX,
  PRESET_PROFILE_NAMES,
  PROFILE_CHAIN_MAX,
  PROFILE_KEYS,
  PROVIDER_PATTERN,
  RESULT_VALUES,
  ROLE_KEYS,
  ROLE_NAME_PATTERN,
  ROOT_KEYS,
  RUNG_KEYS,
  RUNTIME_MODE_VALUES,
  T3_ROLE_VALUES,
  WORKFLOW_RULES,
} from "../validate.ts";
import { bundledSkillNames, editorCatalog } from "./catalog.ts";
import type { Catalog } from "./catalog.ts";
import { lineDiff } from "./diff.ts";
import type { DiffLine } from "./diff.ts";

type FileKind = "user" | "project";

// Maintainer mode, which `bun run defaults:edit` starts in an omt clone: the editor saves the built-in defaults in
// defaultsPath, on an empty base, and the skill files under skillsRoot. The page shows the one file as "user".
export interface MaintainerTarget {
  defaultsPath: string;
  skillsRoot: string;
}

const EMPTY_BASE = {
  config: { version: 1, profile: "normal", profiles: {}, models: {}, roles: {}, limits: {} } as unknown as OmtConfig,
  source: "none",
};

// An expected failure of an editor request. The server sends it as { ok: false, code, message, hint?, newErrors? }.
export class EditorError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint: string | undefined;
  readonly newErrors: ConfigIssue[] | undefined;

  constructor(status: number, code: string, message: string, options: { hint?: string; newErrors?: ConfigIssue[] } = {}) {
    super(message);
    this.name = "EditorError";
    this.status = status;
    this.code = code;
    this.hint = options.hint;
    this.newErrors = options.newErrors;
  }
}

// The keys, values, and ranges that validateLayer accepts, so that the page offers the same choices.
const VOCAB = {
  rootKeys: ROOT_KEYS,
  roleKeys: ROLE_KEYS,
  rungKeys: RUNG_KEYS,
  limitKeys: LIMIT_KEYS,
  profileKeys: PROFILE_KEYS,
  modelKeys: MODEL_KEYS,
  presetProfiles: PRESET_PROFILE_NAMES,
  profileChainMax: PROFILE_CHAIN_MAX,
  workflow: WORKFLOW_RULES,
  access: ACCESS_VALUES,
  result: RESULT_VALUES,
  t3Role: T3_ROLE_VALUES,
  interactionMode: INTERACTION_MODE_VALUES,
  runtimeMode: RUNTIME_MODE_VALUES,
  effort: EFFORT_LADDER,
  limitRanges: LIMIT_RANGES,
  roleNamePattern: ROLE_NAME_PATTERN,
  providerPattern: PROVIDER_PATTERN,
  descriptionMax: DESCRIPTION_MAX,
  modelMax: MODEL_MAX,
  chainMin: CHAIN_MIN,
  chainMax: CHAIN_MAX,
  harnessesMin: HARNESSES_MIN,
  harnessesMax: HARNESSES_MAX,
};

export interface EditorFile {
  kind: FileKind;
  path: string;
  present: boolean;
  hash: string | null; // SHA-256 hex of the text
  text: string | null;
  issues: ConfigIssue[]; // parse and validation issues of this file
}

export interface EditorState {
  version: string;
  mode: "config" | "defaults";
  defaults: { source: string };
  files: EditorFile[];
  profiles: string[];
  selectedProfile: string;
  issues: ConfigIssue[];
  explain: ExplainReport; // no effective entries when neither the selected profile nor normal resolves; the issues say why
  vocab: typeof VOCAB;
  catalog: Catalog;
  skills: string[]; // the bundled skills, by folder name
}

export interface EditRequest {
  file: FileKind;
  base: string; // the hash of the file text that the edits were made on
  edits: { path: string[]; value: unknown }[]; // value undefined removes the key
}

export interface PreviewResult {
  text: string;
  diff: DiffLine[];
  issues: ConfigIssue[];
  newErrors: ConfigIssue[];
}

const MAX_EDITS = 200;
const EDITABLE_ROOT_KEYS = ROOT_KEYS.filter((key) => key !== "$schema" && key !== "version");

export function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function configFiles(ctx: CliContext, maintainer?: MaintainerTarget): { kind: FileKind; path: string }[] {
  if (maintainer !== undefined) return [{ kind: "user", path: maintainer.defaultsPath }];
  return [
    { kind: "user", path: userConfigPath(ctx.env, ctx.homedir) },
    { kind: "project", path: projectConfigPath(findProjectRoot(ctx.cwd)) },
  ];
}

function baseDefaults(ctx: CliContext, maintainer?: MaintainerTarget) {
  return maintainer === undefined ? activeDefaults(ctx) : Promise.resolve(EMPTY_BASE);
}

async function readLayers(ctx: CliContext, maintainer?: MaintainerTarget) {
  const files = await Promise.all(configFiles(ctx, maintainer).map(async (file) => ({ ...file, text: await readFileIfExists(file.path) })));
  const layers = files.map((file) => layerFromText(file.kind, file.path, file.text));
  return { files, layers, loaded: mergeConfigLayers(layers, await baseDefaults(ctx, maintainer)) };
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

// The root entry of profiles.<name>.extends, with the rules of explainConfig for a key that no layer fills in.
function extendsEntry(steps: MergeStep[], path: string[]): ExplainEntry {
  const holder = path.slice(0, 2);
  const source = (step: MergeStep): ExplainSource =>
    step.kind === "defaults" || step.path === undefined ? { kind: "defaults" } : { kind: step.kind, path: step.path };
  const touches = steps.map((step, index) => {
    if (index === 0) return undefined;
    if (valueAt(step.layer, path) !== undefined && valueAt(step.config, path) !== undefined) return "set";
    const before = steps[index - 1] as MergeStep;
    return valueAt(before.config, holder) !== undefined && valueAt(step.config, holder) === undefined ? "remove" : undefined;
  });
  const winner = Math.max(0, touches.lastIndexOf("set"));
  const overridden: ExplainEntry["overridden"] = [];
  for (let index = winner - 1; index >= 1; index--) {
    const touch = touches[index];
    const step = steps[index] as MergeStep;
    if (touch !== undefined) overridden.push({ source: source(step), value: touch === "remove" ? null : valueAt(step.config, path) });
  }
  const baseValue = valueAt((steps[0] as MergeStep).config, path);
  if (winner !== 0 && baseValue !== undefined) overridden.push({ source: source(steps[0] as MergeStep), value: baseValue });
  return { path, value: valueAt((steps.at(-1) as MergeStep).config, path), source: source(steps[winner] as MergeStep), overridden };
}

// The report of the selected profile. When the selection or its chain is broken, the report of normal. When normal
// is broken too, the root entries and the removed objects with no effective entries: explainConfig runs on the
// config without any extends key, so that the chain resolves, and the extends entries are added back.
function explainSelected(layers: ConfigFileLayer[], loaded: ReturnType<typeof mergeConfigLayers>): ExplainReport {
  for (const profile of [undefined, "normal"]) {
    try {
      return explainConfig(layers, loaded, profile);
    } catch (error) {
      if (!(error instanceof OmtError)) throw error;
    }
  }
  const config = loaded.config;
  const profiles: OmtConfig["profiles"] = { normal: {} as ProfileConfig };
  for (const [name, profile] of Object.entries(config.profiles)) {
    const { extends: _extends, ...rest } = profile;
    profiles[name] = rest;
  }
  const report = explainConfig(layers, { ...loaded, config: { ...config, profiles } }, "normal");
  const entries = new Map(report.root.map((entry) => [JSON.stringify(entry.path), entry]));
  const root = configLeaves(config).map((path) =>
    entries.get(JSON.stringify(path)) ?? extendsEntry(loaded.steps, path));
  const source = config.profile !== DEFAULT_CONFIG.profile ? "config" : "default";
  return { ...report, profile: { name: config.profile, source }, root, effective: [] };
}

export async function editorState(ctx: CliContext, capabilities?: Capabilities, maintainer?: MaintainerTarget): Promise<EditorState> {
  const { files, layers, loaded } = await readLayers(ctx, maintainer);
  return {
    version: ctx.version,
    mode: maintainer === undefined ? "config" : "defaults",
    defaults: {
      source: loaded.defaultsSource,
    },
    files: [
      ...files.map((file, index) => ({
        kind: file.kind,
        path: file.path,
        present: file.text !== undefined,
        hash: file.text === undefined ? null : textHash(file.text),
        text: file.text ?? null,
        issues: (layers[index] as ConfigFileLayer).issues,
      })),
      // The page expects both files, so maintainer mode sends the project file as absent.
      ...(maintainer === undefined ? [] : [{ kind: "project" as const, path: "", present: false, hash: null, text: null, issues: [] }]),
    ],
    profiles: Object.keys(loaded.config.profiles),
    selectedProfile: loaded.config.profile,
    issues: loaded.issues,
    explain: explainSelected(layers, loaded),
    vocab: VOCAB,
    catalog: await editorCatalog(ctx, loaded.config, capabilities),
    skills: await bundledSkillNames(maintainer === undefined ? ctx.packageRoot : dirname(maintainer.skillsRoot)),
  };
}

export async function explainProfile(ctx: CliContext, name: string | null, maintainer?: MaintainerTarget): Promise<ExplainReport> {
  if (name === null || name === "") throw new EditorError(400, "bad_request", "api/explain needs ?profile=<name>");
  const { layers, loaded } = await readLayers(ctx, maintainer);
  const known = Object.keys(loaded.config.profiles);
  if (!known.includes(name)) {
    throw new EditorError(400, "unknown_profile", `unknown profile "${name}"`, { hint: `known profiles: ${known.join(", ")}` });
  }
  try {
    return explainConfig(layers, loaded, name);
  } catch (error) {
    if (error instanceof OmtError) throw new EditorError(422, "profile_invalid", error.message);
    throw error;
  }
}

function badRequest(message: string): EditorError {
  return new EditorError(400, "bad_request", message);
}

function parseEdit(edit: unknown, index: number): EditRequest["edits"][number] {
  const where = `edits[${index}]`;
  if (!isRecord(edit)) throw badRequest(`${where} must be an object`);
  const { path } = edit;
  const segment = (value: unknown): value is string => typeof value === "string" && value !== "";
  if (!Array.isArray(path) || path.length === 0 || !path.every(segment)) {
    throw badRequest(`${where}.path must be a non-empty array of non-empty strings`);
  }
  if (!EDITABLE_ROOT_KEYS.includes(path[0] as string)) {
    throw badRequest(`${where}.path must start with one of: ${EDITABLE_ROOT_KEYS.join(", ")}`);
  }
  const remove = Object.hasOwn(edit, "remove");
  if (remove === Object.hasOwn(edit, "value") || (remove && edit.remove !== true)) {
    throw badRequest(`${where} needs either a value or remove: true`);
  }
  return { path: [...path], value: remove ? undefined : edit.value };
}

export function parseEditRequest(body: string): EditRequest {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw badRequest("the request body is not valid JSON");
  }
  if (!isRecord(value)) throw badRequest("the request body must be a JSON object");
  const { file, base, edits } = value;
  if (file !== "user" && file !== "project") throw badRequest('file must be "user" or "project"');
  if (typeof base !== "string") throw badRequest("base must be the hash of the file text");
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > MAX_EDITS) {
    throw badRequest(`edits must be an array of 1 to ${MAX_EDITS} edits`);
  }
  return { file, base, edits: edits.map(parseEdit) };
}

function changed(path: string): EditorError {
  return new EditorError(409, "config_changed", `${path} changed since the editor loaded it; nothing was written`, {
    hint: "reload the page",
  });
}

function issueKey(issue: ConfigIssue): string {
  return JSON.stringify([issue.source, issue.path, issue.message]);
}

// Applies the edits to the text read in this call and checks the result together with the other file.
async function prepare(ctx: CliContext, request: EditRequest, maintainer?: MaintainerTarget) {
  const files = configFiles(ctx, maintainer);
  const file = files.find((entry) => entry.kind === request.file);
  if (file === undefined) throw badRequest(`the editor edits only the ${files.map((entry) => entry.kind).join(" and ")} file here`);
  const target: ConfigTarget = { scope: request.file, path: file.path };
  let snapshot: string;
  try {
    snapshot = await readConfigTarget(target);
  } catch (error) {
    if (error instanceof OmtError && error.code === "config_not_found") {
      throw new EditorError(404, error.code, error.message, error.hint === undefined ? {} : { hint: error.hint });
    }
    throw error;
  }
  if (textHash(snapshot) !== request.base) throw changed(file.path);
  let next = snapshot;
  try {
    parseJsonc(snapshot, file.path);
    for (const edit of request.edits) next = setJsoncValue(next, edit.path, edit.value);
  } catch (error) {
    if (error instanceof OmtError && (error.code === "jsonc_parse" || error.code === "jsonc_edit")) {
      throw new EditorError(422, error.code, error.message);
    }
    throw error;
  }
  const other = files.find((entry) => entry.kind !== request.file);
  const otherText = other === undefined ? undefined : await readFileIfExists(other.path);
  const layersWith = (text: string) =>
    files.map((entry) => layerFromText(entry.kind, entry.path, entry.kind === request.file ? text : otherText));
  const base = await baseDefaults(ctx, maintainer);
  const current = mergeConfigLayers(layersWith(snapshot), base);
  const candidateLayers = layersWith(next);
  const candidate = mergeConfigLayers(candidateLayers, base);
  if (maintainer !== undefined && !isCompleteDefaults((candidateLayers[0] as ConfigFileLayer).layer)) {
    candidate.issues.push({
      severity: "error",
      source: file.path,
      path: "",
      message: "the built-in defaults must keep version, profile, the normal workflow, every limit, and each role's and profile's required keys",
    });
  }
  const known = new Set(current.issues.map(issueKey));
  const newErrors = candidate.issues.filter((issue) => issue.severity === "error" && !known.has(issueKey(issue)));
  return { target, snapshot, next, current, candidate, candidateLayers, newErrors };
}

export async function previewEdits(ctx: CliContext, request: EditRequest, maintainer?: MaintainerTarget): Promise<PreviewResult> {
  const prepared = await prepare(ctx, request, maintainer);
  const result: PreviewResult = {
    text: prepared.next,
    diff: lineDiff(prepared.snapshot, prepared.next),
    issues: prepared.candidate.issues,
    newErrors: prepared.newErrors,
  };
  return result;
}

export async function writeEdits(
  ctx: CliContext,
  request: EditRequest,
  capabilities?: Capabilities,
  maintainer?: MaintainerTarget,
): Promise<{ ok: true; state: EditorState }> {
  const prepared = await prepare(ctx, request, maintainer);
  if (prepared.newErrors.length > 0) {
    const count = plural(prepared.newErrors.length, "config error");
    throw new EditorError(422, "config_invalid", `the change adds ${count}; nothing was written`, { newErrors: prepared.newErrors });
  }
  if (prepared.next !== prepared.snapshot) {
    try {
      await writeConfigTarget(prepared.target, prepared.snapshot, prepared.next);
    } catch (error) {
      if (error instanceof OmtError && error.code === "config_changed") throw changed(prepared.target.path);
      throw error;
    }
  }
  return { ok: true, state: await editorState(ctx, capabilities, maintainer) };
}
