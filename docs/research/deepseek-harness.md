# deepseek-harness (dsh) research for oh-my-t3code

Snapshot: deepseek-harness clone at commit `5badb15` (`git -C deepseek-harness log --oneline -1`), version `0.2.1-alpha.1` (`dsh:package.json:3`). Research date: 2026-10-07.

> Note, 2026-10-28: the workflow fold changed omt after this research. omt-ulw is now a main-thread build flow. The main thread builds and fixes, one review child and one QA child check, and the main thread waits for children inside its turn. omt-loop, the stall heartbeat, per-unit dispatch, and the task budget (`limits.maxTasksPerRun`) were removed, and omt-review was renamed omt-code-review. Skill step numbers and `omt:` line cites below refer to the skills before that change. See [the workflow fold design](../design/workflow-fold.md).

## Path conventions

- `dsh:` is the root of a clone of https://github.com/deepseek-ai/deepseek-harness at commit `5badb15`.
- `omt:` is the root of this repository, https://github.com/gabimoncha/oh-my-t3.
- Facts about T3 tools come from the T3 MCP tool list in this session, not from a clone. They are labeled "T3 session".
- I read files only. I ran no script, build, or installer from the clone. I skipped `*.zh.md`, `*.i18n.yaml`, `vendor/`, and `website/`. I read `snapshots/` only for one sample case.
- The clone is shallow. It has one commit (`git rev-list --count HEAD` returns 1). So I could not check the star, fork, contributor, or 30-day commit counts in the catalog note.

## Catalog note check

The catalog note is the owner's private note on deepseek-harness. It is not public. It is mostly accurate. I confirmed these claims in the clone:

- 328 `package.json` files exist under `packages/` outside `node_modules` (count with `find`). "About 330" is correct.
- Five profile templates ship: `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` (`dsh:packages/boot/app-boot/src/profile.ts:178-195`).
- The goal round cap defaults to 256 (`dsh:packages/goal/goal/src/index.ts:243-254`).
- The repeat-tool reminder fires at 3, 5, and 8 repeats in the base bundle (`dsh:packages/bundle/base/cordis.patch.yml:454-459`).
- Approval outcomes are `allowed-once`, `rejected`, `cancelled`, and `unavailable` (`dsh:packages/interaction/user-approval/src/types.ts:28-32`).
- The sandbox fails with `SANDBOX_UNAVAILABLE` and does not run unconfined (`dsh:packages/sandbox/sandbox/src/index.ts:125-145`).
- The default route is `deepseek-official` with model `deepseek-flash` (`dsh:packages/bundle/base/cordis.patch.yml:80-86`).
- The Codex child pins `@openai/codex` 0.153.4 (`dsh:packages/subagent/subagent-codex/package.json:47`). The Claude Code child pins `@anthropic-ai/claude-agent-sdk` 0.3.263 (`dsh:packages/subagent/subagent-claude-code/package.json:44`).

These claims are wrong or incomplete:

1. **Plugin management.** The note says `dsh plugin` and `plugin_manager` "install, enable, disable bundles with HMR" and that discovery is "by the dsh-plugin GitHub topic". `dsh plugin` only forwards its arguments to pnpm in the profile directory (`dsh:apps/cli/src/args.ts:187-198`). After pnpm runs, it appends newly installed bundles to the profile (`dsh:packages/boot/plugin-manager/src/operations.ts:88-113`). Enable and disable go through `plugin_manager` or the Web page (`dsh:packages/boot/plugin-manager/README.md:40`). HMR is off in the `headless`, `sdk`, and `acp` bundles (`dsh:packages/bundle/headless/cordis.patch.yml:33-34`, `dsh:packages/bundle/sdk-app/cordis.patch.yml:24-25`, `dsh:packages/bundle/acp-app/cordis.patch.yml:23-24`). The topic is a README suggestion (`dsh:README.md:46`). No code searches for it (inferred from a grep of the plugin-manager sources).
2. **Hook bridges.** Only the Claude Code bridge has subagent events. It supports seven events (`dsh:packages/hooks/hooks-claude-code/src/config.ts:1-19`). The Codex bridge supports five and no subagent events (`dsh:packages/hooks/hooks-codex/src/config.ts:1-11`). No shipped bundle mounts either bridge (inferred; they appear only as CLI dependencies, `dsh:apps/cli/package.json:48-49`).
3. **Session search as memory.** The note says agents "can search past sessions with session_search tools". The base bundle sets `openAt: never`, so search calls fail with `SESSION_QUERY_SEARCH_DISABLED` (`dsh:packages/bundle/base/cordis.patch.yml:141-153`). The `session_search` tool package is opt-in (`dsh:packages/session-query/tool-session-query/README.md:12`). No shipped bundle mounts it (inferred from a grep of bundle YAML).
4. **Session formats.** The writer uses format v4 (`dsh:packages/core/session/src/types.ts:89`). The latest released format is v3 (`dsh:docs/session-format-status.md:32`, `dsh:docs/session-format-status.md:45`).
5. **Compaction cost.** The note says "one extra model call". Under pressure, the summarizer can run `compactionRetries + 1` times, which is 2 by default (`dsh:packages/compaction/compaction-basic/src/config.ts:20-23`, `dsh:packages/compaction/compaction-basic/src/index.ts:319-346`).
6. **Goal continuation.** Continuation is not fully autonomous. Every new agent object disarms the goal, so after a resume or a fork a human must re-arm it (`dsh:packages/goal/goal/src/index.ts:255-256`, `dsh:docs/glossary.md:27`).
7. **Session-log upload row.** The note says the base bundle mounts `session-log-deepseek` "with `enabled: true`". The row has no `config` (`dsh:packages/bundle/base/cordis.patch.yml:43-44`). The schema default is `true` (`dsh:packages/session/session-log-deepseek/src/index.ts:51-54`). The effect is the same. The wording is not.
8. **Workspace before chat.** The user guide says the composer stays unavailable until the user picks a workspace (`dsh:docs/user/guide/index.md:15`). The workspace client README says an empty install creates a default workspace and its blank session (`dsh:packages/client/ui-workspace/README.md:78`). The docs conflict.
9. **Subagent result.** "Each child gets one self-contained text task and returns the final answer" is true for the spawn backend and the external backends. A fork child inherits the conversation (`dsh:packages/subagent/tool-subagent/src/index.ts:253-264`). A continuable child returns an id and a later notice (`dsh:packages/subagent/tool-subagent/src/index.ts:381-388`). The Codex and Claude Code subagent tools are disabled in the Web `standard` preset (`dsh:packages/bundle/web-app/presets/standard.patch.yml:119-134`).
10. **Self-improvement row.** The note misses the `dsh-code-review` skill maintenance workflow. It turns adopted human PR review feedback into skill diffs (`dsh:docs/cookbook/maintaining-dsh-code-review.md:5-15`). Its status is `proposed`, and the tool is private and out of the repository (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:3`, `:53-55`).
11. **Evals row.** `BENCHMARK.md` tells users to run "the `jsonrpc-agent` minimal variant" (`dsh:BENCHMARK.md:3`). That example was renamed to `python/sdk/examples/` (`dsh:.agents/notes/archived/architecture/2026-08-11-repository-naming-contract-and-rename-ledger.md:280`). The SDK guide uses the `sdk-minimal` profile (`dsh:docs/user/guide/python-sdk.md:111`). `BENCHMARK.md` is stale.
12. **Schedule scope.** The schedule service is mounted in the `web-app` bundle, not in base (`dsh:packages/bundle/web-app/cordis.patch.yml:139-140`). So headless, SDK, and ACP runs have no reminders by default.

## 1. Summary

- dsh owns its agent loop. Every part, including the loop, is a Cordis plugin that a config row mounts (`dsh:docs/architecture.md:11-13`). Most of its architecture needs loop ownership. omt can copy the vocabulary and some policies, not the runtime.
- A capability seam has three roles: a Service Definition, one or more Providers, and one or more Consumers (`dsh:docs/glossary.md:9`). omt's role-to-chain indirection is a seam of the same kind (inferred).
- The rule "model-visible means logged" says every model request must be rebuildable from the session log (`dsh:docs/architecture.md:127`). Fork, resume, telemetry, and snapshot tests all derive from that log (`dsh:docs/architecture.md:123`). omt's ledger records dispatches and verdicts, but not the brief text or the child's result block (`omt:docs/spec.md:249-263`).
- The product has no loop that learns from past runs. Feedback is stored as log-only events that the model never sees (`dsh:docs/subsystems/feedback.md:5`). No code path changes prompts or skills from feedback (inferred from a grep of `packages/` and `apps/`).
- The learning loop lives in the repository process. Postmortems name the guardrails they add (`dsh:docs/postmortem/README.md:9`). Those guardrails exist as gates, tests, and AGENTS.md rules (`dsh:scripts/verify-cordis-config.ts:509-527`, `dsh:AGENTS.md:126`).
- The strongest self-improvement design is the proposed `dsh-code-review` maintenance workflow. It collects human review feedback, keeps only feedback that the landed patch adopted, has two independent reviewers classify and approve a skill diff, runs gates, and leaves the promotion to a human (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:15-51`). A real run scanned 62 PRs and 426 items and produced 0 candidates (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:72`).
- Goals keep a session working across rounds with a cap of 256 (`dsh:packages/goal/goal/src/index.ts:243-254`). The round prompt tells the model to treat the workspace as authoritative and to gather evidence before it marks the goal complete (`dsh:packages/goal/goal-round-driver/src/prompt.ts:15-24`). No code checks that evidence (`dsh:packages/goal/tool-goal/src/index.ts:291-318`).
- The Ralph loop runs one fresh child per round. Only a validated structured report crosses rounds (`dsh:packages/workflow/tool-ralph/src/index.ts:89-174`). Ralph is off by default because "completion is a worker self-report, not an independent evaluation" (`dsh:packages/bundle/base/cordis.patch.yml:440-449`). omt's cross-family oracle is the missing independent check.
- Subagents have six backends behind one `ctx.subagents` seam, including Codex and Claude Code (`dsh:docs/subsystems/subagent.md:7`). Depth defaults to 1 and live children to 8 (`dsh:packages/subagent/subagent/src/index.ts:189-202`). dsh has no named agent types and no planner, worker, or reviewer split (inferred from greps).
- Testing policy says "Verify the world, not the self-report" (`dsh:docs/testing.md:33-35`). A guard counts only when the regression fails it (`dsh:docs/testing.md:40`). These rules map directly onto omt's test and review personas.
- First run is one command, `npx @deepseek-ai/dsh web`, which opens a local Web UI (`dsh:README.md:19-27`). The Web client shows a preview notice and a key step (`dsh:packages/client/ui-settings-models/README.md:14`, `:60`). The preset guide offers copyable example tasks (`dsh:packages/client/ui-agent-preset/README.md:34`).
- The default build uploads unaccepted session-log suffixes to DeepSeek with official API requests (`dsh:packages/session/session-log-deepseek/src/index.ts:51-54`). The decision note says the goal is to receive the complete trajectory from default installs (`dsh:.agents/notes/implemented/architecture/2026-09-14-session-log-upload-default.md:8`). omt forbids network calls and telemetry (`omt:docs/spec.md:18`), so this part does not transfer.

## 2. Findings by question

### Q1. Architecture and "everything is a plugin"

#### Plugins, services, and effects

- Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop (`dsh:docs/architecture.md:11`). There is no privileged core to patch (`dsh:docs/architecture.md:13`).
- A plugin is a function with optional `inject` and `apply(ctx)`, or a `Service` subclass (`dsh:docs/cordis-primer.md:9`). A service claims a key such as `ctx.tools` or `ctx.llm`. Other plugins find it by key (`dsh:docs/cordis-primer.md:10`).
- `inject` lists required services and sets load order. There is no manual boot sequence (`dsh:docs/cordis-primer.md:11`).
- Registrations are reversible effects through `ctx.effect()` or `ctx.on()`. A registry's `register()` returns the disposer (`dsh:docs/cordis-primer.md:13`, `dsh:AGENTS.md:132`).
- Events have five dispatch modes: `emit`, `waterfall`, `parallel`, `serial`, and `bail` (`dsh:docs/cordis-primer.md:19-25`). A waterfall listener gets `next` and must call it to delegate (`dsh:docs/cordis-primer.md:31`, `dsh:AGENTS.md:135`).
- Cordis is vendored and republished under the `@deepseek-ai` scope (`dsh:docs/rescope.md:5`, `dsh:docs/rescope.md:11`).

#### Capability seams

- A seam is a swappable capability with a Service Definition, a Service Provider, and a Consumer. One role alone is not a seam (`dsh:docs/architecture.md:133`).
- The Definition is a Cordis `Service`, never a TypeScript `interface`. The canonical example is `dsh-shell` with providers `dsh-bash-local` and `dsh-bash-sandbox` and consumer `dsh-tool-bash` (`dsh:docs/glossary.md:9`).
- A swap moves related tools together. Filesystem and subprocess providers share one execution world, so a remote provider moves Bash, PTY, and LSP at once (`dsh:docs/architecture.md:135`).
- Example seam end to end, `ctx.skills`:
  - The Definition is `SkillRegistry extends Service`, registered as `skills` (`dsh:packages/skill/skill/src/index.ts:356`, `:373-377`). A provider implements `name`, `list`, and `get` (`dsh:packages/skill/skill/src/index.ts:246-267`).
  - The Provider `skill-filesystem` injects `skills` and calls `ctx.skills.registerProvider(...)` (`dsh:packages/skill/skill-filesystem/src/index.ts:45-46`, `:133-147`).
  - The Consumer `tool-skill` injects `agents`, `tools`, and `skills`, and registers the `skill` tool (`dsh:packages/skill/tool-skill/src/index.ts:24-25`, `:81-161`).
  - The base bundle composes all three rows (`dsh:packages/bundle/base/cordis.patch.yml:294-305`).
- The architecture page maps each kind of new behavior to one extension point. Examples are "register on `ctx.tools`", "use its `agent/*` or `tools/*` event", and "use `ctx.goals`" (`dsh:docs/architecture.md:143-164`).

#### Discovery and composition

- A profile is a named composition in the Harness home. It lists bundles and keeps the user's `cordis.patch.yml` (`dsh:docs/architecture.md:19`). In code it is `$DSH_HOME/profiles/<name>` with `dsh.profile.bundles` in its `package.json` (`dsh:packages/boot/app-boot/src/profile.ts:1-14`).
- A bundle is an npm package whose `package.json` has a `dsh.bundle.patch` field (`dsh:packages/bundle/base/package.json:31-35`).
- Layers apply in this order: bundles, the profile patch, the home patch, then `--patch` overlays. A patch replaces a row's whole config by id or inserts rows (`dsh:docs/architecture.md:27`, `dsh:apps/cli/src/profile-boot.ts:184-209`).
- `--dump-config` prints the composed tree. `--dump-default-config` leaves out the user layer and overlays (`dsh:apps/cli/src/args.ts:171-173`). The dump does not boot the tree (`dsh:apps/cli/src/dump-config.ts:1-7`).
- An agent preset composes a different capability set for one session (`dsh:docs/architecture.md:147`). The Web bundle ships four presets: `standard`, `ptc`, `minimal`, and `cordis` (`dsh:packages/bundle/web-app/package.json:42-52`).
- Scoped registrations shadow global ones for one agent. A restriction filters the global tool set, and a filtered tool is absent from the prompt and refuses execution (`dsh:docs/glossary.md:18-19`).

#### Skills and hooks

- The filesystem provider scans six roots by rank, including `<project>/.dsh/skills`, `<project>/.agents/skills`, `~/.dsh/skills`, and `~/.agents/skills` (`dsh:packages/skill/skill-filesystem/src/index.ts:36-40`, `:245-265`).
- Frontmatter needs `name` and `description`. Optional fields are `whenToUse`, `disable-model-invocation`, `user-invocable`, and `metadata` (`dsh:packages/skill/skill-filesystem/src/index.ts:814-839`).
- `tool-skill` injects a catalog of names and descriptions at the first pre-step. The model calls `skill({name})` to load the body (`dsh:docs/subsystems/skills.md:229-233`). A user `/name` injects a user-invocable skill (`dsh:packages/skill/tool-skill/src/index.ts:163-204`).
- So omt's skills in `~/.agents/skills` would load in dsh with no change (inferred from the roots and fields above).
- The Claude Code hook bridge runs only shell-form command hooks for 7 of Claude Code's 30 events (`dsh:packages/hooks/hooks-claude-code/README.md:173`, `:181`).

#### Creator mode

- Creator mode is the `cordis` preset. It mounts two read-only inspection tools and `tool-plugin-manager` (`dsh:packages/bundle/web-app/presets/cordis.patch.yml:157-170`, `dsh:packages/extensions/tool-cordis/src/index.ts:9-49`).
- The agent writes a bundle and installs it with `plugin_manager install_bundle`. With HMR on, the new tools appear in the same session (`dsh:docs/user/develop/practice/dynamic-cordis.md:5`, `:13`).
- Every `plugin_manager` call asks for `danger-full-access` escalation. Approval is per call (`dsh:packages/boot/plugin-manager/src/tools.ts:20-21`, `:37-43`).

#### What a skills-plus-CLI layer can copy

- The seam vocabulary. omt already has one seam. A role is the Definition, a chain rung is a Provider, and a skill step is the Consumer (inferred).
- Layer provenance. `--dump-config` and `--dump-default-config` show the merged tree and the tree without user layers. omt has `omt config show` and `--defaults` (`omt:docs/spec.md:372-379`), but it does not show which layer set a value (inferred from the spec).
- One extension-point table per kind of change (`dsh:docs/architecture.md:143-164`). omt's spec plays this role for the CLI.
- The loop, HMR, effects, and waterfalls need a runtime that omt does not have. T3 owns the loop (`omt:docs/design.md:11`).

### Q2. The agent loop and lifecycle

#### Turns and steps

- A step is one model request plus its tool calls. A turn is zero or more steps. It opens before its first input is claimed and closes once nothing is owed (`dsh:docs/architecture.md:86`).
- The turn flow is `turn/start`, claim input, assemble the prompt, `agent/pre-step`, `step/start`, `agent/request`, stream, `assistant/message`, tool calls, `step/end`, `agent/turn-stopping`, and `turn/end` (`dsh:docs/architecture.md:88-107`).
- A round is an outer policy iteration that contains a turn, such as a goal round or a Ralph round (`dsh:docs/glossary.md:39`).
- `agent/turn-stopping` is a serial checkpoint. A listener can steer the agent there, and fresh steering runs another step (`dsh:docs/subsystems/core.md:1037`).
- Turn-end reasons are `completed`, `aborted`, `blocked`, `error`, `max-tokens`, `interrupted`, and `forked` (`dsh:packages/core/session/src/types.ts:201-232`).
- I found no step or turn cap in the core loop. The only limit is 10 parallel tool calls (`dsh:packages/core/agent-loop/src/constants.ts:5-6`; the absence is inferred from a grep).

#### Input kinds

- `followup` targets the next turn and wakes the agent. `steer` targets the next step and wakes it. `inject` targets the next step and does not wake it (`dsh:packages/core/agent-loop/src/agent.ts:163-173`, `dsh:docs/subsystems/core.md:116-140`).
- A turn-boundary claim takes all next-step input plus one queued prompt (`dsh:packages/core/agent-loop/src/inbox.ts:109-114`).

#### Goals

- A goal is one durable objective on an existing session. Its phases are `active`, `paused`, `blocked`, and `complete` (`dsh:docs/glossary.md:25`).
- A goal round is one goal-sourced turn. Human turns do not use up the round cap (`dsh:docs/glossary.md:26`).
- The user sets a goal with `/goal <objective>` (`dsh:packages/goal/command-goal/src/index.ts:16`). The model can call `create_goal` only in a direct human turn (`dsh:packages/goal/tool-goal/src/index.ts:207-232`).
- The round prompt says "Treat the current workspace, tool results, and durable session state as authoritative; inspect them instead of assuming earlier narration is still current" and "Before claiming completion, gather evidence that the whole objective is achieved" (`dsh:packages/goal/goal-round-driver/src/prompt.ts:15-24`).
- A round starts only when the agent is idle, the goal is active and armed, and no other prompt waits (`dsh:packages/goal/goal-round-driver/src/index.ts:103-109`).
- At the cap, the driver blocks the goal with code `round-limit` (`dsh:packages/goal/goal-round-driver/src/index.ts:166-171`).
- The model may mark a goal `blocked` only after the same condition persists for 3 consecutive rounds. "Difficulty, uncertainty, or useful remaining work is not blocked" (`dsh:packages/goal/tool-goal/src/index.ts:115-123`, `:38-40`).
- After `complete` or `blocked`, a wrap-up prompt asks the model to "summarize what was done and how it was verified" and to call no more tools (`dsh:packages/goal/tool-goal/src/wrapup.ts:17-40`).
- The budget is a round count only. It does not meter tokens, money, or time (`dsh:packages/goal/goal/README.md:158`).
- The model cannot resume a paused goal. Pause, resume, and edit need a direct human request (`dsh:packages/goal/tool-goal/src/index.ts:270-289`).
- A turn that ends on `max-tokens`, or an agent error, disarms continuation (`dsh:packages/goal/goal-round-driver/src/index.ts:246-249`, `:332-336`).

#### Jobs

- Background jobs have the tools `job_output`, `job_list`, and `job_kill` (`dsh:packages/jobs/tool-jobs/src/index.ts:311`, `:352`, `:372`).
- A finished job wakes an idle owner with a follow-up. Otherwise, or after a wake budget, it injects a notice into the next step (`dsh:packages/jobs/tool-jobs/src/index.ts:295-307`).
- The prompt section says "You are notified in-session when a job finishes, do not busy-poll or sleep on one" (paraphrase of `dsh:packages/jobs/tool-jobs/src/index.ts:253`). omt's `delegation.md` waiting rules carry the same idea (`omt:docs/spec.md` section 15.2).

#### Compaction and context

- Compaction runs on `agent/pre-step` under pressure and on `agent/request-error` for context overflow (`dsh:packages/compaction/compaction-basic/src/index.ts:158-176`, `:190-234`).
- Defaults are `thresholdRatio` 0.8 and `retainRatio` 0.16 (`dsh:packages/compaction/compaction-basic/src/config.ts:20-23`).
- A model-free pruner runs first. It keeps the first 4,096 and last 1,024 characters of tool results over 8,192 characters (`dsh:packages/compaction/compaction-tool-result-pruner/src/config.ts:7-14`).
- The summary prompt asks for fixed sections. They are Primary Request and Intent, Key Technical Concepts, Files and Code, Errors and Fixes, Pending Jobs, Current Work, Next Step, and Critical Context (`dsh:packages/compaction/compaction-basic/src/summarizer.ts:32-67`).
- Large tool results spill to storage over 12,500 tokens in base. The model keeps a head, a tail, and a locator (`dsh:packages/spill/spill-policy/src/index.ts:98-118`, `dsh:packages/bundle/base/cordis.patch.yml:407-410`).
- Instruction discovery reads `$DSH_HOME/AGENTS.md`, then `AGENTS.md`, `CLAUDE.md`, and their `.local.md` overlays from the project root down to the cwd (`dsh:packages/context/agent-instructions/src/files.ts:285-313`, `dsh:packages/context/agent-instructions/src/config.ts:11-13`).

#### Interruption and resume

- A cancelled stream with content is logged as an interrupted `assistant/message`. Without content it is an `assistant/attempt` (`dsh:packages/core/agent-loop/src/agent.ts:445-477`).
- When a step fails, each unanswered tool call gets a synthetic result, `TOOL_OUTCOME_UNKNOWN` or `TOOL_NOT_STARTED` (`dsh:packages/core/agent-loop/src/agent.ts:342-353`).
- On resume after a crash, the loop appends the missing tool errors, `step/end`, and `turn/end{interrupted}` (`dsh:packages/core/agent-loop/src/index.ts:840-856`).
- A fork must start at a turn boundary (`dsh:docs/subsystems/session.md:681-683`).

#### Plan mode and todo

- `exit_plan_mode` needs a Markdown plan that starts with `#`. It asks the human "Approve this plan and leave plan mode?" with Approve and Keep planning (`dsh:packages/plan/plan-mode/src/index.ts:299-315`).
- Plan mode is soft guidance in a prompt section (`dsh:docs/subsystems/plan.md:5`).
- `todo_write` replaces the whole list. The list resets at the next `turn/start` (`dsh:docs/subsystems/todo.md:22-32`).

### Q3. Multi-agent

#### Subagent seam

- Six providers register on `ctx.subagents`: `spawn-in-process`, `fork-in-process`, `acp`, `codex`, `claude-code`, and `dsh-sdk` (`dsh:docs/subsystems/subagent.md:7`).
- The base bundle mounts `spawn` and `fork`, a continuable `subagent` tool, and a one-shot `subagent_fork` tool (`dsh:packages/bundle/base/cordis.patch.yml:352-399`).
- The tool takes `description` and `prompt`. `provider`, `model`, `reasoning_effort`, and `run_in_background` appear only when config enables them (`dsh:packages/subagent/tool-subagent/src/index.ts:390-427`).
- No agent-type, persona, or tools input exists. Persona and tool filters are deployment config (`dsh:packages/subagent/tool-subagent/src/index.ts:48-104`).
- The spawn description says the child "does not share this conversation's context, so include everything it needs" (`dsh:packages/subagent/tool-subagent/src/index.ts:266-275`). omt's brief rule says the same (`omt:docs/design.md:51`).
- In continuable mode the prompt section says "Start independent delegations together in one assistant message and continue useful work while they run" (paraphrase of `dsh:packages/subagent/tool-subagent/src/index.ts:594-605`).

#### What a child gets

- A spawn child has its own session and system prompt and zero parent context (`dsh:packages/subagent/subagent-spawn-in-process/src/index.ts:1-5`).
- Every in-process child gets this fixed text. "Your permission scope was fixed when you were started and cannot be widened... operations that require approval are rejected automatically" (`dsh:packages/subagent/subagent/src/child-agent.ts:200-219`).
- A child inherits the parent's provider, model, and effort unless the call overrides them (`dsh:packages/subagent/subagent/src/child-agent.ts:99-120`).
- A child shares the parent's cwd. I found no worktree code in the subagent packages (`dsh:packages/subagent/subagent/src/child-agent.ts:139-157`; the absence is inferred from a grep).
- Child approval policy is pinned to `never` (`dsh:packages/subagent/subagent/src/child-agent.ts:267-280`).
- Out-of-process children get a scrubbed environment. Names that match `/KEY|PASSWORD|SECRET|TOKEN/i` and all `DSH_*` names are dropped (`dsh:packages/subprocess/subprocess/src/index.ts:40-80`).

#### Limits

- `maxDepth` defaults to 1 and `maxActiveSubagents` to 8 (`dsh:packages/subagent/subagent/src/index.ts:189-202`). omt's defaults are `maxDepth` 1 and `maxParallel` 4 (`omt:docs/spec.md:606`).
- At the cap the error says "wait for an existing child to finish or complete this work with the current agents" (`dsh:packages/subagent/subagent/src/continuation-activation.ts:40-57`).

#### Result contract

- A foreground call returns `output`. A background call returns a job id. A continuable call returns a subagent id (`dsh:packages/subagent/tool-subagent/src/index.ts:429-467`).
- `SubagentResult` holds `output` (the last non-empty assistant message), optional `structured`, a diagnostic capped at 4,096 bytes, and `stopReason` (`dsh:docs/subsystems/subagent.md:288-321`).
- Structured output uses a forced `structured_output` tool. "Only the tool call counts as your result" (`dsh:packages/subagent/subagent-in-process-driver/src/structured.ts:19-29`). Only workflow `agent()` passes a schema (`dsh:packages/workflow/workflow-ptc/src/host.ts:200-211`).
- A continuable child is told to `send_message` its result to the parent before it finishes, because "the parent ... does not automatically receive your transcript, tool output, or reasoning" (`dsh:packages/subagent/subagent/src/continuation-messages.ts:81-97`).
- When a continuable child settles, the parent gets a notice with the child's closing message (`dsh:packages/subagent/subagent/src/continuation-messages.ts:106-160`).

#### External harnesses as children

- Codex runs as `codex app-server --stdio` with an ephemeral thread. The result is the `final_answer` phase of the last agent message (`dsh:packages/subagent/subagent-codex/src/wire.ts:288-299`, `:664-675`).
- Claude Code runs through the Agent SDK with `persistSession: false` and no `AskUserQuestion`. Its permission callback denies with "This unattended Claude Code subagent cannot request human approval" (`dsh:packages/subagent/subagent-claude-code/src/run.ts:43-56`, `:325-350`).
- ACP, Codex, Claude Code, and dsh-SDK children are one-shot only (`dsh:packages/subagent/subagent-spawn-in-process/src/index.ts:61-65`).

#### Workflows and Ralph

- A workflow script has `agent`, `pipeline`, `parallel`, `phase`, `log`, and `args`. A failed child resolves to `null` (`dsh:packages/workflow/tool-workflow/src/index.ts:158-166`).
- Concurrency is `min(16, max(1, cores - 2))`, with at most 1,000 agents per run (`dsh:packages/workflow/workflow-ptc/src/index.ts:31-43`).
- Workflows are not journaled and cannot resume (`dsh:packages/workflow/workflow/README.md:126-130`).
- Ralph runs one fresh child per round. The child gets the immutable objective, the round number, and the previous structured handoff (`dsh:packages/workflow/tool-ralph/src/index.ts:152-160`).
- The round prompt says "The shared workspace and its current working tree are the long-term memory and source of truth" and "Treat the previous report only as a bounded handoff; confirm it against the workspace" (`dsh:packages/workflow/tool-ralph/src/index.ts:157`).
- The report schema is `status` (`continue`, `complete`, `blocked`), `summary`, `evidence[]`, `nextSteps[]`, and `blocker` (`dsh:packages/workflow/tool-ralph/src/index.ts:89-99`).
- Validation is strict. `continue` needs next steps and an empty blocker. `complete` needs evidence, no next steps, and an empty blocker. `blocked` needs a concrete blocker. A report over `maxHandoffChars` fails (`dsh:packages/workflow/tool-ralph/src/index.ts:110-147`).
- The loop stops at the first `complete` or `blocked`, at a failed round, or at the round cap with `budget-limited` (`dsh:packages/workflow/tool-ralph/src/index.ts:161-174`).
- The tool policy says "Completion and blockers are worker reports, not independent evaluation" (`dsh:packages/workflow/tool-ralph/src/index.ts:405-409`).

#### Agent Teams (experimental)

- Roles are `lead` and `teammate`. Only the lead spawns or interrupts (`dsh:docs/subsystems/agent-team.md:13-21`, `dsh:packages/experimental/agent-team/README.md:128`).
- The mailbox is durable. A message is logged as queued before delivery and acknowledged after the target stores it (`dsh:packages/experimental/agent-team/README.md:132`).
- The task board is a DAG of `blockedBy` edges with compare-and-set on a revision. `writeScopes` are advisory, not locks (`dsh:docs/subsystems/agent-team.md:56-72`).
- Teams run in one process and one shared checkout with no worktree (`dsh:packages/experimental/agent-team/README.md:205-208`).

#### Review roles

- Auto review is a per-tool-call permission reviewer on the same model, not a code reviewer (`dsh:packages/experimental/auto-review/README.md:12`).
- The GitHub webhook example opens a read-only review session on `ready_for_review` (`dsh:apps/cli/config/examples/github-review/github-ready-review-rule.mjs:20-61`).
- I found no planner, worker, and reviewer split in the product (inferred from greps). omt is ahead here.

### Q4. Self-improvement

#### In the product

- Feedback is a per-message rating (`positive` or `negative`) with an optional note and category (`dsh:docs/subsystems/feedback.md:17-38`).
- There are seven fixed categories. They are task-result, instruction-following, product-interaction, service-stability, resource-cost, security-privacy-permission, and other (`dsh:docs/subsystems/feedback.md:214-224`).
- Feedback events are log-only and "never enter model context" (`dsh:docs/subsystems/feedback.md:5`). `/feedback` never starts model work (`dsh:packages/feedback/command-feedback/README.md:12`).
- The decision note rejected an immediate LLM request on feedback (`dsh:.agents/notes/implemented/architecture/2026-09-05-canonical-feedback-log.md:27`).
- No package reads feedback to change prompts, skills, or config (inferred from a grep of `packages/` and `apps/`).
- No memory package exists. The memory guide offers three third-party MCP memory servers as default-off configurations (`dsh:docs/user/guide/mcp-memory.md:5`, `:31`).
- Session search exists but is off in shipped bundles (see the catalog note check, item 3).
- Session references let the user attach a bounded, read-only snapshot of another session as untrusted context (`dsh:packages/context/session-reference/src/index.ts:55-63`).

#### Uploads

- The `session-log-deepseek` plugin sends the unaccepted log suffix with official DeepSeek requests. A 2xx response appends a watermark (`dsh:packages/session/session-log-deepseek/README.md:40`, `:47`).
- The upload can include the working directory, prompts, user and assistant content, tool arguments and results, compaction summaries, and feedback (`dsh:docs/deepseek-llm-api-wire-extensions.md:160`).
- The decision note says opt-in "does not supply the complete trajectory from ordinary product requests" (`dsh:.agents/notes/implemented/architecture/2026-09-14-session-log-upload-default.md:24`).
- OTel session upload defaults to `FEEDBACK_ONLY`. A feedback event releases the log prefix (`dsh:packages/bundle/base/cordis.patch.yml:204-211`, `dsh:packages/session/session-telemetry-otel/README.md:34-37`).
- The minimal profile matches "the intended training runtime" (`dsh:.agents/notes/archived/feature/2026-08-11-minimal-profiles-bare-two-tool-runtime.md:10`). Archived notes are frozen history, not current authority (`dsh:.agents/notes/README.md:42`).
- So the data flow from a run to changed behavior is probably server-side training on uploaded trajectories (guess). The repository says nothing about training on them (inferred from a search).

#### In the repository process

- A postmortem is written when a bug is subtle, systemic, and costly to rediscover. It must link the guardrails it motivated (`dsh:docs/postmortem/README.md:9`).
- Each postmortem opens with a thirty-second executive summary, then Summary, Timeline, Root cause, and Guardrails (`dsh:docs/postmortem/README.md:11`).
- Postmortem 0003 used the persisted session event log as evidence and cited event sequence numbers (`dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:17`). The agent had declared success on an HTTP 200 from the wrong server (`dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:28-29`).
- Its lessons are "Acceptance names the exact origin and externally observes the requested change there" and "A regression test must be able to fail for the reported mechanism" (`dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:51-53`).
- Its guardrail changed a model-visible prompt section. The canonical URL now goes into the `app:web-surface` section and `$DSH_WEB_URL` (`dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:42`).
- Postmortem 0001 became testing policy. "A guard only guards if the regression fails it... introduce the regression, watch red, revert" (`dsh:docs/testing.md:40`).
- Postmortem 0002 produced an AGENTS.md rule, a config gate, and a snapshot check (`dsh:AGENTS.md:126`, `dsh:scripts/verify-cordis-config.ts:509-527`, `dsh:packages/test-support/session-snapshot/src/suite.ts:1198`).
- `docs/defensive-patterns.md` collects "hard-won bug-class rules", each from a defect that shipped or nearly shipped (`dsh:docs/defensive-patterns.md:5`).
- AGENTS.md requires that a checkable invariant become an executed gate, and that each acceptance path is shown to reject an invalid case (`dsh:AGENTS.md:172`).
- Agent Notes record decisions and the alternatives given up (`dsh:.agents/notes/README.md:5`). A `rejected/` note is kept only while it prevents a tempting mistake (`dsh:.agents/notes/README.md:14`).

#### Skill evolution from review feedback (proposed)

This is the only designed loop that changes agent instructions from past work.

- Scope. The tool runs daily with a two-day overlap window against `origin/master` (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:13`).
- Data. It takes inline review comments and review submissions from humans only, created and edited before the merge (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:33`).
- Adoption evidence. Merge status, a resolved thread, or an author's "fixed" reply is "context rather than adoption proof". The tool compares the PR patch at feedback time with the final PR patch (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:37`).
- Classification. Two independently configured reviewers classify authorship and adoption. Only items that both mark human-authored and adopted go on. A second pass classifies them against the current skill as candidate, covered, specific, or not feedback (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:41`).
- Drafting. The primary reviewer drafts from structured agreed guidance, never raw review text. Both reviewers must approve the same diff, with a bounded revision loop (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:43`).
- Independence. The tool refuses to run when both reviewer commands are byte-identical executables (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:47`).
- Untrusted input. Feedback is wrapped in a nonce-tagged `<untrusted-feedback>` block (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:47`).
- Gates. `doc-sync` and `lint` run on the candidate (`dsh:docs/cookbook/maintaining-dsh-code-review.md:15`).
- Provenance. A manifest records the source commit, the source skill blob, feedback ids and URLs, evidence ranges, verdicts, and gate results (`dsh:docs/cookbook/maintaining-dsh-code-review.md:17`).
- Promotion. A human reads the diff "on its own merits" and discards, batches, or promotes it (`dsh:docs/cookbook/maintaining-dsh-code-review.md:23-41`). The promote helper stops when the skill changed since the run (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:51`).
- Rejected alternatives include "Treat merge or thread resolution as adoption", "Create or merge repository changes automatically", and "Use one reviewer as author and final judge" (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:63-66`).
- Result. One observed run scanned 62 PRs and 426 human items and produced 0 candidates (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:72`). "No candidate" is the common case (`dsh:docs/cookbook/maintaining-dsh-code-review.md:52`).

#### Evals and benchmarks

- `BENCHMARK.md` is three lines with no task set, grader, or score (`dsh:BENCHMARK.md:1-3`).
- `benchmarks/` holds performance gates for user paths, not agent quality (`dsh:benchmarks/AGENTS.md:3`). Budgets are reviewed constants that environment variables cannot override (`dsh:benchmarks/AGENTS.md:12`).
- The main regression tier is keyless replay of recorded sessions through shipped profiles (`dsh:AGENTS.md:92`, `dsh:docs/testing.md:14`). Every non-trivial model-visible change adds or updates a scenario (`dsh:docs/testing.md:55`).
- There are 123 session, 56 Web, 24 SDK, and 9 ACP snapshot scenarios (count of `snapshot.yml` files).
- An agent-quality bench appears only in a proposal (`dsh:.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md:100`).

#### Data flow summary

- In the product, a run goes to the log, the log goes to DeepSeek, and any later use is server-side and unknown (guess).
- In the repository, an incident leads to a postmortem from the event log, then a guardrail (gate, test, prompt section, or AGENTS.md rule), then a reviewed PR. People do every step.
- For review feedback, merged PRs go through an adoption check, dual classification, a candidate skill diff, gates, and human promotion. This flow is proposed and private.

### Q5. Safety and verification

#### Guards

- `repeat-tool-reminder` counts identical calls by tool name and key-sorted JSON arguments. It reminds at 3, 5, and 8 repeats (`dsh:packages/guard/repeat-tool-reminder/src/index.ts:180`, `:196-214`).
- The first reminder says "Carefully analyze the previous result before calling again: if the task is not complete, try a different approach or different arguments" (`dsh:packages/guard/repeat-tool-reminder/src/index.ts:70-74`). Later reminders say "finish the task if enough evidence has been gathered" (`dsh:packages/guard/repeat-tool-reminder/src/index.ts:77-86`).
- The reminder is advice only. It never blocks, and it goes silent after the last threshold (`dsh:packages/guard/repeat-tool-reminder/README.md:168-173`).
- `timeout-policy` applies only to tools that declare `timeoutMs` (`dsh:packages/guard/timeout-policy/src/index.ts:55-59`).

#### Tool pipeline and approval

- The pipeline is `tool/call`, `tools/pre-execute` (hooks, permission, sandbox), monotonic guards, `tools/execute`, the tool body, `tools/post-execute`, and `tool/result` (`dsh:docs/tool-execution-pipeline.md:10-29`).
- Monotonic guards can only deny. Listener order cannot turn a denial into permission (`dsh:packages/core/tools/src/index.ts:723-731`).
- Without an approval service or an answerer, an ask becomes a deny (`dsh:packages/core/tools/src/index.ts:1731-1767`). Every request writes an asked and decided audit pair (`dsh:packages/interaction/user-approval/src/index.ts:197-233`).
- Permission presets bundle a sandbox mode with an approval policy. Base ships read-only with ask, workspace-write with ask, and danger-full-access with never (`dsh:packages/bundle/base/cordis.patch.yml:250-262`).
- `ask_user_question` has a timed mode. After the deadline the agent continues, and the question stays answerable. The pending result says "Do not treat this as permission" (`dsh:packages/interaction/tool-ask-user/src/timed.ts:12-17`).

#### Sandbox

- Modes are `read-only`, `workspace-write`, and `danger-full-access` (`dsh:packages/sandbox/sandbox/src/index.ts:30-33`).
- The local provider picks bubblewrap, Landlock, Seatbelt, or a Windows ACL runner and fails closed when none works (`dsh:packages/sandbox/sandbox-local/README.md:12`, `:57`).
- After a denial, the model may retry once with a wider mode, which needs approval (`dsh:packages/sandbox/sandbox/README.md:56-66`).
- `SAFETY.md` says the project is not audited, that sandboxing does not guarantee isolation, and that users should prefer a disposable VM or container (`dsh:SAFETY.md:7`, `:13-20`).

#### Defensive patterns

- The page lists seven rules. Examples are "Report orthogonal outcomes independently" (a process can time out and exit 0) and "Async state is not synchronous state" (`dsh:docs/defensive-patterns.md:7-17`).
- Spawned commands get a scrubbed environment, and temp files use private directories and exclusive owner-only opens (`dsh:docs/defensive-patterns.md:27-29`).

#### Done criteria and evidence

- No code checks that a "done" claim has evidence. Goal completion checks only who asks (`dsh:packages/goal/tool-goal/src/authority.ts:111-118`). Ralph checks only that the `evidence` list is not empty (`dsh:packages/workflow/tool-ralph/src/index.ts:129-133`).
- `workspace-changes` records per-turn changed files from private git snapshots. The model never sees that summary (`dsh:packages/deliverables/workspace-changes/README.md:12`, `:74-76`).
- `present` checks that each declared final file exists (`dsh:packages/deliverables/tool-present/README.md:12`).
- The test policy is the evidence standard. "An e2e assertion re-runs the command or re-reads the file externally; a keyword probe on the agent's own output lets a cheating agent pass. Assert untouched files are byte-identical" (`dsh:docs/testing.md:35`).
- The repository's review skill lists "Test strength" (assertions fail on the intended regression and do not trust an agent's report) and "Negative controls" (a deliberately invalid case fails through the real runner) (`dsh:.agents/skills/dsh-code-review/SKILL.md:43`, `:45`).
- The same skill says "a short review with one substantiated blocker is better than a list of nits" (`dsh:.agents/skills/dsh-code-review/SKILL.md:8`).

### Q6. First-run experience

- One command starts the Web UI at `http://127.0.0.1:3080` and opens the browser (`dsh:README.md:19-27`).
- The CLI has no default profile. `dsh` with no profile fails with "--profile <name> is required" (`dsh:apps/cli/src/args.ts:177-180`). `dsh web` is the documented entry (`dsh:apps/cli/README.md:9-18`).
- The Web client first shows a versioned "Preview Notice". It shows the DeepSeek key step only when no provider is reachable (`dsh:packages/client/ui-settings-models/README.md:14`, `:60`).
- The guide's first task is "Summarize this repository and identify its main packages" (`dsh:docs/user/guide/index.md:19-21`).
- The desktop welcome window appears only when the user has neither a sign-in nor a key. It offers Sign in, Add API Key, and Set up later (`dsh:apps/desktop/src/welcome-api.ts:73-75`, `dsh:apps/desktop/src/client/WelcomePage.tsx:211-217`).
- Sign-in uses PKCE with a loopback callback (`dsh:apps/desktop/README.md:477`).
- The preset guide dialog has copyable example tasks for each mode (`dsh:packages/client/ui-agent-preset/README.md:34`).
- The Plugins page has "Let the agent create a plugin", which opens Creator mode (`dsh:packages/client/ui-plugin-manager/README.md:42-53`).
- The Trajectory tab shows a turn-by-turn ledger with timing and token counts (`dsh:packages/client/ui-trajectory/README.md:12`).
- Rough edges exist. `docs/user/index.md` redirects to a quickstart page that does not exist under `docs/` (`dsh:docs/user/index.md:1-7`). A desktop README line says the Sign in button is disabled, but the code enables it (`dsh:apps/desktop/README.md:468`, `dsh:apps/desktop/src/client/WelcomePage.tsx:212`).
- The "wow" parts, in my reading, are the single command, a working default model, and the Trajectory tab (inferred). Nothing in dsh runs a demo task for the user (`dsh:packages/client/ui-settings-account/README.md:62-64`).

### Q7. Other strong and unusual features

- **Generated catalogs with freshness gates.** The tool catalog, config catalog, and persistence schema are generated, and gates keep them current (`dsh:AGENTS.md:100`, `dsh:docs/tool-catalog.md:1-2`). `scripts/run-gates.ts` references 54 distinct `verify-*` scripts (count by grep).
- **Prose standard against leaked reasoning.** `dsh-trim-cot-leakage` removes text such as "used to", "no longer", "rejected in review", and dead decision citations (`dsh:.agents/skills/dsh-trim-cot-leakage/SKILL.md:3`). AGENTS.md says comments "state complete contracts and context, not reasoning transcripts" (`dsh:AGENTS.md:172`).
- **Tool-definition guidance.** `agent-experience` says to start with minimal context, return bounded output with ids to fetch more, say each fact once, and "compare first-turn prompt tokens before and after a tool-definition change" (`dsh:.agents/skills/agent-experience/SKILL.md:6-19`).
- **Programmatic tool calling.** The model writes one program that calls tools as async functions through the guarded pipeline (`dsh:docs/subsystems/ptc-runtime.md:9-27`). This needs loop ownership.
- **Request series and cache reuse.** The compaction summary replays the prefix and appends the instruction last so the provider cache is reused (`dsh:packages/compaction/compaction-basic/src/summarizer.ts:25-31`).
- **Webhook sessions.** A signed GitHub event starts a read-only review session and returns 202 at once (`dsh:packages/webhook/webhook-github/src/handler.ts:82-120`). T3 has `watch_pull_request` for a similar wake (T3 session).
- **Rejected-ideas registry.** Rejected Agent Notes stay only while they stop a plausible mistake (`dsh:.agents/notes/README.md:14`). omt's design.md "out of scope" list does a similar job (`omt:docs/design.md:81-86`).

## 3. Ideas for omt

This section is analysis. It is not a list of facts from the clone.

### Constraints that apply

- The CLI has zero runtime dependencies, no daemon or server, and no network calls or telemetry (`omt:docs/spec.md:9`, `:18`, `omt:docs/design.md:11`).
- T3 owns the agent loop. omt sees children only through `delegate_task`, `task_status`, and `t3_thread_read` (`omt:docs/design.md:15-23`).
- Memory is out of scope today (`omt:docs/design.md:84`). Every idea that stores lessons across runs needs an owner decision. Those ideas are marked **Owner decision**.

### Ranked list

| Rank | Idea | Effort | Owner decision |
| --- | --- | --- | --- |
| 1 | Lesson promotion from run evidence (`omt-retro`) | M | Yes |
| 2 | Full run record (brief and result per request id) | S | No |
| 3 | Cross-run ledger metrics as a regression signal | S to M | Partly |
| 4 | Strict result-block validation in the CLI | S | No |
| 5 | "Verify the world" rules for test, review, and oracle | S | No |
| 6 | Run postmortem from the ledger | S | No |
| 7 | Goal-round policy text for `omt-loop` (removed on 2026-10-28) | S | No |
| 8 | Fresh-child rounds (Ralph mode) with an independent completion check | M | No |
| 9 | Feedback capture with fixed categories | S | Yes |
| 10 | `omt plan check` for scope overlap and dependency order | S | No |
| 11 | Run timeline HTML for T3 preview | M | No |
| 12 | First-run example tasks | S | No |
| 13 | Repeat-finding detector across fix rounds | S | No |
| 14 | Config layer provenance | S | No |
| 15 | Fixed-permission line in briefs | S | No |
| 16 | Generated spec tables with a freshness test | S | No |

### 1. Lesson promotion from run evidence (`omt-retro`)

- **What.** A periodic, human-gated loop that turns adopted review findings into proposed edits to a project lessons file or to omt's own role personas. It copies the dsh rules. Learn only from findings that a later round adopted. Use two reviewers from different families. Draft from structured findings, never raw text. Run gates. Let a human promote. Stop when the target changed since the run.
- **Source.** `dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:15-51`, `:57-66`. `dsh:docs/cookbook/maintaining-dsh-code-review.md:9-52`.
- **Adoption rule for omt.** A finding counts as adopted when the ledger shows a `REQUEST_CHANGES` review for a unit, then a fix round, then `APPROVE` and `verified` for that unit (inferred mapping onto `omt:docs/spec.md:496-503`). A rejected `DONE` claim is a second source.
- **omt surfaces.** A new `omt-retro` skill (user-invoked). An `omt retro collect` CLI command that reads `.omt/ledger.jsonl` and the run record (idea 2) and prints candidate items as JSON. Two `review`-role `delegate_task` children with `--against` set to different families classify and draft. Output goes to `.omt/retro/<timestamp>/` with a diff and a manifest (source ledger lines, target file hash, verdicts, gate results). An `omt retro apply` command refuses when the target hash changed.
- **Effort.** M.
- **Constraints.** No network is needed. No daemon is needed if the user runs it, or if a `schedule_task` heartbeat triggers it (T3 session). Memory is out of scope in `omt:docs/design.md:84`. **Owner decision.** dsh's own run produced 0 candidates from 426 items, so expect a low yield and keep the "no candidate" result silent.

### 2. Full run record (brief and result per request id)

- **What.** Apply "model-visible means logged" to omt. Save each rendered brief and each child's final result block under `.omt/runs/<clientRequestId>/`. A retro, a postmortem, or an eval can then rebuild what each child saw and said without T3.
- **Source.** `dsh:docs/architecture.md:123`, `:127`. `dsh:AGENTS.md:136`.
- **omt surfaces.** `omt brief --json` writes `brief.md` beside its output when `--plan` and `--unit` are set. `omt ledger add` gains `--result-file` to store the result block. `omt paths` gains `--runs`. Add `runs/` to `.omt/.gitignore` (`omt:docs/spec.md:385`).
- **Effort.** S.
- **Constraints.** None blocking. T3 already stores the child thread, which `t3_thread_read` can read (T3 session). The local copy matters because the CLI cannot call T3 (`omt:docs/design.md:45`).

### 3. Cross-run ledger metrics as a regression signal

- **What.** dsh has no agent-quality benchmark. Its performance gates use reviewed constant budgets (`dsh:benchmarks/AGENTS.md:12`). omt can measure its own quality from the ledger. Examples are first-round approval rate, fix rounds per unit, rejected `DONE` claims, oracle `BLOCK` rate, and `round-limit` stops, per role, model, and omt version.
- **Source.** Pattern from `dsh:benchmarks/AGENTS.md:3-16` and the missing agent bench noted in `dsh:.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md:100`.
- **omt surfaces.** `omt ledger stats --all --json` over every plan. Each ledger entry gains the omt version. A skill change can then be compared on the same task mix (inferred).
- **Effort.** S for the stats. M to add a fixed task set that runs through T3 on a schedule.
- **Constraints.** No telemetry, so the stats stay local. A step that changes role chains from these numbers is auto-tuning. That is a new kind of learned state. **Owner decision** for that part.

### 4. Strict result-block validation in the CLI

- **What.** Copy Ralph's report rules onto omt's result blocks. `DONE` needs at least one `VERIFY` line that passed and `OPEN: none`. `BLOCKED` needs a concrete reason. `VERIFIED` needs at least one check and an evidence path. `APPROVE` with a P0 or P1 finding is invalid. An invalid block goes back to the child as a re-ask, or the conductor reads the thread.
- **Source.** `dsh:packages/workflow/tool-ralph/src/index.ts:110-147`.
- **omt surfaces.** `omt result check <kind> --file -` with exit 1 and a reason. `results.md` tells the conductor to run it in step 6 of `omt-ulw` (`omt:skills/omt-ulw/SKILL.md`, step 6).
- **Effort.** S.
- **Constraints.** None. It is deterministic work, which design.md assigns to the CLI (`omt:docs/design.md:43`).

### 5. "Verify the world" rules for test, review, and oracle

- **What.** Add three dsh rules to the role personas. A check re-runs the command or re-reads the file itself and does not trust the worker's output. Untouched files stay byte-identical. Each new test comes with a negative control. The tester introduces the regression, sees the test fail, and reverts it. Add the postmortem 0003 rule that acceptance names the exact target (URL, process, file) and observes the change there.
- **Source.** `dsh:docs/testing.md:33-40`. `dsh:.agents/skills/dsh-code-review/SKILL.md:43-45`. `dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:51-53`.
- **omt surfaces.** `skills/omt/references/roles/test.md`, `roles/review.md`, `roles/oracle.md`, and `results.md`. Add a `NEGATIVE CONTROL:` line to the `test.md` result contract (`omt:docs/spec.md` section 11).
- **Effort.** S.
- **Constraints.** A negative control edits files, so it fits only edit roles. The `test` persona must restore the file inside its scope, because the checkout is shared (`omt:docs/design.md:61-63`).

### 6. Run postmortem from the ledger

- **What.** When a unit ends `blocked`, the oracle returns `BLOCK`, or the user reports a wrong "done", the conductor writes a short postmortem. It has an executive summary, a timeline that cites ledger lines, the root cause, why the review and test missed it, and the guardrail added. The guardrail is a test, a plan rule, or a persona line.
- **Source.** `dsh:docs/postmortem/README.md:5-11`. `dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:17`, `:40-53`.
- **omt surfaces.** A step in `omt-ulw` step 11 for failed runs. Files go to `.omt/postmortems/<slug>.md`. `omt-retro` (idea 1) reads them.
- **Effort.** S.
- **Constraints.** None for the file. Using postmortems to change later runs is the memory question in idea 1.

### 7. Goal-round policy text for `omt-loop`

- **What.** Copy four goal rules into the heartbeat prompt and the loop skill. Treat the workspace as authoritative over earlier narration. Mark blocked only after the same condition persists for 3 consecutive rounds. Difficulty is not blocked. After a context reset, stay disarmed until the user says to continue.
- **Source.** `dsh:packages/goal/goal-round-driver/src/prompt.ts:15-24`. `dsh:packages/goal/tool-goal/src/index.ts:115-123`. `dsh:packages/goal/goal/README.md:72`.
- **omt surfaces.** `skills/omt-loop/SKILL.md`. The ledger counts consecutive rounds with the same blocker note.
- **Effort.** S.
- **Constraints.** None. Native `/goal` stays T3's, as design.md requires (`omt:docs/design.md:73-75`).
- **Status, 2026-10-28.** omt-loop and the heartbeat prompt were removed. This idea has no target in current omt. See [the workflow fold design](../design/workflow-fold.md).

### 8. Fresh-child rounds (Ralph mode) with an independent completion check

- **What.** A loop mode where each heartbeat dispatches one fresh `execute` child with the objective and the previous bounded handoff. The workspace is the memory. dsh turns Ralph off because completion is a self-report. omt can fix that. A `complete` report triggers a cross-family `oracle` task before the loop stops.
- **Source.** `dsh:packages/workflow/tool-ralph/src/index.ts:152-174`, `:405-409`. `dsh:packages/bundle/base/cordis.patch.yml:440-449`.
- **omt surfaces.** `omt-loop` gains a fresh-child mode for threads without native `/goal`. The handoff is a file under `.omt/` with a size cap. `omt result check` (idea 4) validates it. The ledger counts rounds against a cap.
- **Effort.** M.
- **Constraints.** No new hook or daemon. It uses `schedule_task` and `delegate_task` (T3 session). Children share the checkout, so only one round runs at a time.
- **Status, 2026-10-28.** The workflow fold rejects rounds that a heartbeat drives: the main thread waits for children inside its turn, and omt-loop was removed. See [the workflow fold design](../design/workflow-fold.md).

### 9. Feedback capture with fixed categories

- **What.** Let the user rate a run or a unit. Store the rating, a note, and one of dsh's seven categories as a ledger entry. The model does not see it during the run. `omt-retro` reads it.
- **Source.** `dsh:docs/subsystems/feedback.md:5`, `:17-38`, `:214-224`.
- **omt surfaces.** `omt feedback --plan <slug> [--unit <id>] --rating <positive|negative> --category <name> --note <text>`, which appends a `feedback` entry to `.omt/ledger.jsonl`.
- **Effort.** S.
- **Constraints.** Local only, no upload. Its only purpose is learning across runs. **Owner decision.**

### 10. `omt plan check` for scope overlap and dependency order

- **What.** dsh's team task board has `blockedBy` edges and advisory `writeScopes`. omt already requires disjoint scopes for parallel units, but only as a skill rule (`omt:skills/omt-ulw/SKILL.md`, step 4). A CLI check can enforce it. It reports two units with no dependency path whose scopes overlap, a dependency on a missing unit, and a cycle.
- **Source.** `dsh:docs/subsystems/agent-team.md:56-72`.
- **omt surfaces.** `omt plan check <slug>`, exit 1 on a conflict. `omt-plan` and `omt-ulw` step 4 run it before dispatch.
- **Effort.** S.
- **Constraints.** None. It is not a DAG scheduler, which is out of scope (`omt:docs/design.md:84`). It only validates the plan.

### 11. Run timeline HTML for T3 preview

- **What.** A static HTML page of one run, built from the plan and the ledger. Each unit is a row with dispatch, review, test, and oracle events, model, round, and verdict. dsh's Trajectory tab is the model (`dsh:packages/client/ui-trajectory/README.md:12`).
- **omt surfaces.** `omt ledger report --plan <slug> --html > file`. The skill shows it with `html_preview` or `html_render` (T3 session). This is the most visible "wow" for a new user (inferred).
- **Effort.** M.
- **Constraints.** Zero dependencies means hand-written HTML and inline CSS. No server.

### 12. First-run example tasks

- **What.** dsh's preset guide gives copyable example tasks, and the user guide gives one first task (`dsh:packages/client/ui-agent-preset/README.md:34`, `dsh:docs/user/guide/index.md:19-21`). `omt install` and `omt doctor` can end with three example prompts, one each for `ulw`, review, and research.
- **omt surfaces.** Install and doctor output, and the README.
- **Effort.** S.
- **Constraints.** None.

### 13. Repeat-finding detector across fix rounds

- **What.** dsh reminds the model when it repeats an identical tool call at 3, 5, and 8 repeats (`dsh:packages/guard/repeat-tool-reminder/src/index.ts:52-86`). omt cannot see tool calls. It can see review findings. When the same finding returns in round 2, the conductor should move to `deep` early or ask the user.
- **omt surfaces.** `omt ledger` stores finding ids from review blocks (with idea 2). A skill rule in `omt-ulw` step 9.
- **Effort.** S.
- **Constraints.** A per-tool-call guard needs the loop and does not fit.

### 14. Config layer provenance

- **What.** dsh shows the composed tree with and without user layers (`dsh:apps/cli/src/args.ts:171-173`). `omt config show --layers` can print each effective value with the layer that set it.
- **Effort.** S.
- **Constraints.** None.

### 15. Fixed-permission line in briefs

- **What.** dsh tells every child that its permission scope is fixed and that approval requests fail (`dsh:packages/subagent/subagent/src/child-agent.ts:200-219`). An omt brief can say "Your access is fixed. Do not ask for approval. Return BLOCKED with the command you need."
- **omt surfaces.** The brief constraints section (`omt:docs/spec.md` section 9.2).
- **Effort.** S.
- **Constraints.** Whether a T3 child can raise an approval request depends on its runtime mode (T3 session). The line costs little either way.

### 16. Generated spec tables with a freshness test

- **What.** dsh generates its tool and config catalogs and gates them (`dsh:AGENTS.md:100`). omt can generate the role defaults table in `docs/spec.md` section 6.4 from `src/config/defaults.ts`, with a test that fails when they differ.
- **Effort.** S.
- **Constraints.** None. It helps the maintainer, not the user.

### Does not fit

- The Cordis runtime, HMR, effects, and waterfalls. They need loop ownership (`dsh:docs/architecture.md:11-13`).
- Per-tool-call Auto review, the repeat-tool reminder, timeouts, and the sandbox. They sit in the tool pipeline that T3 and the provider own (`dsh:docs/tool-execution-pipeline.md:10-29`).
- Compaction and spill. T3 and the provider own context (inferred).
- Continuable children with `send_message`. T3 children cannot message the parent before they finish (T3 session).
- Agent Teams mailboxes. Team mailboxes are out of scope (`omt:docs/design.md:84`).
- Session-log upload and OTel. omt forbids network calls and telemetry (`omt:docs/spec.md:18`).
- Hook bridges and PTC. omt installs one optional Claude Code hook and no tool runtime (`omt:docs/design.md:75`).

## 4. Open questions

1. Does the owner want any state that persists lessons across runs? Ideas 1, 3 (auto-tuning part), and 9 depend on this.
2. Where should promoted lessons go? The options are a project file that briefs include, omt's shipped personas through a PR, or both.
3. Can a T3 child raise an approval request that blocks it? This decides whether idea 15 matters (T3 session).
4. dsh's skill maintenance tool is private. Its acceptance criteria are public, but no implementation is in the repository (`dsh:.agents/notes/proposed/process/2026-07-13-human-review-skill-maintenance.md:53-55`). Its yield beyond one run with 0 candidates is unknown.
