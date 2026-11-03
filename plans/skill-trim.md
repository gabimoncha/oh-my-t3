# Plan: trim the shipped omt skills

Status: ready to build. Reviewed once (GPT-6 Astra, high effort, REQUEST_CHANGES with 16 blockers). Blockers B1 to B15 are fixed in this text, with no second review, because the owner asked for exactly one. The owner answered B16 (the three questions) and approved the `## Tests` list on 2026-11-03.

## Summary

- The skills in `skills/` drop from 36,603 words to about 15,300. Every workflow that the owner uses stays: explore, ask, plan, build, review, and test.
- Most cut text is bookkeeping. The CLI takes it over: one command before each `delegate_task` call and one after it, and git commands that record the run's start, commit only the run's paths, open a draft PR or a PR stack, and catch a branch up.
- `omt-grill` folds into `omt-plan` as an optional step. `omt-help` merges into `omt-setup`. `omt-swarm` stays in the package but installs only on request.
- PRs open as drafts. Git stays automatic: on a branch that is not the default branch, the agent commits and opens PRs with no question. A commit to the default branch, a merge, and another owner's repo or PR still ask. The PR extras of `omt-code-review` turn off by default.
- The work is 16 units, built in order. U16 is a small separate fix that goes first: the Claude Code hook starts ultrawork only on "start ultrawork" or "start ulw", not on the bare word. Units U1 to U4 change the CLI and the config, U5 to U13 rewrite the skills and their tests, and U14 and U15 update the docs and the site.
- Main risk: about 970 test assertions pin exact skill sentences today. The rewrite replaces most of them with structure checks, a short list of safety rules, and word budgets. A safety rule that the list misses can disappear without a failing test.
- Owner decisions: settled. Git defaults stay automatic (1c), the PR extras turn off (2a), the personas are cut (3a), and the test list is approved.
- Not in this plan: the `t3_thread_configure` rename, the user-rules-win rule, and the integration-test default (all on `t3/omt-small-fixes`), profiles (they stay), and the owner's uncommitted git triage work.

## Objective

Cut the shipped skill text to about 15,000 words. Move each bookkeeping step that the model does by hand into a CLI command, so that each skill keeps only its workflow decisions.

## Done when

- [ ] D1. A skill dispatch takes three calls: `omt brief ... --save --json`, `delegate_task`, and `omt ledger done <requestId>`. An integration test shows that `omt brief` records the start, that a brief at the parallel limit exits 75 and writes nothing, that a resend of the same request at the limit does not exit 75, and that `omt ledger done <requestId> --task-id t1` closes the start, so `omt ledger stats` reports `active: 0`.
- [ ] D2. `omt git commit` commits only the paths that the run changed, new files included. In an integration test, a file that was already changed before `omt git start` stays out of the commit, a new file goes in, `--path` limits the commit to the named paths, and an `ask` policy prints `ask: <reason>` and commits nothing.
- [ ] D3. `omt git pr` opens a draft PR by default and a ready PR with `--ready`. With more changed files than a `maxPrFiles` above 0, it prints `split: ...` and pushes nothing. With `maxPrFiles: 0`, it has no limit. An `omt git stack` with one oversized slice pushes nothing. The tests use a fake `gh`.
- [ ] D4. A default install does not install `omt-swarm`, and `omt install --with omt-swarm` installs it. The package has no `omt-grill` and no `omt-help` folder.
- [ ] D5. `test/skills/budget.test.ts` passes. Each skill file is at most 110% of its target in the word table. All files in `skills/` together have at most 16,000 words.
- [ ] D6. No file in `skills/` outside `skills/omt-swarm/` contains `gh pr checks <n> --watch`, `ready PR`, the banner `omt ultrawork:`, `t3_thread_configuration`, `ledger.dispatched`, `omt ledger add`, `shasum`, or `t3_thread_wait`. A test checks each string. `omt-swarm` keeps `omt ledger add` and `t3_thread_wait` for its top-level track threads (B14), and drops only the other strings.
- [ ] D7. `mise exec -- bun run verify` passes.
- [ ] D8. `omt hook user-prompt-submit` prints the ultrawork context for `start ulw add rate limiting` and `Start ultrawork: fix the login`, and prints nothing for `what does ulw do?`, `ulw add rate limiting`, `don't start ulw`, and `start ulw` inside backticks, double quotes, a `>` line, or a code fence.

## Decisions

Owner decisions are the numbered questions at the end. The decisions below are settled from the code, the T3 tool contract, and the brief.

