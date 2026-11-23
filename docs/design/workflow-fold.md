# Workflow fold: the main thread builds, children check

Status: approved by the owner on 2026-10-28. This file is the design for the workflow redesign. `docs/spec.md` stays the contract: each stage updates the spec sections that it changes.

## Why

In the largest ulw runs, one task started 67 to 90 child threads. Each unit cost at least 4 children (execute, review, verify, qa), and each fix round cost 2 more. The conductor ended its turn after each dispatch, so a heartbeat tick had to wake it, and omt-loop existed only to keep runs moving.

The Anthropic article "Building agents: when to fold subagents into your main agent loop" (claude.com/resources/articles, 2026-10-22) gives the rule that this design follows. Keep a subagent only for:

- black-box verification,
- independent parallel work that needs a fresh context,
- a context that a single loop cannot hold.

Split work by context, not by problem type. Give each child self-contained work, and have it return a short result. The main agent checks a child's conclusions against real data.

## Rules for every flow

1. **The main thread does the work in one context.** It explores, plans, builds, and fixes. Children exist only for the cases in "Why".
2. **The main thread waits inside its turn.** For one child, call `delegate_task` with `mode: "wait"` and `timeoutMs` up to 3,600,000. For parallel children, dispatch each with `mode: "async"`, then call `t3_thread_wait` with `threadId` and `runId` for each, then `task_status`. On `waitTimedOut: true`, wait again or read `task_status`. No flow uses a heartbeat (`schedule_task` stall checks) or omt-loop.
3. **A turn ends only for the owner:** a batch of questions, a plan approval, or the report.
4. **Explore before asking.** Read the code first. Send only broad reads to `explore` children.
5. **Questions come in batches.** Ask every open question at once. Give each question 2 to 4 options and a recommendation. After the answers, explore again if needed, and ask the next batch. Stop when no question is open. A question that the code can answer is not an owner question.
6. **Check the evidence, not the summary.** Read only the part of a child's evidence that supports your next action: the exit codes and the last lines of a QA log, or the hunks of a reviewer's fix diff.
7. **The ledger stays.** Record every child dispatch and result with `omt ledger add`, so `--against auto` and request ids keep working.

## Build: omt-ulw

The skill keeps the name `omt-ulw`, and the hook keeps the trigger words `ulw` and `ultrawork`. The behavior changes:

| Step | What happens |
| --- | --- |
| 0 | Check the interaction mode and the branch, as today. |
| 1 | If the message is a question, not a goal, run `omt-research` instead. |
| 2 | Explore inline. Send broad reads to 1 to `maxParallel` `explore` children, in parallel. |
| 3 | Frame: the objective, failable done conditions, the tier (LIGHT or HEAVY), and the slug. |
| 4 | Ask question batches (rule 5) until no question is open. |
| 5 | Plan. LIGHT: `omt plan new <slug> --light`, filled by the main thread. HEAVY: run `omt-plan` with the slug; it writes the plan and runs the plan review, then returns. The owner approves a HEAVY plan. |
| 6 | Design check: when the plan needs `omt-design` and it has not run, run it first. |
| 7 | Build unit by unit in the main thread: edit, run the unit's verify command, write the planned tests from `## Tests`. A large unit with a disjoint scope may go to an `execute` child (or `ui` for a design unit) as an independent track. |
| 8 | Review: 1 child for the whole diff (rule below). |
| 9 | Read the reviewer's fix diff. Fix the reported findings. |
| 10 | QA: 1 child runs every verify command, the final checks, and the device flows. It edits nothing. |
| 11 | When a check fails, the main thread fixes it, and QA runs only the failed checks again. At most 2 re-runs; then stop and ask the owner. |
| 12 | Commit, push, and open or update the PR by the user's git rules. Report each done condition with its evidence. |

The contract changes from "you edit no product files" to "you build; children review and test". A LIGHT run skips the plan review and the owner approval, but it still has one review child and one QA child.

