import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { blindLabels, parseClimb, parseScoresBlock } from "../../src/climb/climb.ts";
import { run } from "../../src/commands/climb.ts";
import { omtExit, projectContext, writeFile } from "../helpers.ts";
import type { ProjectContext } from "../helpers.ts";

async function climb(base: ProjectContext, argv: string[]): Promise<ProjectContext> {
  const ctx = base.at(argv);
  await run(ctx);
  return ctx;
}

function climbFile(ctx: ProjectContext, slug = "ui") {
  return JSON.parse(readFileSync(join(ctx.cwd, ".omt3", "plans", `${slug}.climb.json`), "utf8"));
}

async function status(ctx: ProjectContext, slug = "ui") {
  return JSON.parse((await climb(ctx, ["status", slug, "--json"])).out());
}

function labelOf(ctx: ProjectContext, round: number, subject: string, slug = "ui"): string {
  const entry = Object.entries(climbFile(ctx, slug).rounds[round - 1].labels).find(([, name]) => name === subject);
  assert.ok(entry, `no label for ${subject}`);
  return entry[0];
}

async function score(ctx: ProjectContext, judge: string, value: number, subject = "current", slug = "ui") {
  await climb(ctx, ["score", slug, "--judge", judge, "--score", String(value), "--subject", subject]);
}

test("new writes the climb file and rejects a bad slug, a duplicate without --force, and a bad target", async () => {
  const ctx = projectContext();
  const made = await climb(ctx, ["new", "ui", "--target", "9", "--judge", "opus@2", "--judge", "sol", "--category", "hierarchy", "--beat", "codex"]);
  assert.match(made.out(), /plans\/ui\.climb\.json\n$/);
  const file = climbFile(ctx);
  assert.equal(file.target, 9);
  assert.equal(file.direction, "up");
  assert.equal(file.maxRounds, 10);
  assert.deepEqual(file.plateau, { rounds: 2, minGain: 0.2 });
  assert.deepEqual(file.judges, [{ name: "sol", tier: 1 }, { name: "opus", tier: 2 }]);
  assert.deepEqual(file.categories, ["hierarchy"]);
  assert.deepEqual(file.beat, ["codex"]);

  await assert.rejects(run(ctx.at(["new", "UI", "--target", "9", "--judge", "sol"])), omtExit(2));
  await assert.rejects(run(ctx.at(["new", "ui", "--target", "9", "--judge", "sol"])), omtExit(1));
  await assert.rejects(run(ctx.at(["new", "x", "--target", "nine", "--judge", "sol"])), omtExit(2));
  await assert.rejects(run(ctx.at(["new", "x", "--target", "9"])), omtExit(2));
  await assert.rejects(run(ctx.at(["new", "x", "--target", "9", "--judge", "sol@0"])), omtExit(2));
  await assert.rejects(run(ctx.at(["new", "x", "--target", "9", "--judge", "sol", "--judge", "sol@2"])), omtExit(2));
  await climb(ctx, ["new", "ui", "--target", "8", "--judge", "sol", "--force"]);
  assert.equal(climbFile(ctx).target, 8);
});

