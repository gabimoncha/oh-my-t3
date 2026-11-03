# Reading results

Every role ends with a fixed result block, the last thing in `task_status.summary`. Read the first word after each label.

| Kind | Roles | Contract | First label |
| --- | --- | --- | --- |
| `work` | execute, writing, ui, design | [results/work.md](results/work.md) | `STATUS: DONE \| BLOCKED \| ESCALATE` |
| `review` | review, oracle, plan-review | [results/review.md](results/review.md) | `VERDICT: APPROVE \| REQUEST_CHANGES \| BLOCK` |
| `test` | qa | [results/test.md](results/test.md) | `VERDICT: VERIFIED \| NOT VERIFIED \| INCONCLUSIVE` |
| `research` | explore, research | [results/research.md](results/research.md) | `ANSWER:` |
| `plan` | a custom role | [results/plan.md](results/plan.md) | `PLAN:` |
| `guardrail` | guardrail | [results/guardrail.md](results/guardrail.md) | `VERDICT: PROPOSALS \| NONE` |

## A claim is not evidence

A worker's `DONE` is a claim until you or a `qa` task check it. For every `DONE`:

1. Check that each path under `CHANGES` changed: `git status --porcelain -- <scope paths>` lists it, and `git diff HEAD -- <scope paths>` shows the edits. Read each new file in full.
2. Check that no file outside the scopes changed: `git status --porcelain -- . ':(exclude).omt3' ':(exclude).omt'`.
3. Run at least one `VERIFY` command yourself, or send it to `qa`.
4. Open the `EVIDENCE` files that it names.

## By kind

- `work`: `DONE` needs the check above. `BLOCKED`: resolve the blocker in `OPEN`, then dispatch again. `ESCALATE`: re-plan the unit, build it yourself, or ask the owner.
- `review`: `APPROVE` passes; `NOTES` are optional. `REQUEST_CHANGES`: fix each P0 to P2 finding. `BLOCK`: a P0 or a wrong approach stops the work for a re-plan. Read the diff of each path under `FIXES` before you act, and undo a fix that you disprove. A finding needs a concrete failure scenario; a CRAP finding gives its complexity, coverage, and CRAP values instead. Drop a finding that the code disproves, and say why in the next `--prior-file`.
- `test`: `VERIFIED`: spot-check one `CHECKS` line against its log. `NOT VERIFIED`: fix each `FAILURES` item, then test again. `INCONCLUSIVE` is not a pass. Read the exit codes and the last lines of each failed log.
- `research`: use `FINDINGS` only with their citations, and open one citation per child. Carry `UNKNOWN` into the answer.
- `guardrail`: skip a proposal that `$(omt paths --omt)/guardrails.md` already holds. Append each new one as `- [ ] G<k> <date> PR #<n> <class>: <proposal>. Where: <file>. Proof: <command or none>.`

## When the block is missing

- `Child task completed without an assistant result.`: read the child with `t3_thread_read`, view `messages`.
- A provider error in `summary`: the run failed ([delegation.md](delegation.md#failure-codes)).
- A message without the block: read the thread with view `activity`, then dispatch again with a sharper stop condition.
