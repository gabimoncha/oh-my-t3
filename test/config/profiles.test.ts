import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { loadConfig } from "../../src/config/load.ts";
import { mergeLayer } from "../../src/config/merge.ts";
import { validateLayer, validateMergedProfiles, WORKFLOW_RULES } from "../../src/config/validate.ts";
import type { OmtConfig, ProfileConfig, Workflow } from "../../src/types.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";
import { runOk } from "../run.ts";

function merge(value: unknown, base = DEFAULT_CONFIG) {
  const validated = validateLayer(value, "src");
  const merged = mergeLayer(base, validated.layer, "src");
  return { config: merged.config, issues: [...validated.issues, ...merged.issues] };
}

function setup() {
  const ctx = fakeContext({ root: tempDir() });
  mkdirSync(join(ctx.cwd, ".git"));
  const userPath = join(ctx.homedir, ".config", "oh-my-t3code", "config.jsonc");
  const projectPath = join(ctx.cwd, ".omt", "config.jsonc");
  const load = () => loadConfig(ctx);
  const write = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));
  return { ctx, userPath, projectPath, load, write };
}

test("the presets store a full normal workflow with the PR steps and sparse prototype overrides", () => {
  const { normal, prototype } = DEFAULT_CONFIG.profiles;
  assert.ok(normal && prototype);
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.profiles), ["normal", "prototype"]);
  assert.equal(DEFAULT_CONFIG.profile, "normal");
  assert.deepEqual(Object.keys(normal).sort(), ["description", "workflow"]);
  assert.deepEqual(normal.workflow, {
    plan: { review: "two-families", testLayers: ["e2e"] },
    design: { variants: 3 },
    build: { review: "every-round", qa: "planned", failureProofs: "on", oracle: "heavy" },
    review: {
      reviewers: "auto", families: "one", oracle: "on", fixLoop: "offer", ci: "fix", verify: "changed-flows",
      tests: "offer", guardrails: "propose", crap: "report",
    },
    git: { branchCommits: "auto", pullRequests: "auto", defaultBranch: "ask", merge: "ask", owners: [], maxPrFiles: 100 },
  });
  assert.equal(prototype.extends, "normal");
  assert.deepEqual(prototype.limits, { maxReviewRounds: 2 });
  assert.deepEqual(prototype.workflow, {
    plan: { review: "one" },
    design: { variants: 1 },
    build: { review: "first-round", failureProofs: "off", oracle: "off" },
    review: { reviewers: 1, oracle: "off", ci: "off", verify: "off", tests: "off", guardrails: "off", crap: "off" },
  });
  assert.deepEqual(DEFAULT_CONFIG.models, { "gpt-6.1-sol": { fast: true } });
  for (const role of Object.values(DEFAULT_CONFIG.roles)) {
    assert.equal(role.fast, undefined);
    assert.ok(role.chain.every((rung) => rung.fast === undefined));
  }
});

test("profile fields merge per name, workflow group, limit, role, and model", () => {
  const before = structuredClone(DEFAULT_CONFIG);
  const first = merge({
    profile: "demo",
    profiles: {
      demo: {
        description: "Demo.", extends: "prototype",
        workflow: { build: { qa: "off", oracle: "always" }, plan: { testLayers: ["unit", "integration"] } },
        limits: { maxParallel: 10, maxDepth: 2 },
        roles: { execute: { fast: true, description: "Build." }, oracle: null },
        models: { "gpt-6.1-sol": { fast: false } },
      },
    },
  });
  assert.deepEqual(first.issues, []);
  const second = merge({
    profiles: {
      demo: {
        workflow: { build: { oracle: "off" }, plan: { testLayers: ["e2e"] } },
        limits: { maxParallel: 3 },
        roles: { execute: { fast: false }, qa: { fast: true } },
        models: { "gpt-6.1-sol": {}, other: { fast: true } },
      },
      normal: { workflow: { design: { variants: 5 } } },
    },
  }, first.config);
  assert.deepEqual(second.issues, []);
  assert.equal(second.config.profile, "demo");
  assert.deepEqual(second.config.profiles.demo, {
    description: "Demo.", extends: "prototype",
    workflow: { build: { qa: "off", oracle: "off" }, plan: { testLayers: ["e2e"] } },
    limits: { maxParallel: 3, maxDepth: 2 },
    roles: { execute: { fast: false, description: "Build." }, oracle: null, qa: { fast: true } },
    models: { "gpt-6.1-sol": { fast: false }, other: { fast: true } },
  });
  assert.equal(second.config.profiles.normal?.workflow?.design?.variants, 5);
  assert.equal(second.config.profiles.normal?.workflow?.build?.review, "every-round");
  assert.deepEqual(DEFAULT_CONFIG, before);
  assert.equal(first.config.profiles.demo?.limits?.maxParallel, 10);
});