- MD1. Children are not awaited inside the turn. Today the skills say to wait with `mode: "wait"` or `t3_thread_wait`, because writes fail after the turn ends (`skills/omt/references/delegation.md:151-159`). The T3 tool now says the opposite. In this thread, `delegate_task` returned `next: "Completion wakes this thread, so end your turn. Do not wait on it or poll it."`, and one wake delivered all three explore results. The skills say: use `mode: "wait"` when the next step needs the result; otherwise follow the `next` field of the T3 result.
- MD2. The settle sweep shrinks to one case. omt children at the default `maxDepth` 1 start no children, so the main thread settles each child once, right after `omt ledger done`. The skill keeps today's condition: `task_status` shows a terminal status, `hasPendingChildRuns: false`, and `hasPendingQuestion: false`. `omt ledger done` prints `settle: allowed`, or `settle: no (linked worktree)` in a linked worktree, which moves the `git rev-parse --git-dir --git-common-dir` check (`delegation.md:192`) into the CLI. `omt ledger settle-check` prints the same line and writes nothing, for plan mode. When `limits.maxDepth` is above 1, children settle their own children (the `Children:` brief line, `src/brief/render.ts:46`), and before the report the main thread settles each finished thread below a failed or cancelled child, found with `t3_thread_list` and `includeSubagents: true`.
- MD3. The skills require the CLI. They drop the manual resolution path: "Resolve by hand" in `roles.md`, the hand-written brief layout in `brief.md`, and the "without the CLI" branches. Users always install the CLI (`AGENTS.md`, first section), and the CLI installs the skills. When no CLI is found, a skill points to `docs/agents/quickstart.md` and stops. Spec §15.1 drops its CLI-fallback rule.
- MD4. The grill becomes a main-thread step in `omt-plan`, with no `grill` child and no grill file. The cross-family plan review already gives a second opinion. In U8, the `grill` role goes to `RETIRED_ROLES` (`src/config/defaults.ts:8`), the `grill` result kind leaves `RESULT_KINDS` (`src/types.ts:10`), and `roles/grill.md` and `results/grill.md` go. `omt paths --grills` and the `grills/` gitignore line stay, so old grill files stay readable.
- MD5. The rule "only Claude Opus draws or builds UI" moves into config through the role chains. The skill rule becomes: run `omt route <design|ui> --json`. When `delegateTask.target.model` is your own model, do the work yourself. Otherwise dispatch the routed child. The default chains of `design` and `ui` already start on `claude-opus-5-5` (spec §6.4). The Paper rule moves to a new key `workflow.design.tool`: `paper` (the default: Paper when its tools load, else HTML mockups) or `html`.
- MD6. PRs open as drafts. `omt git pr --ready` opens a ready PR when the user's message or `AGENTS.md` asks for one. The user-rules-win rule from `t3/omt-small-fixes` covers this case, so the change adds no config key.
- MD6a. User instructions and the git policy (B11). `--yes` on `omt git commit` and `omt git pr` means the user approved this action in this run, by an answer or by an explicit request in their message. It turns an `ask` or an `off` into a go. A rule in the user's own instruction file (`AGENTS.md` or `CLAUDE.md` that the user wrote) counts as approval only for a policy decision, where the output names a `workflow.git` key. It never counts for an ownership decision (another owner's repo, another author's PR), for a path problem, or for a force push. The CLI never rewrites the user's config.
- MD7. `omt-swarm` is opt-in. On the next `omt update`, an unedited installed copy without an opt-in record counts as retired and goes away by the existing retired-skill rules (`src/install/plan.ts:670`). An edited copy gives a conflict, as today.
- MD8. Plan hashes go. The reviewer reads the plan file at its path. One checkout holds the plan, and no other writer changes it during a review.
- MD9. Fixed report formats become lists of contents. Examples: the ulw step 12 report, the code-review evidence file, the research answer, and the plan hand-off. Result blocks of children stay fixed, because the main thread parses them.
- MD10. Profiles stay. They are not in the approved verdicts. The skills name `--profile` once, and `omt brief` applies the profile's limits itself. That removes the four-bullet "selected profile and no plan file" block from `omt-plan`, `omt-design`, and `omt-grill`.
- MD11. The CLI does the fallback. `omt brief ... --fallback` picks the first target in the resolved routing order that this unit, role, and round have not tried yet, and closes the superseded attempt. In default mode the ledger holds the tried targets. In plan mode the agent passes them back with `--tried <targetKey>`. `--strict` stops when the only target left is in the `--against` family. This replaces the manual rung steps (`roles.md`, "Fall back to the next rung") and the family checks in four skills.
- MD12. The branch check (`delegation.md:37-52`) becomes `omt git behind [--ff]`.
- MD13. The CLI runs `gh` for the login, the PR authors, and the PR calls. `AGENTS.md` ("Dependencies") and spec §5.15 ("makes no network call") change to say that `omt git commit` and `omt git pr` run `gh` and `git push`, which contact the git host.
- MD14. The `omt` router drops its CLI table and says: run `omt help` and `omt help <command>`. That command exists today.
- MD15. `omt-setup` drops the 5-step tour of `omt-help`. It keeps the answer path (sort the question, answer from CLI output, link one doc) and the write rules.

## Research

Facts from the explore children (E1 to E3) and my own reads. I checked one citation from each child.

- `omt brief --save --json` saves the brief and prints `delegateTask`, `fallbacks`, and a `ledger.dispatched` command with a `<taskId>` placeholder (`src/commands/brief.ts:182-200`, spec §5.4). The request id is `omt:<plan>:<unit>:<role>:r<round>:a<attempt>` (`src/ledger/ledger.ts:127`, spec §10).
- A terminal ledger entry closes a dispatched entry by `taskId`, or without a `taskId` by plan, unit, role, round, and attempt (`src/ledger/ledger.ts:28-35`, checked). A dispatched entry without a `taskId` is allowed and only warns (spec §5.6). A terminal entry with a `taskId` cannot close a start that has none. So `closes()` needs a `clientRequestId` match.
- `ledgerStats()` does not call `closes()`. It builds its own task-id and identity indexes (`src/ledger/ledger.ts:95-124`), so any new matching rule must change both. `isCompleteDefaults()` rejects an accepted snapshot that lacks any key of `WORKFLOW_RULES` except the `git` group (`src/config/defaultsState.ts:45-55`). `test/skills/common.test.ts:57-58` lists the expected skill folders, `omt-grill` and `omt-help` included. `omt-swarm` uses `t3_thread_wait` and `omt ledger add` for its top-level track threads (`skills/omt-swarm/SKILL.md:95-99`). (All from the review, checked.)
- `active` counts open starts; `canDispatch` is `active < maxParallel`. `omt ledger stats` has no `--profile` flag (spec §5.6), which is why the skills compare limits by hand before a plan file exists.
- No CLI command reads T3 state. The CLI cannot call T3 tools (E1).
- `omt git check` decides only and writes nothing. It takes `--user`, `--host`, and `--pr-author` from the skill (`src/commands/git.ts:12-88`, spec §5.15). No code calls `gh` (E2). Default-branch discovery is in `src/git/branch.ts`.
- The `normal` profile sets `branchCommits: auto` and `pullRequests: auto` (`src/config/defaults.jsonc:32-39`). It also turns on every PR extra: `ci: fix`, `verify: changed-flows`, `tests: offer`, `guardrails: propose`, `crap: report` (`src/config/defaults.jsonc:21-31`). The brief says these extras are off by default. They are not.
- "Ready PR" is in `delegation.md:80`, `docs/workflows.md:76`, and spec §15.1. The only `gh pr checks --watch` is `delegation.md:242`.
- The installer installs every folder in `skills/` that has a `SKILL.md`, with no exclusion (`src/install/skills.ts:27-44`, checked). Retired skills go away by manifest comparison (`src/install/plan.ts:670`, `test/install/retired.test.ts`).
- `src/brief/templates.ts` renders the role persona and the result contract into each brief, so persona text costs words in every child brief (E3).
- Tests pin skill text: about 285 assertions in `code-review.test.ts`, 223 in `ulw.test.ts`, 167 in `personas.test.ts`, 143 in `plan-design.test.ts`, 58 in `grill.test.ts`, 39 in `swarm.test.ts`, 29 in `git-policy.test.ts`, 15 in `common.test.ts`, and 13 in `research.test.ts` (E3). `common.test.ts` holds the structure checks: names, frontmatter, descriptions of at most 1,024 characters, and links that resolve.
- Other places name the retired skills: `README.md:94`, `docs/install.md:8`, `docs/configuration.md`, `docs/workflows.md`, `docs/design.md`, spec §2 and §15.2, and the site (`site/src/components/SkillTour.tsx`, `scenes.ts`, `HeroRuns.tsx`). `docs/architecture.html:450` and `:531` show the ulw banner.
- The Claude Code hook matches the bare words `ulw` and `ultrawork` anywhere in a prompt (`src/hooks/userPromptSubmit.ts:3`, spec §13 rule 5). It already skips child briefs, prompts that start with `/omt-ulw`, task notifications, code, quotes, `>` lines, and negated matches (spec §13 rules 1 to 4 and 6). In this thread, the hook fired on the owner's message that only described this bug, and it told me to load `omt-ulw`. `$omt-ulw` never matches, because `-` comes before `ulw`. The context text names the banner that U7 removes (`src/hooks/userPromptSubmit.ts:69`).
- `t3/omt-small-fixes` changes `plan.testLayers` to `["integration"]` and rewrites the test-line bullets of `omt-plan` step 3 and `planning.md`. This plan starts from that text.

