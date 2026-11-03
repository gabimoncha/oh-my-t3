import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, readSkill, section } from "./shared.ts";

test("each mode-check step calls t3_thread_configure, and no skill reads modes from orchestrator_capabilities (ulw)", () => {
  const modeSteps: Record<string, string> = {
    "omt-ulw": "### 0. ",
    "omt-swarm": "### 0. ",
  };
  for (const [name, heading] of Object.entries(modeSteps)) {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const start = text.indexOf(`\n${heading}`);
    assert.ok(start >= 0, `${name} has no step ${heading.trim()}`);
    const end = text.indexOf("\n### ", start + 1);
    const step = text.slice(start, end < 0 ? undefined : end);
    assert.match(step, /t3_thread_configure/, `${name} mode step`);
    assert.doesNotMatch(step, /orchestrator_capabilities/, `${name} mode step`);
  }
});

test("delegation.md has a branch check, and both step 0s link to it (ulw)", () => {
  const delegation = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  const check = section(delegation, "## Branch check");
  assert.match(check, /refs\/remotes\/origin\/HEAD/);
  assert.match(check, /git merge --ff-only <default>/);
  assert.match(check, /In `plan` mode, only report the count\./);
  for (const name of ["omt-ulw"]) {
    assert.match(section(readSkill(name), "### 0. "), /\(\.\.\/omt\/references\/delegation\.md#branch-check\)/, name);
  }
});

test("omt-swarm does not tell a track to edit limits.maxParallel", () => {
  const text = readSkill("omt-swarm");
  assert.doesNotMatch(text, /limits\.maxParallel/);
  assert.match(text, /omt plan limit <slug>-<track> <k>/);
});

test("skills name the shared evidence directory, not a bare .omt/evidence/ path (ulw)", () => {
  for (const name of ["omt-ulw"]) {
    assert.match(readSkill(name), /`omt paths --evidence`/, name);
  }
});


const REFS = join(SKILLS_DIR, "omt", "references");
const DELEGATION = join(REFS, "delegation.md");

test("omt-ulw prints the build banner and keeps its name and trigger words", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(ulw, /^---\nname: omt-ulw\n/);
  assert.match(ulw, /description: ulw \/ ultrawork in T3 Code\. Use when the user says ulw or ultrawork/);
  assert.match(ulw, /The main thread explores, asks question batches, plans, and builds the change itself, then one review child and one QA child check the work/);
  assert.match(ulw, /`omt ultrawork: explore, ask, plan, build, review, test\.`/);
  assert.doesNotMatch(ulw, /plan, delegate, review, test, verify/);
});

test("omt-ulw has the build contract, not the delegate-each-unit contract", () => {
  const contract = section(readSkill("omt-ulw"), "## Contract");
  assert.match(contract, /You build\. You explore, plan, edit the code, write the planned tests, and fix\. Children review and test\./);
  assert.match(contract, /Every run has one review child \(step 8\) and one QA child \(step 10\)/);
  assert.match(contract, /A LIGHT run skips the plan review and the owner approval of the plan\. It still has the review child and the QA child\./);
  assert.match(contract, /Done means a check that can fail ran and passed\./);
  assert.match(contract, /Record every child dispatch and every result in the ledger\./);
  assert.doesNotMatch(contract, /You edit no product files/);
  assert.doesNotMatch(contract, /one `execute` child per unit/);
});

test("omt-ulw has the steps of the design table in order", () => {
  const ulw = readSkill("omt-ulw");
  const headings = [...ulw.matchAll(/^### (\d+)\. (.+)$/gm)].map((match) => `${match[1]}. ${match[2]}`);
  assert.deepEqual(headings, [
    "0. Check your mode",
    "1. Question or goal",
    "2. Explore",
    "3. Frame",
    "4. Ask",
    "5. Plan",
    "6. Design check",
    "7. Build",
    "8. Review",
    "9. Read the fix diff and fix",
    "10. QA",
    "11. Fix failed checks",
    "12. Ship and report",
  ]);
  for (const [, body] of ulw.split(/\n### \d+\. /).slice(1).entries()) {
    assert.match(body, /\nDone when: /);
  }
});

test("omt-ulw sends a question to omt-research and explores before it asks", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(section(ulw, "### 1. "), /run the `omt-research` skill instead/);
  const explore = section(ulw, "### 2. ");
  assert.match(explore, /Read the code that the goal touches yourself\. Send only broad reads to 1 to `maxParallel` read-only `explore` children/);
  assert.match(explore, /--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"/);
  assert.match(explore, /wait for them in this turn/);
  const ask = section(ulw, "### 4. ");
  assert.match(ask, /Ask every open owner question in one batch\. Give each question 2 to 4 options and your recommendation\./);
  assert.match(ask, /A question that the code can answer is not an owner question/);
  assert.match(ask, /Stop when no question is open\./);
  assert.match(section(ulw, "## Rules"), /Ask each owner question once\. Later status messages do not repeat open questions\./);
});

test("omt-ulw selects the profile before exploration and frames the run", () => {
  const explore = section(readSkill("omt-ulw"), "### 2. ");
  assert.match(explore, /Pick the plan slug before the first brief/);
  assert.match(explore, /compare `active` with the selected profile/);
  const frame = section(readSkill("omt-ulw"), "### 3. ");
  assert.match(frame, /Each done condition is a check that can fail: a command, a test, or an observable result\./);
  assert.match(frame, /Tier LIGHT: one or two units, one area of code, no design decision left\. Tier HEAVY: anything else\./);
  assert.match(frame, /The slug matches `\^\[a-z0-9\]\[a-z0-9-\]\{0,63\}\$`/);
  assert.match(explore, /When the plan file exists, run `omt profile show --plan <slug> --json`\./);
  assert.match(explore, /`omt profile show <name> --json` for `ulw --profile <name>`/);
  assert.match(explore, /Keep the effective `profile`, `workflow`, `limits`, `roles`, and `models`\./);
  assert.match(explore, /pass the run's `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command/);
  assert.match(explore, /\[The CLI\]\(\.\.\/omt\/references\/delegation\.md#the-cli\) says where to find the CLI\./);
  assert.match(explore, /\[roles\.md\]\(\.\.\/omt\/references\/roles\.md#resolve-by-hand\)/);
  assert.match(frame, /`omt plan profile <slug> <name>`/);
  assert.match(section(readSkill("omt-ulw"), "## Rules"), /After a context reset, read the plan \(`omt plan status <slug>`\), the ledger \(`omt ledger list --plan <slug>`\), and the profile \(step 2\) before you act\./);
});

test("omt-ulw plans LIGHT runs itself and HEAVY runs through omt-plan", () => {
  const plan = section(readSkill("omt-ulw"), "### 5. ");
  assert.match(plan, /LIGHT: run `omt plan new <slug> --light` and fill it yourself, `## Summary` last by the rule in \[planning\.md\]/);
  assert.match(plan, /The LIGHT plan needs no owner approval\./);
  assert.match(plan, /HEAVY: run the `omt-plan` skill with the slug before any plan file exists\./);
  assert.match(plan, /The owner approves the HEAVY plan before you build\./);
  assert.match(plan, /name the effective `plan\.testLayers` value in the task text/);
  assert.match(plan, /Write each approved test as `- <layer> <unit>: <flow or case>\. File: <path>\. Reason: <why>\.` The reason names the bug or regression that the test catches\. With `build\.qa: planned`, keep only the owner's approved test lines\. With `build\.qa: off`, leave `## Tests` empty\./);
  assert.match(plan, /Use integration tests by default: real code through the interface that production uses, with only external services faked\./);
  assert.match(plan, /Use e2e only for a core user journey, or for a failure that needs the client, server, and backend together, and unit only for pure logic with real branching/);
  assert.match(plan, /The role of a unit that you build is `main`\./);
  assert.match(plan, /has a done condition on an input shaped like real data, also in a LIGHT plan/);
  assert.match(plan, /A unit that implements a design or changes UI has the role `ui`, also in a LIGHT plan\./);
  assert.match(plan, /Keep an `F2` oracle item only when `build\.oracle` requires the oracle for the run's tier: `heavy` for HEAVY only, `always` for both tiers, `off` for neither\./);
  assert.match(plan, /When an `F2` oracle item is required but missing, add `- \[ \] F2\. The oracle role approves the whole change\.`\./);
  assert.match(plan, /When no oracle is required, remove the `F2` oracle line\./);
});

test("omt-ulw waits for requested designs and permits direct UI implementation", () => {
  const ulw = readSkill("omt-ulw");
  const check = section(ulw, "### 6. ");
  assert.match(check, /When the plan includes a requested design pass/);
  assert.match(check, /Wait for the owner's approval of that spec before you build the affected UI units\./);
  assert.match(check, /Without a requested design pass, build the UI directly from the task requirements\./);
  assert.match(check, /also the hand-off from `omt-plan`/);
  assert.ok(ulw.indexOf("### 6. Design check") < ulw.indexOf("### 7. Build"));
});

test("omt-ulw builds every unit in the main thread", () => {
  const build = section(readSkill("omt-ulw"), "### 7. ");
  assert.match(build, /Before your first edit, save the output of `git status --porcelain` under `Log` in the plan/);
  assert.match(build, /Build the units in the order of the `ready:` line of `omt plan status <slug>`\./);
  assert.match(build, /Run the unit's verify command\. Save the output in the directory that `omt paths --evidence` prints\./);
  assert.match(build, /With `build\.qa: planned`, write the unit's tests from `## Tests`\. Map each new test file or case to one `## Tests` line\./);
  assert.match(build, /With `build\.failureProofs: on`, prove that each new test fails without the change, in a private copy of the working tree\./);
  assert.match(build, /Never break or restore files in the shared checkout\. With `build\.failureProofs: off`, skip the proofs\./);
  assert.match(build, /Run `omt plan mark <slug> <unit> done`\./);
  assert.match(build, /Try the configured `ui` fallbacks when T3 refuses a target\./);
  assert.match(build, /When every configured `ui` target fails, stop and tell the user\. Do not switch to `execute`\./);
  assert.match(build, /Independent track: a large unit with a scope that no other open unit touches may go to an `execute` child, to a `ui` child for a `ui` unit, or to a `writing` child for a `writing` unit\./);
  assert.match(build, /omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope \.\.\. --done \.\.\. --verify \.\.\. --plan <slug> --unit <id> --round 1 --attempt 1 --save --json/);
  assert.match(build, /Dispatch only while `omt ledger stats --plan <slug>` reports `can dispatch: yes`\./);
  assert.match(build, /run its printed `ledger\.dispatched` line/);
  assert.match(build, /Then write its planned tests and make its failure proofs with items 3 and 4 above/);
  assert.match(build, /Run those planned tests and the verify command again\. Both must pass before you mark the unit done\./);
  assert.match(build, /\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#shared-builds\)/);
});

test("omt-ulw review child: other family, plan context, local fixes, one review per build.review", () => {
  const ulw = readSkill("omt-ulw");
  const review = section(ulw, "### 8. ");
  assert.match(section(ulw, "### 0. "), /Keep the driver of `modelSelection` as your family for step 8\./);
  assert.match(review, /When `build\.oracle` requires the oracle for the run's tier, the review child uses the `oracle` role, also when `build\.review` is `off`\. Use `--unit F2`\./);
  assert.match(review, /Otherwise the review child uses the `review` role\./);
  assert.match(review, /With `build\.review: off` and no required oracle, skip this step and step 9\./);
  assert.match(review, /the objective, the done conditions, the plan `## Summary`, and the scope paths\. Do not send your conversation or your history\./);
  assert.match(review, /fix each local finding itself: a clear fix inside the changed files that agrees with the plan Summary/);
  assert.match(review, /It lists each fix with its paths under `FIXES`\./);
  assert.match(review, /--against <your family> --save --json/);
  assert.match(review, /so that the reviewer runs on the other family/);
  assert.doesNotMatch(review, /--against auto/);
  assert.match(review, /From round 2, pass every prior finding with its response in `--prior-file`\./);
  assert.match(review, /Dispatch it with `mode: "wait"` and record the dispatch and the result\./);
  assert.match(review, /Review and QA never run at the same time, because the reviewer edits files\./);
  const fix = section(ulw, "### 9. ");
  assert.match(fix, /Read the reviewer's fix diff before QA starts: run `git diff -- <scope paths>` \(the unstaged changes, which are only the reviewer's\)/);
  assert.match(fix, /Then stage them with `git add -A -- <scope paths>`\./);
  assert.match(section(ulw, "### 8. "), /Before you dispatch the review, stage your work with `git add -A -- <scope paths>`\./);
  assert.match(fix, /With `build\.review: every-round`, run one more review \(step 8\) with the next `--round` to check your fixes, until the review returns `APPROVE` or the run reaches `maxReviewRounds` reviews\. With `first-round`, run no second review\./);
  assert.match(fix, /`BLOCK` for a wrong approach, or a finding whose fix changes the plan: run `omt plan mark <slug> <unit> blocked`/);
  assert.match(fix, /mark `F2` done when it returns `APPROVE`, or when you drop every finding of the last oracle round/);
});

test("omt-ulw keeps the relevance check, applied by the main thread", () => {
  const fix = section(readSkill("omt-ulw"), "### 9. ");
  assert.match(fix, /Relevance check: check each reported finding against the plan\./);
  assert.match(fix, /Drop the others: a style preference, an input or a state that the plan rules out, or a case that cannot happen in the planned flow\./);
  assert.match(fix, /Drop a missing-test finding unless the plan or the task names that test\./);
  assert.match(fix, /Keep a CRAP finding when the profile asks for CRAP, with complexity, coverage, and CRAP values instead of a failure scenario\./);
  assert.match(fix, /Keep a missing check on an input shaped like real data for code that reads outside data/);
  assert.match(fix, /Never drop a finding because its case is rare or unlikely\./);
  assert.match(fix, /Record each dropped finding with its reason under `Log` in the plan and in the next `--prior-file`\./);
  assert.match(fix, /Fix each kept finding yourself/);
});

test("omt-ulw QA child: edits nothing, runs every check, returns exit codes, at most 2 re-runs", () => {
  const ulw = readSkill("omt-ulw");
  const qa = section(ulw, "### 10. ");
  assert.match(qa, /Dispatch one `qa` child\. Give it every verify command of the plan, the final checks \(`F` items with a command\), and the device flows/);
  assert.match(qa, /The QA child edits nothing and writes no tests\. It returns each command with its exit code and a log path, and screenshot paths for device flows\./);
  assert.match(qa, /omt brief qa --task-file - --scope <path> \.\.\. --verify <command> \.\.\. --title "qa: <slug>" --plan <slug> --unit QA --round <n> --attempt 1 --save --json/);
  assert.match(qa, /Read only the exit code of each `CHECKS` line and the last lines of each failed log/);
  assert.match(qa, /\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#verification-and-devices\)/);
  assert.match(qa, /Mark each `D` and `F` item with `omt plan mark <slug> <id> done` after its command passed in the QA run\./);
  const fix = section(ulw, "### 11. ");
  assert.match(fix, /fix it yourself, and run the check yourself\. Then dispatch QA again for only the failed checks, with the next `--round`\./);
  assert.match(fix, /Run at most 2 QA re-runs\. When a check still fails after the second re-run, stop/);
  assert.match(fix, /ask the owner, with each failed command, its exit code, and its log path/);
});

test("omt-ulw keeps the design exclusion: QA checks behavior, the owner checks looks", () => {
  const ulw = readSkill("omt-ulw");
  const qa = section(ulw, "### 10. ");
  assert.match(qa, /Design exclusion: for a `ui` unit, leave `docs\/design\/` out of the QA scope paths, and leave out every done condition and every piece of context that compares the result with the design/);
  assert.match(qa, /QA checks behavior, not looks/);
  assert.match(qa, /The owner compares the looks with the design\. Review and oracle briefs \(step 8\) apply the same exclusion\./);
  const review = section(ulw, "### 8. ");
  assert.match(review, /Leave `docs\/design\/` out of the scope paths/);
  assert.match(review, /For a `ui` unit, also apply the \[design exclusion\]\(#10-qa\)/);
  assert.match(review, /Code review of `ui` units stays\./);
});

test("omt-ulw waits inside its turn and ends a turn only for the owner", () => {
  const ulw = readSkill("omt-ulw");
  const rules = section(ulw, "## Rules");
  assert.match(rules, /You wait for each child inside your turn \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#waiting\)\)\./);
  assert.match(rules, /For one child, call `delegate_task` with `mode: "wait"`\. For parallel children, dispatch each with `mode: "async"`, then call `t3_thread_wait` with `threadId` and `runId` for each\./);
  assert.match(rules, /You end your turn only for the owner: a batch of questions, a plan approval, or the report\./);
  assert.doesNotMatch(ulw, /On wake|end the turn and read the results on wake|Keep your turn short/);
});

test("omt-ulw has no heartbeat, no omt-loop, no check-ins, no reopen, and no task budget", () => {
  const ulw = readSkill("omt-ulw");
  for (const removed of [/heartbeat/i, /schedule_task/, /stalled-tasks/, /omt-loop/, /check-in/, /build\.checkpoint/, /build\.verify/, /stallMinutes/, /[Rr]eopen/, /maxTasksPerRun/, /task budget/, /`deep`/, /`quick`/, /`verify` task/]) {
    assert.doesNotMatch(ulw, removed);
  }
});

test("omt-ulw records every child in the ledger and settles it", () => {
  const ulw = readSkill("omt-ulw");
  assert.match(ulw, /Record every child dispatch and every result in the ledger\./);
  assert.match(section(ulw, "### 7. "), /record the result, and settle the child \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\)/);
  assert.match(section(ulw, "### 11. "), /stop: run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\) and ask the owner/);
  assert.match(section(ulw, "### 12. "), /Before you report, run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\)\./);
});

test("omt-ulw ships by the git rules and reports each done condition with evidence and screenshots", () => {
  const ship = section(readSkill("omt-ulw"), "### 12. ");
  assert.match(ship, /make one commit for the run, then push and open or update the PR, each by the \[Git actions\]\(\.\.\/omt\/references\/delegation\.md#git-actions\) rules/);
  assert.match(ship, /\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#pull-requests\)/);
  assert.match(ship, /Each done condition with its evidence: the command, its exit code, and its log path from the QA run\./);
  assert.match(ship, /The review verdict, the reviewer's fixes, the findings that you fixed, and the findings that you dropped, with the reason\./);
  assert.match(ship, /each screenshot from the QA result as a Markdown image with its absolute path, grouped by screen, such as `!\[library, empty state\]\(\/abs\/path\/library-empty\.png\)`\. When no device flow ran, say so\./);
  assert.match(ship, /The commit hash and the PR URL\./);
  assert.match(ship, /Done when: every done condition from step 3 appears in the report with evidence or as an open item\./);
});

test("no skill names omt-loop or the stall heartbeat, and the omt-loop skill is gone", () => {
  assert.equal(existsSync(join(SKILLS_DIR, "omt-loop")), false);
  for (const name of readdirSync(SKILLS_DIR)) {
    const dir = join(SKILLS_DIR, name);
    for (const file of walk(dir)) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /omt-loop/, file);
      assert.doesNotMatch(text, /stalled-tasks|stall heartbeat|build\.stallMinutes/, file);
    }
  }
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith(".md") || entry.name.endsWith(".yaml") ? [path] : [];
  });
}

test("delegation.md waits in the turn, routes devices to qa, and has no stall section", () => {
  const text = readFileSync(DELEGATION, "utf8");
  assert.doesNotMatch(text, /## Stalled tasks/);
  const waiting = section(text, "## Waiting");
  assert.match(waiting, /So wait for your children inside your turn\. End the turn only for the owner: a batch of questions, a plan approval, or the report\./);
  assert.match(waiting, /For one child, call `delegate_task` with `mode: "wait"` and `timeoutMs` up to 3,600,000\./);
  assert.match(waiting, /For parallel children, dispatch each with `mode: "async"` and record it\. Then call `t3_thread_wait` with `threadId: childThreadId` and `runId: childRunId` for each child/);
  assert.match(waiting, /On `waitTimedOut: true`, the child still runs\. Wait again, or read `task_status`\./);
  assert.doesNotMatch(waiting, /then end your turn/);
  const devices = section(text, "## Verification and devices");
  assert.match(devices, /Only `qa` drives a device, a Simulator UI, a browser, or a computer\./);
  assert.match(devices, /the chain is GPT-6\.1-Sol at medium effort, then Claude Sonnet 5\.5 at low effort\./);
  assert.match(devices, /In the current defaults/);
  assert.match(devices, /A read-only or edit child lists each device check, with its steps and expected result, for the main thread to send to `qa`\./);
  assert.match(devices, /When a `qa` task returns `INCONCLUSIVE` because it cannot reach a local tool, send the same task once to the next rung of another provider\./);
  assert.match(devices, /After that one retry, send an unresolved result to the fix or stop step of the current workflow\./);
  const limits = section(text, "## Limits");
  assert.match(limits, /The omt config sets the limits \(defaults in parentheses\): `maxParallel` \(6\), `maxDepth` \(1\), `maxReviewRounds` \(4\)\./);
  assert.match(limits, /A plan header's `max-parallel` can only lower the profile's `maxParallel`\./);
  assert.doesNotMatch(limits, /maxTasksPerRun|max-tasks|--tasks/);
});

test("delegation pins saved dispatch, fast mode, and locks", () => {
  const text = readFileSync(DELEGATION, "utf8");
  assert.match(text, /\| `task` \| the short file pointer from `omt brief --save --json`, or the rendered brief, at most 120,000 characters \|/);
  assert.match(text, /With the CLI: `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> --save --json`\./);
  assert.match(text, /It prints `\{ delegateTask, fallbacks, ledger \}`\./);
  assert.match(text, /In `plan` interaction mode, omit `--save` and keep the brief in `delegateTask\.task` without writing files or ledger entries\./);
  assert.match(text, /With `--save`, the full brief is in `<evidence>\/briefs\/<clientRequestId>\.md`\./);
  assert.match(text, /After dispatch, run the printed `ledger\.dispatched` line with only `<taskId>` replaced by the returned id\./);
  assert.match(text, /When you build a `plan` or `plan-review` brief, name the effective `workflow\.plan\.testLayers` value in the task text\./);
  assert.match(text, /Keep the fast options in `delegateTask\.target\.options` and in each fallback target\./);
  assert.match(text, /The CLI resolves `rung\.fast`, then `roles\.<role>\.fast`, then `models\.<id>\.fast`, then `false`\./);
  assert.match(text, /See \[roles\.md\]\(roles\.md#fast-mode\) for capability and manual routing rules\./);
  const builds = section(text, "## Shared builds");
  assert.match(builds, /Run each shared build or test command as `omt lock run <name> \[--wait <seconds>\] -- <command>`\./);
  assert.match(builds, /A command that leaves processes running after it exits, such as a dev server, watcher, or daemon, stays outside `omt lock run`\./);
  assert.match(builds, /Make the units that use those processes serial with `omt plan limit <slug> 1`\./);
  assert.match(builds, /If neither `flock` nor `lockf` is on `PATH`, the CLI warns and runs without a lock\./);
  assert.match(builds, /Retry a failed build or test only when the file is outside your scope and outside the task's named code under test\./);
  assert.match(builds, /For `test` results, including `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`\./);
  const spec = readFileSync(join(SKILLS_DIR, "..", "docs", "spec.md"), "utf8");
  for (const source of [builds, section(spec, "### 15.2 ")]) {
    assert.match(source, /A busy lock is not a defect of the change\./);
    assert.match(source, /Apply these rules to a `qa` result and to a command that you run yourself\./);
    assert.match(source, /When a busy lock makes `qa` return `INCONCLUSIVE`, skip the retry on another provider\./);
    assert.match(source, /For a busy lock, run `omt lock list`\./);
    assert.match(source, /When `omt lock list` shows the lock as free, dispatch the next attempt with the same target, or run your own command again\./);
    assert.match(source, /Treat the holder as a task of this run only when an active task of this run gave that command\./);
    assert.match(source, /Never take over or clear a held lock\./);
    assert.match(source, /After a second busy lock for the same check, ask the owner\./);
  }
  assert.doesNotMatch(builds, /check-in|[Rr]eopen|another unit's file is not/);
});

test("briefs pin the CLI, test policy, saved files, and the qa device rule", () => {
  const text = readFileSync(join(REFS, "brief.md"), "utf8");
  assert.match(text, /CLI: Run omt as <command>\./);
  assert.ok(section(text, "## Layout").includes([
    "- <access line>",
    "- <delegation line>",
    "- <evidence line, edit roles only>",
    "- <plan-mode line, read-only roles only>",
    "- <children line, when the child may start children>",
    "- CLI: Run omt as <command>.",
    "- Tests: <role's test policy>",
    "- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.",
    "- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.",
    "- Processes: <process limits and session cleanup>",
    "- Shared files: <private-copy rule for failure proofs>",
    "- Shared builds: <lock and retry rule>",
    "- Devices: <device rule, except for qa>",
  ].join("\n")));
  assert.match(text, /At maximum depth: `Delegation: you are at depth <d> of <max>\. Do all work yourself\. Start no subagents and no delegated tasks\.`/);
  assert.match(text, /- `qa`: `Access: edit no files in the repository\. Write only command output, logs, and screenshots under the Evidence directory\.`/);
  assert.match(text, /For `qa`, it says to write no tests and no failure proofs, and to report each command with its exit code and log path\./);
  assert.match(text, /Give `qa` the verify commands, the final checks, and the device flows, with no new tests\./);
  assert.match(text, /An `execute` brief for a large unit that runs as an independent track/);
  assert.match(text, /Tests: write no new test file and no new test case, and do not prove that tests can fail\./);
  assert.match(text, /With `--save --json`, the full brief is in `<evidence>\/briefs\/omt:http-retry:U2:execute:r1:a1\.md`\./);
  assert.doesNotMatch(text, /`verify` tasks|For device checks, pass/);
  const spec = readFileSync(join(SKILLS_DIR, "..", "docs", "spec.md"), "utf8");
  assert.match(spec, /`Shared builds:` requires the exact lock-wrapped command from the task\./);
  for (const source of [text, section(spec, "### 9.2 ")]) {
    assert.match(source, /Retry a failed build or test only when the file is outside your scope and outside the task's named code under test\./);
    assert.match(source, /When `omt lock run` exits 75, report the command, the lock name, and its message\./);
    assert.ok(source.includes("For `test` results, including `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`."));
  }
});

test("omt routes pull request reviews to the normal PR steps and lists the profile commands", () => {
  const text = readSkill("omt");
  assert.match(text, /For a pull request review, load `omt-code-review` with `omt-code-review <number>`\. The `normal` profile runs all PR steps\. The `prototype` profile turns them off\./);
  assert.doesNotMatch(text, /pr-review/);
  assert.match(text, /\| `omt brief <role> --task-file - --title "<role> <unit>: <title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> \[--against <provider\\\|driver\\\|auto>\] --save --json` \| `\{ delegateTask, fallbacks, ledger \}`; the full brief is in a file and `delegateTask\.task` names it \|/);
  assert.match(text, /\| `omt profile list` \| available workflow profiles \|/);
  assert.match(text, /\| `omt profile show \[<name>\] \[--plan <slug>\] --json` \| the effective `profile`, `source`, `workflow`, `limits`, `roles`, and `models` \|/);
  assert.match(text, /\| `omt plan new <slug> \[--light\] \[--profile <name>\]` \| path of a new plan file under `\.omt\/plans\/`; `--light` leaves out the `F2` oracle item \|/);
  assert.match(text, /\| `omt plan profile <slug> <name\\\|none>` \| switches the plan's profile; `none` removes the plan override \|/);
  assert.match(text, /\| `omt lock run <name> \[--wait <seconds>\] -- <command>` \| runs a command under a shared build lock and returns its exit code \|/);
  assert.match(text, /\| `omt lock list` \| each lock's state and the holder of a held lock \|/);
  assert.match(text, /\| `omt config show` \| the merged config before profile selection, including limits \|/);
  assert.doesNotMatch(text, /omt-show|omt visual|visuals/);
  assert.match(text, /Pass `delegateTask` to `delegate_task` unchanged\./);
  assert.match(text, /Record the dispatch with the printed `ledger\.dispatched` line after replacing `<taskId>`\./);
  assert.match(text, /Use \[delegation\.md\]\(references\/delegation\.md#getting-the-arguments\) for retries and plan-mode dispatch\./);
});

test("the main thread and delegating children settle each finished child", () => {
  const delegation = readFileSync(DELEGATION, "utf8");
  const release = section(delegation, "## Releasing children");
  assert.match(release, /The idle release never reaches the Codex native subagents of a child; only a settle releases them\./);
  assert.match(release, /In `plan` interaction mode you record nothing, but you settle all the same\. After `task_cancel`, settle the child after its `cancelled` or `interrupted` entry\. After a `mode: "wait"` return, call `task_status` first/);
  assert.match(release, /- Condition: `status` is `completed`, `failed`, `cancelled`, or `interrupted`, `hasPendingChildRuns` is `false`, and `hasPendingQuestion` is `false`\./);
  assert.match(release, /call `t3_thread_organize` with `action: "settle"` and `threadId` set to the child's `childThreadId`/);
  assert.match(release, /Never pass the `taskId`\./);
  assert.match(release, /- First check: before the first settle of a run, run `git rev-parse --git-dir --git-common-dir`\. When it prints two different paths, you work in a git worktree: settle no child in this run\./);
  assert.match(release, /- Settle only your children and their children\. Never settle your own thread, a top-level thread \(an `omt-swarm` track, or a thread from `t3_thread_launch` or `create_threads`\), or any other thread\. Do not use `action: "archive"`\./);
  assert.match(release, /A child that starts children settles them itself; its brief says so\. A cancelled or failed child cannot, so the sweep settles its children\./);
  assert.match(release, /- Sweep: run it after a skipped or failed settle, after each `task_cancel`, before you stop the run to ask the owner, and at the end of the run before the report\. When another skill called your skill, skip the sweep; the caller runs it\./);
  assert.match(release, /1\. Take your task ids from `omt ledger list --plan <slug> --json`, or the ids that you kept in `plan` mode\./);
  assert.match(section(delegation, "## Your interaction mode"), /Settle each child after you read its result \(\[Releasing children\]\(#releasing-children\)\)\./);
  const recording = section(readFileSync(join(REFS, "results.md"), "utf8"), "## Recording");
  assert.match(recording, /- Release: after the terminal entry, settle the child as \[delegation\.md\]\(delegation\.md#releasing-children\) says\. In `plan` interaction mode, settle it after you read the result\./);
  const brief = readFileSync(join(REFS, "brief.md"), "utf8");
  assert.match(brief, /- Children, below maximum depth: ``Children: after you read a child's result, settle the child with the T3 `t3_thread_organize` tool/);
  const sweep = /Before you report, run the settle sweep \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#releasing-children\)\)\./;
  for (const [name, heading] of [["omt-ulw", "### 12. Ship and report"], ["omt-code-review", "### 6. Write and report"], ["omt-code-review", "### PR 10. Report"], ["omt-research", "### 5. Synthesize"], ["omt-plan", "### 5. Hand off"], ["omt-design", "### 6. Hand off"]] as const) {
    assert.match(section(readSkill(name), heading), sweep, `${name} ${heading}`);
  }
  const plan = readSkill("omt-plan");
  assert.match(plan, /Dispatch them with `mode: "async"` and wait for them in this turn \(\[delegation\.md\]\(\.\.\/omt\/references\/delegation\.md#waiting\)\)\. Then read the results and record them \(\[results\.md\]\(\.\.\/omt\/references\/results\.md#recording\)\)\./);
  assert.doesNotMatch(plan, /dispatch a `plan` task/);
});
