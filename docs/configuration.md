# Configure roles and profiles

omt reads two config files:

- The user config, `~/.config/oh-my-t3code/config.jsonc`, applies to all projects. `omt install` and `omt config init` create it.
- The project config, `.omt/config.jsonc`, overrides the user config for one project. `omt install --project` and `omt init` create it.

`omt config path` prints both paths and says which files exist. `omt config init` writes the user starter config, and `--force` overwrites an existing file.

Run `omt config validate` after each change. It checks every key of both files and every profile, including the profiles that you do not select. It exits 1 on an error. The [spec](spec.md#62-layer-validation) has the full schema and the merge rules.

To let omt make a change for you, ask the agent in a T3 thread to set up omt. The `omt-setup` skill runs the commands on this page, shows each change, and asks before it writes. For help with a question, ask `$omt-help`.

## Get autocomplete in your editor

Each starter config has a `$schema` line near the top, below a few comment lines. A config file with only this line and the version looks like this:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gabimoncha/oh-my-t3/main/schema/omt.schema.json",
  "version": 1
}
```

An editor that reads JSON Schema, such as VS Code, uses this line to complete keys and values and to mark an unknown key. Add the line to a config file that does not have it. omt itself ignores the line.

## Default roles

A role, such as `execute` or `review`, maps to an ordered chain of provider, model, and effort. The agent uses the first entry that T3 accepts. Each entry in the chain is a rung.

| Role | Use | Used by | First choice | Fallback |
| --- | --- | --- | --- | --- |
| `explore` | Answer one narrow question about this repository | `omt-research`, `omt-plan`, `omt-grill` | GPT-6.1-Terra, low | Claude Haiku 5.5, medium |
| `research` | Answer a question from docs, the web, and code | `omt-research` | GPT-6.1-Sol, low | Claude Sonnet 5.5, medium |
| `plan-review` | Check a plan for gaps | `omt-plan` | GPT-6-Astra, medium | Claude Opus 5.5, medium |
| `grill` | Test a goal before it has a plan: edge cases, questions, and options | `omt-grill` | GPT-6-Astra, medium | Claude Opus 5.5, medium |
| `execute` | Implement one planned unit that the main thread hands off as an independent track | `omt-ulw` | Claude Opus 5.5, low | GPT-6.1-Sol, high |
| `review` | Review a diff against its brief, fix local findings, and report the rest | `omt-ulw`, `omt-code-review`, `omt-swarm` | GPT-6-Astra, medium | Claude Opus 5.5, medium |
| `oracle` | Attack the finished change before it counts as done, fix local findings, and report the rest | `omt-ulw`, `omt-code-review` | GPT-6-Astra, medium | Claude Opus 5.5, medium |
| `qa` | Run the check commands and device flows, and return each exit code with its log and screenshots. Edits nothing. | `omt-ulw`, `omt-code-review`, `omt-swarm` | GPT-6.1-Sol, medium | Claude Sonnet 5.5, low |
| `guardrail` | Propose checks and rule fixes for review findings | `omt-code-review` | Claude Opus 5.5, high | GPT-6-Astra, high |
| `writing` | Write or edit documentation in one docs unit that the main thread hands off as an independent track | `omt-ulw` | Claude Opus 5.5, medium | GPT-6-Astra, medium |
| `design` | Design screens and flows, and write a design spec | `omt-design` | Claude Opus 5.5, medium | GPT-6-Astra, high |
| `ui` | Implement one UI unit from a design spec or task requirements | `omt-ulw` | Claude Opus 5.5, low | GPT-6.1-Sol, high |

The table shows the current defaults. The fallback runs when T3 refuses the first choice. You review the designs.

The `plan` role was removed, because the main thread writes every plan itself. A config file that still sets `roles.plan` loads with the warning `roles.plan is no longer used; remove it`.

`plan-review`, `grill`, `review`, and `oracle` are cross-family roles. The reviewer comes from the model family that did not do the work. GPT-6-Astra reviews Claude work, and Claude Opus 5.5 reviews GPT work. The skills pass the worker to `omt brief --against`, and the CLI puts the rungs of the other family first. When the other family is not available, the same family reviews. A build oracle uses the family that did not do most of the implementation. A review oracle uses the family that did not do most of the reviews.

Claude models run on the `claudeAgent` driver, and GPT models run on the `codex` driver. Each default rung also names the T3 built-in provider instance of its driver. T3 checks a named instance again before it refuses it. A target with only a driver can fail because of an old provider snapshot.

The read-only roles are `explore`, `research`, `plan-review`, `grill`, and `guardrail`. They run in T3 plan mode. On Claude, Codex, Cursor, and OpenCode, plan mode stops the child from editing files. T3 has no plan mode for Pi, so only its brief stops a Pi child in a read-only role. No default role uses Pi.

`review` and `oracle` can edit files. In an `omt-ulw` build, the reviewer fixes each local finding itself: a clear fix inside the changed files that agrees with the plan summary. It reports every other finding. `omt-code-review` still runs its reviewers in plan mode, so they only report. `qa` has edit access only to run commands and write logs. Its brief forbids edits in the repository, and it writes no tests. `qa` tries GPT-6.1-Sol first, then Claude Sonnet. If a local tool is unreachable, the workflow retries once on the other provider. Only `qa` drives a device, a simulator, a browser, or a computer.

Run `omt roles` to see how each role resolves with your config.

## Change a role

This example turns off cross-family review. After the change, `review` always starts on GPT-6-Astra and falls back to Claude Opus 5.5, also when GPT made the change.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/gabimoncha/oh-my-t3/main/schema/omt.schema.json",
  "version": 1,
  "roles": {
    "review": {
      "crossFamily": false
    }
  }
}
```

