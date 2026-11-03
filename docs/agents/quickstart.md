# Agent quick start

Read this page when your user asks you to evaluate, install, or use oh-my-t3 (`omt`). Do the steps in order. Each step ends with a check. Go to the next step only when the check passes.

## What omt is

omt is a set of skills and a small CLI for agents that run in [T3 Code](https://t3.codes). A T3 thread that runs an omt skill becomes the main thread: it reads the code, asks the user its open questions, writes a plan, and builds the change itself. Then one role-routed T3 child task from the other model family reviews the change, and one child task runs every check. The CLI has no runtime dependencies and sends no telemetry. It contacts the npm registry only when you run `omt update`, or once a day in `omt install` and `omt doctor` after you set `update` in the user config. `omt update` runs the package manager or mise command of the channel that installed omt. `omt git commit`, `omt git pr`, and `omt git stack` run `gh`, and `omt git pr` and `omt git stack` run `git push`, so they contact the git host of the `origin` remote.

## 1. Check the fit

Check each requirement on the user's machine. Ask the user about the items that you cannot check yourself.

| Requirement | How to check |
| --- | --- |
| The latest T3 Code release; omt is tested only on it. It is free for macOS, Windows, and Linux. Install it from https://t3.codes. | Ask the user, or look for `~/.t3/userdata/settings.json`. |
| At least one provider signed in and enabled in T3 Settings, Providers: Claude Code (`claude auth login`), Codex with a ChatGPT sign-in, or both. | Run `claude auth status` or `codex login status` when the CLI is on `PATH`. Ask the user to confirm the provider is enabled in T3. |
| One way to install and run omt: `mise`, Node.js 22 or later, or Bun 1.4.4 or later. The release binary that mise installs needs neither Node nor Bun. The `omt` command of the npm package needs Node. | `mise --version`, `node --version`, `bun --version` |
| git. | `git --version` |
| Optional: `flock` or `lockf`, for shared build locks. Without either, `omt lock run` runs the command with a warning. | `command -v flock || command -v lockf` |

Tell the user what one provider family costs them:

- With both Claude and GPT, `plan-review`, `review`, and `oracle` come from the family that did not do the work. This is cross-family review.
- With one family, the same family reviews its own work.
- `design` prefers Claude Opus and falls back to Astra. `ui` prefers Claude Opus and falls back to Sol. Older pins keep their chains. A UI unit can implement the task requirements directly, with no design spec or design tool.

The install in step 4 detects which of the two harnesses can run, and fits the new config to them.

Check: git exists, Node 22 or later, Bun 1.4.4 or later, or `mise` is on `PATH`, and the user confirms T3 Code and at least one signed-in provider. If T3 Code or a provider is missing, tell the user what to install and stop.

## 2. Find out if you run in a T3 thread

Look in your tool list for the tools of the `t3-code` MCP server, such as `orchestrator_capabilities`, `delegate_task`, and `task_status`. Your harness can add a prefix, such as `mcp__t3-code__orchestrator_capabilities` or `mcp__t3_code__orchestrator_capabilities`. Some harnesses connect MCP servers late. Search your deferred tools once before you decide the tools are missing.

The tools alone do not prove that you run in a T3 thread. An agent outside T3 can connect to the T3 MCP server through OAuth and see the same tools. If the tools are present, call `orchestrator_capabilities` with no arguments and read `parentThreadId` in the result.

- If `parentThreadId` is a string, you run in a T3 thread. You can install omt and also run its skills.
- If `parentThreadId` is `null`, or the tools are missing, you run outside a T3 thread. You can still install omt (steps 3 to 5). Do not run the omt skills. Tell the user: "omt skills run only inside a T3 Code thread, because `delegate_task` and `task_status` need a T3 thread as the caller. After the install, open this project in T3 Code and start a new Claude Code or Codex thread there."

Check: you know the value of `parentThreadId`, or you know that the tools are missing. If you run outside a T3 thread, you told the user.

## 3. Install the omt CLI

Install omt from a package registry or as a release binary. Do not clone the repository. Ask the user which channel to use. If the user has no preference, use the first row of this table that fits the machine:

| The machine has | Install command | Check |
| --- | --- | --- |
| `mise` on `PATH` | `mise use -g github:gabimoncha/oh-my-t3` | `omt --version` |
| `npm` on `PATH`, and `node --version` prints v22 or later | `npm i -g oh-my-t3` | `omt --version` |
| `pnpm` on `PATH`, and `node --version` prints v22 or later | `pnpm add -g oh-my-t3` | `omt --version` |
| `bun` on `PATH`, and `bun --version` prints 1.4.4 or later | `bun add -D oh-my-t3` in the project root | `bunx omt --version` |

The check prints the omt version, such as `0.1.0`. If it fails, the channel does not work on this machine. Tell the user the error, and try the next row that fits.

On a machine with Bun and no Node, the `omt` command of the npm package fails with `env: node: No such file or directory`. So the last row installs omt as a dev dependency and runs it through `bunx`. If the project has no `package.json`, use a one-shot run instead: `bunx oh-my-t3 --version` in step 3, and `bunx oh-my-t3 install --project` in step 4. The [install guide](../install.md#run-the-npm-package-with-bun-only) has the other Bun forms.

The user can also pick another channel. A global install puts `omt` on `PATH` for all projects:

| Channel | Command |
| --- | --- |
| mise, release binary | `mise use -g github:gabimoncha/oh-my-t3` |
| mise, npm package | `mise use -g npm:oh-my-t3` |
| npm, global | `npm i -g oh-my-t3` |
| pnpm, global | `pnpm add -g oh-my-t3` |
| Bun, global | `bun add -g oh-my-t3` |

The release binary holds the skills and needs neither Node nor Bun. It runs on macOS and Linux, on arm64 and x64. The `omt` command of the npm package needs Node 22 or later on `PATH`, also after `bun add -g`. To make mise install the npm package with Bun, run `mise settings set npm.package_manager bun` before `mise use -g npm:oh-my-t3`. The `omt` command then still needs Node.

mise puts `omt` on `PATH` only in a shell where mise is active, or where the mise shims directory is on `PATH`. If `omt` is not found after a mise install, `mise which omt` prints its path.

To pin a version of the release binary, add it after `@`. For example, `mise use -g github:gabimoncha/oh-my-t3@0.1.0` installs version 0.1.0.

By default, recent mise versions hide a release for its first 24 hours, through the setting `minimum_release_age`. In that time, mise installs the previous release, or fails when no older release exists. If `mise use -g github:gabimoncha/oh-my-t3` fails with a `minimum_release_age` message, run it again with the version that the message names, such as `mise use -g github:gabimoncha/oh-my-t3@0.1.0`.

A dev dependency installs omt into the project only. Run the command in the project root. The project must have a `package.json`. The command changes `package.json` and the lockfile, and git shows these changes:

| Channel | Command |
| --- | --- |
| npm, dev dependency | `npm i -D oh-my-t3` |
| pnpm, dev dependency | `pnpm add -D oh-my-t3` |
| Bun, dev dependency | `bun add -D oh-my-t3` |

A one-shot run installs nothing now. In step 4, the runner downloads omt and runs `npx oh-my-t3 install --project`, `bunx oh-my-t3 install --project`, or `pnpm dlx oh-my-t3 install --project`. The project then calls the same runner with the pinned version on each call. After the runner's cache is cleared, the next call needs the network.

Do not run `npx omt` outside a project that installed omt. It downloads a different npm package named `omt`. For a one-shot run, use `npx oh-my-t3`.

Check: the command for the channel prints the omt version:

| Channel | Check |
| --- | --- |
| Global or mise | `omt --version` |
| npm dev dependency | `npx omt --version` |
| pnpm dev dependency | `pnpm exec omt --version` |
| Bun dev dependency | `bunx omt --version` |
| One-shot | `npx oh-my-t3 --version`, `bunx oh-my-t3 --version`, or `pnpm dlx oh-my-t3 --version` |

`bunx omt` and `bunx oh-my-t3` work with no Node on `PATH`. `npx` and `pnpm` need Node.

## 4. Install omt into the project

Run these commands in the root of the user's project. The project install writes only inside the project and hides its files from git through `.git/info/exclude`. It does not change `~/.agents/skills`, `~/.claude`, or `PATH`. It refuses to run in the home directory.

Use the install command of the channel from step 3:

| Channel | Install command |
| --- | --- |
| Global or mise | `omt install --project` |
| npm dev dependency | `npx omt install --project` |
| pnpm dev dependency | `pnpm exec omt install --project` |
| Bun dev dependency | `bunx omt install --project` |
| One-shot | `npx oh-my-t3 install --project`, `bunx oh-my-t3 install --project`, or `pnpm dlx oh-my-t3 install --project` |

The commands below use `omt`. Replace `omt` with the command before `install` in the table, for example `npx oh-my-t3`.

Add `--hooks` only when the user runs Claude Code. The hook lets the user start ultrawork with the phrase `start ulw` or `start ultrawork`. The bare words do not start it. Codex gets no hook. Codex users type `$omt-ulw`. With a one-shot install, the hook calls the runner on each prompt. If the runner's cache is cleared and the network is down, the hook can pass its 10-second timeout.

If you run in a T3 thread (step 2), give the install the live provider list. Call `orchestrator_capabilities` with no arguments, save the result to a temp file outside the repository, such as `/tmp/t3-capabilities.json`, and add `--capabilities <file>` to both install commands below. Outside a T3 thread, leave the flag out. The install then reads the T3 settings file and `PATH`.

First, show the plan and write nothing:

```sh
omt install --project --hooks --dry-run
```

Read the `Harnesses` section of the plan to the user. It lists `claudeAgent` and `codex` as `detected` or `not detected`. When one is missing, it shows the `"harnesses"` value that the new config gets and its effect, such as `cross-family review: the same family reviews`. When a harness is missing that the user expected, stop, and help the user sign in to it or enable it in T3 before you apply the plan.

Then apply it. Without a terminal, the install does not ask. It prints `Re-run with --yes to apply.` and changes nothing, so pass `--yes` only after the user agrees with the plan:

```sh
omt install --project --hooks --yes
```

The install writes the shim `.omt/bin/omt`. From now on, agents in this project call the CLI as `.omt/bin/omt`, for every channel. The commands below use that path. If `omt` is on `PATH` from a global install, `omt` works too.

Check the install:

```sh
.omt/bin/omt doctor --project
```

Expect these lines, with paths in the user's project:

```text
PASS  runtime    <runtime>
PASS  config     11 roles
PASS  defaults   current defaults
PASS  harnesses  claudeAgent, codex
PASS  skills     7 skills installed in <project>/.agents/skills
PASS  links      7 links in <project>/.claude/skills
PASS  hooks      Claude UserPromptSubmit hook in <project>/.claude/settings.local.json
PASS  shim       <project>/.omt/bin/omt
PASS  exclude    omt block in <project>/.git/info/exclude
PASS  t3         <home>/.t3/userdata/settings.json
PASS  worktree   <project>: the setup script "Setup" runs node .t3/omt-worktree-setup.mjs; ...
```

`<runtime>` names what runs omt: `omt 0.1.0 binary` for the release binary, or the runtime and its version, such as `node 22.21.1` or `bun 1.4.4`. After a one-shot install, the `shim` line names the runner, such as `<project>/.omt/bin/omt runs npx --yes omt3@0.1.0`.

The `worktree` line is often `WARN` or `INFO` on the first install. The worktree setup step below covers it.

Without `--hooks`, the `hooks` line is `INFO  hooks      no hook installed; ...`. That is correct for Codex.

An `INFO  harnesses` line, such as `codex only; cross-family review: the same family reviews`, means that the config skips one harness. Tell the user the effect.

A `WARN  t3` line means doctor found no T3 settings file: `... settings.json does not exist; is T3 Code installed?`. The install itself is fine. Ask the user if T3 Code is installed. If T3 Code keeps its data in another place, set `T3CODE_HOME` to that directory and run doctor again.

A `WARN  skills` line means the installed skills do not match the CLI. Doctor still exits 0, so read the line. Run the install with `--yes` again. If the line says `no longer shipped:`, an old omt left a skill that this version removed, such as `omt-grill`, `omt-help`, or `omt-loop`. The install with `--yes` removes it. If the line says `modified:`, the user edited an installed skill. Ask the user before you add `--force`, which backs up the edited skill and installs over it.

Check: this command prints the `PASS  skills` line:

```sh
.omt/bin/omt doctor --project | grep -E '^PASS +skills '
```

Also check that doctor prints no `FAIL` line, and that `git status --short` shows no new files from the install. A dev-dependency install shows `package.json` and the lockfile as changed. These changes come from step 3, not from the project install.

### Check the worktree setup

T3 runs a setup script in each new worktree before the agent starts. Without a setup script, saved in T3 or inherited, a worktree thread has no dependencies installed. Check the setup before you report the install as complete:

1. Run `.omt/bin/omt worktree check` and read the `setup` and `next:` lines.
2. Follow [the worktree setup reference](../../skills/omt/references/worktrees.md): read the effective setup in T3, keep a compatible one, and generate a missing one for Bun or pnpm with `.omt/bin/omt worktree setup --dry-run`, then `--yes`, only when the user agrees.
3. A `t3.json` file does not activate anything. T3 runs the setup only after the user commits `t3.json`, `.t3/`, and for pnpm `pnpm-workspace.yaml` on the branch that new worktrees start from, and imports Setup in T3 Project Settings. Tell the user these steps. Do not import a setup that the base branch lacks.

Check: the effective T3 setup runs a dependency install, or you told the user that activation is pending and what remains. Report each part that you could not verify as unverified.

### Check the frontend design skill

Look for Anthropic's optional [frontend-design skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design) in the skill list of the user's harness, plugin-prefixed names included. When the list has no entry, look in the project and user skill folders of that harness. When it is missing, recommend the official skill, and install it only when the user asks. It helps during design and direct UI implementation without a spec. A missing skill does not block setup.

Check: the user knows whether the skill is available and has the recommendation when it is missing.

## 5. Restart the agent sessions

A running session does not load new skills. Tell the user to close the T3 threads of this project and start new ones.

If the user runs Codex children, also tell them to open T3 Code Settings, Providers, Codex, and set Launch arguments to `-c thread_unload_delay_secs=60`, with no quotes. Codex 0.163.0 keeps a released thread and its MCP server processes for 30 minutes by default. With this setting, a finished child closes after one minute.

Check: the user confirms that the new threads are open. If you run in one of them, `omt-ulw` is in your skill list.

## 6. Give the user three first tasks

Suggest these tasks, in this order. Each runs in a T3 thread of the project.

1. A small change with the ultrawork build flow. Pick a real, small task from the project. For example:

   ```text
   $omt-ulw add a --version flag to the CLI
   ```

   With the Claude Code hook, `start ulw add a --version flag to the CLI` works too. A small task gets a LIGHT run: a short plan that the main thread builds itself, one review child, and one QA child.

2. A review of the uncommitted changes:

   ```text
   $omt-code-review the uncommitted changes
   ```

3. A cited answer to a question about the project or a library:

   ```text
   $omt-research how does this project load its config?
   ```

`$omt-ulw` is the T3 composer mention. T3 turns it into each provider's form: `/omt-ulw` for Claude Code and `$omt-ulw` for Codex.

The user starts `$omt` by name. An agent does not pick it on its own. It lists the workflows and when to use each.

`$omt-setup` helps with omt itself. The agent can start it on its own when the user asks for help or for a change. It answers questions such as "what can omt do", "what do I do next", or "which skill do I use", from the output of read commands. It also sets up, configures, or updates omt: the harnesses, the defaults, models, roles, profiles, and the worktree setup. It shows each change first and asks before it writes.

`$omt-swarm` is opt-in, and a default install leaves it out. It builds a plan from `omt-plan` as independent tracks, each in its own T3 worktree thread, and ends in one draft pull request. The user starts it by name. To add it, run the install command of step 4 with `--with omt-swarm`, after the user agrees.

Check: the user knows the three first tasks, how to start `$omt`, that `$omt-setup` exists, and that `$omt-swarm` needs `--with omt-swarm`.

## 7. Show the user how to customize roles and profiles

Show the current setup:

```sh
.omt/bin/omt roles
.omt/bin/omt profile list
.omt/bin/omt profile show normal --json
```

`omt roles` prints the selected target of each role. `omt profile list` prints the presets `normal` and `prototype`, and any custom profiles. `omt profile show <name> --json` prints the resolved workflow, limits, roles, and models of one profile.

Tell the user how to change them:

- Pick a profile for one run: `$omt-ulw --profile prototype <task>`. Pick a default: set `"profile": "<name>"` in `.omt/config.jsonc`. Switch a running plan: `.omt/bin/omt plan profile <slug> <name>`.
- Write a profile: add it under `profiles` in `.omt/config.jsonc` (this project) or `~/.config/oh-my-t3code/config.jsonc` (all projects). A profile `extends` a preset and can switch workflow steps and override roles, models, and limits. A profile without `extends` inherits `normal`. [Configure roles and profiles](../configuration.md#write-a-custom-profile) has an example.
- Add a custom role: add it under `roles` in the same config files. A new role needs `description`, `access`, and `chain`. Its `result` field picks the result block: `work`, `review`, `test`, `research`, `plan`, or `guardrail`.
- Add a persona: write `.omt/roles/<role>.md`. Its content is the persona and rules for that role, and it replaces the bundled persona. The lookup order is `.omt/roles/`, then `~/.config/oh-my-t3code/roles/`, then the bundled personas.
- Fit the harnesses: `.omt/bin/omt detect` prints which harnesses can run and the `"harnesses"` value that fits them. `.omt/bin/omt detect --write --dry-run` shows the change, and `--yes` instead of `--dry-run` writes it. In a T3 thread, add `--capabilities <file>` from step 4 to each of these commands.
- Let an agent do it: the user can ask `$omt-setup` for any of these changes.

Check: `.omt/bin/omt config validate` reports no errors after each config change.

## 8. Tell the user what a run costs

omt counts child tasks, not tokens. Tell the user:

- The main thread builds the units itself. A build run starts one review child and one QA child, plus a few `explore` children for broad reads. In the `normal` profile, the reviewer checks the fixes again after each round, up to 4 reviews. A failed check gets at most 2 QA re-runs.
- A HEAVY run also starts one `plan-review` child, for at most 2 plan review rounds.
- A run has no task budget. The default limit is 6 child tasks at a time. Lower it for one plan with `.omt/bin/omt plan limit <slug> <n>`.

Check: the user knows what a run starts and the limit of child tasks at a time.

## Update omt

Do this when the user asks to update omt. `omt update` asks the npm registry for the latest version and runs the update command of the channel that installed omt. Then the new CLI syncs the skills in user scope and in each project that `omt install --project` recorded. A skill that the user edited stays as it is.

In these steps, `omt` means the command of the install. With a project install, it is `.omt/bin/omt`, and you run it in the project root. With only a global install, it is `omt` from `PATH`.

1. Show the plan:

   ```sh
   omt update --dry-run
   ```

   Show the output to the user. The output names the channel, such as `omt 0.2.0 (npm global); latest 0.3.0`. It then shows one of these lines:

   - `run: <command>`: the update command that omt runs. The mise channels write an exact pin into the global mise config, such as `github:gabimoncha/oh-my-t3@0.3.0`, and the line says so.
   - `pin: <project>/.omt/bin/omt -> <runner command>`: a one-shot install. omt writes the new version into the shim.
   - `hint: <text>`: omt runs no update command. For a dev dependency, the hint names two commands of the project's package manager. The first updates the dependency, such as `pnpm add -D oh-my-t3@0.3.0`, and changes `package.json` and the lockfile. The second syncs the skills with the new CLI, such as `pnpm exec omt update --skills-only --project`. Run the commands of the hint only after the user agrees, then go to step 3.
   - `omt <version> is the latest`: only the skills sync.

   Check: the command exits 0 and prints `Dry run: nothing was written.` If it fails with `cannot reach the npm registry`, update by hand as the last part of this section says.

2. After the user agrees, apply the plan:

   ```sh
   omt update --yes
   ```

   Check: the command exits 0. Show the user each `kept <skill>  (<reason>)` line, and each skill that the update removed because this version no longer ships it. Locally edited skills stay unchanged. Unmodified skills that this version no longer ships are removed. `omt install --project --force` replaces a locally modified skill.

3. Check the skills. With only a global install, run `omt doctor` instead of `omt doctor --project`:

   ```sh
   omt doctor --project | grep -E '^PASS +skills '
   ```

   Check: the command prints `PASS  skills     7 skills installed in <folder>`, or 8 with `omt-swarm`. If it prints nothing, run the doctor command without the pipe, and do the fix that its `skills` line prints.

4. Review the defaults changes. `omt update` and `--skills-only` show the difference and ask before accepting it. `--yes` also accepts the current defaults, so get approval for that before you pass it.

   To review pending changes separately, run `omt doctor --dry-run` for a user install, or `omt doctor --project --dry-run` in the project root. Show the diff. A line marked `(overridden by <file>)` has no effect because that file sets the value.

   After approval, run the same doctor command with `--yes` instead of `--dry-run`. Declining keeps the last accepted defaults. An older install without a saved baseline shows the current role choices on its first review.

   Check: each scope has a user decision, and `omt config validate` reports no errors after acceptance.

5. Tell the user to close the T3 threads of this project and start new ones. A running session keeps the old skills.

   Check: the user confirms that the new threads are open.

To update by hand, for example without network access to the npm registry, do these steps:

1. Run the update command of the channel:

   | Channel | Update command | New CLI |
   | --- | --- | --- |
   | mise, release binary | `mise use -g github:gabimoncha/oh-my-t3@latest` | `mise exec github:gabimoncha/oh-my-t3@<version> -- omt` |
   | mise, npm package | `mise use -g npm:oh-my-t3@latest` | `mise exec npm:oh-my-t3@<version> -- omt` |
   | npm, global | `npm i -g oh-my-t3@latest` | `omt` |
   | pnpm, global | `pnpm add -g oh-my-t3@latest` | `omt` |
   | Bun, global | `bun add -g oh-my-t3@latest` | `omt` |
   | npm dev dependency | `npm i -D oh-my-t3@latest` | `npx omt` |
   | pnpm dev dependency | `pnpm add -D oh-my-t3@latest` | `pnpm exec omt` |
   | Bun dev dependency | `bun add -D oh-my-t3@latest` | `bunx omt` |
   | One-shot | Run the project install again with the new version, such as `npx oh-my-t3@<version> install --project --yes`. Without a version, the runner can reuse the version in its cache. | `.omt/bin/omt` |

   For mise, `<version>` is the version in the `tools:` line that `mise use -g` prints. The project shim of a mise install records the path of the old version, and mise keeps that version. So until the sync in step 2 rewrites the shim, `.omt/bin/omt` still runs the old CLI. The shim of a dev dependency can also record an old CLI file, such as an old folder of the shared pnpm store. So for a dev dependency, the new CLI runs through the package manager.

   Check: `<new CLI> --version` prints the new version.

2. In the project root, sync the skills with the new CLI from the table. For a global install with no project install, run it in any folder:

   ```sh
   <new CLI> update --skills-only --yes
   ```

   It uses no network. It syncs the user scope of a global install and each recorded project that runs the same channel, and rewrites the shim of each of these projects to run the new CLI. A project of another channel or another one-shot pin shows a `skip` line, with the command to run in that project.

   Check: the command exits 0. Then do steps 3 to 5 above with `omt` as the start of this section says.

## Uninstall

Run this in the project root:

```sh
.omt/bin/omt uninstall --project --yes
```

It removes what the install wrote, except the files that the user changed. It also removes the shim, so run the next commands with the install command of the channel from step 4, such as `omt` or `npx oh-my-t3`. It keeps the user's own files in `.omt/`: the plans, the ledger, the evidence, an edited config, the personas, and the backups. It also keeps an edited skill with its links, and the parts of the exclude block and the manifest that the kept files need. The [install guide](../install.md) gives the details. Add `--dry-run` to see the list first. Tell the user to restart the T3 threads of this project.

Check: the uninstall exits 0. Then run a second dry run in the project root. Replace `omt` with the command of the channel:

```sh
omt uninstall --project --dry-run | tail -1 | grep -qx 'Nothing to remove.'
```

Check: the command exits 0. Then the last line of the dry run is `Nothing to remove.`, and nothing that omt can remove is left. If it exits 1, the uninstall is not complete. Run the uninstall again.

Then run `omt uninstall --project --dry-run` without the pipe and read its output. Pass each `keep` line to the user with its reason. For an edited skill, tell the user that `omt uninstall --project --force --yes` backs up the skill and then removes it. Run it only when the user asks.

Do not judge the uninstall by `git status`. The other changes that it shows are the user's own work. Leave them alone.

The project uninstall does not remove the CLI. To remove it too, use the command of its channel, such as `mise unuse -g github:gabimoncha/oh-my-t3`, `npm rm -g oh-my-t3code`, `pnpm rm -g oh-my-t3code`, `bun rm -g oh-my-t3code`, or `npm rm -D oh-my-t3code`. Ask the user first.

## More

- [Walkthrough](../walkthrough.md): two real omt runs, with their plans, tasks, and reviews.
- [Install guide](../install.md): every install channel, the global install, every path the install writes, and the uninstall details.
- [Configure roles and profiles](../configuration.md): the default roles, custom roles and profiles, limits, fast mode, defaults review, and the harnesses.
- [Commands](../commands.md): every `omt` command.
- [README](../../README.md): the features, the skills, and the limits.

To change omt itself, clone the repository with `git clone https://github.com/gabimoncha/oh-my-t3.git`, and read [AGENTS.md](../../AGENTS.md). An install does not need the clone.
