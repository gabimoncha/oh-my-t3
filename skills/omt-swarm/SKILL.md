---
name: omt-swarm
description: Build one plan as parallel tracks in separate T3 worktree threads. The main thread splits the plan into tracks with disjoint scopes, launches each track with t3_thread_launch, waits for them in its turn, has one review child check every track diff before the merge, merges the track branches, runs one QA child on the merged code, and opens one PR.
disable-model-invocation: true
---

# Swarm

You build one plan as parallel tracks. Each track is a top-level T3 thread in its own git worktree, on its own branch. Each track runs the build part of `omt-ulw` for its units and commits on its branch. You split, launch, wait, review, merge, test, and open the PR. You do not build.

Invoking this skill is the explicit user request that T3 requires before `t3_thread_launch`. The launch rules are in [delegation.md](../omt/references/delegation.md#top-level-threads). T3 tools appear here by base name, and your harness may prefix them, for example `mcp__t3-code__t3_thread_launch`.

## Rules

- The input is a plan file from `omt-plan`, or from `omt-grill` and then `omt-plan`. Swarm asks no question batches and runs no plan review.
- You wait for the tracks and the children inside your turn ([delegation.md](../omt/references/delegation.md#waiting)). No step uses `schedule_task` or a heartbeat.
- You end your turn only for the owner: a blocker, a failed check after the last QA re-run, or the report.
- Tracks never push and never open a PR. You own the PR.
- Children never commit. You commit their accepted fixes.
- Read only the part of a child's or a track's evidence that your next action needs.
- Tick plan items only with `omt plan mark <slug> <id> <done|open|blocked>`.
- Record every track and every child in the ledger under the plan `<slug>`.
- Settle your review and QA children ([delegation.md](../omt/references/delegation.md#releasing-children)). Never settle a track thread.
- After a context reset, read the plan (`omt plan status <slug>`) and the ledger (`omt ledger list --plan <slug>`) before you act.

## Steps

### 0. Check the modes

Call `t3_thread_configure` with no arguments and read `runtimeMode` and `interactionMode` ([delegation.md](../omt/references/delegation.md#your-interaction-mode)). `t3_thread_launch` requires `full-access` runtime mode and `default` interaction mode. Keep the driver of `modelSelection`, such as `claudeAgent` or `codex`, as `<your family>`.

Run the [branch check](../omt/references/delegation.md#branch-check). When the current branch is the default branch, ask the owner for a feature branch and stop. The PR goes from this branch.

Each track runs in a new worktree. On the first run in a project, or when `omt init` printed a `WARN` worktree setup line, follow [worktrees.md](../omt/references/worktrees.md). Generate or activate a setup only with the owner's yes.

Done when: both modes match and you are on a feature branch. Otherwise the user knows which mode or branch to change, and you stopped.

### 1. Read the plan

Find the plan slug in the user's message, or run `omt plan list`. When no plan exists, tell the user to run `omt-plan` first, or `omt-grill` and then `omt-plan`. Then stop.

Run `omt plan status <slug>` and `omt profile show --plan <slug> --json`. Keep the effective `profile`, `workflow`, `limits`, `roles`, and `models`.

Run `git status --porcelain`. When it lists changes outside `.omt/`, tell the user that uncommitted edits do not reach the tracks. Ask them to commit what the tracks need, and stop. Save the output under `Log` in the plan ([Git actions](../omt/references/delegation.md#git-actions)).

Done when: the plan exists, you know its units, its `## Summary`, its `## Tests`, and its final checks, and the checkout is clean.

### 2. Split

Run the `omt-ulw` step 6 design check in the main thread before the split. If the plan has a requested design pass that has not run, run `omt-design` and get the owner's approval. When an approved design spec exists, commit it by the [Git actions](../omt/references/delegation.md#git-actions) rules before you record `<base>`, so the spec is in `<base>`. Tracks use that spec or the task requirements. A track does not run `omt-design`.

Split the open units of the plan into tracks. Each track gets a kebab-case name, its units, and its scope paths.

- Two tracks share no file. Units that touch the same file go in one track.
- A unit and the units that it depends on go in one track.
- Make at most `maxParallel` tracks.

Keep `<base>`, the output of `git rev-parse HEAD`. Every track starts from `<base>`.

For each track, run `omt plan new <slug>-<track> --light --profile <profile>`. Copy the track's units, their `## Tests` lines, the applicable done conditions and final checks, and the plan `## Summary` into it. Keep each unit's approved design spec. Assign LIGHT or HEAVY by the tier rule in `omt-ulw` step 3, and record the tier in the track plan. Then run `omt plan limit <slug>-<track> <k>`. Pick `<k>` so that the tracks together stay near the `maxParallel` of this plan, for example 1 or 2. The `.omt/` config is shared by all worktrees, so do not change `limits` in it.

Write the split under `Log` in the plan: each track, its units, its scope, its branch `omt/<slug>/<track>`, and `<base>`.

Done when: every open unit is in exactly one track, no two tracks share a file, and each track has a plan `<slug>-<track>`.

### 3. Launch

For each track, call `t3_thread_launch` with:

```json
{
  "title": "<slug>: <track>",
  "clientRequestId": "<slug>-<track>",
  "workspaceStrategy": { "type": "worktree", "baseRef": "<base>", "branch": "omt/<slug>/<track>", "startFromOrigin": false },
  "message": "<launch message>"
}
```

The launch message is a plain task, not an `omt brief`. It says:

1. You are track `<track>` of the swarm plan `<slug>`. Your plan is `<slug>-<track>`. Your scope is `<scope paths>`. Edit no file outside it.
2. First call `t3_thread_configure` with no arguments to read your own modes and `modelSelection`. Read `omt profile show --plan <slug>-<track> --json`, the track plan, and its tier. Use your own driver as `<your family>` for review. Apply the `F2` rule from `omt-ulw` step 5. Cite the approved design spec in `<base>` when one exists. Otherwise implement the task requirements directly. Do not run `omt-design`. The main thread completed the step 6 design check before the split. Then run steps 7 to 12 of the `omt-ulw` skill for the units of plan `<slug>-<track>` only. Build, run your own review child and QA child, and fix.
3. Commit on branch `omt/<slug>/<track>` by the `Git actions` rules of the omt `delegation.md` reference, with `--plan <slug>-<track>`. Do not push. Do not open a PR. The main thread owns the PR.
4. Report what changed, each check with its exit code and log path, and the commit hash.
5. End with one line: `TRACK <track>: DONE <commit hash>`, or `TRACK <track>: BLOCKED <reason>`.

Keep the `threadId` of each track. Run `git worktree list --porcelain` and keep the worktree path of each branch `omt/<slug>/<track>` as `<track worktree>`. Record each launch with `omt ledger add --plan <slug> --unit <track> --role swarm --round 1 --attempt 1 --status dispatched --note <threadId>`.

When a launch fails or its response is lost, call `t3_thread_list` and look for the thread. Launch again only when it is missing, with the same `clientRequestId`.

Done when: every track has exactly one thread id in the ledger and one worktree path.

### 4. Wait

For each track, call `t3_thread_wait` with `threadId`, `untilDelegatedWorkSettled: true`, and `timeoutMs` up to 3,600,000. Then the track's own review and QA children have finished too. On `waitTimedOut: true`, call `t3_thread_wait` again.

Read the last message of each track with `t3_thread_read`. Check the claim: run `git log --oneline <base>..omt/<slug>/<track>`, and see the commit hash.

- `DONE`: record `omt ledger add --plan <slug> --unit <track> --role swarm --round 1 --attempt 1 --status completed --note <commit hash>`.
- `BLOCKED`, or a question to the owner: record `--status failed` with the reason as the note. Pass the blocker or the question to the owner. When the owner answers, send the answer to the track with `t3_thread_send`, and wait again.

Done when: every track reported `DONE` with a commit on its branch, or the owner has its blocker.

### 5. Review before the merge

Dispatch one `review` child over all track diffs. It runs on the family that is not yours.

Before each dispatch or fallback, check the target's family with [roles.md](../omt/references/roles.md#cross-family-roles). When it is your family, stop and report that no reviewer from the other family can run. The CLI can return a same-family fallback even with `--against`.

Write the context to a temp file such as `$TMPDIR/omt-<slug>-swarm-review.md`: the plan `## Summary`, the done conditions, and for each track its name, its branch, its `<track worktree>`, and its scope paths. Leave `docs/design/` out of the scope paths.

The task tells the reviewer:

- For each track, run `git diff <base>...omt/<slug>/<track>` and review it against the plan Summary.
- Check that the tracks fit together: names, interfaces, and shared behavior.
- Fix each local finding itself in that track's `<track worktree>`: a clear fix inside the track's changed files that agrees with the plan Summary. Leave the fixes uncommitted.
- Report each other finding, such as a finding across tracks or a finding that changes the plan.
- List each fix under `FIXES`, with its track and its absolute paths.

Build the brief with `omt brief review --task-file - --context-file <file> --scope <track worktree>/<path> ... --title "review: <slug> tracks" --plan <slug> --unit REVIEW --round 1 --attempt 1 --against <your family> --save --json`. Dispatch it with `mode: "wait"`, and record the dispatch and the result ([results.md](../omt/references/results.md#recording)). Then settle the child.

Done when: the review child returned a result block and it is recorded in the ledger.

### 6. Read the fix diff and fix

For each track with fixes, run `git -C <track worktree> diff` and `git -C <track worktree> status --porcelain`. Read only those hunks and new files. Undo a fix that you disprove, and say why in the report.

Commit the accepted fixes on the track branch, in the track worktree, by the [Git actions](../omt/references/delegation.md#git-actions) rules with `--plan <slug>`. Commit only the paths that the reviewer listed under `FIXES`.

Apply the relevance check of `omt-ulw` step 9 to each reported finding. Record each dropped finding with its reason under `Log` in the plan.

Fix each kept finding yourself, in the worktree of the track that it belongs to. Run that track's verify commands, and commit the fix on the track branch. When a fix needs deep knowledge of one track's code, send the finding to that track with `t3_thread_send`. Then wait for it as step 4 says, and check its new commit.

When a finding changes the plan, run `omt plan mark <slug> <unit> blocked` and ask the owner.

Done when: you read every fix diff, every accepted fix and every kept finding is committed on its track branch, or the owner has the finding.

### 7. Merge

Merge each track branch into your branch. Before each merge, run `omt git check merge --plan <slug> --json` and act on its decision by the [Git actions](../omt/references/delegation.md#git-actions) rules. Then run `git merge --no-ff omt/<slug>/<track>`.

Resolve each conflict yourself. When a conflict needs deep knowledge of one track's code, run `git merge --abort`. Send the conflict to that track's thread with `t3_thread_send`. Name the files and the other track's change. Ask the track to merge your branch into its branch, resolve the conflict, run its verify commands, and commit. It does not push. Wait for it as step 4 says, then merge again.

After each merge, run `omt plan mark <slug> <unit> done` for each unit of that track.

Done when: every `DONE` track branch is merged into your branch, and each of its units is marked done.

### 8. QA

Dispatch one `qa` child on the merged code. Give it every verify command of the plan, the final checks (`F` items with a command), and the device flows, each with its steps and expected result. The QA child edits nothing and writes no tests. It returns each command with its exit code and a log path, and screenshot paths for device flows. Apply the design exclusion of `omt-ulw` step 10.

Build the brief with `omt brief qa --task-file - --scope <path> ... --verify <command> ... --title "qa: <slug>" --plan <slug> --unit QA --round <n> --attempt 1 --save --json`. Dispatch it with `mode: "wait"`, and record the dispatch and the result. Then settle the child. Route device checks as [delegation.md](../omt/references/delegation.md#verification-and-devices) says.

Read only the exit code of each `CHECKS` line and the last lines of each failed log, for example with `tail -n 30 <log>`. Mark each `D` and `F` item with `omt plan mark <slug> <id> done` after its command passed in the QA run.

Done when: the QA result is recorded and every check passed, or step 9 has the failures.

### 9. Fix failed checks

For each failed check, find the cause in the last lines of its log. Fix it yourself on your branch, and run the check yourself. Then dispatch QA again for only the failed checks, with the next `--round`. After a check passes, mark its `D` and `F` items done as in step 8.

Run at most 2 QA re-runs. When a check still fails after the second re-run, run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)) and ask the owner, with each failed command, its exit code, and its log path.

Done when: every check passed in a QA run, or the owner has the failures.

### 10. Finish

Run the settle sweep ([delegation.md](../omt/references/delegation.md#releasing-children)).

Commit your QA fixes, then push and open or update the PR, each by the [Git actions](../omt/references/delegation.md#git-actions) rules. Follow [delegation.md](../omt/references/delegation.md#pull-requests) to link and watch the PR.

Tell the user:

- Each track: its units, its branch, its commit, and its result (`DONE` or the blocker).
- Each done condition with its evidence: the command, its exit code, and its log path from the QA run.
- The review verdict, the reviewer's fixes, the findings that you fixed, the findings that a track fixed, and the findings that you dropped, with the reason.
- The merge conflicts and how each was resolved.
- The QA verdict and each re-run, and each screenshot as a Markdown image with its absolute path. When no device flow ran, say so.
- The PR URL.
- Open items: blocked tracks, open findings, and decisions left.

Done when: every done condition appears in the report with evidence or as an open item, and the PR is linked.
