import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import type { BriefJsonOutput } from "../../src/types.ts";
import { makeProject } from "./shared.ts";

function parse(text: string): BriefJsonOutput {
  return JSON.parse(text) as BriefJsonOutput;
}

const CROSS_CHAIN = {
  version: 1,
  roles: {
    review: {
      chain: [
        { provider: "codex", driver: "codex", model: "gpt-6.2-astra", effort: "medium" },
        { provider: "claudeAgent", driver: "claudeAgent", model: "claude-opus-5-5", effort: "medium" },
        { provider: "codex", driver: "codex", model: "gpt-6.2-sol", effort: "high" },
      ],
    },
  },
};

// The caller keeps the tried target keys; omt keeps no record of the attempts.
test("brief --fallback walks the resolved order past each --tried key, and stops when no target is left", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify(CROSS_CHAIN));
  const args = ["brief", "review", "--task", "Review U1.", "--plan", "p", "--unit", "REVIEW", "--against", "codex", "--save", "--json"];
  const first = parse((await project.runOk(args)).ctx.out());
  assert.equal(first.targetKey, "claudeAgent/claude-opus-5-5");
  const second = parse((await project.runOk([...args, "--fallback", "--attempt", "2", "--tried", first.targetKey])).ctx.out());
  assert.equal(second.targetKey, "codex/gpt-6.2-astra");
  assert.equal(second.delegateTask.clientRequestId, "omt:p:REVIEW:review:r1:a2");
  const tried = ["--tried", first.targetKey, "--tried", second.targetKey];
  const third = parse((await project.runOk([...args, "--fallback", "--attempt", "3", ...tried])).ctx.out());
  assert.equal(third.targetKey, "codex/gpt-6.2-sol");
  assert.deepEqual(third.fallbacks, []);
  const none = await project.run([...args, "--fallback", "--attempt", "4", ...tried, "--tried", third.targetKey]);
  assert.equal(none.code, 1);
  assert.match(none.ctx.err(), /no fallback left for review; tried: claudeAgent\/claude-opus-5-5, codex\/gpt-6.2-astra, codex\/gpt-6\.2-sol/);
  assert.equal(existsSync(join(project.cwd, ".omt3", "ledger.jsonl")), false);
});

test("brief --fallback needs --attempt, and --tried needs --fallback", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify(CROSS_CHAIN));
  const args = ["brief", "review", "--task", "Review U1.", "--plan", "p", "--unit", "REVIEW", "--against", "codex", "--json"];
  assert.equal((await project.run([...args, "--fallback"])).code, 2);
  assert.equal((await project.run([...args, "--tried", "x/y"])).code, 2);
});

test("brief --strict tries Sol at priority after ultrafast, then stops when only the --against family is left", async () => {
  const project = makeProject();
  const args = ["brief", "review", "--task", "Review U1.", "--plan", "p", "--unit", "REVIEW", "--against", "claudeAgent", "--strict", "--json"];
  const first = parse((await project.runOk(args)).ctx.out());
  assert.equal(first.targetKey, "codex/gpt-6.2-sol@ultrafast");
  const second = parse((await project.runOk([...args, "--fallback", "--attempt", "2", "--tried", first.targetKey])).ctx.out());
  assert.equal(second.targetKey, "codex/gpt-6.2-sol@priority");
  assert.equal(second.delegateTask.target.options?.serviceTier, "priority");
  const same = await project.run([...args, "--fallback", "--attempt", "3", "--tried", first.targetKey, "--tried", second.targetKey]);
  assert.equal(same.code, 1);
  assert.match(same.ctx.err(), /no review target outside claudeAgent is left/);
  assert.equal((await project.run(["brief", "review", "--task", "x", "--strict", "--json"])).code, 2);
});

// The omt workflows walk the fallbacks with agent.try, so a same-family fallback there would review the author's own work.
test("brief --strict leaves the --against family out of the fallbacks", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify(CROSS_CHAIN));
  const out = parse((await project.runOk(["brief", "review", "--task", "x", "--against", "claudeAgent", "--strict", "--json"])).ctx.out());
  assert.equal(out.delegateTask.target.model, "gpt-6.2-astra");
  assert.deepEqual(out.fallbacks.map((target) => target.model), ["gpt-6.2-sol"]);
  const loose = parse((await project.runOk(["brief", "review", "--task", "x", "--against", "claudeAgent", "--json"])).ctx.out());
  assert.deepEqual(loose.fallbacks.map((target) => target.model), ["gpt-6.2-sol", "claude-opus-5-5"]);
});

test("brief --workflow lets an edit role commit in its worktree and asks for structured output", async () => {
  const project = makeProject();
  const review = (await project.runOk(["brief", "review", "--task", "x", "--workflow"])).ctx.out();
  assert.match(review, /Commit your changes there with `git commit`/);
  assert.doesNotMatch(review, /Do not commit, push, or create branches/);
  assert.match(review, /Submit your result as the structured output/);
  const qa = (await project.runOk(["brief", "qa", "--task", "x", "--workflow"])).ctx.out();
  assert.match(qa, /your own git worktree\. Do not commit, push, or create branches\./);
  const plain = (await project.runOk(["brief", "review", "--task", "x"])).ctx.out();
  assert.match(plain, /Do not commit, push, or create branches/);
  assert.match(plain, /End your work with the block below/);
});

test("a candidate that names only a driver gets one retry as a provider instance before the next candidate", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({ version: 1, roles: { explore: { chain: [{ driver: "codex", model: "gpt-6.1-terra", effort: "low" }] } } }));
  const args = ["brief", "explore", "--task", "Answer question E1.", "--plan", "p", "--unit", "E1", "--json"];
  const first = parse((await project.runOk(args)).ctx.out());
  assert.deepEqual([first.targetKey, first.delegateTask.target.driverKind], ["driver:codex/gpt-6.1-terra", "codex"]);
  const retry = parse((await project.runOk([...args, "--fallback", "--attempt", "2", "--tried", first.targetKey])).ctx.out());
  assert.deepEqual([retry.targetKey, retry.delegateTask.target.providerInstanceId], ["codex/gpt-6.1-terra", "codex"]);
  assert.equal((await project.run([...args, "--fallback", "--attempt", "3", "--tried", first.targetKey, "--tried", retry.targetKey])).code, 1);
});
