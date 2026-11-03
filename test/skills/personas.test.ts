import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { RESULT_KINDS } from "../../src/types.ts";
import { SKILLS_DIR } from "./shared.ts";

test("a persona file exists for every default role and for custom roles", () => {
  const rolesDir = join(SKILLS_DIR, "omt", "references", "roles");
  for (const role of [...Object.keys(DEFAULT_CONFIG.roles), "_generic"]) {
    assert.ok(existsSync(join(rolesDir, `${role}.md`)), `missing roles/${role}.md`);
  }
});

test("a contract file holding one text block exists for every result kind", () => {
  const resultsDir = join(SKILLS_DIR, "omt", "references", "results");
  for (const kind of RESULT_KINDS) {
    const text = readFileSync(join(resultsDir, `${kind}.md`), "utf8").trim();
    assert.match(text, /^```text\n[\s\S]+\n```$/, `results/${kind}.md`);
    assert.equal(text.split("```").length, 3, `results/${kind}.md has one fenced block`);
  }
});

test("the resolve-by-hand table in roles.md matches the default chains", () => {
  const text = readFileSync(join(SKILLS_DIR, "omt", "references", "roles.md"), "utf8");
  const section = text.slice(text.indexOf("## Resolve by hand"), text.indexOf("Build the target as"));
  const rows: Record<string, string[]> = {};
  for (const match of section.matchAll(/^\| `([a-z-]+)` \| (.+) \|$/gm)) {
    rows[match[1] ?? ""] = (match[2] ?? "").split("|").map((rung) => rung.trim()).filter((rung) => rung !== "none");
  }
  const expected: Record<string, string[]> = {};
  for (const [name, role] of Object.entries(DEFAULT_CONFIG.roles)) {
    for (const rung of role.chain) assert.equal(rung.provider, rung.driver, name);
    expected[name] = role.chain.map((rung) => `${rung.driver ?? ""} / ${rung.model} / ${rung.effort ?? ""}`);
  }
  assert.deepEqual(rows, expected);
  assert.match(text, /Build the target as `\{ "providerInstanceId": "<driver>", /);
  const crossFamily = Object.entries(DEFAULT_CONFIG.roles)
    .filter(([, role]) => role.crossFamily === true)
    .map(([name]) => `\`${name}\``);
  assert.match(section, new RegExp(`The cross-family roles are ${crossFamily.slice(0, -1).join(", ")}, and ${crossFamily.at(-1)}\\.`));
});

test("skills name the shared evidence directory, not a bare .omt/evidence/ path (personas)", () => {
  assert.match(readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "ui.md"), "utf8"), /`omt paths --evidence`/);
});

test("the design and ui personas exist, and no model reviews design artifacts (personas)", () => {
  const rolesDir = join(SKILLS_DIR, "omt", "references", "roles");
  for (const role of ["design", "ui"]) {
    assert.ok(DEFAULT_CONFIG.roles[role], role);
    assert.ok(existsSync(join(rolesDir, `${role}.md`)), `missing roles/${role}.md`);
  }
});

test("every plan has a summary (personas)", () => {
  const rolesDir = join(SKILLS_DIR, "omt", "references", "roles");
  assert.match(readFileSync(join(SKILLS_DIR, "omt", "references", "planning.md"), "utf8"), /Write `## Summary` last, in at most 15 lines for the owner/);
  assert.match(readFileSync(join(rolesDir, "plan-review.md"), "utf8"), /6\. A line of `## Summary` that the rest of the plan does not support\./);
});

test("omt-design asks for 3 variants per screen in a new Paper file and a pick per screen (personas)", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "design.md"), "utf8");
  assert.match(persona, /The first variants task makes a new Paper file named after the project\. Do not reuse a file that is already open\./);
  assert.match(persona, /Every later task works in the Paper file that the task names\./);
  assert.match(persona, /make 3 variants of each screen/);
});

test("the retired verify, quick, and deep personas are gone (personas)", () => {
  for (const role of ["verify", "quick", "deep", "test"]) {
    assert.equal(existsSync(join(SKILLS_DIR, "omt", "references", "roles", `${role}.md`)), false, role);
  }
});

