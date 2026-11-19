# oh-my-openagent (OmO): orchestration design for oh-my-t3code

Source: clone of https://github.com/code-yeongyu/oh-my-openagent, commit `eff0416` (merge of PR #9490). All file paths below are relative to the clone root. The repo is under the Sustainable Use License 1.0, so this report paraphrases designs and copies no code or prompt bodies.

Labels used in this report:

- A claim with a path is a direct read of that file.
- "(inferred)" marks a conclusion that the files do not state.
- "not found" marks a search that returned nothing, with the searches listed.

OmO ships three editions of one product:

- Native edition. The `omo` CLI on a pinned fork of pi-mono named senpi. Adapter in `packages/omo-senpi`, engine in `packages/senpi-task`.
- Ultimate edition. An OpenCode plugin in `packages/omo-opencode`.
- Light edition. A Codex CLI plugin named lazycodex, in `packages/omo-codex`.

The editions do not share one agent roster. The OpenCode edition has the Greek-named agents. The Native edition keeps only seven built-in agents. The Codex edition ships twelve agent role files. Section 1 gives the details.

## Corrections to the existing catalog note

The catalog note is the owner's private note on oh-my-openagent. It is not public. It is mostly accurate. These claims are out of date at `eff0416`:

- The profiles `capable` and `deep work` no longer exist. The doc says the retired ids `capable`, `deep-work`, and `simple-work` are not aliases (`docs/guide/agent-model-matching.md:35`). The current profiles are `recommended`, `daily-normal`, `daily-heavy`, `geeky-normal`, and `geeky-heavy` (`packages/omo-senpi/src/components/model-profile/builtin-profiles.ts:71-121`).
- The `deep` category was split into `deep-low` and `deep-high` in 2026-09. The old name resolves to `deep-low` (`packages/omo-config-core/src/schema/legacy-category-names.ts:1-8`).
- The note says the OmO agents include Sisyphus, Hephaestus, Prometheus, Atlas, and Oracle. That is true only for the OpenCode edition. The Native edition has seven built-in agents and no Greek names (`packages/senpi-task/src/agents/builtin/index.ts:14-32`).
- The Codex plugin manifest wires 21 hook files (`packages/omo-codex/plugin/.codex-plugin/plugin.json`). The package `AGENTS.md` says 23 (`packages/omo-codex/AGENTS.md`, LAYOUT table).
- The OpenCode agents table in `packages/omo-opencode/src/agents/AGENTS.md` is stale. For example it gives Hephaestus `gpt-5.6-sol` first, but the code puts `gpt-6-sol` first (`packages/model-core/src/agent-model-requirements.ts:25-40`). It gives Momus `gpt-5.6-terra`, but the code puts `gpt-6-astra` first (`packages/model-core/src/agent-model-requirements.ts:124-141`). This report uses the code.

## 1. Summary

- **Category routing, not model names.** The main agent delegates by picking a category such as `quick`, `deep-low`, or `writing`. Each category has a ranked chain of `{providers, model, variant}` candidates. The first candidate that a connected provider serves wins (`packages/senpi-task/src/category/fallback-chains.ts`, `packages/senpi-task/src/category/resolver.ts:298-420`). A category with no live candidate disappears from the list the model sees.
- **Read-only specialists are separate from category workers.** `explore`, `librarian`, `plan-consultant`, and `plan-reviewer` are curated read-only agents with their own chains. Category workers can write (`packages/senpi-task/src/agents/builtin/index.ts`, `packages/senpi-task/AGENTS.md`).
- **One delegation tool with a strict contract.** The `task` tool takes `prompt` plus exactly one of `category` or `subagent_type`, an optional `load_skills` list, `run_in_background`, and a batch of up to 16 items (`packages/senpi-task/src/tools/task/params.ts`). Skill bodies are prepended to the child prompt. A category adds its own "category context" block.
- **Every child prompt has the same shape.** It starts with `TASK:` and names `DELIVERABLE`, `SCOPE`, `VERIFY`, and `STOP WHEN` (ultrawork directive in `packages/omo-senpi/src/components/ultrawork/generated-directive.ts`, section "Child execution and transitions").
- **Ultrawork is a keyword-armed directive.** The word `ulw` or `ultrawork` injects a long directive into the user turn. It forces a goal with binding success criteria, a durable append-only notepad, a written plan, a todo list, real-surface QA evidence, and explicit stop rules (`packages/omo-senpi/src/components/ultrawork/index.ts`, `packages/prompts-core/prompts/ultrawork/*.md`).
- **Planning is a separate, read-only mode.** `ulw-plan` explores, announces an intent verdict, asks only owner-decision questions, waits for approval, writes `.omo/plans/<slug>.md`, runs a consultant gap pass, then runs up to five fresh reviewer rounds with a frozen blocker ledger (`packages/omo-senpi/skills/ulw-plan/SKILL.md`, `packages/omo-senpi/skills/ulw-plan/references/full-workflow.md`).
- **Execution is plan-driven and resumable.** `ulw-execute` records the active plan in `.omo/boulder.json`, delegates every checkbox, verifies each with five gates, ticks the box, and continues. The orchestrator never edits product code (`packages/shared-skills/skills/ulw-execute/SKILL.md`).
- **Continuation is a hook, with hard caps.** After a turn ends, a hook checks the plan or goal state. If work remains, it re-prompts the agent. Caps, stale-state signatures, abort detection, and context-pressure detection stop runaway loops (`packages/omo-senpi/src/components/ulw-loop/index.ts`, `packages/omo-codex/plugin/components/ulw-loop/src/stop-resume-hook.ts`).
- **Done means evidence.** A worker's done claim is checked by an independent verifier. Codex worker agents cannot stop until their last message names an evidence file under `.omo/evidence/` (`packages/omo-codex/plugin/components/lazycodex-executor-verify/AGENTS.md`).
- **The Codex Light edition is the closest analog.** It is a plugin with 21 command hooks, 4 MCP servers, a synced skill tree, 12 agent role files, and a TypeScript installer that edits `~/.codex/config.toml`. It has no custom delegation tool. It uses Codex's own `spawn_agent` and `create_goal` and steers them with hooks and skills (`packages/omo-codex/AGENTS.md`).
- **Codex teammode already uses app threads as team members.** The `teammode` skill can run a team on Codex app threads with one git worktree per member. That is close to T3's `t3_thread_launch` (`packages/omo-codex/plugin/components/teammode/AGENTS.md`).
- **One config file for every harness.** `~/.omo/omo.jsonc` plus walked project `.omo/omo.json[c]` layers, with per-harness blocks such as `[codex]` and named profiles (root `AGENTS.md`, section "MULTI-LEVEL CONFIG").
- **Install and setup are consent-first and idempotent.** `omo setup` detects read-only, prints one summary, asks one question, backs up each file, and never overwrites an existing entry (`docs/guide/migrating-from-opencode.md:59-109`).

## 2. Agent roster (question 1)

### 2.1 OpenCode edition (Ultimate)

Modes come from each agent file. "primary" agents use the model the user picked in the UI. "subagent" agents use their own chain (`packages/omo-opencode/src/agents/AGENTS.md`, section MODES). Chains come from `packages/model-core/src/agent-model-requirements.ts`. Denied tools come from `packages/omo-opencode/src/shared/agent-tool-restrictions.ts`.

| Agent | Purpose | Mode | Chain (first candidate, then fallbacks) | Tool restrictions |
|---|---|---|---|---|
| Sisyphus | Main orchestrator. Plans with todos, delegates by category plus skills, uses explore and librarian (`packages/omo-opencode/src/agents/sisyphus-agent-config.ts:6-7`) | primary | `claude-opus-5-5` max, then `kimi-k3`, then `gpt-5.6-sol` medium, then `glm-5.2`, then `big-pickle` (`agent-model-requirements.ts:4-24`) | None listed |
| Hephaestus | Autonomous deep worker on GPT. Explores first, then completes end to end (`packages/omo-opencode/src/agents/hephaestus/agent.ts:174-175`) | primary | `gpt-6-sol` medium, then `gpt-5.6-sol` medium. Active only when an OpenAI-family provider is connected (`agent-model-requirements.ts:25-40`) | None listed |
| Prometheus | Strategic planner with an interview. Built by a special config builder, not a factory (`packages/omo-opencode/src/agents/AGENTS.md`) | primary | `claude-fable-5-1` xhigh, then `claude-opus-5-5` max, then `kimi-k3` max (`agent-model-requirements.ts:86-104`) | Writes only `.md` files, enforced by a path hook named `prometheus-md-only` (`packages/omo-opencode/src/agents/AGENTS.md`) |
| Atlas | Runs a todo list through `task()` until every item is done (`packages/omo-opencode/src/agents/atlas/agent.ts:113-114`) | primary | `claude-sonnet-5`, then `kimi-k3`, then `gpt-5.6-sol` medium, then MiniMax models (`agent-model-requirements.ts:142-155`) | Not in the restriction table in code. The AGENTS.md table says Atlas is denied `task` and `call_omo_agent`, but `agent-tool-restrictions.ts` has no Atlas entry |
| Oracle | Read-only consultant for hard debugging and architecture (`packages/omo-opencode/src/agents/oracle.ts:420-421`) | subagent | `gpt-5.6-sol` xhigh (high on Copilot), then `gemini-3.1-pro` high, then `claude-opus-5-5` max, then `glm-5.2` (`agent-model-requirements.ts:41-57`) | No write, edit, task, or call_omo_agent |
| Librarian | External docs and open-source code search (`packages/senpi-task/src/agents/builtin/librarian.ts:6-8`) | subagent | `kimi-for-coding-highspeed` off, then `gpt-6-luna-fast` low, then `deepseek-flash`, then `qwen3.7-plus`, then `minimax-m2.7`, then `claude-haiku-4-5` (`agent-model-requirements.ts:58-67`) | No write, edit, task, or call_omo_agent |
| Explore | Contextual grep inside the repo. Run several in parallel (`packages/senpi-task/src/agents/builtin/explore.ts:6-8`) | subagent | Same chain as Librarian (`agent-model-requirements.ts:68-77`) | No write, edit, task, or call_omo_agent |
| Multimodal-Looker | Reads PDFs, images, and diagrams and returns extracted data (`packages/omo-opencode/src/agents/multimodal-looker.ts:18-19`) | subagent | `gpt-5.6-sol` low, then `kimi-k3`, then `glm-4.6v`, then `gpt-5-nano` (`agent-model-requirements.ts:78-85`) | Restriction map sets only `read: true` (`agent-tool-restrictions.ts`). The AGENTS.md reads this as "all tools except read" |
| Metis | Pre-planning consultant. Finds hidden intent, ambiguity, and likely AI failure points (`packages/omo-opencode/src/agents/metis.ts:401-402`) | subagent, temperature 0.3 | `claude-fable-5-1` max, then `claude-opus-5-5` max, then `kimi-k3` max (`agent-model-requirements.ts:105-123`) | No write or edit |
| Momus | Plan reviewer for clarity, verifiability, and completeness (`packages/omo-opencode/src/agents/momus.ts:290-291`) | subagent | `gpt-6-astra` xhigh, then lower Astra candidates, then `claude-opus-5-5` max, then `gemini-3.1-pro` high, then `glm-5.2` (`agent-model-requirements.ts:124-141`) | No write or edit |
| Sisyphus-Junior | Executor that a category spawns. Same discipline, no delegation (`packages/omo-opencode/src/agents/sisyphus-junior/agent.ts:144-145`) | subagent | `claude-sonnet-5`, then `kimi-k3`, then `gpt-5.6-sol` medium, then MiniMax, then `big-pickle` (`agent-model-requirements.ts:156-170`) | No `task` |

