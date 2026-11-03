import { EFFORT_LADDER, RESULT_KINDS } from "../types.ts";
import type {
  ConfigIssue,
  ConfigLayer,
  Effort,
  Limits,
  ModelConfig,
  OmtConfig,
  OptionValue,
  ProfileConfig,
  RoleConfig,
  Rung,
  UpdateMode,
  Workflow,
  WorkflowLayer,
} from "../types.ts";
import { usageError } from "../util/errors.ts";
import { RETIRED_BUILD_KEYS, RETIRED_LIMIT_KEYS, RETIRED_PROFILES, RETIRED_ROLES } from "./defaults.ts";
import { isRecord } from "../util/json.ts";

export const ROOT_KEYS: readonly string[] = ["$schema", "version", "profile", "profiles", "models", "roles", "limits", "harnesses", "update"];
// Keys of older releases: a layer that still has one loads, with a warning.
export const RETIRED_ROOT_KEYS: readonly string[] = ["visuals", "defaults"];
export const UPDATE_VALUES: readonly UpdateMode[] = ["off", "check", "apply"];
export const ROLE_KEYS: readonly string[] = [
  "description",
  "access",
  "result",
  "t3Role",
  "interactionMode",
  "runtimeMode",
  "crossFamily",
  "fast",
  "chain",
];
export const RUNG_KEYS: readonly string[] = ["provider", "driver", "model", "effort", "fast", "options"];
export const LIMIT_KEYS: readonly string[] = ["maxParallel", "maxDepth", "maxReviewRounds"];
export const PROFILE_KEYS: readonly string[] = ["description", "extends", "workflow", "limits", "roles", "models"];
export const MODEL_KEYS: readonly string[] = ["fast"];
export const PRESET_PROFILE_NAMES: readonly string[] = ["normal", "prototype"];
export const RETIRED_PROFILE_FALLBACK = "normal";
export const PROFILE_CHAIN_MAX = 8;

type WorkflowRule = { values: readonly string[] } | { minimum: number; maximum: number; auto?: boolean } | { items: readonly string[] } | { strings: string };

// A selection of a retired profile gets this warning and resolves to RETIRED_PROFILE_FALLBACK.
export function retiredProfileIssue(name: string, source: string, path: string): ConfigIssue | undefined {
  if (!RETIRED_PROFILES.includes(name)) return undefined;
  return { source, path, message: `profile "${name}" is no longer used; ${RETIRED_PROFILE_FALLBACK} runs the PR steps`, severity: "warning" };
}

export const GIT_OWNER_PATTERN = "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$";

export const WORKFLOW_RULES = {
  plan: {
    review: { values: ["two-families", "one", "owner"] },
    testLayers: { items: ["e2e", "integration", "unit"] },
  },
  design: { variants: { minimum: 1, maximum: 5 } },
  build: {
    review: { values: ["every-round", "first-round", "off"] },
    qa: { values: ["planned", "off"] },
    failureProofs: { values: ["on", "off"] },
    oracle: { values: ["heavy", "always", "off"] },
  },
  review: {
    reviewers: { minimum: 1, maximum: 4, auto: true },
    families: { values: ["one", "both"] },
    oracle: { values: ["on", "off"] },
    fixLoop: { values: ["offer", "off"] },
    ci: { values: ["off", "check", "fix"] },
    verify: { values: ["off", "changed-flows"] },
    tests: { values: ["off", "offer"] },
    guardrails: { values: ["off", "propose"] },
    crap: { values: ["off", "report"] },
  },
  git: {
    branchCommits: { values: ["auto", "ask"] },
    pullRequests: { values: ["auto", "ask", "off"] },
    defaultBranch: { values: ["ask", "auto"] },
    merge: { values: ["ask", "auto"] },
    owners: { strings: GIT_OWNER_PATTERN },
    maxPrFiles: { minimum: 0, maximum: 10000 },
  },
} as const satisfies Record<keyof Workflow, Record<string, WorkflowRule>>;

