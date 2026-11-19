# Self-improvement in prime-agent and deepseek-harness, and a design for omt

Snapshot: prime-agent clone at commit `2ed8356` ("feed the tray context usage off the attach snapshot (#3334)"). deepseek-harness clone at commit `5badb15` ("Merge pull request #5648 from deepseek-harness/worktree/release-dsh-0.2.1-alpha.1"). Both from `git -C <clone> log --oneline -1`. Research date: 2026-10-07. I read both clones as data. I ran no script, build, or installer from them.

> Note, 2026-10-28: the workflow fold changed omt after this research. omt-ulw is now a main-thread build flow. The main thread builds and fixes, one review child and one QA child check, and the main thread waits for children inside its turn. omt-loop, the stall heartbeat, per-unit dispatch, and the task budget (`limits.maxTasksPerRun`) were removed, and omt-review was renamed omt-code-review. Skill step numbers and `omt:` line cites below refer to the skills before that change. See [the workflow fold design](../design/workflow-fold.md).

## Path conventions

- `pa:` is the root of a clone of https://github.com/PrimeIntellect-ai/prime-agent at commit `2ed8356`.
- `dsh:` is the root of a clone of https://github.com/deepseek-ai/deepseek-harness at commit `5badb15`.
- `RF` in a prime-agent path means `crates/pa-core/src/refinement`. `SE` means `crates/pa-core/src/session_engine`. Example: `pa:RF/planner.rs` is `pa:crates/pa-core/src/refinement/planner.rs`.
- A path without a prefix is in this repository (oh-my-t3code).
- I read only English docs in deepseek-harness. I skipped `*.zh.md` and `*.i18n.yaml`.

## 1. Summary

- Neither harness evaluates a self-change before it keeps it. prime-agent applies model-written edits at once and offers a manual rollback. deepseek-harness has no runtime learning at all. Its learning is a human process that turns failures into postmortems, rules, and tests.
- prime-agent keeps one "continual harness" store per session and one per user. It holds prompt notes, memories, skill references, subagent specs, and workflow specs (`pa:RF/mod.rs:10`). An LLM writes the edits from the conversation text. A capped digest feeds the store back to the model as a user message (`pa:SE/harness_digest.rs:1-4`, `pa:RF/mod.rs:17-19`).
- deepseek-harness keeps feedback out of the model on purpose ("Neither kind of feedback reaches the model", `dsh:packages/feedback/README.md:12`). Its strongest ideas are on the evaluation side. These are "a guard only guards if the regression fails it" (`dsh:docs/testing.md:40`), an independent oracle that a refresh never rewrites (`dsh:snapshots/AGENTS.md:15`), and budgets that only ratchet down (`dsh:scripts/verify-doc-budgets.ts:4-6`).
- omt already runs a manual version of the deepseek loop. A watcher thread wrote findings in `.omt/evidence/mira-dogfood-notes.md:65-89`. The plan `.omt/plans/dogfood-1.md` turned them into code, tests, and spec changes. The design below makes that loop cheap, repeatable, and visible to a new user.
- Proposed loop for omt, in five parts:
  1. **Capture.** The ledger records findings by severity and category, candidate fallbacks, owner corrections, and the lessons that each brief carried. The CLI parses the result blocks deterministically.
  2. **Retro.** After each ulw or plan run, `omt retro <slug>` turns the ledger into a signal digest. The conductor drafts at most three candidate lessons, each with cited evidence.
  3. **Gate.** `omt lessons check` lints each candidate (evidence, size, gate-weakening words, duplicates). One cross-family `review` task judges them. The owner accepts or rejects each one. Nothing becomes active without the owner.
  4. **Apply.** `omt brief` adds matched active lessons to worker and planner briefs. Reviewer and tester briefs get none, so the measuring instrument stays fixed.
  5. **Measure.** `omt lessons report` compares the tagged finding rate before and after each lesson. The next retro proposes to retire stale or ineffective lessons. Routing statistics only suggest chain reorders. The owner applies them to a separate learned config layer.

## 2. How each harness improves itself

### 2.1 prime-agent

prime-agent has two loops. Both write the same store. A third path uploads traces and does not change the local agent.

#### The store

- **Shape.** A `HarnessEntry` has an id, kind, title, content, path, scope, reference, arguments, metadata, source, timestamps, and a version (`pa:RF/mod.rs:49-69`). The five kinds are `prompt`, `memory`, `skill`, `subagent`, and `factory` (`pa:RF/mod.rs:10`).
- **Location.** The global store is `<agent_dir>/harness/harness_state.json` (`pa:RF/mod.rs:122-124`). The agent dir defaults to `~/.prime/agent` (`pa:crates/pa-daemon/src/paths.rs:41-53`). The local store is in the session artifact dir (`pa:RF/mod.rs:127-129`). Global refinements also go to an append-only `refinement_history.jsonl` (`pa:RF/mod.rs:14`).
- **No project scope.** The planner prompt allows a project lesson in the global store only when the entry names the project (`pa:RF/planner.rs:10`, the "Scope and persistence policy" text).
- **A skill entry is a pointer.** It must reference an existing Python import and callable (`pa:RF/planner.rs:222-256`). No code generates a skill from it (agent report, `pa:prime-agent-runtime/src/rlm/harness.py:330-337`).
- **Writes.** Writes are atomic with mode 0600 (`pa:RF/mod.rs:274-288`).

#### How the store changes behavior

- **Digest.** At session start, resume, and compaction, the merged store becomes a `[harness-digest]` user message (`pa:SE/harness_digest.rs:1-4`, `pa:SE/messages.rs:16`). The base system prompt never holds harness state (`pa:AGENTS.md:176`).
- **Digest caps.** Entries are ranked by TF-IDF overlap with the goal and the last messages (`pa:RF/ranking.rs:104-175`). Only the top 3 entries per kind are shown, each cut to 140 characters (`pa:RF/mod.rs:17-19`).
- **Refinement notice.** After a refinement, a hidden message lists the applied edits in the live context (`pa:SE/refine.rs:112-130`).
- **Routing.** A factory state that names a subagent entry takes the child prompt from `entry.content` and the model and thinking level from `entry.metadata` (`pa:prime-agent-runtime/src/rlm/factory.py:2072-2082`). So a refinement edit can change model routing.

