import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import type { BriefJsonOutput, LedgerEntry } from "../../src/types.ts";
import { makeProject } from "./shared.ts";
import type { Project } from "./shared.ts";

function parse(text: string): BriefJsonOutput {
  return JSON.parse(text) as BriefJsonOutput;
}

function ledger(project: Project): LedgerEntry[] {
  const text = readFileSync(join(project.cwd, ".omt", "ledger.jsonl"), "utf8");
  return text.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as LedgerEntry);
}

function brief(unit: string, ...extra: string[]): string[] {
  return ["brief", "explore", "--task", `Answer question ${unit}.`, "--plan", "p", "--unit", unit, "--save", "--json", ...extra];
}

const CROSS_CHAIN = {
  version: 1,
  roles: {
    review: {
      chain: [
        { provider: "codex", driver: "codex", model: "gpt-6-astra", effort: "medium" },
        { provider: "claudeAgent", driver: "claudeAgent", model: "claude-opus-5-5", effort: "medium" },
        { provider: "codex", driver: "codex", model: "gpt-6.1-sol", effort: "high" },
      ],
    },
  },
};

test("brief --save records a start; at the limit it exits 75 and writes nothing; a resend at the limit prints the same output", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({ version: 1, limits: { maxParallel: 1 } }));
  const first = parse((await project.runOk(brief("E1"))).ctx.out());
  assert.equal(first.delegateTask.clientRequestId, "omt:p:E1:explore:r1:a1");
  assert.match(first.ledger?.done ?? "", / ledger done omt:p:E1:explore:r1:a1 --verdict <VERDICT>$/);
  assert.equal(ledger(project).length, 1);

  const blocked = await project.run(brief("E2"));
  assert.equal(blocked.code, 75);
  assert.equal(blocked.ctx.out(), "");
  assert.match(blocked.ctx.err(), /limit: 1 of 1 children are active; run this command again after one ends/);
  assert.equal(ledger(project).length, 1);
  assert.deepEqual(readdirSync(join(project.cwd, ".omt", "evidence", "briefs")), ["omt:p:E1:explore:r1:a1.md"]);

  const resent = parse((await project.runOk(brief("E1"))).ctx.out());
  assert.deepEqual(resent, first);
  assert.equal(ledger(project).length, 1);
});

test("two briefs started at once with one slot left give one start and one exit 75", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({ version: 1, limits: { maxParallel: 1 } }));
  const results = await Promise.all([project.run(brief("E1")), project.run(brief("E2"))]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 75]);
  const starts = ledger(project).filter((entry) => entry.status === "dispatched");
  assert.equal(starts.length, 1);
});

test("ledger done closes a start that has no task id, also with --task-id, and stats agree", async () => {
  const project = makeProject();
  const output = parse((await project.runOk(brief("E1"))).ctx.out());
  const id = output.delegateTask.clientRequestId as string;
  assert.match((await project.runOk(["ledger", "stats", "--plan", "p"])).ctx.out(), /^active: 1$/m);
  const done = await project.runOk(["ledger", "done", id, "--verdict", "ANSWER", "--task-id", "t1"]);
  assert.equal(done.ctx.out(), "closed E1 explore r1 a1\nsettle: allowed\n");
  const closing = ledger(project).at(-1) as LedgerEntry;
  assert.deepEqual([closing.status, closing.clientRequestId, closing.taskId, closing.verdict], ["completed", id, "t1", "ANSWER"]);
  const stats = JSON.parse((await project.runOk(["ledger", "stats", "--plan", "p", "--json"])).ctx.out()) as { active: number };
  assert.equal(stats.active, 0);

  const again = await project.run(["ledger", "done", id]);
  assert.equal(again.code, 1);
  assert.match(again.ctx.err(), /no open child matches omt:p:E1:explore:r1:a1/);
  assert.equal((await project.run(["ledger", "done", id, "--status", "verified"])).code, 2);
});

test("brief --fallback follows the resolved order, closes the superseded attempt, and stops when no target is left", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify(CROSS_CHAIN));
  const args = ["brief", "review", "--task", "Review U1.", "--plan", "p", "--unit", "REVIEW", "--against", "codex", "--save", "--json"];
  const first = parse((await project.runOk(args)).ctx.out());
  assert.equal(first.targetKey, "claudeAgent/claude-opus-5-5");
  const second = parse((await project.runOk([...args, "--fallback"])).ctx.out());
  assert.equal(second.targetKey, "codex/gpt-6-astra");
  assert.equal(second.delegateTask.clientRequestId, "omt:p:REVIEW:review:r1:a2");
  const third = parse((await project.runOk([...args, "--fallback"])).ctx.out());
  assert.equal(third.targetKey, "codex/gpt-6.1-sol");
  assert.deepEqual(third.fallbacks, []);
  const none = await project.run([...args, "--fallback"]);
  assert.equal(none.code, 1);
  assert.match(none.ctx.err(), /no fallback left for review; tried: claudeAgent\/claude-opus-5-5, codex\/gpt-6-astra, codex\/gpt-6\.1-sol/);

  const entries = ledger(project);
  const starts = entries.filter((entry) => entry.status === "dispatched");
  assert.deepEqual(starts.map((entry) => [entry.attempt, entry.targetKey]), [
    [1, "claudeAgent/claude-opus-5-5"],
    [2, "codex/gpt-6-astra"],
    [3, "codex/gpt-6.1-sol"],
  ]);
  const superseded = entries.filter((entry) => entry.status === "failed");
  assert.deepEqual(superseded.map((entry) => [entry.attempt, entry.note]), [
    [1, "superseded by attempt 2"],
    [2, "superseded by attempt 3"],
  ]);
  assert.match((await project.runOk(["ledger", "stats", "--plan", "p"])).ctx.out(), /^active: 1$/m);
  assert.equal((await project.run([...args, "--fallback", "--attempt", "4"])).code, 2);
});