export const ACCESS_VALUES: readonly string[] = ["read-only", "edit"];
export const RESULT_VALUES: readonly string[] = RESULT_KINDS;
export const T3_ROLE_VALUES: readonly string[] = ["implementation", "research", "review", "design", "test", "general"];
export const INTERACTION_MODE_VALUES: readonly string[] = ["inherit", "default", "plan"];
export const RUNTIME_MODE_VALUES: readonly string[] = [
  "inherit",
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
];

export const ROLE_NAME_PATTERN = "^[a-z][a-z0-9-]{0,31}$";
export const PROVIDER_PATTERN = "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$";
export const DESCRIPTION_MAX = 300;
export const MODEL_MAX = 200;
export const CHAIN_MIN = 1;
export const CHAIN_MAX = 10;
export const HARNESSES_MIN = 1;
export const HARNESSES_MAX = 10;
export const LIMIT_RANGES: Readonly<Record<keyof Limits, readonly [number, number]>> = {
  maxParallel: [1, 32],
  maxDepth: [0, 3],
  maxReviewRounds: [1, 10],
};

export function parseLimit(value: string, key: keyof Limits): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const [min, max] = LIMIT_RANGES[key];
  const number = Number(value);
  return number >= min && number <= max ? number : undefined;
}

export function limitArg(flag: string, value: string, key: keyof Limits): number {
  const number = parseLimit(value, key);
  const [min, max] = LIMIT_RANGES[key];
  if (number === undefined) throw usageError(`${flag} must be an integer from ${min} to ${max}, got "${value}"`);
  return number;
}

const ROLE_NAME_RE = new RegExp(ROLE_NAME_PATTERN);
const PROVIDER_RE = new RegExp(PROVIDER_PATTERN);

const ENUM_KEYS: Readonly<Record<string, readonly string[]>> = {
  access: ACCESS_VALUES,
  result: RESULT_VALUES,
  t3Role: T3_ROLE_VALUES,
  interactionMode: INTERACTION_MODE_VALUES,
  runtimeMode: RUNTIME_MODE_VALUES,
};

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object") return "an object";
  return String(value);
}