#### Loop 1. LLM refinement (`/refine`, `refine.run()`, and auto-refine after compaction)

1. **Trigger.** The user types `/refine [--global] [instructions]` or `/refine rollback <id>` (`pa:SE/slash_commands.rs:45-85`). The model calls `await refine.run(...)` from the REPL (`pa:skills/refine/SKILL.md:14-19`). A successful compaction arms an automatic trigger (`pa:crates/pa-daemon/src/auto_compaction.rs:151-153`).
2. **Auto gates.** Auto-refine needs `enabled` and `compact`, respects a 20-minute cooldown, and runs one round at a time (`pa:SE/auto_refine_trigger.rs:143-163`, defaults at `pa:SE/refine.rs:38-47`). The `turn_interval: 25` default is parsed but not used (agent report, `pa:SE/refine.rs:33,42,59`).
3. **Review gate (auto path only).** A separate LLM call decides whether to refine. Its prompt says "Reject one-off noise, unsupported hypotheses, and transient tool outputs" (`pa:RF/planner.rs:12`). An approved auto refinement is always local (`pa:SE/refine.rs:568-572`).
4. **Planning.** The planner sees the store overview, the last 20 history items, and the last 80,000 characters of the conversation (`pa:RF/executor.rs:220`). It must return `summary`, `rationale`, `expectedOutcome`, and `edits[]`. It is told to prefer small evidence-backed edits and to roll back faulty entries (`pa:RF/planner.rs:10`).
5. **Apply.** The host takes a baseline before the LLM call and rejects an edit to an entry that changed meanwhile (`pa:SE/refine.rs:347-359`). It validates each edit structurally (`pa:RF/planner.rs:193-285`), bumps the version, saves, and appends history.
6. **Rollback.** `/refine rollback <id>` replays the stored `before` snapshots in reverse and deletes created entries (`pa:RF/planner.rs:503-512`). The model cannot roll back by id, because `refine.run` passes `rollback_id: None` (`pa:SE/turn_boundary.rs:418-422`).

**What changes.** Prompt notes, memories, skill pointers, subagent specs, and workflow specs.
**Signal.** The conversation text as an LLM reads it. No test result, review verdict, telemetry, or benchmark feeds in.
**Kept how.** At once, after structural validation. `expectedOutcome` is stored (`pa:RF/mod.rs:298-309`) and nothing checks it later (agent report, grep found no reader).

#### Loop 2. Direct writes from the REPL

- The model can call `rlm.harness.create_memory`, `update_skill`, `create_prompt_note`, `create_subagent`, and the delete calls during any turn, with an optional `global_=True` (`pa:crates/pa-core/src/prompts/layers/core.md:90-109`, `pa:prime-agent-runtime/src/rlm/harness.py:562-568`).
- A write saves at once (`pa:prime-agent-runtime/src/rlm/harness.py:672-675`). It stores no `before` snapshot and no history entry, so `/refine rollback` cannot undo it (agent report).
- The core prompt tells the model when to write. Examples are "after a repeated failure", "a reusable tactic emerges", and "a user corrects behavior that should persist" (`pa:RF/ranking.rs:220`).

#### Trace upload (not a local loop)

`/traces` uploads session files to a Prime Intellect endpoint (`pa:crates/pa-core/src/agent_traces/upload.rs:141-147`). It is off by default (`pa:crates/pa-cli/src/client_traces.rs:256-268`). The onboarding text says sharing "helps us train better open-source models" (`pa:crates/pa-tui/src/onboarding.rs:15`). Any training happens outside the repository.

#### Not present in prime-agent

No weight training, no prompt optimizer, no A/B test, no held-out set, no benchmark score, no use of test results or review verdicts as a signal, no decay or expiry of entries, and no human approval before an edit is kept (agent report, from greps over the clone).

### 2.2 deepseek-harness

deepseek-harness has no runtime loop that learns. Its improvement loop runs through people, pull requests, and CI.

#### Runtime pieces that look like learning and are not

- **Instruction files.** The harness reads `AGENTS.md`, `CLAUDE.md`, their `.local.md` variants, and `~/.dsh/AGENTS.md` into a baseline message (`dsh:packages/context/agent-instructions/README.md:12`, `:32`). A 65,536-byte budget drops broader files first (`:28`, `:72`). The harness never writes these files (agent report).
- **Feedback.** `/feedback <text>` and per-message ratings are log-only events (`dsh:packages/feedback/command-feedback/src/index.ts:58-64`, `dsh:packages/feedback/message-feedback/src/types.ts:53-58`). "Neither kind of feedback reaches the model" (`dsh:packages/feedback/README.md:12`). The OTel backend uploads a session only when that session has explicit feedback (`dsh:packages/session/session-telemetry-otel/src/index.ts:33-53`). No code in the repository reads it back.
- **Goal rounds.** An active goal becomes repeated `<goal_round>` prompts that ask the agent to gather evidence and mark the goal complete (`dsh:packages/goal/goal-round-driver/src/prompt.ts:12-25`). Only a direct human turn or the exact current goal round may mark it complete or blocked (`dsh:packages/goal/tool-goal/src/authority.ts:106-118`). Completion is still self-attested.
- **Ralph loop.** Fresh children run across rounds, and "The workspace is the only cross-round long-term memory" (`dsh:packages/workflow/tool-ralph/README.md:163`).
- **Past-session search.** It is read-only, limited to the same cwd, and its results are marked untrusted (`dsh:packages/context/session-reference/README.md:12`, `:36`).

#### Development loop B1. Postmortems become guardrails

