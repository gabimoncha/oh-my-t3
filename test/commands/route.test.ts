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
      target: { providerInstanceId: "codex", model: "gpt-6.2-sol", options: { reasoningEffort: "xhigh", serviceTier: "priority" } },
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

function ledger(lines: object[]): string {
  return lines.map((line) => JSON.stringify({ ts: "2026-10-06T00:00:00.000Z", status: "dispatched", ...line })).join("\n") + "\n";
}

test("route --against auto reads the worker from the ledger", async () => {
  const project = makeProject();
  project.writeOmt(
    "ledger.jsonl",
    ledger([
      { plan: "p", unit: "U1", role: "execute", provider: "codex", model: "gpt-6.2-sol" },
      { plan: "p", unit: "U2", role: "execute", provider: "claudeAgent", model: "claude-opus-5-5" },
      { plan: "p", unit: "U3", role: "execute", provider: "claudeAgent", model: "claude-opus-5-5" },
      { plan: "p", unit: "U2", role: "review", provider: "codex", model: "gpt-6.2-astra" },
    ]) + "not json\n",
  );
  const unit = await route(project, ["review", "--against", "auto", "--plan", "p", "--unit", "U1"]);
  const forUnit = unit.output;
  assert.equal(forUnit.delegateTask?.target.providerInstanceId, "claudeAgent");
  assert.deepEqual(forUnit.notes, [
    "--against auto: worker codex from the last work dispatch of unit U1",
    "cross-family: worker family codex; other families first",
  ]);
  assert.match(unit.ctx.err(), /^warning: .*ledger\.jsonl:5: skipped a malformed ledger line$/m);

  const oracle = await route(project, ["oracle", "--against", "auto", "--plan", "p", "--unit", "F2"]);
  const forOracle = oracle.output;
  assert.equal(forOracle.delegateTask?.target.providerInstanceId, "codex");
  assert.deepEqual(forOracle.notes, [
    "--against auto: worker claudeAgent from the provider of most units in plan p",
    "cross-family: worker family claudeAgent; the configured order applies",
  ]);

  const empty = await route(project, ["review", "--against", "auto", "--plan", "q"]);
  const forEmpty = empty.output;
  assert.equal(forEmpty.delegateTask?.target.providerInstanceId, "codex");
  assert.deepEqual(forEmpty.notes, ["--against auto: no worker dispatch with a provider in plan q; the configured order applies"]);

  const plain = await route(project, ["execute", "--against", "auto", "--plan", "p"]);
  assert.deepEqual(plain.output.notes, [
    "role execute is not cross-family; --against has no effect",
  ]);
});

test("route --against auto re-reviews each fix with the provider of its own fix worker", async () => {
  const project = makeProject();
  project.writeOmt(
    "ledger.jsonl",
    ledger([
      { plan: "review-x", unit: "G1", role: "review", provider: "codex", model: "gpt-6.2-astra" },
      { plan: "review-x", unit: "F1", role: "execute", provider: "codex", model: "gpt-6.2-sol" },
      { plan: "review-x", unit: "F2", role: "execute", provider: "claudeAgent", model: "claude-opus-5-5" },
      { plan: "review-x", unit: "F3", role: "execute", provider: "claudeAgent", model: "claude-opus-5-5" },
    ]),
  );
  const f1 = await route(project, ["review", "--against", "auto", "--plan", "review-x", "--unit", "F1"]);
  const forF1 = f1.output;
  assert.equal(forF1.delegateTask?.target.providerInstanceId, "claudeAgent");
  assert.equal(forF1.notes[0], "--against auto: worker codex from the last work dispatch of unit F1");
  const f2 = await route(project, ["review", "--against", "auto", "--plan", "review-x", "--unit", "F2"]);
  assert.equal(f2.output.delegateTask?.target.providerInstanceId, "codex");
});

test("route --against auto skips a worker entry whose provider is not a non-empty string, with a warning", async () => {
  const project = makeProject();
  project.writeOmt(
    "ledger.jsonl",
    ledger([
      { plan: "p", unit: "U1", role: "execute", provider: "codex", model: "gpt-6.2-sol" },
      { plan: "p", unit: "U1", role: "execute", provider: null, model: "claude-opus-5-5" },
      { plan: "p", unit: "U1", role: "execute", provider: "", model: "claude-opus-5-5" },
    ]),
  );
  const { ctx, output } = await route(project, ["review", "--against", "auto", "--plan", "p", "--unit", "U1"]);
  assert.equal(output.delegateTask?.target.providerInstanceId, "claudeAgent");
  assert.equal(output.notes[0], "--against auto: worker codex from the last work dispatch of unit U1");
  const warnings = ctx.err().split("\n").filter((line) => line.startsWith("warning: "));
  assert.equal(warnings.length, 2, ctx.err());
  assert.match(warnings[0] ?? "", /^warning: skipped a ledger entry with an invalid provider null \(role execute, unit U1, ts /);
  assert.match(warnings[1] ?? "", /invalid provider ""/);
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
  project.writeOmt(
    "ledger.jsonl",
    ledger([{ plan: "p", unit: "U1", role: "execute", provider: "claude-max", model: "claude-opus-5-5" }]),
  );
  const oracle = await route(project, ["oracle", "--against", "auto", "--plan", "p", "--unit", "U1"]);
  const forOracle = oracle.output;
  assert.equal(forOracle.delegateTask?.target.providerInstanceId, "codex-pro");
  assert.deepEqual(forOracle.fallbacks.map((f) => f.providerInstanceId), ["claude-max"]);
  assert.deepEqual(forOracle.notes.slice(0, 2), [
    "--against auto: worker claude-max from the last work dispatch of unit U1",
    "cross-family: worker family claudeAgent; other families first",
  ]);

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

test("route --against auto without --plan, or a bad --against value, is a usage error", async () => {
  const project = makeProject();
  const noPlan = await project.run(["route", "review", "--against", "auto"]);
  assert.equal(noPlan.code, 2);
  assert.match(noPlan.ctx.err(), /--against auto needs --plan <slug>/);
  assert.equal(noPlan.ctx.out(), "");
  assert.equal((await project.run(["route", "review", "--against", "no spaces"])).code, 2);
  assert.equal((await project.run(["route", "review", "--against", "auto", "--plan", "Bad_Slug"])).code, 2);
});