function oneOf(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

function codePointLength(value: string): number {
  return [...value].length;
}

class Collector {
  readonly issues: ConfigIssue[] = [];
  readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  error(path: string, message: string): void {
    this.issues.push({ source: this.source, path, message, severity: "error" });
  }

  retiredProfile(name: string, path: string): boolean {
    const issue = retiredProfileIssue(name, this.source, path);
    if (issue !== undefined) this.issues.push(issue);
    return issue !== undefined;
  }

  retired(path: string): void {
    this.issues.push({ source: this.source, path, message: `${path} is no longer used; remove it`, severity: "warning" });
  }
}

function validateRung(value: unknown, path: string, out: Collector): Rung | undefined {
  if (!isRecord(value)) {
    out.error(path, `a rung must be an object, got ${describe(value)}`);
    return undefined;
  }
  const before = out.issues.length;
  const rung: Partial<Rung> = {};
  for (const [key, item] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (!RUNG_KEYS.includes(key)) {
      out.error(keyPath, `unknown rung key "${key}"; allowed keys: ${RUNG_KEYS.join(", ")}`);
    } else if (key === "provider" || key === "driver") {
      if (typeof item === "string" && PROVIDER_RE.test(item)) rung[key] = item;
      else out.error(keyPath, `must be a string that matches ${PROVIDER_PATTERN}, got ${describe(item)}`);
    } else if (key === "model") {
      if (typeof item === "string" && item.length > 0 && codePointLength(item) <= MODEL_MAX) rung.model = item;
      else out.error(keyPath, `must be a non-empty string of at most ${MODEL_MAX} characters`);
    } else if (key === "effort") {
      if (typeof item === "string" && (EFFORT_LADDER as readonly string[]).includes(item)) rung.effort = item as Effort;
      else out.error(keyPath, `must be one of ${oneOf(EFFORT_LADDER)}, got ${describe(item)}`);
    } else if (key === "fast") {
      if (typeof item === "boolean") rung.fast = item;
      else out.error(keyPath, `must be a boolean, got ${describe(item)}`);
    } else if (key === "options") {
      if (!isRecord(item)) {
        out.error(keyPath, `must be an object, got ${describe(item)}`);
        continue;
      }
      const options: Record<string, OptionValue> = {};
      for (const [id, option] of Object.entries(item)) {
        if (typeof option === "string" || typeof option === "boolean") options[id] = option;
        else out.error(`${keyPath}.${id}`, `an option value must be a string or a boolean, got ${describe(option)}`);
      }
      rung.options = options;
    }
  }
  if (!("model" in value)) out.error(`${path}.model`, "a rung needs a model");
  if (!("provider" in value) && !("driver" in value)) out.error(path, "a rung needs a provider or a driver");
  return out.issues.length === before ? (rung as Rung) : undefined;
}

function validateRole(value: unknown, path: string, out: Collector): Partial<RoleConfig> | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) {
    out.error(path, `a role must be an object or null, got ${describe(value)}`);
    return undefined;
  }
  const before = out.issues.length;
  const role: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    const allowed = ENUM_KEYS[key];
    if (!ROLE_KEYS.includes(key)) {
      out.error(keyPath, `unknown role key "${key}"; allowed keys: ${ROLE_KEYS.join(", ")}`);
    } else if (allowed !== undefined) {
      if (typeof item === "string" && allowed.includes(item)) role[key] = item;
      else out.error(keyPath, `must be one of ${oneOf(allowed)}, got ${describe(item)}`);
    } else if (key === "description") {
      if (typeof item === "string" && item.length > 0 && codePointLength(item) <= DESCRIPTION_MAX) role[key] = item;
      else out.error(keyPath, `must be a non-empty string of at most ${DESCRIPTION_MAX} characters`);
    } else if (key === "crossFamily" || key === "fast") {
      if (typeof item === "boolean") role[key] = item;
      else out.error(keyPath, `must be a boolean, got ${describe(item)}`);
    } else if (key === "chain") {
      if (!Array.isArray(item) || item.length < CHAIN_MIN || item.length > CHAIN_MAX) {
        out.error(keyPath, `must be an array of ${CHAIN_MIN} to ${CHAIN_MAX} rungs`);
        continue;
      }
      role[key] = item.map((rung, index) => validateRung(rung, `${keyPath}[${index}]`, out));
    }
  }
  return out.issues.length === before ? (role as Partial<RoleConfig>) : undefined;
}

function validateLimits(value: unknown, path: string, out: Collector): Partial<Limits> | undefined {
  if (!isRecord(value)) {
    out.error(path, `must be an object, got ${describe(value)}`);
    return undefined;
  }
  const limits: Partial<Limits> = {};
  for (const [key, item] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (RETIRED_LIMIT_KEYS.includes(key)) {
      out.retired(keyPath);
      continue;
    }
    if (!LIMIT_KEYS.includes(key)) {
      out.error(keyPath, `unknown limit "${key}"; allowed keys: ${LIMIT_KEYS.join(", ")}`);
      continue;
    }
    const [min, max] = LIMIT_RANGES[key as keyof Limits];
    if (typeof item === "number" && Number.isInteger(item) && item >= min && item <= max) {
      limits[key as keyof Limits] = item;
    } else {
      out.error(keyPath, `must be an integer from ${min} to ${max}, got ${describe(item)}`);
    }
  }
  return limits;
}

