---
name: omt-climb
description: Hill climb in T3 Code. Turns a goal into a score, then repeats change, gates, and score until every judge meets a target, the score stops rising, or the round limit ends the run. The judges are commands that print a number, or models that score blind-labeled screenshots or outputs, least expensive tier first. Runs only as the T3 workflow omt-climb, so it needs T3 Workflows.
disable-model-invocation: true
---

# Climb

A climb turns a goal into a score and makes the score reach a target. You frame the hill with the owner and start the T3 workflow `omt-climb`. The workflow runs every round: the gates, the capture, the blind labels, the judges by tier, and one agent thread that makes each change and commits it. It asks the owner on the Workflows page at a plateau or at the round limit, and sends this thread a message when it ends.

## Rules

- A climb runs only as the T3 workflow. It has no in-thread steps. When T3 Workflows is off or `t3 workflow` fails, print one line, `omt-climb needs T3 Workflows: turn it on in T3 Settings → Labs → Workflows, then start omt-climb again (<first error line>)`, and stop.
- Judges are blind. The rubric names no target, no round, no earlier score, and no hint about which subject is the change.
- Change the target, the round limit, or a judge only after the owner's yes.
- In a design climb, model judges score screenshots of the running app. The owner still reviews `docs/design/`.

## Steps

### 0. Check T3 Workflows

Run `t3 workflow list --json`, and read `$T3CODE_THREAD_ID`. When the command fails or the variable is empty, apply the first rule and stop. Check your mode by [Your interaction mode](../omt/references/delegation.md#your-interaction-mode): a climb commits, so in `plan` mode ask the user to switch this thread to default mode. Then run the [branch check](../omt/references/delegation.md#branch-check).

Done when: T3 Workflows answered, and you run in `default` mode on an up-to-date branch; or the user has the one line or the question.

### 1. Frame the hill

Pick the slug (`^[a-z0-9][a-z0-9-]{0,63}$`). Read the code that the goal touches. Then ask the owner, in one batch, each open item with 2 to 4 options and your recommendation:

- The scorer: a command that prints one number on its last line (an eval, a benchmark, a bundle size), or model judges that score screenshots or outputs from 0 to 10.
- The target, and the direction: `up` when a higher score is better. Model judges need `up`.
- For model judges: the categories, the rubric, the capture command, and the reference subjects, such as screenshots of a competitor. Ask whether the change must beat each reference.
- The tiers. Recommend tier 1: the `judge` role with `against` empty, its least expensive model. Tier 2: the `judge` role with `against` set to the tier 1 driver, the other family. A tier scores a round only after the lower tiers meet the target.
- The gates: commands that must pass before each round is scored, such as the test suite.
- The change role: `execute`, or `ui` for a UI climb.
- The round limit (default 10) and the plateau rule (default: a gain below 0.2 over 2 rounds).

The capture command writes the files of the current code, such as screenshots, into the folder `$OMT_CLIMB_OUT`. It runs in the checkout of each round, so it starts the app itself or uses one that runs from that checkout.

Done when: each item has the owner's answer or an accepted recommendation.

### 2. Write the input

Commit the current work by [Git actions](../omt/references/delegation.md#git-actions), so the climb starts from a commit. Write the input JSON of [omt-climb](../omt/references/t3-workflows.md#omt-climb-input) to a temp file.

Done when: the tree is clean, and the input file holds `head` from `git rev-parse HEAD`.

### 3. Start the run

Run `t3 workflow start omt-climb --input "$(cat <file>)" --key omt-climb/<slug>/<head>`. When it fails, apply the first rule and stop; when it names no workflow `omt-climb`, add that `omt update` installs it. Tell the owner the run id, that the Workflows page shows each round, and that a plateau or the round limit asks there. End your turn.

Done when: the run started and your turn ended.

### 4. Act on the message

The run ends with a message to this thread, `omt-climb workflow run <id> ...`, with the outcome and the climb table. Read the result with `t3 workflow show <id> --json`.

- `met`, `plateau`, or `limit`: merge `result.head` with `git merge --ff-only <head>`, or `git merge <head>` when that fails. Show the owner the table, `result.changes`, and `result.declined`, then commit, push, and open a draft PR by [Git actions](../omt/references/delegation.md#git-actions), with the table in its body.
- `stopped` or `cancelled`: tell the owner the reason. A run that stopped on invalid input names the field; fix the input and start again with a new key.

Done when: the owner has the table and the PR URL, or the reason that the run stopped.
