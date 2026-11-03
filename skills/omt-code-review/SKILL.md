---
name: omt-code-review
description: Code review with subagents in T3 Code. Use when the user asks to review uncommitted changes, a branch, a commit, or a pull request. Accepts --profile. Sizes the review by the diff: 1 reviewer for a small diff, or 2 to 4 grouped reviewers and 1 oracle over the whole change for a large diff. Reviewers only report; the main thread waits for them in its turn, merges the findings, and makes every approved fix. For a PR, runs target, rules, CI, coverage, round 1, merge and oracle, CI fixes, guardrails, CRAP, report, and owner-approved offers in order.
---

# Code review

You review a change with report-only children and merge their findings. A small diff gets 1 reviewer. A large diff gets 2 to 4 grouped reviewers and 1 oracle over the whole change. The effective profile controls the reviewers, the oracle, and the offers. The T3 rules are in [delegation.md](../omt/references/delegation.md). T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Rules

- You wait for each child inside your turn ([delegation.md](../omt/references/delegation.md#waiting)). For one child, call `delegate_task` with `mode: "wait"`. For parallel children, dispatch each with `mode: "async"`, then call `t3_thread_wait` with `threadId` and `runId` for each, then `task_status` for each.
- You end your turn only for the owner: a question, an offer, or the report.
- Reviewers report only. Every `review` and `oracle` task says `Report every finding with its fix. Change no files, and write none under FIXES.`
- Set `interactionMode` to `"plan"` in the `delegateTask` of each `review` and `oracle` task before you call `delegate_task`. Then the child cannot edit. The defaults make `review` and `oracle` edit roles, because the omt-ulw reviewer fixes local findings. So the role alone does not stop edits.
- The brief of an edit role has no plan-mode line. So each `review` and `oracle` task also says `You run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.`
- You make every fix and write every approved test in the main thread.
- Record every dispatch and every result in the ledger under `review-<slug>`.
- Read only the part of a child's evidence that your next action needs.

## Steps

### 0. Check your mode

Call `t3_thread_configuration` with no `threadId` and read your `interactionMode` and `modelSelection` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). Keep the driver of `modelSelection`, such as `claudeAgent` or `codex`, as `<your family>`. In `plan` mode, dispatch only `review` and `oracle` tasks with `interactionMode: "plan"`, write no ledger entry and no evidence file, and deliver the merged findings in your final message. The fixes in step 6 need default mode.

Accept `omt-code-review --profile <name> <target>` for one run. With `--profile`, run `omt profile show <name> --json`. Otherwise run `omt profile show --json` to use the config's profile. Read `profile`, `workflow.review`, `limits`, `roles`, and `models` from the output. Use the output's `profile` as `<profile>` in every brief and role lookup. Read the profile again after a context reset, with the run's `--profile` override when one exists. The `review-<slug>` id is ledger-only, so do not use `omt profile show --plan review-<slug>`.

In `plan` mode, omit `--save` from every brief command. For a PR step that needs a checkout, a file write, or an edit, ask the owner to switch to default mode and stop.

Done when: you know your mode, your family, and the effective profile.

### 1. Pick the target

| Target | Diff command for reviewers |
| --- | --- |
| Uncommitted changes | `git status --porcelain -- <paths>` and `git diff HEAD -- <paths>`; untracked (`??`) files do not show in the diff, so reviewers read them in full |
| Branch versus base | `git diff <base>...<branch>` |
| One commit | `git show <sha>` |
| Pull request | `gh pr diff <number>`, or fetch the head and diff against its base |

Ask the user only when the target is ambiguous. Pick a slug for the review that matches `^[a-z0-9][a-z0-9-]{0,63}$`, for example the branch name in kebab case.

For a pull request, follow PR steps 1 to 11 below in order instead of continuing at step 2.

Done when: you have one diff command and the list of changed files (`--stat` or `--name-only`).

### 2. Size and split

Leave every file under `docs/design/` out of the groups and the line count: the owner reviews designs, not a model. When the change holds only design files, dispatch no reviewer and no oracle; list the files for the owner's review and stop.

Count the changed lines with `git diff --shortstat` or the PR's stats: the insertions plus the deletions. A diff below 200 changed lines is small. A diff of 200 or more changed lines is large. When `review.reviewers` is `auto`, use this table.

| Changed lines | Size | Reviewers | Oracle |
| --- | --- | --- | --- |
| below 200 | small | 1 over the whole change | none |
| below 1,000 | large | 2 groups | 1 over the whole change |
| below 3,000 | large | 3 groups | 1 over the whole change |
| 3,000 or more | large | 4 groups | 1 over the whole change |

When `review.reviewers` is a number from 1 to 4, it overrides the table. The number 1 gives the small shape. A number from 2 to 4 gives the large shape with that number of groups.

- Small shape: 1 reviewer over the whole change. With `review.oracle: on`, that reviewer uses the `oracle` role, so no second thread runs. With `review.oracle: off`, it uses the `review` role.
- Large shape: 1 `review` child for each group. With `review.oracle: on`, 1 `oracle` child then checks the whole change (step 5). With `review.oracle: off`, no oracle runs.

With `review.families: one`, each reviewer runs on the first available rung of its role. With `review.families: both`, give the groups to the two families in turn: odd groups to Codex, even groups to Claude. In the small shape with `review.families: both`, dispatch 1 `review` child from each family over the whole change, and no oracle. A review never starts more than 4 reviewers and 1 oracle.

Group the files by directory so that each reviewer gets related files, with groups of similar size. Never run more than `limits.maxParallel` children at once, from the effective profile.

Done when: each changed file outside `docs/design/` is in exactly one group, the shape is known, and the design files are listed for the owner.

### 3. Dispatch the reviewers

In default mode, run `omt init` first when `.omt/.gitignore` is missing; the ledger and the evidence file in step 6 live under `.omt/`. Before every task dispatch, run `omt ledger stats --plan review-<slug>`. Use `active` from the output. Use `limits.maxParallel` from `omt profile show <profile> --json`. Dispatch only when `active` is below `limits.maxParallel`. Ignore the `can dispatch` line because it uses the config's profile limits.

Build each group brief with `omt brief review --task-file - --title "review G<k>: <group paths>" --round <n> --attempt 1 --plan review-<slug> --unit G<k> --profile <profile> --save --json`. In the small shape, use `--unit G1` for a `review` child, or `omt brief oracle` with `--unit oracle --title "oracle: <slug>"` for an `oracle` child. The task gives the diff command limited to the group's paths, which never include `docs/design/`, and the intent of the change (PR description, commit messages, or the user's words). Reviewers run the diff themselves; paste a diff only when it is short. The task also holds the two report-only lines from the Rules.