## Word targets

| File | Now | Target |
| --- | ---: | ---: |
| `omt/SKILL.md` (router) | 1,121 | 300 |
| `omt-ulw/SKILL.md` | 3,243 | 1,800 |
| `omt-plan/SKILL.md` (with the grill step) | 2,237 | 1,300 |
| `omt-research/SKILL.md` | 784 | 700 |
| `omt-code-review/SKILL.md` | 4,475 | 1,100 |
| `omt-code-review/pr-extras.md` (new) | 0 | 350 |
| `omt-design/SKILL.md` | 1,378 | 700 |
| `omt-setup/SKILL.md` (with help) | 1,486 | 1,000 |
| `omt-swarm/SKILL.md` | 2,380 | 1,500 |
| `omt-grill/SKILL.md` | 2,150 | deleted |
| `omt-help/SKILL.md` | 1,142 | deleted |
| `omt/references/delegation.md` | 5,136 | 1,600 |
| `omt/references/roles.md` | 1,768 | 500 |
| `omt/references/brief.md` | 1,689 | 300 |
| `omt/references/results.md` | 1,301 | 500 |
| `omt/references/worktrees.md` | 863 | 500 |
| `omt/references/planning.md` | 500 | 350 |
| `omt/references/frontend-design.md` | 277 | deleted (2 lines move to `omt-design` and `roles/ui.md`) |
| `omt/references/roles/*.md` (12 after `grill.md` goes) | 4,356 | 2,600 |
| `omt/references/results/*.md` (6 after `grill.md` goes) | 317 | 240 |
| Total | 36,603 | about 15,340 |

The owner chose the persona trim (answer 3a).

## New and changed CLI commands

All commands follow the existing rules: decisions exit 0 and print one first word, usage errors exit 2, and other failures exit 1.

### `omt brief` (changed, spec §5.4, §10)

With `--save --json`, `--plan`, and `--unit`, the command now also does these steps, in this order, while it holds an exclusive lock on the ledger (`<omt>/locks/ledger.lock`, created with `open(path, "wx")`, retried for up to 5 seconds; a lock file older than 30 seconds counts as stale). The lock stops two concurrent briefs from both taking the last slot (B1).

1. Resend. When an open start with the same `clientRequestId` exists, it saves the brief again, prints the same output, and records nothing. It makes no limit check. This is a resend after a lost response.
2. Fallback. With `--fallback`, it closes the latest open start of the same plan, unit, role, and round as `failed`, with the note `superseded by attempt <n+1>`.
3. Limit. It resolves the profile (`--profile`, else the plan header, else the config) and its `limits.maxParallel`, lowered by a plan header `max-parallel`, and counts `active` for the plan. When `active` is at the limit, it prints `limit: <active> of <max> children are active; run this command again after one ends` to stderr, writes nothing, and exits 75 (the same code as a busy `omt lock`).
4. Save. It saves the brief, as today.
5. Record. It appends a `dispatched` entry with plan, unit, role, round, attempt, `clientRequestId`, provider, model, and the new field `targetKey`, with no `taskId`.
6. Output. It prints `targetKey` and `ledger.done` in place of `ledger.dispatched`: `<cli> ledger done <clientRequestId> --verdict <VERDICT>`.

A target key names one target in the resolved order, such as `codex/gpt-6-astra` or `instance:codex/gpt-6-astra`. The resolved order is the routing order after the `--against` reorder (spec §8.3). In it, a rung that names only a driver gives two targets: first the `driverKind` target, then the same rung with `providerInstanceId` set to the driver.

New flags:

- `--fallback`: use the first target in the resolved order whose key is not tried yet. With `--save`, the tried keys are the `targetKey` values of the earlier attempts of the same plan, unit, role, and round in the ledger. The attempt is the highest earlier attempt plus 1. `--fallback` and `--attempt` exclude each other in this form. With no target left, it exits 1 with `no fallback left for <role>; tried: <keys>`.
- `--tried <targetKey>` (repeatable): for plan mode, without `--save`. It gives the tried keys, because nothing is recorded. With `--fallback` and without `--save`, `--attempt` is required.
- `--strict`: used with `--against <provider|driver>`. When the chosen target is in the `--against` family, the command exits 1 with `no <role> target outside <family> is left`.

Without `--save`, the command writes nothing and makes no limit check. Plan-mode skills use this form and keep at most `maxParallel` children at once themselves.

### `omt ledger done <id>` (new, spec §5.6)

- `<id>` is a `clientRequestId` or a recorded `taskId`.
- Flags: `--verdict <word>`, `--status completed|failed|cancelled|interrupted` (default `completed`), `--task-id <id>` (recorded on the terminal entry), and `--note <text>`.
- It finds the open start with that id. With no match, it exits 1 with `no open child matches <id>` and writes nothing.
- It appends the terminal entry with the same plan, unit, role, round, attempt, and `clientRequestId`.
- It prints `closed <unit> <role> r<round> a<attempt>`, then `settle: allowed` or `settle: no (linked worktree)`.

One matching function in `src/ledger/ledger.ts` decides whether a terminal entry T closes a start D, and both `closes()` and `ledgerStats()` use it (B2):