All agents in the restriction map are also denied the 12 team tools by default (`agent-tool-restrictions.ts`, `TEAM_TOOL_DENYLIST`).

**When the main agent calls each one.** Each agent file carries prompt metadata with triggers, `useWhen`, and `avoidWhen` lists. The Sisyphus prompt builder turns these into tables (`packages/omo-opencode/src/agents/dynamic-agent-prompt-builder.ts`, per `packages/omo-opencode/src/agents/AGENTS.md`).

- Explore. Fire in the background when two or more modules are involved. Skip it when the file location is known (`packages/omo-opencode/src/agents/explore.ts:8-25`).
- Librarian. Fire in the background when an external library comes up (`packages/omo-opencode/src/agents/librarian.ts:8-22`).
- Oracle. Use it after significant work as a self-review, after two failed fix attempts, and for multi-system trade-offs. Never use it for a first fix attempt or for trivial choices (`packages/omo-opencode/src/agents/oracle.ts:8-38`).
- Metis. Consult it before Prometheus when the request is ambiguous or complex (`packages/omo-opencode/src/agents/metis.ts:412-431`).
- Momus. Call it when a plan file is saved under `.omo/plans/`, with the file path as the only prompt. Never call it for inline plans or todo lists (`packages/omo-opencode/src/agents/momus.ts:325-355`).
- Atlas. The `/ulw-execute` built-in command runs as Atlas when Atlas is registered, else as Sisyphus (`packages/omo-opencode/src/features/builtin-commands/commands.ts:17-22,61-62`).
- Prometheus, Hephaestus, Sisyphus, Atlas. The user picks them as primary agents (inferred from mode `primary`).

### 2.2 Native edition (senpi)

The Native edition has seven built-in agents (`packages/senpi-task/src/agents/builtin/index.ts:14-32`):

| Agent | Purpose | Model | Tools |
|---|---|---|---|
| `explore` | Repo grep, parallel-friendly (`explore.ts:6-9`) | Own chain, same as the OpenCode Explore chain plus the `kimi-coding` and `anthropic-subscription` provider ids (`packages/senpi-task/src/agents/builtin/fallback-chains.ts:17-24`) | read, find, grep, ls, bash, 4 LSP read tools. `x_search` denied (`explore.ts:88-98`) |
| `librarian` | Remote repos and docs (`librarian.ts:6-9`) | Same chain as explore (`fallback-chains.ts:25-32`) | Same, plus `x_search` (`librarian.ts:75-85`) |
| `plan-consultant` | Pre-planning gap analysis. Cannot delegate (`plan-consultant.ts:5-16`) | `claude-fable-5-1` max, then `claude-opus-5-5` max, then `kimi-k3` max (`fallback-chains.ts:33-49`) | Read-only set (`plan-consultant.ts:274-283`) |
| `plan-reviewer` | Plan review against clarity and verifiability (`plan-reviewer.ts:5-8`) | `gpt-6-astra` xhigh, then lower Astra candidates, then `claude-opus-5-5`, then `gemini-3.1-pro`, then `glm-5.2` (`fallback-chains.ts:50-64`) | Read-only set (`plan-reviewer.ts:201-210`) |
| `omo-native-code-reviewer` | Diff, test, and risk audit for the ulw-loop final gate (`code-reviewer.ts:9-14`) | Category `unspecified-high` | Read-only set plus `write` for its report (`code-reviewer.ts:36-46`) |
| `omo-native-qa-executor` | Runs real QA scenarios and records evidence (`qa-executor.ts:9-14`) | Categories `deep-low`, then `unspecified-low` | Same plus `write` |
| `omo-native-gate-reviewer` | Final gate. Re-audits executor, review, and QA artifacts (`gate-reviewer.ts:9-14`) | Categories `deep-high`, then `unspecified-high` | Same plus `write` |

The four curated agents run in-process only. Their `bash` is replaced by a broker that runs only validated read-only GitHub queries and HTTPS fetches (`packages/senpi-task/AGENTS.md`, section "Builtin curated agents"). They cannot be team members. `plan-consultant` and `plan-reviewer` are "plan-gated". They spawn only when the user asked for `ulw-plan` in their own words, a `.omo/plans/*.md` file was touched this session, and `ulw-execute` has not run (`packages/senpi-task/AGENTS.md`, section "Plan-gated agents").

### 2.3 Codex Light edition

Twelve agent role files ship in `packages/omo-codex/plugin/components/ultrawork/agents/`. All run on `gpt-6-astra`. Effort varies per role:

| Role file | Effort | Purpose (from `description`) |
|---|---|---|
| `explorer.toml` | low, fast tier | Codebase search |
| `librarian.toml` | low, fast tier | External docs and OSS code |
| `plan.toml` | high | Strategic planner for unresolved design uncertainty |
| `metis.toml` | high | Pre-planning analyst |
| `momus.toml` | high | Deep plan reviewer |
| `lazycodex-worker-low.toml` | high | Small changes |
| `lazycodex-worker-medium.toml` | high | Mid-sized changes |
| `lazycodex-worker-high.toml` | medium | Large changes |
| `lazycodex-code-reviewer.toml` | medium | Read-only code review |
| `lazycodex-qa-executor.toml` | high | Manual QA with artifacts |
| `lazycodex-gate-reviewer.toml` | low | Read-only final gate |
| `lazycodex-clone-fidelity-reviewer.toml` | high | Read-only design-fidelity review |

No `sandbox_mode` key appears in any role file (`rg sandbox` over the directory returned nothing). Read-only is stated in the description and instructions only (inferred from the descriptions).

### 2.4 plan-consultant and plan-reviewer naming

`plan-consultant` is the Native and documentation name for the Metis role. `plan-reviewer` is the name for the Momus role. Evidence: the two share descriptions word for word (`packages/senpi-task/src/agents/builtin/plan-reviewer.ts:6-7` and `packages/omo-opencode/src/agents/momus.ts:290-291`), and `plan-reviewer.ts:3` says it was ported from the OpenCode plan-review prompt.

## 3. Categories (question 2)

### 3.1 The list

Builtin categories are defined per provider family in `packages/senpi-task/src/category/{openai,anthropic,google,kimi}-categories.ts` and merged in `builtins.ts:12-17`.

| Category | Intent | Default | Gate |
|---|---|---|---|
| `quick` | Trivial tasks: one file, typos, small edits (`openai-categories.ts:222-228`) | `chatgpt-subscription/gpt-6-luna-fast` low | Needs one live candidate |
| `deep-low` | Default deep lane. One goal, one deliverable, decisions settled from evidence. Backend, algorithms, 3D, browser and computer use go here. Fan out several goals as parallel calls (`openai-categories.ts:204-211`) | `gpt-6.1-sol` medium | Needs a GPT Sol model (`builtins.ts:41-50`, `openai-categories.ts:191`) |
| `deep-high` | Escalation lane. Used when the central decision cannot be settled from evidence (`openai-categories.ts:213-220`) | `gpt-6-astra` high | Needs `gpt-6-astra` |
| `ultrabrain` | Genuinely hard, logic-heavy work. Give goals, not steps (`openai-categories.ts:196-202`) | `gpt-6-astra` max | Needs `gpt-6-astra` or `gpt-5.6-sol` |
| `architect` | Big-picture design. Proposes, does not implement (`anthropic-categories.ts:24-30`) | `claude-fable-5-1` max | Needs `claude-fable-5-1`. No fallback |
| `visual-engineering` | UI, UX, CSS, animation, design systems (`google-categories.ts:116-118`) | `claude-fable-5-1` max | Needs one live candidate |
| `artistry` | Creative, unconventional problem solving (`google-categories.ts:122-124`) | `claude-fable-5-1` max | Needs one live candidate |
| `writing` | Docs and prose (`kimi-categories.ts:32-34`) | `claude-opus-5-5` low | Claude only. Disappears with no Claude model (`packages/model-core/src/category-model-requirements.ts:141-157`) |
| `unspecified-low` | Fits no category, moderate effort (`openai-categories.ts:229-234`) | `claude-sonnet-5-5` medium | Needs one live candidate |
| `unspecified-high` | Fits no category, broad effort across modules (`openai-categories.ts:236-241`) | `claude-opus-5-5` medium | Needs one live candidate |

Two more names appear only in the ulw-execute delegation router: `git` (low) (`packages/shared-skills/skills/ulw-execute/SKILL.md`, "Delegation router" table). No builtin definition named `git` was found (`rg 'name: "git"' packages/senpi-task/src/category` returned nothing).

