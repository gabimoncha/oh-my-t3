# How the omt workflows run

This page describes how omt builds a goal, plans, designs, and reviews a pull request, and how the review and QA steps run as T3 workflows. It also describes how the main thread runs a child task, when omt commits and opens a PR, how it adds tests, and how parallel workers share builds. To change these steps, see [Configure roles and profiles](configuration.md).

## Build a goal

`omt-ulw` runs the build flow. The main thread, the T3 thread that runs the skill, does the work in one context:

1. It checks the interaction mode and the branch. If your message is a question and not a goal, it answers in the thread with a source for each fact, or sends a question that needs docs or the web to one `research` task, and stops.
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
12. It commits, pushes, and opens or updates a draft PR by [your git rules](#commit-push-and-open-a-pr). It reports each done condition with its evidence.

The main thread ends its turn only for you (a batch of questions, a plan approval, or the report) or to wait for a child task. No heartbeat wakes the thread: T3 wakes it when a child ends ([Run a child task](#run-a-child-task)). A LIGHT run skips the plan review and your plan approval, but it still has the review task and the qa task. In the `normal` profile, the reviewer checks the fixes again after each round, up to `maxReviewRounds` reviews.

UI work needs no design spec. The agent that builds the UI follows an approved spec when one exists. Without one, it builds from the task requirements and loads Anthropic's `frontend-design` skill when it is installed. Setup recommends that skill when it is missing, and a missing skill does not block the work.

## Run a child task

Each child task takes three calls in the main thread:

1. `omt brief <role> ... --plan <slug> --unit <id> --save --json` renders the brief and saves it.
2. The T3 tool `delegate_task` starts the child with the payload from step 1, unchanged.
3. When the result is in and `task_status` shows the child ended, the main thread settles the child, so that T3 releases it at once. In a linked worktree, it settles no child.

T3 tracks each child task, so omt keeps no record of them.

When the next step needs the result, the main thread starts the child in wait mode. Otherwise it follows the `next` field of the T3 result: it ends its turn, and T3 wakes the thread when the child ends. It does not poll.

When T3 refuses a target, for example with `provider_unavailable`, the main thread runs the same `omt brief` command with `--fallback`, the next `--attempt`, and one `--tried <targetKey>` for each target that failed. The CLI picks the next target that is not in that list. A cross-family review passes `--strict`, so the run stops when no reviewer from the other family is left, instead of a review by the same family.

In T3 plan mode, the main thread writes nothing: it leaves out `--save`.

## Plan and design

- `omt-plan` plans only. The main thread reads the code, asks question batches until no question is open, and writes the plan with its summary last. One `plan-review` task from the other model family reviews it. The main thread fixes the blockers, and one more review checks only those blockers: at most 2 rounds. The reply shows the plan summary. For a vague goal, it offers a [stress test](#stress-test-a-goal-before-you-plan) first.
- `omt-design` draws the variants of each screen with the tool that `workflow.design.tool` names. `paper`, the default, draws in a new Paper file when Paper's tools load, and in HTML mockups otherwise. `html` draws HTML mockups only. When the first model of the `design` role is the main thread's model, the main thread draws the variants itself. Otherwise one routed `design` task draws them, with the configured fallbacks. Both use Anthropic's `frontend-design` skill when available. You pick one variant per screen and steer until you approve. Then the main thread writes `docs/design/<slug>.md`, and on request it builds the screens with the build steps 7 to 12.

## Run the review and QA steps as T3 workflows

You can run the fixed steps of a build or a review as [T3 workflows](https://github.com/pingdotgg/t3code/blob/main/docs/user/workflows.md) instead of child tasks. Both paths stay: without the switch, omt runs every step in the thread as above.

1. Turn on **Settings → Labs → Workflows** in T3.
2. Run `omt install` or `omt update`. A user install copies `omt.ts` into the T3 workflows folder (`T3CODE_WORKFLOWS`, or `~/.t3/workflows`). `omt doctor` shows the file and whether Workflows is on.
3. Turn on the profile switch in `.omt3/config.jsonc` (or the user config):

```jsonc
{ "profiles": { "normal": { "t3Workflow": true } } }
```

Every profile extends `normal`, so this line turns it on for `prototype` and your own profiles too.

With the switch on:

- `omt-ulw` commits the build, then starts the workflow `omt-ulw` for steps 8 to 11. The reviewer from the other family works in its own worktree from the build commit and commits its fixes there. QA runs every check on that commit. When a check fails, the reviewer fixes it, and QA runs the failed checks again, at most 2 times.
- `omt-code-review` starts the workflow `omt-code-review` for its 1 to 4 reviewers, in parallel, and the oracle. The reviewers report only. With `review.fixLoop: offer`, the workflow asks you on the Workflows page whether the main thread fixes the findings. On T3 `v0.1.13-nightly.20261125.5258` or later, both `fix` and `report only` ask for a reason. The main thread gets your reason.
- The models come from omt's roles, with the same fallbacks and the same cross-family rule.
- On T3 `v0.1.13-nightly.20261125.5258` or later, the QA agents of all `omt-ulw` runs share one place in the pool `omt-qa` on the server. Runs that wait for the place show as **Queued**. A paused or cancelled run gives up its place while its agent finishes stopping.
- Each run ends by sending a message to the thread that started it. The thread then merges the fixes with a fast-forward, applies its own judgment to the findings, and opens the draft PR, because a workflow cannot open one.

When Workflows is off, or `t3 workflow start` fails, the skill prints one line and runs the steps in the thread. Follow each run on the T3 Workflows page, or with `t3 workflow show <run>`.

### Find a run by its skill, thread, or PR

On T3 `v0.1.13-nightly.20261125.5258` or later, each run has a tag with its skill (`ulw`, `code-review`, or `climb`) and a subject. The subject is the thread that started the run. An `omt-code-review` run uses the linked PR when T3 reports a single PR for that thread. The Workflows page shows the subject under the run and opens it beside the run. Use these commands to find runs by tag or subject.

```sh
t3 workflow list --tag code-review
t3 workflow list --subject <PR URL or thread id>
```

### Read a run on the Workflows page

Open the page with **Open workflows** in the T3 command palette, then click a run. The run page has three parts:

1. The header shows the run title, such as `Code review of pr-54, round 1`, and the subject chip, such as `#54`. The chip opens the PR or the thread beside the run.
2. The list on the left shows the steps in the order that they ran. Each name says what the step did:
   - `Pick the ... model` asks omt for the agent's brief and models. Its value is the path of the brief file and the models, in the order that the run tries them.
   - An agent step, such as `Review the change (the oracle)` or `Run the checks, QA run 1`, runs one model in its own thread.
   - A step that starts with `Ask:` waits for you.
   - `Tell the thread that started the run` sends the summary to your thread.
3. The pane on the right shows the step that you clicked. An agent step shows the agent's summary and its result fields, and **Transcript** opens the agent's whole thread. Another step shows its `outcome` and `value` as T3 stores them.

To answer a question:

1. Read the text under the question title. It lists what the run found, such as each review finding or the climb scores, and says what each answer does.
2. To check the change first, open the thread or the PR with the link buttons.
3. If your answer requires a reason, click **Add a reason** and write one sentence. The agent or thread that acts on your answer gets the reason.
4. Click an answer. The run goes on.

A question that gets no answer in 2 days counts as `report only` in a code review and as `stop` in a climb.

On T3 `v0.1.12`, a run has no tag and no subject, a question shows only plain answers, and QA starts with no pool.

## Climb to a target score

`omt-climb` turns a goal into a score and repeats change, check, and score until every judge meets a target. Start it by name. Use it when a check gives a number but no pass: an eval with a pass count, a benchmark, a bundle size, or the look of a UI.

It needs T3 Workflows (**Settings → Labs → Workflows**), and it ignores the `t3Workflow` switch. Without Workflows, it stops with one line that says how to turn it on. It has no steps that run in the thread. `omt doctor` reports whether Workflows is on.

1. The main thread asks you for the scorer, the target, the judges and their tiers, the gates (such as the test suite), and the round limit. Then it commits and starts the workflow `omt-climb`.
2. A judge is a command that prints a number, or a `judge` agent that scores screenshots or outputs from 0 to 10 in each category. Agents see only letter labels, such as `A` and `B`, and never the target, the round, or earlier scores. The baseline (the start commit) and any competitor screenshots are scored in every round, and a judge's baseline score corrects its drift.
3. Tier 1, the least expensive judge, scores each round. A higher tier, such as Opus, scores only after the lower tiers meet the target.
4. Below the target, one agent thread applies the judges' findings, runs the gates, and commits in its own worktree. The next round scores its commit.
5. The run ends at the target. If the score improves too little or the run reaches the round limit, you can stop, raise the limit, or change the approach. On T3 `v0.1.13-nightly.20261125.5258` or later, give a reason to raise the limit or change the approach. The change agent gets your reason.
6. The last step sends the climb table to the thread. The thread merges the commits with a fast-forward and opens the draft PR.

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
6. It offers a fix loop. After your yes, the main thread makes the fixes, commits each one, and pushes them to the PR branch by [your git rules](#commit-push-and-open-a-pr).

A review starts at most 4 reviewers and 1 oracle. Reviews after a fix read the working tree. The skill posts no GitHub comment and no GitHub review. The same skill, without a PR number, reviews uncommitted changes, a branch, or a commit.

### Turn on the PR extras

Five PR extras are off in both presets, `normal` and `prototype`. Turn on the ones you want with `workflow.review` in a profile ([Write a custom profile](configuration.md#write-a-custom-profile)):

| Key | Value that turns it on | What it adds |
| --- | --- | --- |
| `review.ci` | `check` or `fix` | Reads the CI checks and saves the failure logs. `fix` also fixes each failing check, and one review task checks the fixes. For pending checks, it uses the T3 PR watch. |
| `review.crap` | `report` | Runs the coverage command once and reports CRAP for the changed functions. CRAP combines complexity and test coverage. A value above 30 is a P2 finding. |
| `review.verify` | `changed-flows` | One qa task runs the changed screens, CLI commands, and API routes, and names the tests that cover them. A flow that fails is a P1 finding. |
| `review.tests` | `offer` | Offers one e2e test for each verified flow that no test covers. After your yes, the main thread writes the tests and a qa task runs them. |

The [spec](spec.md#154-pull-request-review) lists the steps and the extras.

## Commit, push, and open a PR

The skills follow the git rules in your message and your `AGENTS.md` or `CLAUDE.md`:

1. Before the first edit, `omt git start` records the files that were already changed.
2. `omt git commit` commits only the files that the run changed. A file that you changed before the run stays out of the commit.
3. `git push -u origin HEAD` pushes the branch, and T3's `pull_request_create` tool opens a draft PR, or returns the branch's open PR. To get a PR that is ready for review, ask for one in your message or in your `AGENTS.md`.

Before a run, the skills sync the branch: they fetch and merge the default branch in. `omt-ulw` makes one commit for the run after QA passes, then opens the PR. `omt-code-review` commits each approved fix and pushes it to the PR branch. For a PR by another author, it asks you first.

Unless your rules say otherwise, a commit or push on the default branch, a push to a repo that is not yours, and each merge ask you first. A force push always asks you first.

## Stress-test a goal before you plan

`omt-plan` offers a stress test when your goal has no done condition that can fail, or when 4 or more of your decisions are open. You can also ask for one. The main thread does it itself, from the code and your request. It lists the edge cases, each with an id such as `GE1`, its trigger, its effect, a proposed handling, and a test layer. It also lists the options for the direction of the work, each with its gain and its cost, and the open questions. You accept, change, or drop each edge case by its id. An accepted or changed edge case becomes an integration or unit test in the plan, or a done condition of the unit that handles it.

The stress test replaces the `omt-grill` skill and its `grill` role, which are retired.

## Add tests only from the plan

Workers add no tests on their own. The plan lists each proposed test under `## Tests`, with its flow, its file, and the reason for it. You approve these lines when you approve the plan. An empty list means no new tests.

The main thread writes only the approved tests while it builds. In the `normal` profile, it also proves that each new test can fail, in a private copy of the working tree. Then one qa task runs every verify command, the final checks, and the device flows. qa edits nothing and writes no tests.

## Share builds between parallel workers

Parallel workers, such as an `execute` task that builds a large unit beside the main thread, share one checkout and edit different files. The planner names each shared resource, such as a build folder, a simulator, or a dev-server port, and the units that use one run one at a time. Work that must run in parallel on shared state runs as a T3 workflow, whose agents each have their own worktree. `omt lock` was removed.
