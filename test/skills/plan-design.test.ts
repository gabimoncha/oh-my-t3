import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

test("each mode-check step calls t3_thread_configuration, and no skill reads modes from orchestrator_capabilities (plan-design)", () => {
  const modeSteps: Record<string, string> = {
    "omt-plan": "### 0. ",
    "omt-design": "### 0. ",
  };
  for (const [name, heading] of Object.entries(modeSteps)) {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const start = text.indexOf(`\n${heading}`);
    assert.ok(start >= 0, `${name} has no step ${heading.trim()}`);
    const end = text.indexOf("\n### ", start + 1);
    const step = text.slice(start, end < 0 ? undefined : end);
    assert.match(step, /t3_thread_configuration/, `${name} mode step`);
    assert.doesNotMatch(step, /orchestrator_capabilities/, `${name} mode step`);
  }
});

test("delegation.md has a branch check, and both step 0s link to it (plan-design)", () => {
  for (const name of ["omt-plan", "omt-design"]) {
    assert.match(section(readSkill(name), "### 0. "), /\(\.\.\/omt\/references\/delegation\.md#branch-check\)/, name);
  }
});

test("omt-plan asks question batches after independent work and reviews with one plan-review child", () => {
  const text = readSkill("omt-plan");
  const ask = section(text, "### 2. ");
  assert.match(ask, /A question that the code can answer is not an owner question: read the code instead\./);
  assert.match(ask, /finish all work that does not depend on the answers/);
  assert.match(ask, /Then ask every open owner decision in one batch\. Give each question 2 to 4 options and your recommendation\. End the turn and wait for the answers\./);
  assert.match(ask, /After the answers, explore again when an answer opens new code, and ask the next batch\. Stop when no question is open\./);
  const review = section(text, "### 4. ");
  assert.match(review, /`two-families`: 1 `plan-review` child on the family other than yours\. Build its brief with `--against <your family>` from step 0\./);
  assert.match(review, /do not fall back/);
  assert.doesNotMatch(text, /plan\.claude|plan\.codex|two tasks, one per family/);
  assert.doesNotMatch(review, /omt ledger stats(?! --plan <slug>)/);
  assert.doesNotMatch(text, /\.omt\/plans\/<slug>\.md/);
});
test("omt-plan reads the effective profile before a plan exists, keeps it in a new plan, and writes the plan itself", () => {
  const plan = readSkill("omt-plan");
  const explore = section(plan, "### 1. ");
  assert.match(explore, /When the plan file exists, run `omt profile show --plan <slug> --json`\./);
  assert.match(explore, /Before the plan file exists, use `omt profile show <name> --json` for an explicit profile name\./);
  assert.match(explore, /When neither a plan file nor a profile name exists, run `omt profile show --json`\./);
  assert.match(explore, /Keep the returned `profile` as `<name>` for later commands\./);
  assert.match(explore, /Read the code that the goal touches yourself\. Send only broad reads to 1 to `maxParallel` read-only `explore` children/);
  const write = section(plan, "### 3. ");
  assert.match(write, /Otherwise run `omt plan new <slug> --title "<title>" --profile <name>`/);
  assert.match(write, /Fill every section yourself\./);
  assert.doesNotMatch(plan, /dispatch a `plan` task|plan worker/);
  assert.match(write, /Paste the output of `omt roles --plan <slug>` under `Roles`\./);
});
test("plan and design use the selected profile for routing and dispatch limits before a plan file exists", () => {
  const plans = [
    ["omt-plan", "<slug>"],
    ["omt-design", "<ledger plan>"],
  ] as const;
  for (const [name, planId] of plans) {
    const frame = section(readSkill(name), "### 1. ");
    assert.match(frame, /With a selected profile and no plan file for the `--plan` id:/, name);
    assert.match(frame, /Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command\./, name);
    assert.ok(frame.includes(`Before each dispatch, run \`omt ledger stats --plan ${planId}\` and \`omt profile show <name> --json\`.`), name);
    assert.match(frame, /Dispatch only when the ledger's `active` is below the profile's `limits\.maxParallel`\./, name);
    assert.doesNotMatch(readSkill(name), /maxTasksPerRun|task budget/, name);
    assert.match(frame, /Use this check in place of `can dispatch`\./, name);
  }
});

test("plan and design dispatch steps use the step 1 check without a plan file", () => {
  const steps = [
    ["omt-plan", "### 4. ", "<slug>"],
    ["omt-design", "### 2. ", "<ledger plan>"],
  ] as const;
  for (const [name, heading, planId] of steps) {
    const dispatch = section(readSkill(name), heading);
    assert.ok(dispatch.includes(`Before each dispatch, run \`omt ledger stats --plan ${planId}\`.`), name);
    assert.match(dispatch, /When a plan file exists, dispatch only while it reports `can dispatch: yes`\./, name);
    assert.match(dispatch, /Otherwise, use the step 1 dispatch check\./, name);
  }
  const review = section(readSkill("omt-plan"), "### 4. ");
  assert.match(review, /Dispatch it with `mode: "wait"`\. Record the dispatch with `--task-id`, `--provider`, and `--model`, and wait for it in this turn \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#waiting\)\)\./);
  assert.doesNotMatch(review, /second task/);
});
test("omt-plan asks the owner to approve the test lines and reads the profile's test policy", () => {
  const plan = readSkill("omt-plan");
  const ask = section(plan, "### 2. ");
  assert.match(ask, /Include the proposed `## Tests` lines in the first batch\./);
  assert.match(ask, /Ask the owner to approve the test list with the plan\./);
  assert.match(ask, /Give a reason for each proposed line outside `plan\.testLayers`\./);
  const write = section(plan, "### 3. ");
  assert.match(write, /Read the effective profile again with the step 1 command before you fill `## Tests`\./);
  assert.match(write, /Read `workflow\.plan\.testLayers` as `plan\.testLayers` and `workflow\.build\.qa` as `build\.qa`\./);
  assert.match(write, /When `build\.qa` is `off`, leave `## Tests` empty\./);
  assert.match(write, /When `build\.qa` is `planned`, fill `## Tests` top-down with the owner's approved lines\./);
  assert.match(write, /Start with e2e tests of the main user flows of each vertical slice that `qa` can also walk\./);
  assert.match(write, /Then add integration cases that e2e skips, followed by unit cases\./);
  assert.match(write, /Add other test kinds only when the owner asks\./);
  assert.match(write, /Propose only the layers in `plan\.testLayers` without an owner request\./);
  assert.match(write, /Keep a line in another layer only with its reason and the owner's approval\./);
  assert.match(write, /Use one e2e test per main flow\./);
  assert.match(write, /Keep edge cases out of the e2e lines\./);
  assert.match(write, /Write each `## Tests` line as `- <layer> <unit>: <flow or case>\. File: <path>\. Reason: <why>\.`/);
  assert.match(write, /An empty `## Tests` section means no new tests\./);
});

test("omt-plan locks shared-build verify commands with one name per resource", () => {
  const write = section(readSkill("omt-plan"), "### 3. ");
  assert.match(write, /Name each shared resource in the plan, such as a build folder, a generated project, a simulator, or a dev-server port\./);
  assert.match(write, /Write each verify command that uses shared build state as `omt lock run <resource> -- <command>`\./);
  assert.match(write, /Use the same `<resource>` for commands that share that state\./);
  assert.match(write, /Keep units parallel for shared build state alone when a lock tool exists and the command leaves no process running after it exits\./);
});

test("omt-plan serializes shared builds when neither flock nor lockf exists", () => {
  const write = section(readSkill("omt-plan"), "### 3. ");
  assert.match(write, /Check for a lock tool with `command -v flock \|\| command -v lockf`\./);
  assert.match(write, /When neither tool exists, run `omt plan limit <slug> 1` for a plan with shared build state and say why\./);
});

test("omt-plan serializes commands that leave processes running after they exit", () => {
  const write = section(readSkill("omt-plan"), "### 3. ");
  assert.match(write, /When a command leaves processes running after it exits, run that command outside `omt lock`\./);
  assert.match(write, /When a unit uses that command, run `omt plan limit <slug> 1` for the whole plan and say why in the plan\./);
  assert.equal([...write.matchAll(/omt plan limit <slug> 1/g)].length, 2);
});

test("omt-plan maps plan.review to one reviewer, freezes blockers, and runs at most 2 rounds", () => {
  const review = section(readSkill("omt-plan"), "### 4. ");
  assert.match(review, /Run `omt profile show --plan <slug> --json`\./);
  assert.match(review, /Before the plan file exists, use `omt profile show <name> --json` instead\./);
  assert.match(review, /Read `workflow\.plan\.review` as `plan\.review`\./);
  assert.match(review, /`one`: 1 `plan-review` child on any family\. Build its brief with no `--against`\./);
  assert.match(review, /Run at most 2 review rounds\. Each round dispatches a fresh `plan-review` task; reuse no reviewer thread\./);
  assert.match(review, /Name the effective `plan\.testLayers` value in the task\./);
  assert.match(review, /Otherwise the reviewer's blocking findings are the frozen blocker list\. Write the list under `Log` in the plan\. Fix each blocker in the plan yourself/);
  assert.match(review, /Round 2: one re-review checks only the frozen blockers and the regressions from your fixes\./);
  assert.match(review, /After round 2, run no more rounds\. When blockers stay open, ask the owner about each one in one batch/);
  assert.match(review, /Stop and tell the user that no reviewer from the other family can run\./);
  assert.doesNotMatch(review, /maxReviewRounds|default 4/);
});
test("omt-plan uses owner approval without a plan-review task and keeps the handoff", () => {
  const plan = readSkill("omt-plan");
  const review = section(plan, "### 4. ");
  assert.match(review, /`owner`: ask the owner to approve the plan and its `## Tests` list\. Dispatch no `plan-review` task for this value\. After the owner approves, go to step 5\./);
  assert.match(review, /Done when: a round returned `APPROVE`, the owner approved under `plan\.review=owner`, or the owner answered each blocker that stayed open after round 2\./);
  const handOff = section(plan, "### 5. ");
  assert.match(handOff, /When `omt-ulw` called this skill, return to its step 5 with the plan slug\./);
  assert.match(handOff, /Called alone, stop\. Start no units\./);
});
test("the design and ui personas exist, and no model reviews design artifacts (plan-design)", () => {
  const design = readSkill("omt-design");
  assert.doesNotMatch(design, /omt brief review/);
  assert.doesNotMatch(design, /omt brief oracle/);
  assert.match(design, /--unit DS<k>/);
  assert.match(section(readSkill("omt-plan"), "### 3. "), /Plan an `omt-design` step only when the user requests a design pass first/);
});

test("the design check runs before any ui dispatch, also after the omt-plan hand-off (plan-design)", () => {
  const handOff = section(readSkill("omt-plan"), "### 5. ");
  assert.match(handOff, /return to its step 5 with the plan slug\. There the owner approves the plan, and step 6 runs the design check/);
});

test("omt-plan sets no task budget", () => {
  const text = readSkill("omt-plan");
  assert.doesNotMatch(text, /task budget|--tasks|maxTasksPerRun/);
});

test("omt-plan hashes the plan after every edit", () => {
  const rounds = section(readSkill("omt-plan"), "### 4. ");
  assert.match(rounds, /Make every plan edit first, `omt plan limit` included\. Then compute the hash/);
  assert.match(rounds, /After any edit to the plan, header edits included, compute the hash again before the next brief\./);
});

test("omt-plan writes the plan summary in its hand-off reply, and every plan has a summary (plan-design)", () => {
  const plan = readSkill("omt-plan");
  const handOff = section(plan, "### 5. ");
  assert.match(handOff, /Show the plan to the owner first, also when `omt-ulw` called this skill\. Write the `## Summary` text in full in the reply\./);
  assert.doesNotMatch(plan, /heartbeat|schedule_task|end the turn after each dispatch/i);
  assert.doesNotMatch(handOff, /omt-show|visuals|html_render/);
  assert.match(section(plan, "### 3. "), /Fill `## Summary` last, by the summary rule in \[planning\.md\]/);
});

test("omt-design reads the profile with a plan file or a ledger-only id", () => {
  const design = readSkill("omt-design");
  assert.match(design, /A main thread on Claude Opus draws the profile's variant count in a new Paper file itself; any other model sends the drawing to one routed design child\./);
  const frame = section(design, "### 1. ");
  assert.match(frame, /When the ledger plan has a plan file, run `omt profile show --plan <ledger plan> --json`\./);
  assert.match(frame, /When the ledger plan has no plan file, use `omt profile show <name> --json` for an explicit profile name\./);
  assert.match(frame, /When neither a plan file nor a profile name exists, run `omt profile show --json`\./);
  assert.match(frame, /Keep the returned `profile` as `<name>` for later commands\./);
  assert.match(section(design, "### 2. "), /When T3 refuses a target, try the configured `design` fallbacks/);
  assert.match(section(design, "### 2. "), /When every configured target fails, or the role is unavailable, stop and tell the owner/);
});

test("omt-design draws in the main thread on Opus and in one design child otherwise", () => {
  const design = readSkill("omt-design");
  assert.doesNotMatch(design, /You design nothing yourself/);
  const mode = section(design, "### 0. ");
  assert.match(mode, /read your `interactionMode` and `modelSelection`/);
  assert.match(mode, /When the `modelSelection` model is a Claude Opus model, such as `claude-opus-5-5`, you draw\./);
  assert.match(mode, /With any other model, one `design` child draws\./);
  const draw = section(design, "### 2. ");
  assert.match(draw, /When you draw:/);
  assert.match(draw, /When a `design` child draws:/);
  assert.match(draw, /Call `delegate_task` with `mode: "wait"`\./);
  assert.match(section(design, "### 4. "), /Only one `design` child runs at a time\./);
  assert.match(section(design, "### 5. "), /Write `docs\/design\/<slug>\.md` yourself, also when a child drew\./);
});

test("omt-design builds the screens in the same thread with the omt-ulw build steps on request", () => {
  const build = section(readSkill("omt-design"), "### 7. ");
  assert.match(build, /Run this step only when the owner asks to build the screens in this thread\./);
  assert.match(build, /follow \[omt-ulw\]\(\.\.\/omt-ulw\/SKILL\.md\) steps 7 to 12/);
  assert.match(build, /one QA child that checks behavior only/);
});
test("omt-design uses design.variants per screen in a new Paper file and asks for a pick per screen (plan-design)", () => {
  const design = readSkill("omt-design");
  const variants = section(design, "### 2. ");
  assert.match(variants, /Read the effective profile again with the step 1 command before each design pass\./);
  assert.match(variants, /Read `workflow\.design\.variants` as `design\.variants`\./);
  assert.match(variants, /Draw `design\.variants` distinct variants of each screen\./);
  assert.match(variants, /Make a screenshot of every variant\./);
  assert.match(variants, /The task carries the frame from step 1 and the variant count\./);
  assert.match(variants, /When the owner asked for another count, use that count\./);
  assert.match(variants, /make a new Paper file named after the project/);
  assert.match(section(design, "### 3. "), /Group the screenshots by screen, with one line on each variant/);
  assert.match(section(design, "### 3. "), /The owner may mix variants across screens\./);
});
test("omt-design keeps design artifacts and visual-match conditions out of qa tasks", () => {
  const handOff = section(readSkill("omt-design"), "### 6. ");
  assert.match(handOff, /The `qa` task of such a unit gets no `docs\/design\/` paths and no visual-match conditions\. QA checks behavior only\./);
  assert.match(handOff, /The owner compares the result with the design\./);
});

test("omt-plan keeps the real-data done condition (plan-design)", () => {
  assert.match(section(readSkill("omt-plan"), "### 3. "), /its done condition includes a check on an input shaped like real data/);
});

test("omt-plan reads the grill file into research (U3)", () => {
  const explore = section(readSkill("omt-plan"), "### 1. ");
  assert.match(explore, /When `\$\(omt paths --grills\)\/<slug>\.md` exists, read it\./);
  assert.match(explore, /Put its goal, its decisions, and its edge cases under `## Research`, with the grill file as the source\./);
});

test("omt-plan does not ask settled grill decisions again (U3)", () => {
  const ask = section(readSkill("omt-plan"), "### 2. ");
  assert.match(ask, /A decision in the grill file is settled\. Do not ask it again\./);
  assert.match(ask, /From the grill, ask only its open questions and its `pending` edge cases, then the new owner decisions\. The owner accepts, changes, or drops each `pending` edge case\./);
});

test("omt-plan offers omt-grill first for unclear intent (U3)", () => {
  const ask = section(readSkill("omt-plan"), "### 2. ");
  assert.match(ask, /When no grill file exists, and the goal has no done condition that can fail or 4 or more owner decisions remain, offer \[omt-grill\]\(\.\.\/omt-grill\/SKILL\.md\) as the first option in the batch\./);
  assert.match(ask, /When the owner picks it, run `omt-grill` with the slug, then come back to this step\./);
});

test("omt-plan maps accepted grill edge cases to integration or unit lines, never e2e (U3)", () => {
  const write = section(readSkill("omt-plan"), "### 3. ");
  assert.match(write, /Map each grill edge case with `State: accepted` or `State: changed`\./);
  assert.match(write, /A changed edge case uses the user's handling and test layer from the grill file\./);
  assert.match(write, /A `dropped` edge case gets no line and no done condition\./);
  assert.match(write, /A `pending` edge case gets no line until the owner answers it\./);
  assert.match(write, /Each mapped grill edge case with `Test: integration` or `Test: unit` becomes a `## Tests` line of that layer, with `Reason: grill edge case GE<k>`\./);
  assert.match(write, /When that layer is outside `plan\.testLayers`, put the line in the step 2 batch for owner approval, as any other line outside\./);
  assert.match(write, /A grill edge case never becomes an e2e line\./);
  assert.match(write, /A mapped edge case with `Test: none`, and every mapped edge case when `build\.qa` is `off`, goes into the done condition of the unit that owns its handling\./);
});

test("omt-plan allows grill in plan mode and reads its final message (U3)", () => {
  const mode = section(readSkill("omt-plan"), "### 0. ");
  assert.match(mode, /- Dispatch only `explore`, `research`, `grill`, and `plan-review`\. `research` runs only inside `omt-grill`\./);
  assert.match(mode, /No grill file exists: take the grill text from the final message of `omt-grill` in this conversation\./);
});


test("UI work can skip design while setup recommends the optional frontend-design skill", () => {
  const setup = readSkill("omt-setup");
  assert.match(setup, /For a plain "set up omt", run steps 3, 4, 5, and 5a in order/);
  assert.match(setup, /Check for Anthropic's `frontend-design` skill and recommend installing it when missing/);
  const guidance = readFileSync(join(SKILLS_DIR, "omt", "references", "frontend-design.md"), "utf8");
  assert.match(guidance, /Install only when the user asks/);
  assert.match(guidance, /A missing skill or a declined installation does not block setup, design, or UI implementation/);
  assert.match(guidance, /When the task cites an approved design spec, follow that spec/);
  assert.match(guidance, /The implementation does not need to load `frontend-design` again/);
  assert.match(guidance, /Without an approved design spec, implement the UI directly from the task requirements unless the user requested a design pass first/);
  assert.match(section(readSkill("omt-plan"), "### 3. "), /Plan an `omt-design` step only when the user requests a design pass first/);
  assert.match(section(readSkill("omt-design"), "### 2. "), /to load Anthropic's `frontend-design` skill when available/);
  const ui = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "ui.md"), "utf8");
  assert.match(ui, /A missing design spec, Paper, Figma, or the `frontend-design` skill does not block the work/);
  assert.doesNotMatch(ui, /BLOCKED[^\n]*no spec/);
});