### The review child

- **Target.** The `review` role, on the model family other than the main thread's. With `build.oracle` required for the run's tier, use the `oracle` role instead, so no extra thread runs.
- **Context.** The reviewer gets the goal, the done conditions, the plan `## Summary`, and the scope paths. It does not get the main thread's history.
- **Fixes.** The reviewer fixes a local finding itself: a clear fix inside the changed files that agrees with the plan Summary. It only reports a finding that changes the approach or the plan.
- **Result.** It returns the list of fixes, with paths, and the reported findings.
- **The main thread's check.** The main thread reads the reviewer's fix diff before QA starts. Review and QA never run at the same time, because the reviewer edits files.
- **`build.review`.**
  - `first-round`: one review.
  - `every-round`: after the main thread fixes the reported findings, one more review checks those fixes, up to `maxReviewRounds` reviews.
  - `off`: no review child.

### The QA child

- **Target.** The `qa` role. It takes over the device work of the retired `verify` role, so its default chain puts Claude candidates first: a Codex child cannot reach the local device daemon.
- **Rules.** QA edits nothing and writes no tests. It runs the plan's verify commands, the final checks (`F` items), and the device flows. It returns each command with its exit code and a log path, and screenshot paths for device flows.
- **Design exclusion.** QA checks behavior, not looks, for a `ui` unit. The owner compares the looks with the design.
- **`build.qa`.**
  - `planned`: the main thread writes the plan's `## Tests` lines during the build.
  - `off`: `## Tests` stays empty.
- **`build.failureProofs: on`.** The main thread proves each new test fails without the change, in a private copy.

## Plan: omt-plan

Plan only, also when omt-ulw calls it.

- Explore inline. Send broad reads to `explore` children.
- Ask question batches (rule 5) until no question is open.
- Write the plan file, with `## Summary` last.
- **Plan review.** 1 `plan-review` child on the other family, with a frozen blocker list. The main thread fixes blockers itself. One re-review checks those blockers: at most 2 review rounds.
- **Hand-off.** Show the Summary in the reply. Called by omt-ulw, return to it. Called alone, stop.
- **`plan.review`.**
  - `two-families` keeps its name, but now means 1 reviewer on the other family.
  - `one` means 1 reviewer on any family.
  - `owner` means the owner reviews, with no child.

## Grill: omt-grill

Like plan without the plan file. The goal is to confront the owner's idea with facts.

- **Facts first.** Explore the code inline. Send broad reads, docs, or web questions to `explore` or `research` children.
- **Second opinion.** 1 `grill` child on the other family, once per grill. Today a grill runs a 2-thread panel per round.
- **The loop.**
  1. Merge the findings, and ask the next batch of questions.
  2. After the answers, check each answer against the facts, with `explore` or `research` children for broad checks.
  3. Repeat until no question is open.
- **End.** A grill summary: no plan, no code. Offer `omt-plan`.

## Research: omt-research

- **A narrow question.** Answer it in the main thread, and cite `path:line` or a URL.
- **A broad question.** One that covers many areas or sources: 2 to 4 read-only `explore` or `research` children in parallel, awaited in the turn. Merge their answers and check each claim.

## Design: omt-design

- **The main thread runs Opus.** It draws the variants in Paper itself.
- **Any other model.** 1 `design` child (Opus) draws them.
- **The owner.** Picks one variant per screen and steers, until they approve. Then the main thread writes `docs/design/<slug>.md`.
- **Build in the same thread.** When the owner asks for it, build the ui units with the build flow, steps 7 to 11. QA checks behavior only.

## Code review: omt-code-review

- **The rename.** omt-review becomes omt-code-review. It reviews uncommitted changes, a branch, a commit, or a PR, as today.
- **Sizing.**
  - A small diff: 1 reviewer.
  - A large diff: 2 to 4 grouped reviewers and 1 oracle over the whole change.
  - Today a review can use up to 9 threads.