A `chain` replaces the old chain as a whole. The other fields of the role keep their values. To remove a role, set it to `null`.

A chain holds 1 to 10 rungs. A rung has these fields:

| Field | Value |
| --- | --- |
| `provider` | The id of one T3 provider instance, such as `codex`. |
| `driver` | The driver of the provider, such as `claudeAgent` or `codex`. A rung needs `provider`, `driver`, or both. |
| `model` | The model id. Required. |
| `effort` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. omt maps it to the effort option of the model. |
| `fast` | `true` or `false`. See [Set fast mode per role](#set-fast-mode-per-role). |
| `options` | Raw T3 model options, as an object of strings and booleans. |

`options` goes to T3 as it is, after omt applies the effort and fast mode, so a value in `options` wins over both. With `--capabilities`, omt checks each option id and value against the options that the model advertises. Without it, T3 checks them when the task starts. This rung asks Codex for the priority service tier:

```jsonc
{
  "roles": {
    "review": {
      "chain": [
        { "driver": "codex", "model": "gpt-6-astra", "effort": "high", "options": { "serviceTier": "priority" } },
        { "driver": "claudeAgent", "model": "claude-opus-5-5", "effort": "high" }
      ]
    }
  }
}
```

## Add a custom role

Add the role under `roles` in either config file. A new role needs `description`, `access`, and `chain`. The other fields are optional:

| Field | Values | Default for a new role |
| --- | --- | --- |
| `description` | Text of at most 300 characters. Agents read it in `omt roles` and in the skills. | Required. |
| `access` | `read-only` or `edit`. | Required. |
| `chain` | 1 to 10 rungs. | Required. |
| `result` | The result block that the child ends with: `work`, `review`, `test`, `research`, `plan`, `guardrail`, or `grill`. | `work` for `edit`, `research` for `read-only`. |
| `t3Role` | The `role` value that omt passes to the T3 `delegate_task` tool: `implementation`, `research`, `review`, `design`, `test`, or `general`. | `implementation` for `edit`, `research` for `read-only`. |
| `interactionMode` | The T3 interaction mode of the child: `inherit`, `default`, or `plan`. `plan` stops the child from editing files. | `default` for `edit`, `plan` for `read-only`. |
| `runtimeMode` | The T3 runtime mode of the child: `inherit`, `approval-required`, `auto-accept-edits`, `auto`, or `full-access`. A child cannot get a broader mode than its parent thread. | `inherit`. |
| `crossFamily` | `true` puts the rungs of the other family first when the skill names the worker. | `false`. |
| `fast` | `true` or `false`. | Not set. |

This role runs a security review on GPT-6-Astra in plan mode:

```jsonc
{
  "roles": {
    "security": {
      "description": "Review a diff for security problems and report findings by severity.",
      "access": "read-only",
      "result": "review",
      "t3Role": "review",
      "chain": [{ "driver": "codex", "model": "gpt-6-astra", "effort": "high" }]
    }
  }
}
```

To give a role its own persona, write `.omt/roles/<role>.md`. The file content is the persona and the rules for that role, and it replaces the bundled persona. omt looks in `.omt/roles/`, then in `~/.config/oh-my-t3code/roles/`, then in the bundled personas.

## Choose a profile

A profile is a named set of workflow switches, limits, and role overrides. omt has two presets:

- `normal` reviews the build again after each round of fixes, and the reviewer of a HEAVY run is the oracle. The main thread proves that each new test can fail. A pull request review runs all PR steps: CI fixes, verification of changed flows, CRAP reports, test offers, and guardrail proposals.
- `prototype` reviews the build once, with one plan reviewer on any family. It skips the oracle and the failure proofs, allows 2 review rounds, and draws 1 design variant per screen. It turns off the CI check and the other PR steps.

Run `omt profile list` to see the presets and your custom profiles. Run `omt profile show prototype --json` to see the resolved workflow, limits, roles, and models of one profile.

To use the prototype profile for one build, type this in a T3 thread:

```text
ulw --profile prototype build a demo of the search screen
```

To switch the profile of a running plan, run `omt plan profile <slug> normal`. `omt plan profile <slug> none` removes the plan override. The change applies to the remaining work of the plan.

omt selects the profile in this order: the `--profile` flag, the plan header, the project config, the user config, and then `normal`. omt merges the config files first. Then the selected profile applies the profiles that it extends.

## Write a custom profile

Add the profile under `profiles` in either config file. The starter configs hold a commented example, `fast-proto`. A profile has these fields:

| Field | Value |
| --- | --- |
| `description` | Text of at most 300 characters. Required for a new profile. Without it, omt drops the profile and `omt config validate` reports the error. |
| `extends` | The name of the parent profile. A profile without `extends` inherits `normal`. |
| `workflow` | Switches of the plan, design, build, and review steps, per group and key. The `git` group sets when the skills commit, push, open a PR, or merge without a question (`auto`) and when they ask first (`ask`). Its `owners` key lists the GitHub orgs whose repos count as your own; the default is none, so an org repo asks. Its `maxPrFiles` key is the most changed files in one PR (default 100, `0` for no limit). Over the limit, the skills split the branch into stacked PRs with the `gh stack` extension. The [spec](spec.md#67-profiles-and-workflow) lists every key and its values. |
| `limits` | Limits for runs with this profile. See [Set limits](#set-limits). |
| `roles` | Role overrides, with the fields of [Add a custom role](#add-a-custom-role). |
| `models` | Settings per model id. The only setting is `fast`. |

A profile cannot set `harnesses`, `update`, or `defaults`. These keys apply to the whole config file.

This profile builds like `prototype`, with failure proofs, fast `execute` and `ui` workers, at most 2 children at the same time, and GPT-6.1-Sol without fast mode in the other roles:

```jsonc
{
  "profile": "hackathon",
  "profiles": {
    "hackathon": {
      "description": "Use the prototype workflow with fast workers and failure proofs.",
      "extends": "prototype",
      "workflow": { "build": { "failureProofs": "on" } },
      "limits": { "maxParallel": 2 },
      "roles": { "execute": { "fast": true }, "ui": { "fast": true } },
      "models": { "gpt-6.1-sol": { "fast": false } }
    }
  }
}
```

The role `fast` wins over the model `fast`. So in `execute`, the GPT-6.1-Sol fallback still gets `serviceTier: "priority"`. In `qa` and `research`, which do not set `fast`, GPT-6.1-Sol runs without fast mode. `omt route execute --profile hackathon` prints the targets.

A profile can turn steps on or off and change their settings. It cannot add a step or change the order of the steps. A profile applies after the root keys of the config files, so its `roles`, `limits`, and `models` win over the root values. `omt profile show <name> --json` prints the result.

## Set limits

Set limits at the root of a config file, or in a profile:

```jsonc
{
  "limits": { "maxParallel": 2, "maxReviewRounds": 3 }
}
```

| Limit | What it counts | Range | Default |
| --- | --- | --- | --- |
| `maxParallel` | Child tasks that run at the same time. A plan's own limit, set with `omt plan limit <slug> <n>`, can only lower it. | 1 to 32 | 6 |
| `maxDepth` | Levels of child tasks below the main thread. At the maximum depth, a child does the work itself. | 0 to 3 | 1 |
| `maxReviewRounds` | Reviews of one build, and fix review rounds of one code review, before the main thread stops and asks you. A plan review has at most 2 rounds. | 1 to 10 | 4 |

Each value must be an integer. `prototype` sets `maxReviewRounds` to 2.

A run has no task budget. Only `maxParallel` can stop the next child task. The number of tasks that a run already started never does. `omt ledger stats` prints `can dispatch: yes` while fewer than `maxParallel` tasks are active. `limits.maxTasksPerRun` was removed, and `omt plan limit --tasks` fails with a usage error. A plan header that still has a `max-tasks` key has no effect, and `omt plan status` prints a warning for it.

## Set fast mode per role

```jsonc
{
  "roles": {
    "execute": { "fast": true },
    "qa": { "fast": false }
  }
}
```

The first value that is set wins: the rung `fast`, the role `fast`, the model `fast`, and then `false`. GPT-6.1-Sol has fast mode on by default. For a model that supports it, `true` becomes `serviceTier: "priority"` or `fastMode: true`. A model without fast mode keeps its target, and omt reports a note. A value in `rung.options` wins over this mapping. `false` adds no fast option.

## Review current defaults

Each release ships one current default configuration. Your user and project overrides apply on top of the defaults you last accepted.

`omt doctor` and `omt update` show each changed value before asking whether to use the current defaults. A line marked `(overridden by <file>)` has no effect because your config sets that value. Declining keeps the last accepted defaults active.

```sh
omt doctor --dry-run
omt doctor
```

Use `--project` to review a project install. `--yes` accepts without a prompt. JSON output and commands without a terminal report changes without accepting them unless you pass `--yes`. A dry run writes nothing and skips the daily update check.

omt stores one accepted defaults snapshot in the install record, `install.json`. A project snapshot takes precedence over the user snapshot. With no snapshot, omt uses the installed release's defaults. An older install has no saved baseline, so its first review shows the current role choices.

The old `"defaults"` config key is ignored with a warning. Acceptance removes that key from the reviewed scope's config and keeps its comments and overrides. There is no date selector or defaults history. `omt config show --defaults` prints the installed release's current defaults.

## Match the harnesses on your machine

The default chains use two harnesses: Claude Code, on the `claudeAgent` driver, and Codex, on the `codex` driver. When your machine runs only one of them, the `"harnesses"` key tells omt to skip the rungs of the other:

```jsonc
{
  "harnesses": ["codex"]
}
```

With this value, `omt roles` marks each Claude rung as `harness claudeAgent is not enabled (harnesses: codex); run omt detect`, and the next rung runs. `design` falls back to Astra and `ui` falls back to Sol. The cross-family roles review with the same family. Without the key, omt uses every rung. The key holds 1 to 10 driver kinds, and a project value replaces the user value as a whole.

You do not have to write the key yourself. When `omt install` creates a config file, it detects the harnesses, shows the result in its plan, and writes the key only when a harness is missing. `omt detect` runs the same check at any time. `--project` or `--user` picks the config file to compare with or change. Without a flag, omt uses the project config when it exists, else the user config. `--write` changes only a file that exists, so run `omt init` or `omt config init` first. The sample uses the project config:

```sh
omt detect --project
omt detect --write --project --dry-run
omt detect --write --project
```

```text
claudeAgent  not detected  T3 disabled, claude not on PATH
codex        detected  T3 enabled, /usr/local/bin/codex
recommended: harnesses ["codex"]
cross-family review: the same family reviews
<project>/.omt/config.jsonc: harnesses none -> ["codex"]
run omt detect --write to apply
```

A harness is detected when T3 does not disable it in `~/.t3/userdata/settings.json` (or `$T3CODE_HOME/userdata/settings.json`) and its executable, `claude` or `codex`, is on `PATH`. omt does not read T3's settings per project, so it can miss a harness that T3 turns on for one project only. An agent in a T3 thread saves the result of the T3 tool `orchestrator_capabilities` to a temp file and passes it with `--capabilities <file>`. Then a harness is detected when T3 has a provider of its driver that can run child tasks.

`--write` changes only the `harnesses` key of one file, with the file rule described above. `--dry-run` previews the change, and `--yes` accepts without a prompt. When every harness is detected, it removes the key. One case keeps the key: the file is the project config, and the user config sets a `harnesses` value that leaves out a detected harness. Then the project config gets the full list, so that it overrides the user value. `omt doctor` prints a `harnesses` line with the effective value.

## Move a `roles.test` override

The `test` role was renamed to `qa`. Move each `roles.test` override to `qa`. omt now reads the old key as a custom role and warns `role "test" was renamed to "qa"; rename it`. A partial `roles.test` override fails validation, because it has no `description`, `access`, or `chain`.

## Remove the retired keys

The main thread runs the build, so the keys that served per-unit dispatch have no job left. These keys and roles are retired:

- `workflow.build.verify`, `workflow.build.checkpoint`, and `workflow.build.stallMinutes`, in any profile.
- `limits.maxTasksPerRun`, at the root or in a profile.
- The roles `verify`, `quick`, and `deep`, at the root or in a profile. `qa` now runs the checks and the device flows that `verify` ran.

A config file that still sets one of them loads. omt ignores the key and prints one warning for each key, such as `profiles.normal.workflow.build.checkpoint is no longer used; remove it`. Delete the key to clear the warning.

## Remove the `pr-review` profile

The `pr-review` profile was removed, because `normal` now runs all PR steps. To review a pull request, type `omt-code-review <number>`. A config file that still declares `profiles.pr-review` loads with the warning `profiles.pr-review is no longer used; remove it`. A selection of `pr-review` by the `profile` key, `--profile`, a plan header, or `extends` uses `normal` and warns `profile "pr-review" is no longer used; normal runs the PR steps`. Delete the declaration and change each selection to `normal` to clear the warnings.

## Remove the `visuals` key

omt no longer shows a plan as a page, so the `visuals` key has no effect. `omt-plan` writes the plan summary in its reply. A config file that still sets `visuals` loads with the warning `visuals is no longer used; remove it`. Delete the key to clear the warning.

## Check for updates

The `update` key turns on a check for a new omt version. Set it in the user config:

```jsonc
{
  "update": "check"
}
```

| Value | Effect |
| --- | --- |
| `off` | No check. An absent key means `off`. |
| `check` | `omt install` and `omt doctor` ask the npm registry for the latest version, at most once a day. `omt doctor` prints an `update` line. When a new version is out, `omt install` prints `note: omt <version> is out; run omt update`. |
| `apply` | The same check. When a new version is out and the command runs at a terminal, `omt install` and `omt doctor` then run `omt update --yes`, once for each new version. Without a terminal, they print only the note. The automatic update also accepts the current defaults. |

Only the user config can set the key. In the project config, omt prints the warning `update is read only from the user config; remove it from <file>` and ignores the key. So a cloned repository cannot turn on network calls. The user starter config holds the key as a comment.

omt asks the registry only in `omt install`, `omt doctor`, and `omt update`. The hook and the commands that agents call, such as `omt brief` and `omt roles`, never use the network. omt saves the result of the check in `update-check.json`, in the folder of the user config. A failed check, for example when the machine is offline, gives an `INFO` line in `omt doctor` and does not change its exit code. omt tries again the next day. [Update omt](install.md#update-omt) explains the update itself.

## See where each value comes from

A value can come from the accepted defaults, the user config, the project config, or a profile. To see which of them sets each value, run:

```sh
omt config explain
```

Each line holds the dotted path, the value, and the layer that sets it: `defaults`, `user`, `project`, or `profile <name> (<layer that declares the value>)`. Below a value, each `over <layer>: <value>` line names a lower layer that also sets the path, highest first. The `root` block holds the merged config that `omt config show` prints. The `effective` block holds the `roles`, `limits`, `models`, and `workflow` values after omt applies the profile, as `omt profile show` resolves them. A `removed` block, when present, lists each role or profile that a config file removes with `null`.

In this example, the user config adds a profile `fast-proto` that extends `prototype` and sets `limits.maxParallel` to 2, and the project config sets `limits.maxParallel` to 4. The output is shortened:

```sh
omt config explain --profile fast-proto
```

```text
user: <home>/.config/oh-my-t3code/config.jsonc
project: <project>/.omt/config.jsonc
defaults: <home>/.config/oh-my-t3code/install.json
profile: fast-proto (argument)
root:
limits.maxParallel  4  project
  over defaults: 6
effective:
limits.maxParallel  2  profile fast-proto (user)
  over project: 4
limits.maxReviewRounds  2  profile prototype (defaults)
  over defaults: 4
```

Without `--profile`, omt explains the selected profile. `--json` prints the same report as JSON, with the full file path of each source. Config issues go to stderr. When the profile resolves, the command prints the report and exits 0, also when an issue is an error. When it does not resolve, the command prints no report. An unknown profile exits 2, and a profile cycle or a chain of more than 8 profiles exits 1.

## Edit the config in a browser

To edit the user config and the project config in a browser page, run:

```sh
omt config edit --web
```

```text
omt config editor: http://127.0.0.1:<port>/<token>/
Press Ctrl-C to stop. The editor also stops when you close its tab.
```

omt starts a local server and opens the URL in your default browser. With `--no-open`, it only prints the URL, and you open it yourself. The page reads the same value sources as `omt config explain`. The editor edits only a config file that exists, so run `omt config init` or `omt init` first.

With `--capabilities <file>`, the role editor lists the providers, models, effort levels, and fast mode that T3 reports. The file holds the output of the T3 tool `orchestrator_capabilities`, as for `omt detect`. The `omt-setup` skill can save this file and start the editor for you. Without the file, the provider list holds the harnesses that `omt detect` finds, and the model list holds the models that the config already names.

The page opens on **Skills**. It lists the 10 bundled skills. Build, Code review, Plan, and Design have a configured flow: select a stage to edit its settings. The flow shows conditions, review loops, QA retries, and the responsible actor. It does not show a live run. Every skill page shows the child roles that the skill starts and its instructions, the `SKILL.md` of the installed omt. The instructions are read-only, because `omt update` replaces the skill files.

**Roles** lists child tasks and their model chains. Provider, Model, and Effort are dropdowns, and **Other model…** accepts a model that the list does not hold. **Profiles** shows each profile with the values that it changes and the three ways to use it: `--profile <name>` in the T3 composer for one run, **Make default** for every run, and `omt plan profile <slug> <name>` for a running plan. **Settings** holds the harnesses, the limits, and the model options. Each value has a source badge. Select the badge for help, source history, the exact edit path, and **Reset to inherited**.

To change a value:

1. Select a profile in **Show values for**. This shows the values of that profile on every page, and changes nothing that runs. While it loads, edits pause. If it fails, the page keeps the last profile that loaded.
2. Select **Edit file** to choose Project or User. A missing optional file is gray and unavailable. The file help gives its path and init command.
3. Select the edit scope. **Base settings** writes a root key. **Profile: <name>** writes a profile key. Workflow keys always belong to the preview profile. A warning identifies an edit that a higher layer overrides.
4. Change the value in its row or stage panel. Dropdowns and segments stage changes immediately. Text and number fields stage changes on Enter or change. The row shows **Unsaved** and **Undo**. Role and profile forms use **Add changes** for their draft fields.
5. Select **Review changes**, or press Ctrl-Enter. Use Cmd-Enter on macOS. The review shows the edits, the JSONC diff, and validation for one file.
6. Select **Write project file** or **Write user file**. Each write changes one file. Changes for the other file stay unsaved.

**Saved default** is separate from **Show values for**. Changing it stages an edit to the selected file's `profile` key. A command's profile or a plan header can still take precedence.

The page follows these rules:

- The flows, the profile editor, and Settings share the same unsaved changes. A change in one view updates the others.
- Profiles can override base settings. Other profiles inherit unset keys from `normal`.
- **Reset to inherited** stages removal of a key from the selected file. Removing a role stages `null`. These actions have different effects.
- A model chain shows its configured first choice and fallbacks. Reorder cards by drag or the arrow buttons. Fast mode has **Inherit**, **On**, and **Off**. Each card shows **Available in T3**, **Not in T3**, or **Model not in T3** when the editor has the T3 capabilities, and **Unverified** without them. A model that has no fast mode disables **On**.
- For a cross-family role, **Main driver** previews the attempt order. Rung numbers keep their configured positions.
- **Harnesses** has one checkbox for each driver, with what the editor detected. All on removes the `harnesses` key.
- Unsaved form input stays when you change views, edit scope, or files. If its file changed, **Keep my edit** or **Discard** resolves the stale draft before you stage it.
- The page asks before you leave with unsaved changes or form input. Changes remain in this tab until you write them.
- If a file changes on disk, **Reload and review** keeps its unsaved changes and loads the newer file. Review the new diff before writing. **Discard changes** asks before it removes that file's changes.
- New validation errors block a write. Warnings do not. A file that does not parse cannot be an edit destination.
- If the server stops, the page becomes read-only and keeps unsaved changes in the tab. Start `omt config edit --web` again to edit.
- Defaults are read-only. Use `omt doctor` or `omt update` to review and accept current defaults.

Each write follows these rules:

- omt computes the diff of the file first. A preview returns the diff and writes nothing.
- omt changes only the edited values. The comments and the layout of the rest of the file stay. Comments inside a value that a write replaces as a whole, such as a role chain, are lost.
- omt refuses a write that adds a validation error, and writes nothing.
- omt refuses a write when the file changed on disk after the page loaded it, and writes nothing. Reload the page to load the new file.

The server listens on 127.0.0.1 only, and the URL holds a random port and a random token. Do not share the URL. The editor stops when you press Ctrl-C, about 5 seconds after you close its tab, or when the page sends no ping for 2 minutes. A reload keeps it running. The command then prints `editor stopped` and exits 0.

## Inspect the config

- `omt config path` prints the paths of the user and project configs.
- `omt config show --defaults` prints the installed release's current defaults: the built-in profiles, roles, models, and limits.
- `omt config show` prints the merged config before omt applies the profile.
- `omt config explain` prints the layer that sets each value. See [See where each value comes from](#see-where-each-value-comes-from).
- `omt config edit --web` opens an editor for both config files in a browser. See [Edit the config in a browser](#edit-the-config-in-a-browser).
- `omt profile show <name> --json` prints the values after omt applies the profile.
- `omt config validate` reports problems in your files and in every profile.
- `omt doctor --dry-run` shows pending defaults changes without writing.
- `omt detect` prints the harnesses that omt finds and the `harnesses` value that fits them.
