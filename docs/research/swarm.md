# The swarm article and related work, surveyed for omt

This report reads "On the Nature of the Swarm" (Konstantin Dunas, Prime Intellect, 2026-10-06) and 53 related sources. It says which of their ideas omt should adopt, in which order, and which ideas do not fit.

Research date: 2026-10-10.

> Note, 2026-10-28: the workflow fold changed omt after this research. omt-ulw is now a main-thread build flow. The main thread builds and fixes, one review child and one QA child check, and the main thread waits for children inside its turn. omt-loop, the stall heartbeat, per-unit dispatch, and the task budget (`limits.maxTasksPerRun`) were removed, and omt-review was renamed omt-code-review. Skill step numbers and `omt:` line cites below refer to the skills before that change. See [the workflow fold design](../design/workflow-fold.md).

## Path conventions

- `omt:` is the root of this repository, https://github.com/gabimoncha/oh-my-t3.
- A source name in square brackets is a link. The link list is at the end of the file.

## Method

- Six read-only `research` children ran through `omt-research` (plan `research-swarm`, units S1 to S6). The `research` role routed to `codex/gpt-6.1-sol` at low effort.
- The conductor opened at least one source per unit and compared it with the child's claim. Each check held:
  - S1: the article defines "total context capacity", and a footnote gives 1M tokens compressed to about 16k ([article, author's version]). The Rust rewrite post reports 2,209 agents, 16,758 messages, and 228.70B tokens under one root agent ([Prime rewrite]).
  - S2: Agensh pass rates of 19.31%, 20.68%, 26.52%, and 28.78% for 1, 8, 32, and 128 agents ([Agensh]).
  - S3: Cognition revised its 2025 position on 2026-04-22, only for systems with one writer ([Cognition 2026]).
  - S4: Claude Code resumes a finished subagent with `SendMessage`, and its `Explore` and `Plan` agents are one-shot ([Claude Code subagents]).
  - S5: operator corrections of 41.9% after a compaction against a 17.7% baseline ([LangWatch]).
  - S6: `bd reclaim` clears a claim only after the lease expires and a grace period passes ([Beads reclaim]).
- The conductor read the omt skills, the omt design, and the T3 notes directly. Every `omt:` citation is a line that the conductor read.
- The conductor ran one live experiment on T3. Section 4 reports it.
- Every idea for omt in section 5 is an inference by the conductor. No source measured omt.
- A number is vendor-reported when the company that built the system published it. Section 3 marks these numbers.

## 1. Summary

- The article orders five ways to get past one context window: compaction, notes on disk, a sub-agent, a sub-agent that stays alive, and peers that message each other. Each step loses less information than the step before it. The cost of every step is communication ([article]).
- omt stops at the third step. Every child answers once, and the conductor never asks it again (`omt:skills/omt-ulw/SKILL.md:63`, `omt:skills/omt-ulw/SKILL.md:137`). The conductor is the root of a tree, and every result passes through it (`omt:skills/omt-ulw/SKILL.md:97-107`).
- T3 already supports the fourth step. In this session, a finished child answered three follow-up questions in 16 seconds and fetched nothing again. Its first run took 3 minutes 49 seconds and 11 web searches (measured, one run, section 4).
- The fifth step, a mesh with no root, has weak support for coding work. Prime Intellect's own largest run used one root agent and four fixed roles ([Prime rewrite]). Cursor dropped flat peers, because 20 agents did the work of two or three ([Cursor, January]). Cognition still calls networks of agents that negotiate "mostly a distraction" ([Cognition 2026]). Agensh is the one report where equal peers improved with scale, and it reports no cost ([Agensh]).
- The related work agrees on one split. The agent that writes keeps its context, and the agent that reviews starts with none ([Cognition 2026], [Cognition local Fusion], [LangChain context], [Prime rewrite]). omt already gives each review a fresh child from another family. omt does not yet let the writer keep its context between fix rounds.
- More agents help when the parts are independent and a check exists for the combined result. They hurt on sequential work and when one strong agent already succeeds. One study measured changes from +80.8% to -70% across task types ([Scaling study]).
- Compaction loses constraints. One study measured 30% rule violations after compaction against 0% with full context, and a 47-token pinned block brought the rate back to 0% ([Governance Decay]). omt keeps state on disk, but it has no fixed view that the conductor reads after a reset.
- No source measured a sub-agent that stays alive against a fresh sub-agent with the same evidence and budget. Children S1 and S5 both searched for such a study and found none.
- The six ideas to build, in order: follow-up questions to a finished child, a resume view that survives compaction, fix rounds that return to the worker, a standing explorer per plan, a coupling rule in plans, and yield metrics per step. Section 5 gives the mechanism and the guard for each.

## 2. What the article argues

Dunas names the largest task that a model can finish "total context capacity", measured as the window that one uninterrupted attempt would need ([article]). Each method below raises that capacity and loses something.

| Step | Mechanism | What it loses | omt today |
| --- | --- | --- | --- |
| 1. One window | The agent works until its context is full. The author puts frontier windows near 1M tokens (his assertion). | Everything past the limit. | Each agent in a T3 thread. |
| 2. Compaction | The agent writes a summary for a new context. A footnote gives about 16k tokens for a 1M window. | The summary is written before the later question is known, so a detail that matters later can be dropped for a good reason. | The provider compacts the conductor. omt does not control it. |
| 3. Compaction with disk | Details stay in files, and the summary keeps pointers. | The next agent must notice that a file matters, find it, and read it again. Files go stale. | The plan and the ledger (`omt:docs/design.md:77`). After a reset the conductor reads both again (`omt:skills/omt-ulw/SKILL.md:31`). |
| 4. Sub-agent | A child works in its own window and returns a short answer. The answer is a summary written after the question is known. | The child forgets everything when it answers. | Every omt child. A child sees only its brief (`omt:docs/design.md:55`). |
| 5. Persistent sub-agent | The child keeps its context, files, and processes, and answers later questions. Capacity approaches one window per agent when short messages are enough. | Messages cost tokens and lose information. | Not used. Each fix round goes to a new child (`omt:skills/omt-ulw/SKILL.md:137`). |
| 6. Tree | A parent owns children. | A message between branches goes up to a common ancestor and down again. The root fills and must compact. | The conductor is the root (`omt:skills/omt-ulw/SKILL.md:97-107`). |
| 7. Mesh | A peer asks the agent that holds the context. One specialist serves all. | Paths grow with about the square of the team size. | Not used. `omt:docs/design.md:92` lists team mailboxes as out of scope. `omt-swarm` tracks never message each other (`omt:skills/omt-swarm/SKILL.md:58`). |

The article adds four claims ([article]):

- Multi-agent is not a new way to scale. Every method builds context through inference.
- A split fails when each part needs everything.
- A local tree still pays where one owner lowers the cost of coordination.
- The author does not know the right structure. He suggests a shared git repository, an issue tracker, and chat as a start, and he suggests that the agents revise the structure themselves.

### What Prime Intellect built

- Prime Agent keeps each child's directory, context, kernel, and history. A session unloads after 30 minutes without use and loads again when someone addresses it. An agent can message its parent, a sibling, or a named child ([Prime Agent launch]). `omt:docs/research/prime-agent.md:45` has the code-level detail.
- The Rust rewrite of Prime Agent is the company's largest reported run: 2,209 agents, 16,758 messages, and 228.70B tokens (vendor-reported). One root agent assigned the work and wrote no product code. Each task went through a planner, an implementer in its own worktree, a reviewer on another model in a separate context, and a verifier in a fresh sandbox. A merge needed both the review and the verification ([Prime rewrite]).
- No source shows a shipped mesh without a root, an issue tracker that agents own, or a chat channel between agents at Prime Intellect (S1 searched the company site for all three).

The rewrite pipeline is close to omt's loop of plan, execute, cross-family review, and test. The article describes where the author wants to go. The rewrite describes what worked for the same company three days later.

### What the cited sources say

- Noam Brown says that four agents halved the elapsed time on some benchmarks and doubled the cost. He attributes less than 10% of the Navier-Stokes result to the multi-agent setup, and he reports no single-agent comparison ([Brown transcript]).
- OpenAI reports about 10,000 concurrent agents, 88 hours, 2.7M messages, and about 130B output tokens for that result (vendor-reported). Agents talked inside groups. People moved agents between groups, and Codex merged insights across groups ([OpenAI Navier-Stokes]). The run had human coordination above the groups.

## 3. What the related work adds

### 3.1 How the largest coding runs coordinated

| System | Structure | Shared state | What the team dropped, and why | Numbers (vendor-reported) |
| --- | --- | --- | --- | --- |
| [Cursor, January] | Planners create tasks, workers execute, a judge ends each cycle. | One branch. | Flat peers with a locked task file: 20 agents gave the throughput of two or three. A central integrator became a bottleneck. | Hundreds of agents, a browser of over 1M lines in about a week. |
| [Cursor, February] | A root planner that writes no code, planners below it, workers with private copies. A worker sends one handoff to its planner. Workers do not message each other. | Scratchpads that agents rewrite. | Static planning, because it waited for the slowest worker. | About 1,000 commits per hour at peak. |
| [Cursor, July] | The same tree. Planners own design decisions and stop two subtrees from deciding the same question. | Design documents with checked references. A field guide whose index has a line limit and loads at startup. | Merges by the worker, because workers overwrote or abandoned changes. Neutral agents now resolve conflicts. | SQLite runs passed 73% to 85% after four hours and cost $1,339 to $10,565. |
| [Cursor, September] | Product change. | None. | Prompts that pushed the agent to start exploration subagents, because fresh subagents can repeat work. | 7% lower token cost from several context changes together. |
| [Anthropic compiler] | 16 peers choose their own tasks. No orchestrator and no chat. | A shared bare git repository. Claim files in `current_tasks/`. Progress files and notes on failed approaches. | Undivided work on one failing build, because every agent fixed the same blocker. A reference compiler split the work into separate test subsets. | About 2,000 sessions, 100K lines, just under $20,000. |
| [Anthropic harness design] | Planner, generator, evaluator, with contracts in files. | Files. | Sprint steps and a check after each sprint, once a stronger model made them overhead. | Solo run 20 minutes and $9. Full harness 6 hours and $200. |
| [OpenAI harness engineering] | People assign tasks. Codex writes each change and asks agent reviewers. | A worktree per change. An `AGENTS.md` of about 100 lines that links to detailed documents. | One large instruction file, because it used context and went stale. | About 1M lines and 1,500 merged PRs in five months. |
| [Agensh] | Persistent equal peers that claim their own work. | Git PRs, a chat server, and an append-only board with typed entries (`OBSERVED`, `FACT`, `FAIL`, `CLAIM`, `PATCH_SUMMARY`) and a search tool. | Not stated. | Mean pass rate 19.31% with 1 agent and 28.78% with 128 on five hard tasks. No cost given. |
| [Prime rewrite] | One root agent and four roles per task. | Worktrees and PRs. | Not stated. | 2,209 agents, 228.70B tokens. |
| [Team Hayes] | 102 investigators, proposers, and verifiers. | Shared folders, later replaced after an agent deleted one. | Most verifiers: 90 verifiers used 88% of the run, and about 12 agents produced 90% of the value. The team now uses three verifiers at most. | First-person report, no cost given. |

Findings across the table:

- Every large coding run except the compiler and Agensh has a planner above the workers. The compiler run had no planner, and its agents repeated each other's work until a person changed the test setup ([Anthropic compiler]).
- Three reports removed process after they measured it: Cursor removed exploration prompts, Anthropic removed sprint checks, and Team Hayes removed verifiers.
- Shared notes appear in every long run: progress files, notes on failed approaches, a field guide, or a typed board.

### 3.2 What the teams that build agents concluded

- **Cognition changed its position for one structure.** The 2025 post argued against multi-agent systems, because parallel writers make conflicting decisions that nobody stated ([Cognition 2025]). The 2026 post accepts several agents when writes stay with one agent. A reviewer with no context from the coder found on average 2 bugs per PR, about 58% of them severe (vendor-reported). The coder then uses its own wider context to filter the findings ([Cognition 2026]).
- **Cognition Fusion keeps two contexts alive.** A lead and a sidekick each keep their own context and prompt cache. They exchange briefs, results, and feedback, and not whole conversations ([Cognition local Fusion]). One vendor comparison scored 60.7 at $1.86 per task with a sidekick against 60.8 at $4.03 without ([Cognition Fable]). Delegation failed where judgment was the deliverable: one React feature fell from a score of 54 to 27 while its cost fell from $6.84 to $4.91 ([Cognition Fusion]).
- **A complete scan needs a fixed queue.** Devin's scan design has a script make a finite list of shards. Fresh workers each take one shard, and one reducer joins the findings ([Devin MapReduce]).
- **Anthropic's research system pays in tokens.** Its multi-agent setup scored 90.2% higher than one agent on an internal test and used about 15 times the tokens of a chat (vendor-reported). The lead scales effort to the question: one agent for a simple fact, two to four for a comparison, more than ten for complex research ([Anthropic research system]). A worker can use tens of thousands of tokens and return 1,000 to 2,000 ([Anthropic context engineering]).
- **LangChain states the split as a rule.** Fork a worker that continues work in progress. Isolate a reviewer and a researcher ([LangChain context]). Its framework added workers that keep their history across follow-up instructions ([LangChain Deep Agents 0.5]).
- **Gas Town can ask the previous session.** `gt seance` resumes the predecessor of a restarted agent to ask for missing context. The author reports lost designs, the same fix made two or three times, and a practical limit near 30 workers ([Gas Town essay]). Durable mail filled the database, so Gas Town now keeps durable mail for information that must survive the end of a session ([Gas Town mail]).
- **Handoff did not replace compaction.** Amp replaced compaction with a handoff to a new thread in 2025 ([Amp handoff]) and went back to automatic compaction at 90% of the window in 2026 ([Amp rebuilt]).
- **A good summary keeps the next step.** Factory keeps the constraints, the changed files, the checks, the rejected approaches, and the next action in a summary with a fixed structure. In its own study, file tracking was the weakest part of every summarizer, at 2.45 of 5 for the best one (vendor-reported) ([Factory compaction]).
- **Context rot depends on the content.** One study filled the context with related earlier work and measured pass rates of 50%, 42.5%, and 39.8% at 0, 250k, and 500k tokens for one model ([Boolean context rot]). A second study measured 94.4% recall at 730k tokens of static filler, with only 8 trials at that length ([AIL recall]). The two studies measure different things, so omt should not adopt one context limit from either.

### 3.3 How shipping harnesses keep a sub-agent and pass messages

| Harness | Ask a finished sub-agent again | Message between siblings | Shared tasks | Limits |
| --- | --- | --- | --- | --- |
| [Claude Code subagents] | `SendMessage` with `to` set to the agent id or name. `Explore` and `Plan` cannot be resumed. | A subagent with `SendMessage` can message a named agent. | None for plain subagents. | 20 running subagents, depth 3, transcripts kept 30 days (defaults). |
| [Claude Code teams] | A stopped teammate restarts with its saved conversation in the same session. | JSON mailbox files, one per agent. | Task files with dependencies. A file lock stops two claims of one task. | The docs recommend 3 to 5 teammates. Teams cannot nest. |
| [Codex multi-agent source] | `followup_task` starts a turn on an idle agent. `send_message` does not. | The same two tools, addressed by task name. | None found. | 4 threads with the root (newer tools) or 6 spawned threads (older tools). |
| [OpenCode task source] | `task` with `task_id` reuses the child session. | None found. | None found. | Depth 1 by default. |
| [oh-my-pi lifecycle] and [oh-my-pi bus] | An idle agent parks after a time limit and comes back when a message arrives. | A bus in memory, at most 100 messages per agent, oldest dropped first. | None shared. | Not found. |
| [Amp subagents] | Not documented. | Plain subagents cannot message siblings. | Not documented. | Not documented. |
| [Gas Town mail] | Mail is durable. A nudge is lost when the session is dead. | Addressed mail with an inbox and an acknowledgment. | Work items in Beads. | 20 to 30 agents, by the author's own guidance. |
| [Agent Mail] | Does not keep model context. | Messages in git with an index in SQLite. | Uses Beads. | A file lease is advisory: a conflicting lease is still granted, and the conflict is returned with it. |
| [A2A spec] | A context id groups messages. A finished task rejects new messages. | Any agent can call another agent's endpoint. | Not in the protocol. | Not in the protocol. |

The pattern across the harnesses: a follow-up to an existing agent is now a standard tool, and it is separate from a message that only informs. Shared task claims exist in two of the nine, and both use a lock.

### 3.4 Measured evidence on when more agents help

- **Task shape decides.** Across 260 setups, coordination changed results from +80.8% on a finance task with parallel parts to -70% on a planning task with sequential steps. On coding with a strong model, one agent solved 70%, a centralized team 55%, and a decentralized team 45%. With a weak model, one agent solved 5% and a team 35%. The coding sample had 20 tasks ([Scaling study]). `omt:docs/research/ouro-bibliography.md:132` has the abstract-level entry.
- **Errors spread differently per structure.** The same study measured the extra work that follows an error: 17.2 times for independent agents with no check, 7.8 times for decentralized teams, and 4.4 times for a central coordinator. Turn counts rose by 58% to 515% ([Scaling study]).
- **Most failures are in the task text and in the handoffs.** In 1,642 traces from seven systems, 44.2% of failures were in specification and design, 32.35% in alignment between agents, and 23.5% in verification and stopping ([MAST]).
- **Compaction causes corrections.** One engineer's 162 days of use had 873 compactions. The median summary held 4,382 tokens from a window of 574,875. In the five steps after a compaction, 41.9% of the operator's messages held a correction, against 17.7% otherwise. 14% of judged steps needed older text word for word ([LangWatch]). The study covers one person.
- **Pinned rules survive compaction.** In 1,323 synthetic episodes, agents broke a rule in 30% of episodes after compaction and in 0% with full context. A protected block of 47 tokens brought the rate back to 0% at under 0.5% extra tokens ([Governance Decay]).
- **Teams often tie at several times the cost.** One comparison raised a coding benchmark from 90.2% to 93.2% with about 5 times the input tokens, and about 80% of all outcomes were ties ([Single or multi]).
- **Cheap attempts with a checker can beat one long run.** On 216 contest problems at a fixed budget, repeated single calls with a judge beat one agent run and three agent runs ([Independent sampling]). The result needs a reliable checker.
- **Direct messages help, and an early wrong message hurts.** In four-agent teams, direct messages raised accuracy by 3 to 10 points over relayed messages. A corrupted early message cost 33 to 36 points ([StreamMA]).
- **No structure wins everywhere.** A tree scored 93.9% on a coding benchmark and 55.3% on a language benchmark. A full mesh scored 89.0% and 83.3% ([MetaGen]).

### 3.5 Coordination without a coordinator in the message path

- **Claims need a lease and a safe release.** Beads sets the owner and the status in one step. A claim has a lease that `bd heartbeat` renews. `bd reclaim` clears a claim only after the lease expires and a grace period passes, by default twice the lease time, and it records the recovery ([Beads reclaim]). A release can be conditional on the expected owner, so a supervisor cannot clear the claim of a replacement worker ([Beads README]).
- **A lock on a file is not a claim on work.** Cursor's flat peers failed with a locked task file, because nobody owned the hard problems ([Cursor, January]). The compiler run had claim files and no rule for a stale claim ([Anthropic compiler]). Agent Mail grants a conflicting file lease ([Agent Mail]).
- **A git ref can decide a race.** In one design, each claimant pushes a commit to the same claim ref, and the first creation of the ref wins ([Claim ref design]).
- **A typed board replaces many messages.** Agensh peers write facts, failures, claims, and patch summaries to an append-only board and search it. Their prompts forbid a retry of a recorded failure ([Agensh]).
- **A shared board is an attack path.** One study showed leaked secrets, a whole team misled by one hostile agent, and cheap context overflow through shared boards. It limits each board to the agents that need it ([Terrarium]).
- **A change of structure during a run needs guards.** One system splits an overloaded agent into specialists. It limits the children to the parent's permissions, accounts for every moved memory item, and tests the new structure on five tasks before use ([ATM]). A second study found that fully free coordination over shared memory did worse than a fixed order with free roles ([Drop the hierarchy]). No source shows a safe way for agents to rewrite the whole process of a coding team (S6).

## 4. Live experiment: a follow-up question to a finished T3 child

The T3 notes say that `t3_thread_send` can target any thread and that `task_status` reports later runs of a child (`omt:docs/research/t3-orchestrator-v2.md:355`, `omt:docs/research/t3-orchestrator-v2.md:265`). The conductor tested the two facts together on the finished S1 child.

Steps:

1. The S1 child (Codex, `gpt-6.1-sol`, plan mode) finished its research task.
2. 78 seconds later, the conductor called `t3_thread_send` with the child's thread id, mode `auto`, and three questions about pages from the first run. T3 returned `delivery: "started"` and a new run id.
3. The conductor called `t3_thread_wait` with that run id, and then `task_status` with the task id.

| | First run | Follow-up run |
| --- | --- | --- |
| Duration | 3 min 49 s | 16 s |
| Web searches | 11 | 0 |
| Commands | 13 | 1 (the child read a skill file from the user's global instructions) |
| Where the answer appears | `task_status.summary` | `task_status.latestTerminalSummary` |

What the experiment shows:

- The child answered from its kept context. The activity log of the second run has no web search, and the child reported zero pages fetched again.
- `summary` did not change. A conductor that reads `summary` after a follow-up reads the old answer. It must read `latestTerminalSummary`.
- No wake message arrived for the follow-up run. The conductor must wait on the run id.

What the experiment does not show:

- It is one run with a read-only Codex child. A Claude child, an edit child, and a child that was idle for hours are not tested.
- It measured time and tool calls. It did not measure tokens.
- T3's shared instructions forbid `t3_thread_send` on a child thread for a new review round. A follow-up question is a different use, and T3 accepted it.

## 5. Ideas for omt

This section is the conductor's inference from sections 2 to 4.

### Constraints that apply

- The CLI cannot call T3. It does the deterministic parts, and skills carry the judgment (`omt:docs/design.md:45-51`).
- The package has no runtime dependency and makes no network call.
- Two plans are in flight. The `memory` plan adds lessons in briefs, saved briefs and results, and `omt ledger metrics` (`omt:.omt/plans/memory.md:13`, `omt:.omt/plans/memory.md:17`). The `workflow-profiles` plan adds profiles that switch steps and `omt lock run` for shared build state (`omt:.omt/plans/workflow-profiles.md:16`).

### Ranked list

| # | Idea | Main sources | Size | Needs |
| --- | --- | --- | --- | --- |
| 1 | Follow-up questions to a finished child | Section 4, [article], [Claude Code subagents], [Codex multi-agent source] | S | Nothing |
| 2 | A resume view that survives compaction | [Governance Decay], [LangWatch], [Factory compaction] | S | Nothing |
| 3 | Fix rounds return to the worker. Reviews stay fresh. | [Cognition local Fusion], [Cognition 2026], [LangChain context] | M | Idea 1, an owner decision |
| 4 | A standing explorer per plan | [article], [Cursor, September], [Anthropic context engineering] | S | Idea 1 |
| 5 | A coupling rule in plans | [Scaling study], [Cognition Fusion], [Cursor, July] | M | Nothing |
| 6 | Yield per step, and a switch for steps that stopped paying | [Anthropic harness design], [Team Hayes], [Cursor, September] | S | `memory` plan metrics, profiles |
| 7 | A plan board with typed notes | [Agensh], [Anthropic compiler], [Terrarium] | M | `memory` plan brief injection |
| 8 | Direct questions from a worker to the explorer (experiment) | [StreamMA], [article], against it [Cognition 2026] | S | Ideas 1 and 4, a T3 test |

### 1. Follow-up questions to a finished child

The user gets answers about a finished task in seconds, and the conductor stops paying for the same reading twice.

- **Mechanism.** `t3_thread_send` to the `childThreadId` with a short question, `t3_thread_wait` on the returned run id, then `task_status` and its `latestTerminalSummary` field. Section 4 measured this path.
- **Where it goes.** A new "Ask again" section in `omt:skills/omt/references/results.md`. Two existing rules then change. `omt-research` asks the child that gave a weak answer before it starts a new task (`omt:skills/omt-research/SKILL.md:37`). A result without its block gets one follow-up that asks for the block, before a new attempt (`omt:skills/omt/references/results.md:71`).
- **Record.** One ledger entry per follow-up, with the unit, the question, and the run id, so the metrics can count them.
- **Guards.**
  - Never use it for a review round. A reviewer must start fresh, and T3 forbids this use.
  - At most three follow-ups per child, because long related context lowers pass rates ([Boolean context rot]).
  - State the scope again in a follow-up to an edit child.
  - Tell an explorer which files changed since its run, or start a new one.

### 2. A resume view that survives compaction

After a context reset, the conductor reads one short block and has every rule and open item, instead of two long listings.

- **Mechanism.** A new command `omt plan resume <slug>` prints a fixed block: the objective, each done condition with its state, the owner decisions, the questions already asked, the active tasks with task ids and thread ids, the rejected approaches, and the next action. The plan template gets a `## Rejected` section, so a failed approach exists on disk with its unit and its reason.
- **Where it goes.** `omt:skills/omt-ulw/SKILL.md:31` changes to "run `omt plan resume <slug>`". The loop and swarm heartbeats use the same command. (omt-loop and the heartbeats were removed on 2026-10-28; see [the workflow fold design](../design/workflow-fold.md).)
- **Why.** A pinned block of 47 tokens removed the rule violations that compaction caused ([Governance Decay]). Corrections more than doubled right after compaction for one engineer ([LangWatch]). Summaries are weakest at tracking files and artifacts ([Factory compaction]). Long runs keep notes on failed approaches so that no agent repeats them ([Anthropic compiler], [Agensh]).
- **Fit.** The view is deterministic, so the CLI owns it.

### 3. Fix rounds return to the worker, and reviews stay fresh

The user gets shorter fix rounds, because the agent that wrote the code fixes it without reading the unit again.

- **Today.** Each fix round is a new child that gets every earlier round in a file (`omt:skills/omt-ulw/SKILL.md:137`). On the Mira run, children spent 41 minutes on startup reading and 310 minutes on model work, of 1,326 minutes in total (`omt:.omt/plans/workflow-profiles.md:35`).
- **Mechanism.** From round 2, the conductor sends the kept findings, word for word, to the thread of the unit's worker as a follow-up. The review of each round stays a new `delegate_task` to the other family.
- **Why.** The writer keeps its context, and the reviewer has none. Four sources state this split ([Cognition 2026], [Cognition local Fusion], [LangChain context], [Prime rewrite]). In Cognition's reports, a lead and a sidekick that both keep their context cut cost by 35% to 60% at nearly the same score (vendor-reported) ([Cognition Fusion]).
- **Guards.** Use a new child in these cases:
  - The fix needs the `deep` role (`omt:skills/omt-ulw/SKILL.md:149`).
  - The worker's run failed or was cancelled.
  - The unit was reopened after other units changed its code.
  - The worker already had two follow-ups.
- **Status, 2026-10-28.** The workflow fold goes further: the main thread builds and fixes in its own context, and the review stays a fresh child on the other family. See [the workflow fold design](../design/workflow-fold.md).
- **Measure first.** No source compared a kept worker with a fresh one at equal budget. Record the rounds to `APPROVE` and the minutes per fix round for both ways, and keep the old behavior in the `normal` profile until the numbers exist.

### 4. A standing explorer per plan

The planner and the conductor can ask "where is this handled" at any time and get an answer from an agent that already read the area.

- **Today.** An explore child answers one narrow question, and its context is discarded (`omt:skills/omt-ulw/SKILL.md:63`).
- **Mechanism.** The plan records the thread id of each explorer with its code area. During planning and fixing, the conductor asks follow-ups with idea 1. The explorer retires when the first edit unit in its area is done, unless the question carries the list of changed files.
- **Why.** This is the article's main proposal ([article]). Fresh exploration subagents repeat work ([Cursor, September]). A worker reads tens of thousands of tokens and returns 1,000 to 2,000, so most of what it learned is lost with a one-shot child ([Anthropic context engineering]).
- **Note.** Claude Code's own `Explore` agent cannot be resumed ([Claude Code subagents]). A T3 child is a full thread, so omt can do here what the native tool cannot.

### 5. A coupling rule in plans

The user gets fewer wasted children, because the plan does not split work that one agent must hold in one head.

- **Mechanism.** `omt-plan` gives each unit one of three labels, and each label has a rule.
  - `independent`: the unit can run in parallel, as today.
  - `sequential`: the unit continues the work of an earlier unit. It runs as a follow-up in that unit's worker thread when both are small.
  - `shared-decision`: two or more units depend on one open design question. The planner decides the question first and writes the decision into the plan. No such unit starts before that.
- **Check.** `omt plan check`, proposed in `omt:docs/research/deepseek-harness.md:384`, also reports two parallel units that name the same open question.
- **Why.** Sequential work lost 39% to 70% with teams, and parallel work gained up to 80.8% ([Scaling study]). Delegation halved the score where judgment was the deliverable ([Cognition Fusion]). Cursor's planners own design decisions and stop two subtrees from deciding the same one ([Cursor, July]). 44.2% of multi-agent failures start in the specification ([MAST]).
- **Record.** The ledger keeps the label, the number of children, the rounds, and the result per unit. `omt:docs/research/ouro-bibliography.md:215` already asks for this data.

### 6. Yield per step, and a switch for steps that stopped paying

The user stops paying for a review, a test, or an oracle pass that never changes the outcome on their kind of work.

- **Mechanism.** `omt ledger metrics` adds one number per step, profile, and model: the share of runs of the step that changed the outcome. For a review, a change is a kept finding. For a test task, a change is a failure. For an oracle round, a change is a kept finding. The profiles of the `workflow-profiles` plan already switch steps. The later retro proposes a switch when the yield stays under a set level over a set number of plans.
- **Why.** Anthropic removed two steps after a model upgrade and advises a new test of the harness after each upgrade ([Anthropic harness design]). Ninety verifiers used 88% of one run ([Team Hayes]). Cursor removed a prompt that started too many explorers ([Cursor, September]).

### 7. A plan board with typed notes

A worker starts with the facts and the dead ends that earlier workers on the same plan found, without the conductor as the relay.

- **Mechanism.** An append-only file `.omt/board/<plan>.jsonl`. `omt board add --plan <slug> --unit <id> --type <fact|fail|decision|question> --scope <path> --text <text>` appends one entry. `omt brief` adds the entries whose scope overlaps the unit's scope, up to a limit, in the way the `memory` plan adds lessons. The work result block asks the worker for one `fail` entry per approach that it dropped.
- **Why.** Typed entries with a search tool carried coordination for up to 1,024 peers ([Agensh]). Every long run kept notes on failed approaches ([Anthropic compiler], [Cursor, July]).
- **Guards.**
  - An entry is a claim by one unit. The brief shows it as a claim.
  - Review, test, oracle, and plan-review briefs never get board entries, for the same reason that they never get lessons (`omt:.omt/plans/memory.md:13`).
  - The limit per brief protects against overflow and against one bad entry that misleads every worker ([Terrarium]).
- **Relation to memory.** The board holds unverified notes for one plan. Lessons hold evaluated knowledge across plans. The retro can turn a board entry into a lesson candidate.

### 8. Direct questions from a worker to the explorer (experiment)

- **Mechanism.** A worker brief lists the thread id of the explorer for its area. The worker may send at most two questions with `t3_thread_send` and waits with `t3_thread_wait`. Each question goes into the ledger.
- **Why to test it.** It removes the conductor from the most common relay. Direct messages raised team accuracy by 3 to 10 points in one study ([StreamMA]).
- **Why not to make it the default.** An early wrong message cost 33 to 36 points in the same study. Decentralized teams amplified errors 7.8 times ([Scaling study]). Cursor's final design has no messages between workers ([Cursor, February]).
- **Open T3 question.** No test shows that a child can call `t3_thread_send` on a sibling thread. The notes say the tool accepts any thread and needs the caller's live run (`omt:docs/research/t3-orchestrator-v2.md:355`).

### Later, when a need appears

- **Leased claims.** omt assigns every unit, so no agent claims work today. If swarm tracks ever pick their own units, use the Beads design: one atomic claim, a heartbeat, a reclaim after twice the lease time, and a release that names the expected owner ([Beads reclaim], [Beads README]).
- **Several cheap attempts with a checker.** For a unit with a fast command that proves it, several cheap attempts in worktrees can beat one long run ([Independent sampling]). Worktree threads need an explicit request from the user (`omt:docs/design.md:67`).
- **Changes of structure by the run itself.** The article's last proposal belongs to the retro, which the `memory` plan places in a later plan (`omt:.omt/plans/memory.md:27`). A proposal to merge units or to keep a child alive goes through the same frozen evaluator as a lesson. Prime Agent's own self-improvement kept cheating tactics in one reported case ([Prime Agent launch]).

### Does not fit

- **A mesh without a root as the default.** The evidence for coding runs points the other way (sections 3.1 and 3.4).
- **A chat server or a message broker.** It adds a service. T3 thread messages cover direct questions.
- **A database dependency for tasks or mail.** The package has no runtime dependency.
- **Durable mail for every message.** Gas Town reports that it filled the database ([Gas Town mail]).
- **A higher agent count as a goal.** omt runs 4 to 6 children. Claude Code's own guidance for teams is 3 to 5 ([Claude Code teams]).

### Build order

1. Ideas 1 and 2. They are small, independent, and need no owner decision.
2. Idea 4, then idea 3 behind a profile switch, with the measurement.
3. Idea 5 with `omt plan check`.
4. Idea 6 after the `memory` plan ships its metrics.
5. Idea 7 after the `memory` plan ships lessons in briefs.
6. Idea 8 as one test on a real plan.

## 6. Owner decisions

1. Should fix rounds go to the worker's own thread by default, or only in a profile until omt has its own numbers? The draft answer is a profile switch.
2. Should the plan board be committed like `.omt/lessons.md`, or stay local like live plans? The draft answer is local, because its entries are unverified.
3. Should omt run the direct-question experiment of idea 8 at all?
4. `omt:docs/design.md:92` lists team mailboxes as out of scope. Ideas 1, 3, and 4 use thread messages from the conductor only. Idea 8 is the first message between children. Does the design line stay?

## 7. Unknown

- No controlled study compared a sub-agent that stays alive with a fresh sub-agent at equal evidence and budget. S1 and S5 searched for one.
- No controlled study compared a tree with a mesh on coding work. S3 searched for one.
- T3, not tested: a follow-up to a Claude child, to an edit child, and to a child that was idle for hours. The token cost of a follow-up. A message from one child to a sibling.
- No direct reaction to the article was found. S1 searched Hacker News and X for the title, the slug, and the author.
- A claim of 100 agents on one codebase by the OpenClaw author stayed unverified. The post returned an error and no archive copy loaded, so S2 left its numbers out.
- Most numbers in section 3 are vendor-reported. No independent replication was checked.
- The conductor opened 8 of the 55 linked sources. The children read the others. The 8 are the two article versions, [Prime rewrite], [Agensh], [Cognition 2026], [Claude Code subagents], [LangWatch], and [Beads reclaim].

## 8. Notes on omt from this run

- The request id pattern `omt:<plan>:<unit>:<role>` breaks in zsh when a shell variable holds the unit. `$k:r` is a zsh modifier, so `S$k:research` became `S1esearch` in four ledger entries of this run. The ids that T3 received were correct. `omt ledger request-id` avoids the problem, and the `memory` plan already adds a warning for an id that is not canonical.
- A research result of 24,000 to 30,000 characters appears twice in the `task_status` output, as `summary` and as `latestTerminalSummary`. One result passed the display limit of the harness and went to a file. The research brief asks for at most 60 lines, and the children met the line count with very long lines.
- `maxParallel` of 4 made two waves for six sub-questions. The second wave started as soon as the first child finished.

[article]: https://www.primeintellect.ai/blog/on-the-nature-of-the-swarm
[article, author's version]: https://hallerite.com/posts/on-the-nature-of-the-swarm/
[Prime Agent launch]: https://www.primeintellect.ai/blog/prime-agent
[Prime rewrite]: https://www.primeintellect.ai/blog/prime-agent-rust
[Brown transcript]: https://www.dwarkesh.com/p/noam-brown
[OpenAI Navier-Stokes]: https://openai.com/index/navier-stokes-solution/
[Cursor, January]: https://cursor.com/blog/scaling-agents
[Cursor, February]: https://cursor.com/blog/self-driving-codebases
[Cursor, July]: https://cursor.com/blog/agent-swarm-model-economics
[Cursor, September]: https://cursor.com/blog/improved-token-efficiency
[Anthropic compiler]: https://www.anthropic.com/engineering/building-c-compiler
[Anthropic harness design]: https://www.anthropic.com/engineering/harness-design-long-running-apps
[Anthropic research system]: https://www.anthropic.com/engineering/multi-agent-research-system
[Anthropic context engineering]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
[OpenAI harness engineering]: https://openai.com/index/harness-engineering/
[Agensh]: https://arxiv.org/html/2609.26781v1
[Team Hayes]: https://zenn.dev/ajayaditya/articles/100-ai-agents-racing-lessons
[Cognition 2025]: https://cognition.com/blog/dont-build-multi-agents
[Cognition 2026]: https://cognition.com/blog/multi-agents-working
[Cognition Fusion]: https://cognition.com/blog/devin-fusion?_bhlid=cfcdefa5b938677871acd2149a433fbe5f88233c
[Cognition Fable]: https://cognition.com/blog/making-fable-cheaper-than-opus
[Cognition local Fusion]: https://cognition.com/blog/local-fusion
[Devin MapReduce]: https://devin.ai/blog/agentic-map-reduce
[LangChain context]: https://www.langchain.com/blog/organizing-context-in-a-multi-agent-harness
[LangChain Deep Agents 0.5]: https://www.langchain.com/blog/deep-agents-v0-5
[Gas Town essay]: https://yegge.ai/essays/welcome-to-gas-town/
[Gas Town mail]: https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/mail-protocol.md
[Amp handoff]: https://ampcode.com/news/handoff
[Amp rebuilt]: https://ampcode.com/news/neo
[Amp subagents]: https://ampcode.com/docs/models-and-subagents
[Factory compaction]: https://factory.com/articles/coding-agent-context-compaction
[Boolean context rot]: https://www.boolean.ai/blog/context-rot-quantified
[AIL recall]: https://actualintelligencelabs.ai/research/context-rot
[Claude Code subagents]: https://code.claude.com/docs/en/sub-agents
[Claude Code teams]: https://code.claude.com/docs/en/agent-teams
[Codex multi-agent source]: https://github.com/openai/codex/blob/4bad6d78e9b50f9fa8bd941f1db012ed491ad2da/codex-rs/core/src/tools/handlers/multi_agents_spec.rs
[OpenCode task source]: https://github.com/anomalyco/opencode/blob/055d95bb7e278c94baf06235a52cac79dd13ba67/packages/opencode/src/tool/task.ts
[oh-my-pi lifecycle]: https://github.com/can1357/oh-my-pi/blob/a7a2cb66b1390b52b192c41521132a80bc4a7006/packages/coding-agent/src/registry/agent-lifecycle.ts
[oh-my-pi bus]: https://github.com/can1357/oh-my-pi/blob/a7a2cb66b1390b52b192c41521132a80bc4a7006/packages/coding-agent/src/irc/bus.ts
[Agent Mail]: https://github.com/Dicklesworthstone/mcp_agent_mail/blob/2f487bdb1f1d2744707d1e9dba181f68b9162b38/README.md
[A2A spec]: https://a2a-protocol.org/latest/specification/
[Scaling study]: https://arxiv.org/html/2512.08296v3
[MAST]: https://arxiv.org/html/2503.13657v3
[LangWatch]: https://langwatch.ai/research/finding-the-optimal-context-window
[Governance Decay]: https://arxiv.org/html/2606.22528v1
[Single or multi]: https://arxiv.org/html/2505.18286v1
[Independent sampling]: https://arxiv.org/html/2605.08478v1
[StreamMA]: https://arxiv.org/pdf/2606.05158
[MetaGen]: https://arxiv.org/html/2601.19290v1
[Beads README]: https://github.com/gastownhall/beads/blob/c21880105fc1608a58f8472fdeff8f57a3f0c263/README.md
[Beads reclaim]: https://github.com/gastownhall/beads/blob/c21880105fc1608a58f8472fdeff8f57a3f0c263/cmd/bd/reclaim.go
[Claim ref design]: https://gist.github.com/YoraiLevi/5b4ec926602b348ab549afee7fd27c96
[Terrarium]: https://arxiv.org/html/2510.14312v1
[ATM]: https://arxiv.org/html/2607.20488v1
[Drop the hierarchy]: https://arxiv.org/html/2603.28990v1