test("new profiles need a description and existing profiles do not", () => {
  const invalid = merge({ profiles: { custom: { extends: "normal" } } });
  assert.equal(invalid.config.profiles.custom, undefined);
  assert.deepEqual(invalid.issues.map((issue) => [issue.path, issue.severity]), [["profiles.custom", "error"]]);
  assert.match(invalid.issues[0]?.message ?? "", /new profile needs description/);
  const valid = merge({ profiles: { custom: { description: "Custom." } } });
  assert.deepEqual(valid.issues, []);
  assert.deepEqual(merge({ profiles: { custom: { limits: { maxDepth: 2 } } } }, valid.config).issues, []);
  for (const description of ["", "x".repeat(301), null, 1]) {
    const checked = validateLayer({ profiles: { normal: { description } } }, "src");
    assert.deepEqual(checked.issues.map((issue) => issue.path), ["profiles.normal.description"]);
  }
  assert.deepEqual(merge({ profiles: { custom: { description: "x".repeat(300) } } }).issues, []);
});

test("string limits count Unicode code points at the root and in profiles", () => {
  const description = "x".repeat(299) + "\u{1f680}";
  const model = "m".repeat(199) + "\u{1f680}";
  const fields = {
    models: { [model]: { fast: true } },
    roles: { execute: { description, chain: [{ driver: "codex", model }] } },
  };
  const value = { ...fields, profiles: { custom: { description, ...fields } } };
  const checked = validateLayer(value, "src");
  assert.deepEqual(checked.issues, []);
  assert.deepEqual(checked.layer, value);
});

test("string limits reject Unicode code points above the maximum", () => {
  const description = "x".repeat(300) + "\u{1f680}";
  const model = "m".repeat(200) + "\u{1f680}";
  const fields = {
    models: { [model]: {} },
    roles: { execute: { description }, qa: { chain: [{ driver: "codex", model }] } },
  };
  const checked = validateLayer({ ...fields, profiles: { normal: { description, ...fields } } }, "src");
  assert.deepEqual(checked.issues.map((issue) => issue.path), [
    `models.${model}`, "roles.execute.description", "roles.qa.chain[0].model",
    "profiles.normal.description", `profiles.normal.models.${model}`,
    "profiles.normal.roles.execute.description", "profiles.normal.roles.qa.chain[0].model",
  ]);
});

test("an empty description on a new profile gives exactly one error", () => {
  const checked = merge({ profiles: { custom: { description: "" } } });
  assert.equal(checked.config.profiles.custom, undefined);
  assert.deepEqual(checked.issues, [{
    source: "src", path: "profiles.custom.description", severity: "error",
    message: "must be a non-empty string of at most 300 characters",
  }]);
});

test("null removes custom profiles but cannot remove any preset", () => {
  const first = merge({ profiles: { custom: { description: "Custom." } } });
  const removed = merge({ profiles: { custom: null } }, first.config);
  assert.deepEqual(removed.issues, []);
  assert.equal(Object.hasOwn(removed.config.profiles, "custom"), false);
  assert.equal(merge({ profiles: { missing: null } }).issues[0]?.severity, "warning");
  for (const name of ["normal", "prototype"]) {
    const checked = merge({ profiles: { [name]: null } });
    assert.deepEqual(checked.config.profiles[name], DEFAULT_CONFIG.profiles[name]);
    assert.deepEqual(checked.issues.map((issue) => [issue.path, issue.severity]), [[`profiles.${name}`, "error"]]);
    assert.match(checked.issues[0]?.message ?? "", /cannot remove preset profile/);
    assert.equal(mergeLayer(DEFAULT_CONFIG, { profiles: { [name]: null } }, "src").issues[0]?.severity, "error");
  }
});