- **When.** A bug is subtle, systemic, and costly to rediscover (`dsh:docs/postmortem/README.md:9`).
- **Format.** Executive summary, then Summary, Impact, Timeline, Root cause, Guardrails added, and Lessons (`dsh:docs/postmortem/README.md:11`, `dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:7-53`). The focus is "why our process let it through" (`dsh:docs/postmortem/README.md:5`).
- **Placement rule.** "bugs → postmortems; rationale → Agent Notes; ... standing orders → root `AGENTS.md`" (`dsh:docs/AGENTS.md:35`).
- **Example 0001.** The ACP server crashed on a real editor connection although unit tests passed (`dsh:docs/postmortem/0001-acp-default-export-drops-inject.md:13`). It produced the rule "A guard only guards if the regression fails it" (`dsh:docs/testing.md:40`) and a line in the review skill (`dsh:.agents/skills/dsh-code-review/SKILL.md:42`).
- **Example 0002.** A snapshot refresh accepted a broken tool stack as the new expected output. "The snapshot suite passed because both outputs matched the refreshed fixtures; it proved deterministic replay of the regression" (`dsh:docs/postmortem/0002-js-expression-disabled-filesystem-tools.md:20`). The lesson is "A snapshot refresh is fixture production, not correctness review" (`:46`). The guardrails reject `UNKNOWN_TOOL` results before they become fixtures (`:41`).
- **Example 0003.** An agent checked a replacement server instead of the user's page. The evidence was a persisted session log with sequence numbers (`dsh:docs/postmortem/0003-web-agent-gui-feedback-loop.md:17`). The fix added a model-visible prompt section with the canonical URL (`:42`). This is the one case where a run changed the agent's prompt, and a person made the change.

**Kept how.** Human PR review and CI. There is no automatic acceptance and no automatic rollback.

#### Development loop B2. Recorded-session snapshots

- Every non-trivial model-visible or user-visible change updates a keyless recorded-session scenario (`dsh:AGENTS.md:155`).
- Replay writes nothing. Recording and refresh are explicit, and "every resulting ... diff is reviewed before commit" (`dsh:snapshots/AGENTS.md:17`).
- "Record and refresh do not rewrite this independent oracle", the committed `workspace.expected/` tree (`dsh:snapshots/AGENTS.md:15`).

#### Development loop B3. Performance benchmarks

- `dsh:BENCHMARK.md:1-3` only points to external benchmarks through the Python SDK. No agent-quality task set, score, or LLM judge is in the repository (agent report). The one task-success check is a key-gated smoke test that fixes `add.js` and checks the fix outside the agent (`dsh:apps/cli/tests/profiles/headless/tests/coding-task.e2e.ts:11-15`).
- Perf inputs are synthetic. "Never use recorded Sessions, user material, ambient repositories, or network services" (`dsh:benchmarks/AGENTS.md:9`).
- Budgets are reviewed source constants that environment variables cannot override (`dsh:benchmarks/AGENTS.md:12`). Each case has a negative control (agent report, `dsh:benchmarks/session-open/session-open.bench.ts:294-299`). "Do not widen a budget or select a lucky run to hide a regression" (`dsh:.agents/skills/dsh-speed-up-perf/SKILL.md:53`).

#### Development loop B4. Ratchets

- Word budgets cap standing docs, for example 1,960 words for `AGENTS.md` (`dsh:scripts/doc-budgets.manifest.json:2`). "Ceilings ratchet down with at least 5% headroom; raising one requires the justification" (`dsh:scripts/verify-doc-budgets.ts:4-6`).
- A baseline file counts `as unknown` casts per file, and the check makes you prune retired entries (agent report, `dsh:scripts/verify-no-unknown-casts.ts:147-169`).

#### Development loop B5. Agent Notes with a lifecycle

- A note moves through `proposed/`, `implemented/`, `rejected/`, and `archived/` (`dsh:.agents/notes/README.md:11-14`).
- Archival is semantic. "Judge every note semantically; word count and age are discovery aids, never archive criteria" (`dsh:.agents/skills/dsh-archive-agent-notes/SKILL.md:8`).

### 2.3 Comparison

| Question | prime-agent | deepseek-harness |
| --- | --- | --- |
| What changes | Prompt notes, memories, skill pointers, subagent specs, workflow specs, and through them model routing | Code, tests, `AGENTS.md` rules, skills, prompt sections, budgets |
| Signal | Conversation text read by an LLM | Real failures, session logs, CI results, human review |
| Store | JSON per session and per user in `~/.prime/agent/harness` | Git (postmortems, notes, rules, fixtures) |
| Who proposes | The user, the model, or a compaction trigger | A person, often with an agent's help |
| Evaluation before keeping | None. Structural validation only | PR review, CI gates, negative controls, independent oracles |
| Rollback | Manual by refinement id, Loop 1 only | Git revert |
| Approval | None. The user sees an outcome message after the fact | Human PR approval |

## 3. Safety of the loops

### 3.1 prime-agent

Guards that exist:

- **Immutable base.** An edit to `base_system_prompt` fails with "base system prompt is not editable" (`pa:RF/planner.rs:210-215`). Learned state is a separate user message, not a rewrite of the system prompt (`pa:AGENTS.md:176`).
- **Small digest.** Three entries per kind and 140 characters each limit how much learned text reaches the model (`pa:RF/mod.rs:17-19`).
- **Stale-baseline fence.** An edit to an entry that changed during planning is rejected (`pa:SE/refine.rs:347-359`).
- **Noise filter.** The auto path asks a second LLM call to reject one-off noise (`pa:RF/planner.rs:12`) and keeps auto edits local (`pa:SE/refine.rs:568-572`).
- **Depth gate.** The `refine.*` handlers exist only at depth 0 (`pa:SE/engine.rs:331-333`).
- **Rollback by snapshot.** Loop 1 stores `before` values and can replay them (`pa:RF/planner.rs:503-512`).

Gaps:

- No evaluation before or after a change. `expectedOutcome` has no reader.
- No human approval. The model can ask for global scope itself (`pa:SE/turn_boundary.rs:333-360`).
- No cap on entry count or content size, and the event list in the state file grows without bound (agent report, `pa:RF/planner.rs:483`).
- Loop 2 writes save at once with no history, and I found no depth gate on the Python module (agent report). A subagent may write the global store (inferred from the missing gate).
- Two code paths may disagree on the global directory. Three daemon paths pass `agent_dir` as the global harness dir (`pa:crates/pa-daemon/src/compact_autorefine.rs:75`), while the digest reads `agent_dir/harness` (`pa:SE/engine.rs:491`, `pa:RF/mod.rs:122-124`). I did not run it. If the reading is right, a daemon global refinement writes a file the digest never reads. The lesson for omt is one path helper for every learned file.

