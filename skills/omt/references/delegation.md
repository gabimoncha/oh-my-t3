# Delegation in T3

The T3 rules for every omt skill. Skills name T3 tools by base name, such as `delegate_task`. Your harness may add a prefix, such as `mcp__t3-code__delegate_task`: call the tool under the name your tool list shows.

## User instructions win

On git actions, reply style, tests, and model choice, the user's own instructions win over omt defaults. Their message comes first, then their `AGENTS.md` or `CLAUDE.md`. omt owns the workflow steps.

## The CLI

Use the first one that exists: `omt` on `PATH`, `.omt/bin/omt` in the project root, or, in a linked worktree, `"$(git rev-parse --path-format=absolute --git-common-dir)/../.omt/bin/omt"`. When none exists, follow the [agent quick start](https://github.com/gabimoncha/oh-my-t3/blob/main/docs/agents/quickstart.md) and stop. `omt help <command>` prints the flags of each command.

## What a child is

- A child gets only its task text, so the brief is its full context ([brief.md](brief.md)).
- A child works in your checkout. Run editing children in parallel only when their scopes are disjoint.
- A child may keep or narrow your modes, never widen them. From a `plan` thread you can dispatch only children in `plan` interaction mode.
- Children never commit, push, or create branches.

## Your interaction mode

Each skill that dispatches work checks its modes first. It calls `t3_thread_configure` with no arguments. It returns this thread's `modelSelection`, `runtimeMode`, and `interactionMode`. With `modelSelection`, the same tool sets the thread's model. Pass no `threadId` and no `modelSelection`, so that the call only reads. Keep the driver of `modelSelection`, such as `claudeAgent` or `codex`, as your family. On ACP providers whose T3 tools are missing, call it with:

```sh
ELECTRON_RUN_AS_NODE=1 "$T3_ACP_MCP_NODE" ${T3_ACP_MCP_ENTRYPOINT:+"$T3_ACP_MCP_ENTRYPOINT"} acp-mcp-call t3_thread_configure '{}'
```

Do not call `orchestrator_capabilities` to read your modes.

In `plan` interaction mode you are read-only. Write no files: no `omt init`, no plan file, no `--save`, no `omt ledger done`, no evidence, and no git action. Dispatch only children in `plan` mode: the read-only roles, and `review` or `oracle` with `interactionMode: "plan"` set in `delegateTask`. Keep at most `limits.maxParallel` children at once yourself. Deliver the result in your final message. When the work needs files, ask the user to switch the thread to default mode.

## Branch check

Run `omt git behind --ff` (in `plan` mode, `omt git behind`). `ask:` means the branch is behind and the tree is not clean: report the count and ask the user how to go on.

## Worktree setup

On the first run in a project, or when `omt init` prints a `WARN` worktree line, follow [worktrees.md](worktrees.md).

## Dispatching a child

1. Build the payload: `omt brief <role> --task-file - --title "<role> <unit>: <title>" --plan <slug> --unit <id> --save --json`, plus `--scope`, `--done`, `--verify`, `--context-file`, `--round`, `--prior-file`, and `--against <family>` as the step needs. Before a plan file exists, pass the run's `--profile <name>`. The command checks the parallel limit and records the start. Exit 75 means the limit is reached: wait for a child to end, then run it again.
2. Call `delegate_task` with `delegateTask` unchanged.
3. When the result is in, run the printed `ledger.done` command with the first word of the result block as `--verdict`, and add `--status failed` when the run failed or gave no block.
4. When `ledger done` prints `settle: allowed`, settle the child ([Releasing children](#releasing-children)).

In `plan` mode, leave out `--save`: nothing is recorded, and step 3 does not apply.

A cross-family review passes `--against <your family> --strict`. The command then exits 1 when only your own family is left. Stop and tell the user that no reviewer from the other family can run.

## Waiting

Use `mode: "wait"` when your next step needs the result. Otherwise dispatch with `mode: "async"` and follow the `next` field of the T3 result: T3 wakes this thread when a child ends, and the wake names the task. Read each result with `task_status`. A wake about a task that you already read needs no action. Do not poll, sleep, or watch.

## Failure codes

| Code | Action |
| --- | --- |
| `provider_unavailable`, `model_unavailable`, `invalid_request` about `target.options` | Run the same `omt brief` command with `--fallback` (in `plan` mode: `--fallback --tried <targetKey> --attempt <n+1>`), then call `delegate_task` with the new payload. When it exits 1, tell the user which targets failed. |
| other `invalid_request` | Fix the arguments once. If it fails again, report it. |
| `runtime_mode_escalation_denied`, `interaction_mode_escalation_denied`, `capability_denied` | Stop, and report the role and the modes. |
| `parent_not_active` | Make the call in your next active turn. |
| `task_not_found`, `thread_not_found`, `run_not_found` | Look for the child with `t3_thread_list` and `includeSubagents: true`. Correct the id, or dispatch again with `--fallback`. |
| `orchestration_error` | Look for the child as above, then call `delegate_task` once more with the same payload. |

A failed child run, with a provider error in `summary`, is a failed attempt: run `omt ledger done <id> --status failed`, then dispatch again with `--fallback`. After a lost response, look for the child with `t3_thread_list` before you send the payload again.

When `summary` is `Child task completed without an assistant result.`, read the child with `t3_thread_read`, view `messages`.

## Releasing children

A finished child stays loaded until T3 releases it after 30 idle minutes. Settle each child when you are done with it:

- Settle a child when `omt ledger done` prints `settle: allowed`, and `task_status` shows a terminal status, `hasPendingChildRuns: false`, and `hasPendingQuestion: false`. In `plan` mode, `omt ledger settle-check` prints the same line.
- Call `t3_thread_organize` with `action: "settle"` and the child's `childThreadId`, never the `taskId`. A settle error never stops the run.
- Never settle your own thread, a top-level thread, or a thread that another run started.
- When `limits.maxDepth` is above 1, children settle their own children. Before the report, settle each finished thread below a failed or cancelled child, found with `t3_thread_list` and `includeSubagents: true`.

## Git actions

The `workflow.git` policy is the owner's standing approval for each action that it marks `auto`. The CLI applies it, finds the user's GitHub login, and checks who owns the repo and its open PRs.

- Before the first edit of a run, run `omt git start --plan <slug>` (or `--run <id>` with no plan file). It records the files that were already changed, so that a commit takes only the run's own files.
- Commit with `omt git commit -m "<message>" --plan <slug>`. Add `--path <path>` for each path when one commit holds only part of the run. Follow the commit conventions of the repo's `AGENTS.md` and its `git log`.
- Push and open or update the PR with `omt git pr --title "<title>" --body-file <file> --plan <slug>`. It opens a draft PR. Pass `--ready` only when the user's message or their `AGENTS.md` asks for one that is ready for review.
- Before a plan file exists, pass `--run <id>` and the run's `--profile <name>`.

Each command prints one first word:

- `committed`, `created`, or `updated`: done. Report the hash or the URL.
- `ask: <reason>`: ask the owner and wait. After the owner's yes in this run, run the same command with `--yes`. A rule in the user's own instruction file counts as a yes only when the reason starts with `workflow.git.`, which marks a policy decision; never for an ownership reason. `--yes` never covers a path problem; for a path that had changes before the run, the owner's yes means `--include <path>`.
- `off: <reason>`: the policy turns the action off. Do not act, and say so in the report.
- `split: <reason>`: the PR has more files than `maxPrFiles`. Cut the branch into slices between existing commits, with code and tests low and docs on top. Run the tests at each cut. Then run `omt git stack <sha>,<sha>...` with the last commit of each lower slice, bottom first, and the same flags as `omt git pr`.

A force push always asks the owner. After a yes for it in this run, pass `--force-with-lease` to `omt git pr`.

## Pull requests

When you create a PR, link it with `link_pull_request`, call `watch_pull_request`, and end the turn. On each wake, read the checks with `gh pr checks <number>`. When a check fails, find the cause in its log, fix it, and push the fix with `omt git pr`. When every check passed or was skipped, call `unwatch_pull_request` and tell the user.

## Verification and devices

Only `qa` drives a device, a Simulator UI, a browser, or a computer. Other roles list each device check, with its steps and expected result, for the main thread to send to `qa`. When `qa` returns `INCONCLUSIVE` because it cannot reach a local tool, send the same task once with `--fallback`, unless the cause is a busy lock.

## Shared builds

Keep parallel edit scopes disjoint. Run each command that uses shared build state as `omt lock run <name> -- <command>`, with one lock name per shared resource. A command that leaves processes running after it exits, such as a dev server or a watcher, stays outside the lock, and the units that use it run one at a time (`omt plan limit <slug> 1`). Without `flock` or `lockf` on `PATH`, keep those units serial too.

When `omt lock run` exits 75, run `omt lock list`. When an active child of this run holds the lock, wait for it to end, then run the command again. Never take over or clear a held lock. After a second busy lock for the same check, ask the owner. A failure in a file outside the run's scope, while an independent child of this run is active, can be that child's half-done work: wait for the child, then run the check once more.

## Top-level threads

`delegate_task` makes children. Only when the user asks for separate threads, use `t3_thread_launch` (one thread with its own `workspaceStrategy`) or `create_threads` (up to 20 threads in your checkout). `omt-swarm` is that request.
