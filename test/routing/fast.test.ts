import assert from "node:assert/strict";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { resolveAll, resolveRole, toRouteOutput } from "../../src/routing/resolve.ts";
import type { ModelConfig, OptionValue, Candidate } from "../../src/types.ts";
import { liveCaps, role } from "./shared.ts";

test("fast mode uses the live model descriptors and reports models without a fast option", () => {
  const capabilities = liveCaps();
  for (const provider of capabilities.providers) {
    for (const model of provider.models) {
      const resolution = resolveRole("r", role([{ provider: provider.providerInstanceId, model: model.id, fast: true }]), capabilities);
      const options = resolution.delegateTask?.target.options;
      if (provider.driverKind === "codex") {
        assert.deepEqual(options, { serviceTier: "priority" }, model.id);
      } else if (model.id === "claude-opus-5-5") {
        assert.deepEqual(options, { fastMode: true });
      } else {
        assert.equal(options, undefined, model.id);
        assert.deepEqual(toRouteOutput(resolution).notes, [`candidate 1: fast mode is not offered by claudeAgent/${model.id}`]);
      }
      assert.equal(resolution.status, "resolved", model.id);
    }
  }
});

test("ultrafast asks for the ultrafast tier only where offered and falls back to fast mode with a note", () => {
  const cases: [Candidate, Record<string, OptionValue> | undefined, string | undefined][] = [
    [{ driver: "codex", model: "gpt-6.2-sol" }, { serviceTier: "ultrafast" }, undefined],
    [{ driver: "codex", model: "gpt-6.2-astra" }, { serviceTier: "priority" }, "ultrafast is not offered by codex/gpt-6.2-astra; using fast mode"],
    [{ driver: "claudeAgent", model: "claude-opus-5-5" }, { fastMode: true }, "ultrafast is not offered by claudeAgent/claude-opus-5-5; using fast mode"],
    [{ driver: "claudeAgent", model: "claude-haiku-5-5" }, undefined, "fast mode is not offered by claudeAgent/claude-haiku-5-5"],
  ];
  for (const [candidate, expected, note] of cases) {
    const resolution = resolveRole("r", role([{ ...candidate, fast: "ultrafast" }]), liveCaps());
    assert.equal(resolution.status, "resolved", candidate.model);
    assert.deepEqual(resolution.delegateTask?.target.options, expected, candidate.model);
    assert.deepEqual(resolution.attempts[0]?.notes, note === undefined ? [] : [note], candidate.model);
  }
  const unverified = resolveRole("r", { ...role([{ driver: "codex", model: "gpt-6.2-sol" }]), fast: "ultrafast" });
  assert.deepEqual(unverified.delegateTask?.target.options, { serviceTier: "ultrafast" });
});

test("fast mode without capabilities uses Codex and Opus defaults only", () => {
  const cases: [Candidate, Record<string, OptionValue> | undefined][] = [
    [{ driver: "codex", model: "gpt-6.2-sol" }, { serviceTier: "priority" }],
    [{ provider: "codex", model: "gpt-6.2-astra" }, { serviceTier: "priority" }],
    [{ provider: "claude-work", driver: "claudeAgent", model: "claude-opus-5-5" }, { fastMode: true }],
    [{ driver: "claudeAgent", model: "claude-sonnet-5-5" }, undefined],
    [{ driver: "claudeAgent", model: "claude-haiku-5-5" }, undefined],
    [{ driver: "unknown", model: "m" }, undefined],
  ];
  for (const [candidate, expected] of cases) {
    const resolution = resolveRole("r", role([{ ...candidate, fast: true }]));
    assert.deepEqual(resolution.delegateTask?.target.options, expected, candidate.model);
    assert.deepEqual(resolution.attempts[0]?.notes, expected === undefined
      ? [`fast mode is not offered by ${candidate.provider ?? candidate.driver}/${candidate.model}`] : []);
  }
});

