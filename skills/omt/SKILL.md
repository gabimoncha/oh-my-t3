---
name: omt
description: oh-my-t3code router. Lists the omt workflows for T3 Code, when to use each, the omt CLI commands, and the shared references.
disable-model-invocation: true
---

# oh-my-t3

omt runs workflows in this T3 thread: the main thread explores, plans, and builds, and role-routed subagents started with the T3 `delegate_task` tool review and test the work. Pick the workflow that matches the request, then load that skill.

On git actions, reply style, tests, and model choice, the user's own instructions win over omt defaults. Their message comes first, then their `AGENTS.md` or `CLAUDE.md`. omt owns the workflow steps ([User instructions win](references/delegation.md#user-instructions-win)).

## Workflows

| Skill | Use it when |
| --- | --- |
| `omt-ulw` | The user wants something built or fixed end to end ("ulw", "ultrawork"). The main thread explores, asks, plans, and builds; one review child and one QA child check the work. The default. |
| `omt-plan` | The user wants a reviewed plan before any code changes, or `omt-ulw` needs one for a HEAVY task. |
| `omt-grill` | The user wants a goal grilled or stress-tested, its edge cases found, or a brainstorm before a plan, or `omt-plan` offers a grill for a vague goal. |
| `omt-design` | The user wants designs, mockups, screens, or a design pass, or asked for a design pass before a plan's UI units. |
| `omt-code-review` | The user wants a review of uncommitted changes, a branch, a commit, or a PR. |
| `omt-research` | The user wants a cited answer from this repository, docs, or the web, with no code changes. |
| `omt-swarm` | The user asks for separate threads: a plan built as parallel tracks in their own worktrees, then reviewed, merged, tested, and shipped as one PR. |
| `omt-help` | The user asks for help, what omt can do, what to do next, how to do something, which skill to use, or what a command means, or wants a tour. It only reads, and hands changes to `omt-setup`. |
| `omt-setup` | The user wants omt set up, configured, or updated: harnesses, the defaults, models, roles, profiles, or worktree setup. It asks before each write. |

For a pull request review, load `omt-code-review` with `omt-code-review <number>`. The `normal` profile runs all PR steps. The `prototype` profile turns them off.

Before each commit, push, PR, or merge, a skill runs `omt git check` and follows the [Git actions](references/delegation.md#git-actions) rules.

Each skill name works as a composer mention: `$omt-ulw` becomes `/omt-ulw` in Claude and Cursor, `/skill:omt-ulw` in Pi, and stays `$omt-ulw` in Codex.

## CLI cheat sheet

To find the CLI (`omt`, `.omt/bin/omt`, or the manual steps), follow [The CLI](references/delegation.md#the-cli).

| Command | Prints |
| --- | --- |
| `omt init` | creates `.omt/config.jsonc`, `.omt/plans/`, `.omt/.gitignore`; adds missing `.gitignore` lines; prints the worktree setup state |
| `omt worktree check` | the current checkout's package manager, linker, `t3.json` setup script, and T3 activation note ([worktrees.md](references/worktrees.md)) |
| `omt worktree setup [--dry-run] [--yes]` | writes a missing `t3.json`, `.t3/omt-worktree-setup.mjs`, and for pnpm `pnpm-workspace.yaml`, for Bun or pnpm; never rewrites a file |
| `omt roles` | every role with its target, access, and mode |
| `omt route <role> [--against <provider\|driver\|auto>]` | `delegateTask` and `fallbacks` for one role, as JSON; `--against` names the worker that a cross-family role reviews ([roles.md](references/roles.md#cross-family-roles)) |
| `omt brief <role> --task-file - --title "<role> <unit>: <title>" --scope <p> --done <c> --verify <cmd> --plan <slug> --unit <id> --round <n> --attempt <n> [--against <provider\|driver\|auto>] --save --json` | `{ delegateTask, fallbacks, ledger }`; the full brief is in a file and `delegateTask.task` names it |
| `omt profile list` | available workflow profiles |
| `omt profile show [<name>] [--plan <slug>] --json` | the effective `profile`, `source`, `workflow`, `limits`, `roles`, and `models` |
| `omt plan new <slug> [--light] [--profile <name>]` | path of a new plan file under `.omt/plans/`; `--light` leaves out the `F2` oracle item |
| `omt plan profile <slug> <name\|none>` | switches the plan's profile; `none` removes the plan override |
| `omt plan mark <slug> <id> <done\|open\|blocked>` | ticks one plan item, for example `omt plan mark auth U3 done` |
| `omt plan status [<slug>]` | unit counts, the next open unit, the ready units, and a `warning:` line for each dependency that names no unit or names its own unit. It also prints one warning for the first dependency cycle only. |
| `omt ledger add --plan <slug> --unit <id> --role <r> --round <n> --attempt <n> --status <s> ...` | appends one ledger entry; a terminal entry closes the matching dispatched entry ([results.md](references/results.md#recording)) |
| `omt ledger stats --plan <slug>` | `dispatched` and `active` counts, `max parallel`, and `can dispatch: yes` or `no` |
| `omt ledger request-id --plan <slug> --unit <id> --role <r> --round <n> --attempt <n>` | the `clientRequestId` |
| `omt config show` | the merged config before profile selection, including limits |
| `omt config explain [--profile <name>] [--json]` | the layer that sets each value (the defaults, the user or project config, or a profile and the file that declares it) and the lower layers that it overrides |
| `omt detect [--capabilities <file>] [--json] [--write] [--user\|--project] [--dry-run] [--yes]` | one line per driver (`claudeAgent`, `codex`) with its T3 status and executable, then the recommended `harnesses` value and its effect; `--write` adds, changes, or removes the `harnesses` key |
| `omt update [--check] [--dry-run] [--yes] [--skills-only] [--project] [--json]` | updates the CLI with the command of its channel, then syncs the skills in user scope and in each recorded project; keeps an edited skill and prints `kept <skill>  (<reason>)`; `--check` writes nothing; shows defaults changes and asks before accepting them; `--yes` also accepts current defaults |
| `omt lock run <name> [--wait <seconds>] -- <command>` | runs a command under a shared build lock and returns its exit code |
| `omt lock list` | each lock's state and the holder of a held lock |

Pass `delegateTask` to `delegate_task` unchanged. Record the dispatch with the printed `ledger.dispatched` line after replacing `<taskId>`. Use [delegation.md](references/delegation.md#getting-the-arguments) for retries and plan-mode dispatch.

## Shared references

- [delegation.md](references/delegation.md): the T3 rules. `delegate_task` fields, request ids, limits, waiting, `task_status`, releasing children, failure codes, top-level threads.
- [roles.md](references/roles.md): the default roles, when to pick each, manual resolution, effort options, fallback, custom roles.
- [brief.md](references/brief.md): the brief layout, how to write the task text, and a full example.
- [results.md](references/results.md): how to read each result block and verify a claim.
- [frontend-design.md](references/frontend-design.md): when design and UI work load Anthropic's optional `frontend-design` skill, and how setup recommends it.
- [worktrees.md](references/worktrees.md): the T3 worktree setup script. Check it on the first run in a project, keep a compatible setup, and activate a new one only from the base branch.
- `references/roles/<role>.md`: one persona per role, for example [execute.md](references/roles/execute.md).
- `references/results/<kind>.md`: one result contract per kind, for example [work.md](references/results/work.md).