Reward hacking does not apply in the usual sense, because no metric exists to game. The real risk is drift. A model writes notes that sound right, and nothing measures them.

### 3.2 deepseek-harness

Guards that exist:

- **The learner never edits its own evaluator.** Recording does not rewrite `workspace.expected/` (`dsh:snapshots/AGENTS.md:15`). Model prose does not count as proof of an effect (same line).
- **A guard must fail on the regression.** "prove it: introduce the regression, watch red, revert" (`dsh:docs/testing.md:40`).
- **Refreshed baselines are not trusted.** Postmortem 0002 shows a refresh that accepted a regression as the new truth (`dsh:docs/postmortem/0002-js-expression-disabled-filesystem-tools.md:20`). The fix adds semantic checks that do not depend on the expected output (`:46`).
- **Budgets ratchet and cannot be widened quietly.** Doc budgets need a justification to go up (`dsh:scripts/verify-doc-budgets.ts:4-6`). Perf budgets are source constants (`dsh:benchmarks/AGENTS.md:12`).
- **Feedback does not steer the model.** It is log-only (`dsh:packages/feedback/README.md:12`). This removes a whole class of manipulation, and it also removes runtime learning.
- **Semantic archival.** Old decisions are archived by future value, not by age (`dsh:.agents/skills/dsh-archive-agent-notes/SKILL.md:8`).

Gaps:

- Every step needs a person. Nothing improves between releases.
- Goal completion is self-attested by the model (`dsh:packages/goal/goal-round-driver/src/prompt.ts:12-25`).

### 3.3 What omt takes from each

| Idea | Source | Use in omt |
| --- | --- | --- |
| Learned state is separate from the base prompt | `pa:RF/planner.rs:210-215` | Bundled skills and personas stay immutable. Lessons go into a separate brief section. |
| Small caps on injected learned text | `pa:RF/mod.rs:17-19` | At most 5 lessons per brief, 240 characters each |
| Stale-baseline fence | `pa:SE/refine.rs:347-359` | `omt lessons accept` refuses when the file hash changed since `check` |
| Noise filter before writing | `pa:RF/planner.rs:12` | A deterministic evidence rule plus a cross-family review of candidates |
| Rollback by id | `pa:RF/planner.rs:503-512` | `omt lessons retire` and `omt routes reset`, plus git |
| Independent oracle that the learner cannot rewrite | `dsh:snapshots/AGENTS.md:15` | Reviewer, tester, and oracle briefs get no lessons |
| A guard must fail on the regression | `dsh:docs/testing.md:40` | Each lesson names the finding tags it should reduce, and the report checks them |
| Refreshed baselines lie | `dsh:docs/postmortem/0002-js-expression-disabled-filesystem-tools.md:20` | A retro never changes the metrics that judge it |
| Ratcheted budgets | `dsh:scripts/verify-doc-budgets.ts:4-6` | A hard cap on active lessons. Raising it is an owner decision in config |
| Postmortem format and placement rule | `dsh:docs/postmortem/README.md:11`, `dsh:docs/AGENTS.md:35` | The retro report format, and the rule "a lesson that a test can enforce becomes a test" |
| Proposed, implemented, rejected, archived | `dsh:.agents/notes/README.md:11-14` | Lesson states proposed, active, retired |

omt avoids model writes that apply without approval (prime-agent Loop 2), unbounded growth, a global scope that the model can choose, and a metric that no one reads.

## 4. Proposed design for omt

### 4.1 Constraints and how the design meets them

| Constraint | How the design meets it |
| --- | --- |
| Zero runtime dependencies | New code is parsing, counting, and file writes with `node:` modules |
| No daemon or server | Retros run inside the conductor's turn or in a user-scheduled T3 task |
| No network calls from the CLI | The CLI reads `.omt/` files only. Model work runs as T3 children |
| T3 owns the agent loop | The cross-family check is a normal `delegate_task` review child |
| State in the repository or in the user config dir | Project files under `.omt/`, user files under `configDir()` (`src/paths.ts`, spec section 4) |
| Skills carry judgment, the CLI does deterministic work | The CLI parses, counts, lints, selects, and renders. The skill drafts and judges lessons |

### 4.2 The existing loop that this formalizes

omt already improved itself once by hand:

1. A watcher thread used a 60-second `schedule_task` to follow a real run and wrote findings (`.omt/evidence/mira-dogfood-notes.md:11`, `:65-89`).
2. The owner turned those findings into the plan `.omt/plans/dogfood-1.md`, whose objective cites the notes (`.omt/plans/dogfood-1.md:7`).
3. Two plan reviewers of different families found 15 blockers after a merge (`.omt/plans/dogfood-1.md:88-103`). Four of them (B1, B11, B12, B15) have one cause. A unit changed a contract and left a test or a spec section out of its scope.
4. Round 2 and round 3 found an evidence-path problem twice (R2-1 and its regression R3-1, `.omt/plans/dogfood-1.md:105`, `:107`).
5. Unit U1 needed three rounds and reached `deep` (`.omt/ledger.jsonl` lines 22 to 30).

Today none of this is captured in a form that changes the next run. The ledger has the verdicts but no findings. The blockers live only in free text in the plan log. The next plan in this repository starts with no memory of the repeated scope gaps.

### 4.3 Signal capture

#### What the ledger records today

`LedgerEntry` holds `ts`, `role`, `status`, `plan`, `unit`, `round`, `attempt`, `taskId`, `clientRequestId`, `provider`, `model`, `verdict`, and `note` (`src/types.ts`, spec section 3). From these, the CLI can already derive the following:

- Rounds per unit and the verdict sequence.
- Duration per task, from the dispatch `ts` to the terminal `ts`.
- Rejected claims (`status: rejected`).
- The provider and model of each dispatch, when the skill recorded them. The first `ulw-negation` dispatches have no provider (`.omt/ledger.jsonl` lines 1 and 3). The retro must report such data gaps.

What is missing:

- Findings by severity and by category.
- Test check counts and failures.
- Candidate fallbacks. A failed `delegate_task` call returns no task id, so no entry exists.
- Owner corrections and overrides, such as "start the units after round 3" (`.omt/plans/dogfood-1.md:108`).
- The lessons that each brief carried. Without this, no lesson can be measured.
- The raw result block. Without it, a retro cannot cite a finding's text.

