import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { isCompleteDefaults } from "../src/config/defaultsState.ts";
import { loadConfig } from "../src/config/load.ts";
import { validateLayer } from "../src/config/validate.ts";
import { PROJECT_STARTER_CONFIG, USER_STARTER_CONFIG } from "../src/config/starter.ts";
import { EFFORT_LADDER } from "../src/types.ts";
import { fakeContext, tempDir, writeFile } from "./helpers.ts";

test("a retired date pin loads with a warning and uses the current defaults", async () => {
  const ctx = fakeContext({ root: tempDir("omt-retired-defaults-") });
  writeFile(join(ctx.cwd, ".omt", "config.jsonc"), JSON.stringify({ defaults: "2026-10" }));
  const loaded = await loadConfig(ctx);
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
  assert.equal(loaded.issues.length, 1);
  assert.equal(loaded.issues[0]?.severity, "warning");
  assert.match(loaded.issues[0]?.message ?? "", /no longer used/);
});

const EXPECTED: Record<string, [access: string, result: string, t3Role: string, mode: string, crossFamily: boolean, chain: string[]]> = {
  explore: ["read-only", "research", "research", "plan", false, ["codex/gpt-6.1-terra/low", "claudeAgent/claude-haiku-5-5/medium"]],
  research: ["read-only", "research", "research", "plan", false, ["codex/gpt-6.1-sol/low", "claudeAgent/claude-sonnet-5-5/medium"]],
  "plan-review": ["read-only", "review", "review", "plan", true, ["codex/gpt-6-astra/medium", "claudeAgent/claude-opus-5-5/medium"]],
  grill: ["read-only", "grill", "review", "plan", true, ["codex/gpt-6-astra/medium", "claudeAgent/claude-opus-5-5/medium"]],
  execute: ["edit", "work", "implementation", "default", false, ["claudeAgent/claude-opus-5-5/low", "codex/gpt-6.1-sol/high"]],
  review: ["edit", "review", "review", "default", true, ["codex/gpt-6-astra/medium", "claudeAgent/claude-opus-5-5/medium"]],
  oracle: ["edit", "review", "review", "default", true, ["codex/gpt-6-astra/medium", "claudeAgent/claude-opus-5-5/medium"]],
  qa: ["edit", "test", "test", "default", false, ["codex/gpt-6.1-sol/medium", "claudeAgent/claude-sonnet-5-5/low"]],
  guardrail: ["read-only", "guardrail", "review", "plan", false, ["claudeAgent/claude-opus-5-5/high", "codex/gpt-6-astra/high"]],
  writing: ["edit", "work", "implementation", "default", false, ["claudeAgent/claude-opus-5-5/medium", "codex/gpt-6-astra/medium"]],
  design: ["edit", "work", "design", "default", false, ["claudeAgent/claude-opus-5-5/medium", "codex/gpt-6-astra/high"]],
  ui: ["edit", "work", "implementation", "default", false, ["claudeAgent/claude-opus-5-5/low", "codex/gpt-6.1-sol/high"]],
};

test("the defaults hold the 12 roles with the planned values", () => {
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.roles).sort(), Object.keys(EXPECTED).sort());
  for (const [name, [access, result, t3Role, mode]] of Object.entries(EXPECTED)) {
    const role = DEFAULT_CONFIG.roles[name];
    assert.ok(role, name);
    assert.equal(role.access, access, name);
    assert.equal(role.result, result, name);
    assert.equal(role.t3Role, t3Role, name);
    assert.equal(role.interactionMode, mode, name);
    assert.equal(role.runtimeMode, "inherit", name);
    assert.ok(role.description.length > 0 && role.description.length <= 300, name);
  }
});

test("every default rung names the built-in provider instance of its driver, a model, and an effort", () => {
  for (const [name, role] of Object.entries(DEFAULT_CONFIG.roles)) {
    assert.equal(role.chain.length, EXPECTED[name]?.[5].length, name);
    for (const rung of role.chain) {
      assert.equal(rung.provider, rung.driver, name);
      assert.ok(rung.driver === "claudeAgent" || rung.driver === "codex", name);
      assert.ok(rung.model.length > 0, name);
      assert.ok(rung.effort !== undefined && EFFORT_LADDER.includes(rung.effort), name);
    }
  }
});

test("the default chains and crossFamily flags match the plan exactly", () => {
  assert.deepEqual(Object.keys(EXPECTED).sort(), Object.keys(DEFAULT_CONFIG.roles).sort());
  for (const [name, [, , , , crossFamily, rungs]] of Object.entries(EXPECTED)) {
    const role = DEFAULT_CONFIG.roles[name];
    assert.ok(role, name);
    const chain = rungs.map((text) => {
      const [driver, model, effort] = text.split("/");
      return { provider: driver, driver, model, effort };
    });
    assert.deepEqual(role.chain, chain, name);
    assert.equal(role.crossFamily, crossFamily, name);
  }
  assert.match(DEFAULT_CONFIG.roles.review?.description ?? "", /family that did not make the change/);
});


test("the default limits match the plan", () => {
  assert.deepEqual(DEFAULT_CONFIG.limits, { maxParallel: 6, maxDepth: 1, maxReviewRounds: 4 });
  assert.equal(DEFAULT_CONFIG.version, 1);
});

test("the latest set keeps the retired build keys, task budget, and roles removed", () => {
  for (const name of ["verify", "quick", "deep"]) assert.equal(Object.hasOwn(DEFAULT_CONFIG.roles, name), false, name);
  for (const [name, profile] of Object.entries(DEFAULT_CONFIG.profiles)) {
    const build = profile.workflow?.build ?? {};
    for (const key of ["verify", "checkpoint", "stallMinutes"]) assert.equal(Object.hasOwn(build, key), false, `${name} ${key}`);
  }
  assert.deepEqual(DEFAULT_CONFIG.profiles.normal?.workflow?.build, { review: "every-round", qa: "planned", failureProofs: "on", oracle: "heavy" });
  assert.match(DEFAULT_CONFIG.roles.qa?.description ?? "", /device flows/);
  assert.match(DEFAULT_CONFIG.roles.qa?.description ?? "", /Edits nothing/);
});

// A minimal JSONC reader for this test only; src/config/jsonc.ts is the real one.
function stripJsonc(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      assert.notEqual(end, -1, "unterminated block comment");
      i = end + 1;
    } else {
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

for (const [name, text] of Object.entries({ USER_STARTER_CONFIG, PROJECT_STARTER_CONFIG })) {
  test(`${name} parses as JSONC and is sparse`, () => {
    const parsed = JSON.parse(stripJsonc(text)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), ["$schema", "limits", "roles", "version"]);
    assert.equal(Object.hasOwn(parsed, "defaults"), false);
    assert.equal(parsed.$schema, "https://raw.githubusercontent.com/gabimoncha/oh-my-t3code/main/schema/omt.schema.json");
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.roles, {});
    assert.deepEqual(parsed.limits, {});
    assert.match(text, /omt config show --defaults/);
    assert.match(text, /^  \/\/ "profile": "prototype",$/m);
    assert.doesNotMatch(text, /visuals/);
  });
}

test("defaults.jsonc is a complete config with no validation issues", () => {
  const { layer, issues } = validateLayer(structuredClone(DEFAULT_CONFIG), "src/config/defaults.jsonc");
  assert.deepEqual(issues, []);
  assert.equal(isCompleteDefaults(layer), true);
});