Round 1 reviews a change whose author is unknown. Pass no `--against`, so the configured order applies.

For `review.families: both`, a Codex group uses unit `G<k>.codex` with `--against claudeAgent`, and a Claude group uses unit `G<k>.claude` with `--against codex`. Check each resolved target's family with [roles.md](../omt/references/roles.md#cross-family-roles). If the targets resolve to one family, report the unavailable family and stop instead of counting reviews from one family as both.

A round after fixes (step 6 or PR step 7) dispatches 1 `review` child over all the fixes of that round, not one per group or per fix. Build it with `--unit FIX --round <n> --title "review fixes: <slug> r<n>"`. Pass `--against <your family>` when you made the fixes. Pass `--against auto` when an `execute` child made them under unit `FIX`. Its task gives each finding, its fix, and the diff command limited to the paths that the fixes changed. From round 2, `--prior-file` carries the earlier findings and the responses. Each round is a fresh task.

Build every task with `omt brief <role> ... --profile <profile> --save --json`, including oracle, guardrail, qa, and execute tasks. Set `delegateTask.interactionMode` to `"plan"` for each `review` and `oracle` task. Pass `delegateTask` to `delegate_task` and retain its `taskId`, `childThreadId`, and `childRunId`. Record the dispatch with the returned `ledger.dispatched` command after replacing only `<taskId>`. For a fallback, use the provider and model of the target that you actually sent ([results.md](../omt/references/results.md#recording)). `<a>` is 1 for the first call, or the higher attempt of a retry or a fallback call ([delegation.md](../omt/references/delegation.md#failure-codes)).

Wait for the children in this turn. For one child, dispatch it with `mode: "wait"` and `timeoutMs` up to 3,600,000. For several children, dispatch each with `mode: "async"` and record it. Then call `t3_thread_wait` with `threadId: childThreadId` and `runId: childRunId` for each, then `task_status` for each. On `waitTimedOut: true`, wait again or read `task_status`. When a limit holds back a group, dispatch it after a running child finishes, in the same turn.

Give every edit child an explicit file scope. Let no child commit or push. Keep child changes uncommitted for the main thread. Write no new tests, except the owner-approved tests of PR step 11.

Done when: every group, or the fix review of the round, has a verdict that is recorded in the ledger.

### 4. Merge

Read each verdict with `task_status` and record it ([results.md](../omt/references/results.md#recording)). Then settle the child ([delegation.md](../omt/references/delegation.md#releasing-children)). When every reviewer of the round has a verdict, merge the findings. Drop duplicates with the same location and failure, and keep the higher severity. For each non-CRAP finding, keep its failure scenario. For each CRAP finding, keep the changed function and its complexity, coverage, and CRAP values. Keep a missing-test finding only when the plan or task names that test. In a PR review, list other uncovered flows in the report instead.

Done when: one merged list exists, sorted by severity.

### 5. Oracle pass

With `review.oracle: off`, skip this step. In the small shape, skip this step, because the one reviewer already is the oracle when `review.oracle` is `on`. In the large shape with `review.oracle: on`, run the following pass.

Run `omt ledger stats --plan review-<slug>`, then dispatch one `oracle` task (`--plan review-<slug> --unit oracle --round <n> --attempt 1 --against <provider> --title "oracle: <slug>"`) with the merged findings and the full diff command with `docs/design/` excluded (for example `git diff HEAD -- . ':(exclude)docs/design'`). `<provider>` is the provider that most review tasks of this round ran on, so the oracle checks the reviewers from the other family. On a tie, use `<your family>`. Dispatch it with `mode: "wait"` and `interactionMode: "plan"`. Record its dispatch with `--provider` and `--model`, and record its verdict. Ask it to confirm or refute each finding, and to report confirmed misses. Remove what it refutes with evidence; add what it confirms.

Done when: the oracle verdict is read and the merged list is updated, or this step is skipped.

### 6. Write and report

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Write the merged findings to `review-<slug>-r<n>.md` in the evidence directory that `omt paths --evidence` prints, in the format of [results/review.md](../omt/references/results/review.md), with an overall verdict. Show the user the verdict, the findings by severity, and the file path. When the change holds design files, list them for the owner's review.

With `review.fixLoop: off`, report without a fix offer. With `review.fixLoop: offer`, ask the owner before each fix loop and wait for yes. After yes, number the P0 to P2 findings `F1`, `F2`, and so on. Fix each one yourself in the main thread, and run the checks that cover it. Then run the fix review of step 3 with round `<n+1>`. Fix what it reports, and run the next fix review. Stop at `maxReviewRounds`. Then report again with this step.

Done when: the evidence file exists and the user has the verdict and the offer.

## PR review

Run these eleven steps for a pull request with any profile. `omt-code-review <number>` uses the `normal` profile, which enables all PR steps. The `prototype` profile turns the PR steps off. Steps 1, 2, 6, and 10 always run. Step 11 applies its named switches. For a switch set to `off`, mark its step skipped and continue in order. Use the mode, dispatch, wait, ledger, limit, report-only, and design-exclusion rules above throughout this path. Post no comment and no review to GitHub.

### PR 1. Target

Run `gh pr view <n> --json number,title,body,url,baseRefName,headRefName,files,additions,deletions` for the intent and file list. When `link_pull_request` exists, call it with the PR URL immediately. Save the current branch name with `git branch --show-current`. If the branch name is empty, save the detached HEAD commit with `git rev-parse HEAD`. A PR-head step needs a clean checkout when `review.ci` is `fix`, `review.verify` is `changed-flows`, `review.tests` is `offer`, or `review.crap` is `report`. Run `git status --porcelain` before such a step. If the output is nonempty, stop and ask the owner how to handle the changes. If the output is empty, run `gh pr checkout <n>` and record the PR branch name. When no step needs a checkout, keep the current branch. Keep the original branch or detached HEAD commit for the report's return command. Use step 2 above to size and group the change with `review.reviewers` and `review.families`.

Run `gh pr view <n> --json baseRefOid,headRefOid` once, with or without a PR checkout. Save `baseRefOid` and `headRefOid` for all PR review rounds. Run `git fetch origin <baseRefName> pull/<n>/head` once.

Apply these rules only to round-1 review tasks and the round-1 oracle task of the PR. Replace the default diff command with `git diff <baseRefOid>...<headRefOid> -- <paths> ':(exclude)docs/design'`. Give each round-1 review task only its group's paths. Give the oracle `.` as `<paths>`. Use `git show <headRefOid>:<path>` to read whole files. When the PR is not checked out, tell these tasks not to run tests or builds on the working tree because it does not hold the PR.

For reviews of uncommitted CI fixes, fix-loop changes, and approved test changes, use `git diff HEAD -- <fix paths>`.

For the oracle task of a round after a fix loop, give `git status --porcelain -- <the round's fix paths>` and `git diff HEAD -- <the round's fix paths> ':(exclude)docs/design'`. Tell it to read whole files from the working tree.

Done when: the PR is linked when supported, and the target, groups, and required checkout are ready.

### PR 2. Rules

List `AGENTS.md` and `CLAUDE.md` in the root and each directory above a changed file. Add `CONTRIBUTING.md` and the docs that these rule files link to. Add relevant project skills from `.claude/skills/*/SKILL.md` and `.agents/skills/*/SKILL.md` by their descriptions. Add the lint, format, type-check, and CI config files. Give every review task this list. Require each finding that breaks a written rule to cite its rule file and line. This step always runs.

Done when: the rule-file list and project commands are ready for the briefs.

### PR 3. CI

With `review.ci: off`, skip CI. Otherwise run `gh pr checks <n> --json name,state,bucket,link,workflow`. Run this command again before PR step 7, before PR step 10, and on each PR-event wake. Treat the current checks as CI state. Keep no separate CI-state record. For each failing GitHub Actions check, get the job id from its link. Save the last 400 lines of `gh run view --job <job-id> --log-failed` to `<evidence>/ci-<slug>-<check>.log`. For a failing check outside GitHub Actions, save its link instead. Resolve `<evidence>` with `omt paths --evidence` and use a safe filename for `<check>`.

With `review.ci: check` and no checks, report `no CI checks`. With `review.ci: fix` and no checks, run the project's check command from its rules or package scripts as `omt lock run check -- <command>`. Treat a failure of that command as a failing check. Run the check and coverage commands one at a time. With neither `flock` nor `lockf` on `PATH`, `omt lock run` warns and runs the command without a lock.

Do not end the turn to wait for a pending check. Continue with the next step. When checks are still pending at PR step 10, call `watch_pull_request` as the last action of the report turn. When no check is pending and you end a turn to wait for the owner, call `unwatch_pull_request` first. Call `unwatch_pull_request` when no check is pending and the review ends, or when the owner stops the review. If the watch tool is unavailable, report pending checks and the missing tool.

Done when: each check has a current state and each failure has a log or link.

### PR 4. Coverage

With `review.crap: off`, skip coverage. With `review.crap: report`, find a `coverage` or `test:coverage` script, or a CI step that writes coverage. When one exists, run it once as `omt lock run coverage -- <command>` with lcov output to `<evidence>/coverage-<slug>.lcov`. Use that command's supported output option or copy its lcov file to this path after the run. When no coverage command exists, give reviewers no coverage file. Finish any check command before starting coverage, also on a system without a lock tool.

Done when: reviewers have the measured coverage path or know that coverage data is absent.

### PR 5. Round 1

Dispatch the report-only review groups on the PR head with the rule-file list and coverage path, using step 3 above. Apply the PR step 1 diff and file-read rules to every review task. With `review.crap: report`, ask each reviewer to compute the values in PR step 9 for every added or changed function in its group. With `review.verify: changed-flows`, dispatch one `qa` task when the PR changes a screen, a CLI command, or an API route. Name the changed flows from the PR body and diff, and the build and run commands from the rules. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `qa` task. Require the qa result to name each flow's covering test file, or `none`. The `qa` task writes no tests and changes no files. Only `qa` drives a device, a Simulator UI, a browser, or a computer. With `review.verify: off`, skip this task. When qa returns `INCONCLUSIVE` because it cannot reach a local tool, send the same task once to the next rung of another provider.

No child of this step edits, so dispatch the reviewers and the `qa` task together with `mode: "async"`. Record each dispatch. Then wait for each with `t3_thread_wait` and `runId`, and read each result with `task_status`, in this turn.

Done when: every group and any required qa task has a verdict that is recorded in the ledger.

### PR 6. Merge and oracle

Merge the findings with step 4 above. Turn each flow that qa returns as `NOT VERIFIED` into a P1 finding with its evidence. Apply step 5 above only when `review.oracle` is `on`. Apply the PR step 1 diff and file-read rules to the oracle task. Keep every confirmed rule citation and CRAP value in the merged list.

Done when: the merged list includes verify failures and the enabled oracle's verdict.

### PR 7. CI fixes

With `review.ci: check`, report failures without a CI fix. With `review.ci: off`, skip this step. With `review.ci: fix`, wait for every round-1 review and qa verdict before you fix. Refresh CI with PR step 3. Fix each failing check yourself in the main thread. Reproduce it with the matching local command and its log or external-check link, fix the failure, and run the command again. When a failure cannot be reproduced because of secrets or outside services, record it as blocked with the reason. Then run one fix review over all the CI fixes of the round, as in step 3 above. Keep each fix's changed paths for the report and the commit. Apply `maxReviewRounds` to repeated CI fixes.

Done when: every failing check has a reviewed fix or a reported blocker.

### PR 8. Guardrails

With `review.guardrails: off`, skip this step. With `review.guardrails: propose`, dispatch one read-only `guardrail` task after the enabled oracle pass and the CI fix review, with `mode: "wait"`. Give it the merged findings, CI failures, rule-file list, CRAP results, and `.omt/guardrails.md` when that file exists. Require the [guardrail result block](../omt/references/results/guardrail.md). Ask for the first applicable class per finding: `check`, then `rule-fix`, then `new-rule`. A `check` proposal names the tool, config change, and proof command that fails on the PR head and passes after the change. A `rule-fix` proposal cites an unclear or conflicting written rule and its correction. A `new-rule` proposal states the rule and destination file when no written rule covers the case. For a finding that only judgment can catch, require a note with the reason and no proposal. Skip proposals already in `.omt/guardrails.md`.

Before the append, run `omt init` if `.omt/.gitignore` lacks `guardrails.md`. Append each new proposal to `.omt/guardrails.md` as `- [ ] G<k> <date> PR #<n> <class>: <proposal>. Where: <file>. Proof: <command or none>.`. Set `<k>` one above the highest id in the file for each new proposal. Leave implementation of the proposals to owner-approved omt-ulw work on a separate branch.

Done when: each finding has a new proposal or a reason for none, and the main thread has saved the new proposals.

### PR 9. CRAP

With `review.crap: off`, skip this step. With `review.crap: report`, collect the reviewer calculations requested in PR step 5. For each added or changed function, use `CRAP = complexity² × (1 − coverage)³ + complexity`. Count McCabe complexity as 1, plus 1 for each `if`, `else if`, loop, `case`, `catch`, `&&`, `||`, `??`, and `?:`. Coverage is the share of the function's lines that the lcov file marks as hit. Without a coverage file, use coverage 0 and say `no coverage data`. Report each changed function with CRAP above 30 as P2, with its complexity, coverage, and CRAP values. Include CRAP findings in the merge and oracle input before the guardrail task. When complexity lint or a coverage gate is missing and `review.guardrails` is `propose`, require a `check` proposal in PR step 8. With `review.guardrails: off`, list each missing complexity lint rule or coverage gate as a note in the report.

Done when: every added or changed function has its calculation and every CRAP finding has its three values.

### PR 10. Report

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Write `review-<slug>-r<n>.md` in the directory that `omt paths --evidence` prints, using the review result format from step 6 above. Include the verdict and findings by severity, with each applicable rule file and line. Include the CI state and each CI fix with its changed paths. Include verify results with screenshots and the CRAP findings. List each verified flow that no test covers and the guardrail proposals. Show the branch or detached HEAD commit left in the checkout. For an original branch, give `git switch <branch>` as the return command. For an original detached HEAD, give `git switch --detach <commit>` as the return command. List design files for the owner's review. This step always runs.

If checks remain pending, list them in the report and call `watch_pull_request` as the last action. On a PR-event wake, refresh CI with PR step 3, run PR step 7 for new failures, then update the report through PR steps 8 to 10.

Done when: the report exists and the owner has the verdict, evidence, pending checks, and branch-return command.

### PR 11. Offers

After the owner approves a fix loop or a set of tests, check whether PR step 1 checked out the PR. If it did not, run the PR step 1 checkout procedure before any edit. After a late checkout, tell the owner the PR branch now in the checkout. Give `git switch <branch>` for an original branch or `git switch --detach <commit>` for an original detached HEAD.

With `review.fixLoop: offer`, ask before each fix loop as in step 6 above. With `review.fixLoop: off`, make no fix-loop offer.

With `review.tests: offer`, list one e2e test per verified flow that no test covers, with its flow and file path. When the project has no e2e test framework, offer no test and say so in the report. Ask the owner and wait for yes on the exact test lines. The `qa` role edits nothing and writes no tests, so a `qa` child never writes them. After yes, write only the approved tests yourself in the main thread. Then dispatch one `qa` child with `mode: "wait"` to run the new tests and return each exit code with its log. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `qa` task. With `review.tests: off`, offer no tests. Leave the test changes uncommitted, and include them in one fix review (step 3) before the commit. Send product failures from qa to an owner-approved fix loop.

Before finishing, call `list_thread_pull_requests` when available. Link this PR if it is missing from the list. Report a failed linking call as a failure.

Commit and push by the [Git actions](../omt/references/delegation.md#git-actions) rules, with `--profile <profile>`. Pass `--pr-author <login>` with the PR author from `gh pr view <n> --repo <host>/<owner>/<repo> --json author -q .author.login`, with the `host`, `owner`, and `repo` fields of the check, so that a PR by another author asks before each commit and push. Also apply the Git actions rule that lists every open PR from the PR's head branch, so that another open PR from that branch by another author asks too. Make one commit per fix and per approved test set using only its changed paths. Combine changes to the same file into one commit. Push to the PR branch. After the push, call `watch_pull_request` only when `review.ci` is not `off` and PR step 3 found checks. End the turn immediately after `watch_pull_request`. Otherwise, call `unwatch_pull_request` and end the review. With `review.ci: fix`, if a check fails again, use the next CI fix round up to `maxReviewRounds`.

When no check is pending and you end a turn to wait for the owner, call `unwatch_pull_request` first. Apply the PR step 3 watch rule before handing back the work, and run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)). Post nothing to GitHub except a push that the [Git actions](../omt/references/delegation.md#git-actions) rules allow.

Done when: each offer has an owner decision or awaits one, and the PR is unwatched when the review ends.
