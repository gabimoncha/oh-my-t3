# The ouro bibliography, surveyed for omt

This report covers all 76 entries of `ouro-research.bib`, the bibliography that the owner's CTO collected. For each entry it gives the main mechanism, the main result, and one idea for omt. It ends with the findings that cut across entries and a ranked build list.

Research date: 2026-10-08.

## Method

- Eight read-only `research` children ran through `omt-research` (plan `research-ouro-bib`, units B1 to B8). The `research` role routed to `codex/gpt-6.1-sol` at low effort. Each child read the full paper on arXiv, not only the abstract.
- The conductor checked at least one claim per batch against the source. Each check held:
  - B1: 99 of 100 HarnessDev runs claimed success and 48 passed. arXiv 2607.12227 exists.
  - B2: NLAH file-backed state 44.4 to 58.3.
  - B3: KSI 64.0% for $208.
  - B4: the STOP evaluator reported "accuracy of over 1000%".
  - B5: experience raised the attack success rate, and a length-matched prompt did not (direction only).
  - B6: the Shi paper is the theory behind Cordis.
  - B7: EvolveNet shared code grew from 14 to 253 lines.
  - B8: A-Evolve reports 76.5% on Terminal-Bench 2.0.
- Every idea for omt in the tables is an inference by the child or the conductor. No paper measured omt.
- `Rel` is the child's score from 0 to 3, where 3 means that omt should build on the entry.

## Notes on the file itself

- 76 keys hold 70 distinct works. SoL-Pi has three keys (`liuSoLPiRecursivelyScaling2026`, `liuSoLPiRecursivelyScaling2026a`, `SoLPiRecursivelyScaling`). HarnessDev has two (`wuHarnessDevCanLLMs2026`, `wuHarnessDevCanLLMs2026a`).
- One entry stayed unreadable: the X post `yohei[@yoheinakajima]StateAIMemory2026`. The X post `dimitrispapailiopoulos[@dimitrispapail]MementoTeachingLLMs2026` was unreadable too, so the child read the paper behind it (arXiv 2604.09852).
- The Aludel repository moved from `ccarvalho-eng/aludel` to `cristianodabc/aludel`.
- Some abstracts in the file differ from the current paper versions. The tables use the current full text:
  - FlowEvo: 82.8% in the abstract, 85.6% in v2 Table 1.
  - RRSI: abstract and tables differ on the out-of-distribution gain and the token saving.
  - DREvo: 13.8% and 14.2% in two places of v2.
  - Scaling Agent Systems: 180 configurations and R² 0.524 in the abstract, 260 and 0.373 in v3.
  - Agent libOS: 27 tasks and 7.0% false denials in the abstract, 33 tasks and 0 of 119 in v3.

## Catalog

