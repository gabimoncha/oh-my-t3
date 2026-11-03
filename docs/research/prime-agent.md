# prime-agent research for oh-my-t3code

Snapshot: prime-agent clone at commit `2ed8356` of 2026-10-06 (`git -C prime-agent log --oneline -1`). Research date: 2026-10-07.

> Note, 2026-10-28: the workflow fold changed omt after this research. omt-ulw is now a main-thread build flow. The main thread builds and fixes, one review child and one QA child check, and the main thread waits for children inside its turn. omt-loop, the stall heartbeat, per-unit dispatch, and the task budget (`limits.maxTasksPerRun`) were removed, and omt-review was renamed omt-code-review. Skill step numbers and `omt:` line cites below refer to the skills before that change. See [the workflow fold design](../design/workflow-fold.md).

## Path conventions

- `pa:` is the root of a clone of https://github.com/PrimeIntellect-ai/prime-agent at commit `2ed8356`.
- `omt:` is the root of this repository, https://github.com/gabimoncha/oh-my-t3.
- `catalog:` is the owner's private catalog note on prime-agent. It is not public.
- `RT` in a path means `prime-agent-runtime/src/rlm` inside the clone. So `pa:RT/harness.py` is `pa:prime-agent-runtime/src/rlm/harness.py`.
- I read the self-improvement code (Q2) myself. Read-only explore subagents read parts of Q1 and Q3 to Q7. I spot-checked their key ranges. Every cite is a line range that one of us read.
- I did not run any script, build, test, or installer in the clone.

## Catalog note check

The catalog note describes snapshot `e387021` of 2026-10-02. The clone is 35 commits newer. Most claims hold. I confirmed these in the clone:

- The model sees one tool. The live session passes `tools: vec![]` and the engine adds `ipython` (`pa:crates/pa-daemon/src/agent_engine/lifecycle.rs:948-949`).
- `/refine` writes create, update, and delete edits with history and rollback (`pa:crates/pa-core/src/refinement/planner.rs:310-547`).
- The base system prompt is not editable by refine (`pa:crates/pa-core/src/refinement/planner.rs:210-215`).
- The `[harness-digest]` message arrives at session start, resume, and compaction (`pa:crates/pa-core/src/session_engine/harness_digest.rs:1-4`).
- Compaction triggers at 16,384 remaining tokens and keeps REPL variables up to 16 MiB each (`pa:crates/pa-core/src/prompts/layers/core.md:139`).

These claims are wrong or out of date:

1. "12 bundled skills". The clone has 13. Commit `2b962da` (2026-10-03) added `skills/factory` after the catalog snapshot.
2. "The /factory on command named in the Python help is not in the Rust slash registry". This was true at `e387021`. Since `2b962da`, `/factory [on|off|status]` is a built-in command (`pa:crates/pa-types/src/slash_commands.rs:79`) with a handler (`pa:crates/pa-tui/src/session_ui/commands.rs:357-369`).
3. "Optional auto-refine after compaction" (context-compaction row). Auto-refine is on by default. The defaults are `enabled: true`, `compact: true`, and a 20-minute cooldown (`pa:crates/pa-core/src/session_engine/refine.rs:38-47`). It runs only for depth-0 sessions with a local harness directory (`pa:crates/pa-core/src/session_engine/engine.rs:331`).
4. The catalog does not say that the `autoRefine.turnInterval` setting (default 25) has no reader. Only the settings struct and the gates struct hold it (`pa:crates/pa-core/src/settings/types.rs:110-115`, `pa:crates/pa-core/src/session_engine/refine.rs:28-63`). A grep for `turn_interval` finds no other use. So auto-refine triggers only after compaction, not every 25 turns.
5. "A keep-alive for long subagent work" (persistent-goals row). The keep-alive text builder exists (`pa:crates/pa-core/src/autonomous/mod.rs:452-460`), but only tests call it. A grep found no caller in the daemon. The setting parses (`pa:crates/pa-core/src/slash_command_args.rs:221`), but no message is sent.
6. "git worktree snapshots for autonomous gates" (git-github row). The gate snapshot is not a worktree. It is the porcelain status, the HEAD diff, and a hash of untracked files, compared to skip a re-run on an unchanged workspace (`pa:crates/pa-core/src/autonomous/gates.rs:144-160`, `pa:crates/pa-core/src/autonomous/gates.rs:240`).
7. Storage paths are one level deeper than the note says. Harness state is `<agent dir>/harness/harness_state.json` and `<session artifact dir>/harness/harness_state.json`, with `refinement_history.jsonl` beside the global file (`pa:crates/pa-core/src/refinement/mod.rs:12-14`, `pa:crates/pa-core/src/refinement/mod.rs:121-134`).
8. The skills row lists precedence but leaves out `.agents/skills`. Discovery also reads every ancestor `.agents/skills` up to the git root and `~/.agents/skills` (`pa:crates/pa-core/src/packages/resolve/auto.rs:55-59`, `pa:crates/pa-core/src/packages/resolve/auto.rs:76-121`). It does not read `~/.claude/skills` (explore subagent grep). So omt skills installed in `~/.agents/skills` are visible to prime-agent.

## 1. Summary

- "RLM" means Recursive Language Model in the sense of the Zhang et al. work. Context lives in Python variables in a persistent REPL, and subagents are async function calls (`pa:README.md:38`). There is no call that runs a bare LLM on a slice of a variable. The only recursion is `rlm.spawn`, which starts a full child agent (`pa:RT/__init__.py:170-193`).
- The model has one tool, `ipython` (`pa:crates/pa-core/src/prompts/layers/core.md:3`). Shell, edit, web search, MCP, subagents, goals, and refine are Python functions inside it.
- The self-improvement loop is the "continual harness". It edits a JSON store with five entry kinds, `prompt`, `memory`, `skill`, `subagent`, and `factory` (`pa:crates/pa-core/src/refinement/mod.rs:10`). It never edits the base prompt, source code, model weights, model routing, or settings.
- The only signal is the session transcript, read by the session's own model. A second model call is a cheap review gate before automatic refinement (`pa:crates/pa-core/src/refinement/planner.rs:12`). Tests, gate results, telemetry, and user ratings do not feed the refiner.
- Each refinement records an `expectedOutcome` ("what should improve and how to validate it"), but no code reads it back to check the result (grep for `expected_outcome` outside the refinement module finds only a test).
- Safety comes from structure, not from evaluation. Edits are small JSON operations, scoped local by default, validated per kind, applied after a re-read with an optimistic concurrency check, logged with before and after snapshots, and reversible with `/refine rollback <id>` (`pa:crates/pa-core/src/refinement/planner.rs:193-285`, `pa:crates/pa-core/src/refinement/planner.rs:357-372`, `pa:crates/pa-core/src/refinement/planner.rs:505-547`).
- Learned entries reach the model through a ranked `[harness-digest]` user message, not through the system prompt. The digest shows at most 3 entries per kind, 140 characters each, ranked by overlap with the goal and the last 4 messages (`pa:crates/pa-core/src/refinement/mod.rs:17-19`, `pa:crates/pa-core/src/session_engine/harness_digest.rs:36-59`).
- Long tasks run in a daemon with one worker process per session and restart with backoff (`pa:crates/pa-daemon/src/supervisor/supervision.rs:15-20`). Goals, autonomous mode with shell gates, heartbeats, cron schedules, and quota park keep work going.
- Subagents are persistent child sessions in the same working directory. They return free text through `agent_message`, not a schema (`pa:crates/pa-core/src/prompts/layers/core.md:33`). There is no worktree isolation and no cap on concurrent `rlm.spawn` calls (explore subagent grep).
- The factory runs declarative state machines of subagents with `foreach`, joins, budgets, and stall detectors. It ships off (`pa:skills/factory/SKILL.md:28-30`). Three seed machines ship, one of them a review sweep (`pa:RT/machines/review-sweep/MACHINE.md:1-15`).
- Product telemetry goes to PostHog through Prime. A daily GitHub Action posts DAU, tokens, and run success rate to Slack (`pa:docs/daily-stats.md:1-18`). None of it feeds back into agent behavior.
- The most useful idea for omt is the shape of the refine pipeline. A model proposes JSON edits, and deterministic code validates, applies, logs, and rolls back. That matches omt's rule "a CLI for the deterministic parts, skills for the judgment" (`omt:docs/design.md:41-47`). omt can do better than prime-agent on the signal, because the omt ledger already records review verdicts, fix rounds, and providers per unit.