#### Changes

1. **Review contract with a category.** `skills/omt/references/results/review.md` changes its finding line to `- [P0|P1|P2|P3] [<tag>] <path>:<line> <problem>. Fix: <fix>.`. The tag vocabulary is fixed: `scope`, `spec`, `test`, `logic`, `deps`, `regression`, `path`, `security`, `perf`, `docs`, `style`, `other`. The parser accepts a line without a tag and counts it as `other`, so old reviewers still parse.
2. **Result files.** On wake, the conductor saves each result block to `<evidence>/<slug>-<unit>-<role>-r<round>-a<attempt>.txt`. It uses the directory from `omt paths --evidence`.
3. **`omt ledger add --result-file <file>`.** The CLI parses the block. It sets `verdict` from the first label. For review blocks, it counts findings by severity and by tag. For test blocks, it counts `CHECKS` lines by exit code and counts `FAILURES` lines. It stores the evidence path. The parse is deterministic and has unit tests.
4. **New status `noted`.** A `noted` entry is neither a dispatch nor terminal. It closes nothing, and `stats` ignores it. It carries a `kind`.
   - `kind: fallback` with `code` and `candidate`. The skill records it when a T3 failure code moves the dispatch to the next candidate.
   - `kind: correction` with a `note` of at most 300 characters. The skill records it when the owner overrides a decision or corrects the conductor during a run, with the owner's words verbatim.
   - `kind: learning` for lesson accept, reject, and retire events, written by the CLI for the audit trail.
5. **`candidate` and `lessons` on dispatches.** `omt brief --json` adds two top-level fields next to `fallbacks`. `candidate` is the 1-based configured candidate index of the target. `lessons` is the list of lesson ids in the brief. The skill copies both into `omt ledger add --candidate <n> --lessons <ids>`.

`LedgerEntry` gains these optional fields. All old lines stay valid.

```ts
export type LedgerStatus = "dispatched" | "completed" | "failed" | "cancelled" | "interrupted" | "verified" | "rejected" | "noted";
export type NoteKind = "fallback" | "correction" | "learning";

export interface LedgerEntry {
  // existing fields unchanged
  kind?: NoteKind; // only with status "noted"
  code?: string; // T3 error code, with kind "fallback"
  candidate?: number; // 1-based configured candidate index of the target
  lessons?: string[]; // lesson ids in the brief, on dispatches
  findings?: { P0: number; P1: number; P2: number; P3: number }; // review results
  tags?: Record<string, number>; // review findings by tag
  checks?: { pass: number; fail: number }; // test results
  result?: string; // absolute path of the saved result block
}
```

Cost and time. Duration comes from ledger timestamps. I found no token or cost field in the `task_status` result that omt uses today (guess). The design leaves cost out of version 1.

### 4.4 Learning artifacts

| Artifact | Scope | Path | Format | Written by | Read by |
| --- | --- | --- | --- | --- | --- |
| Project lessons | project | `.omt/lessons.md` | Markdown with checkbox grammar | `omt lessons` only | `omt brief`, `omt-plan` step 3, `omt lessons report` |
| User lessons | user | `<configDir>/lessons.md` | Same format, ids `G<n>` | `omt lessons promote` | `omt brief` |
| Learned routing | project | `.omt/learned.jsonc` | A config layer that holds only `roles.<name>.chain` | `omt routes apply` | `loadConfig` |
| Retro reports | project | `<evidence>/<slug>-retro.md` | Markdown, postmortem-like sections | the conductor | the owner, the next retro |
| Skill proposals | project | `.omt/proposals/P<n>-<slug>.md` | Markdown with a unified diff | `omt-retro` skill | the owner, the omt maintainer |

#### Project lessons file

The file lives in the shared `.omt` of the main checkout, like the plans (spec section 4). Its grammar reuses the plan checkbox idea, so people can read it and the CLI can parse it. `[ ]` is proposed, `[x]` is active, `[~]` is retired.

```markdown
# omt lessons

<!-- omt-lessons v1 -->

Edit this file with `omt lessons`. The owner accepts each lesson. `omt brief` adds matching active lessons to worker and planner briefs.

- [x] L1. When a unit changes a shared type, a CLI command, or a skill rule, put the matching `docs/spec.md` section in the unit's scope.
  - Roles: plan, execute, deep
  - Paths: src/types.ts, src/commands/**, skills/**
  - Tags: spec, scope
  - Evidence: dogfood-1/plan-review/r1 B11; dogfood-1/plan-review/r1 B12; dogfood-1/plan-review/r1 B15
  - Since: 2026-10-07
- [ ] L2. When a unit adds or removes a default role, put every test that counts the roles in the unit's scope.
  - Roles: plan
  - Paths: src/config/defaults.ts
  - Tags: scope, test
  - Evidence: dogfood-1/plan-review/r1 B1
- [~] L3. A skill line that names an evidence file uses the directory that `omt paths --evidence` prints.
  - Roles: plan, execute, writing
  - Tags: path, regression
  - Evidence: dogfood-1/plan-review/r2 R2-1; dogfood-1/plan-review/r3 R3-1
  - Retired: 2026-10-07 a test now enforces it (`test/skills.test.ts`)
```

Rules for the file:

- Item line regex `^- \[( |x|X|~)\] (L|G)(\d+)\. (.*)$`. Field lines are `  - <Name>: <value>`. `Roles` and `Tags` are required. `Paths` holds globs relative to the project root and is optional.
- Lesson text is one sentence of at most 240 characters. It says what to do, not what went wrong.
- An evidence reference is `<plan>/<role>/r<round> <finding id>`, `<plan>/<unit>/<role>/r<round>`, or `<plan>/correction <ts>`. `omt lessons check` resolves each one against the ledger or the plan log.
- At most 15 active project lessons by default (`learning.maxActive` in config, 1 to 40). This works like the deepseek doc budget. Raising it is a deliberate config change.
- L3 in the example shows the placement rule from `dsh:docs/AGENTS.md:35`. A lesson that a test can enforce becomes a test, and the lesson retires.

#### How a lesson reaches a child