### B1. Harness self-evolution

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `leeMetaHarnessEndtoEndOptimization2026` | Meta-Harness, [2603.28052](https://arxiv.org/abs/2603.28052) | A proposer reads all earlier harness code, scores, and raw traces from files. Text classification rose from 40.9% (ACE) to 48.6% with 11.4K instead of 50.8K context tokens (Table 2). | Ledger entries point to the saved raw evidence, so a retro reads originals and not summaries. | 3 |
| `leeRecursiveHarnessSelfImprovement2026` | Recursive Harness Self-Improvement, [2607.15524](https://arxiv.org/abs/2607.15524) | Revises roles, instructions, and handoff contracts from pairwise comparisons with the previous version. Sonnet at low effort won 20 of 30 against maximum effort after two rounds (§5.3). Opus cost fell 60% (§5.5). | The retro first proposes narrower briefs and result contracts, and only then a higher effort. | 3 |
| `zhangSelfHarnessHarnessesThat2026` | Self-Harness, [2606.09498](https://arxiv.org/abs/2606.09498) | Groups failures that a verifier confirmed, proposes minimal edits, and accepts an edit only when one split improves and no split regresses. Terminal-Bench rose from 40.5% to 61.9% (Table 1). Its held-out split also took part in promotion. | Memory records keep the verified outcome apart from the inferred cause. | 3 |
| `luoHarnessBankSemanticGeneBank2026` | HarnessBank, [2607.13683](https://arxiv.org/abs/2607.13683) | Archives changes by component and failure mechanism. Gates check validity, actual activation, paired significance, and gain. Terminal-Bench rose from 36.1 to 45.4 (Table 1). A SWE-bench gain of 5.1 was not significant. | The ledger records whether a child actually used a lesson. Promotion needs that evidence. | 3 |
| `chenHarnessXComposableAdaptive2026` | HarnessX, [2606.14249](https://arxiv.org/abs/2606.14249) | Typed, replaceable components and a four-stage evolver with deterministic gates. Mean peak gain 14.5 points (Table 4), on evolution tasks only. A single-agent evolver was statistically equal (§6.4). | Each retro proposal carries a change manifest: component, expected effect, evidence, and regression risk. | 2 |
| `wuHarnessDevCanLLMs2026` | HarnessDev, [2609.01437](https://arxiv.org/abs/2609.01437) | A benchmark for harness creation and evolution with frozen artifacts and hidden tasks. Held-out gains average 3.11 points, and feedback agreed with held-out results only 53.1% of the time (§4.3). In one diagnosis, 99 of 100 runs claimed success and 48 passed. | Keep development scores apart from hidden replay scores. Keep claimed completion apart from verified completion. | 3 |
| `wuHarnessDevCanLLMs2026a` | Duplicate of HarnessDev | No checkpoint event appeared in 26,679 task trajectories, although the harness declared the feature (§4.2). | Telemetry reports observed feature use, not declared features. | 3 |
| `xiaRRSIRegularizedRecursive2026` | RRSI, [2609.24972](https://arxiv.org/abs/2609.24972) | Shrinking edit budgets, positive and negative evidence, a leakage screen, a noise estimate, cost limits, and pruning. Out-of-distribution average 43.6 against 40.3 without these rules, at 2.42M instead of 3.80M tokens per trial (Table 2). | The retro has a fixed candidate budget. A CLI gate checks noise and cost. | 3 |
| `liuSoLPiRecursivelyScaling2026` | SoL-Pi, [2609.20519](https://arxiv.org/abs/2609.20519) | Isolated research loops search for cheaper Pi mechanisms within fixed capability tolerances. The full stack cut token traffic by 49.0% at 93.7% of the score (§3.1). The search took more than 3,000 runs. | Replay briefs state a capability tolerance. | 3 |
| `liuSoLPiRecursivelyScaling2026a` | Duplicate of SoL-Pi | On Opus, traffic fell 44.7% and API cost 33.5% at 94.3% of the score (Table 2). | An upstream T3 issue could propose handles for archived observations. | 3 |
| `SoLPiRecursivelyScaling` | Duplicate of SoL-Pi | Terminal-Bench solves fell from 18 to 15 while cost fell 26.3% (Table 3). | Efficiency changes need an explicit limit on capability loss. | 3 |
| `duLivingHarnessInteractiveAgentEvolver2026` | Living-Harness, [2607.26598](https://arxiv.org/abs/2607.26598) | A fixed procedure turns finished episodes into trigger, failure, and recovery records in episodic memory and a state graph. Pass@1 83.09% on τ²-Bench and 65.50% on MultiWOZ, 10.07 and 9.91 points above the best baselines (Table 1). | A lesson record holds its trigger, its recovery action, its scope, and its verified outcome. | 3 |
| `guoDREvoDistillingRecalibrated2026` | DREvo, [2607.26722](https://arxiv.org/abs/2607.26722) | Ties evidence to functions and scores freshness and code compatibility. Then it picks exploit, avoid, retest, or explore. Under code drift, blind reuse lost 5.3 points and DREvo gained 0.6 (Figure 4). | Error memory entries carry a component version and an applicability state. Stale entries go to retest, not to briefs. | 3 |

### B2. Agent and workflow design

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `louAutoHarnessImprovingLLM2026` | AutoHarness, [2603.03329](https://arxiv.org/abs/2603.03329) | Tree search over code that checks or chooses actions. 100% legal actions in 145 games (§4.1). A code-only policy scored 0.870 against 0.844 for GPT-5.2-High (§4.3). | The retro turns repeated contract failures into deterministic CLI checks. | 3 |
| `panNaturalLanguageAgentHarnesses2026` | Natural-Language Agent Harnesses, [2603.25723](https://arxiv.org/abs/2603.25723) | The run policy is a natural-language document that a shared runtime executes. Code keeps the exact operations. File-backed state raised OSWorld from 44.4% to 58.3%, and more candidate search lowered SWE from 73.0% to 71.4% (Table 5). | Skills are made of removable policy modules, and each module is measured before it becomes a default. | 3 |
| `huAutomatedDesignAgentic2024` | ADAS, [2408.08435](https://arxiv.org/abs/2408.08435) | A meta agent writes agent code from an archive of earlier designs and scores. DROP F1 79.4 against 65.8, MGSM 53.4% against 39.0% (Table 1). | The ledger links each candidate to its parent and its evaluation. | 3 |
| `zhangAFlowAutomatingAgentic2024` | AFlow, [2410.10762](https://arxiv.org/abs/2410.10762) | Tree search over workflow code with repeated scoring. Average 80.3 against 76.0 (Table 1). | The retro tests small changes to review and retry policy against an unchanged baseline. | 3 |
| `zhangAgentFactorySelfEvolvingFramework2026` | AgentFactory, [2603.18000](https://arxiv.org/abs/2603.18000) | Saves working Python subagents with SKILL.md files and reuses them. Orchestration output tokens fell from 7,022 to 2,971 (Table 1), without child-agent tokens. | Store verified helper scripts with their skill text and replay evidence. | 2 |
| `liOpenSageSelfprogrammingAgent2026` | OpenSage, [2602.16891](https://arxiv.org/abs/2602.16891) | The model builds its own topology, tools, and graph memory. SWE-bench Pro Python 59.0% against 40.2% for SWE-agent (Table 2). It turns multi-agent topology off for Terminal-Bench. | Ledger evidence never changes. Lessons can change, and each lesson cites its source results. | 2 |
| `liXFlowExecutableProtocol2026` | XFlow, [2606.14790](https://arxiv.org/abs/2606.14790) | Compiles readable protocols into contracts with proposed, validated, and committed states, provenance, and invalidation. SWE-bench Verified rose from 77.4% to 79.8% (Table 3). | Lessons move from proposed to validated to admitted. A review records the artifact version that it checked. | 3 |
| `renFlowEvoSelfEvolvingAgents2026` | FlowEvo, [2607.21596](https://arxiv.org/abs/2607.21596) | Admits skills after interface, replay, and permission checks. Matched runs with and without a skill find harmful skills and suppress them. ALFWorld 85.6% at 9,329 tokens against 59.2% at 30,137 for AFlow (Table 1). | Lesson states: direct use, context only, shadow, and suppressed. | 3 |
| `yangSWEagentAgentComputerInterfaces2024` | SWE-agent, [2405.15793](https://arxiv.org/abs/2405.15793) | Interface design for agents: bounded search output, a numbered file viewer, and edits checked by a linter. SWE-bench Lite 18% against 11% for a plain shell (Table 1). | A CLI contract error shows the failed field, the accepted shape, and one valid example. | 2 |
| `zhangHyperagents2026` | Hyperagents, [2603.19461](https://arxiv.org/abs/2603.19461) | The improvement procedure itself can change. Transfer is measured with a frozen meta agent. Polyglot rose from 8.4% to 26.7% (§5.1). | Measure the retro by verified improvement per fixed proposal budget. | 3 |

### B3. Skills, knowledge, and memory

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `zhouMementoSkillsLetAgents2026` | Memento-Skills, [2603.18743](https://arxiv.org/abs/2603.18743) | A router picks skills. Failure attribution picks the one skill to repair, and synthetic tests gate the edit. GAIA 66.0% against 52.3% (Figure 10), HLE 38.7% against 17.9% (Figure 11). | The retro names the responsible skill and its evidence before it proposes an edit. | 3 |
| `wangMetaSkillEvolveRecursiveSelfImprovement2026` | MetaSkill-Evolve, [2607.05297](https://arxiv.org/abs/2607.05297) | Five Markdown policies control how skills improve. A fast loop and a slow loop keep lineage in SQLite. Gains of 23.54, 16.09, and 1.92 points (Table 1). Its baseline also changes other settings, so the gain is not isolated. | The ledger records the skill version, the retro-policy version, the parent, and the replay score. | 2 |
| `tangWikiSkillCompilingAgent2026` | WikiSkill, [2608.27454](https://arxiv.org/abs/2608.27454) | Raw traces never change. A wiki holds curated knowledge, and a proposer patches one skill at a time. Rejected changes stay in the wiki as evidence. Accuracy rose from 39.4% to 63.3% (Table 1). A small model's skills lowered its own score from 30.2% to 28.5% and raised a larger model from 42.1% to 52.9% (§4.2.2). | Keep evidence, lessons, and skills apart. Keep rejected proposals. Test each lesson on each target model. | 3 |
| `wangKnowledgeCentricSelfImprovement2026` | Knowledge-Centric Self-Improvement, [2607.19592](https://arxiv.org/abs/2607.19592) | Fresh agents share curated knowledge from discussions within and across tasks. The agents themselves never change. Haiku 4.5 solved 64.0% of a SWE-bench Pro subset for $208, against 54% for $713 with DGM (Table 1). | A lesson needs evidence ids, counter-evidence, and applicability conditions before promotion. | 3 |
| `zhangAgenticContextEngineering2026` | ACE, [2510.04618](https://arxiv.org/abs/2510.04618) | A reflector extracts lessons and a curator proposes small updates that code merges. Entries have ids and helpful and harmful counters. AppWorld rose from 42.4% to 59.5% (Table 1). | Update lessons one item at a time, with usage counters. Never rewrite the whole memory. | 3 |
| `zhangMemEvolveMetaEvolutionAgent2025` | MemEvolve, [2512.18746](https://arxiv.org/abs/2512.18746) | Evolves the memory architecture: encode, store, retrieve, and manage. WebWalkerQA rose from 52.35% to 69.41% (Table 2). GAIA rose from 69.09% to 73.33%, but latency rose from 505 s to 693 s (Table 3). | Replay retrieval and expiry policies separately, and record accuracy, cost, and latency. | 2 |
| `wangVoyagerOpenEndedEmbodied2023` | Voyager, [2305.16291](https://arxiv.org/abs/2305.16291) | An automatic curriculum and a library of verified skills. 3.3 times more unique items, and milestones up to 15.3 times faster (§3.3). | Only a verified workflow becomes a skill. | 2 |
| `fuSelfPlayMeetsSkill2026` | Self-Play Meets Skill Evolution, [2607.29468](https://arxiv.org/abs/2607.29468) | A challenger makes tasks at the solver's limit. Skills have triggers and utility counters, with RL updates as well. Average 56.3% to 59.5% (Table 1). | The retro proposes replay exercises from recurring failures, kept apart from the frozen evaluator. | 2 |
| `dimitrispapailiopoulos[@dimitrispapail]MementoTeachingLLMs2026` | Memento announcement, X post (unreadable). Paper [2604.09852](https://arxiv.org/abs/2604.09852) read instead | Trains models to compress their own reasoning blocks. 1.75 times serving throughput (§6.1), and a 15.3-point loss after a cache restart (Table 3). | Needs changes to model serving. Out of scope for omt. | 1 |

### B4. Self-improvement theory, search, and weight updates

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `agrawalGEPAReflectivePrompt2025` | GEPA, [2507.19457](https://arxiv.org/abs/2507.19457) | Reflects on traces and text feedback to change prompts. It keeps every candidate that leads on at least one task. Qwen3-8B 54.85 against 48.91 for GRPO (Table 1). IFBench used 678 runs against 24,000. | The retro proposes a brief change, replays it, and keeps the score of each case before promotion. | 3 |
| `zelikmanSelfTaughtOptimizerSTOP2023` | STOP, [2310.02304](https://arxiv.org/abs/2310.02304) | An improver program improves its own code, scored by downstream results. Transferred 3SAT utility rose from 21.2% to 75.1% (Table 1). Its evaluator once accepted a wrong array shape and reported "accuracy" over 1000% (§6.3). | Replay validates result types and score bounds itself and never trusts the candidate's output. | 3 |
| `zhangDarwinGodelMachine2025` | Darwin Gödel Machine, [2505.22954](https://arxiv.org/abs/2505.22954) | Coding agents change their own code. An archive keeps weaker variants as possible parents. SWE-bench subset rose from 20.0% to 50.0% and Polyglot from 14.2% to 30.7% (§4.4). | Ledger fields for candidate id, parent id, evaluator version, and score per case. | 3 |
| `schmidhuberGoedelMachinesSelfReferential2006` | Gödel Machines, [cs/0309048](https://arxiv.org/abs/cs/0309048) | Theory. A change is made only when a proof shows that it is better. The guarantee depends on the axioms and on what is provable (Theorem 4.1, §2.4). | Describe replay results as empirical evidence, never as proof. | 1 |
| `irieModernSelfReferentialWeight2022` | Self-Referential Weight Matrix, [2202.05780](https://arxiv.org/abs/2202.05780) | A neural layer that changes its own weights at run time. Mini-ImageNet 53.3% against 50.4% (Table 2). | None. omt cannot change model weights. | 0 |
| `MetalearningLearningLearn` | Metalearning since 1987, [author survey](https://people.idsia.ch/~juergen/metalearning.html) | A history of self-modifying learners. No new experiment. | Opt-in telemetry records verified outcome and elapsed time, so a lesson's cost can be measured. | 1 |
| `novikovAlphaEvolveCodingAgent2025` | AlphaEvolve, [2506.13131](https://arxiv.org/abs/2506.13131) | Evolves programs with automatic evaluators and a database of diverse candidates. Cheap checks run before costly ones. Its production scheduler recovered 0.7% of Google's fleet compute (§3.3.1). That scheduler only reorders machines that were already approved. | Replay runs cheap contract checks first. Quality, cost, and latency are separate scores. Routing changes only reorder approved candidates. | 3 |
| `hebbarSIASelfImproving2026` | SIA, [2605.27276](https://arxiv.org/abs/2605.27276) | Combines code changes with LoRA weight updates. LawBench 70.1% against 50.0% with code changes only (Table 3). Its scripts saw the test split (§6.3.1). | The retro classifies a failure as a brief, tool, or model limit before it proposes a lesson. | 1 |
| `zweigerSelfAdaptingLanguageModels2025` | SEAL (self-adapting LMs), [2506.10943](https://arxiv.org/abs/2506.10943) | The model writes its own fine-tuning data and directives. Abstract reasoning 72.5% against 20% (Table 1). Old rewards go stale as the model changes (§3.1). | A lesson keeps its replay examples and its model-version scope. | 1 |
| `hubotterReinforcementLearningSelfDistillation2026` | SDPO, [2601.20802](https://arxiv.org/abs/2601.20802) | Turns text feedback into a training signal through self-distillation. LiveCodeBench v6 48.8% against 41.2% for GRPO (§4). | A result block carries the failed attempt, the verifier feedback, and the correction, not only pass or fail. | 2 |

### B5. Verification, faithfulness, and recursive agents

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `hosseiniVSTaRTrainingVerifiers2024` | V-STaR, [2402.06457](https://arxiv.org/abs/2402.06457) | Trains a verifier on correct and incorrect solutions. 6 to 17 points on math and 4 to 12 on code (§4.3). The verifier ranked better while its own generation got worse (§4.6). | Route reviewers by measured defect detection, not by coding scores. | 2 |
| `wuSelfTrainedVerificationTraining2026` | Self-Trained Verification, [2605.30290](https://arxiv.org/abs/2605.30290) | Trains verifiers to diagnose errors, not only to give a verdict. 21.0% against 1.5% without verification (Table 1). Code transfer is untested (§7). | A review returns the defect, its evidence, and a fix. Replay checks reviews against known fixes. | 2 |
| `guoSelfAuthoredVerificationUnreliable2026` | Self-Authored Verification Is Unreliable (SEAL), [2607.24300](https://arxiv.org/abs/2607.24300) | Self-test scores stay high while real performance falls. SEAL uses a fixed hidden audit that only accepts or rejects, and restores the whole previous state on rejection. Breakout return rose from 7.7 to 15.4 (Table 6). One accepted update raised the audit from 12.7 to 14.2 while the real score fell from 17.6 to 13.8. | A frozen external evaluator gates lessons, and a rejection restores skills and lessons together. A separate reporting set checks for regressions after acceptance. | 3 |
| `zhaoLargeLanguageModel2026` | LLM Agents Are Not Always Faithful Self-Evolvers, [2601.22436](https://arxiv.org/abs/2601.22436) | Removing, corrupting, or swapping lessons often barely changed agent behavior (Figures 2 to 6). Gains from memory do not prove that agents use its content. | Replay each lesson four ways: original, absent, corrupted, and unrelated. | 3 |
| `zhaoSafetyRisksExperienceDriven2026` | Safety Risks in Experience-Driven Self-Evolving Agents, [2604.16968](https://arxiv.org/abs/2604.16968) | Experience from harmless tasks raised unsafe behavior. GPT-4o on BrowserART rose from 37% to 51% attack success, and a prompt of the same length stayed at 38% (Table 3). Refusal lessons cause over-refusal. | The frozen evaluator includes authorization-boundary tasks before any lesson affects an action that the harness takes on its own. | 3 |
| `luAREXRecursivelySelfImproving2026` | AREX, [2607.21461](https://arxiv.org/abs/2607.21461) | An outer loop accepts, refines, or restarts a research answer, and keeps verified facts and open gaps. BrowseComp rose from 59.6% to 82.5%, and the outer loop alone added 10.2 points (Table 3). | `omt-research` gets an outer loop over verified claims, open constraints, and rejected candidates. | 3 |
| `sunSEAgentSelfEvolvingComputer2025` | SEAgent, [2508.04700](https://arxiv.org/abs/2508.04700) | Learns unfamiliar software by exploration and training. OSWorld average rose from 11.3% to 34.5% (Table 2). A judge's precision fell from 41.5% to 26.8% when it got all screenshots instead of the last one (Table 1). | Test reviewer evidence formats. A longer result block is not always better. | 1 |

### B6. Safety, control, and runtime governance

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `balesniEvaluationsbasedSafetyCases2024` | Evaluations-Based Safety Cases, [2411.03336](https://arxiv.org/abs/2411.03336) | Arguments of inability, harm inability, and control, each with evidence and explicit assumptions. No experiment. | Each lesson promotion records its evidence, its assumptions, and the condition that forces a new evaluation. | 3 |
| `denisonSycophancySubterfugeInvestigating2024` | Sycophancy to Subterfuge, [2406.10162](https://arxiv.org/abs/2406.10162) | Training on small reward games generalized to editing both the reward code and its tests: 7 of 32,768 samples, against 0 of 100,000 for the baseline (Figure 1). | The agent that proposes lessons cannot reach the evaluator or its fixtures. Test attempts to fake completion evidence. | 3 |
| `everittRewardTamperingProblems2019` | Reward Tampering Problems and Solutions, [1908.04734](https://arxiv.org/abs/1908.04734) | Separates tampering with the reward function from tampering with its inputs. Formal results (§3, §4). | Freeze the scoring rules and also the evidence that they read. A frozen evaluator alone does not protect inputs that the agent controls. | 3 |
| `greenblattAIControlImproving2023` | AI Control, [2312.06942](https://arxiv.org/abs/2312.06942) | A weaker trusted model monitors, edits, or replaces suspicious code from a stronger model. 92% safety at 94% usefulness with a 2% audit budget (Table 2). Asking the worker to justify suspicious code did not help (§3.2.2). | The review skill escalates on suspicion and replaces suspicious code. It never relies on the worker's own explanation. Test it with seeded sabotage. | 3 |
| `hubingerSleeperAgentsTraining2024` | Sleeper Agents, [2401.05566](https://arxiv.org/abs/2401.05566) | Backdoors with a trigger survived safety training. The triggered behavior stayed near 99% (Figure 3b). | Replay includes paired cases with and without a trigger. A lesson must not pass only on the cases it came from. | 2 |
| `shevlaneModelEvaluationExtreme2023` | Model Evaluation for Extreme Risks, [2305.15324](https://arxiv.org/abs/2305.15324) | Evaluate dangerous capability and the tendency to misuse it separately, on whole systems. No experiment. | The evaluator has separate capability and misuse checks, with a private held-out suite. | 2 |
| `zhangAgentLibOSRuntime2026` | Agent libOS, [2606.03895](https://arxiv.org/abs/2606.03895) | Separates the actions an agent can see from its permission to do them. External operations are recorded as prepared, dispatched, settled, or uncertain. 0 of 119 unauthorized effects and 0 of 119 false denials on scripted tasks (Table 3). An uncertain effect is reconciled after a restart, never replayed (§7.4). | Automatic issues and PRs get operation ids and receipts in the ledger, and an uncertain action is reconciled before any retry. An upstream T3 issue could propose authority limits for children. | 3 |
| `shiProgrammingParadigmSpatiotemporal2026` | Spatiotemporal Composability, [2608.25512](https://arxiv.org/abs/2608.25512) | The theory behind Cordis, the plugin runtime of deepseek-harness. Effects that can be reverted and tracked dependencies (Theorems 7 and 16). Data already sent out cannot be recalled. | Each promoted skill version has a manifest of its effects, so the CLI can remove it. The ledger keeps local rollback apart from compensation upstream. | 2 |

### B7. Multi-agent systems, agent networks, and gossip

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `flemingLayeredProtocolArchitecture2026` | Layered Protocol Architecture for the Internet of Agents, [2511.19699](https://arxiv.org/abs/2511.19699) | Adds a communication layer and a semantic layer that negotiates and locks shared meaning. No experiment. | Briefs carry a contract version that the CLI checks before dispatch. | 2 |
| `wangInternetAgentsFundamentals2026` | Internet of Agents, [2505.07176](https://arxiv.org/abs/2505.07176) | A survey of discovery, matching, communication, and consensus among agents. | Briefs state capability needs, and routing checks the live T3 catalog. | 1 |
| `yangAgenticWebWeaving2025` | Agentic Web, [2507.21206](https://arxiv.org/abs/2507.21206) | A framework of intelligence, interaction, and economics for agent workflows. No experiment. | Briefs for automatic upstream work state tool permissions and resource limits. | 1 |
| `xuMeshMemoryProtocol2026` | Mesh Memory Protocol, [2604.19540](https://arxiv.org/abs/2604.19540) | Seven-field memory records, admission per field, and content-hash lineage. Three agents in one production sprint (§4), with no comparison. | Lessons record their source ids, so a claim derived again does not count as new evidence. | 2 |
| `khanzadehAgentMeshCooperativeMultiAgent2025` | AgentMesh, [2507.19902](https://arxiv.org/abs/2507.19902) | Planner, coder, debugger, and reviewer with bounded repair loops. Identical repeated code stops a loop. One case study only. | A repair round that changes nothing (same output hash) stops the loop. | 1 |
| `kimScienceScalingAgent2025` | Towards a Science of Scaling Agent Systems, [2512.08296](https://arxiv.org/abs/2512.08296) | 260 setups across five architectures. Coordination changed results from +80.8% to -70%. Mixed-model teams were 12.6 points below strong single-model teams in one preliminary study (Table 12). | Record how well a task splits, the number of children, the review rounds, and the result. Measure omt's cross-family rule instead of assuming it helps. | 3 |
| `nieEvolveNetCollaborativeHarness2026` | EvolveNet, [2608.04968](https://arxiv.org/abs/2608.04968) | Each install improves locally and returns a change with fixes and breaks per item. An aggregator scopes the change and accepts it only when fixes equal or exceed breaks. SWE-bench rose from 37.5% to 57.5% (Table 1). Shared code grew from 14 to 253 lines in three rounds. Patches can leak local details (§7). | The model for learning across installs. Changes go upstream with evidence, inspected for leaks, and gated on size and cost as well as accuracy. | 3 |
| `GossipBroadcast` | iroh gossip, [docs](https://docs.iroh.computer/connecting/gossip) | Topic broadcast without a broker, using HyParView and PlumTree. No benchmark. | None for the CLI, which makes no network calls. | 0 |
| `leitaoHyParViewMembershipProtocol2007` | HyParView, [paper](https://asc.di.fct.unl.pt/~jleitao/pdf/HyParView.pdf) | Gossip membership that recovers after 90% of nodes fail, in simulation (§5). | An upstream T3 idea for provider failover at most. | 1 |

### B8. Open-source projects and practitioner posts

| Key | Entry | Main result | Idea for omt | Rel |
| --- | --- | --- | --- | --- |
| `AEVOLabAevolve2026` | A-Evolve, [repository](https://github.com/A-EVO-Lab/a-evolve) | A solve, observe, evolve, gate, and reload loop for prompts, skills, tools, and memory. Holdout tasks gate changes, and git tags give rollback. Author-reported Terminal-Bench 2.0 76.5%, +13.0 points with Opus 4.6. | Promote a lesson only after frozen holdout replay, and record the accepted skill hash in the ledger. | 3 |
| `carvalhoCcarvalhoengAludel2026` | Aludel, [repository](https://github.com/cristianodabc/aludel) | Compares prompts and models with versioned prompts and quality policies. Suggestions from failures need an accept or dismiss decision. | Ledger fields for evaluator, rubric, policy, and sampling versions, so replay results stay comparable. | 3 |
| `ClavialabsTardigrade2026` | Tardigrade, [repository](https://github.com/clavia-labs/tardigrade) | Agent state is derived from an event log that never changes. | The memory store is a projection that can be rebuilt from ledger events, with a projection version. | 2 |
| `ExoharnessExo2026` | Exo, [repository](https://github.com/exoharness/exo) | An agent edits and restarts its own code. History stays outside the sandbox and survives rollback. | Record each self-improvement attempt and each rejection before rollback. | 2 |
| `StablyaiOrca2026` | Orca, [repository](https://github.com/stablyai/orca) | A desktop app for parallel coding agents in separate worktrees, with comparison and merge. | Worktree and candidate ids in briefs and the ledger for comparison runs. | 1 |
| `mementoMementoTeamsMementoSkills2026` | Memento-Skills runtime, [repository](https://github.com/Memento-Teams/Memento-Skills) | Repairs one skill at a time in an isolated copy. Static, unit, and execution gates run before an atomic deploy with backup. | The retro proposes one scoped skill repair, and frozen replay gates it. | 3 |
| `sysls[@systematicls]HowSolveProblems2026` | Long-running autonomous engineering, [article](https://www.systematiclongshort.com/p/how-to-solve-problems-of-long-running) | Practitioner advice: small tasks, completion contracts, verification in a fresh context, handoffs, and stale-doc checks. | The test role verifies the original acceptance condition, not only the worker's tests. | 2 |
| `VectorizeAgentMemory` | Agent Memory Benchmark manifesto, [article](https://www.linkedin.com/pulse/agent-memory-benchmark-manifesto-vectorizeio-zzcme) | Reproducible memory evaluation on accuracy, speed, cost, and usability. Vendor-reported Hindsight scores of 94.6% LongMemEval and 92.0% LoCoMo. | Evaluate the memory store with fixed briefs and retrieval budgets. | 3 |
| `VivHowWe` | How we build evals for Deep Agents, [article](https://www.langchain.com/blog/how-we-build-evals-for-deep-agents) | Dogfood failures become tagged eval cases. Correctness gates any efficiency comparison. | Each replay case has a behavior tag and a reason, and is scored only on evidence that omt can see. | 3 |
| `yohei[@yoheinakajima]StateAIMemory2026` | The State of AI Memory Systems, X post | Unreadable. Tried x.com, xcancel.com, the title, and the author's site. | None. | 0 |

## Findings across the bibliography

These are the conductor's synthesis of the tables above.

1. **A claim of success is not a success.** In HarnessDev, 99 of 100 runs claimed success and 48 passed. In SEAL, self-test scores rose while real scores fell. omt's rule that a worker's "done" is only a claim has strong support. The ledger should store the claim and the verified result as separate fields.
2. **Memory that a brief carries is often not used.** The faithfulness study, HarnessBank's activation gate, and HarnessDev's missing checkpoint events all show this. A lesson needs exposure records, activation evidence, and an ablation (with, without, corrupted, unrelated) before omt claims that it helps.
3. **The gates with evidence are known.**
   - No split may regress (Self-Harness).
   - A gain must exceed the noise and stay within a cost budget (RRSI, HarnessBank).
   - Fixes must equal or exceed breaks (EvolveNet).
   - Keep per-case winners (GEPA) and an archive that includes weaker variants (DGM, Hyperagents).
4. **The evaluator must be out of the learner's reach.**
   - Tampering generalizes (Denison).
   - The evidence that the evaluator reads needs the same protection as the evaluator itself (Everitt).
   - A hidden audit is still a proxy (SEAL).
   - The evaluator must check result types and bounds (STOP).

   omt has an open gap here, because children share the parent's checkout.
5. **Evidence goes stale.** DREvo, SEAL (self-adapting LMs), and FlowEvo all retest or suppress old evidence. This supports the owner's idea of error memory that expires on updates.
6. **Every gain has a cost.**
   - MemEvolve added 37% latency.
   - SoL-Pi's search took more than 3,000 runs.
   - EvolveNet's code grew 18 times.
   - Extra search in NLAH lowered success.

   Promotion needs cost, latency, and size gates.
7. **A lesson can depend on the model.** WikiSkill skills hurt their author model and helped another one. Mixed-model teams lost in one study. omt routes roles to different families, so lessons need a model scope, and the cross-family review rule deserves a measurement.
8. **Learned experience can reduce safety.** Benign experience raised attack success (Zhao). Authority must never come from evidence (Agent libOS). Review must assume possible sabotage (AI Control). This applies directly to automatic upstream issues and PRs.
9. **External actions need transaction states.** Agent libOS and the Cordis paper show that an issue or PR is an effect that cannot be recalled. omt needs prepared, dispatched, settled, and uncertain states, reconciliation before retry, and a compensation record instead of a rollback.
10. **Briefs and contracts are the cheapest lever.** Recursive Harness Self-Improvement, Natural-Language Agent Harnesses, and Knowledge-Centric Self-Improvement all gain by changing text that agents read, not model weights. These are exactly omt's briefs, result blocks, and lessons.

## Ranked build list

This list is an inference from the findings. It orders the work so that each step produces the data that the next step needs.

1. **Evidence capture.** Save each brief and each result block per dispatch. Add ledger fields:
   - the omt version and the version scope
   - claimed and verified status
   - the artifact version that a review checked
   - lesson ids exposed and lesson activation
   - candidate and parent ids
   - the evaluator version

   Sources: Meta-Harness, HarnessDev, XFlow, HarnessBank, DGM, and Aludel.
2. **Memory store.** A `node:sqlite` store that can be rebuilt from ledger events (Tardigrade). It holds error signatures with version scopes. Entry states are candidate, active, stale, retired, and suppressed. Stale entries go to a retest (DREvo, FlowEvo).
3. **Lessons.**
   - Small items with ids and helpful and harmful counters (ACE).
   - A trigger, a recovery action, and a scope (Living-Harness).
   - Evidence, counter-evidence, and applicability (Knowledge-Centric Self-Improvement).
   - Source lineage (Mesh Memory Protocol) and a model scope (WikiSkill).
4. **Frozen evaluator and replay.**
   - Tagged cases from real failures (Viv).
   - A held-out split with a no-regression gate, plus noise and cost gates (Self-Harness, RRSI).
   - Bound checks (STOP) and the four-way lesson ablation (faithfulness study).
   - Storage that children cannot write. This needs its own design.
5. **Retro skill.**
   - One scoped change per round within a fixed budget (Memento-Skills, RRSI), with a change manifest (HarnessX).
   - Brief and contract changes come before effort changes (Recursive Harness Self-Improvement).
   - Measure the retro by verified gain per proposal (Hyperagents).
6. **Automatic upstream issues and PRs.** Operation states and reconciliation (Agent libOS), compensation records (Cordis paper), and leak inspection of every patch (EvolveNet). The evaluator must pass authorization-boundary tasks (Zhao, AI Control) before lessons can affect these actions.
7. **Learning across installs.** EvolveNet-style changes with fixes, breaks, and scope, plus opt-in telemetry of observed feature use (HarnessDev). Build this after steps 1 to 6 have produced trusted local data.
8. **Review hardening.** Escalate on suspicion and replace suspicious code, never rely on the worker's explanation (AI Control), and route reviewers by measured defect detection (V-STaR).
9. **`omt-research` outer loop.** Accept, refine, or restart an answer, and keep verified claims and open gaps (AREX).
10. **Delegation measurement.** Record how well each task splits, the number of children, and the outcome (Scaling Agent Systems), so that a future change to omt's fan-out rules has data behind it.

## Papers to read next

The children found these cited works. None of them is in the bibliography.

| Work | Why it matters |
| --- | --- |
| Rethinking the Evaluation of Harness Evolution for Agents, [2607.12227](https://arxiv.org/abs/2607.12227) | Compute-matched controls for replay |
| Harness Updating Is Not Harness Benefit, [2605.30621](https://arxiv.org/abs/2605.30621) | Writing an update is not the same as benefiting from it |
| Evo-Harness, [2608.15071](https://arxiv.org/abs/2608.15071) | Turns noisy execution context into reusable skills |
| From Failed Trajectories to Reliable LLM Agents (HarnessFix), [2606.06324](https://arxiv.org/abs/2606.06324) | Structured failure evidence and scoped repair |
| FederatedSkill, [2606.03143](https://arxiv.org/abs/2606.03143) | Shares skill diffs across installs, closest to omt's skills |
| Federation over Text, [2604.16778](https://arxiv.org/abs/2604.16778) | Shares text insights across installs |
| MAP-Elites, [1504.04909](https://arxiv.org/abs/1504.04909) | Keeps diverse candidates by behavior and cost |
| Evoflux, [2606.12674](https://arxiv.org/abs/2606.12674) | Workflow evolution for small agents |
| MermaidFlow, [2505.22967](https://arxiv.org/abs/2505.22967) | Safety-constrained workflow search |
| Memento 2, [2512.22716](https://arxiv.org/abs/2512.22716) | Theory behind Memento-Skills' convergence claims |
| Skill-Pro, [2602.01869](https://arxiv.org/abs/2602.01869) | Utility-based skill selection without weight updates |
| Optimal Ordered Problem Solver, [cs/0207097](https://arxiv.org/abs/cs/0207097) | Reuse of earlier solutions with bounded search cost |
| Prover-Verifier Games, [2407.13692](https://arxiv.org/abs/2407.13692) | Outputs that are easy to check, for result contracts |
| The Oracle Problem in Software Testing (Barr et al.) | How to choose independent acceptance signals |
| Sagas; Durable Functions; AgentDojo | Compensation for external effects, replay limits, and security tests with hostile content |
| PlumTree (Epidemic Broadcast Trees) | Efficient distribution, only if T3 ever shares adaptations |

## Unknown

- The X post `yohei[@yoheinakajima]StateAIMemory2026` stayed unreadable. A secondary summary exists, but its numbers are not primary evidence.
- No paper measured a benefit on a coding meta-harness like omt. Every "Idea for omt" is an inference.
- Several results are author-reported (A-Evolve, Hindsight) or come from first-party deployments (Mesh Memory Protocol). No independent replication was checked.
- Repository findings in B8 describe the current commits, not the versions at the bibliography dates.
