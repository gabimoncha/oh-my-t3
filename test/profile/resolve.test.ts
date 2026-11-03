import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { loadConfig } from "../../src/config/load.ts";
import { mergeLayer } from "../../src/config/merge.ts";
import { userConfigPath } from "../../src/paths.ts";
import { effectiveConfig, resolveProfile } from "../../src/profile/resolve.ts";
import type { ConfigLayer, LoadedConfig, OmtConfig } from "../../src/types.ts";
import { OmtError } from "../../src/util/errors.ts";
import { omtExit, projectContext, writeFile } from "../helpers.ts";

function configured(layer: ConfigLayer): OmtConfig {
  const merged = mergeLayer(DEFAULT_CONFIG, layer, "test");
  assert.deepEqual(merged.issues, []);
  return merged.config;
}

test("profiles apply root first after the config, with roles, limits, workflow, and models merged", () => {
  const config = configured({
    roles: { execute: { fast: false }, writing: null },
    limits: { maxParallel: 2, maxReviewRounds: 7 },
    models: { "gpt-6.1-sol": { fast: false }, custom: { fast: true } },
    profiles: {
      normal: { roles: { execute: { description: "Normal worker." } }, workflow: { plan: { testLayers: ["e2e", "unit"] } } },
      parent: {
        description: "Parent.",
        extends: "prototype",
        limits: { maxParallel: 8 },
        roles: {
          execute: { fast: true },
          extra: { description: "Extra worker.", access: "edit", chain: [{ driver: "codex", model: "custom" }] },
        },
        models: { "gpt-6.1-sol": { fast: true } },
      },
      custom: {
        description: "Custom.",
        extends: "parent",
        limits: { maxDepth: 2 },
        roles: { execute: { chain: [{ driver: "codex", model: "chosen" }] }, explore: null },
        workflow: { build: { oracle: "always" }, plan: { testLayers: ["unit"] } },
        models: { "gpt-6.1-sol": {}, custom: { fast: false } },
      },
    },
  });
  const before = structuredClone(config);
  const result = resolveProfile(config, "custom");
  assert.equal(result.name, "custom");
  assert.equal(result.source, "argument");
  assert.deepEqual(result.limits, { maxParallel: 8, maxDepth: 2, maxReviewRounds: 2 });
  assert.equal(result.roles.execute?.description, "Normal worker.");
  assert.equal(result.roles.execute?.fast, true);
  assert.deepEqual(result.roles.execute?.chain, [{ driver: "codex", model: "chosen" }]);
  assert.equal(result.roles.writing, undefined);
  assert.equal(result.roles.explore, undefined);
  assert.equal(result.roles.extra?.result, "work");
  assert.equal(result.workflow.build.review, "first-round");
  assert.equal(result.workflow.build.oracle, "always");
  assert.equal(result.workflow.build.qa, "planned");
  assert.equal(result.workflow.plan.review, "one");
  assert.deepEqual(result.workflow.plan.testLayers, ["unit"]);
  assert.deepEqual(result.models, { "gpt-6.1-sol": { fast: true }, custom: { fast: false } });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(config, before);
  result.workflow.plan.testLayers.push("e2e");
  result.roles.execute!.chain[0]!.model = "changed";
  assert.deepEqual(config, before);
});

test("custom profiles without extends inherit normal, and preset workflows are complete", () => {
  const config = configured({ profiles: { custom: { description: "Custom.", workflow: { build: { oracle: "always" } } } } });
  const normal = resolveProfile(config, "normal");
  const custom = resolveProfile(config, "custom");
  assert.deepEqual(custom.workflow, { ...normal.workflow, build: { ...normal.workflow.build, oracle: "always" } });
  const prototype = resolveProfile(config, "prototype");
  assert.equal(prototype.workflow.design.variants, 1);
  assert.equal(prototype.workflow.build.failureProofs, "off");
  assert.equal(prototype.workflow.build.oracle, "off");
  assert.deepEqual(normal.workflow.review, {
    reviewers: "auto", families: "one", oracle: "on", fixLoop: "offer",
    ci: "off", verify: "off", tests: "off", guardrails: "off", crap: "off",
  });
  assert.deepEqual(prototype.workflow.review, {
    reviewers: 1, families: "one", oracle: "off", fixLoop: "offer",
    ci: "off", verify: "off", tests: "off", guardrails: "off", crap: "off",
  });
});

