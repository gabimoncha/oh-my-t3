import { EFFORT_LADDER } from "../types.ts";
import { RETIRED_BUILD_KEYS, RETIRED_LIMIT_KEYS, RETIRED_PROFILES } from "./defaults.ts";
import { SCHEMA_URL } from "./starter.ts";
import {
  ACCESS_VALUES,
  CHAIN_MAX,
  CHAIN_MIN,
  DESCRIPTION_MAX,
  HARNESSES_MAX,
  HARNESSES_MIN,
  INTERACTION_MODE_VALUES,
  LIMIT_RANGES,
  MODEL_MAX,
  PRESET_PROFILE_NAMES,
  PROVIDER_PATTERN,
  RESULT_VALUES,
  ROLE_NAME_PATTERN,
  RUNTIME_MODE_VALUES,
  T3_ROLE_VALUES,
  UPDATE_VALUES,
  WORKFLOW_RULES,
} from "./validate.ts";

function limit(name: keyof typeof LIMIT_RANGES, description: string) {
  const [minimum, maximum] = LIMIT_RANGES[name];
  return { type: "integer", minimum, maximum, description };
}

const RETIRED = { deprecated: true, description: "No longer used. omt ignores this key." };

function retired(keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, RETIRED]));
}

function workflowGroup(rules: (typeof WORKFLOW_RULES)[keyof typeof WORKFLOW_RULES], retiredKeys: readonly string[] = []) {
  const properties = Object.fromEntries(Object.entries(rules).map(([key, rule]) => {
    if ("values" in rule) return [key, { enum: [...rule.values] }];
    if ("items" in rule) return [key, { type: "array", items: { enum: [...rule.items] } }];
    if ("strings" in rule) return [key, { type: "array", items: { type: "string", pattern: rule.strings } }];
    const integer = { type: "integer", minimum: rule.minimum, maximum: rule.maximum };
    return [key, "auto" in rule ? { oneOf: [{ const: "auto" }, integer] } : integer];
  }));
  return { type: "object", additionalProperties: false, properties: { ...properties, ...retired(retiredKeys) } };
}

export const CONFIG_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: SCHEMA_URL,
  title: "oh-my-t3code config",
  description: "A user (~/.config/oh-my-t3code/config.jsonc) or project (.omt/config.jsonc) config layer.",
  type: "object",
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    version: { const: 1 },
    defaults: RETIRED,
    profile: { type: "string", pattern: ROLE_NAME_PATTERN, description: "Default workflow profile. Default normal." },
    profiles: {
      type: "object",
      description: "Profile overrides and new profiles. A new profile needs a description. Null removes a custom profile.",
      propertyNames: { pattern: ROLE_NAME_PATTERN },
      properties: {
        ...Object.fromEntries(PRESET_PROFILE_NAMES.map((name) => [name, { $ref: "#/$defs/profile" }])),
        ...retired(RETIRED_PROFILES),
      },
      additionalProperties: { oneOf: [{ type: "null" }, { $ref: "#/$defs/profile" }] },
    },
    models: {
      type: "object",
      propertyNames: { minLength: 1, maxLength: MODEL_MAX },
      additionalProperties: { $ref: "#/$defs/model" },
    },
    roles: {
      type: "object",
      description: "Role overrides and new roles. Set a role to null to remove it.",
      propertyNames: { pattern: ROLE_NAME_PATTERN },
      additionalProperties: {
        oneOf: [{ type: "null" }, { $ref: "#/$defs/role" }],
      },
    },
    limits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxParallel: limit("maxParallel", "Most child tasks that run at the same time."),
        maxDepth: limit("maxDepth", "Most levels of delegation below the main thread."),
        maxReviewRounds: limit("maxReviewRounds", "Most review rounds for one change."),
        ...retired(RETIRED_LIMIT_KEYS),
      },
    },
    visuals: RETIRED,
    update: {
      enum: [...UPDATE_VALUES],
      description: "Check for a new omt once a day in omt install and omt doctor (asks the npm registry). apply also applies a found update. Read only from the user config. Default off.",
    },
    harnesses: {
      type: "array",
      minItems: HARNESSES_MIN,
      maxItems: HARNESSES_MAX,
      uniqueItems: true,
      items: { type: "string", pattern: PROVIDER_PATTERN },
      description: "T3 driver kinds that routing may use, for example [\"codex\"]. A rung of another driver fails. Without it, every driver may run. Run omt detect to set it.",
    },
  },
  $defs: {
    role: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string", minLength: 1, maxLength: DESCRIPTION_MAX },
        access: { enum: [...ACCESS_VALUES] },
        result: { enum: [...RESULT_VALUES] },
        t3Role: { enum: [...T3_ROLE_VALUES] },
        interactionMode: { enum: [...INTERACTION_MODE_VALUES] },
        runtimeMode: { enum: [...RUNTIME_MODE_VALUES] },
        crossFamily: {
          type: "boolean",
          description: "With --against, try the rungs outside the worker's family first.",
        },
        fast: { type: "boolean" },
        chain: {
          type: "array",
          minItems: CHAIN_MIN,
          maxItems: CHAIN_MAX,
          items: { $ref: "#/$defs/rung" },
        },
      },
    },
    rung: {
      type: "object",
      additionalProperties: false,
      required: ["model"],
      anyOf: [{ required: ["provider"] }, { required: ["driver"] }],
      properties: {
        provider: { type: "string", pattern: PROVIDER_PATTERN, description: "T3 provider instance id." },
        driver: { type: "string", pattern: PROVIDER_PATTERN, description: "T3 driver kind." },
        model: { type: "string", minLength: 1, maxLength: MODEL_MAX },
        effort: { enum: [...EFFORT_LADDER] },
        fast: { type: "boolean" },
        options: {
          type: "object",
          additionalProperties: { type: ["string", "boolean"] },
        },
      },
    },
    model: {
      type: "object",
      additionalProperties: false,
      properties: { fast: { type: "boolean" } },
    },
    profile: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string", minLength: 1, maxLength: DESCRIPTION_MAX },
        extends: { type: "string", pattern: ROLE_NAME_PATTERN },
        workflow: { $ref: "#/$defs/workflow" },
        limits: { $ref: "#/properties/limits" },
        roles: { $ref: "#/properties/roles" },
        models: { $ref: "#/properties/models" },
      },
    },
    workflow: {
      type: "object",
      additionalProperties: false,
      properties: {
        plan: workflowGroup(WORKFLOW_RULES.plan),
        design: workflowGroup(WORKFLOW_RULES.design),
        build: workflowGroup(WORKFLOW_RULES.build, RETIRED_BUILD_KEYS),
        review: workflowGroup(WORKFLOW_RULES.review),
        git: workflowGroup(WORKFLOW_RULES.git),
      },
    },
  },
};
