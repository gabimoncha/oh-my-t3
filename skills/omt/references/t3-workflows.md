# T3 workflows

Read this file when `omt profile show --json` prints `"t3Workflow": true`. Then T3 runs the fixed steps as a durable workflow, and you keep the judgment steps:

- `omt-ulw` steps 8 to 11 (review, fixes, QA, QA re-runs) run as the workflow `omt-ulw`.
- `omt-code-review` steps 3 to 5 (reviewers and oracle) run as the workflow `omt-code-review`.

The workflow agents run in their own threads. You start no child for these steps.

`omt-climb` runs only as the workflow `omt-climb`, whatever `t3Workflow` says, and has no in-thread steps. Its skill gives the start and the stop rule; [its input](#omt-climb-input) is below.

## Start a run

1. Write the input JSON of [omt-ulw](#omt-ulw-input) or [omt-code-review](#omt-code-review-input) to a temp file.
2. Run `t3 workflow start <workflow> --input "$(cat <file>)" --key <key>`.
3. When step 2 fails, or `$T3CODE_THREAD_ID` is empty, print one line, `t3 workflow unavailable: <first error line>; running the steps in this thread`, and run the in-thread steps.
4. Tell the owner the run id and that the Workflows page shows it. End your turn.

The run's last step sends a message to this thread, `omt-<name> workflow run <id> ...`. A run that stops or is cancelled sends one too. Then run `t3 workflow show <id> --json` and read `run.result`.

On T3 `v0.1.13-nightly.20261125.5258` or later, use the skill tag or subject to find the run. On `v0.1.12`, use the run id.

Done when: the run started and your turn ended, or the in-thread steps run.

## omt-ulw input

Before the run, commit the build with `omt git commit -m "<message>" --plan <slug>`. `base` is the commit before your first build commit of the run. Key: `omt-ulw/<slug>/<head>`.

```json
{
  "project": "<omt paths --root>",
  "plan": "<slug>",
  "round": 1,
  "base": "<commit before the build>",
  "head": "<git rev-parse HEAD>",
  "review": "<oracle | review | off, by step 8>",
  "family": "<your driver>",
  "context": "<objective, done conditions, plan Summary>",
  "scope": ["<scope path>"],
  "checks": ["<each verify command and final check command>"],
  "flows": "<device flows with steps and expected results, or empty>",
  "thread": "<$T3CODE_THREAD_ID>",
  "omt": ["<omt, or the omt paths --shim path when that file exists>"]
}
```

The reviewer fixes and commits in its worktree. QA checks that commit in its own worktree. With `T3.within`, QA shares one place in the server-wide `omt-qa` pool. After a failed check, the reviewer fixes it and QA retries, at most twice. The workflow opens no PR.

When the message comes:

1. When `result.head` differs from your `HEAD`, run `git merge --ff-only <result.head>`. When that fails, run `git merge <result.head>`.
2. Apply step 9 to `result.review.findings`. When you change code, run the workflow again with the next `round`, the new `head`, and `review` set to `off` with `build.review: first-round`.
3. `verified`: mark each `D` and `F` item done from `result.qa.checks`, then go to step 12. `checks-failed`: ask the owner with each failed command, exit code, and log. `blocked`: follow the `BLOCK` rule of step 9.

## omt-code-review input

Start it after step 2. Key: `omt-code-review/<slug>/r<round>`.

```json
{
  "project": "<omt paths --root>",
  "checkout": "<git rev-parse --show-toplevel>",
  "slug": "<slug>",
  "round": 1,
  "intent": "<what the change does, and the rule files of a PR>",
  "groups": [{ "unit": "G1", "role": "review", "task": "<diff command, paths, intent>", "against": "" }],
  "oracle": "<your driver, or null>",
  "fixLoop": true,
  "thread": "<$T3CODE_THREAD_ID>",
  "omt": ["omt"]
}
```

- The small shape is one group with `"unit": "oracle"` and `"role": "oracle"` when `review.oracle` is `on`. Then `oracle` is `null`.
- The large shape has one `review` group per file group, and `oracle` is your driver when `review.oracle` is `on`.
- With `review.families: both`, set each group's `against` and `unit` as step 2 says.
- `fixLoop` is `true` with `review.fixLoop: offer`. The owner answers on the Workflows page, with an optional reason. `result.fix` holds the answer.
- Reviewers run in plan mode and read the change with `git -C <checkout>`, so uncommitted changes count.

When the message comes, merge `result.groups` and `result.oracle` by step 4, and report by step 6. With `result.fix` `approved`, fix in this thread. Follow the owner's reason when the message includes `(owner: <reason>)`. The fix review is the next round with one `FIX` group, `"against": "<your driver>"`, and no oracle.

## omt-climb input

Start it after `omt-climb` step 2. Key: `omt-climb/<slug>/<head>/<UTC time of the launch>`, new for each launch.

```json
{
  "project": "<omt paths --root>",
  "checkout": "<git rev-parse --show-toplevel>",
  "slug": "<slug>",
  "head": "<git rev-parse HEAD>",
  "goal": "<objective and its limits, for the change agent>",
  "rubric": "<what the judges score; no target, no round>",
  "categories": ["<category>"],
  "target": 9,
  "direction": "up",
  "maxRounds": 10,
  "plateau": { "rounds": 2, "minGain": 0.2 },
  "judges": [{ "name": "sol", "tier": 1, "against": "", "command": "" }],
  "references": [{ "name": "<reference>", "files": ["<absolute path>"] }],
  "beat": ["<reference>"],
  "gates": ["<command>"],
  "capture": "<command that writes files to $OMT_CLIMB_OUT, or empty>",
  "change": "execute",
  "evidence": "<omt paths --evidence>",
  "thread": "<$T3CODE_THREAD_ID>",
  "omt": ["<omt, or the omt paths --shim path when that file exists>"]
}
```

- A judge with a `command` runs it in each round's checkout and reads the number on its last line. A judge with an empty `command` is the `judge` role, with `--against <against>` when `against` is set.
- Names of judges, references, and categories match `^[a-z0-9][a-z0-9-]{0,31}$`. Empty `categories` gives one category, `overall`.
- Round 1 runs the gates and the capture in `checkout` at `head`, and its capture is the baseline. Each round first checks that its checkout is at its commit with no uncommitted change to a tracked file. Later rounds run them in the change agent's worktree.
- Each round copies the files of `current`, `baseline`, and each reference to `<evidence>/climb-<key>/<label>-<k>.<ext>` under a random key and shuffled letter labels. The baseline score corrects each judge's drift.
- One agent thread of the `change` role makes every change from the judges' findings and commits it in its own worktree. It fixes a failed gate at most twice per round; then the run stops.
- At a plateau or round limit, the run asks the owner to `stop`, `raise limit`, or `change approach`. The last two allow 5 more rounds or more and restart the plateau window. The owner's optional reason goes to the change agent.

The wake message can come before T3 saves the result, so `omt-climb` step 4 reads `t3 workflow show <id> --json` again every few seconds, for at most 5 minutes, until the run is `completed` with a result or is `stopped`, `cancelled`, or `skipped`. `result` holds `outcome` (`met`, `plateau`, or `limit`), `round`, `reason`, `head`, the Markdown `table`, `scores`, `changes`, and `declined`.