test("profile application reports incomplete new roles through effectiveConfig", () => {
  const config = configured({ profiles: { custom: { description: "Custom.", roles: { brandnew: { fast: true } } } } });
  const loaded: LoadedConfig = {
    config,
    defaults: DEFAULT_CONFIG,
    sources: [],
    issues: [{ source: "test", path: "old", message: "Existing issue.", severity: "warning" }],
    defaultsSource: "current",
  };
  const result = effectiveConfig(loaded, { profile: "custom" });
  assert.equal(result.config.roles.brandnew, undefined);
  assert.deepEqual(result.profile.issues, [{
    source: 'profile "custom"', path: "roles.brandnew", severity: "error",
    message: "a new role needs description, access, and chain; missing: description, access, chain",
  }]);
  assert.deepEqual(result.issues, loaded.issues);
});

test("profile errors name unknown names, cycles, and chains deeper than eight", () => {
  for (const name of ["missing", "constructor"]) {
    assert.throws(() => resolveProfile(DEFAULT_CONFIG, name), (error: unknown) => {
      assert.ok(omtExit(2)(error));
      assert.match(error.message, new RegExp(`unknown profile "${name}" in chain: ${name}`));
      assert.equal(error.hint, "known profiles: normal, prototype");
      return true;
    });
  }
  const broken = configured({ profiles: { custom: { description: "Custom.", extends: "missing" } } });
  assert.throws(() => resolveProfile(broken, "custom"), /custom -> missing/);
  const cycle = configured({ profiles: {
    a: { description: "A.", extends: "b" }, b: { description: "B.", extends: "a" },
    self: { description: "Self.", extends: "self" },
  } });
  assert.throws(() => resolveProfile(cycle, "a"), /profile cycle: a -> b -> a/);
  assert.throws(() => resolveProfile(cycle, "self"), /profile cycle: self -> self/);
  const implicit = configured({ profiles: { normal: { extends: "custom" }, custom: { description: "Custom." } } });
  assert.throws(() => resolveProfile(implicit, "custom"), /profile cycle: custom -> normal -> custom/);
  const deep = structuredClone(DEFAULT_CONFIG);
  for (let i = 1; i <= 8; i += 1) deep.profiles[`p${i}`] = { description: `Profile ${i}.`, extends: i === 1 ? "normal" : `p${i - 1}` };
  assert.equal(resolveProfile(deep, "p7").name, "p7");
  assert.throws(() => resolveProfile(deep, "p8"), (error: unknown) => {
    assert.ok(error instanceof OmtError);
    assert.equal(error.message, "profile chain exceeds 8 profiles: p8 -> p7 -> p6 -> p5 -> p4 -> p3 -> p2 -> p1 -> normal");
    return true;
  });
});

test("effectiveConfig selects argument, plan, project, user, then default without changing loaded config", async () => {
  const ctx = projectContext();
  const user = userConfigPath(ctx.env, ctx.homedir);
  const project = join(ctx.cwd, ".omt", "config.jsonc");
  assert.equal(effectiveConfig(await loadConfig(ctx)).profile.source, "default");
  writeFile(user, JSON.stringify({ profile: "prototype" }));
  assert.equal(effectiveConfig(await loadConfig(ctx)).profile.name, "prototype");
  assert.equal(effectiveConfig(await loadConfig(ctx)).profile.source, "config");
  writeFile(project, JSON.stringify({ profile: "custom", profiles: { custom: { description: "Custom." } } }));
  const loaded = await loadConfig(ctx);
  assert.equal(effectiveConfig(loaded).profile.name, "custom");
  assert.equal(effectiveConfig(loaded).profile.source, "config");
  assert.equal(effectiveConfig(loaded, { planProfile: "prototype" }).profile.name, "prototype");
  assert.equal(effectiveConfig(loaded, { planProfile: "prototype" }).profile.source, "plan");
  const argument = effectiveConfig(loaded, { profile: "normal", planProfile: "prototype" });
  assert.equal(argument.profile.name, "normal");
  assert.equal(argument.profile.source, "argument");
  assert.equal(argument.config.profile, "normal");
  assert.equal(loaded.config.profile, "custom");
  assert.deepEqual(argument.issues, loaded.issues);
  const retired = (source: string) => ({
    source, path: "", severity: "warning", message: 'profile "pr-review" is no longer used; normal runs the PR steps',
  });
  for (const [options, source] of [
    [{ profile: "pr-review" }, "--profile"],
    [{ profile: "pr-review", planProfile: "prototype" }, "--profile"],
    [{ planProfile: "pr-review" }, "plan header"],
  ] as const) {
    const result = effectiveConfig(loaded, options);
    assert.equal(result.profile.name, "normal");
    assert.equal(result.profile.workflow.review.ci, "off");
    assert.equal(result.config.profile, "normal");
    assert.deepEqual(result.issues, [...loaded.issues, retired(source)]);
  }
  writeFile(project, JSON.stringify({ profile: "normal" }));
  assert.equal(effectiveConfig(await loadConfig(ctx)).profile.source, "default");
});
