---
name: omt-ulw
description: ulw / ultrawork in T3 Code. Use when the user says ulw or ultrawork, or asks to build, fix, or ship something with subagents in a T3 thread. The main thread explores, asks question batches, plans, and builds the change itself, then one review child and one QA child check the work before it reports done with evidence.
---

# Ultrawork

Print this banner as your first line, then start step 0:

`omt ultrawork: explore, ask, plan, build, review, test.`

## Contract

The user typed ulw to get the build flow. Run the full flow for every task, however small. A small task gets a LIGHT run, not a shortcut.

- You build. You explore, plan, edit the code, write the planned tests, and fix. Children review and test.
- Every run has one review child (step 8) and one QA child (step 10), as `build.review` and `build.oracle` allow. A LIGHT run skips the plan review and the owner approval of the plan. It still has the review child and the QA child.
- Done means a check that can fail ran and passed. A child's claim is not done ([results.md](../omt/references/results.md)).
- Record every child dispatch and every result in the ledger.

The shared T3 rules are in [delegation.md](../omt/references/delegation.md). Read it before your first dispatch. T3 tools appear here by base name, and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Rules

- You wait for each child inside your turn ([delegation.md](../omt/references/delegation.md#waiting)). For one child, call `delegate_task` with `mode: "wait"`. For parallel children, dispatch each with `mode: "async"`, then call `t3_thread_wait` with `threadId` and `runId` for each.
- You end your turn only for the owner: a batch of questions, a plan approval, or the report.
- One brief per child. Each brief stands alone ([brief.md](../omt/references/brief.md)).
- Read only the part of a child's evidence that your next action needs: the exit codes and the last lines of a QA log, or the hunks of a reviewer's fix diff.
- On a T3 failure code, follow the table in [delegation.md](../omt/references/delegation.md#failure-codes).
- Tick plan items only with `omt plan mark <slug> <id> <done|open|blocked>`.
- After a context reset, read the plan (`omt plan status <slug>`), the ledger (`omt ledger list --plan <slug>`), and the profile (step 2) before you act.
- Ask each owner question once. Later status messages do not repeat open questions.

## Steps

### 0. Check your mode

Call `t3_thread_configure` with no arguments and read your `interactionMode` and `modelSelection` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). Keep the driver of `modelSelection` as your family for step 8. Ultrawork edits files, so in `plan` mode ask the user to switch this thread to default mode, or offer `omt-plan` to deliver a plan in your final message.

Then run the [branch check](../omt/references/delegation.md#branch-check).

On the first run in a project, or when `omt init` printed a `WARN` worktree setup line, follow [worktrees.md](../omt/references/worktrees.md). Generate or activate a setup only with the owner's yes.

Done when: you run in `default` mode, or the user has the question.

### 1. Question or goal

When the message asks a question and names no change, run the `omt-research` skill instead and stop here.

Done when: the message is a goal, or `omt-research` has the question.

### 2. Explore

Pick the plan slug before the first brief. It matches `^[a-z0-9][a-z0-9-]{0,63}$`. Keep this slug for the whole run.

Read the profile. When the plan file exists, run `omt profile show --plan <slug> --json`. Before the plan exists, run `omt profile show --json`, or `omt profile show <name> --json` for `ulw --profile <name>`. Keep the effective `profile`, `workflow`, `limits`, `roles`, and `models`. Run `omt roles --plan <slug>` for the targets. Before the plan file exists, pass the run's `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command. [The CLI](../omt/references/delegation.md#the-cli) says where to find the CLI. Without it, resolve the profile from config and use [roles.md](../omt/references/roles.md#commands).

Before each explore dispatch, run `omt ledger stats --plan <slug>`. When the plan file exists, use `can dispatch`. Otherwise compare `active` with the selected profile's `limits.maxParallel`.

Read the code that the goal touches yourself. Send only broad reads to 1 to `maxParallel` read-only `explore` children, one narrow question each, in parallel. Use `--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"`. Dispatch them with `mode: "async"`, record each dispatch, and wait for them in this turn.

Done when: you can name the files and functions that the change touches, each with a `path:line` citation.

### 3. Frame

Write down the objective in one sentence, the done conditions, the tier, and the plan slug.

- Each done condition is a check that can fail: a command, a test, or an observable result.
- Tier LIGHT: one or two units, one area of code, no design decision left. Tier HEAVY: anything else.
- The slug matches `^[a-z0-9][a-z0-9-]{0,63}$`, for example `http-retry`. Explore briefs and `omt ledger stats` need it before the plan file exists.

Use the slug and profile selected in step 2.

When the owner switches the plan's profile with `omt plan profile <slug> <name>`, read the profile again and use the new values for the remaining steps.

Done when: the objective, at least one failable done condition, the tier, and the slug are written in your reply, and you know a target for the `review` and `qa` roles, or you report the role that is `unavailable` and why.

### 4. Ask

Ask every open owner question in one batch. Give each question 2 to 4 options and your recommendation. A question that the code can answer is not an owner question: read the code instead. End the turn and wait for the answers.

After the answers, explore again when an answer opens new code, and ask the next batch. Stop when no question is open.

Done when: no owner question is open.

### 5. Plan

When `.omt/.gitignore` is missing, run `omt init` first.

- LIGHT: run `omt plan new <slug> --light` and fill it yourself, `## Summary` last by the rule in [planning.md](../omt/references/planning.md). The LIGHT plan needs no owner approval.
- HEAVY: run the `omt-plan` skill with the slug before any plan file exists. It writes the plan, runs the plan review, and returns here. The owner approves the HEAVY plan before you build.

For a run with `--profile <name>`, pass it to plan creation or to `omt-plan`. After plan creation, run `omt profile show --plan <slug> --json`. When you build a `plan-review` brief, name the effective `plan.testLayers` value in the task text. Give every plan a `## Tests` section. Use integration tests by default: real code through the interface that production uses, with only external services faked. Use e2e only for a core user journey, or for a failure that needs the client, server, and backend together, and unit only for pure logic with real branching ([planning.md](../omt/references/planning.md)). Write each approved test as `- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.` The reason names the bug or regression that the test catches. With `build.qa: planned`, keep only the owner's approved test lines. With `build.qa: off`, leave `## Tests` empty.

Each unit has a role, a scope, a done condition, a verify command, and its dependencies. The role of a unit that you build is `main`. A unit that reads outside data, such as recordings, files, or API responses, has a done condition on an input shaped like real data, also in a LIGHT plan. Every done condition from step 3 maps to a unit or a final check.

A unit that implements a design or changes UI has the role `ui`, also in a LIGHT plan. When an approved design spec exists, cite it in the unit's task and scope. Without one, use the task requirements and [UI implementation](../omt/references/roles.md#main-thread-or-child). Plan an `omt-design` step only when the user requests a design pass first.

Keep an `F2` oracle item only when `build.oracle` requires the oracle for the run's tier: `heavy` for HEAVY only, `always` for both tiers, `off` for neither. After plan creation and after a profile switch, edit the plan file's `## Final verification` list, also in a LIGHT plan. When an `F2` oracle item is required but missing, add `- [ ] F2. The oracle role approves the whole change.`. When no oracle is required, remove the `F2` oracle line.

Done when: `omt plan status <slug>` shows every unit, and (HEAVY) the owner approved the plan.

### 6. Design check

When the plan includes a requested design pass that has not run, run the `omt-design` skill with the plan slug first. Wait for the owner's approval of that spec before you build the affected UI units. Without a requested design pass, build the UI directly from the task requirements. Every path into step 7 runs this check, also the hand-off from `omt-plan`.

Done when: each UI unit has an approved design spec or the task requirements for direct implementation, or the plan has no UI unit.

### 7. Build

Before your first edit, save the output of `git status --porcelain` under `Log` in the plan ([Git actions](../omt/references/delegation.md#git-actions)).

Build the units in the order of the `ready:` line of `omt plan status <slug>`. For each unit:

1. Edit the files in its scope.
2. Run the unit's verify command. Save the output in the directory that `omt paths --evidence` prints. Fix and run it again until it passes.
3. With `build.qa: planned`, write the unit's tests from `## Tests`. Map each new test file or case to one `## Tests` line. Write no test that has no line.
4. With `build.failureProofs: on`, prove that each new test fails without the change, in a private copy of the working tree. Create the copy with `copy=$(mktemp -d "${TMPDIR:-/tmp}/omt-proof.XXXXXX") && git ls-files -co --exclude-standard -z | tar --null -T - -cf - | tar -x -C "$copy"`. Link its dependencies, for example `ln -s "$PWD/node_modules" "$copy/node_modules"`. In the copy, break the behavior that the test asserts in the code under test, run only that test, and see it fail. Delete the copy on every exit path, for example with `trap 'rm -rf "$copy"' EXIT`. Never break or restore files in the shared checkout. With `build.failureProofs: off`, skip the proofs.
5. Run `omt plan mark <slug> <unit> done`.

A `ui` unit follows its approved design spec when one exists. Otherwise follow [UI implementation](../omt/references/roles.md#main-thread-or-child), with `frontend-design` when available. When your `modelSelection` is a Claude Opus model, build it yourself. Otherwise send it to a `ui` child as an independent track (below). Try the configured `ui` fallbacks when T3 refuses a target. When every configured `ui` target fails, stop and tell the user. Do not switch to `execute`.

Independent track: a large unit with a scope that no other open unit touches may go to an `execute` child, to a `ui` child for a `ui` unit, or to a `writing` child for a `writing` unit. Build its brief with `omt brief <role> --task-file - --title "<role> <unit>: <short unit title>" --scope ... --done ... --verify ... --plan <slug> --unit <id> --round 1 --attempt 1 --save --json`. Dispatch only while `omt ledger stats --plan <slug>` reports `can dispatch: yes`. Dispatch it with `mode: "async"`, run its printed `ledger.dispatched` line, and build the other units while it runs. Then wait for it ([delegation.md](../omt/references/delegation.md#waiting)), record the result, and settle the child ([delegation.md](../omt/references/delegation.md#releasing-children)). Check its `DONE` claim as [results.md](../omt/references/results.md#a-claim-is-not-evidence) says, and run its verify command yourself. Then write its planned tests and make its failure proofs with items 3 and 4 above. Run those planned tests and the verify command again. Both must pass before you mark the unit done.

Run each shared build or test command as [delegation.md](../omt/references/delegation.md#shared-builds) says.

Done when: every unit is marked done and its verify command passed in your own run.

### 8. Review

Apply `build.review` and `build.oracle`:

- When `build.oracle` requires the oracle for the run's tier, the review child uses the `oracle` role, also when `build.review` is `off`. Use `--unit F2`.
- Otherwise the review child uses the `review` role. Use `--unit REVIEW`.
- With `build.review: off` and no required oracle, skip this step and step 9.

Write the context to a temp file such as `$TMPDIR/omt-<slug>-review-r<n>.md` and pass it with `--context-file`: the objective, the done conditions, the plan `## Summary`, and the scope paths. Do not send your conversation or your history. Leave `docs/design/` out of the scope paths: the owner reviews designs, not a model. For a `ui` unit, also apply the [design exclusion](#10-qa) to the done conditions and the context. Code review of `ui` units stays.

The task tells the reviewer to run `git status --porcelain -- <scope paths>` and `git diff HEAD -- <scope paths>` and to read every untracked file in full. It also tells the reviewer to fix each local finding itself: a clear fix inside the changed files that agrees with the plan Summary. It reports each other finding, such as a finding that changes the approach or the plan. It lists each fix with its paths under `FIXES`. When `omt roles` shows the role as `read-only`, the reviewer cannot edit: it reports every finding with its fix, and you fix them all in step 9.

Before you dispatch the review, stage your work with `git add -A -- <scope paths>`. The reviewer's fixes then stay unstaged, so step 9 can read them apart from your work.

Build the brief with `omt brief <review|oracle> --task-file - --context-file <file> --scope <path> ... --title "<role>: <slug>" --plan <slug> --unit <REVIEW|F2> --round <n> --attempt 1 --against <your family> --save --json`. `<your family>` is the driver from step 0, such as `claudeAgent` or `codex`, so that the reviewer runs on the other family. From round 2, pass every prior finding with its response in `--prior-file`. Dispatch it with `mode: "wait"` and record the dispatch and the result.

Before each dispatch or fallback, check the target's family with [roles.md](../omt/references/roles.md#cross-family-roles). When it is your family, stop and report that no reviewer from the other family can run. The CLI can return a same-family fallback even with `--against`.

Review and QA never run at the same time, because the reviewer edits files.

Done when: the review child returned a result block and it is recorded in the ledger, or this step is skipped.

### 9. Read the fix diff and fix

Read the reviewer's fix diff before QA starts: run `git diff -- <scope paths>` (the unstaged changes, which are only the reviewer's) and `git status --porcelain -- <scope paths>` for new untracked files, and read only those hunks and files. Then stage them with `git add -A -- <scope paths>`. Undo a fix that you disprove, and say why in the next round's `--prior-file`.

Relevance check: check each reported finding against the plan. Keep a finding when it breaks a done condition, a plan requirement, or the correctness of the changed code for inputs the plan covers. Drop the others: a style preference, an input or a state that the plan rules out, or a case that cannot happen in the planned flow. Drop a missing-test finding unless the plan or the task names that test. Keep a CRAP finding when the profile asks for CRAP, with complexity, coverage, and CRAP values instead of a failure scenario. Keep a missing check on an input shaped like real data for code that reads outside data, also when a seeded sample already passes. Never drop a finding because its case is rare or unlikely. A race or an order of events that the planned flow allows breaks correctness. Record each dropped finding with its reason under `Log` in the plan and in the next `--prior-file`.

Fix each kept finding yourself, and run the verify commands of the units that the fix touches.

- `BLOCK` for a wrong approach, or a finding whose fix changes the plan: run `omt plan mark <slug> <unit> blocked`, then re-plan the unit (step 5) or ask the owner.
- With `build.review: every-round`, run one more review (step 8) with the next `--round` to check your fixes, until the review returns `APPROVE` or the run reaches `maxReviewRounds` reviews. With `first-round`, run no second review.
- When findings stay open after the last review, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)) and ask the owner.
- With the oracle, mark `F2` done when it returns `APPROVE`, or when you drop every finding of the last oracle round. The report lists the dropped oracle findings.

Done when: every kept finding is fixed or is with the owner, and you read every fix diff of the reviewer.

### 10. QA

Dispatch one `qa` child. Give it every verify command of the plan, the final checks (`F` items with a command), and the device flows, each with its steps and expected result. Name the scope paths as the code under test. The QA child edits nothing and writes no tests. It returns each command with its exit code and a log path, and screenshot paths for device flows.

Design exclusion: for a `ui` unit, leave `docs/design/` out of the QA scope paths, and leave out every done condition and every piece of context that compares the result with the design, such as screens, screenshots, or a visual match. QA checks behavior, not looks: build, unit tests, and `agent-device` flows that check behavior. The owner compares the looks with the design. Review and oracle briefs (step 8) apply the same exclusion.

Build the brief with `omt brief qa --task-file - --scope <path> ... --verify <command> ... --title "qa: <slug>" --plan <slug> --unit QA --round <n> --attempt 1 --save --json`. Dispatch it with `mode: "wait"` and record the dispatch and the result. Route device checks and local-tool retries as [delegation.md](../omt/references/delegation.md#verification-and-devices) says.

Read only the exit code of each `CHECKS` line and the last lines of each failed log, for example with `tail -n 30 <log>`. Mark each `D` and `F` item with `omt plan mark <slug> <id> done` after its command passed in the QA run.

Done when: the QA result is recorded and every check passed, or step 11 has the failures.

### 11. Fix failed checks

For each failed check, find the cause in the last lines of its log, fix it yourself, and run the check yourself. Then dispatch QA again for only the failed checks, with the next `--round`. After a check passes, mark its `D` and `F` items done as in step 10. A busy lock or a failure in a file outside the run's scope follows [delegation.md](../omt/references/delegation.md#shared-builds).

Run at most 2 QA re-runs. When a check still fails after the second re-run, stop: run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)) and ask the owner, with each failed command, its exit code, and its log path.

Done when: every check passed in a QA run, or the owner has the failures.

### 12. Ship and report

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

After every check passed, make one commit for the run, then push and open or update the PR, each by the [Git actions](../omt/references/delegation.md#git-actions) rules. When you create a pull request, follow [delegation.md](../omt/references/delegation.md#pull-requests).

Tell the user:

- What changed, by file or area.
- Each done condition with its evidence: the command, its exit code, and its log path from the QA run.
- The review verdict, the reviewer's fixes, the findings that you fixed, and the findings that you dropped, with the reason.
- The QA verdict and each re-run.
- What the user can see: each screenshot from the QA result as a Markdown image with its absolute path, grouped by screen, such as `![library, empty state](/abs/path/library-empty.png)`. When no device flow ran, say so.
- The commit hash and the PR URL.
- Open items: blocked units, open findings, and decisions left.

Done when: every done condition from step 3 appears in the report with evidence or as an open item.
