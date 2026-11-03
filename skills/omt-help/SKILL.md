---
name: omt-help
description: Help and a short tour of omt in T3 Code. Use when the user asks for help, what omt can do, what to do next, how to do something with omt, which skill to use, or what a command means, or asks for a tour. Answers from the output of the omt CLI and links the docs. Changes nothing, and hands off to omt-setup for any change.
---

# Help

You answer questions about omt and give a short tour. You run only read commands and change no files, except the update check of `omt doctor --dry-run` that step 3 names. When the user wants a change made, you hand off to `omt-setup`.

## Steps

### 1. Find the CLI

Follow [The CLI](../omt/references/delegation.md#the-cli). Below, `omt` means the command that you found, such as `.omt/bin/omt`.

When no CLI exists, answer from the [workflow table](../omt/SKILL.md#workflows) and the docs, say that the answer is not checked against an install, and link the [install guide](https://github.com/gabimoncha/oh-my-t3code/blob/main/docs/install.md).

Done when: `omt --version` prints a version, or you told the user that no CLI exists.

### 2. Sort the question

Give the question one kind:

| Kind | Example questions | Ground the answer in |
| --- | --- | --- |
| A workflow skill | "how do I build this with subagents", "which skill reviews a PR" | the [workflow table](../omt/SKILL.md#workflows) of the router |
| A CLI command | "what does `omt brief` do", "explain `omt ledger`" | `omt --help`, then `omt <command> --help` |
| A config change | "how do I make reviews cheaper", "can I use only Codex" | `omt config show`, `omt config explain`, `omt profile list`, `omt profile show <name>`, `omt roles`, `omt detect` |
| The next step | "what do I do next", "is omt set up" | `omt doctor --project --dry-run` |
| A tour | "show me around", "give me a tour" | step 4 |

Done when: the question has one kind, or you asked the user one question to choose between two kinds.

### 3. Answer from the CLI output

Run the commands of the kind before you answer. Each command below writes nothing:

| Command | Tells you |
| --- | --- |
| `omt --help`, `omt <command> --help` | the commands, their flags, and what each does |
| `omt doctor --project --dry-run` | one `PASS`, `INFO`, `WARN`, or `FAIL` line per check of a project install; use `omt doctor --dry-run` for a global install |
| `omt profile list` | the profiles and their descriptions |
| `omt profile show <name>` | the workflow, limits, roles, and models of one profile |
| `omt roles` | the target, access, and mode of each role |
| `omt config show` | the merged config before profile selection |
| `omt config explain [--profile <name>]` | the layer that sets each value: the defaults, the user config, the project config, or a profile, and the lower layers that it overrides |
| `omt detect` | which harnesses (Claude Code, Codex) this machine can run, and the `harnesses` value that omt recommends |
| `omt update --check` | the current and the latest omt version, the install channel, and its update command; it asks the npm registry and writes nothing |

`--dry-run` makes the doctor check read-only. It shows pending defaults changes and skips the daily update check and automatic update.

Run only the commands in this table. A command or flag that writes, such as `--write` or `--yes`, belongs to `omt-setup`. Add `--json` when you need one field, and show the user the text form.

Write the answer:

- The direct answer first, in one to three sentences.
- For a skill, its composer form: `$omt-ulw <task>`. T3 turns `$omt-ulw` into `/omt-ulw` for Claude and Cursor, `/skill:omt-ulw` for Pi, and keeps `$omt-ulw` for Codex.
- For a command, the flags as its `--help` prints them.
- For a doctor line with `WARN` or `FAIL`, the line itself and the fix that it prints.
- For a config change, the key and the file that would change. Then offer `omt-setup` (step 5).
- One link to the doc that covers the topic. The install does not ship `docs/`, so link GitHub, in the form `https://github.com/gabimoncha/oh-my-t3code/blob/main/docs/<file>.md`:

| Topic | Doc file |
| --- | --- |
| install channels, project and global installs, update | `install.md`, `agents/quickstart.md` |
| roles, profiles, models, limits, the config files | `configuration.md` |
| every command and flag | `commands.md` |
| how a workflow runs: PR review, tests, shared builds, commits and PRs | `workflows.md` |
| a full run from start to end | `walkthrough.md` |
| why omt works this way | `design.md` |

Done when: every fact in the answer comes from a command that you ran in this turn, from the workflow table, or from a linked doc.

### 4. Give the tour

Give the tour when the user asks for one, or offer it once when the user is new to omt. Show one step per message, and go on when the user says so. The tour has these 5 steps:

1. What omt is. The T3 thread that runs an omt skill is the main thread. It explores, plans, and builds the units itself. Child tasks on role-routed models review and test the result, and a large independent unit can go to a child too. The skills hold the workflows, and the CLI gives them the routes, the briefs, and the plan state.
2. The doctor check. Run `omt doctor --project --dry-run` as step 3 says, and explain each line. `PASS` needs nothing, `INFO` is a note, and `WARN` and `FAIL` lines print their fix.
3. A first task. Suggest a small task, such as `$omt-ulw add a --version flag to the CLI`. Say what happens: the main thread explores, asks, plans, and builds, then one review child and one QA child check the work. Read the limits from `omt profile show --json`, in `limits`.
4. A review. Suggest `$omt-code-review the uncommitted changes`. For a pull request, `$omt-code-review <number>`. It runs all PR steps, and `--profile prototype` turns them off.
5. A profile. Run `omt profile list`. Show `$omt-ulw --profile prototype <task>` for one run. To make a profile the default, offer `omt-setup`.

Done when: the user saw each step that they wanted, or said stop.

### 5. Hand off a change

When the user wants a change made, load the `omt-setup` skill and name the change, such as "accept the current defaults" or "make execute fast". When the user asked only how, give the steps and ask whether to make the change. The user can also type `$omt-setup <change>`.

Done when: you loaded `omt-setup` with the change, or the user chose to make the change alone.