test("round assigns blind labels that change between rounds, and score --result-file maps them to subjects", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol", "--category", "hierarchy", "--category", "contrast"]);
  const first = await climb(ctx, ["round", "ui", "--subject", "baseline", "--subject", "codex"]);
  assert.match(first.out(), /^round 1\nkey [0-9a-f]{8}\nA {2}\S+\nB {2}\S+\nC {2}\S+\n$/);
  const labels = climbFile(ctx).rounds[0].labels;
  assert.deepEqual(Object.values(labels).sort(), ["baseline", "codex", "current"]);
  assert.deepEqual(labels, blindLabels("ui", 1, ["current", "baseline", "codex"]));
  const orders = new Set(Array.from({ length: 6 }, (_, i) => Object.values(blindLabels("ui", i + 1, ["current", "baseline", "codex"])).join(",")));
  assert.ok(orders.size > 1, "labels differ between rounds");

  const current = labelOf(ctx, 1, "current");
  const baseline = labelOf(ctx, 1, "baseline");
  const codex = labelOf(ctx, 1, "codex");
  const result = [
    "VERDICT: SCORED",
    "SCORES:",
    `- ${codex}: hierarchy=8.5 contrast=8`,
    `- ${current}: hierarchy=7 contrast=6.5`,
    `- ${baseline}: hierarchy=6 contrast=6`,
    "FINDINGS:",
    `- ${current} contrast: body text is gray on gray. Fix: darken it.`,
  ].join("\n");
  writeFile(join(ctx.cwd, "sol.txt"), result);
  const scored = await climb(ctx, ["score", "ui", "--judge", "sol", "--result-file", join(ctx.cwd, "sol.txt")]);
  assert.match(scored.out(), /recorded sol r1 current 6\.5\n/);
  assert.match(scored.out(), /recorded sol r1 codex 8\n/);
  const scores = climbFile(ctx).scores;
  assert.deepEqual(scores.find((entry: { subject: string }) => entry.subject === "current").categories, { hierarchy: 7, contrast: 6.5 });

  writeFile(join(ctx.cwd, "bad.txt"), "SCORES:\n- Z: hierarchy=1 contrast=1\n");
  await assert.rejects(run(ctx.at(["score", "ui", "--judge", "sol", "--result-file", join(ctx.cwd, "bad.txt")])), omtExit(1));
  writeFile(join(ctx.cwd, "missing.txt"), `SCORES:\n- ${current}: hierarchy=9\n`);
  await assert.rejects(run(ctx.at(["score", "ui", "--judge", "sol", "--result-file", join(ctx.cwd, "missing.txt")])), omtExit(2));
  await assert.rejects(run(ctx.at(["score", "ui", "--judge", "gemini", "--score", "9"])), omtExit(2));
  await assert.rejects(run(ctx.at(["score", "ui", "--judge", "sol", "--score", "9", "--subject", "claude"])), omtExit(2));
});

test("concurrent score commands keep every score", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol", "--judge", "opus", "--judge", "muse"]);
  await climb(ctx, ["round", "ui"]);
  await Promise.all(["sol", "opus", "muse"].map((judge) => run(ctx.at(["score", "ui", "--judge", judge, "--score", "8"]))));
  assert.deepEqual(climbFile(ctx).scores.map((entry: { judge: string }) => entry.judge).sort(), ["muse", "opus", "sol"]);
});

test("rounds with more than 26 subjects produce labels that result files can score", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol"]);
  const subjects = Array.from({ length: 26 }, (_, i) => `reference-${i}`);
  const round = JSON.parse((await climb(ctx, ["round", "ui", "--json", ...subjects.flatMap((subject) => ["--subject", subject])])).out());
  assert.equal(Object.keys(round.labels).at(-1), "AA");
  const input = ctx.at(["score", "ui", "--judge", "sol", "--result-file", "-"]);
  input.readStdin = async () => `SCORES:\n${Object.keys(round.labels).map((label) => `- ${label}: 8`).join("\n")}\n`;
  await run(input);
  assert.equal(climbFile(ctx).scores.length, 27);
});

test("waiting for score stdin does not lock out or overwrite another judge", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol", "--judge", "opus"]);
  await climb(ctx, ["round", "ui"]);
  const input = ctx.at(["score", "ui", "--judge", "sol", "--result-file", "-"]);
  input.readStdin = async () => {
    assert.equal(existsSync(join(ctx.cwd, ".omt3", "plans", "ui.climb.json.lock")), false);
    await score(ctx, "opus", 8);
    return "SCORES:\n- A: 9\n";
  };
  await run(input);
  assert.deepEqual(climbFile(ctx).scores.map((entry: { judge: string }) => entry.judge).sort(), ["opus", "sol"]);
});

