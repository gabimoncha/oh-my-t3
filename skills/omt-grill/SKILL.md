---
name: omt-grill
description: Grill, stress-test, find the edge cases of, or brainstorm a vague goal before a plan, in T3 Code. Use when the user says grill or stress-test, asks for edge cases or a brainstorm, gives a goal that is too vague to plan, or wants to test an idea before a plan, or when omt-plan offers a grill. The main thread finds the facts, gets one second opinion from a grill child on the other model family, asks question batches, checks each answer against the facts, and writes a grill file that omt-plan reads.
---

# Grill

You confront the owner's goal with facts before it has a plan. You find its edge cases, its open questions, and the options, and you get answers from the owner. You write no plan and change no code in this skill. The T3 rules are in [delegation.md](../omt/references/delegation.md). T3 tools appear by base name and your harness may prefix them, for example `mcp__t3-code__delegate_task`.

You do the grill yourself. Children only read broad areas (`explore`), read docs or the web (`research`), and give one second opinion (`grill`). Expected cost: 1 `grill` task per grill, plus the explore and research tasks.

## Rules

- You wait for each child inside your turn ([delegation.md](../omt/references/delegation.md#waiting)). For one child, call `delegate_task` with `mode: "wait"`. For parallel children, dispatch each with `mode: "async"`, then call `t3_thread_wait` with `threadId` and `runId` for each.
- You end your turn only for the owner: a batch of questions or the hand-off.
- Record every child dispatch and every result in the ledger ([results.md](../omt/references/delegation.md#dispatching-a-child)).
- A question that the code, the docs, or the web can answer is not an owner question. Find the answer and cite it.

## Steps

### 0. Check your mode

Call `t3_thread_configure` with no arguments and read your `interactionMode` and `modelSelection` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). Keep the driver of `modelSelection`, such as `claudeAgent` or `codex`, as your family. Step 3 passes it to `--against`.

In `plan` mode:

- Dispatch only `explore`, `research`, and `grill` tasks.
- Build each brief without `--save`.
- Write no grill file and no ledger entry.
- Count your active tasks yourself against the profile limits, and keep each task id.
- Read the kept task ids with `task_status` and `t3_thread_read` instead of `omt ledger list`, and write nothing.
- Deliver the grill text, in the [grill file](#grill-file) layout, in your final message.

Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you know your mode and your family, and the branch check is done or reported as skipped.

### 1. Frame

Use the slug that `omt-plan` passes. Otherwise pick a slug that matches `^[a-z0-9][a-z0-9-]{0,63}$`. The later plan uses the same slug, so grill tasks and plan tasks share one ledger.

Run `omt roles --role grill --json`. If it exits 1 with `unknown role grill`, check whether a config override removed the role. Show the user the issue and offer `omt-setup` to restore it. Continue the main-thread questions while that decision is pending.

Read the profile:

- When the plan file exists, run `omt profile show --plan <slug> --json`.
- Before the plan file exists, run `omt profile show <name> --json` for an explicit profile name, or `omt profile show --json` without one.
- Keep the returned `profile` as `<name>`.

Before each dispatch, run `omt ledger stats --plan <slug>`. When the plan file exists, dispatch only while it reports `can dispatch: yes`. With no plan file:

- Pass `--profile <name>` to every `omt brief`, `omt roles`, and `omt route` command.
- Before each dispatch, run `omt ledger stats --plan <slug>` and `omt profile show <name> --json`.
- Dispatch only when the ledger's `active` is below the profile's `limits.maxParallel`.
- Use this check in place of `can dispatch`.

When `$(omt paths --grills)/<slug>.md` exists, read it and its `Log`. Only recorded answers settle an item.

- A `pending` edge case is not settled; show it again in the edge-case table of the next batch.
- When the `Log` shows a `grill` task, the second opinion ran. Skip step 3.
- When the file holds a batch without recorded answers, go back to step 5. Send the same batch again from the file, and wait.

Write the goal in at most 5 lines. List the areas that the goal touches. Mark each area `user` when the owner knows it and can choose, or `models` when you decide it. Take the marks from the conversation. When the conversation does not show them, ask the owner in the first batch.

Done when: the `grill` role resolves, and your reply has the goal and each area with its mark.

### 2. Find the facts

Read the code that the goal touches yourself. Send only broad reads to read-only `explore` children, and questions about docs or the web to read-only `research` children, one narrow question each, in parallel. Build each brief with `omt brief <explore|research> --task-file - --title "<role> GX<k>: <question>" --plan <slug> --unit GX<k> --round 1 --attempt 1 --save --json`. The units are `GX<k>`, so the later plan's explore units `E<k>` get their own request ids.

Dispatch them with `mode: "async"`, record each dispatch ([results.md](../omt/references/delegation.md#dispatching-a-child)), and wait for them in this turn ([delegation.md](../omt/references/delegation.md#waiting)). Then read each result, record it, and settle the child ([delegation.md](../omt/references/delegation.md#releasing-children)). Spot-check one citation per child.

Done when: your reply has the facts that the goal rests on, each with a `path:line` or URL citation.

### 3. Get one second opinion

Dispatch one `grill` child on the family other than yours, once per grill. Never send it a later batch, and never start a second `grill` child.

Write the task text. It holds the goal, the knowledge map, the facts with their citations, and the owner's words verbatim. Build the brief:

```sh
omt brief grill --task-file - --title "grill: <title>" --plan <slug> --unit grill --against <your family> --round 1 --attempt 1 --save --json
```

Check that the target's provider is in the other family before the call. When a failure code would move the task to a rung of your own family, do not fall back. Tell the owner that no grill child from the other family can run, and ask whether to go on without the second opinion.

Run the dispatch check of step 1. Dispatch the child with `mode: "async"` and record the dispatch with `--task-id`, `--provider`, and `--model`. While it runs, write your own items from the facts: directions, decisions, questions, and edge cases. Then wait for it in this turn ([delegation.md](../omt/references/delegation.md#waiting)), read its result with `task_status`, record it with its `VERDICT`, and settle the child.

Done when: the `grill` result is recorded, or the owner has the question about a missing second opinion.

### 4. Merge

Merge your items and the `grill` child's items into one list, without duplicates.

Merge the directions. Give each direction its gain and its cost. While no direction is chosen:

- When the area of the direction is `user`, the first question asks for a direction. Its options are the merged directions, each with its gain and cost, and your recommendation. It is always `Blocking: yes`.
- When the area of the direction is `models`, choose the direction yourself and give the reason. Record it in the `## Directions` section, with the dropped directions and why.

When a fact or an answer shows that the chosen direction fails, reopen the choice. Move the chosen direction to dropped, with the reason. Then apply the rules above for an open direction.

Sort the other items into three groups:

1. Decisions that you make, each with its area and reason. Give each one an id `GD<k>`.
2. Questions that only the owner can answer, each with 2 to 4 options and a recommendation. Give each one an id `GQ<k>`.
3. Edge cases, each with its trigger, its effect, a proposed handling, and a test layer. Give each one an id `GE<k>`.

When you and the child disagree, keep both options. In a `user` area, the disagreement becomes a question. In a `models` area, pick one option yourself and give the reason.

Done when: the directions are merged, and each item is in one of the three groups or is a note.

### 5. Ask

Update the grill file first. Run `mkdir -p "$(omt paths --grills)"`, then write `$(omt paths --grills)/<slug>.md` in the [grill file](#grill-file) layout, with `status=open` and `rounds=<n>`, where `<n>` counts the batches. Write each decision with its area and reason. Write each new edge case with its handling, its test layer, and `State: pending`. Keep each `pending` edge case from earlier batches. Write each open question with its options and your recommendation. Save the direction question first in `## Open questions`. In `plan` mode, keep the same text in your reply instead.

Then send one batch with three parts:

1. The decisions table: id, area, decision, and reason. The owner may override any decision by its id.
2. Every open question, numbered, each with its options and your recommendation. While no direction is chosen, the direction question is first.
3. The edge-case table: id, trigger and effect, handling, and test layer. It holds the new edge cases and every `pending` edge case from earlier batches. The owner accepts all rows at once, or accepts, changes, or drops a row by its id.

End the turn and wait for the answers.

Done when: the grill file holds batch `<n>`, and the owner has the batch.

### 6. Check the answers

Record the answers in the grill file. Write the chosen direction in the `## Directions` section, with the dropped directions and why. An overridden decision gets `By: user`. Set `State: accepted` only when the owner accepts that row or accepts all rows. Set `changed` or `dropped` only from the owner's answer for that row. A row with no answer stays `pending`. When the owner changes an edge case, write the owner's handling in its `Handle:` field, and the owner's test layer in its `Test:` field when the owner changes it. Then set `State: changed`. An answered question becomes a decision. Add a `Log` line with the time, the batch, the task ids, and the answers.

Check each answer against the facts. Read the code yourself for a narrow check. Send a broad check to an `explore` child, or a docs or web check to a `research` child, with the next `--round`, as in step 2. When an answer conflicts with a fact, ask about it again in the next batch, with the fact and its citation. When an answer opens new code or a new edge case, add the items as in step 4.

Stop when one of these holds:

- No question is open, no edge case is `pending`, and a direction is chosen.
- The owner tells you to stop.

Otherwise go back to step 5 with batch `<n+1>`.

Done when: you stopped for one of the two reasons, or batch `<n+1>` is with the owner.

### 7. Hand off

Before you report, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)), except when `omt-plan` called this skill.

Set `status=done` in the grill file header. When you stopped with no chosen direction, write `No direction chosen.` in the `## Directions` section.

Write the grill summary in the reply: the goal, the chosen direction, the number of decisions and edge cases, each open question, and each `pending` edge case. Name the grill file path. The summary holds no plan and no code.

When `omt-plan` called this skill, return to its step 2 with the grill file path. In `plan` mode, return the grill text instead. Otherwise offer `omt-plan`: tell the owner to say "plan it" to run `omt-plan` with the slug.

Start no plan and no unit.

Done when: the grill file has `status=done`, or in `plan` mode your final message has the grill text, and the owner or `omt-plan` has the path or the text.

## Grill file

The grill file is `$(omt paths --grills)/<slug>.md`. All worktrees share it, so always get the folder from `omt paths --grills`, and never from a path relative to your working directory.

```markdown
# Grill: <title>

<!-- omt-grill v1 slug=<slug> status=open|done rounds=<n> -->

## Goal

## Knowledge map
- <area>: user | models. Source: conversation | asked.

## Facts
- <fact>. Source: <path:line or URL>.

## Directions
- <chosen direction>. Dropped: <direction> because <reason>.

## Decisions
- GD<k>. <decision>. Area: <area>. By: user | models. Why: <reason>.

## Edge cases
- GE<k>. When <trigger>, <effect>. Handle: <handling>. Test: integration | unit | none. State: pending | accepted | changed | dropped.
  A `changed` edge case holds the user's handling and test layer. A `pending` edge case has no answer yet.

## Open questions
- GQ1. Which direction? Options: <direction>, gain <gain>, cost <cost>; <direction>, gain <gain>, cost <cost>. Recommend: <direction>, because <reason>. Blocking: yes.
- GQ<k>. <question>. Options: <a>; <b>. Recommend: <option>, because <reason>. Blocking: yes | no.

## Log
- <timestamp> batch <n>: <task ids>; owner answers.
```