test("brief --fallback --tried works without --save and writes nothing", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify(CROSS_CHAIN));
  const args = ["brief", "review", "--task", "Review U1.", "--plan", "p", "--unit", "REVIEW", "--against", "codex", "--json"];
  const next = parse((await project.runOk([...args, "--fallback", "--tried", "claudeAgent/claude-opus-5-5", "--attempt", "2"])).ctx.out());
  assert.equal(next.targetKey, "codex/gpt-6-astra");
  assert.equal(next.delegateTask.clientRequestId, "omt:p:REVIEW:review:r1:a2");
  assert.equal(next.ledger, undefined);
  assert.equal((await project.run([...args, "--fallback"])).code, 2);
  assert.equal((await project.run([...args, "--tried", "x/y"])).code, 2);
});

test("brief --strict stops when the only target left is in the --against family", async () => {
  const project = makeProject();
  const args = ["brief", "review", "--task", "Review U1.", "--plan", "p", "--unit", "REVIEW", "--against", "claudeAgent", "--strict", "--save", "--json"];
  const first = parse((await project.runOk(args)).ctx.out());
  assert.equal(first.delegateTask.target.providerInstanceId, "codex");
  const same = await project.run([...args, "--fallback"]);
  assert.equal(same.code, 1);
  assert.match(same.ctx.err(), /no review target outside claudeAgent is left/);
  assert.equal(ledger(project).filter((entry) => entry.status === "dispatched").length, 1);
  assert.equal((await project.run(["brief", "review", "--task", "x", "--strict", "--json"])).code, 2);
});

test("a rung that names only a driver gets one retry as a provider instance before the next rung", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({ version: 1, roles: { explore: { chain: [{ driver: "codex", model: "gpt-6.1-terra", effort: "low" }] } } }));
  const first = parse((await project.runOk(brief("E1"))).ctx.out());
  assert.deepEqual([first.targetKey, first.delegateTask.target.driverKind], ["driver:codex/gpt-6.1-terra", "codex"]);
  const retry = parse((await project.runOk(brief("E1", "--fallback"))).ctx.out());
  assert.deepEqual([retry.targetKey, retry.delegateTask.target.providerInstanceId], ["codex/gpt-6.1-terra", "codex"]);
  assert.equal((await project.run(brief("E1", "--fallback"))).code, 1);
});

test("ledger settle-check and done print settle: no in a linked worktree", async () => {
  const project = makeProject();
  const main = join(project.root, "main");
  const worktree = join(project.root, "wt");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  writeFileSync(join(main, ".git", "config"), "[core]\n\tbare = false\n");
  writeFileSync(join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
  assert.equal((await project.runOk(["ledger", "settle-check"], { cwd: worktree })).ctx.out(), "settle: no (linked worktree)\n");
  assert.equal((await project.runOk(["ledger", "settle-check"])).ctx.out(), "settle: allowed\n");
});

test("a closed request id cannot start new work; the next attempt can", async () => {
  const project = makeProject();
  const output = parse((await project.runOk(brief("E1"))).ctx.out());
  await project.runOk(["ledger", "done", output.delegateTask.clientRequestId as string, "--verdict", "ANSWER"]);
  const again = await project.run(brief("E1"));
  assert.equal(again.code, 1);
  assert.match(again.ctx.err(), /omt:p:E1:explore:r1:a1 already ran and is closed/);
  const next = parse((await project.runOk(brief("E1", "--attempt", "2"))).ctx.out());
  assert.equal(next.delegateTask.clientRequestId, "omt:p:E1:explore:r1:a2");
  assert.match((await project.runOk(["ledger", "stats", "--plan", "p"])).ctx.out(), /^active: 1$/m);
});

test("the ledger lock clears an old lock of a dead process, waits for a live one, and never removes another owner's lock", async () => {
  const project = makeProject();
  const lock = join(project.cwd, ".omt", "locks", "ledger.lock");
  const old = new Date(Date.now() - 60_000);
  mkdirSync(join(project.cwd, ".omt", "locks"), { recursive: true });
  writeFileSync(lock, "999999999 dead-token\n");
  utimesSync(lock, old, old);
  await project.runOk(brief("E1"));
  assert.equal(existsSync(lock), false);

  writeFileSync(lock, `${process.pid} live-token\n`);
  utimesSync(lock, old, old);
  const held = await project.run(brief("E2"));
  assert.equal(held.code, 75);
  assert.equal(readFileSync(lock, "utf8"), `${process.pid} live-token\n`);
}, 15_000);