### 3.2 Chains with reasoning levels

The Native chains live in `packages/senpi-task/src/category/fallback-chains.ts:27-172`. They mirror `packages/model-core/src/category-model-requirements.ts` with three deliberate differences (`fallback-chains.ts:3-26`):

- Every Claude candidate starts with provider `anthropic-subscription` (Claude Pro or Max), so a subscription beats a metered key.
- Every GPT candidate lists `chatgpt-subscription` before `openai`, for the same reason.
- Each candidate names a thinking level the engine accepts for that model.

Selected chains (variant in parentheses):

- `quick`: `gpt-6-luna-fast` (low), `deepseek-flash` (off), `qwen3.6-flash` (low), `minimax-m3`, `minimax-m2.7`, `grok-4.20-0309-non-reasoning`, `claude-haiku-4-5` (off), `glm-5.3-flash` (low), `mimo-v2.6-flash` (low) (`fallback-chains.ts:98-120`).
- `deep-low`: `gpt-6.1-sol` (medium), `gpt-6.1-sol-fast` (medium), `gpt-5.6-sol` (medium), `gpt-5.6-sol-fast` (medium) (`fallback-chains.ts:60-73`).
- `deep-high`: `gpt-6-astra` (high) only (`fallback-chains.ts:74-80`).
- `ultrabrain`: `gpt-6-astra` (max) on three provider groups, then `gpt-5.6-sol` (max) on three provider groups (`fallback-chains.ts:52-59`).
- `visual-engineering` and `artistry`: `claude-fable-5-1` (max), `claude-opus-5-5` (max), `kimi-k3` (max).
- `unspecified-high`: `claude-opus-5-5` (medium), `glm-5.3` (max), `kimi-k3` (max).
- `writing`: `claude-opus-5-5` (low), `claude-opus-4-6` (max).

### 3.3 Category prompt appends and caller guidance

Each category carries two texts (`packages/senpi-task/src/category/types.ts:6-15`):

- `promptAppend` is joined onto the child's prompt after the orchestrator's brief (`openai-categories.ts:5-6`). Some categories pick a different append per model family (`openai-categories.ts:132-151`).
- `callerGuidance` is shown to the orchestrator when it chooses a category.

The design intent of the appends, in summary:

- `quick` tells the child to be minimal and direct. Its caller warning says small models need numbered must-do steps, forbidden deviations, and concrete success criteria (`openai-categories.ts:154-169`).
- `deep-low` tells the child to read until it can explain the mechanism, not to ask questions, to run all listed steps in one turn, and to stop when the success criteria hold. If the decision needs a trade-off the brief does not settle, the child returns `ESCALATE: deep-high` as its first line instead of editing (`openai-categories.ts:40-50,83-93`).
- `deep-high` has the same contract for decisions that evidence cannot settle (`openai-categories.ts:95-103`).
- `architect` asks for at least two designs with trade-offs and one recommendation. In advisory mode it makes no edits (`anthropic-categories.ts:7-21`).

### 3.4 Profiles

A profile picks the main session model only. It never changes delegated children (`docs/guide/agent-model-matching.md:92-94`).

| Profile | Candidates (`builtin-profiles.ts:71-121`) |
|---|---|
| `recommended` (default when unset) | `claude-opus-5-5` medium, `claude-fable-5-1` xhigh, `kimi-k3` max, `gpt-6-astra` xhigh, `gpt-6.1-sol` medium, `gpt-6-sol` medium, `glm-5.3` max |
| `daily-normal` | `claude-opus-5-5` medium, `kimi-k3` max, `glm-5.3` max |
| `daily-heavy` | `claude-fable-5-1` xhigh |
| `geeky-normal` | `gpt-6.1-sol-fast` medium, `gpt-6.1-sol` medium, `gpt-5.6-sol` medium |
| `geeky-heavy` | `gpt-6-astra` high |

A user can pin `model_profile` to a literal `provider/model`, or add `model_profiles.<name>`, which replaces a builtin chain wholesale (`docs/guide/agent-model-matching.md:30-36`).

### 3.5 How a chain resolves

For a delegated child (`docs/guide/agent-model-matching.md:273-280`, `packages/senpi-task/src/category/resolver.ts:298-420`):

1. A user override in `omo.json` (`categories.<name>.model` or `models`) wins. Any explicit `categories.<name>` entry also bypasses the gate checks.
2. The gate check runs. `ultrabrain`, `deep-low`, `deep-high`, and `architect` need their gate model. Other builtins need at least one live candidate.
3. A candidate counts as live only when one of the providers it lists serves that model id in the live registry. A gateway that re-publishes the model under another provider id does not count (`packages/senpi-task/src/category/builtins.ts:65-96`).
4. The first live candidate wins. Reasoning and variant are normalized to what the model supports.
5. A chain with no live candidate fails early with `model_unavailable`, the attempted chain, and the missing providers (`resolver.ts`, dead-chain short-circuit).

The task tool description is built before the model registry is known. It lists gated categories with a "(requires model)" note. The spawn-time resolver is the real gate (`packages/senpi-task/AGENTS.md`, "Category activation gating").

The doc also advises where to spend a scarce premium model. Put it on low-frequency roles like the plan consultant, not on high-volume roles like explore (`docs/guide/agent-model-matching.md:119-131`).

## 4. The delegation tool (question 3)

### 4.1 Native `task` tool inputs

From `packages/senpi-task/src/tools/task/params.ts`:

| Field | Meaning |
|---|---|
| `prompt` | Instruction for the child. Must be English. Exclusive with `tasks` |
| `task_summary` | One line for the status UI, 80 characters max |
| `description` | Short human label |
| `category` | Route to a category worker. Exclusive with `subagent_type` |
| `subagent_type` | Name of an agent. A category name here fails with `unknown_target` |
| `model` | Explicit model. Valid only with `subagent_type`. Rejected with `category` |
| `load_skills` | Skill names whose `SKILL.md` content is prepended to the child prompt |
| `run_in_background` | `true` returns the task id at once and delivers the result later. `false` blocks the turn |
| `isolated`, `apply`, `merge` | Run the child in a copy-on-write clone and merge back as a patch or a branch |
| `name` | Stable name, unique per session |
| `tools` | JS tools defined in an eval cell, granted to in-process children only |
| `tasks` | Batch of up to 16 items. Items inherit top-level fields. `run_in_background` must agree across the batch |

Validation hard-fails with a named fix. It never silently ignores a field (`packages/senpi-task/src/tools/task/AGENTS.md`, Conventions).

Three companion tools handle the rest (`packages/senpi-task/AGENTS.md`, "Task tools"):

- `task_send` steers a running child, revives a resident child, or messages a team member. This is session continuation.
- `task_cancel` stops a child.
- `task_output` reads a child's output or a tail of its transcript.

The OpenCode edition uses a different shape for continuation. A call passes `task_id` set to a session id such as `ses_abc123` to continue that child session (`packages/omo-opencode/src/agents/sisyphus-dynamic-prompt-execution.ts:61-64`, `packages/omo-opencode/src/tools/delegate-task/types.ts:60-66`).

### 4.2 What the prompt builder adds

- Skills. Each loaded `SKILL.md` is wrapped in a named `skill` block and placed before the prompt (`packages/senpi-task/src/tools/task/skills.ts:17-24`, `execute-spec.ts:28-34`).
- Category context. The category's prompt append, chosen per model family (section 3.3).
- Agent persona. For a named agent, its instructions and tool allowlist (`packages/senpi-task/AGENTS.md`, `resolveAgent`).
- Plan agents in the OpenCode edition get extra lines: answer in English, plan for ultrawork execution, include an atomic commit strategy, and use TDD by default (`packages/omo-opencode/src/tools/delegate-task/prompt-builder.ts:7-23,95-102`).
- Free or local models get a 24,000-token cap on injected system content (`prompt-builder.ts:6,40-51,80-81`).

The orchestrator itself is told to write each child prompt as an executable assignment, not a context handoff. It starts with `TASK:` and names `DELIVERABLE`, `SCOPE`, `VERIFY`, and `STOP WHEN`. For long work it asks for `WORKING:` progress lines and `BLOCKED:` only when stuck (ultrawork directive, section "Child execution and transitions", in `packages/omo-senpi/src/components/ultrawork/generated-directive.ts`).

### 4.3 Concurrency and depth

Defaults from `packages/omo-config-core/src/schema/task.ts:89-95`:

- `default_concurrency` 5 per lane. `global_concurrency` 8.
- `provider_concurrency` and `model_concurrency` override per provider or model.
- A lane key is the model, unless a provider or model limit names it. A limit of 0 means unlimited (`packages/senpi-task/src/manager/concurrency.ts:52-67`).
- `max_depth` 1. A child at a deeper level is refused with a message telling the agent to do the work itself (`packages/senpi-task/src/manager/depth-policy.ts`).
- `residency_max_children` is unlimited by default. `resident_idle_timeout_ms` is 15 minutes. `ttl_ms` is 24 hours.
- Team limits: 8 members, 4 in parallel, 120 minutes (`task.ts:23-25`).
- DAG limits: 64 nodes per run, 16 runs per session (`task.ts:58-59`).

The OpenCode edition has its own background manager. It keeps a FIFO queue per concurrency key with a default of 5, and polls every 3 seconds (`packages/omo-opencode/src/features/background-agent/AGENTS.md`).

### 4.4 Background management and result return

- A task record has seven states: pending, running, completed, error, cancelled, interrupted, and lost. Records are JSONL under the agent directory (`packages/senpi-task/AGENTS.md`, ANATOMY).
- Children run in-process by default, or as separate engine processes or daemon sessions (`packages/senpi-task/AGENTS.md`, EXECUTION MODES).
- On session shutdown, children are suspended, not killed. On resume, they are revived from a persisted spawn spec. A child interrupted mid-turn gets one continuation nudge (`packages/senpi-task/AGENTS.md`, "SESSION SUSPEND AND RESUME REVIVAL").
- Result return is a push. When a background child finishes, the parent is woken if idle, or the result is steered into its running turn at the next tool boundary. During compaction or a session switch the result is buffered. All results ready in one window are batched into one injection. Delivery is exactly once per task and run epoch, and a failed delivery is retried at the next session start (`packages/senpi-task/AGENTS.md`, "Completion routing table").
- The orchestrator is told never to poll or sleep. It ends its turn and lets the completion wake it (`packages/shared-skills/skills/ulw-execute/SKILL.md`, "Monitor every dispatched subagent").

