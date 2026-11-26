import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { PACKAGE_ROOT } from "./helpers.ts";

// T3 replays a run against the body of its workflow version, so a changed body needs a new version.
// Each entry maps the workflow versions that workflows/omt.ts defines to the hash of the file that shipped them.
const SHIPPED: Record<string, string> = {
  "omt-ulw@1 omt-code-review@1": "932ed2be4e93d5f4052c2bc5b5dc4901ea20dfe673607d35bd79c2a102c32fea",
  "omt-ulw@1 omt-code-review@1 omt-climb@1": "b5cb9a646c0617fa64babc423e71525b63d0b1830a6dc49ce0b1821c53c1fe89",
  "omt-ulw@2 omt-code-review@2 omt-climb@1": "4263635e1fbcf207cbc9a0019547302f7c16fa159b37cfae5b12afa8e79cf206",
  "omt-ulw@3 omt-code-review@3 omt-climb@2": "5e0a57fd8b79944193112c9ea1aad0b0413dfa1e6a4f9453876d4b87190be7d9",
};

test("workflows/omt.ts raises a workflow version whenever its text changes", () => {
  const text = readFileSync(join(PACKAGE_ROOT, "workflows", "omt.ts"), "utf8");
  const versions = [...text.matchAll(/\bworkflow\(\s*"([^"]+)",\s*\{\s*version:\s*(\d+)/g)].map((match) => `${match[1]}@${match[2]}`);
  const key = versions.join(" ");
  const hash = createHash("sha256").update(text).digest("hex");
  assert.ok(key in SHIPPED, `add "${key}": "${hash}" to SHIPPED after you raise the version of each changed workflow`);
  assert.equal(SHIPPED[key], hash, `workflows/omt.ts changed: raise the version of each changed workflow, then add "<versions>": "${hash}"`);
});

// T3 injects T3, Effect, Schema, and Option. A stand-in that accepts any call lets the file load, so the
// tests can call the climb rules that it exports.
const anything: unknown = new Proxy(() => {}, { get: () => anything, apply: () => anything });
Object.assign(globalThis, { T3: anything, Effect: anything, Schema: anything, Option: anything });
const omtPath = join(PACKAGE_ROOT, "workflows", "omt.ts");
// The workflow file is not type-checked, so its exports are untyped here.
const rules = (await import(omtPath)) as Record<string, any>;

interface Score {
  round: number;
  judge: string;
  subject: string;
  value: number;
}

const judge = (name: string, tier = 1, command = "") => ({ name, tier, command });
const state = (scores: Score[], round: number, extra: Record<string, unknown> = {}) => ({
  target: 9,
  direction: "up",
  maxRounds: 10,
  plateau: { rounds: 2, minGain: 0.2 },
  since: 0,
  judges: [judge("sol"), judge("opus", 2)],
  beat: [],
  round,
  scores,
  ...extra,
});
const current = (round: number, name: string, value: number): Score => ({ round, judge: name, subject: "current", value });
const baseline = (round: number, name: string, value: number): Score => ({ round, judge: name, subject: "baseline", value });

test("nextAction scores tier 1 first, then tier 2 only after tier 1 meets the target", () => {
  assert.deepEqual(rules.nextAction(state([], 1)), { action: "score", tier: 1, reason: "round 1 needs a score from sol" });
  assert.equal(rules.nextAction(state([current(1, "sol", 7)], 1)).action, "change", "tier 1 below the target asks for a change, not tier 2");
  assert.deepEqual(rules.nextAction(state([current(1, "sol", 9.5)], 1)), { action: "score", tier: 2, reason: "tiers 1 to 1 meet the target in round 1" });
  assert.equal(rules.nextAction(state([current(1, "sol", 9.5), current(1, "opus", 9)], 1)).action, "met");
  assert.match(rules.nextAction(state([current(1, "sol", 9.5), current(1, "opus", 8)], 1)).reason, /^opus 8 < 9$/);
});

test("nextAction subtracts a judge's baseline drift before it compares with the target", () => {
  const scores = [current(1, "sol", 8), baseline(1, "sol", 8), current(2, "sol", 9.2), baseline(2, "sol", 8.5)];
  assert.equal(rules.drift(scores, "sol", 2), 0.5);
  assert.equal(rules.calibrated(scores, "sol", 2), 8.7);
  assert.equal(rules.nextAction(state(scores, 2, { judges: [judge("sol")] })).action, "change", "9.2 raw is 8.7 after the drift, below 9");
  assert.equal(rules.drift(scores, "sol", 3), 0, "a round with no baseline score gets no correction");
});

test("nextAction stops at the round limit before it checks the plateau", () => {
  const scores = [current(1, "sol", 7), current(2, "sol", 7), current(3, "sol", 7)];
  const solo = { judges: [judge("sol")] };
  assert.equal(rules.nextAction(state(scores, 3, { ...solo, maxRounds: 3 })).action, "limit");
  assert.equal(rules.nextAction(state(scores, 3, solo)).action, "plateau");
  assert.equal(rules.nextAction(state(scores, 2, solo)).action, "change", "a plateau needs a full window of rounds");
  assert.equal(rules.nextAction(state(scores, 3, { ...solo, since: 2 })).action, "change", "the owner's answer restarts the plateau window");
  const rising = [current(1, "sol", 7), current(2, "sol", 7.1), current(3, "sol", 7.5)];
  assert.equal(rules.nextAction(state(rising, 3, solo)).action, "change", "a gain of 0.5 over 2 rounds is no plateau");
});

test("nextAction with direction down meets a target at or below it", () => {
  const down = { direction: "down", target: 100, judges: [judge("size", 1, "du -k dist")] };
  assert.equal(rules.nextAction(state([current(1, "size", 120)], 1, down)).action, "change");
  assert.equal(rules.nextAction(state([current(1, "size", 100)], 1, down)).action, "met");
});

test("nextAction fails a model judge that does not score current above each beat reference", () => {
  const solo = { judges: [judge("sol")], beat: ["rival"] };
  const rival = (value: number): Score => ({ round: 1, judge: "sol", subject: "rival", value });
  assert.match(rules.nextAction(state([current(1, "sol", 9.5)], 1, solo)).reason, /sol gave no score for rival/);
  assert.match(rules.nextAction(state([current(1, "sol", 9.5), rival(9.5)], 1, solo)).reason, /sol scored rival 9.5, current 9.5/);
  assert.equal(rules.nextAction(state([current(1, "sol", 9.5), rival(9)], 1, solo)).action, "met");
});

test("blindLabels gives each subject one letter, and the random bytes change the order", () => {
  const subjects = ["current", "baseline", "rival"];
  const a = rules.blindLabels([0, 1, 2, 3], subjects);
  const b = rules.blindLabels([1, 1, 0, 3], subjects);
  assert.deepEqual(Object.keys(a), ["A", "B", "C"]);
  assert.deepEqual(Object.values(a).sort(), [...subjects].sort());
  assert.notDeepEqual(a, b);
  assert.deepEqual(Object.keys(rules.blindLabels([], Array.from({ length: 28 }, (_, i) => `s${i}`))).slice(25), ["Z", "AA", "AB"]);
});

test("readScores maps labels to subjects with the lowest category, and names each missing or bad score", () => {
  const labels = { A: "baseline", B: "current" };
  const scores = [
    { label: "a", category: "Contrast", score: 8 },
    { label: "A", category: "layout", score: 9 },
    { label: "B", category: "contrast", score: 9.5 },
    { label: "B", category: "layout", score: 9 },
  ];
  assert.deepEqual(rules.readScores(labels, ["contrast", "layout"], { scores }), {
    values: [{ subject: "baseline", value: 8 }, { subject: "current", value: 9 }],
    errors: [],
  });
  const bad = rules.readScores(labels, ["contrast", "layout"], { scores: [...scores.slice(0, 3), { label: "C", category: "layout", score: 11 }] });
  assert.deepEqual(bad.errors, ["unknown label C", "no layout score for B"]);
});

test("readScores rejects a label and category scored twice, so the first score cannot win", () => {
  const scores = [
    { label: "A", category: "layout", score: 9 },
    { label: "a", category: "Layout", score: 2 },
  ];
  assert.deepEqual(rules.readScores({ A: "current" }, ["layout"], { scores }), { values: [], errors: ["A layout is scored 2 times"] });
});

test("parseScore reads the number on the last line that a scorer prints", () => {
  assert.equal(rules.parseScore("building...\n42.5\n"), 42.5);
  assert.equal(rules.parseScore("42 passed"), undefined);
  assert.equal(rules.parseScore(""), undefined);
});

test("climbInputErrors rejects inputs that the rounds cannot score", () => {
  const valid = {
    target: 9,
    direction: "up",
    maxRounds: 10,
    plateau: { rounds: 2, minGain: 0.2 },
    judges: [judge("sol")],
    references: [{ name: "rival", files: ["/tmp/rival.png"] }],
    beat: ["rival"],
    categories: ["layout"],
    capture: "bun run shots",
  };
  assert.deepEqual(rules.climbInputErrors(valid), []);
  assert.deepEqual(rules.climbInputErrors({ ...valid, capture: "", direction: "down", beat: ["other"] }), [
    "beat names other, which is not a reference",
    "a model judge needs a capture command",
    "model judges score 0 to 10, higher is better, so direction must be up",
  ]);
  assert.deepEqual(rules.climbInputErrors({ ...valid, judges: [judge("sol"), judge("sol", 10)] }), [
    'judge "sol" is given twice',
    "judge sol: tier 10 is not 1 to 9",
  ]);
});

test("reviewReport lists every finding by severity with its location and fix", () => {
  const finding = (severity: string, location: string) => ({ severity, location, problem: `Bad at ${location}. Details follow.`, fix: `Fix ${location}.` });
  const report = rules.reviewReport("Code review of pr-1, round 1", [finding("P3", "b.ts:2"), finding("P0", "a.ts:1")], 1);
  assert.equal(
    report,
    [
      "Code review of pr-1, round 1: 1 problem to fix, 1 style note, 1 reviewer finding refuted by the oracle.",
      "1. Bad at a.ts:1.\n   P0 (breaks the build, loses data, or opens a security hole), a.ts:1\n   Fix: Fix a.ts:1.",
      "2. Bad at b.ts:2.\n   P3 (style), b.ts:2\n   Fix: Fix b.ts:2.",
    ].join("\n\n"),
  );
  assert.equal(rules.reviewReport("Code review of pr-1, round 2", [], 0), "Code review of pr-1, round 2: no problems to fix.");
});

test("reviewReport counts one place once and keeps an abbreviation inside the sentence", () => {
  const same = [
    { severity: "P2", location: "a.ts:1", problem: "Users in the U.S. lose their settings. More.", fix: "Keep them." },
    { severity: "P1", location: "a.ts:1", problem: "Settings vanish.", fix: "Save them." },
  ];
  assert.equal(
    rules.reviewReport("R", same, 0),
    "R: 1 problem to fix.\n\n1. Settings vanish.\n   P1 (wrong in a normal case), a.ts:1\n   Fix: Save them.\n   1 more finding at this place: see the full result.",
  );
  assert.match(rules.reviewReport("R", [same[0]], 0), /^1\. Users in the U\.S\. lose their settings\.$/m);
});

test("a cut-short agent can retry at another speed after its turn stops", () => {
  const sol = (value: string) => ({ instanceId: "codex", model: "gpt-6.2-sol", options: [{ id: "serviceTier", value }] });
  const ultrafast = sol("ultrafast");
  const priority = sol("priority");
  const failed = "the agent's turn was cut short: ultrafast is unavailable";
  assert.equal(rules.canRetryAtAnotherSpeed(failed, ultrafast, priority), true);
  assert.equal(rules.canRetryAtAnotherSpeed(failed, ultrafast, ultrafast), false);
  assert.equal(rules.canRetryAtAnotherSpeed(failed, ultrafast, { ...priority, model: "gpt-6.2-astra" }), false);
  assert.equal(rules.canRetryAtAnotherSpeed(`${failed}; its turn could not be stopped`, ultrafast, priority), false);
  assert.equal(rules.canRetryAtAnotherSpeed("the agent's turn was stopped: interrupted", ultrafast, priority), false);
  assert.equal(rules.canRetryAtAnotherSpeed("the agent did not return a result", ultrafast, priority), false);
});

test("capMessage keeps a thread message under the T3 size limit and points to the full result", () => {
  assert.equal(rules.capMessage("run r1: done.\n\nshort", "r1"), "run r1: done.\n\nshort");
  const long = rules.capMessage(`run r1: 9 problems.\n\n${"x".repeat(130_000)}`, "r1");
  assert.ok(long.length < 1_000);
  assert.equal(long, "run r1: 9 problems.\n\nThe full message is too long to send. Read the result with: t3 workflow show r1 --json");
  const oneLine = rules.capMessage(`run r1: ${"y".repeat(130_000)}`, "r1");
  assert.ok(oneLine.length <= 100_000, "a long first line is cut to fit");
  assert.match(oneLine, /\.\.\.\n\nThe full message is too long to send\. Read the result with: t3 workflow show r1 --json$/);
});

test("climbTable shows the calibrated current score with its raw score", () => {
  const scores = [current(1, "sol", 8), baseline(1, "sol", 8), current(2, "sol", 9.2), baseline(2, "sol", 8.5)];
  assert.equal(
    rules.climbTable(state(scores, 2, { judges: [judge("sol")] })),
    ["| Judge | Tier | Subject | R1 | R2 |", "| --- | --- | --- | --- | --- |", "| sol | 1 | current | 8 | 8.7 (9.2) |", "| sol | 1 | baseline | 8 | 8.5 |"].join("\n"),
  );
});