- **The PR steps stay:** CI fixes, guardrails, CRAP, and offers that the owner approves.
- **Waiting.** Children are awaited in the turn.

## Swarm: omt-swarm

The input is a plan, from omt-plan or from omt-grill and then omt-plan. Swarm has no question batches and no plan review.

1. **Split.** The main thread splits the plan into tracks with disjoint scopes. It does not build.
2. **Tracks.** Each track is a top-level thread (`t3_thread_launch`) in its own worktree. It runs the build loop, steps 7 to 12 of omt-ulw: it builds, starts its own review and QA children, fixes, commits, and reports.
3. **Wait.** The main thread waits for the tracks with `t3_thread_wait`.
4. **Review.** 1 `review` child (other family) reviews all track diffs before the merge. It fixes local findings on the track branches. The main thread reads the fix diff and fixes the reported findings.
5. **Merge.** The main thread merges the track branches and resolves conflicts. A conflict that needs deep knowledge of one track's code goes back to that track's thread with `t3_thread_send`.
6. **QA.** 1 `qa` child runs every check and device flow on the merged code. The main thread fixes failures, and QA re-runs only the failed checks: at most 2 re-runs.
7. **Finish.** Open the PR and report.

## Removed

- **omt-loop.** A main thread that waits in its turn needs no ticks.
- **The stall heartbeat.** This means the `schedule_task` stall checks in `delegation.md#stalled-tasks`.
- **Per-unit dispatch.** This includes per-unit check-ins, reopen cycles, and the task budget.

## Config

New defaults set `2026-12`, because `2026-11` shipped in v0.3.0 and is frozen.

Retired keys:

- `workflow.build.verify`
- `workflow.build.checkpoint`
- `workflow.build.stallMinutes`
- `limits.maxTasksPerRun`
- the roles `verify`, `quick`, and `deep`

An old config still loads. Validation gives one warning for each retired key: `<path> is no longer used; remove it`. This is the same text as the retired `visuals` key. Set 2026-12 drops these keys and roles. It also moves the device-capable Claude-first chain to `qa`.

- **The task budget goes away.**
  - `omt ledger stats` computes `can dispatch` from `maxParallel` only.
  - A plan header `max-tasks` key gets a warning and has no effect.
  - `omt plan limit --tasks` fails with a usage error that says the task budget was removed.
- **Kept:** `maxParallel`, `maxDepth`, `maxReviewRounds`, `build.review`, `build.qa`, `build.failureProofs`, and `build.oracle`.
- **The hook.** It still triggers on `ulw` and `ultrawork`. Its context text changes from "Children make every product edit; you edit no code" to the build contract: load omt-ulw, banner first, the main thread builds, one review child and one QA child check, and done needs evidence.

## Install and update

`omt install` and `omt update` remove a managed skill folder, and its links, when the bundle no longer ships that skill. A folder is managed when omt's install record lists it. They never remove a folder that omt did not install. `omt doctor` reports a leftover managed skill. This removes old `omt-loop`, `omt-review`, and `omt-show` folders on upgrade.

## Stages

Each stage is one commit on branch `t3/audit-omt-workflows-and-budgets`. `bun run verify` must pass before the commit.

1. **Build:**
   - The config retirement, the ledger, `plan limit`, and the hook.
   - The omt-ulw rewrite. Delete omt-loop.
   - Update the shared references, the `omt` and `omt-help` skills, the spec, and the tests.
2. **Plan, grill, research, and design**, with the spec and the tests.
3. **The omt-code-review rename and sizing**, in skills, `src/`, the spec, and the tests.
4. **Swarm**, with the spec and the tests.
5. **Install and update pruning**, with the spec and the tests.
6. **Docs, `docs/research`, and `site/`.** Three delegates in parallel with disjoint scopes.

After stage 6, a reviewer from the other model family reviews the whole branch diff, and the full checks run again.