## 5. Ultrawork (question 4)

### 5.1 Keyword trigger

- The Native input hook matches the whole words `ulw` or `ultrawork`, case-insensitive, after quoted and code regions are blanked. Text from extensions never arms it. Text that already holds the directive block does not re-arm it (`packages/omo-senpi/src/components/ultrawork/index.ts:5-9,140-200`).
- The first match injects the full directive, about 30,800 characters (measured with `node` on `generated-directive.ts`). Later matches in the same session inject a short reminder instead. After compaction the full directive is armed again (`index.ts:15-21,120-136`).
- Other keywords inject pointers to skills: `ulw plan`, `ulw loop`, `ulw research`, and `mass ulw` with the aliases `mulw`, `ulw mass`, and `meth` (`docs/guide/keywords.md`, `packages/omo-senpi/src/components/skill-pointers/index.ts`).
- The Codex edition cannot inject 30 KB, because the Codex App truncates large hook output. Its `UserPromptSubmit` hook injects a pointer under 4,096 bytes. The pointer says to print the mode banner, call `create_goal` with the request as the objective, and read the full directive from the bundled `ultrawork` skill file before any other step. If the skill file is missing it falls back to the full text (`packages/omo-codex/plugin/components/ultrawork/src/skill-pointer.ts`).

### 5.2 What the directive tells the agent

A summary in my own words of the Native directive (`generated-directive.ts`) and the Codex variant (`packages/prompts-core/prompts/ultrawork/codex.md`):

1. **Banner.** The first visible line is a fixed "mode enabled" banner.
2. **Tier triage.** Classify the change once as LIGHT or HEAVY. HEAVY is required by a concrete fact, such as a new module, auth or security code, an external integration, a schema migration, concurrency, a cross-domain refactor, or the user asking for care. When unsure, take HEAVY. The tier can only go up.
3. **Bootstrap, four steps before any work.**
   - Survey the loaded skills and name the ones to use. Run one parallel discovery wave. Record the ideal end state. Spawn a planning child only when open design decisions remain.
   - Register a goal with `create_goal`. The objective lists every deliverable. Success criteria are sized by tier (1-2 for LIGHT, 3 or more for HEAVY). Each criterion names a literal command or page action, a binary pass or fail signal, and an evidence artifact. One line states when to stop.
   - Open an append-only notepad file in a temp dir with sections for plan, criteria, now, todo, findings, and learnings. After compaction, re-read the whole notepad before acting.
   - Write the plan to `.omo/plans/<slug>.md` or the notepad, then mirror every atomic step into the todo tool. Each step names the file, the criterion it serves, the action, and the check.
4. **Manual-QA channels.** HTTP with `curl -i`, a real terminal, a real browser, or OS-level computer use. Every scenario names the exact invocation and the observable that decides pass or fail. A dry run or "looks correct" is not evidence.
5. **Delegation.** Use the task tool with a category or a named agent. Run independent work in parallel batches. Use a team only for overlapping lanes.
6. **Waiting.** Never sleep or poll. Subscribe to the condition, or end the turn and let the completion wake the session.
7. **Verification gate.** In the Native edition, the reviewer loop runs only when `ulw-plan` wrote a plan file for this work and the tier is HEAVY or the user demanded strict review. Otherwise the agent writes a self-review in the notepad. A reviewer concern blocks only if it names a success criterion the evidence fails. At most two re-reviews follow, then the agent asks the user. In the Codex variant, the gate runs only on an explicit user demand for strict review (`codex.md:381-411`).
8. **Commits.** One atomic commit per verified increment. Copy the repository's existing message style.
9. **Constraints.** No suppressed lint or test failures. No skipped tests. No done claim from inference.
10. **Stop rules.** Stop when every scenario passes with evidence, cleanup is recorded, the notepad is current, and the user's problem is solved in observable behavior. Leftover QA processes or ports mean not done. After two identical failures, ask the user. After two exploration waves with no new facts, act.

### 5.3 mass ulw and its DAG

- `mass ulw` runs dependency-ordered child work through a `workflow` tool or a JS SDK from an eval cell (`packages/omo-senpi/skills/mass-ulw/SKILL.md`).
- A run has a stable `key` for idempotency, a `name`, and `nodes`. Each node has an `id`, a self-contained prompt, a `category`, and optional `dependsOn`. `dependsOn` orders nodes only. No upstream output is passed into a downstream prompt. Data flows through files.
- One run covers one phase. The next phase is a new run, or an `amend` when only the definition changed.
- The scheduler starts a node once all its dependencies completed and a slot is free. It journals state to a write-ahead log with checkpoints (`packages/senpi-task/AGENTS.md`, DAG row).
- Recovery verbs act on one node. `retry` gives failed or cancelled nodes a new attempt. `send` steers or revives one node's child. `amend` diffs node fingerprints and re-runs only changed nodes and their dependents.
- A run survives a session restart. Starting the same key and definition returns the existing run.
- Each wake carries a "treat completion claims as false until verified" instruction. The orchestrator checks each running node against its own scope on every wake.
- The skill requires reading `references/planning.md` in full before any graph is defined, and requires a final verification node for any graph that changes code (`packages/omo-senpi/skills/AGENTS.md`, ANTI-PATTERNS).

### 5.4 /ulw-plan, /ulw-execute, /ulw-loop

- `/ulw-plan` (skill `ulw-plan`). Section 6.
- `/ulw-execute` (skill `ulw-execute`). Executes a plan with Boulder state. Section 6.4.
- `/ulw-loop` (skill `ulw-loop`). A goal loop with SDK-owned state under `.omo/ulw-loop/<session-id>/`. The agent creates goals from a brief, registers the aggregate objective with `create_goal`, mirrors steps into the todo list, treats each goal as a phase with its own worktree, records evidence per criterion, and checkpoints each goal as complete, failed, or blocked (`packages/omo-senpi/skills/ulw-loop/SKILL.md`, "Run contract" and SDK table). Evidence is bound to the git tree hash at capture. A tree change makes it stale.

The SDK methods are `status`, `createGoals`, `completeGoals`, `criteria`, `recordEvidence`, `checkpoint`, `steer`, `addGoal`, and `recordReviewBlockers`. Every call returns an envelope with `ok`, `result`, `nextActions`, and optional `warnings`. It never throws (`packages/omo-senpi/skills/ulw-loop/SKILL.md`, SDK section). In Codex the same operations run as a CLI, `omo-agent-toolkit ulw-loop <subcommand>` (`packages/omo-codex/plugin/components/ulw-loop/AGENTS.md`, Branding).

### 5.5 Boulder state

`.omo/boulder.json`, schema version 2, at the worktree root (`packages/boulder-state/AGENTS.md`, `packages/boulder-state/src/types.ts`):

| Field | Meaning |
|---|---|
| `schema_version` | `2` |
| `active_work_id` | Id of the current work |
| `works` | Map from work id to a work record |
| `works.<id>.work_id`, `active_plan`, `plan_name` | Which plan file this work runs |
| `works.<id>.status` | `active`, `paused`, `completed`, or `abandoned` |
| `works.<id>.started_at`, `ended_at`, `elapsed_ms`, `updated_at` | Timing |
| `works.<id>.stale_since` | Set when a stale-work check demoted it to paused |
| `works.<id>.session_ids`, `session_origins` | Sessions that own the work, prefixed `opencode:`, `codex:`, or `senpi:` |
| `works.<id>.agent`, `worktree_path` | Executor agent and worktree |
| `works.<id>.task_sessions` | Map of task key to `{task_label, task_title, session_id, agent, category, status, timing}` |
| Root `active_plan`, `plan_name`, `status`, `session_ids`, ... | A mirror of the active work, kept for older readers |

Other rules:

- A work with no activity for 6 hours is demoted from `active` to `paused` (`OMO_BOULDER_STALE_WORK_THRESHOLD_MS`).
- The first write creates `.omo/.gitignore` that ignores everything except `rules/`.
- Plan progress is parsed from the plan file. In structured mode it counts column-zero rows `N.` under `## TODOs` and `F<n>.` under `## Final Verification Wave`. `[x]` is done, `[ ]` is open, and `[~]` (blocked) counts toward the total only.

### 5.6 Goal tools

- OpenCode edition. `create_goal`, `update_goal`, and `get_goal` are plugin tools. A goal has `objective` (max 2,000 characters), `status` (`active`, `paused`, or `complete`), `tokensUsed`, `timeUsedSeconds`, and timestamps. It is stored in `.omo/goal/<session>.json`. While active, each `session.idle` injects a continuation prompt that wraps the objective as untrusted text and forbids marking it complete without a completion audit. It replaced the older "ralph loop" (`packages/omo-opencode/src/hooks/goal/AGENTS.md`, `packages/omo-opencode/src/hooks/goal/types.ts`).
- Native edition. The directive calls `create_goal` and `update_goal`. The ulw-loop footer refreshes after those tools run (`packages/omo-senpi/src/components/ulw-loop/index.ts:283-291`). No definition of these tools was found in `packages/omo-senpi`, so they are probably engine builtins in senpi (inferred). Searches: `rg -l create_goal packages --type ts`.
- Codex edition. `create_goal` is Codex's own tool. The installer enables the Codex `goals` feature (`packages/omo-codex/src/install/codex-config-permissions.ts:4`). A `PreToolUse` hook on `create_goal` denies a call that sets a token budget, so goals stay unlimited (`packages/omo-codex/plugin/components/ulw-loop/src/codex-hook.ts:37-45,114-115`).