`omt brief` adds a `# Lessons` section after `# Context`. The section holds only for roles whose `result` is `work` or `plan`.

```text
# Lessons

Lessons from earlier runs in this project. Follow them unless the task says otherwise.

- L1. When a unit changes a shared type, a CLI command, or a skill rule, put the matching `docs/spec.md` section in the unit's scope.
```

Selection is deterministic:

1. Take active lessons whose `Roles` list holds the brief's role.
2. Keep a lesson without `Paths`. Keep a lesson with `Paths` only when a `--scope` path matches one of its globs.
3. Put path-matched lessons first, then sort by id. Keep at most 5 and at most 1,200 characters in total.
4. Write the ids into the brief header as ` lessons=L1,L4` and into the `--json` output as `lessons`.

Reviewer, tester, and oracle briefs never get lessons. Their findings are the metric that judges the lessons, so they stay a fixed instrument (the `dsh:snapshots/AGENTS.md:15` rule). The `omt-plan` conductor writes plans itself, so its step 3 reads `omt lessons list --active --role plan` and applies them.

A lesson is additive. The existing `.omt/roles/<role>.md` override replaces a whole persona (spec section 9.1) and so loses upstream fixes. Lessons do not have that cost.

#### Learned routing layer

- `.omt/learned.jsonc` is a fourth config layer. The proposed order is defaults, learned, user, project. A person's explicit config always wins (owner decision 5).
- It may only reorder candidates that exist in the effective chain. It never adds a model, changes an effort, or touches a role with `crossFamily: true`, because `--against` orders those per dispatch.
- Each entry carries a comment with the stats that justified it and the date.
- `omt roles` prints a note `learned: chain reordered on <date>` for an affected role.

#### Skill proposals

- A retro never edits an installed skill. The install manifest stores a SHA-256 per installed file (`src/install/manifest.ts:22`), so a local edit would show as a modified managed skill and fight the next install.
- `omt-retro` writes a proposal file instead, with the target file, the signal, the evidence, and a unified diff. In the omt repository itself, a proposal becomes a normal `omt-plan` input, as the Mira notes did.

### 4.5 The improvement step

#### Who proposes

| Trigger | When | Cost |
| --- | --- | --- |
| `omt-ulw` step 12 Retro | After the report of every run. LIGHT runs do only the deterministic part | 0 to 1 extra child |
| `omt-plan` step 6 Retro | After the review rounds end | 0 to 1 extra child |
| `omt-retro` skill (user-invoked) | Any time, over one plan or `--since <days>` | 1 child per batch |
| Scheduled retro | Only when the user asks. A weekly `schedule_task` bound to one thread runs `omt-retro --since 7d` | 1 child per week |

The scheduled retro uses the existing `omt-loop` pattern for `schedule_task` (`skills/omt-loop/SKILL.md:32-47`). (omt-loop was removed on 2026-10-28; see [the workflow fold design](../design/workflow-fold.md).) Each firing only proposes. It never accepts.

#### The retro procedure (skill text, judgment)

1. Run `omt retro <slug> --json`. Read the digest.
2. Read the result files of findings with a repeated tag, and the owner corrections.
3. Draft at most 3 candidate lessons. Each one must meet the evidence rule below. Prefer "nothing to learn" over a weak lesson.
4. For each candidate, ask whether a test or a CLI check could enforce it. If yes, write a skill or code proposal instead of a lesson.
5. Run `omt lessons add` for each candidate, then `omt lessons check`.
6. HEAVY runs. Dispatch one `review` task with `--against <your provider>` over all candidates (section "Cross-family check" below).
7. Show the owner the candidates that passed, in one message, with the evidence. Run `omt lessons accept` or `omt lessons reject` on the answer.
8. Write `<evidence>/<slug>-retro.md` with the sections Signals, Candidates, Decisions, Data gaps.

**Done when.** Every candidate is accepted, rejected, or left proposed with the owner's question open, and the retro file exists.

#### Evaluation before a lesson becomes active

1. **Deterministic gate (`omt lessons check`).**
   - The format is valid. Roles exist in the effective config. Tags are in the vocabulary.
   - Every evidence reference resolves.
   - Evidence weight. Two occurrences in different units or plans, or one P0 or P1 finding, or one owner correction.
   - Gate words. The text must not match a deny list (`skip`, `without review`, `no test`, `approve`, `ignore`, `lower`, `disable`, `--force`, `commit`, `push`, `maxReviewRounds`, `limits`). A lesson may add a check. It may not remove one.
   - Injection hygiene. No `<!--`, no heading lines, no fenced blocks, and no text that `omt hook` treats as a brief marker (`src/hooks/userPromptSubmit.ts:57`).
   - Duplicates. A token overlap of 0.6 or more with an active lesson is flagged as a duplicate, with a merge hint.
   - Budget. Accepting must not exceed `learning.maxActive`.
2. **Cross-family check (skill, one child).** A `review` child from the family other than the conductor's gets the candidates, their evidence files, and `docs/spec.md` and `AGENTS.md` paths. It answers per candidate.
   - Does the cited evidence support it?
   - Would it have prevented the cited findings? It reads the round-1 plan snapshot or the unit diff to decide.
   - Is it general beyond one unit?
   - Does it conflict with the spec, `AGENTS.md`, or another lesson?
   - Does it weaken a gate?
   The child returns a normal review block. A candidate with a P0 to P2 finding goes back to proposed with the finding.
3. **Replay (optional, `omt retro --replay`).** For plan lessons only. omt-plan saves the round-1 plan as `<evidence>/<slug>-plan-r1.md` before it fixes blockers. A `plan` child revises that snapshot with only the candidate lesson added. A fresh `plan-review` child then checks whether the cited blockers come back. This costs two children per candidate, so it is opt-in (owner decision 7).
4. **Owner approval.** Required for every lesson in version 1. `omt lessons accept` refuses when the file changed since the last `check` (the prime-agent baseline fence).

#### Measure after activation

`omt lessons report` computes, for each active lesson:

- **Exposures.** The dispatches whose `lessons` field holds the id.
- **Tagged rate after.** Review findings with the lesson's tags per exposed unit.
- **Tagged rate before.** The same rate over the last 10 units before `Since` that match the lesson's roles and paths.
- **Flags.**
  - `stale` when no dispatch in the last 10 plans matched it.
  - `no effect` when it has 6 or more exposures and the rate did not drop.
  - `dead path` when its `Paths` match no file.

The next retro proposes to retire flagged lessons. Retirement needs the owner too. The metric comes from reviewers who never see lessons, and from test failures and rejected claims, so a lesson cannot lower the metric by telling reviewers to report less.

#### Routing suggestions

`omt routes suggest` reads the ledger for the project and computes per role and target:

- `n`. Completed dispatches.
- `pass@1`. The share of units whose first review returned `APPROVE`, for work roles. The share of `VERIFIED` for `test`. The share of non-rejected answers for research roles.
- Mean rounds to pass, fallback rate by T3 code, rejected-claim rate, and median minutes.

It proposes a reorder only when all of these hold:

- Both candidates have at least `--min-samples` (default 8) completed dispatches of that role in the last 60 days.
- The 80% Wilson intervals of `pass@1` do not overlap.
- The role is not cross-family.

A second rule is safer and fires earlier. When candidate 1 of a role failed with `provider_unavailable` or `model_unavailable` on 3 of the last 5 dispatches, it suggests moving that candidate down, because each failure costs one wasted call.

Data for candidate 2 arrives only through fallbacks, so the comparison is biased (inferred). Version 1 does no exploration. A sampled exploration rate is owner decision 6.

`omt routes apply <role> --yes` writes the reorder to `.omt/learned.jsonc` and prints the old and new chain. `omt routes reset [<role>]` removes it.

### 4.6 First-run experience

The goal is honest evidence that the tool learns. It must not fake a lesson when the run was clean.

| Time | What the user sees |
| --- | --- |
| Install | `omt init` creates `.omt/lessons.md` with the header and no lessons. `omt doctor` prints `learning: 0 active lessons, 0 runs in the ledger`. |
| First ulw run, end of report | A block "What omt learned from this run". It lists the signals in numbers (for example "U1 needed 3 rounds. 4 of 6 review findings were tagged scope. 1 owner correction."). Then 0 to 3 candidate lessons with evidence, and one question to accept, edit, or reject each. A clean run says "No repeated problem in this run. Nothing to learn yet." |
| Second run, banner | `omt ultrawork: plan, delegate, review, test, verify. Lessons active: 1 (L1).` |
| Second run, report | "L1 was in 2 briefs. Findings tagged scope: 0 in this run, 4 in the last run." |
| After about five runs | `omt stats` shows the routing table, with "need 8 samples" on most cells. `omt lessons report` shows exposures and flags. |
| A project with history | `omt retro --since 30d` works on an existing ledger at once. In this repository it would find the dogfood-1 scope and spec blockers. |

### 4.7 CLI commands

| Command | Shape | Notes |
| --- | --- | --- |
| `ledger add` | new flags `--result-file <file\|->`, `--kind <fallback\|correction\|learning>`, `--code <code>`, `--candidate <n>`, `--lessons <id,id>` | `--status noted` requires `--kind` |
| `brief` | `--json` output gains `candidate` and `lessons`. `--no-lessons` leaves the section out | Text output gains the `# Lessons` section |
| `retro` | `omt retro [<slug>] [--since <days>] [--json] [--replay]` | Digest only. Writes nothing. `--replay` prints the replay briefs to run |
| `lessons` | `list [--state proposed\|active\|retired] [--role <r>] [--json]`, `add --text <t> --roles <list> --tags <list> --evidence <ref>... [--paths <glob>...]`, `check [<id>...] [--json]`, `accept <id>...`, `reject <id> --reason <t>`, `retire <id> --reason <t>`, `promote <id>`, `report [--json]` | Every write is atomic and appends a `noted` `learning` entry to the ledger |
| `stats` | `omt stats [--plan <slug>] [--since <days>] [--by role\|target\|tag] [--json]` | Read-only |
| `routes` | `suggest [--min-samples <n>] [--json]`, `apply <role> --yes`, `reset [<role>]` | Writes only `.omt/learned.jsonc` |
| `paths` | adds `lessons` and `learned` keys and flags | Spec section 5.8 |

`omt retro --json` output:

```json
{
  "version": 1,
  "plans": ["dogfood-1"],
  "units": [
    {
      "plan": "dogfood-1",
      "unit": "U1",
      "rounds": 3,
      "verdicts": ["REQUEST_CHANGES", "REQUEST_CHANGES"],
      "workers": ["claudeAgent/claude-opus-5-5"],
      "rejected": 0,
      "fallbacks": [],
      "minutes": 13.1,
      "findings": { "P0": 0, "P1": 2, "P2": 1, "P3": 0 },
      "tags": { "scope": 2, "path": 1 }
    }
  ],
  "planReview": { "plan": "dogfood-1", "rounds": 3, "approved": false, "findings": { "P0": 0, "P1": 9, "P2": 7, "P3": 0 }, "tags": { "scope": 6, "spec": 4 } },
  "corrections": [{ "plan": "dogfood-1", "ts": "2026-10-07T09:31:00Z", "note": "start the units after round 3" }],
  "repeats": [{ "tag": "spec", "count": 4, "refs": ["dogfood-1/plan-review/r1 B11", "dogfood-1/plan-review/r1 B12"] }],
  "lessonsUsed": [{ "id": "L1", "exposures": 2, "tagged": 0 }],
  "dataGaps": ["2 dispatches in plan ulw-negation have no provider", "12 review results have no result file"]
}
```

The finding counts, the tags, and the correction timestamp in this example are illustrative (guess). Today's ledger has no findings, which is the gap that section 4.3 closes. The `minutes` value for U1 comes from ledger lines 22 to 30 (09:31:41 to 09:44:48).

New config keys (spec section 6), with the layer validation rules of section 6.2:

```jsonc
{
  "learning": {
    "enabled": true,        // false turns off lesson injection and the retro step
    "maxActive": 15,        // 1 to 40
    "maxPerBrief": 5,       // 0 to 10
    "minSamples": 8         // 3 to 100, for routes suggest
  }
}
```

