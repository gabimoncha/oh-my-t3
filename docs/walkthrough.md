# Walkthrough: two real runs

This page shows two runs of omt on this repository. All facts come from three sources: the plan file, the ledger, and `git log`. Times are in UTC.

Both runs are from before default set `2026-12` and the [workflow fold](design/workflow-fold.md). At that time the conductor thread edited no product files: it sent each unit to child tasks for execute, review, verify, and test work, and a task budget capped each run. Today the main thread builds the units itself, one review task and one qa task check the work, and a run has no task budget. The `verify`, `quick`, and `deep` roles that these runs used are retired. The old output below still shows the `max tasks` lines that the CLI printed then.

| Run | Units | Dispatched tasks | Time | Result |
| --- | --- | --- | --- | --- |
| [`code-health`](#run-1-code-health) | 4 | 29 | 2 hours 20 minutes on 2026-10-16 | Commit `58a85b0`: 353 fewer lines, no change in behavior |
| [`workflow-profiles`](#run-2-workflow-profiles) | 10 | 128 | 5 days of work from 2026-10-09 to 2026-10-17 | Commits `3a44354`, `6ccb731`, `b2092fc`, `a9ca54a` |

The plan files and the ledger are in `.omt3/`, which git ignores. So the excerpts below are trimmed copies. To see the same data for your own runs, use these commands:

```sh
omt plan status <slug>
omt ledger stats --plan <slug>
omt ledger list --plan <slug> --json
```

## Run 1: code-health

### The goal

The next plan, `workflow-profiles`, was going to add commands, config keys, and tests. The code repeated small patterns by hand, such as config loading, argument checks, and test setup. The goal of `code-health` was to replace each repeated pattern with one shared helper, and to change no behavior. The plan's objective says it in one sentence:

> It changes no behavior: a user of omt sees the same output, errors, exit codes, and files as with commit 2b4ce46.

The proof had two parts: the test suite (520 tests) and a golden check. The golden check runs 161 steps with a frozen copy of omt and again with the new code, and requires the same output, exit codes, and written files.

### The plan

The plan has 4 units. Each unit depends on the one before it, because each unit runs the whole test suite and the golden check, and a parallel unit's half-done edits would fail both.

| Unit | Title | Depends on |
| --- | --- | --- |
| U1 | Shared helpers for the commands | none |
| U2 | Install code | U1 |
| U3 | Visual code | U2 |
| U4 | Test helpers | U3 |

The plan header sets `max-tasks=40` and `max-parallel=2`. The planner expected 25 to 30 tasks. Two parallel tasks let the two reviewers of one round run at the same time.

This is the Units tab of the plan page from before the run, so every unit shows as open. It shows the 4 units and their dependencies as a flowchart and as a table. omt drew such pages at the time of this run. It no longer does, and `omt-plan` now writes the plan summary in its reply.

![The Units tab of the code-health plan page: a flowchart of U1 to U4, each unit depending on the one before it, and a table of the units with their dependencies](assets/walkthrough-plan.png)

### What ran

The conductor dispatched 29 child tasks:

| Role | Tasks | Model |
| --- | --- | --- |
| plan-review | 4 | Opus and Astra |
| execute | 6 | Sol |
| review | 12 | Astra and Opus, two per round |
| test | 5 | Sol |
| oracle | 2 | Opus |

The owner picked the models for this run. The workers ran on Codex and the oracle ran on Claude, so the oracle came from the other model family. Each review round had one reviewer from each family.

Timeline. A row with two times runs from the first dispatch to the last result.

| Time | Event |
| --- | --- |
| 13:35 | Plan created. |
| 13:43 to 13:54 | Plan review round 1: Astra returns `REQUEST_CHANGES` at 13:46, and Opus returns `REQUEST_CHANGES` at 13:54. The conductor freezes a list of 7 blockers and fixes the plan. |
| 13:59 to 14:01 | Plan review round 2 (Astra): `REQUEST_CHANGES`. One blocker is still open. |
| 14:02 to 14:03 | Plan review round 3 (Astra): `APPROVE`. |
| 14:16 | The owner approves the plan and the 40-task budget. |
| 14:17 to 14:29 | U1: worker, two reviewers (`APPROVE`, `APPROVE`), test `VERIFIED` with 520 of 520 tests and no golden difference. |
| 14:29 to 14:41 | U2: the same steps. Test `VERIFIED` with 521 tests. |
| 14:41 to 14:50 | U3: the same steps. Test `VERIFIED`. |
| 14:51 to 15:15 | U4, rounds 1 and 2. Round 1: Astra `REQUEST_CHANGES` (one P2), Opus `APPROVE` (one P3 kept). A fix task takes both. Round 2: both `APPROVE`. |
| 15:16 to 15:51 | Oracle round 1 (Opus) on the whole change: `REQUEST_CHANGES`. It compared about 230 edge inputs with the frozen copy and found no behavior change. One P3: a test helper made one install assertion weaker. The conductor reopens U4. |
| 15:52 to 16:00 | U4, round 3: fix, two reviewers (`APPROVE`, `APPROVE`), test `VERIFIED`. |
| 16:01 to 16:02 | Oracle round 2 (Opus): `APPROVE`. |

The first ledger entry is at 13:43:06 and the last is at 16:02:51. The run took 2 hours 20 minutes.

The U4 round 2 test is worth a look. The test task returned `NOT VERIFIED` on one check. The plan Log records that the check itself was wrong. It made `omt init` exit 1, but the project tests never run `omt init`. The conductor ran the proof again in a private copy and made `install` exit 1. Then 61 of 71 project tests failed, so the conductor marked U4 verified.

### What the ledger holds

Each child task gets a `dispatched` entry and a terminal entry, such as `completed` or `verified`. In these runs the conductor wrote both with `omt ledger add`. Today `omt brief --save --json` writes the `dispatched` entry, and `omt ledger done` writes the terminal entry. Here are two entries from `omt ledger list --plan code-health --json`, with the `taskId`, `clientRequestId`, `provider`, and `model` fields cut:

```json
{
  "ts": "2026-10-16T15:03:43.073Z",
  "role": "review",
  "status": "completed",
  "plan": "code-health",
  "unit": "U4.codex",
  "round": 1,
  "attempt": 1,
  "verdict": "REQUEST_CHANGES",
  "note": "P2: contentTree {} drops a __proto__ entry; e2e tree check weaker"
}
{
  "ts": "2026-10-16T16:02:51.368Z",
  "role": "oracle",
  "status": "completed",
  "plan": "code-health",
  "unit": "F5",
  "round": 2,
  "attempt": 1,
  "verdict": "APPROVE",
  "note": "round 1 P3 fixed, no regression, 25 more edge inputs match"
}
```

The counts at the end of the run:

```text
$ omt plan status code-health
plan: code-health (.omt3/plans/code-health.md)
profile: normal
units: 4/4 done, 0 blocked, 0 open
done-when: 5/5
final: 5/5
max parallel: 2
max tasks: 40
next: none
ready: none

$ omt ledger stats --plan code-health
plan: code-health
profile: normal
dispatched: 29
active: 0
terminal: 34
max parallel: 2 (plan 2, config 6)
max tasks per run: 40 (plan 40, config 24)
can dispatch: yes
```

`terminal` is larger than `dispatched` because a test task has two terminal entries: the task's own `completed` entry and the conductor's `verified` entry.

### What landed

Commit `58a85b0`, "refactor: share command, install, visual, and test helpers", changed 70 files (1478 insertions, 1828 deletions). The TypeScript files in `src` and `test` went from 17,897 lines to 17,544, which is 353 fewer. All 521 tests pass, and the golden check found no difference in output or written files.

## Run 2: workflow-profiles

This run is larger. It added workflow profiles (`normal`, `prototype`, and `pr-review`; a later release folded `pr-review` into `normal`), `omt lock`, the `verify`, `qa`, and `guardrail` roles, and `maxParallel` 6. The `code-health` run was its first step: the plan's Log records the hand-off from `code-health`, and the run started after commit `58a85b0`.

The plan has 10 units in 6 dependency layers. U9 (spec, design, and README) depends on all other units. U4 (brief and routing) took the most work: 30 tasks over 9 rounds, because the oracle reopened it twice.

The work spread over five days. The plan file and the ledger held the state between them.

| Date | Dispatched | Work |
| --- | --- | --- |
| 2026-10-09 | 4 | Plan created. 3 explore tasks and 1 research task. |
| 2026-10-14 | 5 | Plan review rounds 1 to 4. |
| 2026-10-15 | 3 | Plan review rounds 5 to 7. Round 7 (Astra): `APPROVE`. |
| 2026-10-16 | 103 | The run starts at 20:03, after commit `58a85b0`. |
| 2026-10-17 | 13 | Oracle round 3 (Opus): `APPROVE` at 01:17. |

The build lock was the main blocker of plan review. Round 1 found a race when a waiter takes over a stale lock. Rounds 2, 3, and 4 each found at least one new case of that race. Round 4 also found two defects in the PR review steps. After round 4, the owner ruled that omt never takes over a lock. Round 5 still found four P1 defects in the lock, so the planner moved to a kernel `flock(2)` lock. Round 6 found two gaps in that lock, and the planner fixed them. Round 7 approved.

The run itself took about 5 hours 14 minutes, from 20:03 on 2026-10-16 to 01:17 on 2026-10-17. It dispatched 116 of the 128 tasks. The oracle needed three rounds: `REQUEST_CHANGES`, `REQUEST_CHANGES`, then `APPROVE`.

Tasks by role: 66 review, 17 execute, 17 writing, 12 test, 8 plan-review, 3 explore, 3 oracle, 1 research, and 1 quick.

### The budget grew during the run

The plan began with a budget of 60 tasks. Before the run, the owner raised it to 70 for U10 and plan review round 4. At 22:01 on 2026-10-16 the run stopped at that limit, with U1 to U6 done. The owner raised the limit with `omt plan limit workflow-profiles --tasks 90`. That flag now fails, because set `2026-12` removed the task budget. Later fix and review rounds needed more room, so the limit went to 100, 110, 120, and at last 130. The plan header now reads `max-tasks=130`.

```text
$ omt plan status workflow-profiles
plan: workflow-profiles (.omt3/plans/workflow-profiles.md)
profile: normal
units: 10/10 done, 0 blocked, 0 open
done-when: 10/10
final: 3/3
max tasks: 130
next: none
ready: none

$ omt ledger stats --plan workflow-profiles
plan: workflow-profiles
profile: normal
dispatched: 128
active: 0
terminal: 140
max parallel: 6
max tasks per run: 130 (plan 130, config 24)
can dispatch: yes
```

### What landed

Four commits on 2026-10-17:

| Commit | Subject | Files |
| --- | --- | --- |
| `3a44354` | feat: add workflow profiles, omt lock, and the verify, qa, and guardrail roles | 72 |
| `6ccb731` | feat: add profile switches, verify and qa steps, and shared-build rules to omt-ulw | 6 |
| `b2092fc` | feat: read workflow profiles and planned tests in omt-plan and omt-design | 3 |
| `a9ca54a` | feat: add the PR review steps and profile switches to omt-review (since renamed to omt-code-review) | 2 |

## What the data does not show

- Token use and cost. The ledger has no token or cost field.
- The work of the conductor thread itself. The ledger records child tasks and the conductor's verdicts. It does not record the time the conductor spent on writing the plan, reading results, or running its own checks.
- Session boundaries. The ledger has timestamps, not sessions. The days in the table above come from the timestamps.
- Reasoning effort. The ledger records the provider and the model of each task. The effort level is only in the plan Log and in some notes.
- The prompts. Each child got a brief, but this page quotes none of them.
- The time between the end of a run and its commit. The `code-health` oracle approved at 16:02, and commit `58a85b0` is from 20:01. The data does not say what happened in between.