### 5.7 Continuation hooks

| Edition | Trigger | Condition | Caps and stops |
|---|---|---|---|
| OpenCode todo-continuation-enforcer | `session.idle` | Main session, todos incomplete, no running background tasks | Skips plan agents. 3 s abort window. 5 s cooldown with exponential backoff. 5 failures then a 5-minute pause. 2 s countdown toast. Stops when the agent answers without todo progress, or when the user types (`packages/omo-opencode/src/hooks/todo-continuation-enforcer/AGENTS.md`) |
| OpenCode goal hook | `session.idle` | Goal `active` | Re-entry guard. Iteration default 100 (`packages/omo-opencode/src/hooks/goal/AGENTS.md`) |
| Native ulw-loop | Records on `agent_end`, decides on `agent_settled` | A session-scoped loop plan has an incomplete goal | 8 consecutive continuations. Skips when the status is unchanged from last time, when Boulder continuation will fire, on abort, retry, refusal, or an unfinished turn, and when the session id is unknown (`packages/omo-senpi/src/components/ulw-loop/index.ts:11,86-155`) |
| Native ulw-execute-continuation | Same events | A Boulder work for this session has unchecked boxes | 8 consecutive continuations. Signature of work id, update time, and checked count must change (`packages/omo-senpi/src/components/ulw-execute-continuation/index.ts:11,100-125`) |
| Codex ulw-execute-continuation | Codex `Stop` | Boulder lists `codex:<session_id>` and the plan has a readable checklist | Outputs `{"decision":"block","reason": <filled directive>}`. Silent on context-pressure markers in the transcript. The agent can end the turn with a `<ulw-execute-blocked-external>` marker (`packages/omo-codex/plugin/components/ulw-execute-continuation/AGENTS.md`) |
| Codex ulw-loop | Codex `Stop` | A resumable goal exists | 2 resumes per goal without new ledger lines, then writes a `.stuck` file. Skips when `stop_hook_active`, on context pressure, or when Boulder continuation will fire (`packages/omo-codex/plugin/components/ulw-loop/src/stop-resume-hook.ts:14-52,87-103`) |

User input resets the counters in the Native components (`ulw-loop/index.ts:66-72`).

### 5.8 Stop conditions, consolidated

- The goal's "when to stop" line holds with evidence (directive, Stop rules).
- All plan checkboxes are `[x]` and the final verification wave passed (`packages/shared-skills/skills/ulw-execute/SKILL.md`, Completion).
- The loop plan's aggregate completion is `complete` (`ulw-loop/index.ts:268-275`).
- A hook cap or stale signature triggers.
- The turn was aborted, refused, or hit context pressure.
- The agent asks the user after two identical failed attempts.

## 6. Planning workflow (question 5)

### 6.1 Steps and owners

| Step | Who | Evidence |
|---|---|---|
| Opening banner and a stated contract that no implementation will happen | Main session running the `ulw-plan` skill | `packages/omo-senpi/skills/ulw-plan/SKILL.md`, "MANDATORY OPENING ANNOUNCEMENT" |
| Parallel read-only exploration | `explore` and `librarian` children. In the Native edition, also background advisory lanes on `architect` and `ultrabrain` when those categories exist | Same file, "Senpi Design Consultation Lanes" and "Delegation" |
| Name the affected user, the ideal state rows (IS-n), and the gap rows (GAP-n) | Main session | Same file, "Universal invariants" |
| Intent verdict, CLEAR or UNCLEAR, plus `review_required`, announced in one line | Main session | Same file, "INTENT ROUTING" |
| Interview. CLEAR asks only owner-decision forks. UNCLEAR adopts announced defaults and asks nothing. An explicit "ask me" forces CLEAR | Main session | Same file |
| Draft at `.omo/drafts/<slug>.md`, created by `scripts/scaffold-plan.mjs --draft-only` | Main session | Same file, "RUN THE SCRIPT" |
| Approval gate. Brief once, record `status: awaiting-approval`, wait for an explicit okay. Approval authorizes the plan file only, never implementation | Main session | `references/full-workflow.md:150-162` |
| Create the plan skeleton at `.omo/plans/<slug>.md` | Script | `full-workflow.md:164-165` |
| Gap analysis, mandatory | `plan-consultant` (Metis) | `full-workflow.md:166` |
| Append todo batches and fill the TL;DR last | Main session | `full-workflow.md:167-169` |
| High-accuracy review, default on. Up to 5 rounds, each a fresh `plan-reviewer` (Momus) session | `plan-reviewer` | `full-workflow.md:210-264` |
| Handoff summary, then stop. Execution starts only when the user runs `/ulw-execute` | Main session | `full-workflow.md:194-208` |

### 6.2 Review round rules

- The parent records a round id, the plan's SHA-256, and the child session id in the draft before launch. On completion it re-hashes the plan. A mismatch makes the round inconclusive (`full-workflow.md:213`).
- Only six kinds of findings can block, such as an explicit requirement, an existing regression, a concrete security or data-loss risk, or an ideal-state row no todo reaches. Everything else becomes a non-blocking note (`full-workflow.md:239-262`).
- The blocker ledger freezes after round 1. Later rounds check the accepted blockers, regressions from fixes, and new findings that pass the eligibility test.
- Approval with only notes counts as approval. At the cap, stop and ask the user.

### 6.3 Plan file format

Headers emitted by the script, in order (`full-workflow.md:171-184`, `packages/omo-senpi/skills/ulw-plan/scripts/plan-templates.mjs`):

1. `# <slug> - Work Plan`
2. `## TL;DR (For humans)` with deliverable, reason, exclusions, effort band (Quick, Short, Medium, Large, XL, never hours), risk, and decisions
3. `## Scope`, opening with "Affected user and ideal state", then Must have and Must NOT have
4. `## Verification strategy`
5. `## Execution strategy`
6. `## Todos`
7. `## Final verification wave`
8. `## Commit strategy`
9. `## Success criteria`, a table mapping each IS row to its todos, QA scenario, and evidence path

Task row grammar: implementation rows are column-zero `- [ ] N. <title>`. Final-verifier rows are `- [ ] F<n>. <title>`. Each todo carries references, agent-executable acceptance criteria, happy and failure QA scenarios with evidence paths, a commit line, and a `Recommended task executor category:` line (`full-workflow.md:184-190`). The target is 5 to 8 todos per wave. The final wave has four checks: plan compliance, code quality, real manual QA, and ideal-state fidelity (`full-workflow.md:191-192`).

Locations: drafts in `.omo/drafts/`, plans in `.omo/plans/` (`packages/omo-senpi/skills/AGENTS.md`, CONVENTIONS).

### 6.4 Execution (ulw-execute)

From `packages/shared-skills/skills/ulw-execute/SKILL.md`:

1. The orchestrator never edits product files, writes tests, or runs QA itself. Every unit goes to a spawned worker.
2. Register one detailed goal. Mirror every phase and checkbox into todos up front.
3. Select the plan from Boulder state or `.omo/plans/`. With no plan, bootstrap `ulw-plan` first.
4. Write Boulder state with a prefixed session id.
5. Each wave runs in its own task-owned git worktree.
6. Pick a lane topology. Independent lanes become parallel workers. Ordered lanes become one DAG run. Overlapping lanes become a team. PR-mode lanes get one worktree each.
7. For the next unchecked box, classify the tier, split it into one-worker units, and dispatch all independent units in one burst. Route each by the plan's recommended category. Splittable work goes to a swarm of `quick` workers. Cohesive hard work goes whole to `deep-low`, `deep-high`, or `ultrabrain`.
8. Each worker brief names the goal and files, the existing tests to read first, constraints, verification commands, one exact manual-QA invocation, the applicable adversarial classes (from a list of nine trigger-mapped classes), the artifact path, and the cleanup receipt.
9. Verify each box with five gates: re-read the plan, automated checks, manual QA artifact, adversarial QA, and cleanup. Append to `.omo/ulw-execute/ledger.jsonl`.
10. A worker's `DoneClaim` is checked by an independent `AdversarialVerify` step. Only the verdict `confirmed` passes.
11. Tick the box, confirm the count dropped, and continue without asking.
12. At the end, run final checks, finish the PR lifecycle if `--make-pr` or `--ship` was set, mark the Boulder work completed, and print a completion block.

## 7. Review and QA discipline (question 6)

- **Oracle reviews (OpenCode).** Oracle is the read-only self-review agent after significant work and after two failed fixes (`packages/omo-opencode/src/agents/oracle.ts:8-38`).
- **review-work skill.** Run manual QA on the real surface, then launch exactly one gate reviewer, never a panel (`packages/shared-skills/skills/review-work/SKILL.md`, description).
- **ulw-loop final gate (Native).** Three reviewer agents: code reviewer, QA executor, and gate reviewer. Each writes an artifact-backed report (section 2.2).
- **visual-qa skill.** Visual QA for web, terminal, and paginated output with screenshot evidence and a verdict (`packages/shared-skills/skills/visual-qa/SKILL.md`, description).
- **Comment checker.** After edit tools run, an external `comment-checker` binary scans changed code for AI-style comments. Exit 0 is clean, exit 2 means comments found. A failure to run never blocks (`packages/comment-checker-core/AGENTS.md`). The Codex edition runs it on `PostToolUse` for `apply_patch`, `write`, and `edit` tools (`packages/omo-codex/plugin/hooks/post-tool-use-checking-comments.json`).
- **Todo enforcement.** The OpenCode continuation enforcer (section 5.7). The directive requires every step to be a registered todo, marked the moment it changes (directive, Bootstrap step 3).
- **Executor evidence gate (Codex).** A `SubagentStop` hook on `lazycodex-worker-(low|medium|high)` blocks the stop unless the last message ends with `EVIDENCE_RECORDED: <path>`. The path must be a regular file inside `<cwd>/.omo/evidence/`, at least 40 characters long, and newer than the transcript start. After 3 blocked attempts it lets the stop pass (`packages/omo-codex/plugin/components/lazycodex-executor-verify/AGENTS.md`).
- **Spawn guards (Codex).** A `PreToolUse` hook on `spawn_agent` enforces a per-session fan-out cap of 24 (env `OMO_SPAWN_FANOUT_LIMIT`), a reviewer cap of 3, a role allowlist, and a rule that the gate reviewer cannot spawn before the manual QA artifact exists. If Codex reports an agent limit, a breaker file stops all later spawns in that session (`packages/omo-codex/plugin/components/ulw-loop/src/spawn-guard.ts:32-35,49-93,96-125,153-161`).
- **QA evidence protocol (repo contributors).** The root `AGENTS.md` requires driving the real harness in an isolated sandbox for every change. Evidence goes to `.omo/evidence/<YYYYMMDD>-<slug>/`, which is gitignored and never committed. A test fails the build if an evidence path is tracked. The PR body carries four items: what was tested, what was observed, why it is enough, and what was omitted (`AGENTS.md:7-44`). This is contributor policy, but the same evidence directory and four-part shape appear in the product workflows (inferred from the shared `.omo/evidence/` path in the Codex executor gate).