test("each round gets a new random key, and the climb file keeps it", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol"]);
  const first = JSON.parse((await climb(ctx, ["round", "ui", "--json"])).out());
  await score(ctx, "sol", 5);
  const second = JSON.parse((await climb(ctx, ["round", "ui", "--json"])).out());
  assert.match(first.key, /^[0-9a-f]{8}$/);
  assert.notEqual(first.key, second.key);
  assert.deepEqual(climbFile(ctx).rounds.map((round: { key: string }) => round.key), [first.key, second.key]);
});

test("parseScoresBlock reads single scores and stops at the next label", () => {
  assert.deepEqual(parseScoresBlock("SCORES:\n- a: 7/10\n- B: 8\nNOTES:\n- C: 1\n"), [
    { label: "A", value: 7 },
    { label: "B", value: 8 },
  ]);
  assert.throws(() => parseScoresBlock("VERDICT: SCORED\n"), /no SCORES/);
  assert.deepEqual(parseScoresBlock("Here is my review.\nSCORES:\n\n- a: quality=8 / 10\n\nFINDINGS:\n- A: fix this\n"), [
    { label: "A", categories: { quality: 8 } },
  ]);
  assert.throws(() => parseScoresBlock("SCORES:\n- A: quality=2 quality=10\n"), /given twice/);
  assert.deepEqual(parseScoresBlock("SCORES:\n- B: Hierarchy=7\n"), [{ label: "B", categories: { hierarchy: 7 } }]);
  assert.throws(() => parseScoresBlock("SCORES:\n- A: 9\n- 1: 2\n"), /invalid score line/);
});

test("a round cannot start before the last one has scores or past the round limit", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol", "--max-rounds", "1"]);
  await climb(ctx, ["round", "ui"]);
  await assert.rejects(run(ctx.at(["round", "ui"])), omtExit(1));
  await score(ctx, "sol", 5);
  await assert.rejects(run(ctx.at(["round", "ui"])), omtExit(1));
  await climb(ctx, ["set", "ui", "--max-rounds", "2"]);
  await climb(ctx, ["round", "ui"]);
  assert.equal(climbFile(ctx).rounds.length, 2);
});

test("status moves through score, judge-tier, change, and met as tiers meet the target", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol@1", "--judge", "opus@2", "--judge", "muse@3"]);
  assert.equal((await status(ctx)).next.action, "round");
  await climb(ctx, ["round", "ui"]);
  assert.deepEqual((await status(ctx)).next, { action: "score", tier: 1, reason: "round 1 has no score for current" });

  await score(ctx, "sol", 8);
  assert.equal((await status(ctx)).next.action, "change");

  await climb(ctx, ["round", "ui"]);
  await score(ctx, "sol", 9.2);
  const tier2 = (await status(ctx)).next;
  assert.equal(tier2.action, "judge-tier");
  assert.equal(tier2.tier, 2);

  await score(ctx, "opus", 8.7);
  const blocked = (await status(ctx)).next;
  assert.equal(blocked.action, "change");
  assert.match(blocked.reason, /opus 8\.7 < 9/);

  await climb(ctx, ["round", "ui"]);
  await score(ctx, "sol", 9.5);
  assert.equal((await status(ctx)).next.tier, 2);
  await score(ctx, "opus", 9);
  assert.equal((await status(ctx)).next.tier, 3);
  await score(ctx, "muse", 9.1);
  assert.equal((await status(ctx)).next.action, "met");

  const text = (await climb(ctx, ["status", "ui"])).out();
  assert.match(text, /^target: 9 or more from every judge$/m);
  assert.match(text, /^sol +1 +current +8 +9\.2 +9\.5$/m);
  assert.match(text, /^next: met$/m);
  const markdown = (await climb(ctx, ["status", "ui", "--markdown"])).out();
  assert.match(markdown, /^## Climb\n/);
  assert.match(markdown, /^\| opus \| current \| - \| 8\.7 \| 9 \|$/m);
});