test("qa runs checks and device flows, edits nothing, and writes no tests (personas)", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "qa.md"), "utf8");
  assert.match(persona, /You run the checks that the task lists and report what each one did\. You edit nothing\./);
  assert.match(persona, /Edit no files in the repository and write no tests\. Make no failure proofs\./);
  assert.match(persona, /Run every command in Verify and every check that the task lists\./);
  assert.match(persona, /Walk each device flow that the task lists, on a device, a Simulator, a browser, or a computer\./);
  assert.match(persona, /at least one check with an input shaped like real data/);
  assert.match(persona, /A seeded or ideal sample alone is not enough\./);
  assert.match(persona, /Save each command's full output in the evidence directory/);
  assert.match(persona, /`omt paths --evidence`/);
  assert.match(persona, /Capture each exit code in the command that runs it/);
  assert.match(persona, /Never add an exit code to a log afterwards\./);
  assert.match(persona, /Save a screenshot of the screen that shows the result, or a recording/);
  assert.match(persona, /Report each check under `CHECKS` with its exit code and its key output line, copied from the output\./);
  assert.match(persona, /List every log, screenshot, and recording under `EVIDENCE`, with its absolute path\./);
  assert.match(persona, /For a `ui` unit, check behavior, not looks\./);
  assert.match(persona, /`VERIFIED`: every check ran and passed\. Reading code is not a check; a verdict from reading code alone is not VERIFIED\./);
  assert.match(persona, /`NOT VERIFIED`: at least one check ran and failed\./);
  assert.match(persona, /`INCONCLUSIVE`: a check could not run/);
  assert.match(persona, /Use the running daemon as it is\. Never upgrade, restart, or replace it, and never stop a simulator or device that you did not boot\./);
  assert.match(persona, /When the daemon's version does not match what you need, or you cannot reach it, report `INCONCLUSIVE` with the reason\./);
  assert.match(persona, /Close each device or browser session that you open, also when a check fails\./);
  assert.match(persona, /run its close command on every exit path/);
  assert.doesNotMatch(persona, /failureProofs: on|qa_base|Write only the task's test lines|TESTS/);
  for (const kind of ["test", "work"]) {
    const contract = readFileSync(join(SKILLS_DIR, "omt", "references", "results", `${kind}.md`), "utf8");
    assert.match(contract, /EVIDENCE:\n- <path of a log, screenshot, or recording in the evidence directory>; or none/);
  }
});

for (const role of ["execute", "ui", "writing"]) {
  test(`${role} writes no new tests and makes no failure proofs (personas)`, () => {
    const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", `${role}.md`), "utf8");
    assert.match(persona, /Write no new test file and no new test case\./);
    assert.match(persona, /Update an existing test that your change breaks, and say so under `NOTES`\./);
    assert.match(persona, /Do not prove that tests can fail\./);
    assert.doesNotMatch(persona, /Add or update tests for the behavior you change/);
  });
}

for (const role of ["execute", "ui"]) {
  test(`${role} works as an independent track and drives no device (personas)`, () => {
    const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", `${role}.md`), "utf8");
    assert.match(persona, /as an independent track\. The main thread builds the other units at the same time, so stay inside your scope\./);
    assert.doesNotMatch(persona, /`verify`|omt brief verify/);
  });
}

test("ui lists screens for the qa task and leaves the visual comparison to the owner (personas)", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "ui.md"), "utf8");
  assert.match(persona, /Drive no device yourself\. Under `OPEN`, list each screen and state that you changed, with the steps to reach it, for the main thread to send to the `qa` task\./);
  assert.match(persona, /The owner reviews the UI against the spec or task requirements\./);
});

for (const role of ["review", "oracle"]) {
  test(`${role} fixes local findings when it may edit and reports the rest (personas)`, () => {
    const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", `${role}.md`), "utf8");
    assert.match(persona, /Fixes: when your Access line allows edits and the task asks for fixes, fix each local finding yourself\./);
    assert.match(persona, /A local finding has a clear fix inside the changed files that agrees with the plan Summary in the task\./);
    assert.match(persona, /Report every other finding, such as a finding that changes the approach or the plan\./);
    assert.match(persona, /List each fix under `FIXES` with its paths\./);
    assert.match(persona, /When your Access line is read-only, change no files/);
  });
}

for (const role of ["review", "oracle"]) {
  test(`${role} reports missing tests only when the plan or task names them (personas)`, () => {
    const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", `${role}.md`), "utf8");
    assert.match(persona, /Report a missing test only when the plan or the task names that test\./);
    assert.doesNotMatch(persona, /missing tests for changed behavior/);
    if (role === "oracle") {
      assert.match(persona, /For each finding other than a CRAP finding, state a concrete failure scenario\./);
      assert.match(persona, /For a CRAP finding, report the changed function and its complexity, coverage, and CRAP values instead of a failure scenario\./);
      assert.match(persona, /Apply this CRAP exception in every round\./);
      assert.match(persona, /For every finding, state how you confirmed it: the file you read or the command you ran, with its output\./);
    }
  });
}

