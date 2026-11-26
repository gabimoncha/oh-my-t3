# Configure roles and profiles

omt reads two config files:

- The user config, `~/.config/oh-my-t3/config.jsonc`, applies to all projects. `omt install` and `omt config init` create it.
- The project config, `.omt3/config.jsonc`, overrides the user config for one project. `omt install --project` and `omt init` create it.

`omt config path` prints both paths and says which files exist. `omt config init` writes the user starter config, and `--force` overwrites an existing file.

Run `omt config validate` after each change. It checks every key of both files and every profile, including the profiles that you do not select. It exits 1 on an error. The [spec](spec.md#62-layer-validation) has the full schema and the merge rules.

To let omt make a change for you, ask the agent in a T3 thread to set up omt. The `omt-setup` skill runs the commands on this page, shows each change, and asks before it writes. The same skill answers questions about omt: ask `$omt-setup`.

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

A role, such as `execute` or `review`, maps to an ordered chain of provider, model, and effort. The agent uses the first entry that T3 accepts. Each entry in the chain is a candidate.

| Role | Use | Used by | First choice | Fallback |
| --- | --- | --- | --- | --- |
| `explore` | Answer one narrow question about this repository | `omt-plan`, `omt-ulw` | GPT-6.2-Sol, low | Claude Sonnet 5.5, low |
| `research` | Answer a question from docs, the web, and code | `omt-ulw` | GPT-6.2-Sol, medium | Claude Sonnet 5.5, medium |
| `plan-review` | Check a plan for gaps | `omt-plan` | GPT-6.2-Astra, high | Claude Fable 5.2, high |
| `execute` | Implement one planned unit that the main thread hands off as an independent track | `omt-ulw` | Claude Opus 5.5, medium | GPT-6.2-Sol, high |
| `review` | Review a diff against its brief, fix local findings, and report the rest | `omt-ulw`, `omt-code-review` | GPT-6.2-Sol, xhigh, ultrafast | GPT-6.2-Sol, xhigh, then Claude Opus 5.5, high |
| `oracle` | Attack the finished change before it counts as done, fix local findings, and report the rest | `omt-ulw`, `omt-code-review` | GPT-6.2-Sol, xhigh, ultrafast | GPT-6.2-Sol, xhigh, then Claude Fable 5.2, medium |
| `qa` | Run the check commands and device flows, and return each exit code with its log and screenshots. Edits nothing. | `omt-ulw`, `omt-code-review` | GPT-6.2-Sol, medium | Claude Sonnet 5.5, medium |
| `judge` | Score blind-labeled screenshots or outputs from 0 to 10 in each category. Edits nothing. | `omt-climb` | GPT-6.2-Sol, medium | Claude Opus 5.5, medium |
| `writing` | Write or edit documentation in one docs unit that the main thread hands off as an independent track | `omt-ulw` | Claude Opus 5.5, medium | GPT-6.2-Sol, medium |
| `design` | Design screens and flows, and write a design spec | `omt-design` | Claude Fable 5.2, medium | GPT-6.2-Sol, high |
| `ui` | Implement one UI unit from a design spec or task requirements | `omt-ulw` | Claude Fable 5.2, medium | GPT-6.2-Sol, high |

The table shows the current defaults. The fallback runs when T3 refuses the first choice. You review the designs. `review` and `oracle` start on GPT-6.2-Sol with the ultrafast service tier, because it gives the fastest reviews. GPT-6.2-Astra is a default only in `plan-review`.

The `plan` role was removed, because the main thread writes every plan itself. The `grill` role was removed, because `omt-plan` now runs the stress test of a goal in the main thread. The `guardrail` role was removed with the `review.guardrails` extra, because it only wrote proposals that nothing applied. A config file that still sets `roles.plan`, `roles.grill`, or `roles.guardrail` loads with the warning `roles.<name> is no longer used; remove it`.

`plan-review`, `review`, and `oracle` are cross-family roles. The reviewer comes from the model family that did not do the work. GPT reviews Claude work: GPT-6.2-Astra in `plan-review`, and GPT-6.2-Sol in `review` and `oracle`. Claude reviews GPT work: Claude Fable 5.2 in `plan-review` and `oracle`, and Claude Opus 5.5 in `review`. The skills pass the worker to `omt brief --against`, and the CLI puts the candidates of the other family first. When the other family is not available, the same family reviews. A build oracle uses the family that did not do most of the implementation. A review oracle uses the family that did not do most of the reviews.

Claude models run on the `claudeAgent` driver, and GPT models run on the `codex` driver. Each default candidate also names the T3 built-in provider instance of its driver. T3 checks a named instance again before it refuses it. A target with only a driver can fail because of an old provider snapshot.

The read-only roles are `explore`, `research`, and `plan-review`. They run in T3 plan mode. On Claude, Codex, Cursor, and OpenCode, plan mode stops the child from editing files. T3 has no plan mode for Pi, so only its brief stops a Pi child in a read-only role. No default role uses Pi.

`review` and `oracle` can edit files. In an `omt-ulw` build, the reviewer fixes each local finding itself: a clear fix inside the changed files that agrees with the plan summary. It reports every other finding. `omt-code-review` still runs its reviewers in plan mode, so they only report. `qa` has edit access only to run commands and write logs. Its brief forbids edits in the repository, and it writes no tests. `qa` tries GPT-6.2-Sol first, then Claude Sonnet. If a local tool is unreachable, the workflow retries once on the other provider. Only `qa` drives a device, a simulator, a browser, or a computer.

Run `omt roles` to see how each role resolves with your config.

## Change a role

This example turns off cross-family review. After the change, `review` always starts on GPT-6.2-Sol and falls back to Claude Opus 5.5, also when GPT made the change.

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

A chain holds 1 to 10 candidates. A candidate has these fields:

| Field | Value |
| --- | --- |
| `provider` | The id of one T3 provider instance, such as `codex`. |
| `driver` | The driver of the provider, such as `claudeAgent` or `codex`. A candidate needs `provider`, `driver`, or both. |
| `model` | The model id. Required. |
| `effort` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. omt maps it to the effort option of the model. |
| `fast` | `true`, `false`, or `"ultrafast"`. See [Set fast mode per role](#set-fast-mode-per-role). |
| `options` | Raw T3 model options, as an object of strings and booleans. |

`options` goes to T3 as it is, after omt applies the effort and fast mode, so a value in `options` wins over both. With `--capabilities`, omt checks each option id and value against the options that the model advertises. Without it, T3 checks them when the task starts. This candidate asks Codex for the priority service tier:

```jsonc
{
  "roles": {
    "review": {
      "chain": [
        { "driver": "codex", "model": "gpt-6.2-astra", "effort": "high", "options": { "serviceTier": "priority" } },
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
| `chain` | 1 to 10 candidates. | Required. |
| `result` | The result block that the child ends with: `work`, `review`, `test`, `research`, or `plan`. The retired kinds `grill` and `guardrail` are errors that say to use `review`. | `work` for `edit`, `research` for `read-only`. |
| `t3Role` | The `role` value that omt passes to the T3 `delegate_task` tool: `implementation`, `research`, `review`, `design`, `test`, or `general`. | `implementation` for `edit`, `research` for `read-only`. |
| `interactionMode` | The T3 interaction mode of the child: `inherit`, `default`, or `plan`. `plan` stops the child from editing files. | `default` for `edit`, `plan` for `read-only`. |
| `runtimeMode` | The T3 runtime mode of the child: `inherit`, `approval-required`, `auto-accept-edits`, `auto`, or `full-access`. A child cannot get a broader mode than its parent thread. | `inherit`. |
| `crossFamily` | `true` puts the candidates of the other family first when the skill names the worker. | `false`. |
| `fast` | `true`, `false`, or `"ultrafast"`. | Not set. |

This role runs a security review on GPT-6.2-Astra in plan mode:

```jsonc
{
  "roles": {
    "security": {
      "description": "Review a diff for security problems and report findings by severity.",
      "access": "read-only",
      "result": "review",
      "t3Role": "review",
      "chain": [{ "driver": "codex", "model": "gpt-6.2-astra", "effort": "high" }]
    }
  }
}
```

If the project still has an `.omt/` folder from an earlier release, write the config there, or move the folder to `.omt3/` first. A new `.omt3/` folder makes omt read `.omt3/` and stop reading the config and plans in `.omt/`.

To give a role its own persona, write `.omt3/roles/<role>.md`. The file content is the persona and the rules for that role, and it replaces the bundled persona. omt looks in `.omt3/roles/`, then in `~/.config/oh-my-t3/roles/`, then in the bundled personas.

## Choose a profile

A profile is a named set of workflow switches, limits, and role overrides. omt has two presets:

- `normal` reviews the build again after each round of fixes, and the reviewer of a HEAVY run is the oracle. The main thread proves that each new test can fail. A design pass draws 3 variants per screen.
- `prototype` reviews the build once, with one plan reviewer on any family. It skips the oracle and the failure proofs, allows 2 review rounds, and draws 1 design variant per screen.

Both presets turn off the four PR extras of `omt-code-review`: `review.ci`, `review.verify`, `review.tests`, and `review.crap`. [Turn on the PR extras](#turn-on-the-pr-extras) shows how to get them back.

Run `omt profile list` to see the presets and your custom profiles. Run `omt profile show prototype --json` to see the resolved workflow, limits, roles, and models of one profile.

To use the prototype profile for one build, type this in a T3 thread:

```text
$omt-ulw --profile prototype build a demo of the search screen
```

To switch the profile of a running plan, run `omt plan profile <slug> normal`. `omt plan profile <slug> none` removes the plan override. The change applies to the remaining work of the plan.

omt selects the profile in this order: the `--profile` flag, the plan header, the project config, the user config, and then `normal`. omt merges the config files first. Then the selected profile applies the profiles that it extends.

## Write a custom profile

Add the profile under `profiles` in either config file. The starter configs hold a commented example, `fast-proto`. A profile has these fields:

| Field | Value |
| --- | --- |
| `description` | Text of at most 300 characters. Required for a new profile. Without it, omt drops the profile and `omt config validate` reports the error. |
| `extends` | The name of the parent profile. A profile without `extends` inherits `normal`. |
| `t3Workflow` | `true` runs the review and QA steps of `omt-ulw` and the reviewers of `omt-code-review` as T3 workflows when T3 Workflows is on. Default `false`. A child profile inherits it. See [Run the review and QA steps as T3 workflows](workflows.md#run-the-review-and-qa-steps-as-t3-workflows). |
| `workflow` | Switches of the plan, design, build, and review steps, per group and key. The `git` group is retired: a config that still sets it loads with a warning, and `omt update`, `omt doctor`, and `omt install` remove it. The [spec](spec.md#67-profiles-and-workflow) lists every key and its values. |
| `limits` | Limits for runs with this profile. See [Set limits](#set-limits). |
| `roles` | Role overrides, with the fields of [Add a custom role](#add-a-custom-role). |
| `models` | Settings per model id. The only setting is `fast`. |

A profile cannot set `harnesses`, `update`, or `defaults`. These keys apply to the whole config file.

This profile builds like `prototype`, with failure proofs, fast `execute` and `ui` workers, at most 3 review rounds, and GPT-6.2-Sol without fast mode in each candidate that sets no `fast` of its own:

```jsonc
{
  "profile": "hackathon",
  "profiles": {
    "hackathon": {
      "description": "Use the prototype workflow with fast workers and failure proofs.",
      "extends": "prototype",
      "workflow": { "build": { "failureProofs": "on" } },
      "limits": { "maxReviewRounds": 3 },
      "roles": { "execute": { "fast": true }, "ui": { "fast": true } },
      "models": { "gpt-6.2-sol": { "fast": false } }
    }
  }
}
```

The role `fast` wins over the model `fast`. So in `execute`, the GPT-6.2-Sol fallback still gets `serviceTier: "priority"`. In `qa` and `research`, which do not set `fast`, GPT-6.2-Sol runs without fast mode. The first candidates of `review` and `oracle` set `"fast": "ultrafast"` themselves, and a candidate `fast` wins over both, so they keep the ultrafast tier. To run them without it, give `review` and `oracle` their own `chain` in `roles`. `omt route execute --profile hackathon` prints the targets.

### Turn on the PR extras

A pull request review runs the four PR extras only when a profile turns them on. In the user config, this profile turns on all four for every project, with the values that `normal` had before this release:

```jsonc
{
  "profile": "full-review",
  "profiles": {
    "full-review": {
      "description": "Run every PR review extra.",
      "workflow": {
        "review": { "ci": "fix", "verify": "changed-flows", "tests": "offer", "crap": "report" }
      }
    }
  }
}
```

[Turn on the PR extras](workflows.md#turn-on-the-pr-extras) says what each extra adds. To use the profile for one review only, leave out the `profile` key and type `omt-code-review <number> --profile full-review`.

### Pick the design tool

`workflow.design.tool` picks the tool that `omt-design` draws with. `paper`, the default, draws in a new Paper file when the Paper tools load in the thread, and in self-contained HTML mockups otherwise. `html` always draws HTML mockups:

```jsonc
{
  "profiles": {
    "normal": { "workflow": { "design": { "tool": "html" } } }
  }
}
```

### What a profile cannot change

A profile can turn steps on or off and change their settings. It cannot add a step or change the order of the steps. A profile applies after the root keys of the config files, so its `roles`, `limits`, and `models` win over the root values. `omt profile show <name> --json` prints the result.

## Set limits

Set limits at the root of a config file, or in a profile:

```jsonc
{
  "limits": { "maxDepth": 2, "maxReviewRounds": 3 }
}
```

| Limit | What it counts | Range | Default |
| --- | --- | --- | --- |
| `maxDepth` | Levels of child tasks below the main thread. At the maximum depth, a child does the work itself. | 0 to 3 | 1 |
| `maxReviewRounds` | Reviews of one build, and fix review rounds of one code review, before the main thread stops and asks you. A plan review has at most 2 rounds. | 1 to 10 | 4 |

Each value must be an integer. `prototype` sets `maxReviewRounds` to 2.

A run has no task budget and no parallel limit: T3 tracks the child tasks. `limits.maxTasksPerRun` and `limits.maxParallel` were removed, and `omt plan new --tasks` fails with a usage error. A plan header that still has a `max-tasks` or `max-parallel` key has no effect, and `omt plan status` prints a warning for it.

## Set fast mode per role

```jsonc
{
  "roles": {
    "execute": { "fast": true },
    "qa": { "fast": false }
  }
}
```

The first value that is set wins: the candidate `fast`, the role `fast`, the model `fast`, and then `false`. GPT-6.2-Sol and GPT-6.2-Astra have fast mode on by default. For a model that supports it, `true` becomes `serviceTier: "priority"` or `fastMode: true`. A model without fast mode keeps its target, and omt reports a note. A value in `candidate.options` wins over this mapping. `false` adds no fast option.

`"ultrafast"` asks for the Codex ultrafast service tier, `serviceTier: "ultrafast"`, instead of `priority`. Today only GPT-6.2-Sol offers it. With `--capabilities`, a model without the tier gets fast mode and a note. Without it, T3 rejects the tier on such a Codex model, and the dispatch moves to the next target, so set `"ultrafast"` only on models that offer it:

```jsonc
{
  "models": { "gpt-6.2-sol": { "fast": "ultrafast" } }
}
```

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

The default chains use two harnesses: Claude Code, on the `claudeAgent` driver, and Codex, on the `codex` driver. When your machine runs only one of them, the `"harnesses"` key tells omt to skip the candidates of the other:

```jsonc
{
  "harnesses": ["codex"]
}
```

With this value, `omt roles` marks each Claude candidate as `harness claudeAgent is not enabled (harnesses: codex); run omt detect`, and the next candidate runs. `design` and `ui` fall back to GPT-6.2-Sol. The cross-family roles review with the same family. Without the key, omt uses every candidate. The key holds 1 to 10 driver kinds, and a project value replaces the user value as a whole.

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
<project>/.omt3/config.jsonc: harnesses none -> ["codex"]
run omt detect --write to apply
```

A harness is detected when T3 does not disable it in `~/.t3/userdata/settings.json` (or `$T3CODE_HOME/userdata/settings.json`) and its executable, `claude` or `codex`, is on `PATH`. omt does not read T3's settings per project, so it can miss a harness that T3 turns on for one project only. An agent in a T3 thread saves the result of the T3 tool `orchestrator_capabilities` to a temp file and passes it with `--capabilities <file>`. Then a harness is detected when T3 has a provider of its driver that can run child tasks.

`--write` changes only the `harnesses` key of one file, with the file rule described above. `--dry-run` previews the change, and `--yes` accepts without a prompt. When every harness is detected, it removes the key. One case keeps the key: the file is the project config, and the user config sets a `harnesses` value that leaves out a detected harness. Then the project config gets the full list, so that it overrides the user value. `omt doctor` prints a `harnesses` line with the effective value.

## Move a `roles.test` override

The `test` role was renamed to `qa`. Move each `roles.test` override to `qa`. omt now reads the old key as a custom role and warns `role "test" was renamed to "qa"; rename it`. A partial `roles.test` override fails validation, because it has no `description`, `access`, or `chain`.

## Remove the retired keys

The main thread runs the build, so the keys that served per-unit dispatch have no job left. These keys and roles are retired:

- `workflow.build.verify`, `workflow.build.checkpoint`, and `workflow.build.stallMinutes`, in any profile.
- `workflow.review.guardrails`, in any profile.
- `limits.maxTasksPerRun` and `limits.maxParallel`, at the root or in a profile.
- The roles `verify`, `quick`, and `deep`, at the root or in a profile. `qa` now runs the checks and the device flows that `verify` ran.

A config file that still sets one of them loads. omt ignores the key and prints one warning for each key, such as `profiles.normal.workflow.build.checkpoint is no longer used; remove it`. `omt update`, `omt doctor`, and `omt install` remove these keys for you, with no prompt, because they have no effect. Each prints `removed the retired keys from <config>: <paths>` and keeps your comments and other settings. This applies to every retired key on this page, also `roles.grill`, `roles.guardrail`, `profiles.pr-review`, and `visuals`. With `--dry-run`, the line says `would remove` and nothing changes.

The same commands delete an empty `.omt3/guardrails.md` from an earlier release. A `guardrails.md` with text stays, because it holds proposals that agents wrote for you. omt no longer reads it, and `.omt3/.gitignore` keeps it out of git. `omt doctor --project` reports it as an `INFO` line with the id `leftovers`. Delete the file when you no longer need it. They also delete `.omt3/ledger.jsonl` and `.omt3/locks/`, which the removed `omt ledger` and `omt lock` wrote.

## Remove the `pr-review` profile

The `pr-review` profile was removed, because `normal` now runs all PR steps. To review a pull request, type `omt-code-review <number>`. A config file that still declares `profiles.pr-review` loads with the warning `profiles.pr-review is no longer used; remove it`. A selection of `pr-review` by the `profile` key, `--profile`, a plan header, or `extends` uses `normal` and warns `profile "pr-review" is no longer used; normal runs the PR steps`. Delete the declaration and change each selection to `normal` to clear the warnings.

## Remove the `visuals` key

omt no longer shows a plan as a page, so the `visuals` key has no effect. `omt-plan` writes the plan summary in its reply. A config file that still sets `visuals` loads with the warning `visuals is no longer used; remove it`. Delete the key to clear the warning.

## Check for updates

omt checks for a new version once a day. To stop the check, set the `update` key in the user config:

```jsonc
{
  "update": "off"
}
```

| Value | Effect |
| --- | --- |
| `off` | No check. |
| `check` | The default. `omt install` and `omt doctor` ask the npm registry for the latest version, at most once a day. `omt doctor` prints an `update` line. When a new version is out, `omt install` prints `note: omt <version> is out; run omt update`. |
| `apply` | The same check. When a new version is out and the command runs at a terminal, `omt install` and `omt doctor` then run `omt update --yes`, once for each new version. Without a terminal, they print only the note. The automatic update also accepts the current defaults. |

Only the user config can set the key. In the project config, omt prints the warning `update is read only from the user config; remove it from <file>` and ignores the key. So a cloned repository cannot change the mode. The user starter config holds the key as a comment.

When the user config has no `update` key and the `CI` or `NO_UPDATE_NOTIFIER` variable is set, omt does not check. A value of `0` or `false` does not count. CI jobs and machines without network access thus send no request. An `update` key in the user config wins over these variables.

omt asks the registry only in `omt install`, `omt doctor`, and `omt update`. The commands that agents call, such as `omt brief` and `omt roles`, never use the network. omt saves the result of the check in `update-check.json`, in the folder of the user config. A failed check, for example when the machine is offline, gives an `INFO` line in `omt doctor` and does not change its exit code. omt tries again the next day. [Update omt](install.md#update-omt) explains the update itself.

## See where each value comes from

A value can come from the accepted defaults, the user config, the project config, or a profile. To see which of them sets each value, run:

```sh
omt config explain
```

Each line holds the dotted path, the value, and the layer that sets it: `defaults`, `user`, `project`, or `profile <name> (<layer that declares the value>)`. Below a value, each `over <layer>: <value>` line names a lower layer that also sets the path, highest first. The `root` block holds the merged config that `omt config show` prints. The `effective` block holds the `roles`, `limits`, `models`, and `workflow` values after omt applies the profile, as `omt profile show` resolves them. A `removed` block, when present, lists each role or profile that a config file removes with `null`.

In this example, the user config adds a profile `fast-proto` that extends `prototype` and sets `limits.maxDepth` to 2, and the project config sets `limits.maxDepth` to 0. The output is shortened:

```sh
omt config explain --profile fast-proto
```

```text
user: <home>/.config/oh-my-t3/config.jsonc
project: <project>/.omt3/config.jsonc
defaults: <home>/.config/oh-my-t3/install.json
profile: fast-proto (argument)
root:
limits.maxDepth  0  project
  over defaults: 1
effective:
limits.maxDepth  2  profile fast-proto (user)
  over project: 0
limits.maxReviewRounds  2  profile prototype (defaults)
  over defaults: 4
```

Without `--profile`, omt explains the selected profile. `--json` prints the same report as JSON, with the full file path of each source. Config issues go to stderr. When the profile resolves, the command prints the report and exits 0, also when an issue is an error. When it does not resolve, the command prints no report. An unknown profile exits 2, and a profile cycle or a chain of more than 8 profiles exits 1.

## Inspect the config

- `omt config path` prints the paths of the user and project configs.
- `omt config show --defaults` prints the installed release's current defaults: the built-in profiles, roles, models, and limits.
- `omt config show` prints the merged config before omt applies the profile.
- `omt config explain` prints the layer that sets each value. See [See where each value comes from](#see-where-each-value-comes-from).
- `omt profile show <name> --json` prints the values after omt applies the profile.
- `omt config validate` reports problems in your files and in every profile.
- `omt doctor --dry-run` shows pending defaults changes without writing.
- `omt detect` prints the harnesses that omt finds and the `harnesses` value that fits them.
