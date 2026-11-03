---
name: omt-setup
description: Set up, configure, or update omt in T3 Code. Use when the user asks to set up omt, configure omt, update omt, change the models or roles, add or change a profile, pick the harnesses (Claude Code, Codex), or review new defaults. Runs the omt CLI, shows each change first, and asks before each write.
---

# Setup

You configure omt for the user through the omt CLI. You write only through an omt command or a config file edit that the user approved. T3 tools appear here by base name. Your harness may add a prefix, such as `mcp__t3-code__orchestrator_capabilities`.

The CLI and the skills serve people and agents. Each command prints text for a person, and the report commands also print JSON with `--json`. Show the user the text form. Read the `--json` form when you need one field.

## Write rules

Every step that writes follows these rules:

1. Show the command, or the planned edit, before you run it.
2. When the command has `--dry-run`, run it with `--dry-run` first and show the output.
3. Ask the user. Pass `--yes`, or make the edit, only after the user agrees.
4. After the write, run the check of the step.

## Steps

Run steps 1 and 2 first. Then run the steps that the request names. For a plain "set up omt", run steps 3, 4, 5, and 5a in order. End with step 8.

### 1. Find the CLI and your mode

Follow [The CLI](../omt/references/delegation.md#the-cli). Below, `omt` means the command that you found, such as `.omt/bin/omt`. When no CLI exists, the user installs it first: follow the [agent quick start](https://github.com/gabimoncha/oh-my-t3/blob/main/docs/agents/quickstart.md), which asks the user for a channel.

When you have the T3 tools, call `t3_thread_configuration` with no `threadId` and read your `interactionMode`. In `plan` mode, run only the read commands, list the write commands for the user, and ask the user to switch the thread to default mode.

Done when: `omt --version` prints a version, and you know your mode.

### 2. Read the doctor

Run `omt doctor --project --dry-run` for a project install, or `omt doctor --dry-run` for a global install. Read each line. Map each line that is not `PASS` to a step:

| Line | Step |
| --- | --- |
| `harnesses` | 3 |
| `defaults` | 4 |
| `worktree` | 5 |
| `config` | 6 |
| `skills` with `outdated`, `hooks`, or `update` with `is out` | 7 |

For another `WARN` or `FAIL` line, tell the user the fix that the line prints.

Done when: each line that is not `PASS` has a step or a fix, and you told the user which steps you propose.

### 3. Fit the roles to the harnesses

The commands below use `--project`, which targets the project config. For the user config of a global install, put `--user` in its place. Pass the same flag to every detect command of this step, the reads included, so that each command reads and writes the same file.

When you have the T3 tools, call `orchestrator_capabilities` and save its full JSON result to one temp file, such as a path that `mktemp` prints. Pass that file to every detect command of this step:

1. `omt detect --capabilities <file> --project`. Read the line of each driver and the effect lines for the active defaults.
2. When the output recommends a change: `omt detect --capabilities <file> --write --project --dry-run`. Show the output and ask.
3. After the user agrees: `omt detect --capabilities <file> --write --project --yes`.
4. The check: `omt detect --capabilities <file> --project`, then `omt roles --capabilities <file>`.

Without the T3 tools, run the same four commands without `--capabilities <file>`. Tell the user that this detection reads the T3 settings file and `PATH`, and does not see a provider that T3 enables for one project only.

When `omt detect` exits 1 because it detects no driver, ask the user to sign in to Claude Code or Codex and enable it in T3 Settings, Providers. Then run this step again.

Done when: step 1 recommends no change, or the check recommends no further change after the write; and `omt roles` shows each role as the effect lines said.

### 4. Review current defaults

1. Run `omt doctor --project --dry-run`. For a user install, leave out `--project`.
2. Explain each `<path>: <from> -> <to>` line. A line marked `(overridden by <file>)` has no effect because that file sets the value. On the first review of an older install, show the current role choices because no baseline is saved.
3. Ask whether to accept the current defaults. After approval, run the same command with `--yes` instead of `--dry-run`. Declining keeps the last accepted defaults.

Acceptance stores one snapshot in the install record and removes the retired `defaults` config key. It preserves the other config values and comments.

Done when: the user accepted or declined, and `omt config validate` exits 0 after acceptance.

### 5. Set up worktrees

Follow [worktrees.md](../omt/references/worktrees.md) on the first omt run in a project, or when the doctor prints a `worktree` line that is not `PASS`.

Done when: you finished each step of worktrees.md that applies to this checkout.

### 5a. Check the frontend design skill

Follow [Check availability](../omt/references/frontend-design.md#check-availability). Check for Anthropic's `frontend-design` skill and recommend installing it when missing. Explain that it helps during design and direct UI implementation without a design spec. It is optional.

Done when: the user knows whether the skill is available, and has the installation recommendation when it is missing.

### 6. Change a profile or a role

1. Run `omt config path`. Use the project file for one project, and the user file for all projects. When the file is absent, propose `omt init` (project) or `omt config init` (user), and ask.
2. Read the file and `omt config show --defaults`. Write the planned JSONC edit as the new block, with its key path. Keep the rules of the [configuration guide](https://github.com/gabimoncha/oh-my-t3/blob/main/docs/configuration.md):
   - A new role needs `description`, `access`, and `chain`. A new profile needs `description`.
   - A `chain` replaces the old chain as a whole. `null` removes a role.
   - `"profile": "<name>"` selects the default profile.
   - `workflow.git.owners` lists the GitHub orgs whose repos count as the user's own for the git policy. The default is none.
3. Show the edit and ask. After the user agrees, make the edit and keep every other byte of the file, comments included.
4. The check: `omt config validate`, then `omt profile show <name>` for the profile that the change affects.

When the user wants to edit in a browser page, run `omt config edit --web --capabilities <file>` in the background, and give the user the URL that it prints. Use the capabilities file of step 3. When step 3 did not run, call `orchestrator_capabilities` first and save its full JSON result to a temp file, such as a path that `mktemp` prints. Without the T3 tools, omit `--capabilities <file>`. The page writes the files itself, so skip items 2 and 3, and run item 4 after the user says that they are done.

Done when: `omt config validate` exits 0, and `omt profile show <name>` shows the new values.

### 7. Update omt

1. Run `omt update --dry-run` and show the output. It names the channel and its update command (`run:`), the new shim pin of a one-shot install (`pin:`), or a `hint:`, and it lists each scope that the skills sync reaches. For a dev dependency, the hint names the package manager command. Run it only after the user agrees.
2. After the user agrees, run `omt update --yes`. Tell the user each `kept <skill>  (<reason>)` line: that skill stays as the user edited it. When it fails with `cannot reach the npm registry`, update by hand as [Update omt](https://github.com/gabimoncha/oh-my-t3/blob/main/docs/agents/quickstart.md#update-omt) says.
3. `--yes` also accepts current defaults. Include this in the approval request. When the new CLI has not yet been installed, its defaults diff is not available in the dry run. To let the user review that diff first, run `omt update` interactively after approval for the CLI update. Answer its defaults question only after the user decides.
4. The check: `omt doctor --project --dry-run` for a project install, or `omt doctor --dry-run` for a global install, as in step 2. When any skill changed, tell the user to close the T3 threads of this project and start new ones, because a running session keeps the old skills.

Done when: the doctor command of item 4, with the scope of the install, prints a `PASS` line for `skills`, and the user knows to start new threads.

### 8. Report

Tell the user each file and key that changed, each command that wrote, the result of its check, and each proposed step that the user declined.

Done when: each write of this run is in the report with its check result.