function validateRoles(value: unknown, path: string, out: Collector): ConfigLayer["roles"] {
  if (!isRecord(value)) {
    out.error(path, `must be an object, got ${describe(value)}`);
    return undefined;
  }
  const roles: NonNullable<ConfigLayer["roles"]> = {};
  for (const [name, item] of Object.entries(value)) {
    const keyPath = `${path}.${name}`;
    if (!ROLE_NAME_RE.test(name)) {
      out.error(keyPath, `role name "${name}" must match ${ROLE_NAME_PATTERN}`);
      continue;
    }
    if (RETIRED_ROLES.includes(name)) {
      out.retired(keyPath);
      continue;
    }
    if (name === "test") {
      out.issues.push({
        source: out.source,
        path: keyPath,
        message: 'role "test" was renamed to "qa"; rename it',
        severity: "warning",
      });
    }
    const role = validateRole(item, keyPath, out);
    if (role !== undefined) roles[name] = role;
  }
  return roles;
}

function validateModels(value: unknown, path: string, out: Collector): Record<string, ModelConfig> | undefined {
  if (!isRecord(value)) {
    out.error(path, `must be an object, got ${describe(value)}`);
    return undefined;
  }
  const models: Record<string, ModelConfig> = {};
  for (const [name, item] of Object.entries(value)) {
    const keyPath = `${path}.${name}`;
    if (name.length === 0 || codePointLength(name) > MODEL_MAX) {
      out.error(keyPath, `model id must be a non-empty string of at most ${MODEL_MAX} characters`);
      continue;
    }
    if (!isRecord(item)) {
      out.error(keyPath, `must be an object, got ${describe(item)}`);
      continue;
    }
    const model: ModelConfig = {};
    for (const [key, field] of Object.entries(item)) {
      if (!MODEL_KEYS.includes(key)) {
        out.error(`${keyPath}.${key}`, `unknown model key "${key}"; allowed keys: ${MODEL_KEYS.join(", ")}`);
      } else if (typeof field === "boolean") {
        model.fast = field;
      } else {
        out.error(`${keyPath}.${key}`, `must be a boolean, got ${describe(field)}`);
      }
    }
    models[name] = model;
  }
  return models;
}

function validateWorkflow(value: unknown, path: string, out: Collector): WorkflowLayer | undefined {
  if (!isRecord(value)) {
    out.error(path, `must be an object, got ${describe(value)}`);
    return undefined;
  }
  const workflow: Record<string, Record<string, unknown>> = {};
  for (const [group, item] of Object.entries(value)) {
    const groupPath = `${path}.${group}`;
    if (!Object.hasOwn(WORKFLOW_RULES, group)) {
      out.error(groupPath, `unknown workflow group "${group}"; allowed groups: ${Object.keys(WORKFLOW_RULES).join(", ")}`);
      continue;
    }
    if (!isRecord(item)) {
      out.error(groupPath, `must be an object, got ${describe(item)}`);
      continue;
    }
    const rules: Record<string, WorkflowRule> = WORKFLOW_RULES[group as keyof Workflow];
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(item)) {
      const keyPath = `${groupPath}.${key}`;
      const rule = Object.hasOwn(rules, key) ? rules[key] : undefined;
      if (group === "build" && RETIRED_BUILD_KEYS.includes(key)) {
        out.retired(keyPath);
      } else if (rule === undefined) {
        out.error(keyPath, `unknown workflow key "${key}"; allowed keys: ${Object.keys(rules).join(", ")}`);
      } else if ("values" in rule) {
        if (typeof field === "string" && rule.values.includes(field)) fields[key] = field;
        else out.error(keyPath, `must be one of ${oneOf(rule.values)}, got ${describe(field)}`);
      } else if ("items" in rule) {
        if (Array.isArray(field) && field.every((entry) => typeof entry === "string" && rule.items.includes(entry))) {
          fields[key] = [...field];
        } else {
          out.error(keyPath, `must be an array of ${oneOf(rule.items)}, got ${describe(field)}`);
        }
      } else if ("strings" in rule) {
        const pattern = new RegExp(rule.strings);
        if (Array.isArray(field) && field.every((entry) => typeof entry === "string" && pattern.test(entry))) {
          fields[key] = [...field];
        } else {
          out.error(keyPath, `must be an array of strings that match ${rule.strings}, got ${describe(field)}`);
        }
      } else if ((rule.auto && field === "auto") ||
        (typeof field === "number" && Number.isInteger(field) && field >= rule.minimum && field <= rule.maximum)) {
        fields[key] = field;
      } else {
        out.error(keyPath, `must be ${rule.auto ? '"auto" or ' : ""}an integer from ${rule.minimum} to ${rule.maximum}, got ${describe(field)}`);
      }
    }
    workflow[group] = fields;
  }
  return workflow as WorkflowLayer;
}

