---
name: omt-plan
description: Plan before code in T3 Code. Use when the user asks for a plan, a spec, or a design before implementation, or when omt-ulw needs a reviewed plan for a HEAVY task. The main thread explores, asks owner question batches, writes an omt plan file with the summary last, and gets one plan-review child from the other model family with a frozen blocker list and at most 2 review rounds.
---

# Plan

You write a plan that the main thread can build from without another owner decision, and you get it reviewed. You plan only, also when `omt-ulw` calls this skill. You change no code in this skill.

You explore, ask, and write the plan yourself. Children only read broad areas (`explore`) and review the plan (`plan-review`). The T3 rules are in [delegation.md](../omt/references/delegation.md). T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

## Rules

- You wait for each child inside your turn ([delegation.md](../omt/references/delegation.md#waiting)). For one child, call `delegate_task` with `mode: "wait"`. For parallel children, dispatch each with `mode: "async"`, then call `t3_thread_wait` with `threadId` and `runId` for each.
- You end your turn only for the owner: a batch of questions, a plan approval, or the hand-off.
- Record every child dispatch and every result in the ledger ([results.md](../omt/references/delegation.md#dispatching-a-child)).
- Read only the part of a child's result that your next action needs.

## Steps

### 0. Check your mode

Call `t3_thread_configure` with no arguments and read your `interactionMode` and `modelSelection` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). Keep the driver of `modelSelection`, such as `claudeAgent` or `codex`, as your family. Step 4 passes it to `--against`.

In `plan` mode:

- Dispatch only `explore`, `research`, `grill`, and `plan-review`. `research` runs only inside `omt-grill`.
- Write no plan file and no ledger entry.
- Put the plan text in the review brief instead of a path.
- Deliver the finished plan in your final message.
- No grill file exists: take the grill text from the final message of `omt-grill` in this conversation.

Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you know your mode and your family.

### 1. Pick the slug and explore

Pick the plan slug first: `omt-ulw` passes one; otherwise choose one that matches `^[a-z0-9][a-z0-9-]{0,63}$`. Explore briefs and `omt ledger stats` use it as `--plan <slug>`.

When `$(omt paths --grills)/<slug>.md` exists, read it. Put its goal, its decisions, and its edge cases under `## Research`, with the grill file as the source.

When the plan file exists, run `omt profile show --plan <slug> --json`. Before the plan file exists, use `omt profile show <name> --json` for an explicit profile name. When neither a plan file nor a profile name exists, run `omt profile show --json`. Keep the returned `profile` as `<name>` for later commands.

With a selected profile and no plan file for the `--plan` id:

- Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command.
- Before each dispatch, run `omt ledger stats --plan <slug>` and `omt profile show <name> --json`.
- Dispatch only when the ledger's `active` is below the profile's `limits.maxParallel`.
- Use this check in place of `can dispatch`.

Read the code that the goal touches yourself. Send only broad reads to 1 to `maxParallel` read-only `explore` children, one narrow question each, in parallel. Use `--plan <slug> --unit E<k> --round 1 --attempt 1 --title "explore E<k>: <question>"`. Dispatch them with `mode: "async"` and wait for them in this turn ([delegation.md](../omt/references/delegation.md#waiting)). Then read the results and record them ([results.md](../omt/references/delegation.md#dispatching-a-child)).

Done when: you can name each file and function that the change touches, with a `path:line` citation.

### 2. Ask

List the decisions that the plan needs. Settle each one from the code, the docs, or the request. A question that the code can answer is not an owner question: read the code instead. What remains is an owner decision: a choice between valid options that changes what the user gets.

A decision in the grill file is settled. Do not ask it again. From the grill, ask only its open questions and its `pending` edge cases, then the new owner decisions. The owner accepts, changes, or drops each `pending` edge case.

When no grill file exists, and the goal has no done condition that can fail or 4 or more owner decisions remain, offer [omt-grill](../omt-grill/SKILL.md) as the first option in the batch. When the owner picks it, run `omt-grill` with the slug, then come back to this step.

Before you ask, finish all work that does not depend on the answers: the research and a draft plan. Then ask every open owner decision in one batch. Give each question 2 to 4 options and your recommendation. End the turn and wait for the answers.

Include the proposed `## Tests` lines in the first batch. Ask the owner to approve the test list with the plan. Give a reason for each proposed line outside `plan.testLayers`.

After the answers, explore again when an answer opens new code, and ask the next batch. Stop when no question is open.

Done when: every decision is settled from evidence or answered by the owner.

### 3. Write the plan

`omt plan status <slug>` prints the absolute plan path, also from a worktree. Steps 3 and 4 edit and hash the plan at that path. When the plan exists, edit it. Otherwise run `omt plan new <slug> --title "<title>" --profile <name>`, after `omt init` when `.omt/.gitignore` is missing. Keep an existing plan: pass no `--force`. Fill every section yourself. The standard in [planning.md](../omt/references/planning.md) is the standard.

Read the effective profile again with the step 1 command before you fill `## Tests`. Read `workflow.plan.testLayers` as `plan.testLayers` and `workflow.build.qa` as `build.qa`.

- `Done when` items are checks that can fail.
- Fill `## Summary` last, by the summary rule in [planning.md](../omt/references/planning.md), and update it after each review fix. A plan that has no `## Summary` gets one between the header line and `## Objective`.
- When a unit reads outside data, such as recordings, files, or API responses, its done condition includes a check on an input shaped like real data: one captured from a real source, or with the properties real data has, such as offsets, gaps, and sizes. A seeded or ideal sample alone hides real-data defects.
- Each unit has a role, a scope, a done condition, a verify command, and its dependencies. The role of a unit that the main thread builds is `main`.
- Units with no dependency between them have disjoint scopes.
- Paste the output of `omt roles --plan <slug>` under `Roles`.
- Under `## Research`, write each research question, its answer, and its sources.
- When `build.qa` is `off`, leave `## Tests` empty. When `build.qa` is `planned`, fill `## Tests` top-down with the owner's approved lines.
- Start with integration tests: real code through the interface that production uses, with only external services faked. Add an e2e test only for a core user journey, or for a failure that needs the client, server, and backend together. Add a unit test only for pure logic with real branching. Add other test kinds only when the owner asks.
- Propose only the layers in `plan.testLayers` without an owner request. Keep a line in another layer only with its reason and the owner's approval.
- Keep edge cases out of the e2e lines.
- Map each grill edge case with `State: accepted` or `State: changed`. A changed edge case uses the user's handling and test layer from the grill file. A `dropped` edge case gets no line and no done condition. A `pending` edge case gets no line until the owner answers it.
- Each mapped grill edge case with `Test: integration` or `Test: unit` becomes a `## Tests` line of that layer, with `Reason: grill edge case GE<k>`. When that layer is outside `plan.testLayers`, put the line in the step 2 batch for owner approval, as any other line outside. A grill edge case never becomes an e2e line. A mapped edge case with `Test: none`, and every mapped edge case when `build.qa` is `off`, goes into the done condition of the unit that owns its handling.
- Write each `## Tests` line as `- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.` The reason names the bug or regression that the test catches. An empty `## Tests` section means no new tests.
- Docs units use the `writing` role: a unit that only writes documentation or other prose.
- UI units use the `ui` role. When an approved design spec exists, cite it in the unit. Plan an `omt-design` step only when the user requests a design pass first. Otherwise plan direct UI implementation from the task requirements, by [UI implementation](../omt/references/roles.md#main-thread-or-child). A missing design spec or design tool does not block a UI unit.
- Name each shared resource in the plan, such as a build folder, a generated project, a simulator, or a dev-server port. Write each verify command that uses shared build state as `omt lock run <resource> -- <command>`. Use the same `<resource>` for commands that share that state.
- Check for a lock tool with `command -v flock || command -v lockf`. When neither tool exists, run `omt plan limit <slug> 1` for a plan with shared build state and say why.
- When a command leaves processes running after it exits, run that command outside `omt lock`. When a unit uses that command, run `omt plan limit <slug> 1` for the whole plan and say why in the plan.
- Keep units parallel for shared build state alone when a lock tool exists and the command leaves no process running after it exits.

Done when: `omt plan status <slug>` lists every unit, each unit has all five fields, and `## Summary` is the last section that you filled.

### 4. Plan review

Run `omt profile show --plan <slug> --json`. Before the plan file exists, use `omt profile show <name> --json` instead. Read `workflow.plan.review` as `plan.review`.

- `owner`: ask the owner to approve the plan and its `## Tests` list. Dispatch no `plan-review` task for this value. After the owner approves, go to step 5.
- `two-families`: 1 `plan-review` child on the family other than yours. Build its brief with `--against <your family>` from step 0.
- `one`: 1 `plan-review` child on any family. Build its brief with no `--against`.

Run at most 2 review rounds. Each round dispatches a fresh `plan-review` task; reuse no reviewer thread.

1. Make every plan edit first, `omt plan limit` included. Then compute the hash: `shasum -a 256 <plan path>`, with the path from step 3. In plan mode no file exists: write the exact plan text that you put in the brief to `$TMPDIR/omt-<slug>-plan.md` with a quoted heredoc (`<<'EOF'`), then hash it with `shasum -a 256 < "$TMPDIR/omt-<slug>-plan.md"`.
2. Build the brief with `omt brief plan-review --task-file - --title "plan-review: <title>" --round <n> --attempt 1 --plan <slug> --unit plan [--against <your family>] --json`. The task names the plan path and its SHA-256, and asks the reviewer to confirm the hash before it reads. Name the effective `plan.testLayers` value in the task. In round 2, pass `--prior-file` with the frozen blocker list and your response to each blocker.
3. Before each dispatch, run `omt ledger stats --plan <slug>`. When a plan file exists, dispatch only while it reports `can dispatch: yes`. Otherwise, use the step 1 dispatch check.
4. With `two-families`, check that the target's provider is in the other family before the call. When a failure code would move the task to a rung of your own family, do not fall back. Stop and tell the user that no reviewer from the other family can run.
5. Dispatch it with `mode: "wait"`. Record the dispatch with `--task-id`, `--provider`, and `--model`, and wait for it in this turn ([delegation.md](../omt/references/delegation.md#waiting)). Then read the verdict and record it ([results.md](../omt/references/delegation.md#dispatching-a-child)).

Round 1: `APPROVE` ends the review; notes do not block. Otherwise the reviewer's blocking findings are the frozen blocker list. Write the list under `Log` in the plan. Fix each blocker in the plan yourself, update `## Summary`, and compute the hash again.

Round 2: one re-review checks only the frozen blockers and the regressions from your fixes. Count a finding only when it is on the frozen list or is a regression from your fixes. Record anything else as a note.

After round 2, run no more rounds. When blockers stay open, ask the owner about each one in one batch, with 2 to 4 options and your recommendation. Apply the answers to the plan, and compute the hash again.

After any edit to the plan, header edits included, compute the hash again before the next brief.

Done when: a round returned `APPROVE`, the owner approved under `plan.review=owner`, or the owner answered each blocker that stayed open after round 2.

### 5. Hand off

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Show the plan to the owner first, also when `omt-ulw` called this skill. Write the `## Summary` text in full in the reply. The reply also gives the plan path, the review result, and each decision still open.

When `omt-ulw` called this skill, return to its step 5 with the plan slug. There the owner approves the plan, and step 6 runs the design check, so the `omt-design` step runs before any `ui` unit is built.

Called alone, stop. Start no units.

Done when: the owner has the summary in the reply, and the user, or the `omt-ulw` run, has the plan path and the review result.