**How OmO decides that work is done.** All of these must hold:

1. Every success criterion on the goal has captured evidence from a real surface.
2. Every plan checkbox is ticked, and each tick followed an independent `confirmed` verdict.
3. The final verification wave approved.
4. QA resources are torn down with receipts.
5. If the reviewer gate triggered, the reviewer approved, possibly with notes only.

The decisive test, stated above the checklist, is whether the user's problem is solved in observable behavior (directive, Stop rules).

## 8. Codex Light edition (question 7)

### 8.1 Packaging

- Codex sees marketplace `sisyphuslabs` and plugin `omo`, enabled as `omo@sisyphuslabs`. The npm package is `lazycodex-ai`. `lazycodex` is the repo and bin name (root `AGENTS.md`, "CODEX LIGHT EDITION").
- The plugin manifest declares `skills: ./skills/`, a `hooks` array of 21 JSON files, and `mcpServers: ./.mcp.json`. Each hook command shows a status line prefixed with the version, for example `(OmO 5.1.13) Checking Ultrawork Trigger` (`packages/omo-codex/plugin/.codex-plugin/plugin.json`, `packages/omo-codex/plugin/hooks/*.json`).
- Each component is a Node package with its own `dist/cli.js`. Hooks call `node "${PLUGIN_ROOT}/components/<name>/dist/cli.js" hook <event>`. Windows calls a PowerShell dispatcher (`plugin/hooks/*.json`).
- Hooks never block a turn on bad input and make no network calls (`packages/omo-codex/plugin/components/ultrawork/AGENTS.md`, Constraints).
- Directive text lives in Markdown files read at runtime or generated into TS. One canonical prompt in `packages/prompts-core/prompts/ultrawork/codex.md` feeds both the hook and the skill (`ultrawork/AGENTS.md`, Layout).

### 8.2 Hooks by event

| Event | Matcher | Component | Effect |
|---|---|---|---|
| SessionStart | any | rules | Inject static project rules |
| SessionStart | any | telemetry | Daily-active event |
| SessionStart | `^startup$` | auto-update script | Migrate `config.toml`, check updates, print restart notices as `additionalContext` (`packages/omo-codex/AGENTS.md`, CONFIG MIGRATION) |
| SessionStart | any | bootstrap | Once per version, re-run installer steps in a detached worker and provision a pinned ast-grep binary. Never exits non-zero. Records a degraded ledger and points at doctor (`components/bootstrap/AGENTS.md`) |
| UserPromptSubmit | any | rules | Inject prompt-matched rules |
| UserPromptSubmit | any | ultrawork | Keyword match, then the under-4 KB pointer (section 5.1) |
| UserPromptSubmit | any | ulw-loop | Steering reminder while a loop is active |
| PreToolUse | `^Bash$` | git-bash | Recommend the Git Bash MCP on Windows |
| PreToolUse | `^create_goal$` | ulw-loop | Deny budgeted goals |
| PreToolUse | `spawn_agent` variants | ulw-loop | Spawn guards (section 7) |
| PostToolUse | edit tools | comment-checker | Comment scan |
| PostToolUse | edit tools | lsp | Diagnostics after edits |
| PostToolUse | `^apply_patch$` | rules | Inject rules matching the edited paths |
| PostToolUse | `create_thread` variants | teammode | Remind the agent to set the new thread's title |
| PostToolUse | `spawn_agent` variants | ulw-loop | Record agent-limit failures as a breaker |
| PostCompact | `manual|auto` | git-bash, rules, lsp | Reset per-session caches |
| Stop | any | ulw-execute-continuation | Block stop while Boulder work remains |
| Stop | any | ulw-loop | Block stop while loop goals remain, capped |
| SubagentStop | `^lazycodex-worker-(low|medium|high)$` | lazycodex-executor-verify | Block until an evidence receipt exists |

Hook output contracts used:

- `UserPromptSubmit` and `SessionStart` add context.
- `PreToolUse` returns `permissionDecision: "deny"` with a reason (`ulw-loop/src/codex-hook.ts:37-38`).
- `Stop` and `SubagentStop` return `{"decision":"block","reason":...}`. Empty stdout means pass (`lazycodex-executor-verify/AGENTS.md`, NOTES).

### 8.3 Skills shipped

The build composes `plugin/skills/` (`packages/omo-codex/AGENTS.md`, sync-skills pipeline; `plugin/scripts/sync-skills.mjs`):

- Component skills: `comment-checker`, `lcx-report-bug`, `lcx-contribute-bug-fix`, `lcx-doctor`, `lsp`, `rules`, `teammode`, `ulw-loop`, `ulw-plan`, and `ultrawork`. The `ultrawork` skill body is the canonical Codex directive.
- All shared skills from `packages/shared-skills/skills` (section 12).
- Each skill gets a "Codex Harness Tool Compatibility" section that maps OpenCode tool names to Codex tools. For example, `task(...)` maps to `spawn_agent` with `fork_context: false` and an `agent_type`, and `load_skills` maps to naming the skills inside the message (`packages/shared-skills/skills/ulw-execute/SKILL.md:11-32` shows the generated section).
- Overlays rewrite parts of `ulw-execute`, `review-work`, and `ulw-research` for Codex (`sync-skills.mjs:132-230`).
- Display names get an `(OmO) ` prefix through `agents/openai.yaml`.

### 8.4 MCP servers

`.mcp.json` declares `grep_app` and `context7` as remote servers, and `git_bash` and `lsp` as local stdio servers. `git_bash` is disabled off Windows (`packages/omo-codex/plugin/.mcp.json`, `packages/omo-codex/AGENTS.md`, INSTALL).

### 8.5 Installer steps

Entry: `bunx lazycodex-ai install`, or `bunx oh-my-openagent install --platform=codex` (`docs/reference/cli.md:58-90`). The source is `packages/omo-codex/src/install/install-codex.ts:26-210`:

1. Resolve `CODEX_HOME` (default `~/.codex`), the project dir, and the bin dir.
2. On Windows, require Git Bash or stop with install guidance.
3. Read `marketplace.json`. Check that each plugin manifest name matches.
4. Build or copy the plugin into `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`. Stamp the version. Record the bin dir in `.installed-bin-dir.json` so a later uninstall can find it.
5. Link component CLIs and the root `omo` runtime wrapper into the bin dir.
6. Install a pinned ast-grep binary.
7. Copy the 12 agent TOMLs into `~/.codex/agents/`.
8. Compute a trusted hash for every hook command.
9. Prune old caches and legacy marketplaces. Reap old LSP daemons.
10. Write a cached marketplace manifest.
11. Edit `~/.codex/config.toml` (section 8.6).
12. Repair project-local legacy Codex artifacts with backups.
13. Send install telemetry.

### 8.6 Config written to `~/.codex/config.toml`

From `packages/omo-codex/src/install/codex-config-toml.ts:22-90` and `codex-config-permissions.ts`:

- Enable features `plugins`, `plugin_hooks`, and `multi_agent`. Remove `child_agents_md`.
- Write the managed model and reasoning defaults from `plugin/model-catalog.json`. Root model `gpt-6-astra`, 600k context, effort high, plan-mode effort xhigh (`packages/omo-codex/AGENTS.md`, DEFAULT MODEL CATALOG). A user model that matches no managed profile is kept.
- Handle multi-agent V2 per model. The installer never enables V2 and never writes a thread cap. It removes thread-cap values that older installers wrote.
- Autonomous permissions are on by default (`--no-codex-autonomous` opts out). They set `approval_policy = "never"`, `sandbox_mode = "danger-full-access"`, enable `multi_agent`, `unified_exec`, and `goals`, and hide the full-access warnings (`codex-config-permissions.ts:4-15`, `docs/reference/cli.md:84-85`).
- Add the marketplace block and enable `omo@sisyphuslabs`.
- Add MCP policies and the trusted hook hashes, so the user does not have to approve each hook (inferred from `ensureHookTrusted` and `codex-hook-trust.ts`).
- Add an agent block per role file.

The OmO unified config is read separately as the `[codex]` view of `~/.omo/omo.jsonc` (`packages/omo-codex/AGENTS.md`, UNIFIED CONFIG).

### 8.7 Features that survive in Light, and how