test("a retired pr-review declaration warns and is dropped, and a pr-review selection resolves to normal", () => {
  for (const value of [{ description: "Old." }, { workflow: { review: { ci: "fix" } } }, null]) {
    const checked = merge({ profiles: { "pr-review": value } });
    assert.equal(Object.hasOwn(checked.config.profiles, "pr-review"), false);
    assert.deepEqual(checked.issues, [{
      source: "src", path: "profiles.pr-review", severity: "warning", message: "profiles.pr-review is no longer used; remove it",
    }]);
  }
  const retiredSelection = {
    severity: "warning", message: 'profile "pr-review" is no longer used; normal runs the PR steps',
  };
  const selected = merge({ profile: "pr-review" });
  assert.equal(selected.config.profile, "normal");
  assert.deepEqual(selected.issues, [{ source: "src", path: "profile", ...retiredSelection }]);
  const extended = merge({ profiles: { custom: { description: "Custom.", extends: "pr-review" } } });
  assert.equal(extended.config.profiles.custom?.extends, "normal");
  assert.deepEqual(extended.issues, [{ source: "src", path: "profiles.custom.extends", ...retiredSelection }]);
  assert.deepEqual(validateMergedProfiles(extended.config), []);
});

test("profile names and profile fields reject invalid shapes and unknown keys", () => {
  for (const name of ["Normal", "1st", "a_b", "a".repeat(33), "__proto__"]) {
    const checked = validateLayer({ profiles: { [name]: { description: "Profile." } } }, "src");
    assert.deepEqual(checked.layer.profiles, {});
    assert.deepEqual(checked.issues.map((issue) => issue.path), [`profiles.${name}`]);
  }
  for (const profiles of [null, [], 1]) {
    assert.deepEqual(validateLayer({ profiles }, "src").issues.map((issue) => issue.path), ["profiles"]);
  }
  const checked = validateLayer({
    profiles: {
      normal: { visuals: { plan: false }, extra: true, extends: "Bad Name", workflow: [], limits: null, roles: [], models: null },
      custom: 1,
    },
  }, "src");
  assert.deepEqual(checked.layer.profiles, { normal: {} });
  assert.deepEqual(checked.issues.map((issue) => issue.path), [
    "profiles.normal.visuals", "profiles.normal.extra", "profiles.normal.extends", "profiles.normal.workflow",
    "profiles.normal.limits", "profiles.normal.roles", "profiles.normal.models", "profiles.custom",
  ]);
});

test("every workflow enum and numeric boundary is accepted and invalid values are dropped", () => {
  for (const [group, rules] of Object.entries(WORKFLOW_RULES)) {
    for (const [key, rule] of Object.entries(rules)) {
      const good: unknown[] = "values" in rule ? [...rule.values]
        : "items" in rule ? [[], [...rule.items]]
        : "strings" in rule ? [[], ["acme", "Alice-1"]]
        : [rule.minimum, rule.maximum, ...("auto" in rule ? ["auto"] : [])];
      for (const value of good) {
        const checked = validateLayer({ profiles: { normal: { workflow: { [group]: { [key]: value } } } } }, "src");
        assert.deepEqual(checked.issues, [], `${group}.${key}=${JSON.stringify(value)}`);
      }
      const bad: unknown[] = "values" in rule ? ["unknown", 1, null]
        : "items" in rule ? ["e2e", ["snapshot"], [1]]
        : "strings" in rule ? ["acme", ["-acme"], [1]]
        : [rule.minimum - 1, rule.maximum + 1, 1.5, "1", null];
      for (const value of bad) {
        const checked = validateLayer({ profiles: { normal: { workflow: { [group]: { [key]: value } } } } }, "src");
        assert.deepEqual(checked.issues.map((issue) => issue.path), [`profiles.normal.workflow.${group}.${key}`]);
        const fields = checked.layer.profiles?.normal?.workflow?.[group as keyof Workflow];
        assert.deepEqual(fields, {});
      }
    }
  }
});

test("unknown workflow groups and fields are errors and only invalid fields are dropped", () => {
  const checked = validateLayer({ profiles: { normal: { workflow: {
    unknown: {}, build: { unknown: true, qa: "off", oracle: "never" }, review: false,
  } } } }, "src");
  assert.deepEqual(checked.layer.profiles?.normal?.workflow, { build: { qa: "off" } });
  assert.deepEqual(checked.issues.map((issue) => issue.path), [
    "profiles.normal.workflow.unknown", "profiles.normal.workflow.build.unknown",
    "profiles.normal.workflow.build.oracle", "profiles.normal.workflow.review",
  ]);
});