test("review cites written rules and computes requested CRAP findings (personas)", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "review.md"), "utf8");
  assert.match(persona, /Read the rule files that the task lists\./);
  assert.match(persona, /For a finding that breaks a written rule, cite the rule file and line\./);
  assert.match(persona, /When the task asks for CRAP, compute it for each function that the PR adds or changes\./);
  assert.match(persona, /Use `CRAP = complexity² × \(1 − coverage\)³ \+ complexity`\./);
  assert.match(persona, /Count McCabe complexity as 1, plus 1 for each `if`, `else if`, loop, `case`, `catch`, `&&`, `\|\|`, `\?\?`, and `\?:`\./);
  assert.match(persona, /Set coverage to the share of the function's lines that the coverage file marks as hit\./);
  assert.match(persona, /Without a coverage file, use coverage 0 and say `no coverage data`\./);
  assert.match(persona, /Report a P2 finding for CRAP above 30 with the complexity, coverage, and CRAP values\./);
  assert.match(persona, /Every finding other than a CRAP finding states a concrete failure scenario: the input or state, and the wrong output or crash it causes\./);
  assert.match(persona, /If a finding other than a CRAP finding has no failure scenario, put it under `NOTES` or leave it out\./);
  assert.match(persona, /For a CRAP finding, report the changed function and its three values instead of a failure scenario\./);
  assert.match(persona, /Apply this CRAP exception in every round\./);
  assert.match(persona, /In round 2 and later, read `Prior rounds` first\. Check that each earlier finding is fixed\. Look for regressions from the fixes\. For a new finding other than a CRAP finding, state a concrete failure scenario\. For a new CRAP finding, report the changed function and its complexity, coverage, and CRAP values\./);
});

test("plan writes the test list top-down with owner approval (personas)", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "planning.md"), "utf8");
  assert.match(persona, /Fill `## Tests` top-down: e2e tests of the main user flows, then integration cases that e2e skips, then unit cases, then other kinds only when the owner asks\./);
  assert.match(persona, /Use main flows of each vertical slice that `qa` can also walk\./);
  assert.match(persona, /Propose only the layers in `plan\.testLayers` without being asked\./);
  assert.match(persona, /Give a reason for a line in another layer, and keep it only when the owner approves it\./);
  assert.match(persona, /Use one e2e test per main flow\./);
  assert.match(persona, /Keep edge cases out of the e2e lines\./);
  assert.match(persona, /Write each `## Tests` line as `- <layer> <unit>: <flow or case>\. File: <path>\. Reason: <why>\.`/);
  assert.match(persona, /The owner approves the test list with the plan\./);
  assert.match(persona, /An empty section means no new tests\./);
});

test("plan-review checks the test list against the approved layers (personas)", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "plan-review.md"), "utf8");
  assert.match(persona, /7\. A `## Tests` list that breaks the test policy below\. Cite the line and the policy it breaks\./);
  assert.match(persona, /Check `## Tests` top-down: e2e tests of the main user flows, then integration cases that e2e skips, then unit cases, then other kinds only when the owner asks\./);
  assert.match(persona, /Check that the main flows of each vertical slice are flows that `qa` can also walk\./);
  assert.match(persona, /Allow only the layers in `plan\.testLayers` without an owner request\./);
  assert.match(persona, /Require a reason and owner approval for a line in another layer\./);
  assert.match(persona, /Require one e2e test per main flow\./);
  assert.match(persona, /Keep edge cases out of the e2e lines\./);
  assert.match(persona, /Require each `## Tests` line to use `- <layer> <unit>: <flow or case>\. File: <path>\. Reason: <why>\.`/);
  assert.match(persona, /The owner approves the test list with the plan\./);
  assert.match(persona, /An empty section means no new tests\./);
});

