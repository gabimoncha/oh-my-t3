# About the design of oh-my-t3

oh-my-t3 is an orchestration layer for [T3 Code](https://t3.codes). It gives any agent inside a T3 thread a disciplined way to plan, delegate, review, and verify work through T3's own orchestrator. The ideas come from oh-my-openagent (OmO) and oh-my-pi (omp). The mechanism is T3 orchestrator v2.

The [T3 orchestration report](research/t3-orchestrator-v2.md), [OmO report](research/oh-my-openagent.md), and [omp report](research/oh-my-pi.md) record the research behind the original design. The exact contracts for the code are in [`spec.md`](spec.md).

## Who this is for

The user is a developer who runs Claude Code, Codex, Cursor, Pi, or OpenCode agents from T3 Code. That developer wants one sentence ("ulw: add OAuth to the API") to turn into a planned run. The main thread plans and builds the work, and role-routed child tasks check it: one review child and one QA child, with the checks that the profile requires. The normal profile makes the reviewer of HEAVY work a cross-family oracle.

The maintainer inherits a small TypeScript CLI with no runtime dependencies, a set of portable skills, and one config file. Every subagent runs as a T3 child thread, so the T3 UI already shows progress, cancellation, and results. oh-my-t3 adds no daemon. Its only server is the local config editor, which runs only while `omt config edit --web` runs.

## What T3 already gives us

T3 orchestrator v2 exposes app-owned orchestration to every provider session through the `t3-code` MCP server. The parts that matter here:

- `delegate_task` starts a child thread on any provider instance and model, with model options such as reasoning effort. The child gets only the task text.
- `task_status` and `task_cancel` manage the child. A finished async child wakes the parent with a short message that names the task ids.
- `orchestrator_capabilities` lists the live provider and model catalog, including the option descriptors for each model.
- `t3_thread_launch` starts a top-level thread in its own git worktree.
- `schedule_task`, `watch_pull_request`, and native `/goal` keep work going across turns.

T3 does not give us roles, model routing, briefs, review loops, or done criteria. A `role` argument adds one line of text. Children share the parent's checkout. No limit stops a fan-out storm. These gaps are what oh-my-t3 fills.

## Decisions

### Roles, not model names

Skills and plans name a role such as `execute`, `review`, or `qa`. One config maps each role to an ordered chain of rungs. A rung is a provider, a model, and an effort level. The first rung that T3 can run wins.

This comes from omp model roles and OmO categories. It matters more in T3 than in either source, because T3 can reach several providers at once. A role chain such as "Opus 5.5 at low effort, then GPT-6.1-Sol at high effort" survives a missing subscription or a disabled provider.

T3 validates `target.options` strictly. An unknown option id or a value outside the list fails the whole call. Each driver also names effort differently: Claude uses `effort`, Codex uses `reasoningEffort`, Pi uses `thinking`. So the CLI maps one effort ladder (`off` to `max`) onto the option that each model advertises, and picks the nearest supported value.

### Reviewers come from the other family

The `plan-review`, `review`, and `oracle` roles are cross-family. The skill passes the worker's provider to `omt brief --against`, and the CLI tries the rungs of the other family first. A reviewer from another family misses fewer of the worker's blind spots. The owner chose this rule. When the other family is not available, the same family reviews, because a review from the same family is better than no review. The family is the driver, so a driver that runs models of several vendors (Cursor, OpenCode) counts as its own family.

The ledger records the provider of each dispatch. So `--against auto` finds the worker of a unit, or the main implementer of a plan, without help from the agent.

### The main thread builds, and children check

Before the workflow change, the conductor of an `omt-ulw` run edited no product files. Each unit cost at least 4 children (execute, review, verify, and qa), and each fix round cost 2 more. The [workflow-profiles walkthrough](walkthrough.md#run-2-workflow-profiles) records 128 dispatched tasks across exploration, plan review, and the build. The conductor also ended its turn after each dispatch, so a stall heartbeat had to wake it, and `omt-loop` existed only to keep runs moving.

The [workflow fold design](design/workflow-fold.md) follows one rule: keep a child only for black-box verification, for independent parallel work that needs a fresh context, or for a context that one loop cannot hold. So the main thread now explores, asks the owner its questions in batches, plans, and builds in one context. One review child on the other family reviews the whole diff, and one QA child runs every check and device flow. The reviewer fixes local findings itself, because a reviewer that only reports costs one more round for a fix that it could see. The main thread reads the reviewer's fix diff before QA starts, because a child's summary is a claim and the diff is the evidence. QA edits nothing, so its result says only what passed. The main thread waits for each child inside its turn and ends a turn only for the owner, so no heartbeat and no `omt-loop` are needed.

The same rule shapes the other flows. `omt-plan`, `omt-grill`, `omt-research`, and `omt-design` do their work in the main thread and start a child only for a second opinion from the other family, a broad read, or a design that the main thread's model cannot draw. `omt-code-review` gives a small diff 1 reviewer and a large diff 2 to 4 grouped reviewers and 1 oracle, because a review of a few hundred lines fits in one context and more reviewers only repeat findings. `omt-swarm` keeps separate threads, because each track is independent work in its own worktree. Each track runs its own review and QA. Then one review checks all track diffs before the merge, and QA checks the merged code.

### A grill runs before the plan

A plan reviewer finds a missing edge case as a gap in a written plan. At that point the plan has units, scopes, and a test list, and each fix changes them. So `omt-grill` tests the goal before a plan exists, while a change costs one line in a grill file. The main thread finds the facts in the code first, and one `grill` child from the other family gives a second opinion once per grill. The aim is coverage, not agreement: two families with different blind spots find more edge cases, and a disagreement shows a real choice. The main thread checks each answer against the facts before it asks the next batch. The user knows some areas and not others. In an area that the user does not know, the models decide and give the reason, so the user answers only the questions that they can answer well. `omt-plan` reads the grill file, asks no settled question again, and turns the accepted and changed edge cases into test lines.

### Design is optional, and the owner steers

The `design` role makes design variants and the design spec, and the `ui` role implements a UI unit from an approved spec or task requirements. `design` starts on Opus at medium effort and falls back to Astra at high effort. `ui` starts on Opus at low effort and falls back to Sol at high effort. A UI unit follows an approved spec when one exists. Otherwise it implements the task requirements directly. The user can request a design pass first, but no design tool or spec is required. Anthropic's optional `frontend-design` skill guides visual choices during design and direct UI implementation. Once a spec is approved, the implementation follows it without loading the skill again. Setup checks for the skill and recommends installing it when missing. No model reviews a design: `review`, `oracle`, and `plan-review` tasks leave `docs/design/` out. When the user requests a design pass, the designer uses a new Paper file or mockup source and `design.variants` for each screen, 3 in the normal profile, so the owner compares real options side by side. The owner picks one variant per screen, may mix variants across screens, steers them in their own words, and approves the spec. Code review of `ui` units still runs as for any other unit.

### A CLI for the deterministic parts, skills for the judgment

Config merging, chain resolution, option mapping, brief rendering, and plan counting are deterministic. An LLM does them badly and expensively, so the `omt` CLI does them. Planning, splitting work, reading results, and deciding what to do next need judgment, so skills carry them.

The CLI cannot call T3 itself. Claude and Codex sessions get the T3 MCP server through config, not through environment variables, so a shell command has no credential. Routing is therefore unverified by default: the CLI trusts the chain and maps the effort, `delegate_task` validates the target, and the skill moves to the next rung on a typed T3 error. An agent can pass a saved copy of `orchestrator_capabilities` to check the chains ahead of time.

The skills also work without the CLI. They tell the agent to try a role's chain in order and to fall back on a typed T3 error. T3 is the final validator either way.

### The CLI and the skills serve people and agents

The owner set this rule. A person runs omt from a terminal, and an agent runs the same commands from a T3 thread, often for the same person. So every part of omt has two readers:

- Each command prints text for a person. The commands that report state, such as `omt doctor`, `omt roles`, `omt profile show`, and `omt detect`, also print JSON with `--json`, so that an agent reads one field without parsing text. `omt init`, `omt install`, and `omt worktree setup` have no `--json` flag. `omt config show` always prints JSON.
- A command that changes the user's files shows the change first and asks, or takes `--yes`: `omt install`, `omt uninstall`, `omt worktree setup`, `omt doctor`, and `omt detect --write`. Without a terminal it does not ask and writes nothing. So an agent shows the person the `--dry-run` output and passes `--yes` only after the person agrees. `omt init` and `omt config init` do not ask. They create a missing file and keep an existing config. There are two exceptions. `omt init` adds the missing lines to an existing `.omt/.gitignore`, because an older omt wrote fewer lines, and it keeps every other line. `omt config init --force` replaces an existing user config. So an agent passes `--force` only after the person agrees.
- Skill names and descriptions are written for people, because a person picks a skill by name in the composer and reads its description in the skill picker. The description also tells the agent when to load the skill, so it puts the trigger words first. The skill body is written for agents: numbered steps, each with a check.

`omt-help` and `omt-setup` follow from this rule. A person who does not know the commands asks in plain words. The skill runs the same commands that the person would run and shows their text output, so the person can check every answer and every change.

### Defaults change after review

Each release ships one current default configuration. Dated sets made users manage a history of model choices, and those copies could become stale. `doctor` and `update` now show the difference from the last accepted defaults and ask before applying it.

One snapshot in the existing install record preserves the last accepted defaults when the user declines. Config overrides still apply above that snapshot. There is no history to select or maintain.

### Harnesses filter the chains

Many users run only Claude Code or only Codex. A config that rewrote all 13 chains for one harness would stop getting new defaults. The `harnesses` key instead removes the rungs of a missing harness when omt resolves a role, so the chains still come from the accepted defaults. omt detects the harnesses from the T3 settings and `PATH`, or from the live provider list that an agent passes with `--capabilities`. T3's rule for an enabled provider comes from its source code, not a documented API, and omt does not read T3's settings per project. So the install and `omt detect` show the result and ask before they write the key.

### The owner reads a plan summary

The owner does not read long plans. Each plan therefore opens with a summary of at most 15 lines in plain words, and a plan reviewer blocks a summary line that the plan does not support, because the owner may read nothing else. `omt-plan` writes that summary in full in its reply when it hands off a plan.

omt once drew each final plan as an HTML page with a flowchart of the units. Owners rarely asked for it, and a fixed page layout could not draw what they did ask for, such as lanes that show which steps run in a child thread. So omt no longer builds pages. When the owner asks for a diagram, the agent writes the HTML and shows it with T3's `html_render` tool.

### Briefs and result contracts

A child sees nothing of the parent conversation. Every task therefore carries a brief with a fixed shape: role persona, task, context, scope, constraints, done condition, verify commands, and the required final message format. OmO's worker contract (task, deliverable, scope, verify, stop condition) is the model for this.

`task_status.summary` is the child's last assistant message. Each role therefore ends with a fixed result block: `STATUS` for workers, `VERDICT` for reviewers, qa, and guardrail tasks, and `ANSWER` for researchers. The parent reads the block and checks the evidence itself. A worker's "done" is a claim until the parent or a `qa` task confirms it.

### Read-only roles run in plan mode

A live experiment showed that a Claude child in T3 `plan` interaction mode runs read-only commands, stays in plan mode, and returns its final message intact. Explore, research, plan-review, grill, and guardrail roles therefore default to `interactionMode: "plan"`. The defaults make `review` and `oracle` edit roles, so that the `omt-ulw` reviewer can fix local findings. `omt-code-review` still sets `interactionMode: "plan"` on each of its review and oracle tasks, so its reviewers only report. On Claude, Codex, Cursor, and OpenCode, T3 enforces read-only access for those children, and the brief does not have to rely on the child's restraint. T3 has no plan-mode handling for Pi, so a Pi child in a read-only role relies on its brief alone. No default rung uses Pi; a custom chain that adds Pi to a read-only role accepts that risk.

Plan mode has one trap. T3 stores a proposed plan as its own item type, and `task_status.summary` reads only assistant messages. A child that answers with a proposed plan (Claude's ExitPlanMode, or Codex plan output) can hide its result block from the summary. Every plan-mode brief therefore tells the child to stay in plan mode and put the block in its final assistant message. When a summary still comes back empty, the main thread reads the child thread, which includes proposed plans.

### Children share the checkout

Children stay in one checkout so their changes are integrated throughout the run. A worktree per unit would need repeated setup, integration, and checks after merge. Each unit has an explicit file scope. A large unit that the main thread hands to an `execute` child runs in parallel only when its scope does not overlap other edits, up to the default `maxParallel` of 6. The reviewer and QA never run at the same time, because the reviewer edits files. Shared build state uses a lock. Independent tracks can use `omt-swarm` when the owner asks for separate worktree threads.

### Worktrees install their own dependencies

A T3 worktree thread starts from a fresh checkout without `node_modules`. T3 runs a project's setup script first, but only from the scripts saved in T3, and `t3.json` only proposes them. So `omt worktree` checks the current checkout, keeps any setup that exists, and generates a missing one as files that the repository commits: `t3.json`, the runner, and for pnpm a `pnpm-workspace.yaml` that keeps the global store. The generated runner is plain Node with no dependencies, so it runs in a worktree that has no omt. The CLI imports the same file for its check, so the check and the runner detect the package manager the same way.

The runner selects a global virtual store with the isolated linker. Each worktree then links to one shared copy of each package version, so a new worktree installs in seconds and uses little disk space. Global caches alone would still copy every package into each worktree. The runner stays conservative: it requires the lockfile and a frozen install, accepts only exact versions it can compare, refuses an explicit other linker, disables package-manager downloads, and stops instead of converting an existing `node_modules`. For pnpm it also stops before the install when `pnpm-workspace.yaml` does not select the global store, because pnpm 12.13.0 re-installed `node_modules` with a local store on a later `pnpm run` when only install flags selected it. It stops when `pnpm config get node-linker` fails, because then the effective linker is unknown. It refuses a symlinked `.t3` folder or runner, because Node runs a linked script from the link target, which moves the checkout root that the runner computes. The CLI writes only into the current checkout, also in a linked worktree, while `.omt` stays shared in the main checkout. It never changes T3 settings, because a script that the base branch lacks would fail in every new worktree.

### Finished children are settled

T3 keeps a finished child loaded for 30 idle minutes. Codex then keeps the thread for its unload delay, which is 1800 seconds from Codex 0.163.0. Each loaded Codex thread starts its own stdio MCP server processes. In one long run, a single Codex app-server had 1,042 child processes: up to 174 copies of each of its 6 MCP servers. Codex native subagents of an idle parent stay loaded until the app-server stops, because T3's idle release unsubscribes only the parent. A settle releases the child at once and unsubscribes its native subagents too. So the main thread settles each child after it records the result. Owners also set `-c thread_unload_delay_secs=60` in T3's Codex launch arguments, which makes Codex close a settled thread after one minute.

### The config editor shows where each value comes from

A value in the effective config can come from four places: the accepted defaults, the user config, the project config, or a profile and the file that declares it. `omt config show` prints only the result. A user who wants to know why `limits.maxParallel` is 2 has to read both files and the profile chain. So `omt config explain` prints the layer that sets each value and the lower layers that it overrides. The sources come from the merge steps themselves, not from the keys that a file names. A key-based guess fails for a role that one file removes and another file creates again, and for the fields that omt fills in for a new role.

`omt config edit --web` shows the same sources in a browser page and edits both files. A page fits better than a terminal form for this: the page can show a role chain, a profile and its parent, and the source of each value side by side. Every write goes through `setJsoncValue`, so the user's comments and layout outside the edited value stay. The server returns the diff before a write, and it refuses a write that adds a validation error or that starts from an old copy of the file.

A local HTTP server is a risk, because any web page in the same browser can send requests to it. The editor limits that risk in four ways. It listens on 127.0.0.1 only, so other machines cannot reach it. Each run gets a random port and a 32-byte token in the URL path, so a page that does not know the URL cannot reach a route. The server checks `Host`, which refuses a DNS rebinding attack, and checks `Origin` and `Sec-Fetch-Site`, which refuse a request from another page. It sends no CORS headers, so a browser lets no other origin read a response.

The editor is not a daemon. It runs in the foreground of `omt config edit --web` and stops on Ctrl-C, 5 seconds after its tab closes, or 2 minutes after the last ping from the page. So no process outlives the command, and omt still makes no outbound network calls.

### Profiles select the workflow

A role selects a model. A profile selects the plan, build, and review steps. Keeping those choices separate lets a project use the same roles for normal work, prototypes, and PR reviews. Sparse profile overrides inherit `normal`, so a custom workflow states only its differences. A plan header keeps the selected profile across context resets. The main thread reloads it after a reset or a switch, so an owner can switch the remaining work.

### Git actions follow a config policy

Most owners work on branches and worktrees, where a question before each commit, push, and PR only adds a turn. Agent harnesses commit only when the user asks or gives standing approval. So the policy in `workflow.git` is that standing approval: the owner writes it once and can change it per profile. `omt git check` finds the current and default branch in code, so the decision does not depend on a model's reading of git output. A commit or push on the default branch asks first, because a wrong commit there reaches everyone who builds on that branch. A merge asks first, because it puts the change into the base branch, and that decision belongs to the owner. A force push always asks, because it can remove commits from the remote. Only the user's own repos and PRs act with no question, because there the policy states the user's intent. Another person's repo or PR always needs the user's yes, because the policy cannot speak for that person.

### The main thread writes tests, and qa runs them

The main thread writes the approved tests while it builds, and it makes the required failure proofs in a private copy of the working tree. `qa` runs the verify commands, the final checks, and the device flows, and it edits nothing. A check that edits nothing cannot hide a failure behind a change, and its result is evidence only of what ran. `qa` puts Claude rungs first, because a Codex child cannot reach the local device daemon, so only `qa` drives a device. QA of a `ui` unit checks behavior, not looks: the owner compares the looks with the design.

### New tests need a plan line

Each new test maps to an owner-approved `## Tests` line. This makes the test's flow, file, and reason reviewable before the main thread writes it. The default proposal is one e2e test per main flow. Other layers need a reason and owner approval. An empty list means no new tests, while verification still checks the artifact.

### Build locks follow open files

A kernel lock on an inherited fd 3 survives a wrapper crash while another holder remains. Nothing guesses that a lock is stale or takes it over. The lock file keeps its inode, and the kernel releases the lock when the last holder closes it. Commands that leave processes behind run outside the lock with a serial plan. Without `flock` or `lockf`, the CLI still runs the command and the plan keeps shared builds serial.

### Guardrails prefer checks that can fail

A lint rule, type rule, test, or CI check can catch a repeated defect without another model judgment. The guardrail role therefore proposes a deterministic check before a rule correction or a new rule. Each check proposal names a command that fails before the fix and passes after it. Judgment-only findings get no proposal. Local `.omt/guardrails.md` records proposals for separate work without adding them to the PR branch.

### Limits that T3 does not set

T3 has no cap on concurrent tasks or nesting depth. The config sets three limits: parallel tasks, depth, and review rounds. Every brief states the child's depth. At the maximum depth a child does the work itself.

omt once also capped the tasks of one run. One config cap did not fit every plan: a dogfood run hit it after 2 of 16 units, and a per-plan budget only moved the question to the owner. After the fold, a run starts about two children plus the broad reads, so omt removed the task budget. `maxParallel` still stops a fan-out storm.

### State lives in the repository

A long run outlives the agent's context. The plan (`.omt/plans/<slug>.md`) and the ledger (`.omt/ledger.jsonl`) hold the state: units, scopes, done conditions, task ids, rounds, and verdicts. After compaction the main thread re-reads both files. The plan uses checkbox grammar that people can read and that `omt plan status` can count.

Live plans stay out of git. All worktrees share the one `.omt` in the main checkout, and omt reads and edits only that copy. A committed plan gives every worktree branch a tracked copy that goes stale, and that copy makes every omt command warn about shadowed state. So `.omt/.gitignore` holds `plans/`. To keep a finished plan as a record, copy it to a path outside `.omt/`, such as `docs/`, and commit it there.

### Continuation uses T3, not new hooks

OmO re-prompts the agent with hooks until a plan is done. omt needs no re-prompt: the main thread waits for its children inside its turn, with `delegate_task` in wait mode or `t3_thread_wait`, and a turn ends only for the owner. So omt has no heartbeat and no loop skill. T3's native `/goal` stays available for Claude and Codex threads. The only hook it installs is optional: a Claude Code `UserPromptSubmit` hook that arms ultrawork when the prompt contains `ulw` or `ultrawork`. It injects a short pointer to the `omt-ulw` skill, the same approach as OmO's Codex edition.

### Install follows the user's existing layout

The installer copies each skill to `~/.agents/skills/<name>`. Codex, Cursor, OpenCode, and Pi read that root. It adds a relative symlink in `~/.claude/skills/<name>` for Claude Code, which does not read `~/.agents/skills`. The installer shows the full plan first, asks once, keeps backups, and records a manifest so that `omt uninstall` removes exactly what it added. This mirrors OmO's consent-first setup.

A release can drop or rename a skill, as `omt-loop`, `omt-show`, and `omt-review` were. An old folder would stay in place, and agents would keep loading a stale skill. So `omt install` and `omt update` remove a skill folder and its links when the bundle no longer ships the skill, but only when the manifest lists it and the folder has the omt marker. A folder that omt did not install is the user's, and omt never touches it. An edited retired skill is kept until the user passes `--force`, and `omt doctor` warns about it.

### Bun builds omt, and users need no clone

An earlier omt ran from a git clone: Node ran the TypeScript sources through type stripping, and a global install linked the clone onto `PATH` with pnpm. Node does not strip types in files under `node_modules`, so the same sources could not ship as an npm package. Users had to clone, and the shim recorded the clone path.

The repository now uses Bun for each step except the type check: the package manager, the tests (`bun test`), the bundle, and the compiled binary. One tool replaces pnpm and the Node test runner, and `mise.toml` pins its version.

The type checker is `tsrs`, the Rust port of the TypeScript 7 compiler that Cloudflare and VoidZero announced in October 2026. It tracks upstream TypeScript, so its diagnostics match `tsc` 7.1. It replaced `bun check`. On this repository (127 files, an Apple M5 Pro), the two checkers report the same errors. The `tsrs` binary alone takes 32 ms and 73 MiB, and `bun check` takes 41 ms and 172 MiB. The npm `tsrs` command starts Node before the binary, and takes 58 ms. So `scripts/tsrs.sh` runs the binary directly, and `bun run typecheck` takes 45 ms, against 43 ms with `bun check`. Most of the difference is the start of `/bin/sh` and `uname` on macOS. The type check is too small for the faster checker to show: on a large project, the check time is much longer than the start time. The script keeps `uname`, because a glob over `node_modules/@tsrs` can find packages for other platforms. `tsrs` is still a development build, so `package.json` pins an exact version. If a later TypeScript release ships the Rust checker, the script can go, and `typecheck` can call that release's binary.

The npm package holds one JavaScript file that `bun build --target=node` makes, plus the skills. A package that starts with `#!/usr/bin/env bun` fails on a machine with only Node, and most users have Node. So the bundle starts with `#!/usr/bin/env node` and runs on Node 22 or later, or on Bun. Node 20 is past its end of life, so 22 is the minimum. Because the bundle must run on Node, `src/` uses only `node:` built-in modules and no `Bun.*` API. The bundle has no dependencies and no install scripts. A launcher with one optional package per platform, as Biome ships, would run the binary through npm too. It needs one more package for each platform in every release, and the bundle needs none.

The package is also published as `omt3` and, from version `0.5.0`, `oh-my-t3`. The shorter `oh-my-t3` name is easier to remember. All three packages provide the CLI, skills, and hooks. The npm name `omt` belongs to another author. A one-shot runner such as `npx` downloads the package that has the name of the command, so `npx omt` outside a project that installed omt runs that other package. `npx omt3` and `npx oh-my-t3` run omt. The docs never tell users to run `npx omt` outside a project with omt as a dev dependency.

The GitHub release holds a compiled binary for each POSIX platform: macOS, Linux with glibc, and Linux with musl, on arm64 and x64. The binary holds the skills, and needs neither Node nor Bun. It serves users who install tools with mise, and machines without a JavaScript runtime. mise reads the platform from each archive name and checks `SHA256SUMS`. Windows binaries come later.

A project install from a one-shot runner writes a shim that calls the same runner with the pinned version, such as `npx --yes omt3@0.1.0`. The runner cache is not a stable path, so the shim cannot record it. The pinned version keeps the project on the version that installed it, and a cleared cache does not break the project. The cost is the network: after a cache clean, the next call downloads the package again. With the Claude Code hook, that call runs on each prompt and can pass the hook timeout when the network is down. So the docs point hook users to a global install or a dev dependency.

### Updates run the channel's own command

omt reaches users through many channels: two mise backends, global npm, pnpm, and Bun installs, dev dependencies, and one-shot runners. Each channel owns the files that it installed. The package manager or mise records the installed version, and mise keeps each version in its own folder. An omt that replaced its own files would leave those records wrong. So `omt update` finds the channel from the path that the CLI runs from, and runs that channel's own command, such as `npm install -g oh-my-t3@<v>` or `mise use -g github:gabimoncha/oh-my-t3@<v>`. The command pins the exact version that the registry reported. A path alone cannot prove a pnpm global install, because pnpm 11 can keep the real files in a store that projects share. So omt asks the package manager for its global folder before it runs a command. A channel that omt cannot confirm gets the table of manual commands as a hint. A dev dependency gets a hint too, with the command of its package manager: that command changes `package.json` and the lockfile, which git tracks, so the user runs it and commits the result. A one-shot project gets a new version pin in its shim, because the shim is the install. omt first checks that the runner starts the new version, so a failed download leaves the old pin in place.

The new CLI, not the old one, syncs the skills, because only the new CLI carries the new skills. The sync runs the install planner, so an update and `omt install` judge a skill by the same hashes and markers. `omt install` stops on a skill that the user edited. The sync keeps that skill and names it in the output, because an update that runs with `--yes` or from an automatic check must never discard the user's work. `omt install --force` still replaces it when the user asks. Agent sessions load the skills when they start, so the command ends with a line that tells the user to restart them.

A project install lives in its own repository, and the user-scope omt had no way to find it. So `omt install --project` records each root in `<configDir>/projects.json`, and `omt update` syncs each recorded project that runs the same omt. A project that runs another omt, such as a dev dependency or a path shim of another channel, keeps its own channel, and omt prints the command to run there. One machine can hold several omt versions on purpose, and an update in one channel does not move the others. The list is a file of its own, not a field of the user manifest, so a project install works on a machine with no user install. The rule that user scope and project scope never read or write each other's files gets one exception: this list. A root whose folder or project manifest is gone leaves the list on the next applied update.

An update shows defaults changes after the skills sync and asks before accepting them. `--yes` accepts both the update and the current defaults. User overrides stay unchanged. See [Defaults change after review](#defaults-change-after-review).

omt used to promise that the CLI never uses the network. An update needs the latest version, so the promise changes, and the new text names each case exactly. The update check is opt-in: a user sets `"update": "check"` in the user config. A project config cannot turn it on, because a cloned repository is text that someone else wrote. The check runs at most once a day, with a 3-second timeout, and only in `omt install` and `omt doctor`, the commands that a person runs to set up or check omt. The hook runs on each prompt, and agents run commands such as `omt brief` and `omt roles` many times per task. A request there would slow each prompt and, when the network is down, could pass the hook timeout. So the hook and the agent commands never use the network. `"apply"` also runs the update, but only at a terminal, where a person sees the output; without one it prints a note. The request goes to the npm `dist-tags` endpoint, which npm's own `dist-tag` command uses and which returns 18 bytes. It sends no cookie, token, or id, so "no telemetry" stays true. The state file records failures too, so an offline machine tries once a day and not on each run.

## What is out of scope

- A T3 fork or a T3 plugin API. oh-my-t3 uses only the surfaces T3 already exposes.
- A DAG scheduler, team mailboxes, memory, or computer use. T3 child threads and worktree threads cover the common cases. No scheduler process runs. Instead, `omt plan status` lists the ready units: the open units whose `Depends on` units are done. The main thread builds them in that order.
- Hooks for Codex, Cursor, and OpenCode. Codex hooks need per-hook trust. They are a later step.
- Copied code or prompt text from OmO. Its license (Sustainable Use License 1.0) does not allow that. oh-my-t3 re-implements ideas in its own words. omp and T3 Code are MIT.

## Credits

- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) for categories with fallback chains, the ultrawork loop, plan review rounds, and evidence-based done criteria.
- [oh-my-pi](https://github.com/can1357/oh-my-pi) for model roles, agent definitions, fan-out with shared context, and the review recipe.
- [T3 Code](https://github.com/pingdotgg/t3code) for orchestrator v2, which does the actual work.