function validateProfiles(value: unknown, out: Collector): ConfigLayer["profiles"] {
  if (!isRecord(value)) {
    out.error("profiles", `must be an object, got ${describe(value)}`);
    return undefined;
  }
  const profiles: NonNullable<ConfigLayer["profiles"]> = {};
  for (const [name, item] of Object.entries(value)) {
    const path = `profiles.${name}`;
    if (!ROLE_NAME_RE.test(name)) {
      out.error(path, `profile name "${name}" must match ${ROLE_NAME_PATTERN}`);
      continue;
    }
    if (RETIRED_PROFILES.includes(name)) {
      out.retired(path);
      continue;
    }
    if (item === null) {
      if (PRESET_PROFILE_NAMES.includes(name)) out.error(path, `cannot remove preset profile "${name}"`);
      else profiles[name] = null;
      continue;
    }
    if (!isRecord(item)) {
      out.error(path, `a profile must be an object or null, got ${describe(item)}`);
      continue;
    }
    const profile: Partial<ProfileConfig> = {};
    for (const [key, field] of Object.entries(item)) {
      const keyPath = `${path}.${key}`;
      if (!PROFILE_KEYS.includes(key)) {
        out.error(keyPath, `unknown profile key "${key}"; allowed keys: ${PROFILE_KEYS.join(", ")}`);
      } else if (key === "description") {
        if (typeof field === "string" && field.length > 0 && codePointLength(field) <= DESCRIPTION_MAX) profile.description = field;
        else out.error(keyPath, `must be a non-empty string of at most ${DESCRIPTION_MAX} characters`);
      } else if (key === "extends") {
        if (typeof field === "string" && ROLE_NAME_RE.test(field)) {
          profile.extends = out.retiredProfile(field, keyPath) ? RETIRED_PROFILE_FALLBACK : field;
        } else out.error(keyPath, `must be a string that matches ${ROLE_NAME_PATTERN}, got ${describe(field)}`);
      } else if (key === "workflow") {
        const workflow = validateWorkflow(field, keyPath, out);
        if (workflow !== undefined) profile.workflow = workflow;
      } else if (key === "limits") {
        const limits = validateLimits(field, keyPath, out);
        if (limits !== undefined) profile.limits = limits;
      } else if (key === "roles") {
        const roles = validateRoles(field, keyPath, out);
        if (roles !== undefined) profile.roles = roles;
      } else if (key === "models") {
        const models = validateModels(field, keyPath, out);
        if (models !== undefined) profile.models = models;
      }
    }
    if ("description" in item && profile.description === undefined) continue;
    profiles[name] = profile;
  }
  return profiles;
}

function validateHarnesses(value: unknown, out: Collector): string[] | undefined {
  const valid = Array.isArray(value) &&
    value.length >= HARNESSES_MIN &&
    value.length <= HARNESSES_MAX &&
    value.every((item) => typeof item === "string" && PROVIDER_RE.test(item)) &&
    new Set(value).size === value.length;
  if (valid) return [...(value as string[])];
  out.error(
    "harnesses",
    `must be an array of ${HARNESSES_MIN} to ${HARNESSES_MAX} unique driver kinds that match ${PROVIDER_PATTERN}, got ${describe(value)}`,
  );
  return undefined;
}

