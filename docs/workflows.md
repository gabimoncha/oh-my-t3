# How the omt workflows run

This page describes how omt builds a goal, plans, researches, designs, runs parallel tracks, and reviews a pull request. It also describes when omt commits and opens a PR, how it adds tests, and how parallel workers share builds. To change these steps, see [Configure roles and profiles](configuration.md).

## Build a goal

`omt-ulw` (or the `ulw` keyword) runs the build flow. The main thread, the T3 thread that runs the skill, does the work in one context:

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
12. It commits, pushes, and opens or updates the PR by the [git policy](#commit-push-and-open-a-pr). It reports each done condition with its evidence.

The main thread waits for each task inside its turn. A turn ends only for you: a batch of questions, a plan approval, or the report. No heartbeat wakes the thread. A LIGHT run skips the plan review and your plan approval, but it still has the review task and the qa task. In the `normal` profile, the reviewer checks the fixes again after each round, up to `maxReviewRounds` reviews.

UI work needs no design spec. The agent that builds the UI follows an approved spec when one exists. Without one, it builds from the task requirements and loads Anthropic's `frontend-design` skill when it is installed. Setup recommends that skill when it is missing, and a missing skill does not block the work.

## Plan, research, and design

- `omt-plan` plans only. The main thread reads the code, asks question batches until no question is open, and writes the plan with its summary last. One `plan-review` task from the other model family reviews it. The main thread fixes the blockers, and one more review checks only those blockers: at most 2 rounds. The reply shows the plan summary.
- `omt-research` answers a narrow question in the main thread, with a `path:line` or a URL for each fact. A broad question gets 2 to 4 read-only tasks in parallel, and the main thread checks each claim before it answers.
- `omt-design` draws the variants of each screen in a new Paper file. When the main thread runs Claude Opus, it draws them itself. Otherwise one routed `design` task draws them, with the configured fallbacks. Both use Anthropic's `frontend-design` skill when available. Paper is optional. Without it, the designs are HTML mockups or platform-native previews. You pick one variant per screen and steer until you approve. Then the main thread writes `docs/design/<slug>.md`, and on request it builds the screens with the build steps 7 to 12.

## Build parallel tracks

`omt-swarm` builds one plan as parallel tracks. Start it by name, with a plan from `omt-plan`. It asks no questions and runs no plan review.

1. The main thread splits the plan units into tracks whose files do not overlap. It does not build.
2. Each track is a new top-level thread in its own worktree and branch. The track runs the build steps 7 to 12 for its units, with its own review and qa tasks, and commits with no push.
3. The main thread waits for the tracks inside its turn.
4. One review task from the other model family reviews every track diff before the merge, and fixes local findings on the track branches. The main thread reads those fixes and fixes the reported findings.
5. The main thread merges the track branches. A conflict that needs deep knowledge of one track goes back to that track's thread.
6. One qa task runs every check and device flow on the merged code, with at most 2 re-runs of the failed checks.
7. The main thread opens one PR and reports.

`omt-swarm` needs a thread in `full-access` runtime mode and `default` interaction mode.

## Review a pull request

In a T3 thread, run the skill:

```text
omt-code-review <number>
```

The `normal` profile runs all of these steps. The `prototype` profile turns off steps 3, 4, 7, 8, and 9, the qa task of step 5, and the test offer of step 11. The skill does these steps in order:

1. It reads and links the PR. When a step needs the PR checkout, it saves your branch and checks out the PR. A checkout needs a clean working tree.
2. It reads the project rules. A finding that breaks a written rule cites the file and line of the rule.
3. It reads the CI checks and saves the failure logs. For pending checks, it uses the T3 PR watch. If the PR has no CI checks, it runs the check command of the project.
4. If the project has a coverage command, it runs it once and saves the lcov file for the reviewers.
5. Reviewers read the PR head. A diff under 200 changed lines gets 1 reviewer. A larger diff gets 2 to 4 reviewers, each with one group of files. A qa task runs the changed screens, CLI commands, and API routes, and lists the tests that cover them. Reviewers and qa edit nothing.
6. It merges the findings. When the profile turns the oracle on, an oracle from the other model family checks them over the whole change. For a small diff, the one reviewer is the oracle. A verified flow that fails becomes a P1 finding.
7. The main thread fixes each failing CI check itself, and one review task checks all the fixes. The fixes stay uncommitted.
8. It proposes deterministic checks, rule corrections, or new rules. It saves new proposals in `.omt/guardrails.md`, which git ignores, for separate work.
9. It reports CRAP for the changed functions. CRAP combines complexity and test coverage. A value above 30 becomes a P2 finding. Without coverage data, the calculation uses zero coverage.
10. It reports the findings, the CI fixes, the screenshots, the flows without tests, the proposals, and the command that returns you to your branch.
11. It offers a fix loop and the exact e2e test lines for verified flows without tests. Each offer needs your approval. If the project has no e2e framework, it offers no test. After your yes, the main thread makes the fixes and writes the approved tests, and a qa task runs the new tests. Then it commits the approved changes and pushes them by the [git policy](#commit-push-and-open-a-pr).

A review starts at most 4 reviewers and 1 oracle, and the main thread waits for them inside its turn. The first-round reviewers and the oracle read the saved PR commits. Reviews after a fix read the working tree. The skill posts no GitHub comment and no GitHub review. A custom profile can skip steps with `workflow.review`. The same skill, without a PR number, reviews uncommitted changes, a branch, or a commit. The [spec](spec.md#154-pull-request-review) lists the switches and the rules.

## Commit, push, and open a PR

The git policy in your config decides each commit, push, PR, and merge. Before each one, the skill runs `omt git check <commit|push|pr|merge>` and acts on its answer: on `auto` it acts, on `ask` it asks you first, and on `off` it skips the action and says so.

With the default policy, on a branch that is not the default branch:

- `omt-ulw` makes one commit for the run after QA passes. Then it pushes the branch and opens a ready PR, or the push updates the branch's open PR.
- `omt-code-review` commits the approved fixes and tests and pushes them to the PR branch with no further question. For a PR by another author, it asks you first.

A commit or push on the default branch asks you first. Each merge and each force push also asks you first. Without a git policy, each action asks. To change the policy, set `workflow.git` in a profile ([Write a custom profile](configuration.md#write-a-custom-profile)). The [spec](spec.md#515-omt-git) lists the rules.

## Grill a goal before you plan

Use the `omt-grill` skill when your goal is vague or you do not know its edge cases yet. The main thread reads the code first. Then one task from the other model family reads the goal and the code once, as a second opinion. The models decide the areas that you do not know and give a reason for each decision. You answer the questions in the areas that you know, and you accept or change each edge case, in one reply per batch. The main thread checks each answer against the code and asks the next batch, until no question is open. The skill writes the result to a grill file. `omt-plan` reads that file, asks no settled question again, and turns the accepted and changed edge cases into integration or unit tests.

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
