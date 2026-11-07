---
name: omt-climb
description: Hill climb in T3 Code. Repeats change, check, and score until every judge meets a target, the score stops rising, or the round limit ends the run. The scorer is a command that prints a number, or judge children that score blind-labeled screenshots or outputs, least expensive tier first.
disable-model-invocation: true
---

# Climb

A climb turns a goal into a score and makes the score reach a target. You change the code, run the gates, get scores, and act on the `next:` line of `omt climb status <slug>`. Judges only score. The CLI keeps every score and decides the next action, so you spend no tokens on bookkeeping.

## Rules

- Record every score with `omt climb score`. Act only on `next:` of `omt climb status <slug>`.
- Judges are blind. Their task names no target, no round, no earlier score, and no hint about which label is the change. Each round gives them the same rubric and categories.
- A tier scores a round only when `next:` names it. The costly judges score only after the less expensive tiers meet the target.
- Raise the target or the round limit, or change a judge, only after the owner's yes.
- Screenshots come from a capture command or a `qa` child ([Verification and devices](../omt/references/delegation.md#verification-and-devices)). Judges only read files.
- In a design climb, judges score screenshots of the running app. The owner still reviews `docs/design/`.
- Dispatch each child by [Dispatching a child](../omt/references/delegation.md#dispatching-a-child), and wait by [Waiting](../omt/references/delegation.md#waiting).
- After a context reset, read `omt climb status <slug>`, `omt plan status <slug>`, and `omt ledger list --plan <slug>` before you act.

## Steps

### 0. Check your mode

Check your mode and family by [Your interaction mode](../omt/references/delegation.md#your-interaction-mode). A climb edits files, so in `plan` mode ask the user to switch this thread to default mode. Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: you run in `default` mode on an up-to-date branch, or the user has the question.

### 1. Frame the hill

Pick the slug (`^[a-z0-9][a-z0-9-]{0,63}$`). Read the code that the goal touches. Then ask the owner, in one batch, each open item with 2 to 4 options and your recommendation:

- The scorer: a command that prints one number (an eval, a benchmark, a bundle size), or judges that score screenshots or outputs.
- The target, and the direction: `up` when a higher score is better.
- For judges: the categories, the rubric, and the reference subjects, such as screenshots of a competitor. Ask whether the change must beat each reference (`--beat`).
- The judge tiers. Recommend tier 1: the `judge` role without `--against`, its least expensive rung. Tier 2: the `judge` role with `--against <tier 1 driver>`, the other family. A third model needs its own role from `omt-setup`.
- The gates: commands that must pass before each score, such as the test suite.
- The round limit (default 10) and the plateau rule (default: a gain below 0.2 over 2 rounds).

Done when: each item has the owner's answer or an accepted recommendation.

### 2. Set up

1. Run `omt plan new <slug> --light`. Write the Objective, each gate as a `Done when` item, and under `## Log` each judge name with its role and `--against` value.
2. Run `omt climb new <slug> --target <n> --judge <name>@<tier> ...` with `--category`, `--beat`, `--direction`, `--max-rounds`, `--plateau`, and `--min-gain` as the owner chose.
3. Run `omt git start --plan <slug>`.
4. Name one capture command that writes the screenshots or outputs of the current code to the directory that `omt paths --evidence` prints, so that a round needs no capture child. Without one, a `qa` child captures in each round. Capture the baseline (the code before your first change) and each reference once, and use the same files in every round.

Done when: `omt climb status <slug>` prints `next: round`, and the baseline and reference files exist.

### 3. Score a round

1. Run the gates, then `omt climb round <slug>`, with `--subject baseline` when judges are models, and `--subject <name>` for each reference. It prints the round's random `key` and the blind label of each subject. Read `omt climb status <slug>` for the tier to score. The baseline score corrects each judge's drift.
2. Copy the files of each subject to `<evidence>/climb-<key>/<label>-<k>.<ext>`, so that a path shows no subject and no round.
3. For a scorer command, run it and record `omt climb score <slug> --judge <name> --score <n>`.
4. For judges, dispatch each judge of the tier that `next:` names in parallel, with `omt brief <role> --task-file - --title "judge <name> <key>" --plan <slug> --unit J-<name>-<key> --save --json`. Use the role and `--against` value recorded in the plan, with no `--round`. The task holds the rubric, the categories, and the labeled file paths.
5. Save each result block to a file. For `INCONCLUSIVE`, resolve its `NOTES` and dispatch the judge again with the next `--attempt`. For `SCORED`, run `omt climb score <slug> --judge <name> --result-file <file>`. Read its `SCORES` and `FINDINGS`.
6. Run `omt climb status <slug>`. On `score tier <t>`, dispatch the missing judge. On `judge-tier tier <t>`, dispatch tier `t` on the same files in the same round.

Done when: `next:` is `change`, `met`, `plateau`, or `limit`.

### 4. Change

Read the `FINDINGS` of the round. Pick the changes that cost the most points and fit the Objective, and record each declined finding under `Log` with its reason. Make the changes yourself, or send a large one to a `ui` or `execute` child. Run the gates until they pass. Capture the current code again, then go to step 3.

Done when: every gate passes on the change, and the capture of the current code is new.

### 5. Stop

- `met`: go to step 6. When the owner wants a higher target, run `omt climb set <slug> --target <n>` after their yes, then go to step 4.
- `plateau` or `limit`: show the owner the output of `omt climb status <slug>` and the open findings. Ask whether to stop, raise the limit with `omt climb set <slug> --max-rounds <n>`, or change the approach.

Done when: `next:` is `met`, or the owner chose how to go on.

### 6. Finish

Run `omt-ulw` steps 8 to 12 with this plan. The review and QA children check behavior; the judges already scored looks. When step 12 creates the PR, put the output of `omt climb status <slug> --markdown` in its body. The report adds the climb table and each declined finding.

Done when: the report has each gate with its evidence, the climb table, and the PR URL or the policy reason.