| Feature | Survives? | Mechanism |
|---|---|---|
| Ultrawork keyword | Yes | `UserPromptSubmit` pointer plus the `ultrawork` skill |
| Goals | Yes | Codex native `create_goal`, with a hook that denies budgets |
| ulw-plan | Yes | Skill. Metis and Momus run as Codex agent roles |
| ulw-execute and Boulder | Yes | Skill plus the `Stop` continuation hook. Session ids prefixed `codex:` |
| ulw-loop | Yes | CLI `omo-agent-toolkit ulw-loop` plus the `Stop` resume hook and spawn guards |
| Categories | Partly | No category resolver. Difficulty maps to `lazycodex-worker-low/medium/high`, all on one model (`packages/shared-skills/skills/ulw-execute/SKILL.md:26-28`) |
| Named read-only agents | Yes | Agent TOMLs |
| Background tasks and completion push | No custom tool | Uses Codex `spawn_agent` and `wait_agent` with doubling timeouts (`codex.md:316-380`) |
| Teams | Yes, script-driven | `teammode` skill with a zero-dependency `team.mjs` controller. Transport is either native V2 agents or Codex app threads, each with its own worktree (`components/teammode/AGENTS.md`) |
| mass ulw DAG | Not found | No `workflow` tool or DAG runner in `packages/omo-codex`. Searches: `rg -l "workflow" packages/omo-codex/plugin/components --type ts`, `rg -l "dependsOn" packages/omo-codex`. The `ulw-execute` skill says the DAG path applies only "with a native workflow tool" |
| Comment checker, LSP, rules | Yes | Hooks plus MCP |
| Evidence gate | Yes | `SubagentStop` hook |
| Memory, computer use, thread gateway | Not found in `packages/omo-codex` | Searches: `rg -il "memory|computer" packages/omo-codex/plugin/components -g '*.ts' -l` returned no component of that name |
| Doctor | Yes, as a skill | `lcx-doctor` skill plus `doctor --platform codex` (`docs/reference/cli.md:136-155`) |
| Auto-update | Yes | SessionStart script. Marketplace installs point users to `codex plugin marketplace upgrade sisyphuslabs` |

## 9. Claude Code compatibility layer (question 8)

`packages/claude-code-compat-core` is consumed by the OpenCode edition (`packages/claude-code-compat-core/AGENTS.md`). It loads:

| Loader | Sources |
|---|---|
| Plugins (commands, skills as commands, agents, MCP servers, hooks) | `~/.claude/plugins/installed_plugins.json` (or `CLAUDE_PLUGINS_HOME`), enabled state from `~/.claude/settings.json` (or `CLAUDE_SETTINGS_PATH`) (`src/features/claude-code-plugin-loader/discovery-paths.ts`) |
| MCP config | `~/.claude.json` (user), `~/.claude/.mcp.json` (user), `<cwd>/.mcp.json` (project), `<cwd>/.claude/.mcp.json` (local). `${VAR}` expands only for names in `mcp_env_allowlist`, which is user-layer only (`src/features/claude-code-mcp-loader/loader.ts:53-56`) |
| Commands | `~/.claude/commands`, `<cwd>/.claude/commands`, plus OpenCode command dirs (`src/features/claude-code-command-loader/loader.ts:158-181`) |
| Agents | `~/.claude/agents`, `<cwd>/.claude/agents`, plus OpenCode agent dirs (`src/features/claude-code-agent-loader/loader.ts:32-73`) |

Related pieces outside the package:

- Skills from `.claude/skills` and `.agents/skills` are discovered by `packages/skills-loader-core/src/shared/project-discovery-dirs.ts:113-121`.
- Claude Code `settings.json` hooks run in the OpenCode edition through `packages/omo-opencode/src/hooks/claude-code-hooks`. Sources are `~/.claude/settings.json`, `.claude/settings.json`, and `.claude/settings.local.json` (`config.ts:76-78`). PreToolUse maps to `tool.execute.before`, PostToolUse to `tool.execute.after`, and Stop and Notification to `session.idle` (`claude-code-hooks/AGENTS.md`).
- Nested `AGENTS.md` files are injected by `packages/agents-md-core` (`src/injector.test.ts:38`).

## 10. Installer and doctor UX (question 9)

### 10.1 `omo setup` (Native)

From `docs/guide/migrating-from-opencode.md:59-109` and `packages/omo-native/bin/lib/setup-*.js`:

- **Detection is read-only.** It reads OpenCode `auth.json` and the merged user config. `setup-detect.js` also reads the oh-my-pi and gajae-code stores and builds one inventory per harness (`packages/omo-native/bin/lib/setup-detect.js:13-40,65,161-167`).
- **One summary, one question.** It prints everything it would import, refused items with reasons and fixes, and the OAuth logins the user must redo with `/login <provider>`. Then it asks once for the whole plan. `--yes` answers yes, `--dry-run` writes nothing, and `--ask-each` asks per class. Without a terminal it prints the summary and tells the user to re-run with `--yes`.
- **Writes are safe.** It writes to `~/.omo/agent/` and `~/.omo/omo.jsonc`, makes a timestamped backup of each file, and never overwrites an existing entry. It never writes to OpenCode files.
- **Idempotent.** A second run offers only new items.

### 10.2 OpenCode and Codex installer

`bunx oh-my-openagent install` is an interactive wizard. `--no-tui` makes it non-interactive. `--platform` picks `opencode`, `codex`, or `both`. Subscription flags such as `--claude` and `--openai` configure OpenCode model defaults and are rejected for Codex-only installs (`docs/reference/cli.md:58-90`). Uninstall removes the managed cache, strips managed blocks from `config.toml` after a backup, and removes managed agent TOMLs (`docs/reference/cli.md:113-133`).

### 10.3 Doctor

- **OpenCode doctor groups.** System, Configuration, TUI Plugin, Deprecated Reasoning Keys, Tools, Models, Telemetry, and Team Mode. Flags `--status`, `--verbose`, `--json`, `--platform`. It warns on a legacy plugin registration (`docs/reference/cli.md:136-158`).
- **Native doctor** (`packages/omo-native/bin/lib/doctor.js:357-424`) prints PASS, FAIL, and INFO lines for:
  - required package artifacts
  - the senpi CLI path and an exact pinned version match
  - installed and latest version, and the update command
  - pending config migrations
  - settings warnings
  - config diagnostics (`config-doctor.js`)
  - pi config
  - stale engine processes, with `--reap` to kill them
  - retired payloads and transient memory identities
  - the daemon launch spec and daemon status
  - computer use, category coverage, and gateway health
  - a suggestion to run `omo setup` when no credentials exist

  The exit code is 1 on any FAIL.
- **Codex doctor** is the `lcx-doctor` skill plus `doctor --platform codex`. The bootstrap hook points users to `npx lazycodex-ai doctor` when a step degrades (`components/bootstrap/AGENTS.md`).

## 11. Config (question 10)

### 11.1 Top-level keys of `omo.jsonc`

From `packages/omo-config-core/src/schema/config.ts:66-88`:

- `$schema`
- `categories`, `agents`
- `task` (concurrency, isolation, execution mode, DAG limits; section 4.3)
- `teams`
- `models` (a model catalog), `model_profiles`, `model_profile`
- `memory`, `telemetry`, `computer`, `gateway`
- `git_master`, `formatOnMutation`, `disabled_skills`
- Harness blocks `[opencode]` (free-form), `[native]`, `[senpi]`, `[codex]` (typed)
- `profiles` (named overlays), `_migrations`, `legacy_migrations`

The schema is `.strict()`.

### 11.2 Layering

From the root `AGENTS.md`, "MULTI-LEVEL CONFIG":

1. Project layers from the current directory up to `$HOME` (home skipped), each `.omo/omo.json[c]`. Nearest wins.
2. User layer `~/.omo/omo.json[c]`.
3. Per harness: shared base, then the `[harness]` block, then `profiles.<P>`, then `profiles.<P>.[harness]`.
4. Zod defaults last.

Other rules:

- Objects deep-merge. Scalars and arrays replace.
- `mcp_env_allowlist` is user-layer only.
- `OMO_PROFILE` activates a profile.

### 11.3 Schema publication

`script/build-omo-schema.ts` writes `assets/omo.schema.json` from the Zod schema. CI fails if the committed schema differs from the generated one (`.github/workflows/ci.yml:712-719`). Users add `$schema` pointing at the raw GitHub URL of `assets/omo.schema.json` on the `dev` branch.

### 11.4 Reload safety

- **Config watch (Native).** When a config file changes, the validator reloads the merged config and fingerprints each diagnostic. It rejects the change if a new diagnostic appears that belongs to the changed files. A rejected diagnostic stays rejected until the file no longer produces it, so an unrelated later edit cannot sneak a bad file in (`packages/omo-senpi/src/components/config-watch/validate.ts:74-120`).
- **Reload guard.** `/reload` is vetoed while resident children are running (`packages/omo-senpi/src/components/task/AGENTS.md`, `reload-guard.ts`).
- **Prune.** Invalid leaf values are pruned in a bounded way instead of failing the whole file (`packages/omo-config-core/src/loader/prune-invalid-leaves.ts:4`).
- **Writes.** The writer edits JSONC with `jsonc-parser`, so comments survive. It makes a timestamped backup (`packages/omo-config-core/src/writer/writer.ts:1-30`).
- **Migrations.** Migrations use a lock and a journal, never clobber, record markers in `_migrations`, and back up the sources (root `AGENTS.md`).

## 12. Skills (question 11)

"Orch" marks skills that drive orchestration.

### 12.1 `packages/shared-skills/skills`

| Skill | Purpose (paraphrased from frontmatter) | Orch |
|---|---|---|
| `ast-grep` | Structural code search and rewrite across 25 languages | |
| `browser` | Drive a real browser, signed-in or owned, for forms, scraping, and QA | |
| `coding-agent-sessions` | Find and rebuild past agent sessions from local logs | |
| `data-scientist` | Data analysis with DuckDB and Polars kernels | |
| `debugging` | Hypothesis loop with escalation and a failing-test lock | |
| `frontend` | Build and polish web UI | |
| `git-master` | Atomic commits, rebase, and history work | |
| `init-deep` | Generate hierarchical `AGENTS.md` files | Orch (map-reduce DAG in its Native copy) |
| `lsp-setup` | Configure a language server | |
| `programming` | Strict language practice for Python, Rust, TypeScript, and Go | |
| `refactor` | Guide a refactor with the right decomposition | |
| `remove-ai-slops` | Remove AI code smells behind regression tests | |
| `review-work` | Manual QA, then one gate reviewer | Orch |
| `ultimate-browsing` | Tiered page rendering and WAF bypass for research | |
| `ulw-execute` | Execute a plan with Boulder state, ledger, worktrees, and parallel workers | Orch |
| `ulw-plan` | Explore-first planner that writes one decision-complete plan | Orch |
| `ulw-research` | Team research with claim-graph gating and a cited report | Orch |
| `visual-qa` | Visual QA with screenshot evidence and a verdict | |