test("models, roles, and rungs accept boolean fast values at the root and in a profile", () => {
  for (const fast of [true, false]) {
    const fields = {
      models: { "gpt-6.1-sol": { fast } },
      roles: { execute: { fast, chain: [{ driver: "codex", model: "gpt-6.1-sol", fast }] } },
    };
    const checked = merge({ ...fields, profiles: { normal: fields } });
    assert.deepEqual(checked.issues, []);
    assert.equal(checked.config.models["gpt-6.1-sol"]?.fast, fast);
    assert.equal(checked.config.roles.execute?.fast, fast);
    assert.equal(checked.config.roles.execute?.chain[0]?.fast, fast);
    assert.deepEqual(checked.config.profiles.normal?.models, fields.models);
    assert.deepEqual(checked.config.profiles.normal?.roles, fields.roles);
  }
  const custom = merge({ roles: { custom: {
    description: "Custom.", access: "edit", fast: false, chain: [{ driver: "codex", model: "m" }],
  } } });
  assert.equal(custom.config.roles.custom?.fast, false);
  const inherited = merge({ models: { "gpt-6.1-sol": {}, other: { fast: false } } });
  assert.deepEqual(inherited.config.models, { "gpt-6.1-sol": { fast: true }, other: { fast: false } });
});

test("invalid fast values and model fields have exact nested issue paths", () => {
  for (const fast of ["true", 1, null, [], {}]) {
    for (const prefix of ["", "profiles.normal."]) {
      const fields = {
        models: { m: { fast } },
        roles: { execute: { fast }, qa: { chain: [{ driver: "codex", model: "m", fast }] } },
      };
      const checked = validateLayer(prefix === "" ? fields : { profiles: { normal: fields } }, "src");
      assert.deepEqual(checked.issues.map((issue) => issue.path), [
        `${prefix}models.m.fast`, `${prefix}roles.execute.fast`, `${prefix}roles.qa.chain[0].fast`,
      ]);
      assert.ok(checked.issues.every((issue) => issue.severity === "error"));
    }
  }
  for (const models of [[], null, 1]) {
    assert.deepEqual(validateLayer({ models }, "src").issues.map((issue) => issue.path), ["models"]);
  }
  const checked = validateLayer({ models: { "": {}, ["m".repeat(201)]: {}, m: null, n: { extra: true, fast: false } } }, "src");
  assert.deepEqual(checked.layer.models, { n: { fast: false } });
  assert.deepEqual(checked.issues.map((issue) => issue.path), ["models.", `models.${"m".repeat(201)}`, "models.m", "models.n.extra"]);
});

test("roles.test emits the rename warning and still follows normal custom role rules", () => {
  const fields = { test: { description: "Legacy.", access: "edit", chain: [{ driver: "codex", model: "m" }] } };
  const checked = merge({ roles: fields, profiles: { normal: { roles: fields } } });
  assert.deepEqual(checked.issues, ["roles.test", "profiles.normal.roles.test"].map((path) => ({
    source: "src", path, severity: "warning", message: 'role "test" was renamed to "qa"; rename it',
  })));
  assert.equal(checked.config.roles.test?.description, "Legacy.");
  const incomplete = merge({ roles: { test: { fast: true } } });
  assert.deepEqual(incomplete.issues.map((issue) => issue.severity), ["warning", "error"]);
  assert.equal(incomplete.config.roles.test, undefined);
  const invalid = validateLayer({ roles: { test: { access: "write" } } }, "src");
  assert.deepEqual(invalid.issues.map((issue) => issue.severity), ["warning", "error"]);
  assert.deepEqual(invalid.layer.roles, {});
});

test("a project profile can extend a user profile and select it after all layers merge", async () => {
  const { userPath, projectPath, write, load } = setup();
  write(userPath, { profiles: { user: { description: "User.", extends: "prototype" } } });
  write(projectPath, { profile: "project", profiles: { project: { description: "Project.", extends: "user" } } });
  const loaded = await load();
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.config.profile, "project");
  assert.equal(loaded.config.profiles.project?.extends, "user");
  write(userPath, { profile: "project", profiles: { user: { description: "User.", extends: "project" } } });
  write(projectPath, { profiles: { project: { description: "Project." } } });
  assert.deepEqual((await load()).issues, []);
});

test("a cycle across user and project layers names its chain and each profile's last source", async () => {
  const { userPath, projectPath, write, load } = setup();
  write(userPath, { profiles: { user: { description: "User.", extends: "project" } } });
  write(projectPath, { profiles: { project: { description: "Project.", extends: "user" } } });
  const loaded = await load();
  assert.deepEqual(loaded.issues, [
    { source: userPath, path: "profiles.user.extends", message: "profile cycle: user -> project -> user", severity: "error" },
    { source: projectPath, path: "profiles.project.extends", message: "profile cycle: project -> user -> project", severity: "error" },
  ]);
  assert.equal(loaded.config.profiles.user?.extends, "project");
  assert.equal(loaded.config.profiles.project?.extends, "user");
});