1. When T and D both have a `clientRequestId`, T closes D only when the two are equal.
2. Otherwise, when T has a `taskId`, T closes D only when D has the same `taskId`.
3. Otherwise, the five-field rule of spec §5.6 applies (plan, unit, role, round, attempt).

`ledgerStats()` builds a third index of terminal request ids for rule 1. A test records a start without a task id, closes it with `ledger done <requestId> --task-id t1`, and checks `active: 0` in `ledger stats`.

`omt ledger settle-check` prints only the `settle:` line and writes nothing.

`omt ledger add`, `list`, `stats`, and `request-id` stay for older skills and for the `omt-swarm` track entries.

### `omt git behind [--ff]` (new, spec §5.15)

It finds the default branch with `src/git/branch.ts` and counts `git rev-list --count HEAD..<full ref>`. It makes no fetch.

- `up to date with <name>` when the count is 0.
- With `--ff`, a clean tree, and `HEAD` an ancestor of the ref: it runs `git merge --ff-only <ref>` and prints `fast-forwarded <n> commits from <name>`.
- Otherwise: `ask: <n> commits behind <name>; <reason>`.
- With no default branch: `skipped: no default branch found`.

### `omt git start (--plan <slug> | --run <id>) [--force]` (new)

The skills run it before the first edit of a run: `omt-ulw` at the start of step 6 (before a design pass writes files), `omt-design` when it runs alone, at the start of step 2, and `omt-code-review` before the first fix, CI fix, or approved test (B7).

It writes `<git dir>/omt/start-<id>.json` in the current checkout's own git dir: `HEAD`, and each changed or untracked path with the SHA-256 of its content (or `deleted`). It reads the paths from `git status --porcelain=v1 -z --untracked-files=all`. When the file exists, the command keeps it and prints `kept the start from <time>`, so that a resumed run does not count its own edits as older changes. `--force` replaces the file. Otherwise it prints `start saved: <n> paths were already changed`.

### `omt git commit -m <message> (--plan <slug> | --run <id>) [--profile <name>] [--path <path>]... [--yes] [--include <path>]...` (new)

1. Policy. It runs the `commit` decision of `omt git check`, with the profile from `--profile`, else the plan header, else the config. It reads `--host` from the `origin` URL, the login with `gh api --hostname <host> user -q .login`, and the PR authors with `gh pr list --repo <host>/<owner>/<repo> --head <branch> --state open --json author,headRefName,headRepositoryOwner --limit 100`. A repo with no `origin` needs no `gh`. A `gh` failure, or a list of 100 PRs, gives `ask: <reason>`.
2. `off` prints `off: <reason>` and commits nothing. `ask` prints `ask: <reason>` and commits nothing. `--yes` turns either into a go (MD6a). A policy decision prints its key, as in `ask: workflow.git.branchCommits is ask`.
3. Owned paths. These are the paths changed now, minus each start path whose content hash did not change. A start path whose content changed gives `ask: <path> had changes before the run, and the run changed it too`. Only `--include <path>` adds it, and `--yes` does not. With no start file, the result is `ask: no start record; run omt git start before the first edit`.
4. Selection. With `--path` (repeatable), the commit takes only the owned paths that the `--path` values name. A `--path` that names no owned path gives `ask: <path> is not a path that this run changed`. This keeps one commit per fix in `omt-code-review`.
5. Stage new files. It runs `git add -- <selected untracked paths>`, so that `git commit --only` knows them (B6). It stages nothing else, and other staged changes stay as they are.
6. Check. `git commit --dry-run --porcelain --only -- <selected>`. A path that the commit would take and that is not selected gives `ask: the commit would also take <path>`. Then it runs `git reset -q -- <the new files of step 5>`, so the refusal leaves the index as it was.
7. Commit. `git commit --only -m <message> -- <selected>`. It prints `committed <short sha>: <n> files`, then one `left: <path>` line for each path that was already changed before the run.

### `omt git pr --title <text> --body-file <file> (--plan <slug> | --run <id>) [--profile <name>] [--base <branch>] [--ready] [--yes] [--force-with-lease]` (new)