test("guardrail classifies every finding without editing files (personas)", () => {
  const persona = readFileSync(join(SKILLS_DIR, "omt", "references", "roles", "guardrail.md"), "utf8");
  assert.match(persona, /You change no files\./);
  assert.match(persona, /Read the merged findings, the CI failures, the rule-file list, and `\.omt\/guardrails\.md` when it exists\./);
  assert.match(persona, /Skip proposals that `\.omt\/guardrails\.md` already holds\./);
  assert.match(persona, /For each finding, choose the first class that fits: `check`, then `rule-fix`, then `new-rule`\./);
  assert.match(persona, /Use `check` when a lint rule, type rule, test, CI step, or script can catch the finding\./);
  assert.match(persona, /Name the tool, the config change, and the command that fails on the PR head and passes after the change\./);
  assert.match(persona, /Use `rule-fix` when a written rule covers the case but is unclear or contradicts another rule\./);
  assert.match(persona, /Cite the rule file and line, and state the correction\./);
  assert.match(persona, /Use `new-rule` when no written rule covers the case\./);
  assert.match(persona, /Name the file for the rule and state its text\./);
  assert.match(persona, /Give no proposal for a finding that only judgment can catch\./);
  assert.match(persona, /List each finding with no proposal and its reason under `NOTES`\./);
  assert.match(persona, /7\. Only when the task includes CRAP results, propose missing complexity lint and coverage gate checks as `check` proposals\./);
  assert.match(persona, /Use the CRAP finding ids in these proposals' `<finding ids>` field\./);
  assert.match(persona, /Number the task's proposals `G1`, `G2`, and so on\./);
  assert.match(persona, /Link each proposal to its finding ids\./);
  assert.match(persona, /Name its class, destination file, and proof command, or `none` when no command applies\./);
  assert.match(persona, /Leave `\.omt\/guardrails\.md` unchanged for the main thread to update\./);
  assert.match(persona, /Leave renumbering to the main thread when it appends proposals to `\.omt\/guardrails\.md`\./);
  assert.match(persona, /each proposal states a check or a rule change that would prevent the finding\./);
  assert.match(persona, /Return the `guardrail` result block\./);
  assert.match(persona, /Stop when every finding has a new proposal or a note that explains why it has none\./);
  assert.match(persona, /Return `PROPOSALS` when new proposals remain, or `NONE` otherwise\./);
});

test("guardrail has the exact proposal contract from the design (personas)", () => {
  const contract = readFileSync(join(SKILLS_DIR, "omt", "references", "results", "guardrail.md"), "utf8");
  assert.match(contract, /^```text\nVERDICT: PROPOSALS \| NONE\nSUMMARY: <one or two sentences>\nPROPOSALS:\n- G<k> \[check\|rule-fix\|new-rule\] <finding ids>: <proposal>\. Where: <file>\. Proof: <command that fails on the PR head and passes after the change, or none>\.\nNOTES:\n- <each finding with no proposal and why, or none>\n```\n$/);
});

test("roles explains qa, guardrail, and device ownership (personas)", () => {
  const text = readFileSync(join(SKILLS_DIR, "omt", "references", "roles.md"), "utf8");
  assert.doesNotMatch(text, /\| `(verify|quick|deep)` \|/);
  assert.match(text, /\| `qa` \| edit \| test \| Running the given check commands and device flows for a verdict with exit codes, logs, and screenshots\. Edits nothing and writes no tests\. \|/);
  assert.match(text, /\| `execute` \| edit \| work \| One large planned unit with a disjoint scope, built as an independent track while the main thread builds the rest\. \|/);
  assert.match(text, /\| `guardrail` \| read-only \| guardrail \| Turning review findings into deterministic checks and rule fixes\. Proposes changes and edits no files\. \|/);
  assert.match(text, /Only `qa` drives a device, a Simulator UI, a browser, or a computer\./);
  assert.match(text, /Every other role lists each device check with its steps and expected results for the main thread, which sends it to `qa`/);
  assert.match(text, /`review` for plan-review, grill, review, oracle, and guardrail/);
  assert.match(text, /`implementation` for execute, writing, and ui, `test` for qa\)/);
  assert.match(text, /A custom role gets its result block from its `result` field: `work`, `review`, `test`, `research`, `plan`, `guardrail`, or `grill`\./);
});

test("roles pins fast defaults, precedence, mappings, and explicit overrides (personas)", () => {
  const text = readFileSync(join(SKILLS_DIR, "omt", "references", "roles.md"), "utf8");
  assert.match(text, /Set fast mode with `models\.<id>\.fast`, `roles\.<role>\.fast`, or `rung\.fast`\./);
  assert.match(text, /The first set value wins in this order: rung, role, model, then `false`\./);
  assert.match(text, /The default sets `models\.gpt-6\.1-sol\.fast` to `true`\./);
  assert.deepEqual(DEFAULT_CONFIG.models, { "gpt-6.1-sol": { fast: true } });
  assert.match(text, /No default role or rung sets `fast`\./);
  for (const role of Object.values(DEFAULT_CONFIG.roles)) {
    assert.equal(role.fast, undefined);
    for (const rung of role.chain) assert.equal(rung.fast, undefined);
  }
  assert.match(text, /When `fast` is `true`, map it as follows\./);
  assert.match(text, /With capabilities, use the model's advertised options\./);
  assert.match(text, /A `serviceTier` select with `priority` maps to `serviceTier: "priority"`\./);
  assert.match(text, /A boolean `fastMode` maps to `fastMode: true`\./);
  assert.match(text, /Without capabilities, driver `codex` gets `serviceTier: "priority"`, and driver `claudeAgent` with a model id that starts with `claude-opus` gets `fastMode: true`\./);
  assert.match(text, /Otherwise, add no option and report `fast mode is not offered by <provider>\/<model>`\./);
  assert.match(text, /A key in `rung\.options` wins over the fast mapping\./);
  assert.match(text, /With `fast: false`, add no fast option and use the provider default\./);
  assert.match(text, /For any other driver, send no effort option\./);
});

test("results maps qa checks, review fixes, worker notes, and guardrail proposals (personas)", () => {
  const references = join(SKILLS_DIR, "omt", "references");
  const text = readFileSync(join(references, "results.md"), "utf8");
  assert.match(text, /\| `test` \| qa \| \[results\/test\.md\]\(results\/test\.md\)/);
  assert.match(text, /\| `work` \| execute, writing, ui, design \|/);
  assert.match(text, /\| `guardrail` \| guardrail \| \[results\/guardrail\.md\]\(results\/guardrail\.md\) \| `VERDICT: PROPOSALS \\\| NONE` \|/);
  assert.match(text, /It stays a claim until you or a `qa` task checks it against the real artifact\./);
  assert.match(text, /Run at least one `VERIFY` command yourself, or send it to a `qa` task\./);
  assert.match(text, /Check: record `verified` or `rejected` after your own check or a `qa` task\./);
  assert.match(text, /\| `verified` \| your own check or a `qa` task confirmed the unit \|/);
  assert.match(text, /`NOTES` is optional\. A worker that updates an existing test because its change broke it reports the update there\./);
  assert.match(text, /`FIXES` lists the fixes that the reviewer made, with their paths\. Read the diff of those paths before you act on the result\./);
  assert.match(text, /Read the exit code of each `CHECKS` line and the last lines of each failed log\./);
  assert.match(text, /Check that each finding other than a CRAP finding names a concrete failure scenario\./);
  assert.match(text, /For a CRAP finding, accept the changed function and its complexity, coverage, and CRAP values instead of a failure scenario\./);
  assert.match(text, /Apply this CRAP exception in every round\./);
  assert.match(text, /`PROPOSALS`: read each proposal's finding ids, class, destination file, and proof command\./);
  assert.match(text, /Skip proposals that `\.omt\/guardrails\.md` already holds\./);
  assert.match(text, /Append each new proposal to `\.omt\/guardrails\.md` as `- \[ \] G<k> <date> PR #<n> <class>: <proposal>\. Where: <file>\. Proof: <command or none>\.`/);
  assert.match(text, /Set `<k>` to one above the highest id in the file\./);
  assert.match(text, /`NONE`: no new proposal remains\. Read `NOTES` for each finding with no proposal and its reason\./);
  assert.match(text, /The owner turns proposals into work with omt-ulw on a separate branch\./);
  assert.doesNotMatch(text, /`verify`|`deep`|omt-loop/);
  const contract = readFileSync(join(references, "results", "test.md"), "utf8");
  assert.doesNotMatch(contract, /TESTS:/);
  const review = readFileSync(join(references, "results", "review.md"), "utf8");
  assert.match(review, /FINDINGS:\n- \[P0\|P1\|P2\|P3\] <path>:<line> <problem>\. Fix: <fix>\.\nFIXES:\n- <path>: <the finding that you fixed and what changed>; or none\nNOTES:/);
  const work = readFileSync(join(references, "results", "work.md"), "utf8");
  assert.match(work, /NOTES:\n- <existing test updated because the change broke it, or other note; optional>/);
});

test("the Mira fixes pin every new rule in the skills and references (personas)", () => {
  const references = join(SKILLS_DIR, "omt", "references");
  const results = readFileSync(join(references, "results.md"), "utf8");
  assert.match(results, /A P0 with a clear fix inside the scope needs a fix\./);
  assert.doesNotMatch(results, /Stop the unit and re-plan before more fixes\./);
  const plan = readFileSync(join(references, "planning.md"), "utf8");
  assert.match(plan, /give it a done condition on an input shaped like real data/);
  assert.match(plan, /The role is `main` for a unit that the main thread builds, `ui` for a unit that implements a design or changes UI, and `writing` for a unit that only writes documentation or other prose\./);
  assert.doesNotMatch(plan, /task budget/);
});
