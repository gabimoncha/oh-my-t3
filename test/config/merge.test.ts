import { test } from "bun:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { mergeLayer } from "../../src/config/merge.ts";
import type { Candidate } from "../../src/types.ts";

const CANDIDATE: Candidate = { driver: "codex", model: "gpt-6.2-astra", effort: "high" };

test("an empty layer returns an equal copy, and never mutates the base", () => {
  const before = structuredClone(DEFAULT_CONFIG);
  const { config, issues } = mergeLayer(DEFAULT_CONFIG, {}, "src");
  assert.deepEqual(issues, []);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.notEqual(config, DEFAULT_CONFIG);
  config.roles.review?.chain.push(CANDIDATE);
  config.limits.maxDepth = 3;
  assert.deepEqual(DEFAULT_CONFIG, before);
});

test("a role set to null is removed", () => {
  const { config, issues } = mergeLayer(DEFAULT_CONFIG, { roles: { oracle: null } }, "src");
  assert.equal(config.roles.oracle, undefined);
  assert.equal("oracle" in config.roles, false);
  assert.deepEqual(issues, []);
  assert.ok(DEFAULT_CONFIG.roles.oracle);
});

test("removing a role that does not exist is a warning", () => {
  const { issues } = mergeLayer(DEFAULT_CONFIG, { roles: { nope: null } }, "src");
  assert.deepEqual(issues.map((issue) => [issue.path, issue.severity]), [["roles.nope", "warning"]]);
});

test("an existing role is merged field by field, and chain replaces the old chain", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { review: { runtimeMode: "auto", chain: [CANDIDATE] } } },
    "src",
  );
  const base = DEFAULT_CONFIG.roles.review;
  assert.ok(base);
  assert.deepEqual(config.roles.review, { ...base, runtimeMode: "auto", chain: [CANDIDATE] });
});

test("a field-only override keeps the old chain", () => {
  const { config } = mergeLayer(DEFAULT_CONFIG, { roles: { execute: { description: "New." } } }, "src");
  assert.equal(config.roles.execute?.description, "New.");
  assert.deepEqual(config.roles.execute?.chain, DEFAULT_CONFIG.roles.execute?.chain);
});

test("a layer keeps, sets, or overrides crossFamily on an existing role", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { review: { crossFamily: false }, qa: { crossFamily: true }, oracle: { description: "Gate." } } },
    "src",
  );
  assert.equal(config.roles.review?.crossFamily, false);
  assert.deepEqual(config.roles.review?.chain, DEFAULT_CONFIG.roles.review?.chain);
  assert.equal(config.roles.qa?.crossFamily, true);
  assert.equal(config.roles.oracle?.crossFamily, true);
  const second = mergeLayer(config, { roles: { review: { crossFamily: true } } }, "project");
  assert.equal(second.config.roles.review?.crossFamily, true);
});

test("a new role keeps a given crossFamily and leaves it unset otherwise", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { audit: { description: "Audit.", access: "read-only", crossFamily: true, chain: [CANDIDATE] } } },
    "src",
  );
  assert.equal(config.roles.audit?.crossFamily, true);
  const plain = mergeLayer(DEFAULT_CONFIG, { roles: { audit: { description: "A.", access: "edit", chain: [CANDIDATE] } } }, "src");
  assert.equal("crossFamily" in (plain.config.roles.audit ?? {}), false);
});

test("a new edit role gets the edit defaults", () => {
  const { config, issues } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { builder: { description: "Build.", access: "edit", chain: [CANDIDATE] } } },
    "src",
  );
  assert.deepEqual(issues, []);
  assert.deepEqual(config.roles.builder, {
    description: "Build.",
    access: "edit",
    result: "work",
    t3Role: "implementation",
    interactionMode: "default",
    runtimeMode: "inherit",
    chain: [CANDIDATE],
  });
});

test("a new read-only role gets the read-only defaults, and given fields win", () => {
  const { config } = mergeLayer(
    DEFAULT_CONFIG,
    { roles: { scout: { description: "Look.", access: "read-only", t3Role: "review", chain: [CANDIDATE] } } },
    "src",
  );
  assert.deepEqual(config.roles.scout, {
    description: "Look.",
    access: "read-only",
    result: "research",
    t3Role: "review",
    interactionMode: "plan",
    runtimeMode: "inherit",
    chain: [CANDIDATE],
  });
});

test("a new role without description, access, or chain is dropped with an error", () => {
  const { config, issues } = mergeLayer(DEFAULT_CONFIG, { roles: { half: { access: "edit" } } }, "src");
  assert.equal(config.roles.half, undefined);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.path, "roles.half");
  assert.equal(issues[0]?.severity, "error");
  assert.equal(issues[0]?.source, "src");
  assert.match(issues[0]?.message ?? "", /missing: description, chain$/);
});

test("a role removed in one layer can be added back as a new role in a later one", () => {
  const first = mergeLayer(DEFAULT_CONFIG, { roles: { quick: null } }, "user").config;
  const half = mergeLayer(first, { roles: { quick: { chain: [CANDIDATE] } } }, "project");
  assert.equal(half.config.roles.quick, undefined);
  assert.equal(half.issues[0]?.severity, "error");
});

test("each limit field replaces the old value", () => {
  const { config } = mergeLayer(DEFAULT_CONFIG, { limits: { maxReviewRounds: 8 } }, "src");
  assert.deepEqual(config.limits, { ...DEFAULT_CONFIG.limits, maxReviewRounds: 8 });
});

test("the result does not share arrays with the layer", () => {
  const chain = [CANDIDATE];
  const { config } = mergeLayer(DEFAULT_CONFIG, { roles: { review: { chain } } }, "src");
  chain.push(CANDIDATE);
  assert.equal(config.roles.review?.chain.length, 1);
});
