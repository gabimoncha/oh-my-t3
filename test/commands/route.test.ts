import assert from "node:assert/strict";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { RouteOutput } from "../../src/types.ts";
import { CAPS_FILE, makeProject } from "./shared.ts";
import type { Project } from "./shared.ts";

async function route(project: Project, argv: string[]) {
  const { code, ctx } = await project.run(["route", ...argv]);
  assert.equal(code, 0, ctx.err());
  return { ctx, output: JSON.parse(ctx.out()) as RouteOutput };
}

test("route prints an unverified RouteOutput and exits 0", async () => {
  const { output } = await route(makeProject(), ["review"]);
  assert.deepEqual(output, {
    role: "review",
    status: "unverified",
    description: DEFAULT_CONFIG.roles.review?.description,
    access: "edit",
    result: "review",
    delegateTask: {
      target: { providerInstanceId: "codex", model: "gpt-6.2-sol", options: { reasoningEffort: "xhigh", serviceTier: "ultrafast" } },
      role: "review",
      interactionMode: "default",
      runtimeMode: "inherit",
    },
    fallbacks: [{ providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "high" } }],
    notes: [],
  });
});

test("route --capabilities resolves against the provider instances", async () => {
  const { output } = await route(makeProject(), ["execute", "--capabilities", CAPS_FILE]);
  assert.equal(output.status, "resolved");
  assert.deepEqual(output.delegateTask?.target, {
    providerInstanceId: "claudeAgent",
    model: "claude-opus-5-5",
    options: { effort: "medium" },
  });
});

test("route prints an unavailable role without delegateTask and exits 1", async () => {
  const project = makeProject();
  project.projectConfig('{ "version": 1, "roles": { "oracle": { "chain": [{ "driver": "grok", "model": "grok-build" }] } } }\n');
  const { code, ctx } = await project.run(["route", "oracle", "--capabilities", CAPS_FILE]);
  assert.equal(code, 1);
  const output = JSON.parse(ctx.out()) as RouteOutput;
  assert.equal(output.status, "unavailable");
  assert.equal(output.delegateTask, undefined);
  assert.match(output.notes[0] ?? "", /^candidate 1: provider grok cannot run child tasks: /);
});

test("route fails on an unknown role and needs exactly one role", async () => {
  const project = makeProject();
  const unknown = await project.run(["route", "nope"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.ctx.err(), /unknown role nope; known roles: /);
  assert.equal((await project.run(["route"])).code, 2);
  assert.equal((await project.run(["route", "review", "execute"])).code, 2);
});

test("route --against reorders a cross-family role and prints the note", async () => {
  const project = makeProject();
  const claude = await route(project, ["review", "--against", "claudeAgent"]);
  const againstClaude = claude.output;
  assert.equal(againstClaude.delegateTask?.target.providerInstanceId, "codex");
  assert.deepEqual(againstClaude.notes, ["cross-family: worker family claudeAgent; the configured order applies"]);
  const codex = await route(project, ["review", "--against", "codex", "--capabilities", CAPS_FILE]);
  const againstCodex = codex.output;
  assert.deepEqual(againstCodex.delegateTask?.target, {
    providerInstanceId: "claudeAgent",
    model: "claude-opus-5-5",
    options: { effort: "high" },
  });
  assert.deepEqual(againstCodex.fallbacks, [
    { providerInstanceId: "codex", model: "gpt-6.2-sol", options: { reasoningEffort: "xhigh", serviceTier: "priority" } },
  ]);
});

test("route --against on a role that is not cross-family has no effect and says so", async () => {
  const project = makeProject();
  const plain = await route(project, ["execute", "--against", "codex", "--plan", "p"]);
  assert.deepEqual(plain.output.notes, ["role execute is not cross-family; --against has no effect"]);
});

test("route --against maps a configured provider instance to its driver without capabilities", async () => {
  const project = makeProject();
  project.projectConfig(
    JSON.stringify({
      version: 1,
      roles: {
        execute: { chain: [{ provider: "claude-max", driver: "claudeAgent", model: "claude-opus-5-5", effort: "medium" }] },
        review: {
          chain: [
            { provider: "claude-max", driver: "claudeAgent", model: "claude-opus-5-5", effort: "high" },
            { provider: "codex-pro", driver: "codex", model: "gpt-6.2-astra", effort: "high" },
          ],
        },
      },
    }) + "\n",
  );
  const mapped = await route(project, ["review", "--against", "claude-max"]);
  const output = mapped.output;
  assert.equal(output.delegateTask?.target.providerInstanceId, "codex-pro");
  assert.deepEqual(output.notes, ["cross-family: worker family claudeAgent; other families first"]);

  const unknown = await route(project, ["review", "--against", "claude-other"]);
  const forUnknown = unknown.output;
  assert.equal(forUnknown.delegateTask?.target.providerInstanceId, "claude-max");
  assert.deepEqual(forUnknown.notes, [
    "cross-family: no candidate is in family claude-other; check that --against names a driver or a configured provider, or pass --capabilities",
  ]);
});

test("route --against maps a candidate that names only a provider through the configured drivers, like the worker", async () => {
  const project = makeProject();
  project.projectConfig(
    JSON.stringify({
      version: 1,
      roles: {
        execute: { chain: [{ provider: "claude-max", driver: "claudeAgent", model: "claude-opus-5-5", effort: "medium" }] },
        oracle: {
          chain: [
            { provider: "claude-max", model: "claude-opus-5-5", effort: "high" },
            { provider: "codex-pro", model: "gpt-6.2-astra", effort: "high" },
          ],
        },
        review: {
          chain: [
            { provider: "claude-max", model: "claude-opus-5-5", effort: "high" },
            { provider: "codex", driver: "codex", model: "gpt-6.2-astra", effort: "high" },
          ],
        },
      },
    }) + "\n",
  );
  const oracle = await route(project, ["oracle", "--against", "claude-max", "--plan", "p"]);
  const forOracle = oracle.output;
  assert.equal(forOracle.delegateTask?.target.providerInstanceId, "codex-pro");
  assert.deepEqual(forOracle.fallbacks.map((f) => f.providerInstanceId), ["claude-max"]);
  assert.equal(forOracle.notes[0], "cross-family: worker family claudeAgent; other families first");

  const review = await route(project, ["review", "--against", "claude-max"]);
  const forReview = review.output;
  assert.deepEqual(forReview.delegateTask?.target, {
    providerInstanceId: "codex",
    model: "gpt-6.2-astra",
    options: { reasoningEffort: "high", serviceTier: "priority" },
  });
  assert.deepEqual(forReview.fallbacks.map((f) => f.providerInstanceId), ["claude-max"]);
  assert.equal(forReview.notes[0], "cross-family: worker family claudeAgent; other families first");
});

// The ledger that --against auto read is gone, so an old skill that still passes auto must get a clear usage error.
test("route --against auto, a bad --against value, and --unit are usage errors", async () => {
  const project = makeProject();
  const auto = await project.run(["route", "review", "--against", "auto", "--plan", "p"]);
  assert.equal(auto.code, 2);
  assert.match(auto.ctx.err(), /--against auto is no longer supported/);
  assert.equal(auto.ctx.out(), "");
  assert.equal((await project.run(["route", "review", "--against", "no spaces"])).code, 2);
  assert.equal((await project.run(["route", "review", "--against", "codex", "--plan", "Bad_Slug"])).code, 2);
  assert.equal((await project.run(["route", "review", "--against", "codex", "--unit", "U1"])).code, 2);
});