test("status stops at the round limit and on a plateau", async () => {
  const limited = projectContext();
  await climb(limited, ["new", "ui", "--target", "9", "--judge", "sol", "--max-rounds", "2"]);
  for (const value of [5, 6]) {
    await climb(limited, ["round", "ui"]);
    await score(limited, "sol", value);
  }
  assert.equal((await status(limited)).next.action, "limit");

  const flat = projectContext();
  await climb(flat, ["new", "ui", "--target", "9", "--judge", "sol", "--plateau", "2", "--min-gain", "0.5"]);
  for (const [i, value] of [7, 7.2, 7.4].entries()) {
    await climb(flat, ["round", "ui"]);
    await score(flat, "sol", value);
    assert.equal((await status(flat)).next.action, i < 2 ? "change" : "plateau");
  }
  await climb(flat, ["round", "ui"]);
  await score(flat, "sol", 8);
  assert.equal((await status(flat)).next.action, "change");
});

test("drift correction lowers a score by the rise of the judge's baseline score", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol"]);
  await climb(ctx, ["round", "ui", "--subject", "baseline"]);
  await score(ctx, "sol", 7, "baseline");
  await score(ctx, "sol", 8);
  await climb(ctx, ["round", "ui", "--subject", "baseline"]);
  await score(ctx, "sol", 7.5, "baseline");
  await score(ctx, "sol", 9.2);
  const checked = await status(ctx);
  assert.equal(checked.next.action, "change");
  assert.match(checked.next.reason, /sol 8\.7 < 9/);
  const row = checked.rows.find((entry: { subject: string }) => entry.subject === "current");
  assert.deepEqual(row.cells[1], { round: 2, raw: 9.2, value: 8.7 });
  assert.match((await climb(ctx, ["status", "ui"])).out(), /8\.7 \(9\.2\)/);
});

test("--beat fails a round in which a reference scores higher", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "8", "--judge", "sol", "--beat", "codex"]);
  await assert.rejects(run(ctx.at(["round", "ui"])), omtExit(2));
  await climb(ctx, ["round", "ui", "--subject", "codex"]);
  await score(ctx, "sol", 8.5);
  await score(ctx, "sol", 8.8, "codex");
  const checked = await status(ctx);
  assert.equal(checked.next.action, "change");
  assert.match(checked.next.reason, /sol scored codex 8\.8, current 8\.5/);
  await score(ctx, "sol", 9);
  assert.equal((await status(ctx)).next.action, "met");
});

test("--direction down meets the target at or below it", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "size", "--target", "100", "--judge", "bundle", "--direction", "down"]);
  await climb(ctx, ["round", "size"]);
  await climb(ctx, ["score", "size", "--judge", "bundle", "--score", "140"]);
  assert.equal((await status(ctx, "size")).next.action, "change");
  await climb(ctx, ["round", "size"]);
  await climb(ctx, ["score", "size", "--judge", "bundle", "--score", "100"]);
  assert.equal((await status(ctx, "size")).next.action, "met");
  assert.match((await climb(ctx, ["status", "size"])).out(), /^target: 100 or less from every judge$/m);
});

test("set changes the target, and flags of other subcommands are usage errors", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol"]);
  assert.equal((await climb(ctx, ["set", "ui", "--target", "9.5"])).out(), "set target=9.5 for ui\n");
  assert.equal(climbFile(ctx).target, 9.5);
  await assert.rejects(run(ctx.at(["set", "ui"])), omtExit(2));
  await assert.rejects(run(ctx.at(["status", "ui", "--target", "1"])), omtExit(2));
  await assert.rejects(run(ctx.at(["status", "nope"])), omtExit(1));
  await assert.rejects(run(ctx.at(["fly", "ui"])), omtExit(2));
});

test("damaged nested climb records fail before status can use them", async () => {
  const ctx = projectContext();
  await climb(ctx, ["new", "ui", "--target", "9", "--judge", "sol"]);
  const valid = climbFile(ctx);
  for (const patch of [{ plateau: {} }, { judges: [null] }, { rounds: [{ n: 1 }] }, { scores: [null] }, { categories: [7] }]) {
    assert.throws(() => parseClimb(JSON.stringify({ ...valid, ...patch }), "ui.climb.json"), /not a climb file/);
  }
});
