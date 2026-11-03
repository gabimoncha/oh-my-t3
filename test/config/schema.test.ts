import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RETIRED_BUILD_KEYS, RETIRED_LIMIT_KEYS, RETIRED_PROFILES } from "../../src/config/defaults.ts";
import { CONFIG_SCHEMA } from "../../src/config/schema.ts";
import {
  LIMIT_KEYS,
  LIMIT_RANGES,
  MODEL_KEYS,
  PRESET_PROFILE_NAMES,
  PROFILE_KEYS,
  ROLE_KEYS,
  RETIRED_ROOT_KEYS,
  ROOT_KEYS,
  RUNG_KEYS,
  WORKFLOW_RULES,
} from "../../src/config/validate.ts";
import { formatJson } from "../../src/util/output.ts";
import { EFFORT_LADDER } from "../../src/types.ts";
import { PACKAGE_ROOT } from "../helpers.ts";

const sorted = (keys: readonly string[]) => [...keys].sort();

test("the committed schema equals the generated output", () => {
  const committed = readFileSync(join(PACKAGE_ROOT, "schema", "omt.schema.json"), "utf8");
  assert.equal(committed, formatJson(CONFIG_SCHEMA), "run `pnpm schema` to regenerate schema/omt.schema.json");
});

test("the schema is draft 2020-12", () => {
  assert.equal(CONFIG_SCHEMA.$schema, "https://json-schema.org/draft/2020-12/schema");
});

test("the schema allows exactly the keys that validateLayer allows", () => {
  const s = CONFIG_SCHEMA;
  assert.deepEqual(sorted(Object.keys(s.properties)), sorted([...ROOT_KEYS, ...RETIRED_ROOT_KEYS]));
  assert.equal(s.properties.visuals.deprecated, true);
  assert.deepEqual(sorted(Object.keys(s.$defs.role.properties)), sorted(ROLE_KEYS));
  assert.deepEqual(sorted(Object.keys(s.$defs.rung.properties)), sorted(RUNG_KEYS));
  assert.deepEqual(sorted(Object.keys(s.$defs.profile.properties)), sorted(PROFILE_KEYS));
  assert.deepEqual(sorted(Object.keys(s.$defs.model.properties)), sorted(MODEL_KEYS));
  assert.deepEqual(sorted(Object.keys(s.properties.profiles.properties)), sorted([...PRESET_PROFILE_NAMES, ...RETIRED_PROFILES]));
  assert.deepEqual(sorted(Object.keys(s.$defs.workflow.properties)), sorted(Object.keys(WORKFLOW_RULES)));
  for (const key of Object.keys(WORKFLOW_RULES) as (keyof typeof WORKFLOW_RULES)[]) {
    const retired = key === "build" ? RETIRED_BUILD_KEYS : [];
    assert.deepEqual(sorted(Object.keys(s.$defs.workflow.properties[key].properties)), sorted([...Object.keys(WORKFLOW_RULES[key]), ...retired]));
  }
  assert.deepEqual(sorted(Object.keys(s.properties.limits.properties)), sorted([...LIMIT_KEYS, ...RETIRED_LIMIT_KEYS]));
  const build = s.$defs.workflow.properties.build.properties as unknown as Record<string, { deprecated?: boolean }>;
  const limits = s.properties.limits.properties as unknown as Record<string, { deprecated?: boolean }>;
  for (const key of RETIRED_BUILD_KEYS) assert.equal(build[key]?.deprecated, true, key);
  for (const key of RETIRED_LIMIT_KEYS) assert.equal(limits[key]?.deprecated, true, key);
  const profiles = s.properties.profiles.properties as unknown as Record<string, { deprecated?: boolean }>;
  for (const name of RETIRED_PROFILES) assert.equal(profiles[name]?.deprecated, true, name);
});

test("every object that the validator closes has additionalProperties false", () => {
  const s = CONFIG_SCHEMA;
  for (const node of [
    s, s.properties.limits, s.$defs.role, s.$defs.rung, s.$defs.profile, s.$defs.model,
    s.$defs.workflow, ...Object.values(s.$defs.workflow.properties),
  ]) {
    assert.equal(node.additionalProperties, false);
  }
});

test("the schema ranges and enums match the validator", () => {
  const s = CONFIG_SCHEMA;
  for (const key of LIMIT_KEYS) {
    const limit = s.properties.limits.properties[key as keyof typeof s.properties.limits.properties];
    assert.deepEqual([limit.minimum, limit.maximum], LIMIT_RANGES[key as keyof typeof LIMIT_RANGES]);
  }
  assert.deepEqual(s.$defs.rung.properties.effort.enum, [...EFFORT_LADDER]);
  assert.deepEqual(s.$defs.rung.required, ["model"]);
});
