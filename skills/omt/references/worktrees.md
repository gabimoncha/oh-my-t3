# Worktree setup

T3 runs a project's setup script in each new worktree. Without one, a worktree thread starts with no `node_modules`, and checks that need dependencies fail. Use this page on the first omt run in a project, and when `omt worktree check` prints `WARN`.

## 1. Check the checkout

Run `omt worktree check` in the checkout that you work in, and read its `setup` and `next:` lines.

| `setup` state | Meaning |
| --- | --- |
| no setup needed | no `package.json` or lockfile; stop here |
| `t3.json` missing | no setup script in the repository; a saved T3 setup can still exist (step 2) |
| invalid, or no `runOnWorktreeCreate` script | fix `t3.json` by hand; omt never rewrites it |
| runs `node .t3/omt-worktree-setup.mjs` | the omt runner; for pnpm, complete only when the `store` line is `PASS` |
| any other command | a custom setup; omt keeps it and cannot verify it |

Done when: you know the `setup` state and the `next:` action.

## 2. Read the effective setup in T3

T3 does not read `t3.json` when it creates a worktree. It runs the first script with `runOnWorktreeCreate: true` from the project's saved scripts, in this order: `projectSettingsOverrides[<projectId>].defaultProjectScripts` in T3 settings (an empty list wins too); then `defaultProjectScripts` when `projectSettingsFolded` is true; then the legacy `projectScriptOverrides[<projectId>]`; then the project's own `scripts`. Read the project with `t3_project_read`, and the settings from `~/.t3/userdata/settings.json` or `$T3CODE_HOME/userdata/settings.json`. Never edit that file.

Done when: you name the effective setup script, or the source that you could not read.

## 3. Keep a compatible setup

Keep an existing setup script. A custom one works when it installs from the lockfile without changing it, waits (`async: false`), and two checkouts reuse one store (`realpath node_modules/<package>` is the same in both). Report each check that you could not run as unverified.

Done when: the setup is verified, or you list what is unverified.

## 4. Generate a missing setup

Only when no setup exists, and only with the owner's yes: run `omt worktree setup --dry-run`, then `omt worktree setup --yes`. Report a refusal and its action. For pnpm, when the output says `Setup is incomplete`, show the owner the line to add to `pnpm-workspace.yaml`.

Done when: `omt worktree check` shows no `WARN` on `store` or `setup`, or the owner has the reason.

## 5. Activate only on the base branch

New worktrees start from a branch, and a setup script that the branch lacks fails in each of them. So the owner first commits `t3.json`, `.t3/`, and for pnpm `pnpm-workspace.yaml` on that branch. Only then, and only with the owner's yes, import Setup in T3 Project Settings. A new project override replaces the inherited scripts, so copy them into it first. Never change `defaultProjectScripts`. Read the effective scripts again as in step 2.

Done when: the read-back shows Setup as the effective setup, or the owner has the pending step.