## 2. Findings by question

### Q1. What RLM means, and how the model calls itself

#### Definition

- The README defines RLM as "context as variables (*prompt-as-a-variable*) and tools like recursive subagents as function calls (*programmatic tool /sub-agent calling*) inside a persistent REPL" (`pa:README.md:38`).
- The prompt separates two terms. "Continual harness" names the persisted layer. "RLM" names the runtime, the kernel, and the call interface (`pa:crates/pa-core/src/prompts/layers/usage.md:25`).
- The harness calls itself "a recursive harness". Each session builds a tree of persistent agents from depth 0 (`pa:crates/pa-core/src/prompts/layers/core.md:29`).
- A grep for `llm_query`, `sub_llm`, `llm_batch`, `rlm.query`, and `rlm.llm` found nothing (explore subagent). The `rlm` module exposes `spawn`, `create_session`, `find_models`, `list_subagents`, `collect`, `progress_note`, `delete_subagent`, and `rename` (`pa:RT/__init__.py:621-674`). So the "recursive call" is always a full agent session, not a sub-LLM call over a variable slice. This differs from the original RLM paper design (inferred from the paper's public description, not from this repo).

#### One tool, everything else in Python

- The only model tool is `ipython`, with one `code` parameter (`pa:crates/pa-core/src/tools/ipython.rs:339-354`).
- The prompt says that all other tools are "programmatic tools", async functions in the REPL (`pa:crates/pa-core/src/prompts/layers/core.md:3`).
- `bash()` returns a background handle with `.tail(n)` and `.output()`, so output can stay in a variable (`pa:crates/pa-core/src/prompts/layers/core.md:9-22`).
- The Rust `bash` and `edit` tools still exist but are not registered in live sessions (`pa:crates/pa-daemon/src/agent_engine/lifecycle.rs:948-949`).

#### Context as data

- Mandatory rules tell the agent to read and search files in Python and to assign every result to a named variable (`pa:crates/pa-core/src/prompts/layers/usage.md:11-12`).
- "Python is the orchestration language". Loops, parsing, and state belong in Python, and `bash()` only starts programs (`pa:crates/pa-core/src/prompts/layers/usage.md:19`).
- Cell output shown to the model is capped at 65,536 characters (`pa:crates/pa-core/src/kernel/shared.rs:12`), with a truncation marker (`pa:crates/pa-core/src/kernel/manager/execution.rs:175-195`).
- REPL state survives compaction and restart. A dill snapshot runs 1,500 ms after each successful cell. Caps are 256 MiB per snapshot and 16 MiB per variable (`pa:crates/pa-core/src/kernel/state_snapshot.rs:7-12`, `pa:crates/pa-core/src/kernel/shared.rs:15`).
- After compaction, a hidden `ipython_state` row lists the names that still exist and the names that were pruned (`pa:crates/pa-core/src/session_engine/ipython_state.rs:1-4`).

#### Sub-model calls

- `rlm.spawn(prompt, *, name, model=None, thinking=None)` returns a handle at once (`pa:crates/pa-core/src/prompts/layers/core.md:33`). The host rejects any other keyword, such as `depth` or `budget` (`pa:crates/pa-core/src/session_engine/rlm_host.rs:489-510`).
- `rlm.find_models(query, limit)` searches models that the user's credentials can reach (`pa:crates/pa-core/src/prompts/layers/core.md:35`). A child model must match exactly or by a unique short name and must pass an allowlist. There is no fallback (`pa:crates/pa-daemon/src/rlm_child_model.rs:38-58`).
- There is no role or tier concept for model choice (explore subagent, inferred from grep).

#### Splitting long tasks

- The prompt asks for parallel workers for independent substantive tasks, and for file-based fan-in (`pa:crates/pa-core/src/prompts/layers/usage.md:15`, `pa:crates/pa-core/src/prompts/layers/usage.md:27-32`).
- The opinionated layer suggests writing wrappers around `rlm.spawn` as subagent templates (`pa:crates/pa-core/src/prompts/layers/opinionated.md:4`).
- The factory is the structured form. It runs states, guarded transitions, `max_entries` re-entry, `foreach` up to 256 items, and up to 8 parallel children by default (`pa:RT/factory.py:1-26`, `pa:RT/factory.py:56-77`). Stall detectors fail a run when nothing can progress (`pa:RT/factory.py:3133-3180`). Factory runs live in kernel memory and do not survive a kernel restart (`pa:RT/factory.py:1-26`).

#### Prompt layers

- The system prompt has static layers `core.md`, `usage.md`, `opinionated.md`, and `per_model.md`, compiled in with `include_str!` (`pa:crates/pa-core/src/prompts/layers.rs:1-9`). `per_model.md` ships with no model blocks (`pa:crates/pa-core/src/prompts/layers/per_model.md:1-6`).
- A child gets the same prompt plus a session-role section. It says "You are a child agent spawned by ..." and tells it to reply with `agent_message.send(..., receiver_role="parent")` (`pa:crates/pa-core/src/prompts/system_prompt.rs:300-330`).
- `/system-prompt` shows the exact system prompt (`pa:crates/pa-types/src/slash_commands.rs:55`).

### Q2. The self-improvement loop

#### What can change

- Five entry kinds exist, `prompt`, `memory`, `skill`, `subagent`, and `factory` (`pa:crates/pa-core/src/refinement/mod.rs:10`).
- The refiner's system prompt defines each kind (`pa:crates/pa-core/src/refinement/planner.rs:10`):
  - `prompt` is a supplemental note. "The base system prompt is immutable and MUST NOT be rewritten."
  - `memory` holds facts, decisions, failures, preferences, and outcomes.
  - `skill` is a pointer to a Python callable with a `reference` (import and callable) and an `arguments` contract. It is not code. The refiner cannot write a Python package.
  - `subagent` is a reusable delegation spec with a purpose, instructions, and when to use it.
  - `factory` is a state-machine spec. Refine can write it only when the user enabled the factory (`pa:crates/pa-core/src/refinement/planner.rs:380-389`).
- Each entry has an id, title, content, path, scope, reference, arguments, metadata, source (`agent` or `refine`), timestamps, and a version that increments on each update (`pa:crates/pa-core/src/refinement/mod.rs:49-69`, `pa:crates/pa-core/src/refinement/planner.rs:418-462`).
- Nothing else changes. Refine never edits source files ("Never edit source files directly", `pa:crates/pa-core/src/refinement/planner.rs:10`). It does not change model choice, settings, SKILL.md files, or weights. Training on traces exists only as a product pitch in the bundled `prime-intellect` skill (`pa:skills/prime-intellect/SKILL.md:17-18`).

#### What triggers it

There are three triggers:

1. The user types `/refine [--global] [instructions]` or `/refine rollback <id> [--global]` (`pa:crates/pa-core/src/session_engine/slash_commands.rs:45-80`).
2. The agent calls `await refine.run(instructions=None, global_=False)`. It only schedules. The refinement runs when the current turn ends (`pa:skills/refine/SKILL.md:21-42`, `pa:crates/pa-core/src/session_engine/turn_boundary.rs:321-366`). The prompt tells the agent to call it after a repeated failure, a reusable tactic, a repeated delegation role, or a user correction (`pa:crates/pa-core/src/refinement/ranking.rs:219-222`).
3. Automatic refinement after a successful compaction. The compaction arms a trigger (`pa:crates/pa-daemon/src/auto_compaction.rs:151-153`). At the next turn boundary, the trigger runs a review-gate model call. Only an approval runs the refinement (`pa:crates/pa-core/src/session_engine/auto_refine_trigger.rs:125-258`).

The automatic path has these gates:

- It is on by default, with a 20-minute cooldown between reviews (`pa:crates/pa-core/src/session_engine/refine.rs:38-47`).
- It runs only for root sessions with a local harness directory (`pa:crates/pa-core/src/session_engine/engine.rs:331`). Children never refine.
- The review gate prompt says "Reject one-off noise, unsupported hypotheses, and transient tool outputs" and returns `shouldRefine`, `rationale`, and `instructions` (`pa:crates/pa-core/src/refinement/planner.rs:12`).
- An approved automatic run is always local. Its instructions say "Prefer an empty edits array over speculative or one-off memories. Do not promote anything global unless explicitly requested" (`pa:crates/pa-core/src/session_engine/refine.rs:66-84`, `pa:crates/pa-core/src/session_engine/refine.rs:561-581`).
- If the agent is still streaming, the approval waits for the next boundary. A branch move discards a pending approval (`pa:crates/pa-core/src/session_engine/auto_refine_trigger.rs:179-218`).

#### What signal drives it

- The signal is the transcript. The planner sends the last 80,000 characters of the serialized conversation, an overview of up to 40 entries per kind, the last 20 refinement results, a scope policy, and optional user instructions (`pa:crates/pa-core/src/refinement/executor.rs:220-249`, `pa:crates/pa-core/src/refinement/executor.rs:41-125`).
- The review gate sees the last 40,000 characters (`pa:crates/pa-core/src/refinement/executor.rs:356`).
- The planner uses the session's current model and API key (`pa:crates/pa-daemon/src/agent_engine/session_engine_impl.rs:1163-1181`). There is no cross-model review of a proposal.
- The prior refinement history is part of the input, and the prompt says "If prior refinements caused issues, rollback or replace the faulty editable entries" (`pa:crates/pa-core/src/refinement/planner.rs:10`). So the only feedback on a past change is the next refiner's reading of the transcript.
- No test result, gate result, telemetry event, or user rating is an input. The telemetry catalog has no refine event (grep of `pa:crates/pa-telemetry/src` for `refine` and `harness` finds nothing).

#### Data flow from a run to a changed behavior

1. A trigger fires (see above). For the agent path, `refine.run` stores a pending request in the turn-boundary slot (`pa:crates/pa-core/src/session_engine/turn_boundary.rs:149-169`).
2. `execute_refinement_with_rows` loads the global state, and for a local refinement merges it with the local state. Local ids that collide get a `local:` prefix (`pa:crates/pa-core/src/session_engine/refine.rs:337-344`, `pa:crates/pa-core/src/refinement/mod.rs:229-272`).
3. It captures a baseline of the target store before the slow model call (`pa:crates/pa-core/src/session_engine/refine.rs:347-359`).
4. `plan_refinement` builds the prompt and calls the model. The context is trimmed from the front with a binary search to fit the window (`pa:crates/pa-core/src/refinement/executor.rs:194-268`, `pa:crates/pa-core/src/refinement/planner.rs:578-632`).
5. The reply must be JSON with `summary`, `rationale`, `expectedOutcome`, and `edits[]`. The parser accepts raw, fenced, or embedded JSON and reports truncation (`pa:crates/pa-core/src/refinement/planner.rs:95-172`).
6. The executor re-reads the target store from disk and applies the plan (`pa:crates/pa-core/src/session_engine/refine.rs:372-402`). Per edit, `validate_edit` rejects an edit to `base_system_prompt`, a missing id or content, a skill without a Python reference and arguments, and a malformed factory spec (`pa:crates/pa-core/src/refinement/planner.rs:193-285`). An entry that changed since the baseline is rejected with "entry changed during refinement planning" (`pa:crates/pa-core/src/refinement/planner.rs:357-372`). Each applied edit stores `before` and `after` snapshots (`pa:crates/pa-core/src/refinement/planner.rs:465-469`).
7. The store is written atomically to `harness_state.json` (`pa:crates/pa-core/src/refinement/mod.rs:279-288`). A global result is also appended to `refinement_history.jsonl` (`pa:crates/pa-core/src/refinement/mod.rs:399-414`). Every result is appended to the session JSONL as a `prime-agent.refinement` audit row (`pa:crates/pa-core/src/session_engine/refine.rs:412-415`).
8. Two messages follow. A visible outcome row goes to the user. A hidden `[auto-refinement]`, `[user-refinement]`, or `[self-refinement]` notice with the applied edits goes to the model, only when at least one edit applied (`pa:crates/pa-core/src/session_engine/refine.rs:111-160`, `pa:crates/pa-core/src/session_engine/refine.rs:431-440`).
9. Behavior changes at the next cold boundary. The `[harness-digest]` user message renders the merged state at session start, resume, and the compaction head (`pa:crates/pa-core/src/session_engine/harness_digest.rs:1-4`). The digest ranks entries per kind by term overlap with the goal objective (weight 3) and the last 4 messages (weights 2 down to 1), with IDF weighting (`pa:crates/pa-core/src/session_engine/harness_digest.rs:36-59`, `pa:crates/pa-core/src/refinement/ranking.rs:139-171`). It shows 3 entries per kind and the last 10 refinement events, each cut to 140 characters (`pa:crates/pa-core/src/refinement/mod.rs:17-19`, `pa:crates/pa-core/src/refinement/ranking.rs:195-372`). A fingerprint skips a re-send when the state did not change (`pa:crates/pa-core/src/session_engine/harness_digest.rs:493-526`).
10. The agent can read more on demand with `rlm.harness.search(query, kind, limit)` and `rlm.get_harness_state()` (`pa:crates/pa-core/src/prompts/layers/core.md:107-109`).

The skill file says refinement "rebuilds the system prompt" (`pa:skills/refine/SKILL.md:34-36`). The code delivers entries through the digest message and the notice row instead. A grep for `harness` in `pa:crates/pa-core/src/prompts/system_prompt.rs` finds only test assertions. So the SKILL.md wording is stale (inferred).

#### Direct writes by the agent

- The agent can also write entries itself with `rlm.harness.create_memory`, `create_prompt_note`, `create_skill`, `create_subagent`, and `create_factory` (`pa:crates/pa-core/src/prompts/layers/core.md:93-104`). These writes skip the planner and set `source: "agent"` (`pa:RT/harness.py:555-596`).
- `rlm.harness.record_refinement` appends an event with trigger, changes, evidence, and outcome, but no before or after snapshot (`pa:RT/harness.py:1036-1067`). So direct writes cannot be undone with `/refine rollback` (inferred from the rollback code, which needs `before` and `after`, `pa:crates/pa-core/src/refinement/planner.rs:505-547`).
- `rlm.harness.plan_refinement` returns a fixed three-step plan. The steps are diagnose, update the smallest component, and run the next action and record the outcome (`pa:RT/harness.py:1069-1084`). The usage rule repeats "diagnose, update the smallest relevant component, validate on the next action, then record the outcome" (`pa:crates/pa-core/src/prompts/layers/usage.md:26`). Validation is a prompt instruction. No code checks it.

#### Scope

- Local is the default. The local store lives in the session artifact directory, so a new session does not see it (`pa:crates/pa-core/src/refinement/mod.rs:126-129`).
- Global edits must be "stable cross-session lessons, durable user preferences, reusable skills/subagents, or tool/environment facts". A project lesson may be global only when its text names the project (`pa:crates/pa-core/src/refinement/planner.rs:10`).
- During a local refinement, global entries are read-only context (`pa:crates/pa-core/src/refinement/executor.rs:221-225`).

#### Acceptance and rollback

- Acceptance is structural. A proposal applies when its JSON validates. There is no test, no second reviewer, and no user approval step for `/refine` or `refine.run`. The automatic path has the review gate, which decides whether to refine, not whether the edits are good.
- `/refine rollback <id>` builds a reverse proposal from the stored `before` snapshots. A created entry is deleted, and an updated or deleted entry is restored (`pa:crates/pa-core/src/refinement/planner.rs:503-547`). The rollback is itself a recorded refinement with `rollbackOf` (`pa:crates/pa-core/src/refinement/mod.rs:296-309`).
- Rollback is manual. Nothing detects a harmful entry and reverts it.

### Q3. Long-running autonomous tasks

#### Daemon

- The supervisor runs one worker process per active session. Restart backoff starts at 250 ms, doubles up to 30 s, and gives up after 5 consecutive failures. A worker that lived 30 s resets the count (`pa:crates/pa-daemon/src/supervisor/supervision.rs:15-20`, `pa:crates/pa-daemon/src/supervisor/supervision.rs:187-192`).
- Sessions are append-only JSONL trees at `<agent dir>/sessions/<uuid>.jsonl` (`pa:crates/pa-daemon/src/session_store.rs:1-5`).
- A restarted supervisor adopts or relaunches saved workers. Workers re-register with backoff (`pa:crates/pa-daemon/src/supervisor/adoption.rs:105-108`, `pa:crates/pa-daemon/src/registration.rs:32-36`).

#### Goals

- `/goal` supports start, status, pause, resume, and clear (`pa:crates/pa-core/src/session_engine/session_commands.rs:305-394`). Only the user creates a goal (`pa:crates/pa-core/src/prompts/layers/usage.md:5`).
- The continuation prompt forces an evidence audit. It says to "audit the current state against every requirement in the objective. Do not rely on intent, partial progress, memory of earlier work, or a plausible final answer as proof of completion" (`pa:crates/pa-core/src/goals.rs:341-350`).
- At the token budget, the goal becomes `budget_limited`, and a wrap-up prompt says "Do not start new substantive work" and asks for progress, remaining work, blockers, and a next step (`pa:crates/pa-core/src/goals.rs:352-358`, `pa:crates/pa-core/src/session_engine/goal_driver.rs:323-366`).
- After 3 turns with no progress, the goal ends in `Error`. Retries back off from 10 s through a durable one-shot cron (`pa:crates/pa-core/src/session_engine/goal_driver/progress.rs:11-25`).
- A continuation waits while child agents are still running (`pa:crates/pa-core/src/session_engine/goal_driver.rs:567-570`).

#### Autonomous mode

- Defaults are 3 continuations, 12 turns, 80,000 tokens, and 30 minutes. Gates get 3 retries and 5 minutes each (`pa:crates/pa-core/src/autonomous/mod.rs:20-27`).
- The continuation prompt says "If you believe you are blocked, prove it with host-observable evidence" and "the verifier/evaluator decides completion when configured gates pass" (`pa:crates/pa-core/src/autonomous/mod.rs:20`).
- Gates are shell commands from CLI flags or `/autonomous on`. There is no config file for them (`pa:crates/pa-cli/src/headless_autonomous.rs:22-42`). Each gate runs after every settled turn. A pass stops the run (`pa:crates/pa-core/src/autonomous/gates.rs:77-127`).
- A failed gate does not run again until the workspace changes. The check compares git status, the HEAD diff, and a hash of untracked files (`pa:crates/pa-core/src/autonomous/gates.rs:144-160`, `pa:crates/pa-core/src/autonomous/gates.rs:240`).
- Headless mode exits non-zero when a gate still fails or an ungated run hits a limit (`pa:crates/pa-cli/src/headless_autonomous.rs:162-201`). The README states that "reaching a limit does not imply task success" (`pa:README.md:109`).

#### Heartbeats, schedules, quota park

- The default heartbeat interval is 5 minutes, delivered as steer (`pa:crates/pa-core/src/cron/mod.rs:12-13`).
- Schedules accept `in <n><unit>`, `every <n><unit>` (10 s minimum), `at <ISO>`, five-field UTC cron, and `@hourly` style aliases (`pa:crates/pa-core/src/cron/mod.rs:127-160`, `pa:crates/pa-core/src/cron/mod.rs:645-761`). Failure backoff runs from 2 minutes to 1 hour (`pa:crates/pa-core/src/cron/scheduler.rs:17-27`).
- A rate-limit failure with a reset time past the quick-retry window parks the session. A one-shot cron `quota-resume` wakes it at reset plus 30 s, capped at 24 h, with at most 8 parks per episode (`pa:crates/pa-core/src/session_engine/provider_park.rs:12-31`, `pa:crates/pa-core/src/session_engine/provider_park.rs:94-127`).
- Provider failover moves the turn to the next provider that serves the same model after 3 retries (`pa:crates/pa-core/src/session_engine/provider_failover.rs:1-4`, `pa:crates/pa-core/src/session_engine/provider_failover.rs:34-48`).

#### Checkpoints and resume

- Compaction keeps about 20,000 recent tokens and writes a Goal, Progress, and Next Steps summary (`pa:crates/pa-core/src/session_engine/compaction.rs:8-17`, `pa:crates/pa-core/src/session_engine/compaction.rs:434-436`).
- After compaction, the session re-injects the harness digest, the `ipython_state` row, and any owed goal continuation (`pa:crates/pa-core/src/session_engine/harness_digest.rs:1-4`, `pa:crates/pa-core/src/session_engine/ipython_state.rs:1-4`).

### Q4. Multi-agent and delegation

- A child is a new daemon session in its own worker (`pa:crates/pa-daemon/src/rlm_children.rs:1-4`). It does not inherit the conversation. Its first message is `[task from parent]` plus the prompt (`pa:crates/pa-daemon/src/rlm_children/host.rs:164-166`).
- A child runs in the parent's working directory (`pa:crates/pa-daemon/src/rlm_children/host.rs:99`). There is no worktree isolation and no rule for file conflicts (explore subagent grep).
- The default maximum depth is 2 (`pa:crates/pa-daemon/src/rlm_children.rs:33`). Spawn fails past it (`pa:crates/pa-daemon/src/rlm_children/host.rs:54-64`). There is no cap on concurrent plain children (explore subagent grep). The factory caps parallel children at 8 by default, in a range of 1 to 64 (`pa:RT/factory.py:64-72`).
- Results have no schema. A child replies in free text with `agent_message.send(..., receiver_role="parent")` (`pa:crates/pa-core/src/prompts/system_prompt.rs:320-323`). `rlm.collect` returns typed snapshots with status, `settled`, `answer_preview`, and `error` (`pa:RT/__init__.py:84-96`).
- A child that settles without a reply produces a `[child-exited: no-reply ...]` notice with its last assistant text (`pa:crates/pa-core/src/session_engine/rlm_notices.rs:37-80`). The daemon sets the sender identity, so a child cannot forge a notice (`pa:crates/pa-daemon/src/child_status_notices.rs:1-19`).
- Messaging reaches parent, siblings, and children. Limits are 16,384 characters per message, 20 pending messages per session, and a rate of 3 burst plus 1 per second (`pa:crates/pa-core/src/session_engine/agent_messaging.rs:16-22`).
- Children can send progress notes of at most 512 characters, about one per 10 s (`pa:crates/pa-core/src/prompts/layers/core.md:40`).
- Stored `subagent` specs are not used by plain `rlm.spawn`. The model must turn a spec into a prompt (`pa:crates/pa-core/src/refinement/ranking.rs:264-266`). The factory does read them and uses `metadata.model` and `metadata.thinking` (`pa:RT/factory.py:2054-2082`).

### Q5. Skills

- A skill is a `SKILL.md` with `name` (64 characters) and `description` (1,024 characters) frontmatter. An empty description means the skill does not load (`pa:crates/pa-core/src/skills/discovery.rs:90-140`).
- A skill with `pyproject.toml` and `src/<import_name>/__init__.py` is a Python skill. It is installed editable into the kernel venv and pre-imported (`pa:crates/pa-core/src/skills/discovery.rs:35-65`, `pa:crates/pa-core/src/prompts/layers/core.md:173-177`).
- Only metadata enters the prompt (`pa:crates/pa-core/src/skills/mod.rs:209-247`).
- Discovery reads `.prime/agent/skills`, ancestor `.agents/skills` up to the git root, the user directory, `~/.agents/skills`, packages, and bundled skills. The first name found wins (`pa:crates/pa-core/src/packages/resolve/auto.rs:55-121`, `pa:crates/pa-core/src/skills/loader.rs:93-103`).
- The `skill-creator` skill scaffolds a project or global skill. Its "verify" step is a frontmatter re-read, `/reload`, and a `/skill:<name>` trial (`pa:skills/skill-creator/SKILL.md:17-25`, `pa:skills/skill-creator/SKILL.md:73-81`). No skill evals or benchmarks exist (explore subagent grep).
- `/refine` does not write SKILL.md files. It writes harness `skill` entries that point at a Python callable (`pa:crates/pa-core/src/refinement/planner.rs:10`). The README says refine "does not replace packaging and reviewing new executable skills" (`pa:README.md:104`).
- The 13 bundled skills are `agent-message`, `agent-observe`, `attach-image`, `compact`, `edit`, `factory`, `goal`, `mcp`, `prime-intellect`, `refine`, `rlm-heartbeat`, `skill-creator`, and `websearch` (`pa:skills/*/SKILL.md:3`, frontmatter of each skill).

### Q6. Telemetry and evals

#### What is measured

- `pa-telemetry` events carry primitives only. `agent started` carries `skill_count` and `python_skill_count` (`pa:crates/pa-telemetry/src/catalog.rs:536-545`). `agent run completed` carries tokens, latencies, estimated cost, and tool counters (`pa:crates/pa-telemetry/src/catalog.rs:547-656`). `agent session ended` carries skill use, subagent usage and cost, kernel bootstrap counts, and feature outcome counts (`pa:crates/pa-telemetry/src/catalog.rs:657-755`).
- Feature names are `model`, `login`, `logout`, `effort`, `goal`, `new`, `resume`, `fork`, `clone`, `tree`, and `feedback` (`pa:crates/pa-telemetry/src/catalog.rs:262-265`). No event covers refine, the harness, autonomous mode, or heartbeats.
- Events go to `https://api.primeintellect.ai/api/v1/agent-analytics/events`, which forwards to PostHog by installation id (`pa:crates/pa-telemetry/src/sinks/analytics.rs:7-20`). A local mirror writes `<agent dir>/telemetry.jsonl`, capped at 5 MiB (`pa:crates/pa-telemetry/src/sinks/file.rs:10-37`).
- Telemetry is on by default. `PI_OFFLINE` or `DO_NOT_TRACK` turn it off, then `PRIME_AGENT_TELEMETRY`, then the `telemetry.enabled` setting (`pa:crates/pa-core/src/session_engine/telemetry/status.rs:10-32`).
- `docs/daily-stats.md` is a process document for a GitHub Actions job. Each day it reads PostHog and posts DAU, WAU, MAU, total tokens, completed runs, and run success rate to a Slack channel (`pa:docs/daily-stats.md:3-18`, `pa:docs/daily-stats.md:20-34`). Success rate is `outcome=success` over all completed runs (`pa:docs/daily-stats.md:14-17`). It measures product adoption, not task quality.
- Traces are opt-in. `agentTraces.enabled` is off when unset (`pa:crates/pa-core/src/settings/manager.rs:413-421`). Onboarding asks "Share agent traces with Prime Intellect?" and says trace sharing "helps us train better open-source models" (`pa:crates/pa-tui/src/onboarding.rs:14-15`). An upload posts the session JSONL with cwd, git repo, and commit headers (`pa:crates/pa-core/src/agent_traces/upload.rs:110-146`). Uploads are manual commands (explore subagent, inferred from callers).

#### Does it feed back

- No. A search for readers of `telemetry.jsonl`, traces, and PostHog data found only writers, an upload cursor, and one test (explore subagent). Nothing changes prompts, harness state, routing, or settings from these data.
- The only closed loops are inside one session. A failed gate's output goes into the next autonomous continuation (`pa:crates/pa-core/src/autonomous/mod.rs:406-424`). `/refine` reads the transcript (Q2).
- The link from traces to model training is a product statement in onboarding copy. No code connects traces to `verifiers` or `prime-rl` (explore subagent grep).

#### Evals in the repo

- Tests are the eval assets. Golden corpora replay captured data (`pa:crates/pa-core/tests/golden/system_prompt.rs:1-3`). Differential tests run against the TypeScript binary. Tmux user-level tests run the TUI (`pa:AGENTS.md:71-73`).
- `pa:crates/pa-cli/tests/eval_composition_e2e.rs:12-17` tests the verifier and gate path end to end.
- Launch benchmarks for first paint are a merge rule (`pa:AGENTS.md:88-92`). Their harness is not in the repo (explore subagent, inferred).
- No benchmark measures whether `/refine` improves later runs. The `opinionated.md` layer says its guidelines "have been shown to improve results on average" (`pa:crates/pa-core/src/prompts/layers/opinionated.md:1`), but the repo has no data for that claim.

### Q7. First-run experience

#### Install

- The README install is one `curl ... | sh` line, or `irm ... | iex` on Windows (`pa:README.md:41-55`).
- The repo script `install-rust.sh` is published as `install.sh`. It installs to `~/.local`, takes over an older TypeScript install, bootstraps `uv` so no system Python is needed, verifies SHA256, and pre-warms the Python kernel. It never touches `~/.prime/agent` (`pa:install-rust.sh:169-200`).
- `--rollback` restores the previous version (`pa:install-rust.sh:193-196`). `prime-agent update` supports `--check`, `--rollback`, `--nightly`, and `--stable` (`pa:crates/pa-cli/src/command_registry.rs:206-229`).
- The Homebrew cask is a draft with placeholder checksums (`pa:packaging/homebrew/Casks/prime-agent.rb:1-20`).

#### Onboarding and defaults

- Onboarding runs once. When a model is ready, it asks only the trace question (`pa:crates/pa-tui/src/interactive/onboarding.rs:289-345`).
- Otherwise it shows a welcome screen, offers "Login to Prime Intellect", applies `prime-inference` with `z-ai/glm-5.3` when no model is set, opens a picker for more providers, and asks the trace question (`pa:crates/pa-tui/src/interactive/onboarding.rs:358-400`, `pa:crates/pa-tui/src/interactive/onboarding.rs:455-470`, `pa:crates/pa-core/src/models/resolver.rs:8`).
- Subscription logins exist for Anthropic, Copilot, Codex, and xAI (`pa:crates/pa-cli/src/provider_login.rs:18-24`).
- The kernel venv has 12 default packages and boots in the background at session start (`pa:crates/pa-core/src/kernel/bootstrap/mod.rs:40-56`, `pa:crates/pa-core/src/session_engine/engine.rs:418-428`).

| Setting | Default | Source |
| --- | --- | --- |
| Model | per provider; Prime Inference uses `z-ai/glm-5.3` | `pa:crates/pa-core/src/models/resolver.rs:8-30` |
| Thinking | medium | `pa:crates/pa-daemon/src/agent_engine/model.rs:353-354` |
| Auto-compaction | on | `pa:crates/pa-core/src/settings/manager.rs:403-411` |
| Auto-refine | on, after compaction only, 20-minute cooldown | `pa:crates/pa-core/src/session_engine/refine.rs:38-47` |
| Telemetry | on | `pa:crates/pa-core/src/session_engine/telemetry/status.rs:17-29` |
| Trace upload | off | `pa:crates/pa-core/src/settings/manager.rs:413-421` |
| Factory | off | `pa:crates/pa-core/src/settings/types.rs:225-227` |
| Max subagent depth | 2 | `pa:crates/pa-daemon/src/rlm_children.rs:33` |

#### What can impress a new user

- `prime-agent prompt` prints the assembled system prompt with its layer breakdown (`pa:crates/pa-cli/src/command_registry.rs:289-305`). `/system-prompt` does the same in a session (`pa:crates/pa-types/src/slash_commands.rs:55`).
- `!cmd` runs a shell command from chat and puts the output in context. `!!cmd` keeps it out (`pa:crates/pa-tui/src/bash_bang.rs:1-4`).
- `/btw` asks a side question (`pa:crates/pa-types/src/slash_commands.rs:52`).
- `/export` writes an HTML session and `/share` posts a secret gist (`pa:crates/pa-types/src/slash_commands.rs:48-50`).
- The agents view lists running, idle, and saved sessions (`pa:crates/pa-tui/src/agents_view.rs:1-4`).
- A visible refinement outcome row tells the user what the harness learned (`pa:crates/pa-core/src/session_engine/refine.rs:111-130`). This is the one place where "self-improving" is visible on screen.

### Q8. Other strong ideas that omt does not have

- **Gate skip on an unchanged workspace.** A failed gate does not run again until git status, the diff, or the untracked files change (`pa:crates/pa-core/src/autonomous/gates.rs:144-160`). This turns "nothing changed" into a cheap stall signal.
- **Budget wrap-up prompt.** When a goal hits its budget, the agent gets a fixed instruction to stop new work and report progress, remaining work, blockers, and a next step (`pa:crates/pa-core/src/goals.rs:352-358`).
- **Machine library.** Declarative workflows ship as `MACHINE.md` files with one `machine-spec` block, resolved from bundled seeds and a personal library (`pa:RT/factory.py:4686-4703`). The `review-sweep` seed runs one reviewer per changed file, 8 at a time, and an aggregator that returns JSON issues (`pa:RT/machines/review-sweep/MACHINE.md:10-21`, `pa:RT/machines/review-sweep/MACHINE.md:34-90`).
- **Optimistic concurrency on shared state.** Refine rejects an edit to an entry that changed during planning (`pa:crates/pa-core/src/refinement/planner.rs:357-372`). Several omt threads can share one `.omt` directory (`omt:docs/spec.md:341`), so the same guard applies.
- **Hidden notices with typed headers.** Harness messages to the model start with `[<kind>(: <qualifier>)( <address>)]` and the prompt says they are not from the user (`pa:crates/pa-core/src/prompts/layers/core.md:5`).
- **Side questions.** `/btw` asks a question without adding it to the session (`pa:crates/pa-types/src/slash_commands.rs:52`).
- **Context view across subagents.** `/context` shows token, cost, and context use for the agent and its subagents (`pa:crates/pa-types/src/slash_commands.rs:59`).

## 3. Ideas for omt

The ideas are ranked by value for a self-improving meta-harness, then by effort. "Owner decision" marks an idea that design.md puts out of scope. Memory is out of scope today (`omt:docs/design.md:84`), and so is a DAG scheduler.

prime-agent's main lesson for omt is a split. The judgment (what to learn) is a model call. The safety (validate, apply, log, roll back) is deterministic code. omt already uses this split for routing and briefs. Its main gap compared with prime-agent is that omt learns nothing between runs. Its main advantage is a better signal. The ledger records the role, provider, model, round, attempt, and verdict of every dispatch (`omt:docs/spec.md:249-263`). prime-agent has only the transcript.

### 1. Outcome metrics from the ledger

- **What.** A command that turns `.omt/ledger.jsonl` into outcome metrics per role and per provider and model. Examples are first-pass `APPROVE` rate, mean fix rounds per unit, `NOT VERIFIED` rate, fallback rate, and failure codes per rung. With enough samples, it prints a suggested config change that moves a weak rung down a role chain. It never applies the change.
- **Source.** prime-agent has no such loop. Its refiner reads only the transcript (`pa:crates/pa-core/src/refinement/executor.rs:220-249`), its telemetry has no reader (Q6), and refine never touches model choice (`pa:crates/pa-core/src/refinement/planner.rs:10`). The local `telemetry.jsonl` mirror is the closest shape (`pa:crates/pa-telemetry/src/sinks/file.rs:10-37`).
- **Maps to.** The `omt` CLI as `omt ledger stats --by role,model` or a new `omt stats`. The data is already in `.omt/ledger.jsonl`. `omt doctor` can show the summary. The skills already record verdicts in the form the metrics need (`omt:docs/spec.md:1258`).
- **Effort.** M.
- **Blocked by.** Nothing. It is local, deterministic, and needs no runtime dependency. The verdict field holds the first words of a result block (`omt:docs/spec.md:261`), so the metrics depend on skills that record it the same way each time.
- **Owner decision.** No for the metrics. Yes before any change to routing becomes automatic.

### 2. An evidence-backed harness store with rollback

- **What.** A small versioned store of learned entries, written only through a validated apply step. A model proposes JSON edits (`create`, `update`, `delete`) with `summary`, `rationale`, and `expectedOutcome`. The CLI validates each edit by kind, rejects an edit to a base template, checks that no entry changed since the proposal started, writes atomically, stores `before` and `after` per edit, and appends to a history file. `rollback <id>` replays the `before` snapshots.
- **Source.** `pa:crates/pa-core/src/refinement/planner.rs:10` (kinds and output shape), `pa:crates/pa-core/src/refinement/planner.rs:193-285` (validation), `pa:crates/pa-core/src/refinement/planner.rs:357-372` (concurrency check), `pa:crates/pa-core/src/refinement/planner.rs:505-547` (rollback), `pa:crates/pa-core/src/refinement/mod.rs:279-414` (atomic save and history), `pa:crates/pa-core/src/session_engine/refine.rs:301-442` (the full flow).
- **Maps to.** The `omt` CLI as `omt harness apply|list|show|log|rollback`. State in `.omt/harness/state.json` and `.omt/harness/history.jsonl` for project scope, and `<configDir>/harness/` for user scope, written with the atomic helpers of `src/util/fs.ts`. Entry kinds map onto omt surfaces. A `lesson` is a project fact. A `role-note` is an addendum to one role persona. A `role` is a proposed custom role for `.omt/roles/` (`omt:docs/spec.md:325`). omt skills stay owner-authored, so a `skill` entry can only be a proposal for a person to review. The proposer is a `refine` role child in `plan` interaction mode, dispatched with `delegate_task`. It returns the JSON in a new result block.
- **Effort.** L for all kinds. M for `lesson` and `role-note` only.
- **Blocked by.** The CLI cannot call a model, so the proposal must come from a T3 child. That fits the design (T3 owns the agent loop). No daemon is needed, because proposals happen at run boundaries. Zero dependencies hold, since the store is JSON.
- **Owner decision.** Yes. design.md lists memory as out of scope (`omt:docs/design.md:84`). This store is memory with an audit trail.

### 3. A closed loop that checks each change

- **What.** Make `expectedOutcome` measurable. Each harness edit names a metric from idea 1 and a target, for example "first-pass APPROVE rate of role `execute` on units that touch `src/auth`". After N later units, `omt harness eval` compares the metric before and after the edit. It reports "improved", "no effect", or "regressed", and suggests `rollback` for a regression. This is the step that prime-agent does not have.
- **Source.** prime-agent asks for "what should improve and how to validate it" (`pa:crates/pa-core/src/refinement/planner.rs:10`) and stores it (`pa:crates/pa-core/src/refinement/mod.rs:298-304`). No code reads it back (grep of `expected_outcome` finds only the refinement module and a test). Rollback is manual (`pa:crates/pa-core/src/refinement/planner.rs:503-547`).
- **Maps to.** The `omt` CLI (`omt harness eval`) over `.omt/ledger.jsonl` and `.omt/harness/history.jsonl`. The `omt-ulw` report step can print the result for any edit with enough samples.
- **Effort.** M after ideas 1 and 2.
- **Blocked by.** Small samples. One project may run too few units for a clear result. The command must print the sample size and refuse a verdict below a threshold.
- **Owner decision.** Yes, as part of idea 2.

### 4. Learned entries inside every brief

- **What.** `omt brief` adds a short `# Lessons` section. It holds the top 3 entries per kind, ranked by term overlap with the task text, scope, and role, each cut to 140 characters and tagged with its id. A child sees nothing of the parent conversation (`omt:docs/design.md:51`), so the brief is the only way a lesson reaches a child.
- **Source.** `pa:crates/pa-core/src/session_engine/harness_digest.rs:36-59` (query terms from the goal and recent text), `pa:crates/pa-core/src/refinement/ranking.rs:139-171` (score with IDF), `pa:crates/pa-core/src/refinement/ranking.rs:195-372` (render with caps), `pa:crates/pa-core/src/refinement/mod.rs:17-19` (3 entries, 140 characters).
- **Maps to.** The `omt` CLI (`omt brief`, rendered brief layout in `omt:docs/spec.md:721-793`). The conductor can also print the digest at step 1 of `omt-ulw` and after a context reset.
- **Effort.** S after idea 2.
- **Blocked by.** The 120,000-character prompt limit (`omt:docs/spec.md:1268`) is far away. The caps keep the section small.
- **Owner decision.** Yes, as part of idea 2.

### 5. When to propose a change

- **What.** Three gates in order. First, a deterministic pre-gate in the CLI. Propose nothing when the run had no `REQUEST_CHANGES`, no `NOT VERIFIED`, no fallback, and no stop code in the ledger. Second, a cheap review-gate child that answers `shouldRefine` with a rationale and rejects "one-off noise, unsupported hypotheses, and transient tool outputs". Third, a cooldown per project. Only the conductor proposes. Children report candidate lessons in an optional line of their result block, and the conductor collects them. Project scope is the default. User scope needs an explicit user request.
- **Source.** `pa:crates/pa-core/src/refinement/planner.rs:12` (review-gate prompt), `pa:crates/pa-core/src/session_engine/auto_refine_trigger.rs:125-258` (gate order and cooldown), `pa:crates/pa-core/src/session_engine/refine.rs:38-84` (defaults and "Prefer an empty edits array"), `pa:crates/pa-core/src/session_engine/engine.rs:331` (root sessions only).
- **Maps to.** A new step in `omt-ulw` after step 11 (report), and a user-invoked `omt-refine` skill for manual runs. Result contracts in `omt:docs/spec.md:804-864` get the optional lesson line.
- **Effort.** S on top of idea 2.
- **Blocked by.** Nothing beyond idea 2. T3 runs the review-gate child.
- **Owner decision.** Yes, as part of idea 2.

### 6. Stall detection in `omt-loop` by workspace fingerprint

- **What.** Each loop tick records a hash of `git status --porcelain`, `git diff HEAD`, and the untracked files in its ledger note. When the condition still fails and the hash matches the last failing tick, the tick counts as a stall. Two stalls in a row stop the loop with a report. This saves ticks on a run that cannot progress.
- **Source.** `pa:crates/pa-core/src/autonomous/gates.rs:144-160` and `pa:crates/pa-core/src/autonomous/gates.rs:240` (skip a gate on an unchanged workspace), `pa:crates/pa-core/src/session_engine/goal_driver/progress.rs:11-17` (3 turns without progress end a goal).
- **Maps to.** The `omt-loop` skill tick prompt, and optionally a CLI helper such as `omt loop fingerprint` that prints the hash. (omt-loop was removed on 2026-10-28; see [the workflow fold design](../design/workflow-fold.md).)
- **Effort.** S.
- **Blocked by.** Nothing. A CLI helper would start `git`, which the spec avoids only for the path functions (`omt:docs/spec.md:339`). The skill can also compute the hash in shell.
- **Owner decision.** No.

### 7. Audit and wrap-up text for long runs

- **What.** Two fixed texts. The audit text goes into the `/goal` objective and the loop tick prompt. It says to check every done condition against the current state with a command, and not to rely on memory of earlier work. The wrap-up text runs at the tick cap. It says to start no new work and to report progress, remaining work, blockers, and one next step.
- **Source.** `pa:crates/pa-core/src/goals.rs:341-350` (audit), `pa:crates/pa-core/src/goals.rs:352-358` (budget wrap-up), `pa:crates/pa-core/src/autonomous/mod.rs:20` ("prove it with host-observable evidence").
- **Maps to.** The `omt-loop` skill (objective template and tick prompt) and `skills/omt/references/results.md`. (omt-loop and its tick prompt were removed on 2026-10-28; see [the workflow fold design](../design/workflow-fold.md).)
- **Effort.** S.
- **Blocked by.** Nothing. omt writes these in its own words, as it does for OmO (`omt:docs/design.md:86`), although prime-agent is MIT.
- **Owner decision.** No.

### 8. A concurrency guard on shared `.omt` state

- **What.** A write to the plan or a future harness store takes a baseline, and the CLI rejects the write when the target changed since that baseline. Today `omt plan mark` rewrites a plan file that several worktree threads can share.
- **Source.** `pa:crates/pa-core/src/refinement/planner.rs:357-372`, `pa:crates/pa-core/src/session_engine/refine.rs:347-359`.
- **Maps to.** The `omt` CLI (`omt plan mark`, `omt harness apply`) and `.omt/` state. All worktrees share one `.omt` in the main checkout (`omt:docs/spec.md:341`).
- **Effort.** S.
- **Blocked by.** Nothing.
- **Owner decision.** No.

### 9. Show what a child will see

- **What.** `omt brief --explain` prints the parts of a brief with their sizes. The parts are template, persona, role notes, lessons, limits, and the routing rung. This makes the harness inspectable, the same way `prime-agent prompt` prints its prompt layers.
- **Source.** `pa:crates/pa-cli/src/command_registry.rs:289-305`, `pa:crates/pa-types/src/slash_commands.rs:55`.
- **Maps to.** The `omt` CLI (`omt brief`).
- **Effort.** S.
- **Blocked by.** Nothing.
- **Owner decision.** No.

### 10. Plan templates from a workflow library

- **What.** Bundled plan templates with fixed unit shapes, such as a per-file review sweep, a builder, and a PR manager. `omt plan new <slug> --from <template>` fills a plan. The conductor still runs the units, so no executor is needed.
- **Source.** `pa:RT/factory.py:4686-4703` (machine library), `pa:RT/machines/review-sweep/MACHINE.md:10-90`, `pa:RT/machines/builder/MACHINE.md:1-100`, `pa:RT/machines/pr-manager/MACHINE.md:1-155`.
- **Maps to.** The `omt` CLI (`omt plan new`) and template files in `skills/omt/references/`.
- **Effort.** M.
- **Blocked by.** A real state-machine executor would need a long-lived process, which omt does not have. Templates avoid that.
- **Owner decision.** Yes for an executor, because a DAG scheduler is out of scope (`omt:docs/design.md:84`). No for static templates.

### 11. Park on a quota reset

- **What.** When a child fails on a rate limit that names a reset time, the conductor schedules one resume tick at reset plus 30 seconds with `schedule_task`, instead of moving to the next rung or stopping. A cap limits parks per run.
- **Source.** `pa:crates/pa-core/src/session_engine/provider_park.rs:12-31`, `pa:crates/pa-core/src/session_engine/provider_park.rs:94-127`.
- **Maps to.** `skills/omt/references/delegation.md` (failure codes) and the T3 `schedule_task` tool.
- **Effort.** S to M.
- **Blocked by.** I did not see whether T3 failure codes carry a reset time. My guess is that they do not today. Without one, the skill can only guess a delay.
- **Owner decision.** No.

### Not recommended

- A single REPL tool with programmatic tool calls. omt uses only the surfaces that T3 exposes, and each provider keeps its own tools, so omt cannot replace them (`omt:docs/design.md:83`).
- Product telemetry to a server. The CLI makes no network calls (`omt:AGENTS.md:31`). Idea 1 gives the same insight locally.
- Direct agent-to-agent messaging and progress notes. T3 has no channel for them. Team mailboxes are out of scope (`omt:docs/design.md:84`).