export function validateLayer(value: unknown, source: string): { layer: ConfigLayer; issues: ConfigIssue[] } {
  const out = new Collector(source);
  const layer: ConfigLayer = {};
  if (!isRecord(value)) {
    out.error("", `the config must be an object, got ${describe(value)}`);
    return { layer, issues: out.issues };
  }
  for (const [key, item] of Object.entries(value)) {
    if (RETIRED_ROOT_KEYS.includes(key)) {
      out.retired(key);
    } else if (!ROOT_KEYS.includes(key)) {
      out.error(key, `unknown key "${key}"; allowed keys: ${ROOT_KEYS.join(", ")}`);
    } else if (key === "$schema") {
      if (typeof item !== "string") out.error(key, `must be a string, got ${describe(item)}`);
    } else if (key === "version") {
      if (item === 1) layer.version = 1;
      else out.error(key, `must be 1, got ${describe(item)}`);
    } else if (key === "roles") {
      const roles = validateRoles(item, key, out);
      if (roles !== undefined) layer.roles = roles;
    } else if (key === "limits") {
      const limits = validateLimits(item, key, out);
      if (limits !== undefined) layer.limits = limits;
    } else if (key === "profile") {
      if (typeof item === "string" && ROLE_NAME_RE.test(item)) {
        layer.profile = out.retiredProfile(item, key) ? RETIRED_PROFILE_FALLBACK : item;
      } else out.error(key, `must be a string that matches ${ROLE_NAME_PATTERN}, got ${describe(item)}`);
    } else if (key === "profiles") {
      const profiles = validateProfiles(item, out);
      if (profiles !== undefined) layer.profiles = profiles;
    } else if (key === "models") {
      const models = validateModels(item, key, out);
      if (models !== undefined) layer.models = models;
    } else if (key === "harnesses") {
      const harnesses = validateHarnesses(item, out);
      if (harnesses !== undefined) layer.harnesses = harnesses;
    } else if (key === "update") {
      const mode = UPDATE_VALUES.find((value) => value === item);
      if (mode !== undefined) layer.update = mode;
      else out.error(key, `must be "off", "check", or "apply", got ${describe(item)}`);
    }
  }
  return { layer, issues: out.issues };
}

export function validateMergedProfiles(
  config: OmtConfig,
  profileSources: ReadonlyMap<string, string> = new Map(),
  selectionSource = "defaults",
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (!Object.hasOwn(config.profiles, config.profile)) {
    issues.push({ source: selectionSource, path: "profile", message: `unknown profile "${config.profile}"`, severity: "error" });
  }
  for (const name of Object.keys(config.profiles)) {
    const out = new Collector(profileSources.get(name) ?? "defaults");
    const chain: string[] = [];
    let current: string | undefined = name;
    while (current !== undefined) {
      const cycle = chain.includes(current);
      chain.push(current);
      if (cycle) {
        out.error(`profiles.${name}.extends`, `profile cycle: ${chain.join(" -> ")}`);
        break;
      }
      if (chain.length > PROFILE_CHAIN_MAX) {
        out.error(`profiles.${name}.extends`, `profile chain exceeds ${PROFILE_CHAIN_MAX} profiles: ${chain.join(" -> ")}`);
        break;
      }
      const profile: ProfileConfig | undefined = Object.hasOwn(config.profiles, current) ? config.profiles[current] : undefined;
      if (profile === undefined) {
        out.error(`profiles.${name}.extends`, `unknown profile "${current}" in chain: ${chain.join(" -> ")}`);
        break;
      }
      current = profile.extends ?? (current === "normal" ? undefined : "normal");
    }
    issues.push(...out.issues);
  }
  return issues;
}