### 12.2 `packages/omo-senpi/skills`

| Skill | Purpose | Orch |
|---|---|---|
| `dag-library` | Save a DAG definition and re-run it by name | Orch |
| `give-me-tips` | Explain product tips | |
| `hyperplan` | Adversarial planning. A hostile team cross-critiques a plan | Orch |
| `init-deep` | Native override of the shared skill | Orch |
| `mass-ulw` | Dependency-ordered child work through the workflow tool | Orch |
| `onboarding` | First-run setup guide | |
| `ultrawork` | The binding ultrawork directive. Its body is embedded into the hook | Orch |
| `ulw-loop` | Goal loop with SDK-owned state and evidence | Orch |
| `ulw-plan` | Native copy of the planner | Orch |
| `ulw-research` | Native copy of research | Orch |

### 12.3 Codex component skills

`comment-checker`, `lsp`, `rules`, `teammode` (Orch), `ulw-loop` (Orch), `ulw-plan` (Orch), `ultrawork` (Orch, generated), `lcx-doctor`, `lcx-report-bug`, and `lcx-contribute-bug-fix` (`packages/omo-codex/plugin/components/*/skills`).

## 13. Implications for oh-my-t3code

This section is recommendation, not fact. T3 capabilities are taken from the T3 tool descriptions available to this session. I did not call any T3 tool, so each T3 claim below is from tool documentation and needs a check.

### 13.1 What T3 already provides

| OmO piece | T3 equivalent |
|---|---|
| `task` spawn to any provider and model | `delegate_task` with `providerInstanceId` and `model` |
| `task_output` and status | `task_status` |
| `task_cancel` | `task_cancel` |
| Live model catalog | `orchestrator_capabilities` |
| Task-owned worktree per phase or per team member | `t3_thread_launch` with `workspaceStrategy` `worktree` and `baseRef` |
| Isolation merge-back | `t3_thread_merge_back`, `t3_thread_fork` (inferred from tool names) |
| `--ship` PR watching | `watch_pull_request`, `link_pull_request` |
| Teammode on Codex app threads | Top-level T3 threads plus `t3_thread_send` and `t3_thread_wait` |
| Browser QA channel | `preview_*` tools and `device_*` tools |
| Recurring wake | `schedule_task` |

### 13.2 Ranked features

| Rank | OmO feature | Status in T3 | Recommendation |
|---|---|---|---|
| 1 | Category routing with ranked chains resolved against live providers | Not provided. `delegate_task` needs an exact provider and model | **Re-create.** Ship a category table in config (name, intent, caller guidance, child append, chain of `{provider, model, effort}` candidates). A small CLI command (for example `omt3 resolve <category>`) reads `orchestrator_capabilities` output and returns the first live candidate. A skill tells the agent to resolve, then call `delegate_task`. Keep the gate rule: a category with no live candidate is hidden. Keep the "subscription before API key" provider order |
| 2 | Child prompt contract (TASK, DELIVERABLE, SCOPE, VERIFY, STOP WHEN, WORKING, BLOCKED) and skill injection | Not provided | **Re-create in a skill.** It costs nothing and carries most of the reliability. For `load_skills`, have the CLI expand skill files into the prompt, or name the skill paths in the prompt, as the Codex edition does |
| 3 | Goal with binding success criteria plus an evidence ledger | Codex threads have `create_goal`. Claude threads do not (inferred) | **Re-create in the CLI.** Store goals, criteria, and evidence under a repo dir such as `.omt3/` with an envelope API like the ulw-loop SDK (`status`, `createGoals`, `recordEvidence`, `checkpoint`). Bind evidence to the git tree hash |
| 4 | ulw-plan workflow, plan file format, and reviewer rounds | Not provided | **Re-create as a skill plus a scaffold script.** Use `delegate_task` for the consultant and reviewer. Run the reviewer on the other model family, which T3 makes easy. Keep the five-round cap, the frozen blocker ledger, the plan hash per round, and the column-zero `N.` and `F<n>.` grammar |
| 5 | ulw-execute with Boulder state | Not provided | **Re-create.** A skill for the orchestrator rules plus CLI commands for Boulder state and checkbox counting. Use `t3_thread_launch` per wave when the user wants worktrees, and `delegate_task` for workers inside a wave |
| 6 | Continuation after turn end | Not provided by T3 MCP tools | **Re-create, with care.** Option A: ship provider hooks. A Claude Code `Stop` hook and a Codex `Stop` hook that return a block decision while the plan has open boxes, with the OmO caps (8 continuations, unchanged-state signature, context-pressure bail-out, explicit external-blocker marker). Whether provider hooks run inside T3 threads is an open question. Option B: `schedule_task` bound to the thread, polling plan state on a long interval. Option B is coarse and costs a turn per tick |
| 7 | Independent verification of done claims | Not provided | **Re-create in the skill.** The parent requires an `EVIDENCE_RECORDED: <path>` line in each worker result, checks the file in the CLI, and sends a separate verifier task on the other family. T3 has no `SubagentStop` hook, so the parent does the check |
| 8 | Ultrawork keyword directive | Not provided | **Re-create as a skill.** Optionally add a `UserPromptSubmit` hook per provider that injects a short pointer, like the Codex edition, if hooks run in T3. Keep the directive small. The Codex edition shows that a pointer under 4 KB plus a skill file works |
| 9 | Spawn budgets (fan-out 24, reviewers 3, breaker on agent limit) | Not provided | **Re-create in the CLI** as counters the skill consults before each `delegate_task`. Cheap insurance against fan-out storms |
| 10 | Read-only specialist roles (explore, librarian, plan-consultant, plan-reviewer) | `delegate_task` has no role or tool-allowlist field (inferred from its documented inputs) | **Re-create as role prompts** plus a read-only mode if `delegate_task` supports one. The clarity skill notes `interactionMode: plan` as T3's read-only switch. Verify it |
| 11 | Config layering, schema, safe writes | Not provided | **Re-create, small.** One user file and walked project files, per-provider blocks, Zod schema published as JSON Schema, comment-preserving writes with backups. Skip OmO's migration engine at first |
| 12 | Installer and doctor | Not provided | **Re-create.** Detect read-only, print one summary, ask once, back up, stay idempotent. Doctor checks: T3 MCP reachable, `orchestrator_capabilities` returns models, each category has a live candidate (OmO's "category coverage"), skills installed, hooks installed |
| 13 | mass ulw DAG with journal | Not provided | **Defer.** High cost. A first version can run waves of parallel `delegate_task` calls from a JSON plan, with retry per node. Add a journal only if runs must survive restarts |
| 14 | Teams with mailboxes | T3 threads and messages exist | **Defer.** Use `t3_thread_launch` per member with a worktree, plus `t3_thread_send`. OmO's own rule is to prefer parallel workers and use teams only for overlapping scopes |
| 15 | Model profiles for the main session | T3 picks the thread model | **Does not fit.** T3 owns the main model selection |
| 16 | Background task engine, suspension, revival, exactly-once delivery | T3 owns task lifecycle | **Does not fit.** Rely on `task_status`. Check how T3 reports completion (open question) |
| 17 | Comment checker, LSP, project rules, AGENTS.md injection | Provider harnesses do this | **Does not fit**, except as optional provider hooks later |
| 18 | Claude Code compatibility layer | Providers load their own config | **Does not fit** |
| 19 | Memory, computer use, thread gateway, telemetry | Out of scope | **Does not fit** |

Note, 2026-10-28: the workflow fold rejects option B of rank 6 for omt: no flow uses a `schedule_task` heartbeat, and omt-loop was removed. For rank 9, the fold removed the per-run task budget (`limits.maxTasksPerRun`) and kept `maxParallel` and `maxDepth`. See [the workflow fold design](../design/workflow-fold.md).

### 13.3 Design notes to carry over

- Fail closed on identity. OmO never continues a run when it cannot prove which session owns it (`ulw-loop/index.ts:222-227`). oh-my-t3code state should key on the T3 thread id.
- Prefix session ids by harness, as Boulder does (`opencode:`, `codex:`, `senpi:`). oh-my-t3code can use `t3:<threadId>`.
- Keep directive text in Markdown read at runtime, with one canonical source. OmO generates edition copies from `packages/prompts-core` and pins byte identity with tests.
- Put all hook and CLI state writes behind a lock with atomic tmp-and-rename writes, as every OmO store does.

## 14. Open questions

1. Do provider hooks (Claude Code `Stop`, `UserPromptSubmit`, and Codex plugin hooks) run inside T3 threads? Continuation (rank 6) and the keyword pointer (rank 8) depend on this.
2. Does `delegate_task` push a completion into the parent thread, or must the parent call `task_status`? OmO's design assumes a push. The T3 instructions mention a wake only for `watch_pull_request`.
3. Can a running delegated task be steered (OmO `task_send`)? The T3 instructions say not to use `t3_thread_send` on a `childThreadId` for review rounds. Whether steering a worker that way is supported is unclear.
4. Does `delegate_task` accept a read-only flag, a tool allowlist, or a working directory? This decides how the read-only roles and per-wave worktrees map.
5. How do Codex-native `create_goal` and an oh-my-t3code goal store coexist in a Codex-backed T3 thread? The Codex edition steers Codex goals with a hook. oh-my-t3code may need its own store for Claude threads.
6. Senpi is outside this clone, so the Native `create_goal` and `update_goal` definitions were not found. Searches: `rg -l create_goal packages --type ts` found only callers and hooks.
7. No DAG runner exists in the Codex edition (section 8.7). Is a DAG worth building for oh-my-t3code, or are waves of parallel tasks enough?
8. The model ids in OmO chains (for example `gpt-6-astra`, `claude-fable-5-1`) were taken as written. They must be mapped to T3 provider instance ids from `orchestrator_capabilities`.
9. License. The Sustainable Use License limits commercial redistribution. oh-my-t3code must re-implement these designs, not copy files. Legal review is open.
