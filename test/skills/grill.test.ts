import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

test("omt-grill reads the current thread mode and family", () => {
  const mode = section(readSkill("omt-grill"), "### 0. ");
  assert.match(mode, /Call `t3_thread_configure` with no arguments/);
  assert.match(mode, /read your `interactionMode` and `modelSelection`/);
  assert.match(mode, /Keep the driver of `modelSelection`, such as `claudeAgent` or `codex`, as your family\./);
  assert.doesNotMatch(mode, /orchestrator_capabilities/);
});

test("omt-grill links to the shared branch check", () => {
  const mode = section(readSkill("omt-grill"), "### 0. ");
  assert.match(mode, /run the \[branch check\]\(\.\.\/omt\/references\/delegation\.md#branch-check\)/);
});

test("omt-grill checks config overrides for a missing role and offers setup", () => {
  const frame = section(readSkill("omt-grill"), "### 1. ");
  assert.match(frame, /Run `omt roles --role grill --json`/);
  assert.match(frame, /check whether a config override removed the role/);
  assert.match(frame, /offer `omt-setup` to restore it/);
  assert.doesNotMatch(frame, /omt defaults/);
});

test("omt-grill finds the facts first, with GX explore and research units for broad reads", () => {
  const facts = section(readSkill("omt-grill"), "### 2. ");
  assert.match(facts, /Read the code that the goal touches yourself\./);
  assert.match(facts, /Send only broad reads to read-only `explore` children, and questions about docs or the web to read-only `research` children/);
  assert.match(facts, /omt brief <explore\|research>[^\n]*--unit GX<k> --round 1/);
  assert.match(facts, /The units are `GX<k>`[^\n]*explore units `E<k>` get their own request ids/);
  assert.match(facts, /wait for them in this turn/);
});

test("omt-grill gets one second opinion from one grill child on the other family", () => {
  const text = readSkill("omt-grill");
  const second = section(text, "### 3. ");
  assert.match(second, /Dispatch one `grill` child on the family other than yours, once per grill\./);
  assert.match(second, /Never send it a later batch, and never start a second `grill` child\./);
  assert.match(second, /omt brief grill[^\n]*--unit grill --against <your family> --round 1/);
  assert.match(second, /do not fall back/);
  assert.match(second, /While it runs, write your own items from the facts/);
  assert.match(section(text, "### 1. "), /When the `Log` shows a `grill` task, the second opinion ran\. Skip step 3\./);
  assert.doesNotMatch(text, /grill\.claude|grill\.codex|panel round/);
});

test("omt-grill merges, asks batches, checks answers against the facts, and stops when nothing is open", () => {
  const text = readSkill("omt-grill");
  const merge = section(text, "### 4. ");
  assert.match(merge, /Merge your items and the `grill` child's items into one list, without duplicates\./);
  assert.match(merge, /It is always `Blocking: yes`\./);
  assert.match(merge, /When a fact or an answer shows that the chosen direction fails, reopen the choice\./);
  const ask = section(text, "### 5. ");
  assert.match(ask, /Every open question, numbered, each with its options and your recommendation\./);
  assert.match(ask, /Write each new edge case with its handling, its test layer, and `State: pending`\./);
  assert.match(ask, /It holds the new edge cases and every `pending` edge case from earlier batches\./);
  assert.match(ask, /End the turn and wait for the answers\./);
  const check = section(text, "### 6. ");
  assert.match(check, /Check each answer against the facts\./);
  assert.match(check, /Send a broad check to an `explore` child, or a docs or web check to a `research` child/);
  assert.match(check, /When an answer conflicts with a fact, ask about it again in the next batch, with the fact and its citation\./);
  assert.match(check, /Set `State: accepted` only when the owner accepts that row or accepts all rows\. Set `changed` or `dropped` only from the owner's answer for that row\. A row with no answer stays `pending`\./);
  assert.match(check, /No question is open, no edge case is `pending`, and a direction is chosen\./);
  assert.match(check, /The owner tells you to stop\./);
  assert.match(check, /Otherwise go back to step 5 with batch `<n\+1>`\./);
  assert.doesNotMatch(text, /maxReviewRounds|frozen/);
  assert.match(text, /State: pending \| accepted \| changed \| dropped\./);
});

test("omt-grill ends with a grill summary and offers omt-plan", () => {
  const handOff = section(readSkill("omt-grill"), "### 7. ");
  assert.match(handOff, /Write the grill summary in the reply/);
  assert.match(handOff, /The summary holds no plan and no code\./);
  assert.match(handOff, /Otherwise offer `omt-plan`/);
  assert.match(handOff, /When `omt-plan` called this skill, return to its step 2 with the grill file path\./);
  assert.match(handOff, /Start no plan and no unit\./);
});

test("omt-grill gets the grill file path from omt paths", () => {
  const text = readSkill("omt-grill");
  assert.match(section(text, "### 1. "), /When `\$\(omt paths --grills\)\/<slug>\.md` exists, read it/);
  assert.match(section(text, "### 1. "), /When the file holds a batch without recorded answers, go back to step 5\./);
  const ask = section(text, "### 5. ");
  assert.match(ask, /mkdir -p "\$\(omt paths --grills\)"/);
  assert.match(ask, /then write `\$\(omt paths --grills\)\/<slug>\.md`/);
});

test("omt-grill writes nothing in plan mode, waits in the turn, and returns the grill text", () => {
  const text = readSkill("omt-grill");
  const mode = section(text, "### 0. ");
  assert.match(mode, /In `plan` mode:/);
  assert.match(mode, /Dispatch only `explore`, `research`, and `grill` tasks/);
  assert.match(mode, /Build each brief without `--save`/);
  assert.match(mode, /Write no grill file and no ledger entry/);
  assert.match(mode, /Read the kept task ids with `task_status`[^\n]*write nothing/);
  assert.doesNotMatch(text, /heartbeat|stalled-tasks|schedule_task|On wake/);
  assert.match(text, /You end your turn only for the owner: a batch of questions or the hand-off\./);
  assert.match(mode, /Deliver the grill text[^\n]*in your final message/);
  assert.match(section(text, "### 5. "), /In `plan` mode, keep the same text in your reply instead/);
  assert.match(section(text, "### 7. "), /In `plan` mode, return the grill text instead/);
});

test("the grill persona gives one second opinion with no later rounds", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "grill.md"), "utf8");
  assert.match(persona, /You give the one second opinion of the grill/);
  assert.doesNotMatch(persona, /In round 2 and later|frozen list/);
});