New path helpers in `src/paths.ts`: `lessonsPath(root)`, `userLessonsPath(env, homedir)`, `learnedConfigPath(root)`, `proposalsDir(root)`. Every learned file goes through these helpers, which avoids the prime-agent directory mismatch in section 3.1.

### 4.8 Skill changes

- **New reference `skills/omt/references/learning.md`.** The tag vocabulary, the evidence rule, how to write a lesson (one sentence, what to do, roles, paths), the "test beats lesson" rule, and the retro procedure.
- **`omt-ulw`.**
  - Step 2 prints the active lesson count in the banner line.
  - Step 5 copies `candidate` and `lessons` into `omt ledger add`.
  - Step 6 saves each result block and records it with `--result-file`.
  - On a failure code, it records `--status noted --kind fallback`.
  - When the owner overrides or corrects, it records `--kind correction`.
  - New step 12 Retro after the report, as in section 4.5.
- **`omt-plan`.**
  - Step 3 reads the active plan lessons and applies them.
  - Step 4 saves the round-1 plan snapshot before it fixes blockers, and records plan-review results with `--result-file`.
  - New step 6 Retro.
- **`omt-code-review`.** Reviewer personas and the merged findings use the tagged finding line.
- **Personas.** `roles/review.md`, `roles/oracle.md`, and `roles/plan-review.md` add one line on the tag.
- **New skill `omt-retro` (user-invoked).** Cross-plan retros, routing suggestions, retirement proposals, skill proposals, and the opt-in weekly schedule.
- **Router `omt`.** Lists `omt-retro`.

### 4.9 Build order

1. Ledger fields, `noted` status, `--result-file` parsing, the tagged review contract, and `omt stats`. No behavior change yet. This alone gives the user numbers after the first run.
2. `omt retro` digest and the retro step in `omt-ulw` and `omt-plan`, with proposals shown but no lesson file yet.
3. `.omt/lessons.md`, `omt lessons`, brief injection, and `omt lessons report`.
4. The cross-family check of candidates and the optional replay.
5. `omt routes`, the learned config layer, and `omt-retro` with the scheduled option.
6. User-scope lessons and `promote`.

Each phase changes `docs/spec.md` in the same change, as `AGENTS.md` requires.

## 5. Owner decisions

1. **Lift "memory" out of scope.** `docs/design.md:84` excludes memory. The design adds a narrow form named lessons. They are owner-approved, additive, capped, and measured. The options are (a) accept lessons as designed, (b) accept only phases 1 and 2 (signals and retro, no injection), (c) keep memory out. Recommendation: (a), with a new decision in `docs/design.md` that states the limits.
2. **Commit `.omt/lessons.md` to git or keep it local.** The ledger and evidence are git-ignored today (`.omt/.gitignore`). Committed lessons reach the whole team and get PR review. Local lessons stay private. I recommend a commit. `omt init` leaves the file out of `.omt/.gitignore`.
3. **Approval policy.** The options are (a) the owner accepts every lesson, (b) automatic acceptance after a clean deterministic gate and a cross-family `APPROVE`, (c) automatic acceptance only for local lessons. Recommendation: (a) for version 1. Revisit after `omt lessons report` shows how often the owner rejects candidates.
4. **Reviewer briefs.** Should reviewers see lessons? I recommend no lessons for them. They are the measuring instrument.
5. **Learned routing.** Allow the learned layer at all, and where in the precedence. I recommend that you allow it, put it below user and project config, and keep it away from cross-family roles.
6. **Routing exploration.** Should omt send a share of dispatches to candidate 2 to get unbiased data? The options are none, or 1 in 10 for non-cross-family roles. I recommend none in version 1. It spends the user's budget without a request.
7. **Retro cost.** One extra review child per HEAVY run for the cross-family check. Replay costs two children per candidate. I recommend the check on by default for HEAVY runs and replay as an opt-in.
8. **Review contract change.** Adding the tag changes every review result. I recommend the change, with a tolerant parser.
9. **User-scope lessons.** Allow promotion from project to user scope. I recommend it in phase 6, owner-only and never automatic.
10. **Scheduled retro.** Offer a weekly `schedule_task` in `omt-retro`. I recommend that the skill offers it and never creates it without the user's request.
11. **Skill patches.** Retros only write proposals and never edit installed skills. I recommend this rule. For the omt repository itself, proposals feed `omt-plan`.

## 6. Risks

| Risk | How it shows | Mitigation in the design |
| --- | --- | --- |
| A wrong lesson | A lesson from one odd unit misleads later workers | Evidence rule, cross-family check, owner approval, `no effect` flag, retirement |
| Reward hacking | Workers learn to please reviewers, or lessons make reviewers quieter | Reviewers never see lessons. The deny list blocks gate-weakening text. The metric also counts test failures and rejected claims |
| The learner edits its own evaluator | A change to personas or contracts lowers findings | Retros cannot edit personas or contracts. Those changes go through a plan and the normal review |
| Prompt injection | A child reads hostile repository text and the retro copies it into a lesson | Owner approval, hygiene lint, lessons visible in git diffs, 240-character limit |
| Brief bloat | Lessons push briefs toward the 120,000-character limit (spec section 5.4) | 5 lessons and 1,200 characters per brief |
| Stale lessons | A refactor moves the files a lesson names | `dead path` and `stale` flags in `omt lessons report` |
| Small samples | Routing flips on noise | `minSamples`, non-overlapping intervals, owner apply |
| Selection bias | Candidate 2 data come only from fallbacks | No automatic reorder. The suggestion says the sample source |
| Fake learning | The tool claims progress on noise, and the user stops trusting it | The retro may say "nothing to learn". Reports show numbers with their sample sizes |
| Two writers disagree | Like the prime-agent global dir mismatch | One path helper per file, CLI-only writes, tests on the paths |
| Concurrent worktrees | Two threads edit `.omt/lessons.md` at once | Atomic writes and the hash fence in `accept`. Git merges committed copies |
| Privacy | Committed lessons leak project details | Owner decision 2. The ledger and result files stay git-ignored |
| More cost per run | Retro children add time and tokens | LIGHT runs do only the deterministic retro. HEAVY adds one child |
| Spec drift | New files and fields without spec text | Each phase updates `docs/spec.md`. Tests check the schemas and the skills' links |
