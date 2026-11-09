# How the omt workflows run

This page describes how omt builds a goal, plans, researches, designs, runs parallel tracks, and reviews a pull request. It also describes how the main thread runs a child task, when omt commits and opens a PR, how it adds tests, and how parallel workers share builds. To change these steps, see [Configure roles and profiles](configuration.md).

## Build a goal

`omt-ulw` (or the phrase `start ulw` with the Claude Code hook) runs the build flow. The main thread, the T3 thread that runs the skill, does the work in one context:

1. It checks the interaction mode and the branch. If your message is a question and not a goal, it runs `omt-research` instead.
2. It reads the code. It sends only broad reads to `explore` tasks, in parallel.
3. It frames the goal: the objective, done conditions that can fail, the tier (LIGHT or HEAVY), and a slug.
4. It asks you every open question at once, each with 2 to 4 options and a recommendation. After your answers it asks the next batch, until no question is open. It does not ask what the code can answer.
5. It plans. A LIGHT run gets a short plan that the main thread fills. A HEAVY run goes through `omt-plan`, and you approve the plan.
6. When the user requests a design pass first, it runs `omt-design` before the affected UI units. Otherwise it builds the UI from the task requirements.
7. It builds the units itself, runs each unit's verify command, and writes the planned tests. A large unit with its own files can go to an `execute` task.
8. One review task from the other model family reviews the whole diff. The reviewer fixes local findings itself and reports the rest. When the profile requires the oracle, this reviewer is the oracle.
9. The main thread reads the reviewer's fix diff and fixes the reported findings.
10. One qa task runs every verify command, the final checks, and the device flows. It edits nothing.
11. The main thread fixes each failed check, and qa runs only the failed checks again. After 2 re-runs that still fail, it stops and asks you.
12. It commits, pushes, and opens or updates a draft PR by the [git policy](#commit-push-and-open-a-pr). It reports each done condition with its evidence.

The main thread ends its turn only for you (a batch of questions, a plan approval, or the report) or to wait for a child task. No heartbeat wakes the thread: T3 wakes it when a child ends ([Run a child task](#run-a-child-task)). A LIGHT run skips the plan review and your plan approval, but it still has the review task and the qa task. In the `normal` profile, the reviewer checks the fixes again after each round, up to `maxReviewRounds` reviews.

UI work needs no design spec. The agent that builds the UI follows an approved spec when one exists. Without one, it builds from the task requirements and loads Anthropic's `frontend-design` skill when it is installed. Setup recommends that skill when it is missing, and a missing skill does not block the work.

## Run a child task

Each child task takes three calls in the main thread:

1. `omt brief <role> ... --plan <slug> --unit <id> --save --json` renders the brief and saves it. It also checks the parallel limit and records the start in the ledger. At the limit, it exits 75 and writes nothing, and the main thread waits for a child to end.
2. The T3 tool `delegate_task` starts the child with the payload from step 1, unchanged.
3. When the result is in, `omt ledger done <requestId> --verdict <word>` closes the start. It prints `settle: allowed`, and the main thread then settles the child, so that T3 releases it at once. In a linked worktree, it prints `settle: no (linked worktree)`, and the main thread settles no child.

When the next step needs the result, the main thread starts the child in wait mode. Otherwise it follows the `next` field of the T3 result: it ends its turn, and T3 wakes the thread when the child ends. It does not poll.

When T3 refuses a target, for example with `provider_unavailable`, the main thread runs the same `omt brief` command with `--fallback`. The CLI picks the next target that this unit has not tried. A cross-family review passes `--strict`, so the run stops when no reviewer from the other family is left, instead of a review by the same family.

In T3 plan mode, the main thread writes nothing: it leaves out `--save`, records no start, and keeps the parallel limit itself.

## Plan, research, and design

- `omt-plan` plans only. The main thread reads the code, asks question batches until no question is open, and writes the plan with its summary last. One `plan-review` task from the other model family reviews it. The main thread fixes the blockers, and one more review checks only those blockers: at most 2 rounds. The reply shows the plan summary. For a vague goal, it offers a [stress test](#stress-test-a-goal-before-you-plan) first.
- `omt-research` answers a narrow question in the main thread, with a `path:line` or a URL for each fact. A broad question gets 2 to 4 read-only tasks in parallel, and the main thread checks each claim before it answers.
- `omt-design` draws the variants of each screen with the tool that `workflow.design.tool` names. `paper`, the default, draws in a new Paper file when Paper's tools load, and in HTML mockups otherwise. `html` draws HTML mockups only. When the first model of the `design` role is the main thread's model, the main thread draws the variants itself. Otherwise one routed `design` task draws them, with the configured fallbacks. Both use Anthropic's `frontend-design` skill when available. You pick one variant per screen and steer until you approve. Then the main thread writes `docs/design/<slug>.md`, and on request it builds the screens with the build steps 7 to 12.

## Build parallel tracks

`omt-swarm` builds one plan as parallel tracks. It is opt-in: install it with `omt install --with omt-swarm` (or `omt install --project --with omt-swarm`). Start it by name, with a plan from `omt-plan`. It asks no questions and runs no plan review.

1. The main thread splits the plan units into tracks whose files do not overlap. It does not build.
2. Each track is a new top-level thread in its own worktree and branch. The track runs the build steps 7 to 12 for its units, with its own review and qa tasks, and commits with no push.
3. The main thread waits for the tracks inside its turn.
4. One review task from the other model family reviews every track diff before the merge, and fixes local findings on the track branches. The main thread reads those fixes and fixes the reported findings.
5. The main thread merges the track branches. A conflict that needs deep knowledge of one track goes back to that track's thread.
6. One qa task runs every check and device flow on the merged code, with at most 2 re-runs of the failed checks.
7. The main thread opens one draft PR and reports.

`omt-swarm` needs a thread in `full-access` runtime mode and `default` interaction mode.

## Climb to a target score

`omt-climb` turns a goal into a score and repeats change, check, and score until every judge meets a target. Start it by name. It is useful when a check can give a number but not a pass: an eval with a pass count, a benchmark, a bundle size, or the look of a UI.

1. The main thread asks for the scorer, the target, the judges and their tiers, the gates (such as the test suite), and the round limit.
2. A scorer is a command that prints a number, or `judge` tasks that score screenshots or outputs out of 10 in each category. Judges see only letter labels, such as `A` and `B`, and never the target, the round, or earlier scores. The baseline (the code before the first change) and any competitor screenshots are scored in every round, and a judge's baseline score corrects its drift.
3. Tier 1, the least expensive judge, scores each round. A higher tier, such as Opus, scores only after the lower tiers meet the target. This keeps most of the cost on the less expensive model.
4. `omt climb status` says what comes next. The run stops at `met`, or asks you at `plateau` (the score stopped rising) or `limit` (the round limit).
5. The run ends with the build steps 8 to 12: one review task and one qa task check the behavior, and the PR body gets the climb table.

## Review a pull request

In a T3 thread, run the skill:

```text
omt-code-review <number>
```

The skill does these steps in order:

1. It reads and links the PR, and saves your branch for the return command. It checks out the PR only when a step needs it, and a checkout needs a clean working tree.
2. It reads the project rules. A finding that breaks a written rule cites the file and line of the rule.
3. Reviewers read the PR head commits. A diff under 200 changed lines gets 1 reviewer. A larger diff gets 2 to 4 reviewers, each with one group of files. Reviewers edit nothing.
4. It merges the findings. When the profile turns the oracle on, an oracle from the other model family checks them over the whole change. For a small diff, the one reviewer is the oracle.
5. It writes the report: the findings by severity, the design files, and the command that returns you to your branch.
6. It offers a fix loop. After your yes, the main thread makes the fixes, commits each one, and pushes them to the PR branch by the [git policy](#commit-push-and-open-a-pr).

A review starts at most 4 reviewers and 1 oracle. Reviews after a fix read the working tree. The skill posts no GitHub comment and no GitHub review. The same skill, without a PR number, reviews uncommitted changes, a branch, or a commit.

### Turn on the PR extras

Five PR extras are off in both presets, `normal` and `prototype`. Turn on the ones you want with `workflow.review` in a profile ([Write a custom profile](configuration.md#write-a-custom-profile)):

| Key | Value that turns it on | What it adds |
| --- | --- | --- |
| `review.ci` | `check` or `fix` | Reads the CI checks and saves the failure logs. `fix` also fixes each failing check, and one review task checks the fixes. For pending checks, it uses the T3 PR watch. |
| `review.crap` | `report` | Runs the coverage command once and reports CRAP for the changed functions. CRAP combines complexity and test coverage. A value above 30 is a P2 finding. |
| `review.verify` | `changed-flows` | One qa task runs the changed screens, CLI commands, and API routes, and names the tests that cover them. A flow that fails is a P1 finding. |
| `review.tests` | `offer` | Offers one e2e test for each verified flow that no test covers. After your yes, the main thread writes the tests and a qa task runs them. |
| `review.guardrails` | `propose` | Proposes checks, rule fixes, or new rules for the findings, and saves them in `.omt3/guardrails.md`, which git ignores. |

The [spec](spec.md#154-pull-request-review) lists the steps and the extras.

## Commit, push, and open a PR

The git policy in your config decides each commit, push, PR, and merge. The skills act through `omt git`, which applies the policy, reads your GitHub login with `gh`, and checks who owns the repo and its open PRs:

1. Before the first edit, `omt git start` records the files that were already changed.
2. `omt git commit` commits only the files that the run changed. A file that you changed before the run stays out of the commit.
3. `omt git pr` pushes the branch and opens a draft PR, or updates the open PR of the branch. In a PR review, `omt git pr --pr <number>` pushes the fixes to that PR only, and asks for a PR from a fork or by another author. When the PR would change more than `maxPrFiles` files, the skill cuts the branch into slices and opens one stacked PR per slice with `omt git stack`.

Each command acts on `auto`. On `ask`, it acts on nothing, and the skill asks you first. On `off`, the skill skips the action and says so.

With the default policy, on a branch that is not the default branch:

- `omt-ulw` makes one commit for the run after QA passes. Then it pushes the branch and opens a draft PR, or the push updates the branch's open PR. To get a PR that is ready for review, ask for one in your message or in your `AGENTS.md`.
- `omt-code-review` commits each approved fix and pushes it to the PR branch with no further question. For a PR by another author, it asks you first.

A commit or push on the default branch asks you first. Each merge and each force push also asks you first. Without a git policy, each action asks. To change the policy, set `workflow.git` in a profile ([Write a custom profile](configuration.md#write-a-custom-profile)). The [spec](spec.md#515-omt-git) lists the rules.

## Stress-test a goal before you plan

`omt-plan` offers a stress test when your goal has no done condition that can fail, or when 4 or more of your decisions are open. You can also ask for one. The main thread does it itself, from the code and your request. It lists the edge cases, each with an id such as `GE1`, its trigger, its effect, a proposed handling, and a test layer. It also lists the options for the direction of the work, each with its gain and its cost, and the open questions. You accept, change, or drop each edge case by its id. An accepted or changed edge case becomes an integration or unit test in the plan, or a done condition of the unit that handles it.

The stress test replaces the `omt-grill` skill and its `grill` role, which are retired.

## Add tests only from the plan

Workers add no tests on their own. The plan lists each proposed test under `## Tests`, with its flow, its file, and the reason for it. You approve these lines when you approve the plan. An empty list means no new tests.

The main thread writes only the approved tests while it builds. In the `normal` profile, it also proves that each new test can fail, in a private copy of the working tree. Then one qa task runs every verify command, the final checks, and the device flows. qa edits nothing and writes no tests.

## Share builds between parallel workers

Parallel workers, such as an `execute` task that builds a large unit beside the main thread, share one checkout and edit different files. Commands that share build state take a lock, one lock name for each resource:

```sh
omt lock run build -- npm run build
omt lock list
```

A command waits up to 900 seconds for a busy lock. `--wait <seconds>` changes the wait. After a timeout, the command exits with code 75. The lock uses `flock` or `lockf`, and omt never takes a lock from its holder. If neither tool is installed, the command runs with a warning, and the planner runs shared builds one at a time.

A command that leaves a server or a watcher running cannot use the lock. The planner runs such commands one at a time, outside the lock.