test("a self-cycle and an implicit normal cycle are errors with the chain", () => {
  const self = merge({ profiles: { custom: { description: "Custom.", extends: "custom" } } }).config;
  assert.match(validateMergedProfiles(self)[0]?.message ?? "", /custom -> custom/);
  const implicit = merge({ profiles: { normal: { extends: "custom" }, custom: { description: "Custom." } } }).config;
  assert.match(validateMergedProfiles(implicit)[0]?.message ?? "", /normal -> custom -> normal/);
});

test("profile chains allow eight profiles and reject deeper chains without changing the config", () => {
  const profiles: Record<string, ProfileConfig> = {};
  for (let i = 1; i <= 7; i++) {
    profiles[`p${i}`] = { description: `Profile ${i}.`, extends: i === 1 ? "normal" : `p${i - 1}` };
  }
  const config = merge({ profiles }).config;
  assert.deepEqual(validateMergedProfiles(config), []);
  const deep = merge({ profiles: { p8: { description: "Profile 8.", extends: "p7" } } }, config).config;
  const before = structuredClone(deep);
  assert.deepEqual(validateMergedProfiles(deep), [{
    source: "defaults", path: "profiles.p8.extends", severity: "error",
    message: "profile chain exceeds 8 profiles: p8 -> p7 -> p6 -> p5 -> p4 -> p3 -> p2 -> p1 -> normal",
  }]);
  assert.deepEqual(deep, before);
});

test("final validation uses the last profile definition and root selection source", async () => {
  const { userPath, projectPath, write, load } = setup();
  write(userPath, { profile: "missing", profiles: { custom: { description: "Custom.", extends: "missing" } } });
  write(projectPath, { profiles: { custom: { description: "Project override." } } });
  const loaded = await load();
  assert.deepEqual(loaded.issues, [
    { source: userPath, path: "profile", message: 'unknown profile "missing"', severity: "error" },
    { source: projectPath, path: "profiles.custom.extends", message: 'unknown profile "missing" in chain: custom -> missing', severity: "error" },
  ]);
  assert.equal(loaded.config.profiles.custom?.extends, "missing");
  assert.equal(loaded.config.profile, "missing");
  write(projectPath, { profile: "other", profiles: { missing: { description: "Now defined." } } });
  assert.deepEqual((await load()).issues.map((issue) => [issue.source, issue.path]), [[projectPath, "profile"]]);
});

test("root profile rejects invalid names and unknown names, including inherited object names", () => {
  for (const profile of [null, 1, "", "Bad Name", "x".repeat(33)]) {
    const checked = validateLayer({ profile }, "src");
    assert.equal(checked.layer.profile, undefined);
    assert.deepEqual(checked.issues.map((issue) => issue.path), ["profile"]);
  }
  const config: OmtConfig = { ...DEFAULT_CONFIG, profile: "constructor" };
  assert.deepEqual(validateMergedProfiles(config).map((issue) => issue.path), ["profile"]);
});

test("config show prints the planned defaults and the roles.test warning", async () => {
  const { ctx, write, projectPath } = setup();
  const options = { homedir: ctx.homedir, cwd: ctx.cwd, env: ctx.env };
  const defaults = await runOk(["config", "show", "--defaults"], options);
  const printed = JSON.parse(defaults.ctx.out()) as OmtConfig;
  assert.equal(printed.limits.maxParallel, 6);
  assert.ok(printed.roles.qa && printed.roles.guardrail);
  assert.equal(Object.hasOwn(printed.roles, "verify"), false);
  assert.equal(Object.hasOwn(printed.roles, "test"), false);
  assert.deepEqual(printed.models["gpt-6.1-sol"], { fast: true });
  write(projectPath, { roles: { test: { description: "Legacy.", access: "edit", chain: [{ driver: "codex", model: "m" }] } } });
  const shown = await runOk(["config", "show"], options);
  assert.equal(shown.ctx.err(), `warning ${projectPath} roles.test: role "test" was renamed to "qa"; rename it\n`);
});

test("long profile chains produce bounded diagnostics", () => {
  const profiles: Record<string, ProfileConfig> = { normal: DEFAULT_CONFIG.profiles.normal! };
  for (let i = 0; i < 10_000; i++) profiles[`p${i}`] = { description: "Test", extends: `p${i + 1}` };
  const issues = validateMergedProfiles({ ...DEFAULT_CONFIG, profiles });
  assert.equal(issues.length, 10_000);
  assert.ok(issues.every((issue) => issue.message.length < 200));
});