1. Policy. It runs the `push` and `pr` decisions with the login and the PR authors, as in `omt git commit`, and with the same profile selection, `--profile` included (B8). `ask`, `off`, and `--yes` work the same way.
2. Base. The base is `--base`, else the base of the open PR, else the default branch. With none, the result is `ask: no base branch`.
3. Size. The limit is `maxPrFiles` from the profile. `0` or `null` means no limit, and the command skips this step (B10). Otherwise it runs `git fetch origin <base>`, then `git diff --name-only origin/<base>...HEAD`. A failure gives `ask: cannot count the changed files: <message>`. A failure never counts as 0 files. Over the limit, it prints `split: <n> files, limit <m>; pick cut commits and run omt git stack <sha>,...` and pushes nothing.
4. Push. It runs `git push origin HEAD:<branch>`, with `--force-with-lease` only when that flag is given. The skill passes that flag only after the user's yes for a force push in this run. A rejected push gives `ask: the push was rejected: <first line>; a force push needs the owner's yes`.
5. PR. With an open PR from the branch, it prints `updated <url>`. Otherwise it runs `gh pr create --repo <host>/<owner>/<repo> --base <base> --head <branch> --title <text> --body-file <file>`, with `--draft` unless `--ready` is given, and prints `created <url> (draft)` or `created <url> (ready)`.

### `omt git stack <sha>,<sha>... --title <text> --body-file <file> (--plan <slug> | --run <id>) [--profile <name>] [--base <branch>] [--ready] [--yes]` (new)

A separate command, so that no push happens before the whole stack is valid (B9). Each sha is the last commit of a lower slice, bottom first. The top slice ends at `HEAD` and keeps the run's branch.

1. Validate, with no change. Each sha is an ancestor of `HEAD`, and each is an ancestor of the next. Each slice changes at most `maxPrFiles` files against the slice below (no limit for `0` or `null`). The slice branch names `<branch>-<k>` do not exist on the remote, or exist at the same commit. The `push` decision passes for each slice branch, and the `pr` decision passes for the run. Any failure prints `split:` or `ask:` with the reason and changes nothing.
2. Push. It creates `<branch>-<k>` at each cut and pushes each one with `git push origin <slice>:<slice>`, then pushes the top with `git push origin HEAD:<branch>`.
3. PRs. It opens each lower PR with its base set to the slice below, as a draft unless `--ready` is given. Each lower PR gets the body `Part <k> of <n>: <title>` and the commit subjects of the slice. The top PR uses `--body-file`. An open top PR gets its base changed with `gh pr edit --base`.
4. Link. When `gh stack --help` works, it runs `GH_REPO=<host>/<owner>/<repo> gh stack link --base <base> <numbers>`. Otherwise it prints `note: gh stack is not installed; the PRs have chained bases only`.
5. It prints one `created` or `updated` line per slice, bottom first.

The skills keep three git rules as text: follow the repo's commit conventions, children never commit or push or create branches, and run the tests at each cut before `omt git stack`.

### `omt install --with <skill>` (changed, spec §14)

`src/install/skills.ts` gets `OPT_IN_SKILLS = ["omt-swarm"]`. A default install and `omt update` skip an opt-in skill. `--with <skill>` (repeatable) installs it. The selection goes through the install plan to `src/install/apply.ts`, which writes `optIn: [<names>]` into the manifest, so later updates keep it. `retiredSkills()` in `src/install/plan.ts` and the skills check in `src/install/doctor.ts` read the scope's `optIn`. Doctor does not report an unselected opt-in skill as `missing`, and does not report a selected one as `no longer shipped` (B13). `--with` with a skill that is not opt-in exits 2.

### Config (spec §6.4, §6.7)

- The `workflow.git` values stay as they are (answer 1c): `branchCommits: auto`, `pullRequests: auto`, `defaultBranch: ask`, `merge: ask`, `owners: []`, `maxPrFiles: 100`. The ownership checks of spec §5.15 step 2 still give `ask` for another owner's repo, a push URL to another repo, and another author's PR. The owner's reason: an agent cannot work on its own if it must ask before each commit and PR. The only PR change is the draft default in `omt git pr` (MD6).
- `workflow.review.ci`, `verify`, `tests`, `guardrails`, and `crap` become `off` in `normal` (answer 2a).
- A new key, `workflow.design.tool`: `paper` or `html`, with the default `paper`. `src/config/defaultsState.ts` fills a workflow key that an older accepted snapshot lacks from the current defaults before `isCompleteDefaults()` runs, so an old snapshot stays valid. The defaults review lists the key as `none -> paper` (B12).
- In U8, the `grill` role goes into `RETIRED_ROLES`, and the `grill` result kind leaves `RESULT_KINDS`. A config role with `result: "grill"` gets a retired-value issue.
- The defaults review (spec §5.12) shows these changes to existing users, who accept them or keep their old defaults.

## Roles

All units are `main` except U14 and U15 (`writing`). The main thread builds U16 first, then U1 to U15 in order. U2 and U4 have disjoint scopes from each other, and the main thread can send one of them to an `execute` child while it builds the other.

## Tests

Layer default after `t3/omt-small-fixes`: `integration`. CLI tests run the CLI as a child process with `HOME`, `TMPDIR`, `OMT_*`, `XDG_*`, `CLAUDE_*`, and `T3CODE_*` set to temp paths (`AGENTS.md`, "Tests").

- integration U1: brief records a start; a brief at the limit exits 75 and writes nothing; a resend of an open request at the limit prints the same output; two briefs started at once with one slot left give one start and one exit 75; `ledger done <requestId> --task-id t1` closes a start that has no task id, and `ledger stats` shows `active: 0`; `--fallback` closes the superseded attempt and follows the resolved order for a custom chain `codex, claudeAgent, codex` with `--against codex`; `--fallback --tried` works without `--save`; `--strict` stops on the `--against` family. File: `test/commands/brief-ledger.test.ts`. Reason: catches a start that never closes, which blocks every later dispatch, and a review that runs on the author's own family.
- integration U2: `git start`, then edits and one new file, then `git commit` in a temp repo with one file that was already changed before the start; then two commits with `--path`; a staged change of another session stays staged and out of the commit. File: `test/git-commit.test.ts`. Reason: catches a commit that takes another session's changes.
- integration U2: `git pr` with a fake `gh` and a fake `git` wrapper on `PATH`. The wrapper logs `push` and passes other commands to the real git. Cases: draft by default, `--ready`, an update of an open PR, `split:` over the limit, no limit with `maxPrFiles: 0`, `ask:` on a rejected push, `--profile` with `pullRequests: off` gives `off:`, `git stack` with two valid slices, and `git stack` with an oversized slice that pushes nothing. File: `test/git-pr.test.ts`. Reason: catches a ready PR that the owner did not ask for, a PR over the file limit, and a force push without a yes.
- integration U2: `git behind --ff` on a clean tree and on a dirty tree. File: `test/git.test.ts`. Reason: catches a fast-forward over uncommitted work.
- integration U4: a default install skips `omt-swarm`; `--with omt-swarm` installs it; `omt update` keeps an opted-in copy and removes an unedited copy without opt-in; `omt doctor` reports neither case as a problem. File: `test/install/opt-in.test.ts`. Reason: catches `omt-swarm` installed for every user, or an opted-in copy that an update deletes.
- integration U5: safety rules stay in the skill text (the list in U5). File: `test/skills/contract.test.ts`. Reason: catches a safety rule lost in the rewrite.
- unit U16: `detectUltrawork` matches `start ulw` and `start ultrawork` and no other form, with the D8 cases plus `starting ulw`, `restart ulw`, `start  ulw` with a tab, `start\nulw` (no match: a line break ends the phrase), and the existing 200,000-character speed case. File: `test/hooks/userPromptSubmit.test.ts`. Reason: catches the hook starting a build when the owner only talks about ultrawork. This line is outside `plan.testLayers` (`integration`): the matcher is pure logic with real branching, and the existing tests are at this layer. The existing child-process test stays as the integration check.
- integration U3: an accepted snapshot without `workflow.design.tool` loads, and `omt doctor --dry-run` lists `none -> paper`. File: `test/config/defaults-state.test.ts`. Reason: catches an upgrade that rejects every existing install's accepted defaults.
- integration U13: word budgets per file and in total. File: `test/skills/budget.test.ts`. Reason: catches skill text that grows back past the target.

## Units

- [ ] U1. Brief start record, limit check, `ledger done`, `--fallback`, `--strict`.
  Role: main. Scope: `src/commands/brief.ts`, `src/commands/ledger.ts`, `src/ledger/` (the shared matcher, the ledger lock), `src/routing/` (the resolved order and target keys), `src/types.ts` (`LedgerEntry.targetKey`; `BriefJsonOutput.targetKey` and `ledger.done`), `docs/spec.md` §3, §5.4, §5.6, §10, `test/commands/brief-ledger.test.ts`, and existing `test/brief/`, `test/ledger/`, `test/commands/brief.test.ts`.
  Done when: D1 passes, every U1 test case passes, and `omt help brief` and `omt help ledger` list the new flags and `settle-check`.
  Verify: `mise exec -- bun test test/commands test/brief test/ledger`. Depends on: none.
- [ ] U2. `omt git behind`, `start`, `commit`, `pr`, and `stack`, with drafts by default.
  Role: main. Scope: `src/commands/git.ts`, `src/git/`, `docs/spec.md` §5.15, `AGENTS.md` ("Dependencies": `gh` and `git push` contact the git host), `test/git.test.ts`, `test/git-commit.test.ts`, `test/git-pr.test.ts`, `test/fixtures/fake-gh/`.
  Done when: D2 and D3 pass, and the `behind` and `stack` cases pass.
  Verify: `mise exec -- bun test test/git.test.ts test/git-commit.test.ts test/git-pr.test.ts`. Depends on: U1 (shared `docs/spec.md` and `src/types.ts`).
- [ ] U3. Config defaults: PR extras off (answer 2a) and `workflow.design.tool`. The git defaults do not change (answer 1c).
  Role: main. Scope: `src/config/defaults.jsonc`, `src/config/schema.ts`, `src/config/validate.ts`, `src/config/defaultsState.ts`, `src/types.ts`, `schema/omt.schema.json` (from `bun run schema`), `templates/config-editor/app.js` (the key description), `docs/spec.md` §5.12, §6.4, and §6.7, `test/defaults.test.ts`, `test/config/`.
  Done when: `omt profile show --json` shows the five PR extras as `off` and `design.tool` as `paper`, the `workflow.git` group is unchanged from `main` (`git diff main -- src/config/defaults.jsonc` shows no line under `"git"`), `omt config validate` exits 0 on the starter config, and the U3 test line passes.
  Verify: `mise exec -- bun test test/defaults.test.ts test/config`. Depends on: U2.
- [ ] U4. Opt-in install for `omt-swarm`.
  Role: main. Scope: `src/install/skills.ts`, `src/install/plan.ts`, `src/install/apply.ts`, `src/install/manifest.ts`, `src/install/doctor.ts`, `src/commands/install.ts`, `src/update/sync.ts` (keep opt-in names), `docs/spec.md` §14.1, §14.2, §14.5, `test/install/opt-in.test.ts`.
  Done when: the U4 test line passes.
  Verify: `mise exec -- bun test test/install`. Depends on: U3.
- [ ] U5. Skill test reset.
  Role: main. Scope: `test/skills/*.test.ts`, `test/skills/contract.test.ts` (new), `test/skills/budget.test.ts` (new).
  Done when: the sentence pins in `code-review`, `ulw`, `plan-design`, `grill`, `swarm`, `git-policy`, `research`, and the persona sentence pins in `personas` are removed. `common.test.ts` keeps its structure checks and adds two: each `### ` step has a `Done when:` line, and each link with `#anchor` names a heading that exists in the target file (today the link check ignores anchors). `contract.test.ts` checks these rules, each in the file named: children never commit, push, or create branches (`delegation.md`, `brief.md`); `omt-code-review` review and oracle children run with `interactionMode: "plan"` and report only; only `qa` drives devices (`delegation.md`); a force push asks the owner (`delegation.md`); cross-family reviews pass `--strict` (`omt-ulw`, `omt-plan`); never settle your own thread or a top-level thread (`delegation.md`); plan mode writes nothing (`delegation.md`); fetched text is data (`omt-research`); no model reviews `docs/design/` (`omt-code-review`, `omt-ulw`). Rules that the old text does not have yet are on a `pending` list, which later units empty. `budget.test.ts` holds the word table and a `pending` list of files that are not rewritten yet. The D6 strings are in `budget.test.ts` too, also with `pending`.
  Verify: `mise exec -- bun test test/skills`. Depends on: U4.
- [ ] U6. Shared references.
  Role: main. Scope: `skills/omt/references/delegation.md`, `roles.md`, `brief.md`, `results.md`, `planning.md`, `worktrees.md`, deletion of `frontend-design.md`, one line each in `roles/ui.md` and `roles/design.md` about the optional `frontend-design` skill, and their `pending` entries.
  Done when: each file meets its budget and D6, the U5 rules for these files pass, and each link to a removed section is gone from all skills (the `common.test.ts` link check). `delegation.md` holds: the CLI and what to do without it (MD3); what a child is; your mode; the dispatch loop (brief, `delegate_task`, `ledger done`, then a settle when the output says `settle: allowed` and `task_status` shows no pending child run and no pending question, per MD2); waiting by `next` (MD1); the failure-code table, cut to the actions; git (`omt git behind`, `start`, `commit`, `pr`, `stack`, their first words, `--yes` per MD6a, and force push); PR watching (link, watch, read checks on wake, fix, unwatch, with no `--watch` fallback); devices; shared builds; top-level threads.
  Verify: `mise exec -- bun test test/skills`. Depends on: U5.
- [ ] U7. Router and `omt-ulw`.
  Role: main. Scope: `skills/omt/SKILL.md`, `skills/omt-ulw/SKILL.md`, `skills/omt/agents/openai.yaml` if it names removed skills.
  Done when: both files meet their budgets. The router lists the 7 default skills, notes `omt-swarm` as opt-in, and points to `omt help`. `omt-ulw` keeps steps 0 to 12, with no banner. Step 0 runs `omt git behind --ff`. Step 7 runs `omt git start`. Step 12 uses `omt git commit` and `omt git pr`, and its report is a list of contents (MD9). The `ui` rule follows MD5.
  Verify: `mise exec -- bun test test/skills`. Depends on: U6.
- [ ] U8. `omt-plan` with the grill step; retire `omt-grill` and the `grill` role.
  Role: main. Scope: `skills/omt-plan/SKILL.md`, `skills/omt-grill/` (delete), `skills/omt/references/roles/grill.md` and `results/grill.md` (delete), `src/config/defaults.jsonc` (remove the role), `src/config/defaults.ts` (`RETIRED_ROLES`), `src/types.ts` (`RESULT_KINDS`), `src/config/validate.ts` (a retired-value issue for `result: "grill"`), `schema/omt.schema.json` (from `bun run schema`), `docs/spec.md` §6.4 and §11, `test/skills/common.test.ts` (the folder list), `test/skills/grill.test.ts` (delete), `test/skills/personas.test.ts`, `test/defaults.test.ts`.
  Done when: `omt-plan` meets its budget. It has no hash step and a plan-mode branch of at most 3 sentences. Its test-line rules are 3 lines that point to `planning.md`. It has an optional step "Stress-test the goal". The step is offered when the goal has no done condition that can fail, or when 4 or more owner decisions remain. It finds the edge cases, the options, and the open questions in the main thread, and it asks them in the step 2 batch. The plan stores the answers under `## Research`. The plan review uses `--strict` with `two-families`. `omt brief grill --task check` exits 1 as an unknown role.
  Verify: `mise exec -- bun test test/skills`. Depends on: U7.
- [ ] U9. `omt-code-review` and `pr-extras.md`.
  Role: main. Scope: `skills/omt-code-review/SKILL.md`, `skills/omt-code-review/pr-extras.md` (new).
  Done when: both files meet their budgets. The skill keeps the target, size and split, dispatch, merge, oracle, report, and fix loop, plus the PR basics: target, rules files, round 1, merge, report, offers, and commit through `omt git commit` and `omt git pr`. The skill loads `pr-extras.md` only when a `review.ci`, `verify`, `tests`, `guardrails`, or `crap` switch is not `off`. The extras file holds each extra in at most 3 sentences.
  Verify: `mise exec -- bun test test/skills`. Depends on: U8.
- [ ] U10. `omt-design` and `omt-research`.
  Role: main. Scope: `skills/omt-design/SKILL.md`, `skills/omt-research/SKILL.md`.
  Done when: both meet their budgets. `omt-design` uses MD5 and `design.tool`. `omt-research` keeps its 5 steps and changes only its dispatch, record, and settle lines to the U6 loop.
  Verify: `mise exec -- bun test test/skills`. Depends on: U9.
- [ ] U11. `omt-setup` with help; delete `omt-help`.
  Role: main. Scope: `skills/omt-setup/SKILL.md`, `skills/omt-help/` (delete), `test/skills/common.test.ts` (the folder list).
  Done when: `omt-setup` meets its budget. Its description has the help triggers ("help", "what can omt do", "which skill", "what does this command mean"). It has a read-only answer step and the write rules for each change step. The check for the `frontend-design` skill is one line.
  Verify: `mise exec -- bun test test/skills`. Depends on: U10.
- [ ] U12. `omt-swarm` update.
  Role: main. Scope: `skills/omt-swarm/SKILL.md`.
  Done when: it meets its budget, it uses the U6 loop for its review and QA children and the git commands for its PR, and every link resolves. Its steps stay the same, because it stays untested and opt-in. Its top-level track threads keep `t3_thread_launch`, `t3_thread_wait`, and `omt ledger add`, because they are not `delegate_task` children and get no `ledger done` (B14).
  Verify: `mise exec -- bun test test/skills`. Depends on: U11.
- [ ] U13. Personas and result contracts.
  Role: main. Scope: `skills/omt/references/roles/*.md`, `skills/omt/references/results/*.md`, `test/skills/personas.test.ts`.
  Done when: the persona total is at most 2,600 words (answer 3a). Each persona keeps its access, its stop conditions, and its result kind. The cut removes rules that the rendered brief's `Constraints` already states (spec §9.2), such as the shared-build, test, and process lines. Every `pending` list in `budget.test.ts` and `contract.test.ts` is empty, and the total check is on (D5, D6).
  Verify: `mise exec -- bun test test/skills test/brief`. Depends on: U12.
- [ ] U14. Docs.
  Role: writing. Scope: `docs/spec.md` §2 and §15, `docs/commands.md`, `docs/workflows.md`, `docs/configuration.md`, `docs/install.md`, `docs/design.md`, `docs/agents/quickstart.md`, `docs/architecture.html` (banner), `README.md`.
  Done when: no doc names `omt-grill`, `omt-help`, a ready-PR default, or the ulw banner, except in a changelog or history note. `docs/workflows.md` describes the new dispatch loop and the git commands. `docs/install.md` describes `--with omt-swarm`. `test/branding.test.ts` passes.
  Verify: `mise exec -- bun test test/branding.test.ts test/cli-help.test.ts`. Depends on: U13.
- [ ] U15. Site.
  Role: writing. Scope: `site/src/components/SkillTour.tsx`, `site/src/components/scenes.ts`, `site/src/components/HeroRuns.tsx`. Read `site/AGENTS.md` first.
  Done when: the site names no retired skill, shows `omt-swarm` as opt-in or not at all, and passes its own checks from `site/AGENTS.md`.
  Verify: the site test command from `site/AGENTS.md`. Depends on: U14.

- [ ] U16. The hook fires only on "start ultrawork" or "start ulw".
  Role: main. Scope: `src/hooks/userPromptSubmit.ts`, `test/hooks/userPromptSubmit.test.ts`, `docs/spec.md` §13, and the lines that teach the bare keyword: `README.md:47`, `:88`, `:151`, `docs/install.md:106`, `:146`, `:269`, plus any `ulw <task>` example in `docs/workflows.md` and `site/src/`.
  Change: the match becomes the word `start`, then one or more spaces or tabs, then `ulw` or `ultrawork`, case-insensitive. `start` has no letter, digit, `_`, `-`, `/`, or `$` directly before it, and the keyword has none of these directly after it, as rule 5 says today. So `restart ulw` and `starting ulw` do not match, and `start ulw: fix the login` does. The quote, code, blockquote, brief, task-notification, and `/omt-ulw` rules stay as they are. A new start rule skips a prompt that starts with `Delegated task `: T3 sends a finished child's result as a new turn in that form, and the result holds no user request. The negation window of rule 6 ends at the word `start`, so `don't start ulw` stays silent. `/omt-ulw` and `$omt-ulw` keep loading the skill directly. The context text drops "the banner first, then", because U7 removes the banner. The docs examples become `start ulw add rate limiting to the public API`.
  Done when: D8 passes, a prompt that starts with `Delegated task ` and contains `start ulw` prints nothing, and spec §13 rules 3, 5, and 6 and its examples describe the change.
  Verify: `mise exec -- bun test test/hooks`. Depends on: none. Build it first. It can ship as its own commit or PR.

## Final verification

- [ ] F1. `mise exec -- bun run verify` passes.
- [ ] F2. `find skills -name '*.md' -print0 | xargs -0 wc -w | tail -1` prints at most 16,000.
- [ ] F3. In a new temp project made with `git init` outside this repository, with a temp `HOME`, `mise exec -- bun <worktree>/src/cli.ts install --project --yes` installs exactly `omt`, `omt-code-review`, `omt-design`, `omt-plan`, `omt-research`, `omt-setup`, and `omt-ulw`.
- [ ] F4. The owner runs one LIGHT `$omt-ulw` task and one `$omt-plan` in a scratch project with the new skills. Each child dispatch takes the three calls of D1. This check is manual and does not block the merge.

## Evidence: omt-plan steps that cost time or turns in this thread

This thread ran `omt-plan` as written until the owner stopped the bookkeeping. These are the steps that cost time or turns and gave no value:

1. Step 0 names `t3_thread_configuration`. The tool in this harness is `t3_thread_configure`, so I had to look it up first. (`t3/omt-small-fixes` fixes the name.)
2. The branch check took 4 git commands to learn that a new worktree from `main` is 0 commits behind.
3. Step 1 runs `omt profile show --json`. It printed 328 lines, with all 12 role chains, to give me 3 values: `plan.review`, `plan.testLayers`, and `limits.maxParallel`.
4. `omt ledger stats` before the first dispatch reported `active: 0`. It cost one command and decided nothing.
5. For 3 explore children, I wrote 3 task files, ran `omt brief` 3 times, read 3 JSON outputs, and copied 8 fields per child into `delegate_task` by hand. A direct `delegate_task` needs only the task, the target, and the modes.
6. Pasting the task ids into the printed `ledger.dispatched` command caused a real data error. My zsh loop had `$k:explore`, and zsh read `:e` as a modifier. All 3 entries got the wrong request id `omt:skill-trim:xplore:r1:a1`, and no command caught it.
7. Recording the results took 3 more `omt ledger add` commands. Nothing read those entries later.
8. The waiting rule tells the agent to stay in the turn with `t3_thread_wait`. The T3 tool told me to end the turn (`next: "Completion wakes this thread, so end your turn. Do not wait on it or poll it."`). The skill goes against the T3 contract. I followed T3, and one wake delivered all 3 results.
9. The settle rules are about 800 words. In a linked worktree, their answer is "settle nothing", and I needed `git rev-parse --git-dir --git-common-dir` to learn that.
10. Before the first dispatch, the skill made me read about 9,000 words (`omt-plan` 2,237, `delegation.md` 5,136, `results.md` 1,301, and parts of `roles.md` and `brief.md`) to start 3 read-only children.
11. The grill check (`omt paths --grills`, then a file check) cost one command for a skill that the owner never loaded.
12. Step 3 has 20 bullets of plan rules: test lines, grill edge-case mapping, shared-build locks, and lock tools. For a plan with no grill and no shared build state, almost none applied, but I had to read all of them.
13. Step 4 hash steps (not run, because the owner stopped them first): `shasum`, the hash in the brief, a hash check by the reviewer, and a new hash after each edit. The plan is one file in one checkout.
14. `omt plan status <slug>` points to the main checkout's `.omt/plans/`, which is not visible in the worktree's git status. Steps 3 and 4 must edit a file outside the worktree.
15. The Claude Code hook fired on the owner's message that only described the hook bug ("fires on the bare word ulw or ultrawork"), and told me to load `omt-ulw` and print the banner. U16 fixes this. It fired again on the wake that delivered the plan review, because the review text says "ulw step 7" and the wake starts with `Delegated task`, which no skip rule covers.
16. Total: about 20 bookkeeping tool calls for 3 read-only explore children. Without the bookkeeping, the same work takes 3 `delegate_task` calls.

## Owner answers (2026-11-03)

1. Git defaults: 1c, keep them automatic. On a branch that is not the default branch, or in a worktree, commits and PRs happen with no question. A commit to the default branch and a merge still ask. The ownership guard still asks for repos and PRs that are not the user's. Reason: an agent cannot work on its own if it must ask before each commit and PR. PRs open as drafts (MD6).
2. PR extras: 2a. They turn off in `normal`, keep their keys, and keep their text to about 350 words in `pr-extras.md`, which loads only when a switch is on.
3. Personas: 3a. They are cut from 4,356 to about 2,600 words, and each keeps its access, stop conditions, and result rules.
4. The `## Tests` list is approved, with the U16 unit test for the hook phrase.

## Log

- 2026-11-03: explore E1 (brief and ledger), E2 (git), and E3 (skill tests, install, docs) ran on GPT-6.1 Terra. I checked one citation from each.
- 2026-11-03: the owner stopped the omt-plan bookkeeping. The rest of the plan has no ledger, no brief files, and no hashes.
- 2026-11-03: the owner added U16 (the hook phrase). The review child had already started, so its brief predates U16.
- 2026-11-03: review by GPT-6 Astra (high effort): REQUEST_CHANGES, 16 blockers. I checked B2, B12, B14, and B15 in the code. Fixes: B1 resend and fallback before the limit check, under a ledger lock. B2 one matcher for `closes()` and `ledgerStats()`. B3 `--tried` for plan mode. B4 target keys in the resolved order. B5 settle keeps the `task_status` condition, plus `settle-check` and the depth-above-1 case. B6 new files staged before the commit. B7 `--path` and start points per skill. B8 `--profile` on `git pr`. B9 a separate `omt git stack`. B10 `0` or `null` means no limit. B11 MD6a. B12 old snapshots stay valid. B13 apply and doctor read `optIn`. B14 `omt-swarm` exempt from D6. B15 grill retirement moves to U8, and U8 and U11 update the folder list. B16 is the owner questions. Notes: the unknown-role check uses `--task check`, U5 adds anchor checks, F3 uses a temp project.
- 2026-11-03: the owner answered: 1c (git stays automatic), 2a, 3a, and approved the test list. U3 no longer changes the git defaults. D5 has one total limit (16,000).
- 2026-11-03: build. The owner added U17: `omt update` switches installs of the `oh-my-t3code` package to `oh-my-t3`, and `release.yml` keeps publishing `oh-my-t3code` for this release. Units were built in the order U16, U1, U3, U5, U6, U7, U9, U10, U12, U11, U13, U8, U2, U4, U17, U15, U14: U2, U4, and U17 ran in separate worktrees and were cherry-picked; U12 went before U8 and U11 because the old `omt-swarm` linked the retired skills. The site examples of U16 moved to U15. Each commit passed `bun run verify` in a clean worktree. Final word count under `skills/`: about 15,990.