test("fast mode resolves candidate, role, and model values in order, including false", () => {
  const cases: [boolean | undefined, boolean | undefined, boolean | undefined, boolean][] = [
    [true, false, false, true],
    [false, true, true, false],
    [undefined, true, false, true],
    [undefined, false, true, false],
    [undefined, undefined, true, true],
    [undefined, undefined, false, false],
    [undefined, undefined, undefined, false],
  ];
  for (const capabilities of [undefined, liveCaps()]) {
    for (const [candidateFast, roleFast, modelFast, expected] of cases) {
      const candidate: Candidate = { driver: "codex", model: "gpt-6.2-sol" };
      const config = role([candidate]);
      const model: ModelConfig = {};
      if (candidateFast !== undefined) candidate.fast = candidateFast;
      if (roleFast !== undefined) config.fast = roleFast;
      if (modelFast !== undefined) model.fast = modelFast;
      const resolution = resolveRole("r", config, capabilities, { models: { [candidate.model]: model } });
      assert.deepEqual(resolution.delegateTask?.target.options, expected ? { serviceTier: "priority" } : undefined);
    }
  }
});

test("fast off sends fastMode false to Claude models with the toggle, so a child does not inherit a fast parent", () => {
  const cases: [Candidate, Record<string, OptionValue> | undefined][] = [
    [{ driver: "claudeAgent", model: "claude-opus-5-5" }, { fastMode: false }],
    [{ driver: "claudeAgent", model: "claude-sonnet-5-5" }, undefined],
    [{ driver: "codex", model: "gpt-6.2-sol" }, undefined],
  ];
  for (const capabilities of [undefined, liveCaps()]) {
    for (const [candidate, expected] of cases) {
      const resolution = resolveRole("r", role([{ ...candidate, fast: false }]), capabilities);
      assert.deepEqual(resolution.delegateTask?.target.options, expected, candidate.model);
      assert.deepEqual(resolution.attempts[0]?.notes, [], candidate.model);
    }
  }
  const report = resolveAll(DEFAULT_CONFIG, liveCaps());
  assert.deepEqual(report.roles.execute?.delegateTask?.target.options, { effort: "medium", fastMode: false });
});

test("raw candidate options override fast mappings with and without capabilities", () => {
  const candidates: Candidate[] = [
    { driver: "codex", model: "gpt-6.2-sol", effort: "high", options: { serviceTier: "default" } },
    { driver: "claudeAgent", model: "claude-opus-5-5", effort: "high", options: { fastMode: false } },
  ];
  for (const capabilities of [undefined, liveCaps()]) {
    for (const candidate of candidates) {
      const resolution = resolveRole("r", role([{ ...candidate, fast: true }]), capabilities);
      assert.equal(resolution.status, capabilities === undefined ? "unverified" : "resolved");
      assert.deepEqual(resolution.delegateTask?.target.options, {
        [candidate.driver === "codex" ? "reasoningEffort" : "effort"]: "high",
        ...candidate.options,
      });
    }
  }
});

test("known capabilities never infer a fast option when descriptors are absent or do not offer priority", () => {
  for (const models of [[], [{ id: "gpt-6.2-sol", options: [] }], [{ id: "gpt-6.2-sol", options: [
    { id: "serviceTier", type: "select", options: [{ id: "default" }] },
  ] }]]) {
    const capabilities = liveCaps();
    capabilities.providers[0]!.models = models;
    const resolution = resolveRole("r", role([{ driver: "codex", model: "gpt-6.2-sol", fast: true }]), capabilities);
    assert.equal(resolution.delegateTask?.target.options, undefined);
    assert.ok(toRouteOutput(resolution).notes.includes("candidate 1: fast mode is not offered by codex/gpt-6.2-sol"));
  }
});

test("model fast settings use own keys, including model ids that name Object properties", () => {
  const models: Record<string, ModelConfig> = Object.create({ "gpt-6.2-sol": { fast: true } });
  assert.equal(resolveRole("r", role([{ driver: "codex", model: "gpt-6.2-sol" }]), undefined, { models })
    .delegateTask?.target.options, undefined);
  for (const model of ["toString", "__proto__"]) {
    const own = JSON.parse(`{"${model}":{"fast":true}}`) as Record<string, ModelConfig>;
    assert.deepEqual(resolveRole("r", role([{ driver: "codex", model }]), undefined, { models: own })
      .delegateTask?.target.options, { serviceTier: "priority" });
  }
});

test("resolveAll applies the default Sol fast setting to the chosen target and fallbacks", () => {
  const report = resolveAll(DEFAULT_CONFIG, liveCaps());
  assert.equal(report.roles.research?.delegateTask?.target.options?.serviceTier, "priority");
  assert.equal(report.roles.execute?.fallbacks[0]?.options?.serviceTier, "priority");
  assert.equal(report.roles.qa?.delegateTask?.target.options?.serviceTier, "priority");
});
