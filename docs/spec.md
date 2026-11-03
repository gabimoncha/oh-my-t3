# oh-my-t3 specification

This page is the reference for the code, the skills, and the tests. [`design.md`](design.md) explains why each part exists. When this page and the code disagree, fix one of them in the same change.

## 1. Toolchain and conventions

- Toolchain: Bun 1.4.4, pinned in `mise.toml` and in the `packageManager` field (`bun@1.4.4`). `engines.bun` is `>=1.4.4`. Run Bun through `mise exec --` so that the pinned version runs. The lockfile is `bun.lock`.
- Runtime: Bun runs the TypeScript sources directly. `src/cli.ts` starts with `#!/usr/bin/env bun`.
- Language: TypeScript, ESM (`"type": "module"`). Use erasable syntax only. That means no `enum`, no `namespace`, no parameter properties, and no decorators. Use `import type` for type-only imports. Relative imports end in `.ts`.
- Runtime dependencies: none.
- `src/` uses only `node:` built-in modules, because the npm bundle runs on Node. Scripts in `scripts/` and tests may use Bun APIs.
- Dev dependencies: `@types/bun` and `tsrs`, pinned to an exact version. `tsrs` has native builds for macOS arm64 and for Linux arm64 and x64, with glibc or musl.
- Type check: `sh scripts/tsrs.sh -p tsconfig.json` (`types: ["bun"]`, `resolveJsonModule`, `allowImportingTsExtensions`, `noEmit`). `tsrs` is the Rust port of the TypeScript 7 compiler. `scripts/tsrs.sh` runs the native binary from the `@tsrs/<platform>` package directly, and skips the npm launcher `node_modules/.bin/tsrs`, which starts Node first. It picks the package from `uname -sm`, and on Linux it picks `-musl` or `-gnu` the way `tsrs/lib/platform.js` does. `TSRS_BINARY` overrides the binary. When no native binary fits the machine, it runs the launcher, which prints the reason.
- Tests: `bun test` runs `test/**/*.test.ts`. The tests use `bun:test` and `node:assert/strict`.
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`.
- Formatting: 2-space indentation, double quotes, semicolons, trailing commas in multi-line literals.
- Comments: only for a non-obvious reason that the code cannot show.
- File writes: atomic, except the ledger and lock metadata (section 5.10). Write a temp file in the same directory, then rename. Create parent directories as needed. When the target exists, the temp file gets the target's mode before the rename, so a 0600 file stays 0600. Each ledger entry is one `appendFile` call, so concurrent appends do not overwrite each other.
- When the target of a write is an authorized symlink, write next to its real path (`fs.realpath`) and rename onto the real path, so the symlink stays a symlink. Project plan mutations and project installer writes must resolve inside the project root. Resolve existing ancestors and dangling links before this check. Git exclude files follow Git's storage location and are exempt from this containment rule. Ledger and lock files reject symlinks below the selected checkout or Git storage root. They open the leaf with `O_NOFOLLOW`, then verify that the descriptor is a regular file with one hard link and matches the directory entry before any content change.
- The CLI sends no telemetry. It contacts the npm registry only when you run `omt update`, or once a day in `omt install` and `omt doctor` after you set `update` in the user config. `omt update` runs the package manager or mise command of the channel that installed omt. Build scripts may download Bun cross-compile runtimes. The generated worktree setup runner (section 5.11) starts a package manager too, when T3 runs it.

`package.json` scripts:

| Script | Command |
| --- | --- |
| `omt` | `bun src/cli.ts` |
| `test` | `bun test` |
| `typecheck` | `sh scripts/tsrs.sh -p tsconfig.json` |
| `schema` | `bun scripts/build-schema.ts` |
| `defaults:edit` | `bun scripts/edit-defaults.ts` (section 5.1, maintainer mode) |
| `build` | `bun scripts/build.ts` (section 5) |
| `release` | `bun scripts/release.ts` (section 17) |
| `verify` | `bun run typecheck && bun test` |

The package is named `oh-my-t3` and is `private`, so nobody publishes the repository root. Its four bin names, `omt`, `omt3`, `oh-my-t3code`, and `oh-my-t3`, point at `dist/cli.js`, the default bundle output, for a link from a clone. The published packages come from `scripts/release.ts` (section 17).

## 2. Repository layout

```text
.github/
  CODEOWNERS             names @gabimoncha as the owner of every path
  workflows/             ci.yml (CI), release.yml (release on a v* tag), and site.yml (checks and deploys site/) (section 17.1)
assets/                  icon.svg (the omt icon) and banner.png (the README banner); both ship in the npm packages
mise.toml                pins Bun 1.4.4, Node 24.22.1, and npm 11.21.1
package.json             scripts (section 1), packageManager bun@1.4.4, dev dependencies @types/bun and tsrs
bun.lock                 Bun lockfile
tsconfig.json            compiler options for tsrs
src/
  cli.ts                 entry: shebang, calls main(process.argv.slice(2)), sets process.exitCode
  main.ts                main(), createContext(), command registry, help text
  types.ts               shared types (section 3)
  paths.ts               path helpers (section 4)
  util/                  errors.ts, args.ts, fs.ts, output.ts, json.ts, ids.ts, open.ts (opens a URL in the default browser)
  config/                jsonc.ts, defaults.ts and defaults.jsonc and defaultsText.ts (section 6.4), defaultsState.ts, target.ts, validate.ts, merge.ts, load.ts, starter.ts, schema.ts,
                         explain.ts (the source of each value, section 5.1)
  config/editor/         server.ts, api.ts, catalog.ts, skillFiles.ts, diff.ts, assets.ts, assetText.ts: the config editor of omt config edit --web
                         and of bun run defaults:edit (section 5.1)
  routing/               capabilities.ts, effort.ts, resolve.ts, format.ts, family.ts
  brief/                 templates.ts, render.ts
  plan/                  template.ts, parse.ts
  ledger/                ledger.ts
  profile/               resolve.ts
  lock/                  lock.ts
  git/                   branch.ts (section 5.15)
  install/               skills.ts, links.ts, claudeHook.ts, manifest.ts, plan.ts, apply.ts, doctor.ts, confirm.ts, fsops.ts, project.ts, harness.ts (section 5.13), projects.ts (section 14.8)
  update/                channel.ts, check.ts, sync.ts, flow.ts (section 5.14)
  hooks/                 userPromptSubmit.ts
  worktree/              runner.ts, runnerText.ts, check.ts, setup.ts (section 5.11)
  commands/              one file per command, each exports `run: CommandRun`
                         profile.ts and lock.ts add profile and lock commands
                         worktree.ts adds the worktree command
                         detect.ts adds harness detection (section 5.13)
                         update.ts adds the update command (section 5.14)
                         git.ts adds the git command (section 5.15)
                         shared.ts holds the helpers that commands share and exports no `run`
scripts/
  build-schema.ts        writes schema/omt.schema.json from src/config/schema.ts
  build.ts               builds dist/cli.js and the omt binaries (section 5)
  edit-defaults.ts       starts the config editor in maintainer mode (section 5.1)
  release.ts             writes the npm packages, archives, and SHA256SUMS (section 17)
  tsrs.sh                runs the native tsrs binary for the type check (section 1)
schema/
  omt.schema.json        JSON Schema for config files
templates/
  worktree-setup.mjs     the standalone worktree setup runner (section 5.11)
  worktree-setup.d.mts   its types for src/worktree/runner.ts
  config-editor/         index.html, app.css, and app.js: the config editor page (section 5.1)
skills/
  omt/                   router skill and shared references
  omt-ulw/ omt-plan/ omt-design/ omt-code-review/ omt-research/ omt-swarm/
  omt-grill/ omt-help/ omt-setup/
test/
  helpers.ts             temp dirs and a fake CliContext
  run.ts                 command helpers
  fixtures/              capabilities.json, capabilities-live.json, capabilities-compact.json
  config/profiles.test.ts profile validation and merging
  profile/               resolve.test.ts, profile.test.ts
  lock/                  lock.test.ts
  git.test.ts            omt git check decisions
  routing/fast.test.ts    fast option mapping and precedence
  skills/                common.test.ts, personas.test.ts, plan-design.test.ts, code-review.test.ts, ulw.test.ts, shared.ts
docs/
site/                    the landing page, a separate Bun package (section 17.2)
```

## 3. Shared types

`src/types.ts` holds these declarations. Other modules import them from there.

```ts
export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORT_LADDER: readonly Effort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export type OptionValue = string | boolean;
export type Access = "read-only" | "edit";
export type InteractionMode = "inherit" | "default" | "plan";
export type RuntimeMode = "inherit" | "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type T3Role = "implementation" | "research" | "review" | "design" | "test" | "general";
export type ResultKind = "work" | "review" | "test" | "research" | "plan" | "guardrail" | "grill";
export const RESULT_KINDS: readonly ResultKind[] = ["work", "review", "test", "research", "plan", "guardrail", "grill"];

export interface Rung {
  provider?: string; // T3 provider instance id, for example "claudeAgent"
  driver?: string; // T3 driver kind; used when provider is absent
  model: string; // model id as listed by orchestrator_capabilities
  effort?: Effort; // mapped onto the model's effort option
  fast?: boolean;
  options?: Record<string, OptionValue>; // raw T3 option selections; override the effort mapping
}

export interface RoleConfig {
  description: string;
  access: Access;
  result: ResultKind;
  t3Role: T3Role;
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
  crossFamily?: boolean; // review from the family other than the worker's when --against names the worker
  fast?: boolean;
  chain: Rung[];
}

export interface Limits {
  maxParallel: number;
  maxDepth: number;
  maxReviewRounds: number;
}

export interface Workflow {
  plan: {
    review: "two-families" | "one" | "owner";
    testLayers: ("integration" | "e2e" | "unit")[];
  };
  design: {
    variants: number;
  };
  build: {
    review: "every-round" | "first-round" | "off";
    qa: "planned" | "off";
    failureProofs: "on" | "off";
    oracle: "heavy" | "always" | "off";
  };
  review: {
    reviewers: "auto" | number;
    families: "one" | "both";
    oracle: "on" | "off";
    fixLoop: "offer" | "off";
    ci: "off" | "check" | "fix";
    verify: "off" | "changed-flows";
    tests: "off" | "offer";
    guardrails: "off" | "propose";
    crap: "off" | "report";
  };
  git?: Partial<GitPolicy>; // a missing key means "ask"
}

export interface GitPolicy {
  branchCommits: "auto" | "ask";
  pullRequests: "auto" | "ask" | "off";
  defaultBranch: "ask" | "auto";
  merge: "ask" | "auto";
}

export type WorkflowLayer = { [K in keyof Workflow]?: Partial<Workflow[K]> };

export interface ModelConfig {
  fast?: boolean;
}

export interface ProfileConfig {
  description: string;
  extends?: string;
  workflow?: WorkflowLayer;
  limits?: Partial<Limits>;
  roles?: Record<string, Partial<RoleConfig> | null>;
  models?: Record<string, ModelConfig>;
}

export type UpdateMode = "off" | "check" | "apply";

export interface OmtConfig {
  version: 1;
  profile: string;
  profiles: Record<string, ProfileConfig>;
  models: Record<string, ModelConfig>;
  roles: Record<string, RoleConfig>;
  limits: Limits;
  harnesses?: string[]; // the driver kinds that routing may use; absent means every driver
  update?: UpdateMode; // absent means "off" (section 6.3)
}

export interface ConfigLayer {
  version?: 1;
  profile?: string;
  profiles?: Record<string, Partial<ProfileConfig> | null>;
  models?: Record<string, ModelConfig>;
  roles?: Record<string, Partial<RoleConfig> | null>;
  limits?: Partial<Limits>;
  harnesses?: string[];
  update?: UpdateMode;
}

export type IssueSeverity = "error" | "warning";

export interface ConfigIssue {
  source: string; // file path, or "defaults"
  path: string; // for example "roles.review.chain[0].effort"; "" for the whole file
  message: string;
  severity: IssueSeverity;
}

export interface ConfigSource {
  kind: "defaults" | "user" | "project";
  path?: string;
  present: boolean;
}

export interface LoadedConfig {
  config: OmtConfig;
  sources: ConfigSource[];
  issues: ConfigIssue[];
  defaults: OmtConfig; // accepted base, before config overrides
  defaultsSource: string; // the install manifest path, or "current"
}

export interface DefaultsChange {
  path: string; // for example "roles.execute.chain"
  from: string; // the printed value, or "none" when the path is absent
  to: string;
  overriddenBy?: string; // the config file whose value wins over the change
}

export interface OptionChoice {
  id: string;
  label?: string;
  isDefault?: boolean;
}

export interface OptionDescriptor {
  id: string;
  type: string; // "select" or "boolean" in current T3 builds
  label?: string;
  options?: OptionChoice[];
}

export interface ModelCapability {
  id: string;
  label?: string;
  options: OptionDescriptor[];
}

// The parser also reads the compact option form of newer T3 builds, { id, values, default }. An option whose values
// are all booleans becomes { id, type: "boolean" }. Other values become a "select" whose choices are the values, and
// the choice equal to `default` gets isDefault.

export interface ProviderCapability {
  providerInstanceId: string;
  driverKind: string;
  displayName?: string;
  canRunChildTask: boolean;
  constraints: string[];
  models: ModelCapability[];
}

export interface Capabilities {
  inheritedProviderInstanceId?: string;
  inheritedModel?: string;
  runtimeMode?: string;
  interactionMode?: string;
  providers: ProviderCapability[];
}

export interface ResolvedTarget {
  providerInstanceId?: string; // exactly one of providerInstanceId and driverKind is set
  driverKind?: string;
  model: string;
  options?: Record<string, OptionValue>; // omitted when empty
}

export interface RungAttempt {
  index: number;
  rung: Rung;
  ok: boolean;
  reason?: string; // set when ok is false
  notes: string[];
  target?: ResolvedTarget; // set when ok is true
}

export type RoleStatus = "resolved" | "unverified" | "unavailable";

export interface DelegateTaskArgs {
  target: ResolvedTarget;
  role: T3Role;
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
}

export interface RoleResolution {
  role: string;
  description: string;
  access: Access;
  result: ResultKind;
  t3Role: T3Role; // copied from the role, also when the role is unavailable
  interactionMode: InteractionMode;
  runtimeMode: RuntimeMode;
  crossFamily: boolean; // the role's crossFamily, false when unset
  status: RoleStatus;
  delegateTask?: DelegateTaskArgs; // from the first ok rung
  fallbacks: ResolvedTarget[]; // later ok rungs, in the order they were tried
  attempts: RungAttempt[]; // in the order they were tried; index is the configured position
  notes?: string[]; // role-level routing notes, such as the cross-family notes; omitted when empty
}

export interface RolesReport {
  version: 1;
  verified: boolean; // true when capabilities were supplied
  roles: Record<string, RoleResolution>;
  limits: Limits;
}

export interface RouteOutput {
  role: string;
  status: RoleStatus;
  description: string;
  access: Access;
  result: ResultKind;
  delegateTask?: DelegateTaskArgs;
  fallbacks: ResolvedTarget[];
  notes: string[]; // the role-level notes, then every attempt note and failure reason in the order tried, each prefixed "rung <n>: "
}

export interface BriefJsonOutput {
  delegateTask: {
    task: string; // the rendered brief, or the saved brief pointer with --save
    title: string;
    target: ResolvedTarget;
    role: T3Role;
    interactionMode: InteractionMode;
    runtimeMode: RuntimeMode;
    mode: "async";
    clientRequestId?: string; // present when --plan and --unit are given
  };
  fallbacks: ResolvedTarget[]; // not a delegate_task field; the targets after this one, in order
  targetKey: string; // the chosen target, such as codex/gpt-6-astra; --tried takes it in plan mode
  ledger?: { done: string }; // present when --save --json with --plan and --unit recorded the start
}

export type LedgerStatus = "dispatched" | "completed" | "failed" | "cancelled" | "interrupted" | "verified" | "rejected"; // every status except "dispatched" is terminal

export interface LedgerEntry {
  ts: string; // ISO timestamp from ctx.now()
  role: string;
  status: LedgerStatus;
  plan?: string;
  unit?: string;
  round?: number;
  attempt?: number;
  taskId?: string;
  clientRequestId?: string;
  provider?: string;
  model?: string;
  verdict?: string; // first word or words of the result block, for example "DONE", "APPROVE", "NOT VERIFIED"
  note?: string;
  targetKey?: string; // dispatched entries from omt brief --save: the target that the brief chose
}

export interface LedgerStats {
  plan?: string;
  dispatched: number; // entries with status "dispatched"
  active: number; // dispatched entries that no terminal entry closes (section 5.6)
  terminal: number; // entries with a terminal status
  limits: { maxParallel: number }; // from the effective config; with a plan limit, maxParallel is the lower of the two (section 5.6)
  planMaxParallel?: number; // the plan header max-parallel; set only when the plan has one
  canDispatch: boolean; // active < maxParallel; a run has no task budget
}

export type T3DriverStatus = "enabled" | "disabled" | "unknown";

export interface HarnessStatus {
  driver: string; // a driver kind, for example "claudeAgent"
  detected: boolean;
  t3: T3DriverStatus;
  executable: string | null; // the first match on PATH; null with capabilities
  reason: string;
}

export interface HarnessReport {
  source: "capabilities" | "local";
  harnesses: HarnessStatus[]; // claudeAgent, then codex
  recommended: string[]; // the detected drivers, in the order of harnesses
}

// How the CLI runs: the TypeScript sources with Bun, the JavaScript bundle dist/cli.js, or a compiled binary.
export type CliBuild = "source" | "bundle" | "binary";

export interface CliContext {
  argv: string[]; // arguments after the command name
  cwd: string;
  env: Record<string, string | undefined>;
  homedir: string;
  stdout: (text: string) => void; // writes text as given; callers add newlines
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  isTTY: boolean; // true when stdin is a terminal
  prompt: (question: string) => Promise<string>;
  now: () => Date;
  packageRoot: string; // directory that holds skills/: the package root, or the embedded root of a binary
  cliPath: string; // absolute path of src/cli.ts, dist/cli.js, or the binary
  build: CliBuild; // set at build time; "source" when the sources run
  runtimePath?: string; // process.execPath in source and bundle mode; unset in binary mode
  runtimeName: "node" | "bun";
  runtimeVersion: string; // process.versions.bun or process.versions.node, injectable for tests
  version: string; // package.json version
}

export type CommandRun = (ctx: CliContext) => Promise<number>;
```

Section 5 says how `createContext()` sets `build`, `packageRoot`, `cliPath`, and the runtime fields in each run mode.

Code that lists the result kinds uses `RESULT_KINDS`.

`src/types.ts` also holds the worktree report types of section 5.11: `PackageManagerName`, `WorktreeManager`, `WorktreeLinker`, `WorktreeStore`, `WorktreeSetupStatus`, `WorktreeSetup`, `WorktreeCheck`, and `WorktreeReport`. `omt worktree check --json` prints a `WorktreeReport`.

`src/util/errors.ts` defines the one error class:

```ts
export class OmtError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly exitCode: number; // 1 by default, 2 for usage errors
  constructor(code: string, message: string, options?: { hint?: string; exitCode?: number; cause?: unknown });
}
```

`main()` catches `OmtError`, prints `omt: <message>` and then `hint: <hint>` to stderr, and returns its `exitCode`. Any other error prints `omt: unexpected error: <message>` and returns 1.

## 4. Paths

`src/paths.ts` exports pure functions. They take `env` and `homedir` arguments, so tests never touch the real home directory.

| Function | Result |
| --- | --- |
| `configDir(env, homedir)` | `$OMT_CONFIG_DIR`, else `$XDG_CONFIG_HOME/oh-my-t3code`, else `<home>/.config/oh-my-t3code` |
| `userConfigPath(env, homedir)` | `<configDir>/config.jsonc` |
| `manifestPath(env, homedir)` | `<configDir>/install.json` |
| `updateStatePath(env, homedir)` | `<configDir>/update-check.json`, the state of the update check (section 5.14) |
| `projectsPath(env, homedir)` | `<configDir>/projects.json`, the project list (section 14.8) |
| `userRolesDir(env, homedir)` | `<configDir>/roles` |
| `mainCheckoutOf(root)` | the main checkout of a linked worktree. When `<root>/.git` is a file whose first line is `gitdir: <path>`, it resolves `<path>` against `root`, reads `<gitdir>/commondir` (relative or absolute, resolved against `<gitdir>`), and returns `dirname(<common dir>)` when `basename(<common dir>)` is `.git` and the repository is not bare; `undefined` for a normal checkout (`.git` is a directory), a submodule, a bare or unknown layout, or any read error. It reads `core.bare` in the plain form that git writes: the repository is bare when the `[core]` section of `<common dir>/config` sets `bare` to true (`true`, `yes`, `on`, `1`, or no value). Hand-edited forms, such as quoted values, repeated keys, or an entry on the section line, are not supported. A missing `config` counts as not bare. So a bare repository stored at `<repo>/.git` gives `undefined` |
| `findProjectRoot(cwd)` | the nearest ancestor of `cwd` (or `cwd` itself) that contains `.omt` or `.git` (a directory or a file); when that directory has a `.git` file and `mainCheckoutOf` returns a main checkout, the main checkout, whether or not it has `.omt` yet; `cwd` when none exists |
| `findCheckoutRoot(cwd)` | the nearest ancestor of `cwd` (or `cwd` itself) that contains `.git` (a directory or a file); `undefined` when none exists. Unlike `findProjectRoot`, a linked worktree stays itself, because worktree setup files belong to the checkout's branch |
| `shadowedWorktreeState(cwd)` | `{ worktree, main }` when the directory that `findProjectRoot` stops at is a linked worktree whose own `.omt/plans` holds a regular file whose name ends in `.md`, or whose own `.omt/ledger.jsonl` is a regular file; else `undefined` |
| `omtDir(root)` | `<root>/.omt` |
| `projectConfigPath(root)` | `<root>/.omt/config.jsonc` |
| `projectRolesDir(root)` | `<root>/.omt/roles` |
| `plansDir(root)` | `<root>/.omt/plans` |
| `planPath(root, slug)` | `<root>/.omt/plans/<slug>.md` |
| `grillsDir(root)` | `<root>/.omt/grills` |
| `grillPath(root, slug)` | `<root>/.omt/grills/<slug>.md` |
| `ledgerPath(root)` | `<root>/.omt/ledger.jsonl` |
| `evidenceDir(root)` | `<root>/.omt/evidence` |
| `projectManifestPath(root)` | `<root>/.omt/install.json` |
| `projectShimPath(root)` | `<root>/.omt/bin/omt` |
| `projectSkillRoots(root)` | `{ agents: <root>/.agents/skills, claude: <root>/.claude/skills }` |
| `projectInstallDirs(root)` | Folders under `<root>`, in order: `.omt`, `.omt/plans`, `.omt/bin`, `.omt/backups`, `.agents`, `.agents/skills`, `.claude`, `.claude/skills` |
| `projectClaudeSettingsPath(root)` | `<root>/.claude/settings.local.json` |
| `claudeConfigDir(env, homedir)` | `$CLAUDE_CONFIG_DIR`, else `<home>/.claude` |
| `skillRoots(env, homedir)` | `{ agents: <home>/.agents/skills, claude: <claudeConfigDir>/skills, gemini: <home>/.gemini/config/skills }` |
| `claudeSettingsPath(env, homedir)` | `<claudeConfigDir>/settings.json` |
| `t3HomeDir(env, homedir)` | `$T3CODE_HOME`, else `<home>/.t3` |
| `t3SettingsPath(env, homedir)` | `<t3HomeDir>/userdata/settings.json` |
| `t3ProjectFilePath(root)` | `<root>/t3.json` |
| `worktreeRunnerPath(root)` | `<root>/.t3/omt-worktree-setup.mjs` |
| `pnpmWorkspacePath(root)` | `<root>/pnpm-workspace.yaml` |

`mainCheckoutOf`, `findProjectRoot`, `findCheckoutRoot`, and `shadowedWorktreeState` are the only functions that read the file system. None of them starts a `git` process.

All worktrees of one repository share one `.omt` in the main checkout. It holds the config, the plans, the ledger, the evidence, and the shim. So a build thread in one worktree finds the plan that a planning thread wrote in another. A worktree's own `.omt` never wins. Git writes `gitdir:` as a real path. `findProjectRoot` rebuilds the main checkout under the nearest ancestor of the worktree whose real path holds it, so a cwd in a worktree and a cwd in the main checkout give the same root string, such as `/var/...` and not `/private/var/...`.

Shadowed state. Before `plan`, `ledger`, `brief`, `route`, and `init` run, the CLI calls `shadowedWorktreeState(cwd)`. When it returns a value, the CLI prints two lines to stderr: `warning: <worktree>/.omt holds plans or a ledger that omt no longer reads; move them to <main>/.omt`, then `hint: if git tracks them, untrack them with "git rm --cached" and commit; .omt/.gitignore keeps plans out of git`. It moves no file. A worktree copy of a plan usually comes from a commit of the main copy, so the hint names the fix.

No project. Before `plan`, `profile`, `ledger`, `brief`, and `lock` run, the CLI looks for a `.omt` or `.git` entry in the current directory and its parents. When it finds none, it prints one line to stderr: `warning: no .omt or .git found above <cwd>; omt uses it as the project root. Run omt from the project or worktree folder.` The command still runs.

## 5. CLI

Exit codes: 0 for success, 1 for a failure (bad config, a failed check, a conflict, a missing file), 2 for a usage error (unknown command, unknown flag, missing argument). `omt lock run` also returns the command's exit code, or 75 for a busy lock. `omt lock run` and `omt lock list` also return the lock tool's exit code when it is neither 0 nor 75. Every command accepts `--help`, prints its usage, and exits 0. `omt --version` prints the version. `omt` with no command or with `--help` prints the command list, which ends with a `help [<command>]` row. `omt help` prints the same text as `omt --help`, and `omt help <command>` prints the same text as `omt <command> --help`. Both exit 0, and so do `omt help --help` and `omt help -h`, which print the command list. `omt help` with a name that is not a command, such as `omt help nope`, fails with `unknown command "<name>"` and exit 2. `help` itself is not in the command registry, so `omt help help` fails the same way. A second argument fails with `unexpected argument "<arg>"` and exit 2.

Argument parsing uses `node:util` `parseArgs` with `strict: true` and `allowPositionals: true`, wrapped in `src/util/args.ts`. A parse error becomes an `OmtError` with exit code 2.

| Command | Synopsis |
| --- | --- |
| `install` | `omt install [--project [--no-git-exclude]] [--targets <list>] [--hooks] [--capabilities <file>] [--yes] [--dry-run] [--force]` |
| `uninstall` | `omt uninstall [--project] [--yes] [--dry-run] [--purge] [--force]` |
| `update` | `omt update [--check] [--dry-run] [--yes] [--skills-only] [--project] [--json]` (section 5.14) |
| `doctor` | `omt doctor [--project] [--capabilities <file>] [--yes] [--dry-run] [--json]` |
| `init` | `omt init` |
| `config` | `omt config [show \| explain \| path \| validate \| init] [--json] [--defaults] [--force]`, `omt config explain [--profile <name>] [--json]`, `omt config edit --web [--no-open] [--capabilities <file>]` |
| `detect` | `omt detect [--capabilities <file>] [--json] [--write] [--user \| --project] [--dry-run] [--yes]` |
| `roles` | `omt roles [--capabilities <file>] [--role <name>]... [--plan <slug>] [--profile <name>] [--json]` |
| `route` | `omt route <role> [--capabilities <file>] [--against <provider\|driver\|auto>] [--plan <slug>] [--profile <name>] [--unit <id>]` |
| `brief` | `omt brief <role> (--task <text> \| --task-file <file>) [options]` |
| `plan` | `omt plan new <slug> [--title <text>] [--light] [--max-parallel <n>] [--profile <name>] [--force]`, `omt plan profile <slug> <name\|none>`, `omt plan mark <slug> <id> <done\|open\|blocked>`, `omt plan limit <slug> <n\|none>`, `omt plan status [<slug>] [--json]`, `omt plan list [--json]` |
| `ledger` | `omt ledger add [options]`, `omt ledger list [--plan <slug>] [--json]`, `omt ledger stats [--plan <slug>] [--json]`, `omt ledger request-id --plan <slug> --unit <id> --role <role> [--round <n>] [--attempt <n>]` |
| `profile` | `omt profile list [--json]`, `omt profile show [<name>] [--plan <slug>] [--profile <name>] [--json]` |
| `lock` | `omt lock run <name> [--wait <seconds>] -- <command> [args...]`, `omt lock list` |
| `paths` | `omt paths [--json] [--root \| --plans \| --grills \| --ledger \| --evidence \| --config \| --shim]` |
| `worktree` | `omt worktree [check] [--json]`, `omt worktree setup [--dry-run] [--yes]` |
| `git` | `omt git check <commit\|push\|pr\|merge> [--user <login>] [--host <host>] [--pr-author <login>] [--plan <slug>] [--profile <name>] [--json]` |
| `hook` | `omt hook user-prompt-submit` |

In every flag that takes a file, `-` means standard input.

`--project` selects project scope for `install`, `uninstall`, and `doctor` (section 14.8). Without it, these commands work in user scope. `--no-git-exclude` without `--project` is a usage error.

`--capabilities` is optional everywhere. Without it, routing is `unverified`: the CLI trusts the chain, and T3 validates the target when `delegate_task` runs. The skills treat that as the normal path and fall back to the next rung on a typed T3 error. To verify, the agent saves the `orchestrator_capabilities` result to a file. Claude Code saves a large tool result to a file by itself and reports the path. On ACP providers, `acp-mcp-call orchestrator_capabilities '{}' > caps.json` writes it. Any agent can also write a trimmed copy that keeps only the providers and models its chains name.

Run modes. The CLI runs in one of three modes. `scripts/build.ts` sets the mode at build time with `--define OMT_BUILD='"bundle"'` or `--define OMT_BUILD='"binary"'`. `src/main.ts` reads it with `typeof OMT_BUILD` and uses `source` when it is not defined. `createContext()` sets these fields:

| `build` | What runs | `packageRoot` | `cliPath` | `runtimePath` |
| --- | --- | --- | --- | --- |
| `source` | Bun runs `src/cli.ts`, as in `bun src/cli.ts` in a clone | the directory above `src/` | `<packageRoot>/src/cli.ts` | `process.execPath` |
| `bundle` | Node 22 or later, or Bun, runs `dist/cli.js`, the one JavaScript file of the npm package | the directory above `dist/`, which holds `skills/` | `<packageRoot>/dist/cli.js` | `process.execPath` |
| `binary` | the compiled binary runs by itself, with neither Node nor Bun installed | `import.meta.dir`, the embedded root `/$bunfs/root` that holds `skills/` | `process.execPath` | unset |

`runtimeName` is `bun` when `process.versions.bun` is set, else `node`, and `runtimeVersion` is the version of that runtime. A binary reports the Bun runtime that it carries. The version comes from `import pkg from "../package.json" with { type: "json" }`, which the build inlines. In every mode, `src/` uses only `node:` built-in modules and no `Bun.*` API.

A binary reads its embedded files with `readdir`, `readFile`, `lstat`, and `stat`. `fs.cp`, `fs.copyFile`, and `fs.realpath` fail on them with `ENOENT`, because these calls go to the operating system, which has no `/$bunfs`. So code that reads `<packageRoot>/skills` uses only the calls that work (section 14.1).

Build. `bun run build` runs `bun scripts/build.ts [--bundle] [--binary] [--target <bun-target>]... [--outdir <dir>]`. Without `--bundle` and `--binary`, it builds both, for the host. The default output directory is `dist`. The script runs `bun build` from the repository root:

- `<outdir>/cli.js` comes from `bun build --target=node --define OMT_BUILD='"bundle"' src/cli.ts`. `bun build` keeps the source shebang, `#!/usr/bin/env bun`, so the script replaces the first line with `#!/usr/bin/env node`. The file then has exactly one shebang. The script sets its mode to 0755.
- `<outdir>/bin/omt` comes from `bun build --compile --minify --asset ./skills --define OMT_BUILD='"binary"' src/cli.ts`. The skills land at `/$bunfs/root/skills`. With `--target`, each target goes to `<outdir>/bin/<target>/omt`, and a cross-compile downloads the Bun runtime of that target.

Both outputs inline the worktree setup runner, its module and its text (section 5.11), and the config editor page (section 5.1), so neither needs a `templates/` folder.

### 5.1 `omt config`

- `show` (the default subcommand) prints the merged config as JSON, before the selected profile is applied (section 6.7). `--defaults` prints the installed release's current defaults (section 6.4) instead. Config issues go to stderr, and the command still exits 0.
- `explain` prints the layer that sets each value, as the section on value sources below describes.
- `edit --web` starts the config editor, as the section on the config editor below describes. `edit` without `--web` is a usage error with the hint `use omt config edit --web`. `--web`, `--no-open`, and `--capabilities` with another subcommand are usage errors.
- `path` prints two lines: `user: <path> (present)` or `(absent)`, then `project: <path> (present)` or `(absent)`. Neither path goes through `realpath`. The CLI takes its cwd from `$PWD` when `$PWD` resolves to `process.cwd()` and `findProjectRoot($PWD)` resolves to the same real directory as `findProjectRoot(process.cwd())`; otherwise it uses `process.cwd()`. So the project root always names the physical project, and `$PWD` changes only how it prints.
- `validate` prints each issue as `<severity> <source> <path>: <message>`, or `<severity> <source>: <message>` when the path is empty. A JSONC syntax error is one issue with an empty path and the message `<line>:<column>: <reason>`, so the file path appears once. It prints `config ok` when there is no issue. It exits 1 when any issue is an error. `--json` prints `{ "ok": boolean, "issues": ConfigIssue[] }`.
- `init` writes the starter user config (section 6.5) and prints `create <path>` or `overwrite <path>`. It refuses to overwrite an existing file unless `--force` is given.

Value sources. `omt config explain [--profile <name>] [--json]` reads both config files with `readConfigLayers`, merges them with `mergeConfigLayers` (section 6.3), and prints the report of `explainConfig(layers, loaded, profile?)` from `src/config/explain.ts`. Config issues go to stderr. Without `--profile`, the report explains the selected profile, as `effectiveConfig` selects it (section 6.7). The command prints the report only when that profile resolves. Then it exits 0, also when an issue is an error. When the profile does not resolve, the command prints no report. An unknown profile name, given or selected, or an unknown profile in its chain, is the usage error of `omt profile show` (exit 2). A profile cycle (`OmtError` code `profile_cycle`) or a chain of more than 8 profiles (`profile_depth`) exits 1. `--profile` with another subcommand is a usage error.

```ts
type ExplainSource =
  | { kind: "defaults" }
  | { kind: "user" | "project"; path: string }
  | { kind: "profile"; profile: string; declaredIn: ExplainSource };

interface ExplainEntry {
  path: string[];
  value: unknown;
  source: ExplainSource;
  overridden: { source: ExplainSource; value: unknown }[]; // highest first
}

interface ExplainReport {
  defaults: { source: string }; // source is LoadedConfig.defaultsSource
  profile: { name: string; source: ProfileSource };
  root: ExplainEntry[];
  effective: ExplainEntry[];
  removed: { path: string[]; source: ExplainSource }[];
}
```

The sources come from the merge steps, not from the paths that a file names:

- `mergeConfigLayers` returns `LoadedConfig` plus `steps: MergeStep[]`: the config after each merge step, first the accepted defaults, then each present file layer in order. `loadConfig` returns the same value without `steps`.
- A step sets a path when its layer has a value at the path and the config after the step has a value there. A `null` at an ancestor does not set the path.
- A step creates a path under `roles.<name>` or `profiles.<name>` when the object `<name>` is absent before the step, present after it, and holds the path. So the fields that `mergeLayer` fills in for a new role (`result`, `t3Role`, `interactionMode`, `runtimeMode`) belong to the layer that creates the role. A step removes the path when the object is present before the step and absent after it.
- The source of a path is the last step that sets or creates it. With no such step, the source is `{ kind: "defaults" }`.
- `overridden` lists, highest first, each earlier step that sets, creates, or removes the path, with its value after that step, and last the defaults when they have a value at the path. A step that removed the object adds `{ source, value: null }`. A step that sets the same value is still listed.
- `root` has one entry per leaf of `loaded.config`, `profiles.*` included. `configLeaves` in `src/config/defaults.ts` lists the leaves: an array is one leaf.
- `removed` lists each role and profile that a step holds and the final config does not, with the last layer that sets it to `null`. A role that one layer removes and a later layer creates again is not in `removed`.
- `effective` applies the same rules to the profile steps. `profileBase(config)` in `src/profile/resolve.ts` is the config before the first resolution step, and `profileSteps(config, name)` returns the config after each step of the chain, from `normal` to the named profile. `resolveProfile` uses both. `effective` has one entry per leaf of the resolved `roles`, `limits`, `models`, and `workflow`, and its paths start with these keys. In the base step, a `workflow` path has the source `{ kind: "defaults" }`, from the accepted `normal` profile before file overrides, and any other path has its `root` source. A profile step that sets or creates a path gives the source `{ kind: "profile", profile, declaredIn }`, where `declaredIn` is the `root` source of `profiles.<profile>.<path>`. For a filled-in field of a role that the profile creates, `declaredIn` is the `root` source of `profiles.<profile>.roles.<role>.access`.

The text output starts with the two file paths, `user: <path>` and `project: <path>`, then `defaults: <source>` and `profile: <name> (<source>)`. Then come the lines `root:`, `removed:` (only when `removed` is not empty), and `effective:`, each followed by its entries. An entry is one line, `<dotted path>  <value>  <label>`, and one line `  over <label>: <value>` per `overridden` item. Values print with `formatValue` of `src/config/defaults.ts`. A `removed` entry prints as `<dotted path>  <label>`. The labels are `defaults`, `user`, `project`, and `profile <name> (<label of declaredIn>)`. `--json` prints the `ExplainReport`.

Config editor. `omt config edit --web [--no-open] [--capabilities <file>]` reads the capabilities file with `readCapabilities` when given, and calls `startConfigEditor(ctx, { open, capabilities })` from `src/config/editor/server.ts`. It prints `omt config editor: <url>` and `Press Ctrl-C to stop. The editor also stops when you close its tab.`, waits until the server stops, prints `editor stopped`, and exits 0. On SIGINT or SIGTERM it closes the server and exits 0. It removes its signal handlers after the close. Without `--no-open`, it opens `http://127.0.0.1:<port>/` with `openUrl(url, platform)` from `src/util/open.ts`. This page asks for the full editor URL from the terminal and accepts only a URL on the same origin with a session token path. The browser opener never receives the token. The opener uses `open` on darwin, `cmd /c start "" <url>` on win32, and `xdg-open` on other platforms, spawned detached with `stdio: "ignore"`. When the opener cannot start, the command prints `warning: could not open a browser; open the URL yourself` to stderr and keeps running. With `--no-open`, nothing is spawned.

```ts
interface ConfigEditorOptions {
  open: boolean;
  idleMs?: number; // default 120_000
  closeGraceMs?: number; // default 5_000
}

interface ConfigEditor {
  url: string; // http://127.0.0.1:<port>/<token>/
  port: number;
  closed: Promise<void>; // resolves when the server has stopped
  close(): Promise<void>;
}
```

Server. The editor uses `node:http` and listens on host `127.0.0.1`, port 0. A listen error fails with `OmtError` code `editor_listen`. The token is 32 bytes from `randomBytes`, as base64url. The editor and API paths start with `/<token>/`. The public paths `/` and `/login.js` serve only the login page and its script. Neither response contains a token or configuration. omt runs no other server, and the editor runs only while the command runs.

Request checks, in this order:

1. The `Host` header must equal `127.0.0.1:<port>`, else 403 `forbidden`. A request without `Host` gets the same 403.
2. Except for `/` and `/login.js`, the path must start with `/<token>/`, compared with `timingSafeEqual`, and the rest must be a route, else 404 `not_found`. The two public routes accept GET only and use the same Host, Origin, fetch metadata, and response header checks.
3. When `Origin` is present, it must equal `http://127.0.0.1:<port>`, else 403 `forbidden`. `Origin: null` fails this check. A POST without `Origin` gets 403 `forbidden`.
4. When `Sec-Fetch-Site` is present, it must be `same-origin` or `none`, else 403 `forbidden`.
5. The method must be the route's method, else 405 `method_not_allowed` with an `Allow` header. `OPTIONS` gets this 405 too.
6. An `Expect` header other than `100-continue` gets 417 `expectation_failed`.
7. `api/preview` and `api/write` need `Content-Type: application/json`, else 415 `unsupported_media_type`.
8. On a POST route, a body over 1 MiB gets 413 `payload_too_large` with `Connection: close`. A `Content-Length` over 1 MiB gets the 413 before the body is read, and a chunked body gets it at the first byte over the limit. The server drops the rest of the upload. A GET route reads no body, so this check does not apply to it.

A CONNECT request and a protocol upgrade go through checks 1 to 4. When they pass, the request gets 405 `method_not_allowed` with `Allow`, and the server closes the socket. A request that does not parse gets 431 for a header overflow, 413 for a chunk-extension overflow, 408 for a request timeout, and 400 otherwise, all with code `bad_request`.

Every response, error responses and the parser-error responses included, has these headers: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. No response has an `Access-Control-*` header. `Referrer-Policy` is `same-origin` and not `no-referrer`, because with `no-referrer` a browser sends `Origin: null` on the page's own POST requests, which check 3 refuses. The page loads nothing from another origin, so no `Referer` with the token leaves it. An error body is `{ "ok": false, "code", "message", "hint"?, "newErrors"? }` and has no stack trace. An unexpected error gets 500 `internal_error`, and the server prints a warning to stderr.

Routes under `/<token>/`:

| Route | Method | Response |
| --- | --- | --- |
| `""` | GET | `index.html` |
| `app.css`, `app.js` | GET | the page assets |
| `api/state` | GET | the editor state |
| `api/explain?profile=<name>` | GET | `explainConfig` for that profile |
| `api/skill?name=<skill>` | GET | `{ name, text }`: the `SKILL.md` of a bundled skill |
| `api/skill-files?name=<skill>` | GET | maintainer mode only: `{ files: [{ path, hash, text }] }` |
| `api/skill-file` | POST | maintainer mode only: saves one skill file |
| `api/preview` | POST | the edit result, with nothing written |
| `api/write` | POST | the write result |
| `api/ping` | POST | 204 |
| `api/close` | POST | 204 |

The page assets come from `src/config/editor/assetText.ts`, a Bun macro that reads `templates/config-editor/<name>`. `src/config/editor/assets.ts` imports it `with { type: "macro" }`, as `src/worktree/runner.ts` imports the runner text (section 5.11).

`api/state` returns `{ version, mode, defaults: { source }, files: [{ kind, path, present, hash, text, issues }], profiles, selectedProfile, issues, explain, vocab, catalog, skills }`. `files` holds the user file, then the project file. `hash` is the SHA-256 hex of the file text, and `hash` and `text` are `null` for an absent file. `files[].issues` holds the issues of that file, and `issues` holds the issues of the merged config. `explain` is never `null`. It is the report of the selected profile. When that profile does not resolve, it is the report of `normal`. When `normal` does not resolve either, it has the `root` entries, the `removed` entries, and no `effective` entries, and the issues say why. `vocab` holds the keys, values, ranges, and patterns that `validateLayer` accepts, from the constants of `src/config/validate.ts` and `EFFORT_LADDER`, so the page offers the same choices.

`catalog` comes from `editorCatalog` in `src/config/editor/catalog.ts`: `{ source: "t3" | "local", providers: [{ id, driver, label, available, reason, models: [{ id, label?, efforts, fast }] }] }`. With capabilities, `source` is `t3`, each T3 provider is one entry, `available` is `canRunChildTask`, `efforts` are the choices of the model's first effort option that are on `EFFORT_LADDER`, and `fast` is true when the model has a `serviceTier` choice `priority` or a boolean `fastMode` option. Without capabilities, `source` is `local`, the entries are the default harnesses with the result of `detectHarnesses`, the models are the chain models of the defaults and the merged config for that driver, `efforts` is `EFFORT_LADDER`, and `fast` is `null`. `skills` lists the folder names under `<packageRoot>/skills` that match `^[a-z][a-z0-9-]{0,63}$`.

`api/skill` reads `<packageRoot>/skills/<name>/SKILL.md`. A name that does not match the pattern above, or a skill without the file, gets 404 `unknown_skill`.

Maintainer mode. `bun run defaults:edit [--no-open] [--capabilities <file>]` runs `scripts/edit-defaults.ts` in an omt clone. It starts the same server with `maintainer: { defaultsPath, skillsRoot }`, where `defaultsPath` is `src/config/defaults.jsonc` and `skillsRoot` is `skills/` of the clone. The published CLI has no way to start this mode. In maintainer mode:

- `mode` is `defaults`. Otherwise it is `config`.
- `files` holds `defaultsPath` with kind `user`, then a project entry with `path: ""` and `present: false`. The server reads no user or project config. An edit request with `file: "project"` gets 400 `bad_request`.
- The merge base is an empty config, `{ version: 1, profile: "normal", profiles: {}, models: {}, roles: {}, limits: {} }`, not the accepted or current defaults. So `explain` shows the values of the file itself, and a removed key is gone.
- Step 4 of an edit request also makes a new error when the candidate fails `isCompleteDefaults` of `src/config/defaultsState.ts`, the same check as for an accepted defaults snapshot.
- `skills` lists the skill folders under `skillsRoot`.
- `api/skill-files` lists `SKILL.md`, then each `.md` file under `references/` in path order, each with its SHA-256 `hash` and `text`. A symlink is not listed. A skill without `SKILL.md` gets 404 `unknown_skill`.
- `api/skill-file` takes `{ name, path, base, text }`. `path` must be `SKILL.md` or `references/<path>.md` with at most 5 folder levels and no `..`; another value, a bad name, or a non-string `text` gets 400 `bad_request`. The route writes existing files only: an absent file gets 404 `unknown_skill_file`. A file whose real path is outside the skill folder gets 400 `bad_request`. A `base` that differs from the current text gets 409 `skill_changed`. A `SKILL.md` that does not start with `---` and `name: <name>` gets 422 `skill_frontmatter`. Otherwise the route writes the text atomically and returns `{ path, hash, text }`. The server runs it in the same queue as the config writes.

Outside maintainer mode, `api/skill-files` and `api/skill-file` get 404 `not_found`.

`api/explain` without a `profile` value gets 400 `bad_request`. An unknown name gets 400 `unknown_profile` with the known profiles in the hint. A profile whose chain does not resolve gets 422 `profile_invalid`.

Edit requests. `api/preview` and `api/write` take the body `{ "file": "user" | "project", "base": string, "edits": ({ "path": string[], "value": unknown } | { "path": string[], "remove": true })[] }`. `base` is the `hash` of the file text that the page edited. A body that is not a JSON object, a `file` that is neither name, a `base` that is not a string, fewer than 1 or more than 200 edits, a path that is empty or has an empty segment, a `path[0]` that is not in `ROOT_KEYS` or is `$schema` or `version`, or an edit without exactly one of `value` and `remove: true` gets 400 `bad_request`. Both routes then do these steps:

1. Read the target file with `readConfigTarget` (section 5.12). An absent file gets 404 `config_not_found` with its hint, `run omt init` or `run omt config init`.
2. Compare the SHA-256 of the text with `base`. A difference gets 409 `config_changed` with the message `<path> changed since the editor loaded it; nothing was written` and the hint `reload the page`.
3. Apply the edits in order with `setJsoncValue` (section 7). A `remove` edit passes `undefined`. A target that does not parse gets 422 `jsonc_parse`, and a failed edit gets 422 `jsonc_edit`, each with its message.
4. Check the candidate text with `layerFromText`, and merge it with the other file's layer through `mergeConfigLayers`. Do the same with the current text. An error issue of the candidate whose `source`, `path`, and `message` the current files do not have is a new error. Warnings never block.

`api/preview` returns `{ text, diff, issues, newErrors }` and writes nothing. `diff` comes from `lineDiff` in `src/config/editor/diff.ts`: `{ op: " " | "+" | "-"; line: string }[]`, from the longest common subsequence of the lines. When either text has over 5,000 lines, the diff removes every old line and adds every new line.

`api/write` refuses a new error with 422 `config_invalid`, the message `the change adds <n> config errors; nothing was written` (`1 config error` for one error), and `newErrors`. Otherwise it writes the candidate text with `writeConfigTarget(target, snapshot, next)` (section 5.12), where `snapshot` is the text of step 1, and returns `{ "ok": true, "state" }` with the new editor state. When the candidate equals the snapshot, it writes nothing. A `config_changed` error from `writeConfigTarget` gets the 409 of step 2. The server runs previews and writes one at a time, in the order in which their bodies complete, from step 1 to the end of the atomic write. So of two writes with the same `base`, the second reads the new text and gets 409. A writer outside omt can still change the file between the last read and the rename, as for other config writes.

Editor page. The initial view is Skills, with all 10 bundled skills. Build, Code review, Plan, and Design have a configured flow, and a selected stage shows its editable keys. Every skill page shows the skill description, its child roles, and its `SKILL.md` from `api/skill`, rendered read-only as text nodes: the page never inserts the file as HTML. A relative link in the file points to the file on GitHub, and a link with another scheme than `http` or `https` is plain text. Roles and Profiles have separate lists and focused editors. The rung fields Provider, Model, and Effort are dropdowns from `catalog`; Model also accepts a custom value. A profile card lists the values that the profile sets and the commands that select it. Settings holds the harnesses, with one checkbox per catalog driver, the limits, and the model options; the workflow keys, the roles, and the `profile` key are on the Skills pages, the Roles pages, and the header. A source badge opens help, the saved layer history, the edit destination, and reset. There is no layer strip, introductory legend, or permanent source inspector.

In maintainer mode, the header names `src/config/defaults.jsonc` in place of the file picker, and the page calls the user layer `built-in`. A skill page shows the skill files from `api/skill-files` in three columns: the file list, a text area, and the rendered preview, which follows each key press. Save, or Cmd-S or Ctrl-S in the text area, sends `api/skill-file`. A role page links to the role's file under `skills/omt/references/roles/`, or to `_generic.md` for a custom role: in maintainer mode it opens that file in the Router skill page, and otherwise it opens the file on GitHub.

`Show values for` fetches an explain report without staging a `profile` edit. During the request, dependent edits are disabled. A failed request retains the last successful report and identifies its profile. Late responses cannot replace a newer selection. `Saved default` stages a root `profile` edit in the selected file. The saved default can still be overridden by a command argument or plan header. The page compares the current preview with the saved-default explain report to compute changed values; it does not hard-code preset differences.

Dropdowns, segments, and checkboxes stage changes immediately. Text and number fields stage on Enter or change, and invalid input stays in its draft. Workflow edits target `profiles.<preview>.workflow.*`. Roles, limits, and models use base or profile scope, separately from the User or Project file destination. Both the flows and the settings list read the same pending edits, including inherited profile changes and file precedence. The page marks unsaved values, names their destination, offers Undo, and identifies shadowed edits before a write. Boolean overrides support Inherit, On, and Off. Multi-field role and profile drafts use Add changes. Chain cards retain configured rung numbers and support reorder, driver and raw options, and explicit fast inheritance. Cross-family attempt order is a local preview for a selected main driver. Without capabilities, a rung never claims verified availability.

Review changes shows a per-file diff and validation. Write project file or Write user file writes only the reviewed request for that file. Other files keep their queues and original hash bases. New errors block writes; warnings do not. Reload and review is an explicit conflict action: it loads the newer file, keeps the queued edits, rebases only that file, and requires a new review before writing. Discard asks before clearing a file's queue. A beforeunload handler warns about unsaved queues and dirty drafts. The disconnected state keeps them in the tab. A missing optional file is neutral and unavailable as a destination; file help gives its path and init command.

Flows describe configured skill behavior, not live task state. Build QA always remains in the flow; `build.qa` controls the approved test list. A required oracle replaces the review child even when build review is off. Build review and QA run in sequence. Review loops and QA retries show their limits. Code review has separate sizing, family, oracle, pull request, and owner-approved fix rules. Plan review has at most two rounds. Design loops through owner feedback without an automatic model review.

Lifetime. The page posts `api/ping` at load and then every 5 seconds. An `api/close` starts a timer of `closeGraceMs`, also before the first ping, and stops the idle timer. A ping in that time cancels the close. Else the server stops. A reload sends a close, and the new page pings at load, so the server keeps running. Each ping starts an idle timer of `idleMs`. When it runs out with no ping, the server stops. The default of 120 seconds is longer than the one-minute timer interval that Chrome gives a tab that stays hidden for more than 5 minutes. With no ping and no close, the server runs until SIGINT, SIGTERM, or `close()`. `close()` stops both timers and the listener, waits for the running preview or write to finish, closes the open connections, and then resolves `closed`.

### 5.2 `omt init`

Creates, in the project root, only what is missing:

- `.omt/config.jsonc` with the starter project config (section 6.5)
- `.omt/plans/`
- `.omt/.gitignore` with the nine lines `ledger.jsonl`, `evidence/`, `bin/`, `install.json`, `backups/`, `plans/`, `locks/`, `guardrails.md`, and `grills/`. A live plan is shared state of all worktrees (section 4), not source, so git does not see it.

When `.omt/.gitignore` exists and lacks some of these lines, `init` appends the missing lines and keeps every other line. An older omt wrote fewer lines, so this brings an existing project up to date. A symlinked `.gitignore` is updated through its target, and a dangling symlink is left alone.

It prints one line per path: `create <path>`, `update <path>`, or `exists <path>`. It never overwrites the config, and it never removes a line. Then it prints one line about the worktree setup of the current checkout, `worktree setup: <status> <message>`, from the `summary` of section 5.11. A read error in that check gives a `WARN` line and does not fail `init`.

### 5.3 `omt roles` and `omt route`

`omt roles` loads the config, applies the selected profile, resolves every role (or only the roles named with `--role`), and prints a table. In this example, the capabilities show Grok as disabled, and a project config sets a custom `oracle` chain with the rungs `grok/grok-build` and `codex-pro/gpt-6-astra`. The second rung names only the provider `codex-pro`, without a `driver`.

```text
ROLE         STATUS      TARGET                                         ACCESS     MODE     CROSS
execute      resolved    claudeAgent/claude-opus-5-5 effort=medium      edit       default  no
review       resolved    codex/gpt-6-astra reasoningEffort=high         edit       default  yes
oracle       unavailable -                                              edit       default  yes
  rung 1 grok/grok-build: provider grok cannot run child tasks: Provider instance is disabled.
  rung 2 codex-pro/gpt-6-astra: provider instance codex-pro is not registered in T3
```

`MODE` is the role's `interactionMode`. `CROSS` is `yes` when the role has `crossFamily: true`, else `no`. Under each role, the table prints one indented line per failure reason of the rungs before the chosen one, and the notes of the chosen rung. For an unavailable role it prints the reason of every rung. Later rungs are not shown.

A footer line says either `verified against orchestrator_capabilities` or `unverified: pass --capabilities <file> to check the chains against T3`. `--json` prints the `RolesReport`. Config issues go to stderr. An unknown `--role` exits 1.

`omt route <role>` prints a `RouteOutput` (section 3) as JSON. Its `delegateTask` fields map directly onto `delegate_task` arguments. This is `omt route review --against codex --capabilities caps.json`:

```json
{
  "role": "review",
  "status": "resolved",
  "description": "Review a diff against its brief, fix local findings in the changed files, and report the rest by severity. Runs on the family that did not make the change.",
  "access": "edit",
  "result": "review",
  "delegateTask": {
    "target": { "providerInstanceId": "claudeAgent", "model": "claude-opus-5-5", "options": { "effort": "high" } },
    "role": "review",
    "interactionMode": "default",
    "runtimeMode": "inherit"
  },
  "fallbacks": [{ "providerInstanceId": "codex", "model": "gpt-6-astra", "options": { "reasoningEffort": "high" } }],
  "notes": ["cross-family: worker family codex; other families first"]
}
```

An unknown role is an error (exit 1) that lists the known roles. A `resolved` or `unverified` role exits 0. An `unavailable` role prints the JSON with `delegateTask` absent and exits 1.

`--against <value>` names the worker whose change the task reviews. The value is a provider instance id, a driver kind, or `auto`. The value must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, else it is a usage error (exit 2). Section 8.3 defines the reorder and its notes. `--plan` also selects the plan header's profile. `--profile` overrides the selected profile (section 6.7). Both `roles` and `route` accept these flags. They accept a `--plan` id with no plan file and use the config profile unless `--profile` is given. `--unit` filters worker selection for `--against auto`. The ids follow section 5.6.

`--against auto` reads `.omt/ledger.jsonl` in the project root. It needs `--plan`; without it the command is a usage error (exit 2). A role without `crossFamily: true` does not read the ledger. Otherwise the CLI picks the worker with `pickWorker` (section 8.3):

- A worker entry has status `dispatched`, the given plan, a `provider`, and a role whose `result` in the effective config is `work` or `plan`. Entries of unknown roles are skipped. An entry without a `provider` is skipped. An entry whose `provider` is set but is not a non-empty string is skipped with `warning: skipped a ledger entry with an invalid provider <value> (role <role>, unit <unit or none>, ts <ts>)` on stderr.
- With `--unit`, when the unit has worker entries, the worker is the provider of the last one in file order. The note is `--against auto: worker <provider> from the last work dispatch of unit <id>`.
- Otherwise, for each unit, take its last worker entry. Entries without a unit count as one unit. The worker is the provider of most of these last entries. On a tie, it is the tied provider with the latest of these last entries in the file. An earlier entry that a later entry of the same unit replaces does not count for the tie. The note is `--against auto: worker <provider> from the provider of most units in plan <slug>`.
- When the plan has no worker entry, the chain keeps its configured order, and the note is `--against auto: no worker dispatch with a provider in plan <slug>; the configured order applies`.
- A malformed ledger line prints `warning: <path>:<line>: skipped a malformed ledger line` to stderr.

The `--against auto` note comes before the cross-family notes.

### 5.4 `omt brief`

Options:

| Flag | Meaning |
| --- | --- |
| `<role>` | role name (positional, required) |
| `--task <text>`, `--task-file <file>` | the task; exactly one is required |
| `--context <text>`, `--context-file <file>` | background the child needs |
| `--scope <path>` | a file or directory the child may change or must read; repeatable |
| `--done <text>` | one done condition; repeatable |
| `--verify <command>` | one verify command; repeatable |
| `--prior-file <file>` | earlier rounds: findings, responses, unresolved objections |
| `--round <n>` | review or fix round, default 1 |
| `--depth <n>` | the child's depth, default 1 |
| `--max-depth <n>` | overrides `limits.maxDepth`, 0 to 3 |
| `--plan <slug>`, `--unit <id>` | plan and unit ids for the header and request id; `--plan` also selects the plan profile |
| `--profile <name>` | override the selected profile |
| `--attempt <n>` | attempt number within the round, default 1 |
| `--title <text>` | thread title for `--json` output |
| `--capabilities <file>` | used with `--json` to resolve the target |
| `--against <provider\|driver\|auto>` | the worker whose change the task reviews, used with `--json` (section 5.3) |
| `--json` | print a ready `delegate_task` payload instead of the brief text |
| `--save` | save the full brief to evidence; with `--json`, return a short task that names the saved file; with `--json`, `--plan`, and `--unit`, also check the parallel limit and record the start |
| `--fallback` | with `--json`: use the first target in the resolved order that this plan, unit, role, and round have not tried |
| `--tried <key>` | with `--fallback` and no recorded start: a target key that was tried already; repeatable |
| `--strict` | with `--against`: exit 1 when the chosen target is in the `--against` worker's family |

`--attempt <n>` (default 1) is the attempt number for the request id (section 10). `--round`, `--depth`, and `--attempt` are positive integers. `--task` and `--task-file` exclude each other, and so do `--context` and `--context-file`. Only one flag can read stdin. An empty task is a usage error. An unknown role exits 1. The brief's `maxDepth` is `--max-depth` when given, else `limits.maxDepth` from the effective config. A `--depth` greater than that max is a usage error (exit 2) with a hint that names `--max-depth`. The retired roles `verify`, `quick`, and `deep` are not in the defaults (section 6.4), so `omt brief verify` exits 1 like any unknown role. `--plan` must match the plan slug regex (section 5.5) and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`; a mismatch is a usage error. When the rendered brief is longer than 120,000 characters, the command prints nothing to stdout and exits 1 with a hint to shorten `--context` or `--prior-file`.

Without `--json`, the command prints the rendered brief (section 9). With `--json`, it prints a `BriefJsonOutput` (section 3). The `delegateTask` object is exactly the argument object for the `delegate_task` tool:

```json
{
  "delegateTask": {
    "task": "<rendered brief>",
    "title": "review U3 r2: token refresh",
    "target": { "providerInstanceId": "claudeAgent", "model": "claude-opus-5-5", "options": { "effort": "high" } },
    "role": "review",
    "interactionMode": "plan",
    "runtimeMode": "inherit",
    "mode": "async",
    "clientRequestId": "omt:auth:U3:review:r2:a1"
  },
  "fallbacks": []
}
```

- `title` is `--title` when given, cut to 72 characters. Otherwise it is `<role>` plus ` <unit>` when a unit is given, plus ` r<round>` when the round is greater than 1, then `: ` and the first non-empty line of the task. The title is cut to 72 characters.
- `clientRequestId` is present only when both `--plan` and `--unit` are given (section 10).
- `target` and `fallbacks` come from the role resolution, after the `--against` reorder (section 8.3). When the role is unavailable, the command prints nothing to stdout, prints the rung reasons to stderr, and exits 1.
- `--against`, `--plan`, `--profile`, and `--unit` follow section 5.3, also without `--json`. A `--plan` id does not require a plan file. With `--json`, role-level notes, rung notes, and rung failures go to stderr as `note: <note>`.

With `--save`, the CLI atomically writes the full brief to `<evidence>/briefs/<clientRequestId>.md`. Without both `--plan` and `--unit`, the name is `<role>-<first 12 hex of the brief's sha256>.md`. Without `--json`, stdout still contains the full brief.

With `--save --json`, `delegateTask.task` is:

```text
Act as the <role> sub-agent for this task. Your full brief is in the file <absolute path>. Read it in full first, then follow it exactly. End with the result block that the brief defines.
```

The pointer has no fixed length cap of its own. The path length determines its length. The other dispatch fields stay unchanged. The output adds `ledger.dispatched`, a shell command:

```text
<cli> ledger add --plan <p> --unit <u> --role <r> --round <n> --attempt <a> --status dispatched --task-id <taskId> --client-request-id <id> --provider <provider> --model <model>
```

The output adds `targetKey`, the key of the chosen target: `<providerInstanceId>/<model>`, or `driver:<driverKind>/<model>` for a target that names only a driver. The resolved order is the routing order after the `--against` reorder (section 8.3), with one more target after each driver-only target: the same rung with `providerInstanceId` set to the driver. `fallbacks` holds the targets after the chosen one.

Start record. With `--save --json`, `--plan`, and `--unit`, the command holds an exclusive lock, `.omt/locks/ledger.lock`, made with `open(path, "wx")`. It retries for up to 5 seconds and treats a lock file older than 30 seconds as stale; a held lock exits 75. Under the lock it runs these steps in order:

1. Resend. Without `--fallback`, when an open start (section 5.6) has the same `clientRequestId`, it saves the brief, prints the output with the recorded target, and records nothing. It makes no limit check.
2. Fallback. With `--fallback`, the tried keys are the `targetKey` values of the dispatched entries of the same plan, unit, role, and round, and the attempt is the highest of their attempts plus 1. With no such entry, the command exits 1. Each open start of them gets a `failed` entry with the note `superseded by attempt <n>`. `--attempt` and `--tried` are usage errors with this form.
3. Strict. With `--strict` and a cross-family role, a chosen target in the family of the `--against` worker exits 1 with `no <role> target outside <family> is left`.
4. Limit. `active` is the number of open starts of the plan, after step 2. The limit is the profile's `limits.maxParallel`, lowered by a plan header `max-parallel`. When `active` reaches the limit, the command prints `omt: limit: <active> of <max> children are active; run this command again after one ends` to stderr, writes nothing, and exits 75.
5. It appends the `failed` entries of step 2, saves the brief, and appends one `dispatched` entry with plan, unit, role, round, attempt, `clientRequestId`, `provider`, `model`, and `targetKey`, and no `taskId`.

The output then adds `ledger.done`, a shell command:

```text
<cli> ledger done <clientRequestId> --verdict <VERDICT>
```

Without `--save`, or without `--plan` or `--unit`, the command writes no ledger entry and makes no limit check. `--fallback` then needs `--attempt`, and takes the tried keys from `--tried`. With no untried target left, the command exits 1 with `no fallback left for <role>; tried: <keys>`. `--fallback` and `--strict` need `--json`, `--tried` needs `--fallback`, and `--strict` needs `--against`; each is a usage error otherwise. An unavailable JSON route saves no brief. The full rendered brief still has the 120,000-character limit before a save.

### 5.5 `omt plan`

- `new <slug>` writes `.omt/plans/<slug>.md` from the template in section 12. A slug matches `^[a-z0-9][a-z0-9-]{0,63}$`. An existing file is an error unless `--force` is given. `--light` leaves the `F2` oracle line out. `--max-parallel <n>` writes the `max-parallel=<n>` header key (section 12.2). An integer outside 1 to 32 is a usage error (exit 2). `--profile <name>` validates the selected profile and adds `profile=<name>` after the limit keys. Without that flag, `new` validates the config profile but writes no profile key. It prints the path.
- `profile <slug> <name|none>` changes only the plan header. A name sets `profile=<name>` and prints `set profile=<name> for <slug>`. `none` removes the override and prints `removed the profile of <slug>`. It validates the resulting selection, keeps other header keys, and writes atomically. A missing plan or header exits 1. An unknown profile exits 2 and lists known profiles. The `--profile` flag applies only to `new`; other plan subcommands reject it with exit 2.
- Each plan mutation resolves the destination, including dangling links and existing parent links, and refuses a destination outside the project root. Links to files inside the project remain supported.
- `mark <slug> <id> <done|open|blocked>` sets the checkbox of the column-zero item line for `<id>` (such as `U3`, `D1`, or `F2`) to `x`, a space, or `~`. It appends `- <ISO timestamp> <id> -> <state>` to the end of the file (the `## Log` section is last), writes atomically, prints `marked <id> <state>`, and exits 0. A missing plan or id exits 1. A bad state exits 2.
- `limit <slug> <n|none>` changes the header comment of an existing plan. The value sets the `max-parallel` key to `<n>`, or removes it with `none`. Without a value, it exits 2. It changes only the header comment (section 12.2), not a later omt-plan comment in the body, keeps the other keys, and writes atomically. It prints `set max-parallel=<n> for <slug>` or `removed the max-parallel limit of <slug>`. A missing plan exits 1. A value that is not `none` or an integer from 1 to 32 exits 2.
- The task budget was removed. `--tasks` (with any subcommand, `limit` included) and `--max-tasks` (with `new`) are usage errors (exit 2). The message says `--tasks is no longer supported: the task budget was removed` (or `--max-tasks`). The command changes no file.
- `status [<slug>]` parses one plan and prints its counts, the next open unit, and the ready units (section 12.2). The first line has the absolute path of the plan file, so a skill can hash and edit the shared plan from any worktree. The next line is `profile: <effective name>`. When the plan has `maxParallel`, it prints `max parallel: <n>` after the `final` line. The line after `next:` is `ready: <id>, <id>` with the ids of the `ready` units in file order, or `ready: none`. Then it prints one `warning: <text>` line for each header warning, then one for each dependency warning (section 12.2). A header with a `max-tasks` key gives the header warning `the max-tasks header key is no longer used; remove it`. The key has no effect. `--json` adds the same texts in a `warnings` array. Without a slug it uses the most recently modified plan. `--json` prints the parsed `PlanStatus` with an added `path` and the effective `profile` name.
- `list` prints one line per plan: slug, unit counts, and the next open unit. `--json` prints an array of `PlanStatus` items, each with an added `path`, so each item also has `ready`. Unlike `status`, `list` keeps the stored optional profile name without resolving it.
- `list` and `status` skip a `*.md` entry whose `stat` fails with ENOENT, such as a dangling symlink.

### 5.6 `omt ledger`

- `add` appends one `LedgerEntry` (section 3) as one JSON line to `.omt/ledger.jsonl`, with one `appendFile` call. Required flags: `--role` and `--status`. `--role` accepts any name, not only config roles, because the skills record `swarm` and `loop`. Optional flags: `--plan`, `--unit`, `--round`, `--attempt`, `--task-id`, `--client-request-id`, `--provider`, `--model`, `--verdict`, `--note`. `--round` and `--attempt` are positive integers. `--status dispatched` needs `--task-id` or `--unit`, else exit 2. A `dispatched` entry without `--task-id` is still appended, and the command prints `warning: this dispatched entry has no --task-id; result matching needs it` to stderr. It prints the entry as JSON. A terminal entry that closes no dispatched entry is still appended; the command then prints `omt: no dispatched entry matches; nothing was closed` to stderr and exits 0.
- In every subcommand, `--plan` must match the plan slug regex (section 5.5) and `--unit` must match `^[A-Za-z0-9._-]{1,64}$`; a mismatch is a usage error.
- Terminal statuses are `completed`, `failed`, `cancelled`, `interrupted`, `verified`, and `rejected`. A terminal entry T closes a dispatched entry D by the first rule that applies: (1) when both have a `clientRequestId`, only an equal one closes; (2) otherwise, when T has a `taskId`, only an equal `taskId` closes; (3) otherwise, both need a `unit`, and T and D must have the same `plan`, `unit`, `role`, `round` (default 1), and `attempt` (default 1). A terminal entry with neither `taskId` nor `unit` nor a matching `clientRequestId` closes nothing. `closes()` and the index in `ledgerStats()` apply the same rules. An open start is a dispatched entry that no terminal entry closes. `active` counts dispatched entries that no terminal entry closes, in any order. Statistics index terminal task IDs and fallback identities once. Optional identity and display text fields must be strings, except `provider`, which routing checks with its existing warning. Round and attempt values must be positive safe integers.
- Table output caps each displayed cell at 120 characters with a final ellipsis and stops at 1,000,000 characters plus a truncation notice. `--json` keeps full values.
- `list` prints a table with the columns `TIME` (HH:MM:SS of `ts`, in UTC), `PLAN`, `UNIT`, `ROLE`, `ROUND`, `STATUS`, `VERDICT`, `TASK` (the last 12 characters of `taskId`). It filters by `--plan` when given. `--json` prints an array of entries. A malformed line is skipped with a warning on stderr.
- `stats` loads the config, applies the plan header's profile or the config profile, and prints a `LedgerStats` (section 3). Text mode prints one line per field: `plan` (with `--plan`), `profile` (the effective name), `dispatched`, `active`, `terminal`, `max parallel`, and `can dispatch: yes` or `can dispatch: no`. `canDispatch` is `active < maxParallel`. A run has no task budget, so the number of dispatched entries never stops a dispatch. `--json` prints the object. The command has no `--profile` flag. Its JSON has no `profile` field. Before a plan file exists, a skill with a selected run profile compares these counts with `omt profile show <name> --json` limits (section 15.2).
- With `--plan <slug>`, when `.omt/plans/<slug>.md` exists and its header has `max-parallel` (section 12.2), the effective `maxParallel` is the lower of the profile-applied config value and the plan value. `limits.maxParallel` holds the effective value, `planMaxParallel` holds the plan value, and `canDispatch` uses the effective value. Text mode then prints `max parallel: <effective> (plan <n>, config <m>)`. Without a plan file, the config selects the profile. Without a plan limit, the profile-applied config limits apply.
- A plan header `max-tasks` key and a config `limits.maxTasksPerRun` have no effect on `stats`. The config key gives the retired-key warning on stderr (section 6.2).
- `request-id` prints the canonical `clientRequestId` (section 10).
- `done <id>` closes the latest open start whose `clientRequestId` or `taskId` is `<id>`. Options: `--verdict`, `--status` (`completed`, the default, `failed`, `cancelled`, or `interrupted`; another value exits 2), `--task-id`, and `--note`. It appends a terminal entry with the start's `plan`, `unit`, `role`, `round`, `attempt`, `clientRequestId`, `provider`, and `model`. With no open start, it exits 1 with `no open child matches <id>` and writes nothing. It prints `closed <unit> <role> r<round> a<attempt>`, then the `settle:` line of `settle-check`.
- `settle-check` prints `settle: no (linked worktree)` when the nearest checkout is a linked worktree (`mainCheckoutOf`, section 4), else `settle: allowed`. It writes nothing. T3 runs the project's settle script in a settled thread's worktree, and a child that shares a linked worktree has that worktree.

### 5.7 `omt hook user-prompt-submit`

See section 13. The help text says that the command prints additional context that loads the omt-ulw skill when the prompt asks for ultrawork.

### 5.8 `omt paths`

Prints the absolute paths of the project state, resolved through `findProjectRoot`. So from a linked worktree it prints the paths in the main checkout.

- Without a flag it prints one `name: path` line for each path. The order is `root` (the project root), `omt` (`omtDir`), `plans` (`plansDir`), `grills` (`grillsDir`), `ledger` (`ledgerPath`), `evidence` (`evidenceDir`), `config` (`projectConfigPath`), and `shim` (`projectShimPath`).
- `--json` prints an object with the same keys.
- One of `--root`, `--plans`, `--grills`, `--ledger`, `--evidence`, `--config`, or `--shim` prints only that path and a newline, for use as `$(omt paths --evidence)`.
- Two path flags, a path flag with `--json`, or a positional argument is a usage error (exit 2).
- The command creates no path. Root resolution can read the worktree metadata from section 4.

### 5.9 `omt profile`

- `list` prints a table of profile names and descriptions in config order. `--json` prints an array of `{ name, description }`. It includes the presets and custom profiles. `--plan` and `--profile` are usage errors with `list`.
- `show [<name>] [--plan <slug>] [--profile <name>]` prints the resolved profile from section 6.7. A positional name and `--profile` are alternatives. Giving both exits 2. Text output starts with `profile: <name>` and `source: <source>`, then JSON for `workflow`, `limits`, `roles`, and `models`.
- `show --json` prints `{ profile, source, workflow, limits, roles, models }`. `source` is `argument` for a positional name or `--profile`, `plan` for a plan header selection, `config` for a config selection other than `normal`, and `default` otherwise. A config that explicitly selects `normal` still gives `default`.
- `show --plan <slug>` requires the plan file, even with an explicit name. A missing file exits 1 with `plan_not_found`. An unknown profile exits 2 and lists known names. A cycle or a chain deeper than eight profiles exits 1 and names the chain.
- Profile role-merge issues go to stderr. Valid fields still appear in the output.

### 5.10 `omt lock`

`omt lock run <name> [--wait <seconds>] -- <command> [args...]` runs the command with inherited stdio and returns its exit code. The command runs in the caller's cwd and environment. A command killed by a signal returns 128 plus the signal number. The wrapper forwards SIGINT and SIGTERM to the command and waits for it to exit.

- A lock name matches `^[a-z0-9][a-z0-9._-]{0,63}$`. `--wait` is a non-negative safe integer in seconds, default 900. A missing `--`, command, or valid name exits 2.
- The CLI prefers `flock` on `PATH`, then `lockf`. It opens `<lock folder>/<name>.lock` for append and read with the state-file checks from section 1, then gives the open file to the tool as fd 3. The tool command is `flock -E 75 -w <seconds> 3` or `lockf -s -t <seconds> 3`.
- When `flock` or `lockf` exits with a code other than 0 or 75, the CLI returns that code. It prints `omt: <tool> exited with code <n>` to stderr. This applies to both `omt lock run` and `omt lock list`.
- It first tries with zero seconds. When busy, it prints `waiting for lock <name> (pid <n>: <command>)` to stderr, then waits up to `--wait`. Missing holder data gives `pid unknown: unknown command`. A timeout exits 75 with `omt: lock <name> is busy`.
- After acquisition, it truncates the same open file and writes one JSON line with `pid`, `command`, and `startedAt`. `pid` is the wrapper PID. After command start, it rewrites the line with `childPid` too. The lock file is never replaced or deleted. This preserves the inode that the kernel locks.
- The command receives the locked open file as fd 3. The kernel holds the lock while any process keeps that open file. It can outlive a killed wrapper. A descendant that closes fd 3 or does not inherit it is covered only while another holder remains. Node's default `spawn` stdio does not pass fd 3. The workflow uses locks for commands whose subprocesses end before the command ends. Long-running servers, watchers, and daemons run outside the lock, with a serial plan (section 15.2).
- With neither tool on `PATH`, it prints `warning: no flock or lockf on PATH; running <command> without a lock`. It runs the command without a lock and returns its exit code. This path creates no lock folder.

`src/lock/lock.ts` finds the lock folder through Git when possible. `<project path>` is the project root's path relative to the Git top level.

1. When `git worktree list --porcelain` names the main checkout, use `<main checkout>/<project path>/.omt/locks/`.
2. When the first worktree path is the Git common directory itself, use `<git common dir>/omt/locks/<project path>/`. This covers a repository with a separate Git directory.
3. When Git cannot identify a main checkout, use `<project root>/.omt/locks/`.

Each lock folder gets a `.gitignore` with `*`. `omt init` also adds `locks/` to `.omt/.gitignore`. Worktrees of the same project therefore use the same lock files without new Git changes.

`omt lock list` opens each regular `*.lock` file in name order and tries a zero-second lock on that new open file. It prints `<file> free` or `<file> held <holder JSON>`. Missing holder data leaves out the JSON. An absent lock folder gives no output and exits 0. With an existing folder and neither lock tool, it exits 1 with `no flock or lockf on PATH; cannot list locks`. There is no clear or takeover command.

### 5.11 `omt worktree`

`omt worktree` checks and creates the T3 setup script that installs a checkout's dependencies when T3 creates a worktree. It supports Bun and pnpm, and it selects a global virtual store, so the worktrees of one machine share installed package directories. Each checkout keeps its own `node_modules` links.

Root. The command works on `findCheckoutRoot(cwd)`, the checkout of the current directory, not on `findProjectRoot(cwd)`. In a linked worktree the setup files go into that worktree, while `.omt` stays in the main checkout (section 4). Without `.git` above `cwd`, the report inspects `findProjectRoot(cwd)` and setup refuses.

Shared code. `templates/worktree-setup.mjs` is the runner that setup copies to `<root>/.t3/omt-worktree-setup.mjs`. It uses only Node built-ins and runs without omt. `src/worktree/runner.ts` imports the same file as a module and uses its exports, `detectManager(root)`, `checkLinker(root, manager, { env, home })`, `persistentGlobalStore(root)`, and `PNPM_WORKSPACE_CONTENT`, so a check and a runner agree. It declares those exports as `RunnerModule`, and `templates/worktree-setup.d.mts` types them. It gets the runner's text from the Bun macro `runnerText()` in `src/worktree/runnerText.ts`, imported `with { type: "macro" }`: Bun reads the file when it transpiles or bundles `runner.ts` and inlines the text. So in every run mode of section 5 the module and the text come from the build, the npm bundle and the binary carry the runner, and no mode reads a `templates/` folder at run time. The runner starts the install only when its own file name ends in `.mjs` and its path is `process.argv[1]`. In `dist/cli.js` or a binary, the inlined runner's file is the CLI itself, so the CLI never starts a setup. `node --check templates/worktree-setup.mjs` must pass, because `tsrs` does not check it.

Package manager detection (`detectManager`):

- It reads `package.json` (a byte order mark is allowed). Invalid JSON or a value that is not an object blocks with `fix package.json`.
- Declarations: `packageManager` (`<name>@<version>`, with an optional `+<integrity>` suffix) and `devEngines.packageManager` (an object, or a list with one entry, with `name` and an optional `version`). Two declarations must name the same manager, and two exact versions must be equal.
- A declared `npm`, `yarn`, or other manager is unsupported; omt never replaces it. A declared version must be exact (`<major>.<minor>.<patch>`). A range or a tag blocks generation with a manual-setup hint. omt has no semver implementation.
- Security minimums block both declared and installed versions: Bun 1.4.4, pnpm 10.34.5 on major 10, and pnpm 11.11.0 on major 11. pnpm 12 and later remain supported. These minimums also cover global virtual store support. Bun 1.4.4 blocks the compromised emSign intermediate keys.
- The lockfile of the selected manager must exist: `pnpm-lock.yaml` for pnpm, `bun.lock` or `bun.lockb` for Bun. The two Bun formats are one manager.
- Without a declaration, the lockfiles decide. One supported manager selects it. Both pnpm and Bun lockfiles block as ambiguous. Only `package-lock.json`, `npm-shrinkwrap.json`, or `yarn.lock` is unsupported. A `package.json` without a lockfile blocks. No `package.json` and no lockfile gives `status: "none"`: there is nothing to install.

Linker check (`checkLinker`). A global virtual store needs the isolated linker. The check reads explicit settings in their ordinary scalar forms, plain or quoted, with comments:

- pnpm: the `npm_config_node_linker` and `pnpm_config_node_linker` environment variables (any case), `node-linker` in `<root>/.npmrc` outside any section, and a top-level `nodeLinker:` in `<root>/pnpm-workspace.yaml`.
- Bun: `linker` in the `[install]` table of `<root>/bunfig.toml`, or a top-level `install.linker`. Unrelated TOML values, including registry URLs, do not select the linker. A top-level inline `install` table is unverified. Without a project setting, the global bunfig, `$XDG_CONFIG_HOME/.bunfig.toml` then `<home>/.bunfig.toml`.
- Comments: in `.npmrc` and `pnpm-workspace.yaml` a `#` (and in `.npmrc` a `;`) starts a comment only at the line start or after whitespace. In `bunfig.toml` a `#` outside a string always starts a comment, so `[install]# note` and `linker = "hoisted"#note` are read. A table header that names `install` in another form, such as `[[install]]`, is `unverified`.
- `isolated` passes. No setting passes, and the setup selects `isolated`. Another value is `incompatible`. A setting that the check cannot read, such as a flow mapping, an inline table, an environment reference, or a multi-line value, is `unverified`. A config file that exists but cannot be read (for example `EACCES`), `.npmrc` and `pnpm-workspace.yaml` for pnpm or the local or global bunfig for Bun, is also `unverified`, with the action to make the file readable. `checkLinker` returns this result and never throws, so the check still prints its report and the runner exits 1 before the install. Both block generation and execution. omt never changes a config file. It does not claim to read arbitrary TOML or YAML.

Persistent store (`persistentGlobalStore`, pnpm only). pnpm checks `node_modules` before `pnpm run` and `pnpm exec` and re-installs it when its settings differ from the install. pnpm 12.13.0 was observed to turn a global-store install from command-line flags back into a local store this way. A top-level setting in `pnpm-workspace.yaml` keeps the global store. pnpm 10.12.1 and later read `enableGlobalVirtualStore: true`. pnpm 11.23.0 and later also read `virtualStoreType: global`, and when both keys are set, `virtualStoreType` wins (pnpm 12.13.0 was observed to resolve `virtualStoreType: project` with `enableGlobalVirtualStore: true` to a project store). pnpm below 11.23.0 ignores `virtualStoreType`. So `persistentGlobalStore(root, version)` judges the file for an exact pnpm version: the check passes the exact declared version, and the runner passes the installed version after its probe. The result (`WorktreeStore`) has a `status`:

| Status | Meaning |
| --- | --- |
| `set` | the file selects the global store |
| `no-file` | there is no `pnpm-workspace.yaml`; `omt worktree setup` creates it with the one line `enableGlobalVirtualStore: true` (`PNPM_WORKSPACE_CONTENT`), which every supported pnpm version reads |
| `missing` | the file has no setting that this pnpm version reads, for example only `virtualStoreType` for pnpm below 11.23.0 |
| `off` | the key that this pnpm version uses selects another store: `virtualStoreType` other than `global` from 11.23.0, else `enableGlobalVirtualStore` other than `true` |
| `version-dependent` | there is no exact declared version, and exactly one of pnpm below 11.23.0 and pnpm 11.23.0 or later selects the global store, for example only `virtualStoreType: global`, or two keys that disagree. When neither selects it, for example only `virtualStoreType: project`, the status is `off` (or `missing` when neither result is `off`), and the action is a configuration change, not a version pin |
| `unverified` | the file cannot be read, is a dangling symlink, or sets the value in a form that the check cannot read |

`missing`, `off`, and `unverified` keep the file and give the manual action: add the top-level line `enableGlobalVirtualStore: true`, or `virtualStoreType: global` with pnpm 11.23.0 or later (for a version below 11.23.0, only `enableGlobalVirtualStore: true`). `version-dependent` gives the action to pin an exact pnpm version, or to set `enableGlobalVirtualStore: true` with no `virtualStoreType` or `virtualStoreType: global`. Any status but `set` is `WARN store` in the check (`INFO` for a custom setup, which omt does not judge), so the check never reports a version-dependent key as verified. The runner stops before the install on any status but `set`, and decides a `version-dependent` file from the installed version.

`t3.json` validation follows the T3 project file schema (`packages/contracts/src/t3ProjectFile.ts`): `$schema` a string; `iconPath` a non-empty string of at most 512 characters; `defaultThreadEnvMode` `local` or `worktree`; `worktreeSubmodules` `recursive`, `top-level`, or `none`; `scripts` a list of at most 50 objects, each with a non-empty `name` and `command`, an optional `icon` from `play`, `test`, `lint`, `configure`, `build`, `debug`, booleans `runOnWorktreeCreate`, `runOnSettle`, `async`, `autoOpenPreview`, and a non-empty `previewUrl`. Unknown keys are allowed. The file is parsed with the JSONC parser (section 7). The setup script is the first script with `runOnWorktreeCreate: true`. `async: false` makes T3 wait for it before the agent starts. A missing or `true` `async` gives a warning.

Setup states (`WorktreeSetup.status`):

| Status | Meaning |
| --- | --- |
| `not-needed` | no `t3.json`, and `detectManager` found nothing to install |
| `missing` | no `t3.json`: the repository has no setup script. A saved or inherited T3 setup can still exist, so the message says that activation is unverified, not that worktrees get no install. `runner` is set as for `managed` |
| `invalid` | `t3.json` cannot be read or parsed, or breaks the schema; `issues` lists each problem |
| `no-setup` | `t3.json` has no `runOnWorktreeCreate` script |
| `managed` | the setup command is `node .t3/omt-worktree-setup.mjs`; `runner` is `current` (equal to the bundled runner), `different` (outdated or edited), `missing`, `linked` (the runner or `.t3` is a symlink, also one inside the checkout or a dangling one), or `occupied` (`.t3` exists and is not a folder; the check inspects `.t3` before the runner, so it reports this and does not fail) |
| `custom` | any other setup command. omt keeps it and cannot verify that it installs dependencies or uses a global store |

`omt worktree check [--json]` (the default subcommand) prints one line per check, `<STATUS>  <id>  <message>`, then `next: <action>` when there is one. The ids are `checkout` (the root, and whether it is a main checkout or a linked worktree of `<main>`), `manager`, `linker` and `store` (when they apply), `setup`, and `activation`. The statuses are those of `omt doctor`. Problems are `WARN`; nothing in this command is `FAIL`. It exits 0. `--json` prints the `WorktreeReport`. Its `complete` is true when the setup is `managed`, the runner is `current`, and for pnpm the store is `set`. Its `summary` is one `worktree` check: `INFO` when no setup is needed or a custom setup waits for completion, `PASS` when the managed setup is current, waits, and every check passes, else `WARN` with the next action. When the pnpm store is not `set` (and the setup is not custom or not needed), the summary message also holds the store message, so `init`, `install --project`, and `doctor --project` show it after the setup line. The next action names the store step: create the file with `omt worktree setup`, or the manual line to add. `--dry-run` or `--yes` with `check` is a usage error (exit 2), and so is an unknown subcommand.

The check starts no process. It reads no T3 database or settings. `activation` always says: T3 runs a setup script only from the project's saved scripts, not from `t3.json` at worktree creation; commit `t3.json` and `.t3/` (and `pnpm-workspace.yaml` for pnpm) on the branch that new worktrees start from, then import Setup in T3 Project Settings; activation is unverified here.

`omt worktree setup [--dry-run] [--yes]` plans, prints, and asks with the install confirmation flow (section 14.3, steps 3 and 4). `--json` with `setup` is a usage error. The plan:

- No `.git` at or above `cwd`: exit 1. The root is the home directory: exit 2. The check compares the real paths of the root and the home directory, so a symlinked alias of the home directory is refused too.
- `invalid`: exit 1 with the issues; `no-setup`: exit 1 with a hint that holds the script to add. omt never rewrites an existing `t3.json`, so comments and unknown keys stay.
- `custom`: the plan shows `keep <t3.json>  (custom setup script "<command>")`, prints the setup message and the activation note, and exits 0.
- A `different` runner: exit 1 with a hint to compare and update it by hand, or delete it and run again. omt never replaces it.
- A `linked` runner: exit 1. Node resolves symlinks in a script path, so a runner reached through a symlinked `.t3` or runner file computes its checkout root from the link target and installs in another folder. The hint says to replace the link with a real folder and file.
- An `occupied` runner: exit 1 with `<.t3> exists and is not a folder` and a hint to move it away. Nothing is written, also with `--dry-run`.
- Otherwise `t3.json` is `create` (with no `t3.json`) or `keep` (`managed`), and the runner is `create` (absent) or `unchanged` (current). A missing runner is created also when a hand-edited `t3.json` runs the managed command, because that write changes no existing file.
- For pnpm, `pnpm-workspace.yaml` is a third step: `create` for `no-file` (with the reason `keeps the global virtual store after pnpm run and pnpm exec`), `unchanged` for `set`, and `keep  (omt never changes an existing file)` for `missing`, `off`, or `unverified`. The last case makes the plan incomplete: the command prints `Setup is incomplete: <store message>; <action>` and the other steps still apply.
- When the plan creates a file and a blocker exists (no checkout, the home directory, a blocked manager, or an incompatible or unverified linker), exit 1 with the blockers. Preflight, before any write: for every new file, each folder between the checkout root and the file is absent or a real folder. A symlink there, also a dangling one or one that stays inside the checkout, or a non-folder, exits 1. The new file's own path must be free. A refusal leaves every file unchanged.
- With no `create`, it prints `Everything is up to date.` and the activation note, and exits 0. When the plan is incomplete, it prints the `Setup is incomplete` line instead of `Everything is up to date.`, then the activation note, and exits 1. A custom setup prints its setup message instead. `--dry-run` prints the `Setup is incomplete` line when it applies, then `Dry run: nothing was written.`, and exits 0. This includes a plan with no `create` that is incomplete: the dry run prints the plan, the `Setup is incomplete` line, the activation note, and the dry-run line, and exits 0. A complete plan with no `create` prints `Everything is up to date.` with or without `--dry-run`.
- Apply: first the whole preflight runs again, because a folder can become a symlink after the plan. Then each file is written atomically (section 1), each after another check of its folders and that its path is still free. It prints `created  <path>` per file, the `Setup is incomplete` line when it applies, and the numbered next steps: when incomplete, first make the `pnpm-workspace.yaml` change; commit `t3.json`, the runner, and for pnpm `pnpm-workspace.yaml` on the branch that new worktrees start from; import Setup in T3 Project Settings while keeping inherited scripts; and run `omt worktree check` in a new worktree. It exits 1 when the plan is incomplete, else 0.

The generated `t3.json`:

```json
{
  "$schema": "https://t3.codes/schema/t3.json",
  "scripts": [
    {
      "name": "Setup",
      "command": "node .t3/omt-worktree-setup.mjs",
      "icon": "configure",
      "runOnWorktreeCreate": true,
      "async": false
    }
  ]
}
```

The runner. T3 starts it in the new worktree. It works on the checkout two levels above its own file, not on the caller's cwd, and detects the manager again on each run, so an intentional manager switch never runs a stale choice. Node gives the runner its real path, so when the real path of the folder two levels above `process.argv[1]` differs from that checkout (a symlinked `.t3` or runner), it exits 1 before any step and installs nothing:

1. `detectManager`. `none` prints `nothing to do` and exits 0. A blocked result exits 1 with its action.
2. `checkLinker` with the process environment and home directory. `incompatible` or `unverified` exits 1. For pnpm, `persistentGlobalStore` with the exact declared version too: any status but `set` or `version-dependent` exits 1 with `nothing was installed` and the action, before the probe.
3. Layout. When `node_modules` holds entries and its layout needs a conversion, it exits 1 and asks the user to review and remove that checkout's `node_modules`. For pnpm: no `node_modules/.modules.yaml`, a `nodeLinker` other than `isolated`, or a `virtualStoreDir` inside `node_modules`. For Bun: no `node_modules/.bun`. It never purges `node_modules`, never sets `CI` to skip a prompt, and never waits for input.
4. Environment for every child: `COREPACK_ENABLE_NETWORK=0`, `npm_config_manage_package_manager_versions=false`, `npm_config_package_manager_strict_version=true`, and `pnpm_config_pm_on_fail=error`, so neither Corepack nor pnpm downloads or switches a version. A shim outside these tools can have its own policy.
5. Probe: `<manager> --version` in the checkout, stdin closed, a 60-second limit. A launch failure or a non-zero exit stops with the output. The version must be at least the minimum, and equal to an exact declared version. The runner never installs or upgrades a tool.
6. pnpm only: `pnpm config get node-linker`, with the probe's limits. A launch failure, a timeout, or a non-zero exit stops with its output, because the effective linker is then unknown. A value other than empty, `undefined`, or `isolated` stops. Then `persistentGlobalStore` with the installed version: any status but `set` exits 1 with `nothing was installed` and the action. With `CI` set and pnpm below 11.23.0, a warning says that this pnpm can turn off the global store in CI.
7. Install, with stdin closed and stdout and stderr inherited, so pnpm refuses a purge that needs a terminal:
   - Bun: `BUN_INSTALL_GLOBAL_STORE=1 bun install --linker isolated --frozen-lockfile`.
   - pnpm: `pnpm install --frozen-lockfile --config.node-linker=isolated`, plus `--config.virtual-store-type=global` from 11.23.0 or `--config.enable-global-virtual-store=true` below it, plus `--pm-on-fail=error` from 11.0.0 or `--config.manage-package-manager-versions=false --config.package-manager-strict-version=true` below it.
8. A launch error or a signal exits 1. A non-zero install exit returns that code. Success prints `dependencies installed`.

The npmrc and TOML linker parsers split assignments at the first equals sign. A line over 16,384 characters is unverified.

The runner sets no global configuration and no store or cache path, so the user's store and cache settings apply. Package managers may keep patched, trusted, or local packages out of the global store. On Windows, only absolute `PATH` entries take part in executable lookup. An unresolved manager fails before a child starts. A `.exe` on `PATH` runs directly, and a `.cmd` or `.bat` shim runs through `%ComSpec% /d /s /c` with `windowsVerbatimArguments`. `%ComSpec%` must be an absolute path. The arguments are fixed strings from the runner, never text from `package.json`, and a path or argument with a quote, `%`, `!`, `^`, or a line break is refused. `launchSpec(name, args, { platform, env, exists })` and `installCommand(manager, version)` are exported for tests.

### 5.12 Defaults review

`src/config/defaultsState.ts` compares the last accepted defaults with the installed release's `DEFAULT_CONFIG`. `omt doctor` and `omt update` show the changes and ask `Use the current defaults? [y/N] `. A refusal keeps the accepted snapshot active and does not fail the diagnostic command. `--yes` accepts without a prompt. JSON output and non-TTY commands do not accept without `--yes`. `--dry-run` shows changes and writes nothing.

`planDefaults(ctx, scope, target?)` reads the scope's install manifest and config. It returns the file snapshots, the target defaults, `changes: DefaultsChange[]`, `firstReview`, and `changed`. Changes use `diffDefaults` with user and project layers to mark overrides. With an old manifest that has no snapshot, the first review lists the current role choices. With no install manifest, it plans no write. A retired `defaults` key also requires review, even when the defaults match.

`applyDefaults` checks that the manifest and config still match the reviewed text. A difference fails with `defaults_changed` and writes nothing. It saves `{ version: 1, cliVersion, config }` as `acceptedDefaults` in the existing manifest, preserving the other properties. It removes only the retired `defaults` key from the scope's JSONC config, preserving comments and overrides. Writes use the existing symlink and project-path checks and atomic file helpers. The manifest and config are separate atomic writes.

`activeDefaults` reads the project manifest, then the user manifest. The first accepted snapshot supplies the base config. A snapshot from an older release can lack a workflow key that a later release added, outside the `git` group. `withNewWorkflowKeys` gives each missing key its current default before the completeness check and in `activeDefaults`, so the snapshot stays valid. `planDefaults` compares the snapshot as saved, so the review lists such a key as `none -> <default>`. Without a snapshot it uses `DEFAULT_CONFIG`. `parseDefaultsSnapshot` validates the saved config and rejects a saved `update` key, which only the user config can set and fails with `defaults_snapshot` when it is invalid. There is no archived set catalog, date selector, or `omt defaults` command.

Config targets. `src/config/target.ts` exports `configTarget`, `readConfigTarget`, and `writeConfigTarget` for detect and the config editor. `--project` selects the project config, `--user` selects the user config, and no flag selects the project file when present, else the user file. Both flags together are a usage error. An absent target fails with exit 1 and the hint `run omt init` or `run omt config init`. `writeConfigTarget` checks the file text after confirmation. A difference fails with `config_changed` and writes nothing. A writer outside omt can still change the file between that read and the atomic rename.

### 5.13 `omt detect`

`omt detect` finds the harnesses that can run omt's child tasks and sets the root `harnesses` key (section 6.2) to match.

`detectHarnesses({ env, homedir, capabilities? }): HarnessReport` in `src/install/harness.ts` checks the default drivers `claudeAgent` and `codex`, in that order (`DEFAULT_HARNESSES`):

- With capabilities, `source` is `capabilities`. A driver is detected when a provider of that `driverKind` has `canRunChildTask: true`, and `executable` is `null`. `t3` is `enabled` when a provider of the driver exists, else `unknown`. When every such provider has `canRunChildTask: false`, `reason` names each provider and its constraints (`no reason given` for an empty list).
- Without capabilities, `source` is `local`. `t3` follows the rule below, `executable` is the first `PATH` entry named `claude` (for `claudeAgent`) or `codex` that is a file with an execute bit, and a driver is detected when `t3` is not `disabled` and `executable` is set. On Windows, the names `<name>.exe` and `<name>.cmd` match too. `reason` is `T3 <status>, <executable or "<name> not on PATH">`.
- `recommended` lists the detected drivers in the order `claudeAgent`, `codex`.

T3 status rule. omt reads `providerInstances` from `t3SettingsPath()` and never writes the file. An entry without a string `driver` is ignored. T3 adds an implicit instance whose id equals the driver kind unless an entry with that id exists, and the implicit `claudeAgent` and `codex` instances start enabled. An instance is disabled when `enabled === false` or `config.enabled === false`, else enabled. A driver is `enabled` when its implicit instance exists or any entry with that `driver` is enabled; `disabled` when no instance of the driver is enabled; `unknown` when the file is absent, unreadable, or not a JSON object. omt does not read `projectSettingsOverrides` or the legacy `providers` key, so it can call a driver disabled that T3 enables for one project.

Output. The command prints one line per driver, `<driver padded to 11>  detected|not detected  <reason>`, for example `claudeAgent  detected  T3 enabled, /usr/local/bin/claude`. Then it prints the recommendation: `recommended: no harnesses key (every default harness is detected)`, or `recommended: harnesses ["codex"]`. Then the effect lines of `harnessEffects`: `<roles>: unavailable with the detected harnesses` for `design` or `ui` when no rung in the selected role chain uses a detected driver, and `cross-family review: the same family reviews` when one default driver is left. The detect command uses the merged role chains, including accepted defaults and overrides. A new install uses the current default roles.

Target and wanted value. `--user` and `--project` pick the target file with `configTarget` (section 5.12), also without `--write`: then the command only compares. The wanted value of the target is `recommended` when a default driver is missing. When every default driver is detected, the wanted value is no key, unless the target is the project file and the user file sets a `harnesses` value that excludes a detected driver; then it is `recommended`. The command compares the target file's own `harnesses` value with the wanted value. When they are equal, it prints `no change in <file>`. Otherwise it prints `<file>: harnesses <current|none> -> <wanted|none>`, and, when the target is the user file and the project file sets `harnesses`, `note: <project file> sets harnesses <value>, which overrides this change`. Without `--write`, it then prints `run omt detect --write to apply`.

`--write` edits only the `harnesses` key of the target with `setTopLevelValue` (section 7): it sets the wanted value, or removes the key when the wanted value is no key. An absent target fails as described in section 5.12. `--dry-run` prints `Dry run: nothing was written.` and writes nothing. Otherwise the command confirms with `confirmApply` (`--yes`, refuse without a TTY, else ask), writes the file with `writeConfigTarget` (section 5.12), and prints `update <file>`. A refused confirmation exits 1. When the target changed after the command read it, the command writes nothing and fails with the `config_changed` error of section 5.12. `--dry-run` or `--yes` without `--write` is a usage error.

With no driver detected, the command prints the driver lines, writes nothing, and exits 1 with the `no_harness` error `no harness can run child tasks; nothing was written` and a hint to sign in to Claude Code (`claude`) or Codex (`codex`) and check that T3 Code enables it.

`--json` prints the `HarnessReport` plus `effects`, `file`, `current` (the target's value or `null`), `wanted` (`null` for no key or when no driver is detected), `changed`, `applied`, and `overriddenBy` (the project file, when it overrides the change), instead of the text lines.

### 5.14 `omt update`

`omt update` updates the omt CLI with the command of the channel that installed it. Then the new CLI syncs the skills in user scope and in each recorded project (section 14.8). A skill that the user edited stays as it is, and the output names it.

```text
Usage: omt update [--check] [--dry-run] [--yes] [--skills-only] [--project] [--json]
```

| Flag | Meaning |
| --- | --- |
| `--check` | Ask the registry, and print the current version, the latest version, the channel, and its update command or hint. Write nothing. Exit 0. |
| `--dry-run` | Print the plan and write nothing. |
| `--yes` | Apply the CLI update, skills sync, and current defaults without confirmation. |
| `--skills-only` | Skip the registry and the CLI update, and sync the skills with the CLI that runs now. No network and no runner: a one-shot project of another version gets a note. |
| `--project` | Only the current project: the channel of its shim, and its skills. |
| `--json` | Print one JSON object. Needs `--check`, `--dry-run`, or `--yes`. |
| `-h`, `--help` | Print the help. |

`--check` with `--dry-run`, `--yes`, `--skills-only`, or `--project` is a usage error (exit 2). `--json` without `--check`, `--dry-run`, or `--yes` is a usage error (exit 2) too.

Apply boundary. `--check` and `--dry-run` write no file: no state file, no project list, no shim, no skill, no manifest, and no config. Every other path shows its plan first, and writes only after `confirmApply` (`src/install/confirm.ts`) or `--yes`. This applies also when the CLI is current or the channel gives a hint. A plan with no change other than manifest versions skips the question, as `omt install` does.

Channels. `src/update/channel.ts` exports:

```ts
export type ChannelKind =
  | "npm-global" | "pnpm-global" | "bun-global" | "mise-github" | "mise-npm"
  | "dev-dependency" | "one-shot" | "source" | "binary" | "unknown";
export interface Channel {
  kind: ChannelKind;
  label: string;              // for people, such as "npm global" or "mise (release binary)"
  packageName: "oh-my-t3code" | "omt3" | "oh-my-t3";
  key: string;                // the same key means the same install
  projectRoot?: string;       // dev-dependency: the folder above the first node_modules
  packageManager?: "npm" | "pnpm" | "bun" | "yarn"; // dev-dependency: from the lockfile
  runner?: Runner;            // one-shot
}
export interface ChannelInput { build: CliBuild; cliPath: string; argv1?: string; cwd: string; packageRoot: string; env: Env; tempRoot?: string }
export function detectChannel(input: ChannelInput): Channel;
export async function confirmChannel(channel: Channel, input: ChannelInput, run: RunCommand): Promise<Channel>;
export function offlineChannel(input: ChannelInput): Channel;
export function linksProjectCli(channel: Channel, cliPath: string): boolean;
export function confirmedGlobalEnv(channel: Channel, cli: string[]): Env | undefined;
export function updateAction(channel: Channel, version: string): { kind: "run"; argv: string[]; display: string } | { kind: "hint"; text: string } | { kind: "repin" };
export function newCliCommand(channel: Channel, version: string, run: RunCommand): Promise<string[]>;
export type RunCommand = (argv: string[], opts: { cwd?: string; inherit?: boolean; toStderr?: boolean; env?: Env }) => Promise<{ code: number; stdout: string }>;
```

`RunCommand` wraps `node:child_process` `spawn` without a shell. Tests pass a fake. `env` adds variables to the environment of omt for that one command. `argv1` is `process.argv[1]`, the path as invoked, such as `<project>/node_modules/.bin/omt`. It keeps the project folder that a real path into a shared store loses. `detectChannel` reads only paths and `package.json` files. `confirmChannel` runs only in `omt update`, never in `install`, `doctor`, or the daily check.

`packageName` is the `name` in `<packageRoot>/package.json` in bundle mode when that name is `omt3` or `oh-my-t3code`, else `oh-my-t3`. Below, `<package>` is `packageName`, and `<v>` is the version that the registry check returned. Every update command pins that version.

`detectChannel` tests `cliPath` and its real path with these rules, in order:

1. Source: `build` is `source`. Kind `source`, key `source:<packageRoot>`. Hint: `update the clone with git pull and bun install, then run omt update --skills-only`.
2. One-shot: a one-shot runner cache (`oneShotRunner`, section 14.2). `oneShotRunner` also matches the Bun 1.4.4 layout `<bun install cache>/.bunx-<uid>/<package>@<version>/node_modules/`, where `<package>` is `omt3`, `oh-my-t3code`, or `oh-my-t3`, so `install --project` from a current `bunx` writes a runner shim too. Kind `one-shot`, key `one-shot:<runner>:<version>`. Action: `repin`.
3. mise, release binary: binary mode and a path segment `installs/github-gabimoncha-oh-my-t3/<version>/` or the legacy `installs/github-gabimoncha-oh-my-t3code/<version>/`. Kind `mise-github`, key `mise-github`. Command: `mise use -g github:gabimoncha/oh-my-t3@<v>`.
4. mise, npm package: a path segment `installs/npm-oh-my-t3code/<version>/`, `installs/npm-omt3/<version>/`, or `installs/npm-oh-my-t3/<version>/`. Kind `mise-npm`, key `mise-npm`. Command: `mise use -g npm:<package>@<v>`. This rule comes before rule 5, because the mise npm path also holds `lib/node_modules`.
5. Global package: the path, with `/` separators, matches one of these patterns, tested in this order:
   - pnpm: `/global/5/node_modules/(?:\.pnpm/[^/]+/node_modules/)?(oh-my-t3code|omt3|oh-my-t3)/dist/cli\.js$` (pnpm 9 and 10), `/global/v\d+/[^/]+/node_modules/(oh-my-t3code|omt3|oh-my-t3)/dist/cli\.js$` (pnpm 11 and later), or a real path under a pnpm store, `/links/(?:[^/]+/)*node_modules/(oh-my-t3code|omt3|oh-my-t3)/dist/cli\.js$` (the pnpm 11 global virtual store, which projects share).
   - Bun: `/\.bun/install/global/node_modules/(oh-my-t3code|omt3|oh-my-t3)/dist/cli\.js$`, or the folder in `BUN_INSTALL_GLOBAL_DIR` or `<BUN_INSTALL>/install/global`.
   - npm: `/lib/node_modules/(oh-my-t3code|omt3|oh-my-t3)/dist/cli\.js$`.

   The kind is `pnpm-global`, `bun-global`, or `npm-global`, and the key is `<kind>:<global root>`. Commands: `pnpm add -g <package>@<v>`, `bun add -g <package>@<v>`, and `npm install -g <package>@<v>`. A match gives only a candidate, which `confirmChannel` confirms.
6. Dev dependency: not binary mode, and `cliPath` or its real path has a `node_modules` segment. A pnpm store path reaches this rule only after a failed `confirmChannel`, or through `offlineChannel` or `pathShimChannel` (below). The project root is the folder above the first `node_modules` in `cliPath`, else in `argv1`, else `findProjectRoot(cwd)`. The first of these roots whose `package.json` lists `oh-my-t3code`, `omt3`, or `oh-my-t3` in `devDependencies` or `dependencies` gives kind `dev-dependency` and key `dev:<project root>`. When no root qualifies, the kind is `unknown` (rule 8). The lockfile in the project root names the package manager: `pnpm-lock.yaml` gives pnpm, `bun.lock` or `bun.lockb` gives bun, `yarn.lock` gives yarn, else npm. Hint: `run <npm i -D | pnpm add -D | bun add -D | yarn add -D> <package>@<v> in <root>, then run <npx omt | pnpm exec omt | bunx omt | yarn omt> update --skills-only --project there`, with the package manager of the lockfile in both commands. The second command starts the new CLI through the package manager, because the shim can still record the old CLI file, such as an old folder of the shared pnpm store. omt runs nothing in that project.
7. Release binary elsewhere: binary mode, which skips rule 6. Kind `binary`, key `binary:<real path>`. Hint: `download the release binary from https://github.com/gabimoncha/oh-my-t3/releases, or install with mise use -g github:gabimoncha/oh-my-t3@<v>`.
8. Unknown: any other path. Kind `unknown`, key `unknown:<real path>`. Hint: `omt cannot tell how it was installed (<cliPath>); update it with the command of your channel:`, followed by the channel table of `docs/install.md`.

`updateAction` returns `run` for rules 3 to 5, `repin` for rule 2, and `hint` for the other rules. On Windows (`process.platform === "win32"`), every channel gives the hint action. The `run:` line of a `mise use -g` command adds `(writes <tool>@<v> into your global mise config)`, because the command writes that exact pin there.

Confirmation. `confirmChannel` works on the global kinds only, and returns any other channel unchanged. Before any update, it runs the package manager and computes the package folder:

- npm: `<npm root -g>/<package>`.
- pnpm 9 and 10: `<pnpm root -g>/<package>`. pnpm 11: the one `<pnpm root -g>/*/node_modules/<package>` folder.
- Bun: the first line of `bun pm ls -g` is `<global dir> node_modules (<n> installed)`. omt strips the ` node_modules (...)` suffix and uses `<global dir>/node_modules/<package>`.

It confirms the candidate when the real path of `cliPath` equals the real path of `<package folder>/dist/cli.js`. When the command fails or the paths differ, detection continues at rule 6 with `argv1` and `cwd`. When rule 6 finds no project either, the channel is `unknown`.

Offline channel. `--skills-only` starts no package manager, so it takes the channel of the running CLI from `offlineChannel`, not from `confirmChannel`. `offlineChannel` applies the `detectChannel` rules. A candidate under the shared pnpm store, the `/links/` pattern of rule 5, can be the global install or a project dependency, so `offlineChannel` settles it from local files:

- When `argv1` matches another pattern of rule 5, the candidate stays. The pnpm global bin starts the CLI by its path in the pnpm global folder, and so does `newCliCommand`.
- When the environment variable `OMT_UPDATE_GLOBAL_CLI` names a file whose real path is the real path of `cliPath`, the candidate stays. `omt update` sets this variable only for the new CLI that it starts after a global update (step 5 below), to the CLI file that the package manager reported. A custom pnpm `global-dir` matches no pattern of rule 5, so `argv1` cannot show that folder. A store path that the variable does not name stays unconfirmed.
- Else, when a root of rule 6 lists `oh-my-t3code`, `omt3`, or `oh-my-t3`, and its `node_modules/oh-my-t3code/dist/cli.js`, `node_modules/omt3/dist/cli.js`, or `node_modules/oh-my-t3/dist/cli.js` resolves to the real path of `cliPath`, the kind is `dev-dependency`, with key `dev:<root>`. A project that only lists omt is not enough, because a store path of another version can run in that project.
- Else the kind is `unknown`, so the sync leaves the user scope alone.

With these rules, a project dependency in the shared store never syncs the user scope. The second command of the rule 6 hint starts the project's own CLI, which gets the key `dev:<root>`. `pathShimChannel` gives the project's shim the same key, so the command syncs the project and rewrites a shim that still records an older CLI file.

New CLI. `newCliCommand` returns the argv prefix that runs the CLI after the update:

| Channel | New CLI |
| --- | --- |
| `npm-global`, `pnpm-global`, `bun-global` | `<runtimePath> <package folder>/dist/cli.js`. `runtimePath` is the runtime that runs omt now, so a machine with only Bun runs the bundle with Bun, not through the `#!/usr/bin/env node` bin. The package folder comes from the `confirmChannel` rule, run again after the update. |
| `mise-github` | `mise exec github:gabimoncha/oh-my-t3@<v> -- omt` |
| `mise-npm` | `mise exec npm:<package>@<v> -- omt` |
| `one-shot` | `<project root>/.omt/bin/omt` |
| the hint kinds | the running CLI |

Version check. `src/update/check.ts` exports:

```ts
export type LatestResult = { ok: true; version: string } | { ok: false; error: string };
export async function fetchLatest(opts: { env: Env; fetch?: typeof fetch; timeoutMs: number }): Promise<LatestResult>;
export function compareVersions(a: string, b: string): number; // x.y.z only
export interface UpdateState { checkedAt: string; latest?: string; error?: string; applyAttemptedFor?: string }
export interface DailyResult { current: string; latest?: string; outdated: boolean; checkedAt: string; cached: boolean; error?: string; mode: "check" | "apply"; applyAttempted: boolean }
export async function dailyCheck(ctx: CliContext, opts: { mode: UpdateMode | undefined; fetch?: typeof fetch }): Promise<DailyResult | undefined>;
export async function recordApplyAttempt(ctx: CliContext, latest: string): Promise<void>;
```

- `fetchLatest` sends `GET <registry>/-/package/oh-my-t3/dist-tags` with the header `accept: application/json`. `<registry>` is `npm_config_registry`, else `NPM_CONFIG_REGISTRY`, else `https://registry.npmjs.org`, without a trailing slash. omt reads no `.npmrc`. The request sends no cookie, token, or id. The response field `latest` must match `^\d+\.\d+\.\d+$`. Any other response is an error. `fetch` is the Node 22 global, and tests pass their own.
- The timeout is 3000 ms in `dailyCheck` and 10000 ms in `omt update`, through `AbortSignal.timeout`.
- `dailyCheck` returns `undefined`, and reads no file and sends no request, when `opts.mode` is absent or `off`. Each caller passes the `config.update` of the loaded config. Otherwise it reads `updateStatePath()` (section 4). When `checkedAt` is less than 24 hours before `ctx.now()` and not in the future, it returns the cached result. Else it fetches, writes the state atomically, and returns the result. It writes the state also after a failure, so an offline machine tries once a day. A state file that cannot be read or parsed, or that has no valid `checkedAt`, counts as absent. A failed state write does not throw, and the next run fetches again.
- `omt update` without `--skills-only` always fetches, because the user asked for it, unless the caller passes a `latest`, as auto-apply does. It writes the state file only on its apply path.
- `dailyCheck` reads only the user config's `update` key, because the project config's key is dropped (section 6.2). So a cloned repository cannot turn on network calls.

Skill sync. The sync runs the install planner (section 14.2) with `InstallOptions.sync: true`. With `sync`:

- Every `conflict` step becomes `keep`, with the reason `locally modified; omt install --force replaces it` or `not managed by omt`. For a retired skill (section 14.2), the reason is `locally modified; no longer shipped; omt install --force backs it up and removes it`.
- A retired skill that is not locally modified is removed with its links, as in `omt install`. Its name is in the `changed` list of the scope result.
- When the config is absent, the config step is `keep`, with the reason `absent; omt update creates no config`.
- An absent link to a skill that is kept because omt does not manage it is `keep`, with the reason `points at a skill that omt does not manage`.
- `planHarnesses` does not run.
- `force` is ignored.

Ownership. A `keep` step changes no ownership. The project `existing` lists are the previous lists plus what `existingPaths` computes. The manifest `skills` and `links` lists name only the steps that the previous manifest owned, or that this run created, updated, or replaced and that are not existing. A kept conflict that the previous manifest did not own stays unowned. In project scope the sync also adds it to `project.existing` (the skill name or the link path), because `buildUninstallPlan` scans the link roots by itself and keeps a link only when `existing` names it. `omt uninstall --project` then keeps it with `keep (existed before the install)`. User scope has no `existing` list, and its uninstall scan is the same with or without a sync.

Markers. The sync rewrites no marker of an `unchanged` skill. A marker records the version that wrote the files, and every check compares hashes. A scope with no change writes only its manifest (version and timestamp), as `omt install` does, and asks no question.

Options. The manifest of each scope gives the install options: `targets` is `agents`, plus `claude` or `gemini` when the manifest records a link in that root. `hooks` is true when the manifest records a hook. `gitExclude` is false when `project.gitExcludeOff` is true.

Targets. `planSync(ctx, channel, { projectOnly, runners: "delegate" | "skip", targetVersion, run? })` in `src/update/sync.ts` returns one entry per target, and `applySync(ctx, entries)` applies the entries that have changes. `targetVersion` is the version that rule 6 pins. `run` is the `RunCommand` of rule 6; when it is absent, the sync spawns the command itself. Each entry holds `header` and `result` (a `ScopeResult`, below), plus one of these: `plan` (an install plan that this process applies), `runner` (the shim of rule 6), or `gone` (rule 1). `current` marks the current project. The user scope is a target when the running channel is `npm-global`, `pnpm-global`, `bun-global`, `mise-github`, `mise-npm`, `source`, or `binary`, and the user manifest exists. Then each recorded project and the current project are targets. On the apply path, the sync adds the current project to the project list when `<root>/.omt/install.json` exists (section 14.8). `projectOnly` limits the run to the current project.

The sync checks each project with these rules, in order:

1. The folder or the project manifest is gone: `skip`, with the note `gone; removed from the project list`. The root leaves the list only on the apply path.
2. No managed shim: `skip`, with the note `no managed shim; run omt install --project there`.
3. A runner shim whose runner and pinned version equal the one-shot runner and version of the running CLI, so the CLI runs through this shim: sync in this process, as in rule 4. The planner keeps the runner shim, because `shimTarget(ctx, runner)` gives the same content.
4. A path shim whose recorded CLI is the file of the running CLI (by real path), or has the same channel `key` as the running CLI: sync in this process with `buildInstallPlan({ ...ctx, cwd: root }, { scope: "project", sync: true, ... })`. The shim step rewrites the shim to the running CLI, which moves a mise project to the new binary.
5. Any other runner shim, with `runners: "skip"`: `skip`, with the note `runs <runner command>; run <root>/.omt/bin/omt update --project there`. No pin changes and no child process starts, so `--skills-only` stays offline.
6. Any other runner shim, with `runners: "delegate"`: when the target version is not newer than the pin, the result is `skip` with the note of rule 5, and nothing runs. When it is newer, first run `<runner command at the target version> --version`, such as `npx --yes omt3@<v> --version`, with cwd `<root>`. When it fails or prints another version, the result is `fail`, with the note `<runner command> did not start; the shim keeps <old pin>`, and nothing changes. Only then write the new pin, run `<root>/.omt/bin/omt update --skills-only --project --yes --json` with cwd `<root>`, and report its exit code. The child runs as the runner at the new pin, so rule 3 applies to it, and it starts no further child. The result has the changed and kept skills of the child's project scope. When the child's stdout is not JSON or holds no project scope for `<root>`, the scope fails with the note `<child command> exited <code>; invalid JSON output` or `<child command> exited <code>; no valid project scope in JSON output`. A non-zero exit fails the scope with the note `<child command> exited <code>`.
7. A path shim of another channel: `skip`, with the note `runs another omt (<cli>); run <root>/.omt/bin/omt update --project there`.

`pathShimChannel` gives the channel of a path shim, for the sync and for `--project`. It applies the `detectChannel` rules to the recorded CLI path, with `cwd` set to the project root. It never runs `confirmChannel`, so it starts no package manager, also with `--skills-only`. A real path under the shared pnpm store, the `/links/` pattern of `detectChannel` rule 5, can belong to the global install or to a project dependency. So when the project's `package.json` lists `oh-my-t3code`, `omt3`, or `oh-my-t3` in `dependencies` or `devDependencies`, that path gets `detectChannel` rule 6: kind `dev-dependency` and key `dev:<root>`. This key never equals the key of a global install, so rule 7 skips the project when a global omt runs the sync. Rule 4 still syncs a project whose shim records the running CLI file itself.

The plan of a rule 6 project shows two lines, `pin      <shim> -> <runner command>` and `run      <shim> update --skills-only --project --yes --json`. A skipped or failed scope shows one line, `skip     (<note>)` or `fail     (<note>)`.

Right before it applies the user scope or an in-process project, `applySync` plans that scope again, because the owner can edit a skill while the confirmation question waits. When the skill, link, or shim actions differ from the confirmed plan, the scope fails with the note `changed since the plan; run omt update again`, and nothing in it is written. Else it applies the fresh plan, so the git exclude, `.omt/.gitignore`, and settings hook steps come from the fresh plan. An error while omt finds the current project root fails only that project's scope. An error in any other scope fails only that scope, and a project list that cannot be read gives a `warning:` line and an empty list.

`applyInstall` also checks each skill folder before it replaces it, in `omt install` too. An `update` step records `installedHash`, the hash of the installed skill that the plan read. A `create` step expects no folder, and so does a `replace` step after it moves the old folder to the backups. The apply moves the folder out of place first, then hashes it. When the folder is not what the step expects, the apply moves it back and fails with `<path> changed after the plan was made; it was kept, and nothing more was written`. So omt never deletes an edit that the owner saves after the last plan.

`--skills-only` always uses `runners: "skip"`. The full flow uses `runners: "delegate"` only in the process that ran the registry check.

Each scope gives one result: `{ scope: "user" | "project"; root?: string; status: "synced" | "unchanged" | "skipped" | "failed"; changed: string[]; kept: { name: string; reason: string }[]; note?: string }`. A failed scope does not stop the others, and the run exits 1 at the end. The text output prints one header per scope, `user: ~/.agents/skills` or `project: <root>`, then the install plan lines, then `kept <name>  (<reason>)` for each kept skill.

Project channel. With `--project`, the shim of the current project gives the channel. A runner shim gives `one-shot` with its runner and pin. A path shim gives `pathShimChannel` of its recorded CLI path. No managed shim exits 1 with `no managed shim in <root>` and the hint `run omt install --project`. When the path shim's channel key differs from the key of the running CLI, the command prints `this project runs <cli>; run <root>/.omt/bin/omt update --project` and exits 0 with no change. When the shim is a runner shim and the running CLI is not that runner at that pin, the project channel is that runner, and the flow uses the `repin` action with the shim as the new CLI.

A path shim whose channel is `dev-dependency` gives the project channel before any global confirmation, so `--project` runs no `confirmChannel` for that project. A global install can share its CLI file with the project's dependency, as in the shared pnpm store, and the project still gets the rule 6 hint (decision Q4). The running CLI is the project's own omt when the shim records the running CLI file, or when `linksProjectCli` is true: the project's `node_modules/oh-my-t3code/dist/cli.js`, `node_modules/omt3/dist/cli.js`, or `node_modules/oh-my-t3/dist/cli.js` resolves to the real path of `cliPath`. The second case covers a shim that still records an older file after `pnpm add -D`. Then the dev dependency is the channel for the action and for the sync, and the sync applies rule 4 to the project. Else the command prints the `this project runs` line above.

Without `--check` and `--skills-only`, `omt update` runs these steps:

1. Detect the channel (with `--project`, as above), then run `confirmChannel`. Fetch the latest version, with the 10-second timeout, unless the caller passed one. A failure exits 1 with `cannot reach the npm registry: <reason>` and the hint `run omt update --skills-only to sync the skills without the network`.
2. Print `omt <current> (<label>); latest <latest>`.
3. When the latest version is newer and the action is `run` or `repin`: print `run: <display>` (or `pin: <root>/.omt/bin/omt -> <runner command>`) and one `sync:` line per target. With `--dry-run`, show pending defaults changes for the installed CLI, print `Dry run: nothing was written.`, and exit 0. The new release's defaults are available after its CLI update. Confirm unless `--yes`. Write the state file.
4. Run the command with inherited stdio. For `repin`, run `<runner command at latest> --version`, and write the new pin only when it prints `<latest>`; else exit 1 and keep the old pin. With `--json`, the command's stdout goes to stderr. A non-zero exit stops the run with exit 1, the command, and its exit code. For `mise-github`, the hint adds `the GitHub release can lag npm by a few minutes; try again later`. For npm, pnpm, and Bun, it adds `npm publishes oh-my-t3code, omt3, and oh-my-t3 one after the other; try again in a minute`.
5. Run the new CLI (`newCliCommand`). First, `<new cli> --version` must print `<latest>`. Otherwise exit 1 with `the update finished, but the new omt prints <x>`. Then run `<new cli> update --skills-only --yes [--project]`. For a global channel, that command gets `OMT_UPDATE_GLOBAL_CLI` (from `confirmedGlobalEnv`), set to the CLI file of `<new cli>`, so its `offlineChannel` keeps the confirmed global channel and syncs the user scope. With `--json`, add `--json`, capture its stdout, and merge its `scopes` into the JSON of this process. The child skips runner projects (rule 5 of the sync).
6. Runner projects: this process, which ran the registry check, runs rule 6 of the sync for each runner project that the child skipped, with the target version `<latest>`.
7. Review defaults for the user installation and each successfully synced project. Read the new CLI's current configuration with `<new cli> config show --defaults`. Compare it with each scope's accepted snapshot, show the diff, and ask as in section 5.12. `--yes` accepts the defaults too. A refusal preserves that scope's snapshot. A failed read warns the user to run `omt doctor` and makes the update exit 1.
8. When any skill changed, print `Restart agent sessions in T3 Code so they load the new skills.`

After the apply, and before step 7, the text output prints one summary line per scope, `user  <status>` or `project: <root>  <status>`, with `  (<note>)` when the scope has a note. Then it prints `  changed  <name>` for each changed skill and `kept <name>  (<reason>)` for each kept skill.

The `repin` action needs a managed runner shim to rewrite. When the project has none, the action becomes the hint `run <runner command at latest> install --project in <root>`, such as `run npx --yes omt3@<latest> install --project in <root>`.

When the latest version equals the current one, or the action is a hint, the command prints `omt <current> is the latest` or the hint. Then it shows the sync plan of the running CLI (`runners: "delegate"`, with the current version as the target version), confirms, applies, and runs steps 7 and 8 with the running CLI as `<new cli>`.

`--skills-only` shows the sync plan of the running CLI (`runners: "skip"`), confirms, and applies. It sends no request and starts no child process. Then it reviews the current defaults through the same flow. Internal skill-sync children get `OMT_UPDATE_DEFER_DEFAULTS=1`, so the parent alone shows the diff and asks for defaults approval. Runner sync children receive the same flag.

Exit codes: 0 for success. 1 for a registry failure (not with `--skills-only`), a failed command, a version mismatch, a refused confirmation, or any failed scope. 2 for a usage error.

JSON. With `--yes` or `--dry-run`, `--json` prints `{ "current", "latest", "channel": { "kind", "label", "package" }, "action": "run" | "repin" | "hint" | "none", "command": string | null, "hint": string | null, "updated": boolean, "scopes": ScopeResult[], "defaults": [{ "scope", "root"?, "changed", "applied", "changes": DefaultsChange[] }], "restart": boolean }`. `ScopeResult` is the result per scope of the sync. `--check --json` prints `{ "current", "latest", "outdated", "channel", "action", "command", "hint" }`. With `--json`, all text output goes to stderr, and stdout holds only the JSON. The summary per scope and the restart line are then only in the JSON, as `scopes` and `restart`. A failure (the registry, the update command, or a version mismatch) prints no JSON, only the error and its hint on stderr.

Daily check in install and doctor. The check is on when the user config sets `update` to `check` or `apply` (section 6.2).

- `omt doctor` and `omt doctor --project` add the check `update` after `defaults` (section 14.7). With the check off, there is no `update` line. A failure is never `FAIL`.
- `omt install` prints `note: omt <latest> is out; run omt update` after the summary or `Everything is up to date.`, when the daily result is outdated. It prints no note after a refusal, a conflict, or `--dry-run`.
- With `apply`, after the command's own output, when the daily result is outdated, `ctx.isTTY` is true, and `applyAttempted` is false, the command first calls `recordApplyAttempt(latest)`. Then it runs the update flow with `yes: true` and the `latest` of the daily result, so the flow sends no second request. From `omt doctor --project` and `omt install --project`, the flow runs with `project: true`, so the channel of the project's shim decides. From the other forms, it runs with `project: false`. It also accepts the current defaults. Without a TTY, or after an earlier attempt for the same version, the command prints only the note. A failed automatic update prints `warning: the automatic update failed: <reason>` and keeps the command's own exit code. The recorded attempt stops a retry until a newer version appears.
- `omt doctor --json` keeps stdout as the one JSON report of section 14.7. All output of the automatic update, child output included, goes to stderr.

No other command calls `dailyCheck`. The hook and the agent commands (`brief`, `route`, `ledger`, `plan`, `roles`, `profile`, `lock`, and `paths`) never contact the network.

### 5.15 `omt git`

`omt git check <commit|push|pr|merge> [--user <login>] [--host <host>] [--pr-author <login>] [--plan <slug>] [--profile <name>] [--json]` prints the decision of the `workflow.git` policy (section 6.7) for one git action. The skills run it before each commit, push, PR, and merge. It writes nothing and makes no network call: the skills pass the user's GitHub login as `--user`, the login's host as `--host` (default `github.com`), and, as `--pr-author`, the author of an open PR from the branch that is not the user, else the user (section 15.1). Logins, owners, and hosts compare without case.

- It resolves the profile as `omt profile show` does (section 5.9): `--profile`, then the plan header of `--plan`, then the project and user config, then `normal`.
- `src/git/branch.ts` reads full refs, not short names, so that a tag with the name of a branch does not change the result. It reads the current branch with `git symbolic-ref --quiet HEAD` without the `refs/heads/` prefix, and finds the default branch in this order: `git symbolic-ref --quiet refs/remotes/origin/HEAD` without the `refs/remotes/origin/` prefix; `git config init.defaultBranch` when `git rev-parse --verify --quiet refs/heads/<name>` finds that branch; `main` or `master`, whichever has a `refs/heads/` branch. It runs git with `spawnSync` in the current folder.
- `src/git/branch.ts` reads the `origin` fetch URL with `git remote get-url origin` and each push URL with `git remote get-url --push --all origin`, which applies `insteadOf` and `pushInsteadOf` rewrites. `parseRemote` reads the host, the owner, and the repo from `git@<host>:<owner>/<repo>`, `ssh://git@<host>/<owner>/<repo>`, and `https://<host>/<owner>/<repo>`, each with an optional `.git`. The owner matches `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`. Another form gives an unknown owner.
- The decision, checked in this order:
  1. An unknown or missing action exits 2. When the config or the resolved profile has an issue with severity `error`, the decision is `ask` for each action, the reason is `config error in <source> [<path>]: <message>; fix the config first`, and `key` and `value` stay as computed. When the config load or the profile resolution fails with an `OmtError` (for example an unknown profile, a profile cycle, or a missing plan), the decision is `ask` with exit 0, the reason is `config error: <message>; fix the config first`, `key` and `value` are `null`, and the message also goes to stderr. A `--plan` value that is not a valid slug still exits 2.
  2. Ownership. With no `origin` remote, `commit` and `merge` go on to the next step, and `push` and `pr` give `ask` ("no origin remote"). An `origin` fetch URL or push URL that `parseRemote` cannot read gives `ask`; the reason names no URL. With no `--user`, the decision is `ask` ("pass --user <login> to check ownership"). When the fetch URL's host is not `--host`, the decision is `ask` ("the login is for <host>, the repo is on <origin host>"). When the fetch URL's owner is not `--user` and is not in `workflow.git.owners`, the decision is `ask` ("<owner>/<repo> is not your repo; add the owner to workflow.git.owners to allow it"). A push URL on another host or with such an owner gives `ask`, and the reason names its owner and host, not the URL. A push URL whose host, owner, or repo differs from the fetch URL's gives `ask` ("a push URL of origin goes to another repo, <owner>/<repo> on <host>"); the repos compare without case and without `.git`. When `--pr-author` is given and is not `--user`, each action gives `ask` ("the PR is by <author>").
  3. The key: `merge` reads `merge`. `commit` reads `defaultBranch` on the default branch and `branchCommits` on another branch. `push` reads `defaultBranch` on the default branch and `pullRequests` on another branch. `pr` reads `pullRequests`. When the resolved workflow does not set the key, the decision is `ask` with `value: null`, and the reason names the profile.
  4. `merge` gives the `merge` value on any branch, also outside a git repository.
  5. For `commit`, `push`, and `pr`: outside a git repository, on a detached HEAD, or with no default branch found, the decision is `ask`. `pr` on the default branch gives `ask`.
  6. Otherwise the key's value: `auto` or `ask`. `pullRequests: "off"` gives `off` for `push` and `pr`.
- Text output is one line, `<decision>: <reason>`. `--json` prints `{ action, decision, branch, defaultBranch, host, owner, repo, user, prAuthor, key, value, reason, maxPrFiles }`. `maxPrFiles` is the profile's `workflow.git.maxPrFiles`, or `null` when it is unset or the config fails to load. `host` is the `origin` fetch URL's host. `branch`, `defaultBranch`, `host`, `owner`, `repo`, `user`, `prAuthor`, `key`, and `value` are `null` when unknown. Each decision exits 0.

## 6. Config

### 6.1 Files and layering

The merged config is built from three layers, in this order:

1. The accepted defaults, or `DEFAULT_CONFIG` when no snapshot exists (section 6.4).
2. The user config: `userConfigPath()`.
3. The project config: `projectConfigPath(findProjectRoot(cwd))`.

`loadConfig` reads the active defaults snapshot before merging config layers (section 5.12). It clones that config as the base. `LoadedConfig.defaults` holds the base, and `defaultsSource` is the manifest path or `"current"`. `readConfigLayers({ cwd, env, homedir })` reads, parses, and validates the user and project files in that order. It returns `{ kind, path, present, layer, issues }` for each.

A missing file is not an error. Each file is JSONC (section 7). Profile selection applies after these layers (section 6.7).

### 6.2 Layer validation

`validateLayer(value, source)` returns `{ layer: ConfigLayer, issues: ConfigIssue[] }`. It prunes invalid parts and keeps valid ones.

- The root must be an object. Allowed keys: `$schema` (string, ignored), `version` (must equal 1), `profile` (name), `profiles` (object), `models` (object), `roles` (object), `limits` (object), `harnesses` (array), and `update` (string). An unknown key is an error, and the key is dropped. The retired keys `defaults` and `visuals` each produce a warning `<key> is no longer used; remove it` and are dropped.
- `update` is `"off"`, `"check"`, or `"apply"` (section 5.14). It is valid only in the user config. In the project config it is the warning `update is read only from the user config; remove it from <file>`, and the key is dropped. Any other value is the error `must be "off", "check", or "apply", got <value>`, and the key is dropped.
- `harnesses` is an array of 1 to 10 unique driver kinds that match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. Any other value is the error `must be an array of 1 to 10 unique driver kinds that match <pattern>, got <value>`, and the key is dropped.
- `defaults` is retired. Any value produces the warning `defaults is no longer used; remove it`, and the key is dropped. Defaults acceptance removes the key from the reviewed scope's config.
- A role name matches `^[a-z][a-z0-9-]{0,31}$`. A role value is `null` (remove the role) or an object.
- Allowed role keys and values:
  - `description`: a non-empty string of at most 300 characters.
  - `access`: `read-only` or `edit`.
  - `result`: `work`, `review`, `test`, `research`, `plan`, `guardrail`, or `grill`.
  - `t3Role`: `implementation`, `research`, `review`, `design`, `test`, or `general`.
  - `interactionMode`: `inherit`, `default`, or `plan`.
  - `runtimeMode`: `inherit`, `approval-required`, `auto-accept-edits`, `auto`, or `full-access`.
  - `crossFamily` and `fast`: booleans. Any other value is an error with the message `must be a boolean, got <value>`.
  - `chain`: an array of 1 to 10 rungs.
- A role object with any invalid key or value is dropped as a whole, with one issue per problem.
- Allowed rung keys:
  - `provider` and `driver`: strings that match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. A rung needs at least one of them.
  - `model`: a non-empty string of at most 200 characters. It is required.
  - `effort`: a value from the effort ladder.
  - `fast`: a boolean.
  - `options`: an object whose values are strings or booleans.
- Allowed limit keys and integer ranges: `maxParallel` 1 to 32, `maxDepth` 0 to 3, `maxReviewRounds` 1 to 10. An invalid limit is dropped with an error.
- Retired keys and roles. omt ignores these keys: `workflow.build.verify`, `workflow.build.checkpoint`, and `workflow.build.stallMinutes` in any profile, `limits.maxTasksPerRun` at root or in a profile, and the roles `verify`, `quick`, `deep`, and `plan` at root or in a profile. A layer that sets one still loads. Validation drops the key, whatever its value, and adds one warning for each key: `<path> is no longer used; remove it`, for example `profiles.normal.workflow.build.checkpoint is no longer used; remove it`. A retired key or role therefore has no effect on the effective config. `RETIRED_BUILD_KEYS`, `RETIRED_LIMIT_KEYS`, and `RETIRED_ROLES` in `src/config/defaults.ts` hold the lists.
- Retired profiles. `RETIRED_PROFILES` in `src/config/defaults.ts` lists `pr-review`, because `normal` now runs all PR review steps. A layer that declares `profiles.pr-review`, with any value including `null`, gets the warning `profiles.pr-review is no longer used; remove it`, and validation drops the declaration. A root `profile` or a profile `extends` that names a retired profile gets the warning `profile "pr-review" is no longer used; normal runs the PR steps`, and validation replaces the name with `normal`.
- `profile` and each profile name match the role-name pattern. A profile value is `null` or an object. Allowed fields are `description`, `extends`, `workflow`, `limits`, `roles`, and `models`. `visuals` is an unknown profile field, so it is an error.
- Profile `description` is a non-empty string of at most 300 Unicode code points. An invalid description drops the whole profile override. Other invalid profile fields are dropped individually. `extends` matches the profile-name pattern.
- Profile `roles` and `limits` use the root validation rules. Each workflow group and key follows section 6.7. An unknown group, key, or value is an error. Valid fields remain. `plan.testLayers` can be empty and can contain only `integration`, `e2e`, and `unit`.
- A model id is a non-empty string of at most 200 Unicode code points. Each `models.<id>` value is an object with only an optional boolean `fast`. Invalid model fields are dropped individually.
- Role descriptions and rung model ids use the same code-point limits as profile descriptions and model ids.
- A `roles.test` key, at root or inside a profile, warns: `role "test" was renamed to "qa"; rename it`. It remains a custom role with no special behavior. A partial legacy override can fail the new-role requirements in section 6.3.

### 6.3 Merging

`mergeLayer(base: OmtConfig, layer: ConfigLayer, source: string)` returns `{ config, issues }`.

- A role set to `null` is removed. A `null` for a role that does not exist is a warning.
- A role that exists in `base` is merged field by field. `chain` replaces the old chain as a whole. `crossFamily` and `fast` are fields like the others, so a layer can set or override either one.
- A new role must have `description`, `access`, and `chain` after the merge. Otherwise it is dropped with an error. Missing fields get these values:
  - `result`: `work` for `edit` access, `research` for `read-only` access.
  - `t3Role`: `implementation` for `edit`, `research` for `read-only`.
  - `interactionMode`: `default` for `edit`, `plan` for `read-only`.
  - `runtimeMode`: `inherit`.
  - `crossFamily` stays unset, which counts as `false`. `fast` stays unset, so model settings can apply.
- Each limit field replaces the old value.
- `harnesses` replaces the old value as a whole. Absent in every layer, `config.harnesses` stays unset, which means no filter (section 8.3).
- `update` replaces the old value. Absent in every layer, `config.update` stays unset, which means `off`. It is not a profile field, and the defaults leave it unset.
- `profile` replaces the selected name. `models` merges per model and field.
- Profiles merge per name. An existing profile keeps fields that a layer omits. `workflow` merges per group and key, `limits` per key, `roles` per role and field, and `models` per model and field. Arrays, including `chain` and `testLayers`, replace the old array.
- A new profile needs `description`. `null` removes a custom profile, with a warning when it does not exist. Removing `normal` or `prototype` is an error.

`loadConfig({ cwd, env, homedir })` reads, parses, validates, and merges the layers. It returns a `LoadedConfig`. After all layers merge, `validateMergedProfiles` checks the selected name and every inheritance chain. A project profile can extend a user profile. Unknown parents, cycles, and chains longer than eight profiles are errors that name the chain. Issues name the last source of the profile, or the selection source for an unknown root `profile`. This pass leaves the merged profiles intact.

Profile chain validation stops at the ninth profile when the supported maximum of eight is exceeded. Each diagnostic includes at most those nine names.

`loadConfig` then resolves every merged profile the way `resolveProfile` does (section 6.7) and adds each merge issue to `LoadedConfig.issues`, so `omt config validate` reports it. Each issue has the last source of the profile and the path `profiles.<name>.roles.<role>` (or `.limits.<key>` or `.models.<id>`), with the message of the merge rule above, for example `a new role needs description, access, and chain; missing: description, access, chain`. An issue is reported once, for the profile that declares the field. A child profile that inherits the field does not repeat the issue. A profile whose chain check failed is not resolved.

A new profile without `description` gets the error `a new profile needs description; missing: description` and stays out of the merged config. `loadConfig` runs the chain check and the profile resolution on a temporary copy of the merged config that holds this profile, so its unknown `extends` parent and its role errors are reported too. It checks each dropped profile of each layer on its own copy and reports its issues with that layer's source, also when a later layer adds the description.

`effectiveConfig` returns `issues: loaded.issues`, plus a retired-profile selection warning (section 6.7), and does not add the resolved profile's issues again. The resolved profile keeps its own `issues`. So `omt profile show` prints each profile issue once, with the file source.

A JSONC syntax error in a file becomes one error issue, and that file is skipped. Only unexpected I/O errors throw.

### 6.4 Defaults

`src/config/defaults.ts` exports one `DEFAULT_CONFIG` and `diffDefaults(from, to, overrides): DefaultsChange[]`. The values of `DEFAULT_CONFIG` are in `src/config/defaults.jsonc`. `src/config/defaultsText.ts` is a Bun macro that reads the file, and `defaults.ts` imports it `with { type: "macro" }` and parses the text with `parseJsonc`, so the bundle and the binary hold the text and read no file. The file is in the layout that `setJsoncValue` writes, so that a save from `bun run defaults:edit` changes only the edited lines. `test/defaults.test.ts` checks that the file has no validation issue and passes `isCompleteDefaults`. Each release updates this configuration directly. The accepted snapshot in the install record supplies the active base until the user accepts the current defaults (section 5.12).

`diffDefaults` compares leaf values in both configurations. Arrays, including role chains, compare as one leaf. Chains print as `driver/model effort, ...`, with `provider` when no driver is set and ` fast` for a fast rung. Other values print as JSON. A missing value prints `none`. Added or removed objects report each leaf.

Overrides are the validated user and project layers, in that order. A layer overrides a change when it sets the full path or removes an ancestor with `null`. `overriddenBy` names the last layer that overrides the change. The diff covers roles, profiles, workflow, limits, and model settings.

Every default rung sets `driver` and also sets `provider` to the same value (`claudeAgent` or `codex`). These are the ids of the T3 built-in provider instances. So an unverified default target names `providerInstanceId`, and a verified one still checks the instance. Observed T3 behavior is the reason. T3 checks a named provider instance again before it refuses it, but it picks a `driverKind`-only target from a cached provider snapshot, and that snapshot can be stale, for example when the T3 window is in the background. With capabilities, a default rung whose instance is not registered runs on an instance of its driver (section 8.3). Without capabilities, a user whose provider instance ids differ from the driver kinds overrides the chains in a config layer.

For a role without `crossFamily`, rung 2 runs only when T3 refuses rung 1. For a cross-family role, `--against` can put rung 2 first (section 8.3).

`design` starts on Opus at medium effort and falls back to Astra at high effort. `ui` starts on Opus at low effort and falls back to Sol at high effort. The owner reviews the designs.

| Role | Access | Result | t3Role | Mode | crossFamily | Chain (driver/model effort) |
| --- | --- | --- | --- | --- | --- | --- |
| `explore` | read-only | research | research | plan | false | codex/gpt-6.1-terra low, claudeAgent/claude-haiku-5-5 medium |
| `research` | read-only | research | research | plan | false | codex/gpt-6.1-sol low, claudeAgent/claude-sonnet-5-5 medium |
| `plan-review` | read-only | review | review | plan | true | codex/gpt-6-astra medium, claudeAgent/claude-opus-5-5 medium |
| `grill` | read-only | grill | review | plan | true | codex/gpt-6-astra medium, claudeAgent/claude-opus-5-5 medium |
| `execute` | edit | work | implementation | default | false | claudeAgent/claude-opus-5-5 low, codex/gpt-6.1-sol high |
| `review` | edit | review | review | default | true | codex/gpt-6-astra medium, claudeAgent/claude-opus-5-5 medium |
| `oracle` | edit | review | review | default | true | codex/gpt-6-astra medium, claudeAgent/claude-opus-5-5 medium |
| `qa` | edit | test | test | default | false | codex/gpt-6.1-sol medium, claudeAgent/claude-sonnet-5-5 low |
| `guardrail` | read-only | guardrail | review | plan | false | claudeAgent/claude-opus-5-5 high, codex/gpt-6-astra high |
| `writing` | edit | work | implementation | default | false | claudeAgent/claude-opus-5-5 medium, codex/gpt-6-astra medium |
| `design` | edit | work | design | default | false | claudeAgent/claude-opus-5-5 medium, codex/gpt-6-astra high |
| `ui` | edit | work | implementation | default | false | claudeAgent/claude-opus-5-5 low, codex/gpt-6.1-sol high |

`review` and `oracle` have `edit` access, so that the reviewer fixes each local finding itself and reports the rest (section 11).

`qa` starts on Sol at medium effort and falls back to Sonnet at low effort. It has `edit` access only so that it can run commands and write logs; its brief forbids edits in the repository (section 9.2).

Every default role has `runtimeMode: "inherit"` and an explicit `crossFamily`. Without `--against`, the cross-family roles start on codex, which fits the default worker (`execute` on claudeAgent).

Role descriptions (shown to agents in `omt roles` and in skills):

- `explore`: Search this repository and answer one narrow question with file and line citations.
- `research`: Answer a question from docs, the web, and code, with cited sources.
- `plan-review`: Check a plan for gaps, ambiguity, and steps that cannot be verified.
- `grill`: Test a goal before it has a plan: find its edge cases, open questions, and options.
- `execute`: Implement one planned unit inside its scope and run its verify commands.
- `review`: Review a diff against its brief, fix local findings in the changed files, and report the rest by severity. Runs on the family that did not make the change.
- `oracle`: Attack the finished change from the family other than the main implementer's, fix local findings, and report the rest before it counts as done.
- `qa`: Run the given check commands and device flows, and return each exit code with its log and screenshots. Edits nothing.
- `guardrail`: Turn review findings into deterministic checks and rule fixes, so that the next change cannot repeat them.
- `writing`: Write or edit documentation and other prose.
- `design`: Design screens and flows in Paper, and write a design spec that UI units cite.
- `ui`: Implement one UI unit from its design spec or task requirements, inside its scope.

Default limits: `maxParallel` 6, `maxDepth` 1, `maxReviewRounds` 4.

Default profile: `normal`. Default models: `{ "gpt-6.1-sol": { "fast": true } }`. No default role or rung sets `fast`.

### 6.5 Starter files

`src/config/starter.ts` exports two strings. `omt config init` and `omt install` write the user starter. `omt init` writes the project starter. Both are sparse. They hold `$schema`, `version`, empty `roles` and `limits` objects, and comments with one example override, a commented `"profile": "prototype"` line, and a pointer to `omt config show --defaults`. After the `"profile"` line, each starter has a commented `"profiles"` example: a profile `fast-proto` with `description`, `"extends": "prototype"`, `"workflow": { "build": { "failureProofs": "on" } }`, and `"roles": { "execute": { "fast": true } }`, and a comment that points to `omt profile show <name>`. The `$schema` URL is `https://raw.githubusercontent.com/gabimoncha/oh-my-t3/main/schema/omt.schema.json`.

Only the user starter has a commented `// "update": "check",` line after the `limits` object, with the comment `// Check for a new omt once a day in omt install and omt doctor (asks the npm registry).`

### 6.6 JSON Schema

`src/config/schema.ts` exports the JSON Schema (draft 2020-12) for a config file as a plain object. `scripts/build-schema.ts` writes it to `schema/omt.schema.json` with 2-space indentation and a final newline. A test fails when the committed file differs from the generated output. Another test checks that the schema allows exactly the keys that `validateLayer` allows. Role and rung definitions include boolean `fast`. The role definition also includes boolean `crossFamily`. The schema defines `profile`, `profiles`, `models`, and all workflow groups. Preset profile values cannot be null. New-profile descriptions and inheritance chains need the runtime merge checks. `visuals`, the retired limit `maxTasksPerRun`, and the retired build keys `verify`, `checkpoint`, and `stallMinutes` stay only as `{ "deprecated": true, "description": "No longer used. omt ignores this key." }`, so an editor marks an old key instead of rejecting it; `validateLayer` drops each with a warning (section 6.2). A retired role name needs no entry, because `roles` accepts any role name. `defaults` is also deprecated and has no date enum.

`update` has an `enum` of `off`, `check`, and `apply`.

### 6.7 Profiles and workflow

`src/profile/resolve.ts` selects a profile and applies its inheritance chain. Selection uses this order, highest first:

1. A command's explicit name or `--profile <name>`.
2. The plan header's `profile=<name>`.
3. The project config's `profile`.
4. The user config's `profile`.
5. `normal`.

`resolveProfile(config, name)` starts from the merged config. It walks `extends`, then applies the chain from parent to child. A profile without `extends` inherits `normal`, except `normal` itself. Each profile applies its roles, limits, and models through `mergeLayer`. Workflow values start from the merged `normal` profile and merge per group and key. Profile overrides therefore apply after root config overrides. The function does not mutate the input.

When the `--profile` argument or the plan header names a retired profile (section 6.2), `effectiveConfig` selects `normal` and adds the warning `profile "pr-review" is no longer used; normal runs the PR steps` to its `issues`, with the source `--profile` or `plan header`. Commands print this warning on stderr. `omt plan new --profile` and `omt plan profile` write `normal` to the plan header, and `omt brief` writes `--profile normal` in the brief.

`effectiveConfig(loaded, { profile?, planProfile? })` returns the loaded fields plus the resolved `profile`. Its `config` has the selected name and the profile-applied `roles`, `limits`, and `models`. The resolved `profile` contains the full `workflow` and its merge issues. `omt config show` returns the layers before this application. `omt profile show` returns the resolved values.

The following keys are under `profiles.<name>.workflow`. The table shows the resolved preset values. `normal` defines the full workflow. `prototype` extends `normal` with sparse overrides.

| Key | Allowed values | `normal` | `prototype` |
| --- | --- | --- | --- |
| `plan.review` | `two-families`, `one`, `owner` | `two-families` | `one` |
| `plan.testLayers` | array of `integration`, `e2e`, `unit` | `["integration"]` | `["integration"]` |
| `design.variants` | integer 1 to 5 | 3 | 1 |
| `design.tool` | `paper`, `html` | `paper` | `paper` |
| `build.review` | `every-round`, `first-round`, `off` | `every-round` | `first-round` |
| `build.qa` | `planned`, `off` | `planned` | `planned` |
| `build.failureProofs` | `on`, `off` | `on` | `off` |
| `build.oracle` | `heavy`, `always`, `off` | `heavy` | `off` |
| `review.reviewers` | `auto` or integer 1 to 4 | `auto` | 1 |
| `review.families` | `one`, `both` | `one` | `one` |
| `review.oracle` | `on`, `off` | `on` | `off` |
| `review.fixLoop` | `offer`, `off` | `offer` | `offer` |
| `review.ci` | `off`, `check`, `fix` | `off` | `off` |
| `review.verify` | `off`, `changed-flows` | `off` | `off` |
| `review.tests` | `off`, `offer` | `off` | `off` |
| `review.guardrails` | `off`, `propose` | `off` | `off` |
| `review.crap` | `off`, `report` | `off` | `off` |
| `git.branchCommits` | `auto`, `ask` | `auto` | `auto` |
| `git.pullRequests` | `auto`, `ask`, `off` | `auto` | `auto` |
| `git.defaultBranch` | `ask`, `auto` | `ask` | `ask` |
| `git.merge` | `ask`, `auto` | `ask` | `ask` |
| `git.owners` | array of GitHub owners that match `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$` | `[]` | `[]` |
| `git.maxPrFiles` | integer from 0 to 10000; 0 means no limit | `100` | `100` |

`plan.review` sets the plan reviewer of `omt-plan`. `two-families` keeps its name but means 1 `plan-review` child on the family other than the main thread's. `one` means 1 `plan-review` child on any family. `owner` means the owner reviews the plan, with no child. Every value runs at most 2 review rounds. `design.variants` is the number of variants of each screen that `omt-design` draws. The main thread draws when its model is the model of the first target of the `design` role (`omt route design`), and 1 `design` child draws otherwise. `design.tool` picks the drawing tool: `paper` draws in Paper when its MCP tools load, else in HTML mockups; `html` draws HTML mockups only. The `review` PR extras (`ci`, `verify`, `tests`, `guardrails`, `crap`) are `off` in both presets; a user or project config turns them on.

The build keys `verify`, `checkpoint`, and `stallMinutes` are retired (section 6.2). A run has no per-unit verify cadence, no owner check-in per layer or unit, and no stall heartbeat: the main thread builds, then one review child and one QA child check the work.

Set `2026-10` has no `git` group, so with that set each `git` key that the config does not set is absent, and `omt git check` gives `ask` for it (section 5.15). `git.owners` lists the owners, such as the user's orgs, whose repos count as the user's own; the user's login always counts. `git.maxPrFiles` is the most changed files in one PR; sets `2026-10` and `2026-11` do not set it, so they have no limit. Over the limit, the skills split the branch into stacked PRs with `gh stack` (section 15.1). The omt default policy is 100 files. This is the file limit of a CodeRabbit review on its free plan for open-source repos, as of 2026-10. `prototype` also sets `limits.maxReviewRounds` to 2. `normal` sets no limits, roles, or models.

The skills apply these switches at the steps in section 15. They reload the profile on wake and after an owner switch. `omt plan profile <slug> <name>` changes the remaining work of a running plan. It does not change completed tasks.

## 7. JSONC

`parseJsonc(text: string, source: string): unknown` in `src/config/jsonc.ts`:

- Supports `//` line comments, `/* */` block comments, and trailing commas before `}` and `]`.
- Comment markers inside strings are text, not comments.
- Replaces each comment character and each trailing comma with a space, keeps newlines, then calls `JSON.parse`. Positions therefore stay the same.
- On a syntax error it throws `OmtError` with code `jsonc_parse` and the message `<source>:<line>:<column>: <reason>`. An unterminated block comment is also an error.
- Accepts and strips a UTF-8 byte order mark.

`setJsoncValue(text: string, path: readonly string[], value: unknown | undefined): string` in the same file sets, adds, or removes the value at `path` in a JSONC object. `setTopLevelValue(text, key, value)` is its depth-1 case and calls `setJsoncValue(text, [key], value)`. Both keep the byte order mark and every byte outside the replaced or removed ranges, with three exceptions: duplicate keys on the path merge into the last one, an empty `{}` that gets a member becomes multi-line, and a removal also removes each object that it empties, as the removal rules below say. Comments inside a replaced or removed value are lost.

Path:

- A path has at most 32 segments. An initial scan rejects more than 16 excess duplicate keys across the edited path before any repeated scan or removal. Both limits fail with `jsonc_edit`.
- The scanner reads the root and each object on the path with one function, `objectMembers(chars, open)`, on a copy of the text with the comments blanked, so the offsets match the text.
- At each level, the path follows the last member with the key, the one that `JSON.parse` keeps. Arrays are leaves: a path never indexes into an array.
- Before the edit, the older duplicates of each key on the path go, with the removal rules below, so that the parsed result holds the new value. For a removal, this step skips the last key, because the removal removes every occurrence of it.

Set, with `value` defined:

- When the key at the last segment exists, its value range gets the rendered value.
- When a member on the path holds a value that is not an object (`null`, a scalar, or an array) and more segments follow, that value gets a new object built from the remaining path.
- A missing key at depth 1 goes after the last of the top-level keys `version` and `defaults` that exists, or first in the object when neither exists. The new line takes the indentation of the line that it follows, or of the first property.
- A missing key at depth 2 or more goes after the last member of its object, with the indentation of the last sibling that starts its line. When no sibling starts its line, it takes the indentation of the parent's line plus one indent step.
- A new member gets the file's line ending and a comma that keeps the object valid: a trailing comma when the previous member had one, else a comma after the previous value. When only spaces and one-line comments follow the previous member on its line, the new member goes on the next line, so a same-line comment stays with its property. Otherwise, for example when a block comment that spans lines starts on that line, the new member goes on the same line, directly after the previous member, so it is never inside a comment.
- When a missing key at depth 2 or more goes in an object with no member, the new member goes after the last comment between the braces, with the indentation of the parent's line plus one indent step. A one-line object becomes multi-line, and its closing brace gets the indentation of the parent's line. A stray comma in `{,}`, which `parseJsonc` reads as an empty object, becomes a space. These rules do not apply to the root. In a root object with no member, the depth-1 rule applies: the new member goes directly after `{`, before any comment, and a stray comma stays after the new member.
- A missing parent is created as one nested value, for example `"roles": { "execute": { "fast": true } }`.

Rendering:

- A value is `JSON.stringify(value)` on one line when its line stays at most 100 columns. The count runs from the start of the line to the end of the value, plus a comma directly after the value. Text after that comma does not count.
- Otherwise the value is `JSON.stringify(value, null, step)`, with each new line indented to the line of the value. This rule also holds for a top-level value.
- The indent step comes from the first top-level object value that has a member that starts its line. The step is that member's indentation minus the indentation of the first top-level member that starts its line. When the inner indentation does not extend the outer one, or no such member exists, the step is 2 spaces.
- The line ending is `\r\n` when the text holds one, else `\n`.

Remove, with `value` `undefined`:

- A path that does not exist returns the text unchanged.
- It removes every occurrence of the last key in its object, and the comma that each one needs: its own comma, or for the last property the comma before it. It removes the whole line when the property is alone on that line. It keeps every comment outside the removed property, also a comment after the removed value. A comment between the removed key and its value is part of the property and goes with it.
- When the removal leaves an object at depth 2 or more with no member and no comment between its braces, it removes that object's member too, and repeats upward. It stops at the first object that keeps a member or a comment, and it never removes a top-level key. For example, removing `profiles.prototype.limits.maxParallel` from `"prototype": { // note` + `"limits": { "maxParallel": 3 } }` removes `limits` and keeps `prototype` and `// note`.

Errors:

- Text that does not parse throws the `jsonc_parse` error.
- `OmtError` code `jsonc_edit`: the root is not an object, the path is empty, a segment is empty, or `JSON.stringify(value)` returns `undefined`, as for a function. So `setTopLevelValue` with an empty key throws `jsonc_edit`.
- When `JSON.stringify(value)` throws, as for a `BigInt` or a cyclic value, its error goes to the caller unchanged, for example a `TypeError`.

## 8. Capabilities, effort, and routing

### 8.1 Reading capabilities

`parseCapabilities(text: string): Capabilities` accepts:

- The `orchestrator_capabilities` result object, which has a `providers` array.
- An MCP content wrapper: `{ "content": [{ "type": "text", "text": "<json>" }] }` or a bare array of such items. The first text item that parses to an object with `providers` wins.

It keeps the fields listed in section 3 and ignores the rest. A missing `models`, `constraints`, or `models[].options` becomes an empty array. T3 leaves out `options` for a model with no descriptors, so an empty array means "this model has no options". A `null` value becomes `undefined`. A missing `canRunChildTask` becomes `false`. A trimmed file that lists only some providers or models is valid. Bad input throws `OmtError` with code `capabilities_parse`.

### 8.2 Effort mapping

`mapEffort(effort, descriptors, driverKind)` returns `{ options: Record<string, OptionValue>; note?: string }`.

When `descriptors` is an array (capabilities are known):

1. Look for the first descriptor whose `id` is in this list, in this order: `effort`, `reasoningEffort`, `reasoning_effort`, `reasoning`, `variant`, `thinking`. It must have `type: "select"` and at least one choice whose id is on the effort ladder.
2. If the exact effort is a choice, use it.
3. Otherwise use the highest ladder choice below the requested effort. If none is below, use the lowest ladder choice above it. Add the note `effort <requested> mapped to <used> for option <id>`.
4. Choices that are not on the ladder (for example `ultrathink`, `ultra`, `default`) are never picked.
5. If no descriptor qualifies, return no options and the note `effort <requested> not applied: the model advertises no effort option`.

When `descriptors` is `undefined` (no capabilities), use the driver table:

| Driver | Option id | Value rules |
| --- | --- | --- |
| `claudeAgent` | `effort` | `off` and `minimal` become `low` |
| `codex` | `reasoningEffort` | `off` and `minimal` become `low` |
| `grok` | `reasoningEffort` | unchanged |
| `pi` | `thinking` | unchanged |
| `opencode` | `variant` | `off` and `minimal` become `low`; `max` becomes `xhigh` |

Any other driver, or an unknown driver, returns no options and the note `effort <requested> not applied: unknown option for driver <driver>`. Every changed value adds a note.

### 8.3 Resolving a role

`resolveRole(name, role, caps?, options?)` walks the chain and builds one `RungAttempt` per rung. `options` is `{ models?: Record<string, ModelConfig>; against?: string; notes?: string[]; drivers?: Map<string, string>; harnesses?: string[] }`. `notes` are role-level notes that go first, such as the `--against auto` note (section 5.3). `drivers` maps a provider instance id to a driver kind for the family rule below. The command layer passes `configuredDrivers(config.roles)` and the effective `config.models`.

Harness filter. `omt roles`, `omt route`, `omt brief`, and the doctor `roles` check pass the effective `config.harnesses`; `harnessOptions(harnesses, roles)` builds `{ harnesses, drivers: configuredDrivers(roles) }`, or `{}` when the key is unset. When `options.harnesses` is set, a rung whose driver kind is known and not in the list is a failed attempt with the reason `harness <driver> is not enabled (harnesses: <list joined with ", ">); run omt detect`, before any other check. The driver kind is known when the rung names a registered provider (its `driverKind`), sets `driver`, or names a provider instance that `drivers` maps. A rung whose driver kind is unknown stays. The role is `unavailable` when no rung is left.

With capabilities, first check the parent's mode ceilings. T3 lets a child keep or narrow the parent's modes, never widen them.

- When `caps.interactionMode` is `plan`, a role with `access: "edit"` or `interactionMode: "default"` is `unavailable` with the reason `the parent thread is in plan mode; this role needs default mode`.
- Runtime modes rank `approval-required` < `auto-accept-edits` < `auto` < `full-access`. When the role's `runtimeMode` is not `inherit` and ranks above `caps.runtimeMode`, the role is `unavailable` with the reason `role runtime mode <x> is broader than the parent's <y>`.
- A mode-ceiling failure gives every rung the same reason.

Then walk the rungs:

1. Find the provider. With `rung.provider`, it is the provider whose `providerInstanceId` equals it. When the rung also has `driver` and the kinds differ, the rung fails with `provider instance <id> has driver <kind>, not <driver>`. With only `rung.driver`, pick in this order: the provider named by `caps.inheritedProviderInstanceId` when its `driverKind` matches and it can run child tasks (this is what T3 itself picks), then the first provider of that kind that can run child tasks, then the first provider of that kind. When no provider has the id `rung.provider` and the rung also has `driver`, pick by the driver with the same rule, and add the note `provider instance <id> is not registered; using instance <picked id> of driver <driver>`. So a default rung still runs when the T3 instance ids differ from the driver kinds.
2. Fail when no provider is found. A rung with only `provider` fails with `provider instance <id> is not registered in T3`. A rung with `provider` and `driver` fails with `provider instance <id> is not registered in T3; no provider instance with driver <driver>`. A rung with only `driver` fails with `no provider instance with driver <driver>`.
3. Fail when `canRunChildTask` is false: `provider <id> cannot run child tasks: <constraints joined with "; ">`. Use `no reason given` when the list is empty.
4. Fail when the provider lists models and none has `id === rung.model`: `model <model> is not advertised by <id>`. A provider with an empty model list accepts any model. Effort then goes through the driver table (section 8.2), and the rung gets the note `provider <id> lists no models; T3 will check the model and its options`.
5. Build options. Apply `mapEffort` with the model's descriptors when `rung.effort` is set. Apply fast mode (section 8.4), then copy `rung.options` over the result.
6. Validate options when the model has descriptors. Every id must match a descriptor. A `boolean` descriptor needs a boolean value. A `select` descriptor needs one of its choice ids. On failure the reason is `invalid options: <problem>; <problem>`. When the model has no descriptors and options are present, keep them and add the note `the model advertises no options; T3 will not check them`.
7. The target is `{ providerInstanceId, model, options }`. Omit `options` when it is empty.

Cross-family order. The pure functions live in `src/routing/family.ts`.

- `configuredDrivers(roles)` maps each provider instance id that a configured rung names together with a `driver` to that driver. It reads the rungs of every role in the effective config, and the first such rung wins.
- `rungFamily(rung, caps?, drivers?)` gives the family of a rung, in this order. With capabilities, when a provider has the `providerInstanceId` `rung.provider`, the family is that provider's `driverKind`. Otherwise it is `rung.driver` when set. Otherwise it is `drivers.get(rung.provider)` when that is set, else `rung.provider`. Families are compared as strings.
- `workerFamily(against, caps?, drivers?)` gives the worker family. It is the `rungFamily` of a rung that names only the provider `against`. The worker and the rungs use the same rule and the same `drivers`, so a provider instance id gets the same family on both sides of the comparison. A driver kind that is not a provider instance id stays as it is.
- The family is the driver, not the model vendor. This is a known limit. A driver that runs models of more than one vendor (`cursor`, `opencode`) counts as its own family.
- When `options.against` is set and the role has `crossFamily: true`, the chain is reordered before the walk, as a stable partition (`crossFamilyOrder`). The rungs whose family differs from the worker family come first, in configured order. The rungs of the worker family come after them, in configured order. When the order changed, the note is `cross-family: worker family <family>; other families first`. When it did not change, the note is `cross-family: worker family <family>; the configured order applies`.
- When no rung of the chain is in the worker family, the order does not change, no other cross-family note is added, and the note is `cross-family: no rung is in family <family>; check that --against names a driver or a configured provider, or pass --capabilities`.
- After the walk, when the first ok rung is in the worker family, the note is `cross-family: no rung outside family <family> is available; the same family reviews`.
- When `options.against` is set and the role does not have `crossFamily: true`, the order does not change, and the note is `role <name> is not cross-family; --against has no effect`.
- Without `options.against`, the configured order applies.
- `RungAttempt.index` keeps the configured position, so every `rung <n>` label uses the configured rung number. `attempts` and `fallbacks` are in the order tried.

`pickWorker(entries, roles, plan, unit?, warn?)` returns `{ provider, from: "unit" | "plan" }` or `undefined`, with the rules of section 5.3. `warn` gets one message for each worker entry whose `provider` is set but is not a non-empty string. The command layer reads the ledger file, passes the entries, and prints each message as a `warning:` line on stderr.

Without capabilities, every rung is ok. The target uses `providerInstanceId: rung.provider` when present, else `driverKind: rung.driver`. The default rungs set `provider`, so they give `providerInstanceId` targets (section 6.4). Effort goes through the driver table, using `rung.driver`, or `rung.provider` when no driver is given.

Status:

- `resolved`: capabilities were given and at least one rung is ok.
- `unverified`: no capabilities were given.
- `unavailable`: no rung is ok. This holds without capabilities too, for example for a rung that names no provider or driver.

`delegateTask` uses the first ok rung's target plus the role's `t3Role`, `interactionMode`, and `runtimeMode`. `fallbacks` holds the targets of the later ok rungs. `RoleResolution.crossFamily` copies the role's flag (`false` when unset). `RoleResolution.notes` holds the role-level notes, and is absent when there are none. `toRouteOutput` puts them before the rung notes.

`resolveAll(config, caps?, only?, harnesses?)` returns a `RolesReport` and passes `harnesses` to every `resolveRole` call. It keeps the order of `only` and drops duplicates. An unknown name in `only` throws `OmtError` with code `unknown_role`.

### 8.4 Fast mode

For each rung, the first defined value wins: `rung.fast`, `roles.<role>.fast`, `models.<model id>.fast`, then `false`. Explicit `false` stops inheritance. It adds no fast option, so the provider default applies. A raw option in `rung.options` still applies.

With `fast: true` and known capabilities:

1. A `serviceTier` select that offers `priority` gives `serviceTier: "priority"`.
2. Otherwise, a boolean `fastMode` gives `fastMode: true`.
3. Otherwise, add no fast option and the note `fast mode is not offered by <provider>/<model>`.

Known capabilities with no model descriptors never infer a fast option. Without capabilities, driver `codex` gives `serviceTier: "priority"`. Driver `claudeAgent` with a model id that starts with `claude-opus` gives `fastMode: true`. Other targets get the same unsupported note and no fast option. Unverified routing uses `rung.driver`, or `rung.provider` when no driver is set.

Effort mapping applies first, fast mapping second, and explicit `rung.options` last. The chosen target and each fallback keep their mapped options. An unsupported fast option does not make the rung unavailable.

## 9. Briefs

### 9.1 Templates

A role template is a Markdown file. Its whole content is the persona and rules for that role. `src/brief/templates.ts` looks for `<role>.md` in this order and uses the first file found:

1. `projectRolesDir(projectRoot)`
2. `userRolesDir(env, homedir)`
3. `<packageRoot>/skills/omt/references/roles/`
4. `<packageRoot>/skills/omt/references/roles/_generic.md`

The result contract for a role comes from `<packageRoot>/skills/omt/references/results/<result>.md`, where `<result>` is the role's `result` field. A contract file holds only one fenced `text` block. The renderer inserts the file content as is, trimmed.

### 9.2 Rendered brief

`renderBrief(input, persona, contract)` returns Markdown in this layout. A section with no content is left out, except `Role`, `Task`, `Constraints`, and `Final message`, which are always present.

```text
<!-- omt-brief v1 role=<role> round=<n> depth=<d>/<max>[ plan=<slug>][ unit=<id>] -->

# Role: <role>

<persona>

# Task

<task>

# Context

<context>

# Scope

- `<path>`

# Constraints

- <access line>
- <delegation line>
- <evidence line, only for roles whose access is edit>
- <plan-mode line, only for roles whose interactionMode is plan>
- <children line, only when the child may start children>
- CLI: Run omt as <command>.
- Tests: <role policy>
- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.
- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.
- Processes: do not run `pkill`, `killall`, or another kill by name, because it can stop your own run. Stop only a process that you started, by its PID. Give each command that can run long a time limit, for example `timeout 900 <command>`. Close each device or browser session that you or your script opens on every exit path, for example `trap '<close command>' EXIT`.
- Shared files: never break and restore files in the shared checkout, for example to prove that a test can fail. The main thread makes that proof in a private copy.
- Shared builds: <lock and retry rule>
- <device line, for every role except `qa`>

# Done when

- <condition>

# Verify

- `<command>`

# Prior rounds

<prior>

# Final message

End your work with the block below as your final message. Keep it under 60 lines and put nothing after it.

<contract>
```

Access lines:

- `read-only`: `Access: read-only. Change no files. Run only commands that leave the repository unchanged.`
- `edit` with a scope: `Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN.`
- `edit` without a scope: `Access: edit. Change only what the task needs.`
- role `qa`, which has `edit` access only to run commands and write logs: `Access: edit no files in the repository. Write only command output, logs, and screenshots under the Evidence directory.`

Delegation lines:

- When `depth >= maxDepth`, for every role: `Delegation: you are at depth <d> of <max>. Do all work yourself. Start no subagents and no delegated tasks.` No role has an exception for device checks.
- Otherwise, with a plan or an explicit profile: `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. For each child, pass <selection> --depth <d+1>[ --max-depth <max>] to omt brief.` Here `<selection>` contains `--plan <slug>` when set and `--profile <name>` when explicit. Keep both flags when both were given. Include `--max-depth <max>` only when the max differs from `limits.maxDepth` in the effective config.
- Otherwise, without a plan or an explicit profile, when `<max>` equals `limits.maxDepth` from the effective config: `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. Give each child depth <d+1> in its brief.`
- Otherwise, without a plan or an explicit profile (`--max-depth` changed the max): `Delegation: you are at depth <d> of <max>. You may delegate with the T3 delegate_task tool. Give each child depth <d+1>, and pass --max-depth <max> to omt brief.`

Evidence line, added after the delegation line when the role's `access` is `edit`:

- `Evidence: save command output and logs under <absolute project root>/.omt/evidence/.`

Plan-mode line, added after the delegation line when the role's `interactionMode` is `plan`:

- `Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.`

T3 stores a proposed plan as its own item type, and `task_status.summary` reads only assistant messages. Without this line, a plan-mode child can return its result where the parent's summary does not show it.

Children line, added after the evidence and plan-mode lines, before the CLI line, only when `depth < maxDepth`:

- ``Children: after you read a child's result, settle the child with the T3 `t3_thread_organize` tool, with `action: "settle"` and the child's `childThreadId`, never the `taskId`. Skip a child that still runs or waits for an answer. Settle nothing when `git rev-parse --git-dir --git-common-dir` prints two different paths, because then you work in a git worktree. A settle error is not a failure of your task.``

Every brief has these constraint lines:

- `CLI:` names `<project root>/.omt/bin/omt` when that path exists, else `omt`. The saved dispatch command uses the same shell-quoted command.
- `Tests:` for `execute`, `ui`, and `writing` forbids new test files, new test cases, and failure proofs. It permits an existing-test update only when the change breaks that test, with a note under `NOTES`.
- `Tests:` for `qa` is `Tests: write no tests and no failure proofs. Run the commands in Verify and the task's device flows, and report each command with its exit code and log path.` The main thread writes the planned tests and, with `build.failureProofs: on`, the failure proofs.
- `Tests:` for `review` and `oracle` makes a missing test a finding only when the plan or task names that test. Other roles get `Tests: write no tests.`
- `Shared builds:` requires the exact lock-wrapped command from the task. Retry a failed build or test only when the file is outside your scope and outside the task's named code under test. The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it. Wait 60 seconds and run the command once more. When it fails there again, report the command, the outside-scope file, and the message as another unit's state. For a failure in your scope or the named code under test, follow your result block. For `test` results, return `VERDICT: NOT VERIFIED` for that failure. When `omt lock run` exits 75, report the command, the lock name, and its message. Leave the lock to the main thread. For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`. For `test` results, including `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`. For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`.

Device line, the last constraint line, for every role except `qa`:

- ``Devices: do not drive a device, Simulator UI, browser, or computer yourself (`agent-device`, `agent-browser`, computer use, UI flows); only the qa role does that. List each device check with its steps and expected result under `OPEN` or `NOTES`, or before your result block when it has neither; the main thread sends it to the qa task.``

## 10. Request ids

`requestId(plan, unit, role, round, attempt)` returns `omt:<plan>:<unit>:<role>:r<round>:a<attempt>`. `round` and `attempt` default to 1. Characters outside `[A-Za-z0-9._-]` in each part become `-`. Then `plan` and `unit` are cut to 64 characters and `role` to 32, so the `:r<round>:a<attempt>` suffix always survives.

T3 derives the child thread id from this value. So:

- Reuse an id only to resend the same payload after a lost response. T3 then returns the existing task instead of starting a second one.
- Increase the attempt when you send the same round again to a fallback rung, or again after a child failed. `omt brief --fallback` picks the attempt from the ledger (section 5.4).
- Increase the round for each new review or fix round.

## 11. Result contracts

Each file in `skills/omt/references/results/` holds one fenced `text` block. The parent reads the first word after each label.

`work.md`:

```text
STATUS: DONE | BLOCKED | ESCALATE
SUMMARY: <one or two sentences>
CHANGES:
- <path>: <what changed>
VERIFY:
- `<command>` -> pass | fail: <key output line>
NOTES:
- <existing test updated because the change broke it, or other note; optional>
EVIDENCE:
- <path of a log, screenshot, or recording in the evidence directory>; or none
OPEN:
- <unresolved issue, or none>
```

`review.md`:

```text
VERDICT: APPROVE | REQUEST_CHANGES | BLOCK
SUMMARY: <one or two sentences>
FINDINGS:
- [P0|P1|P2|P3] <path>:<line> <problem>. Fix: <fix>.
FIXES:
- <path>: <the finding that you fixed and what changed>; or none
NOTES:
- <non-blocking note, or none>
```

`test.md`:

```text
VERDICT: VERIFIED | NOT VERIFIED | INCONCLUSIVE
CHECKS:
- `<command>` -> exit <code>: <key output line>
FAILURES:
- <test or scenario>: observed <x>, expected <y>; or none
EVIDENCE:
- <path of a log, screenshot, or recording in the evidence directory>; or none
```

`research.md`:

```text
ANSWER: <direct answer in one to three sentences>
FINDINGS:
- <fact> (<path:line or URL>)
UNKNOWN:
- <what was not found, with the searches run; or none>
```

`plan.md`:

```text
PLAN: <path of the plan file>
UNITS: <count>
DECISIONS NEEDED:
- <decision for the owner, with options and a recommendation; or none>
```

`guardrail.md`:

```text
VERDICT: PROPOSALS | NONE
SUMMARY: <one or two sentences>
PROPOSALS:
- G<k> [check|rule-fix|new-rule] <finding ids>: <proposal>. Where: <file>. Proof: <command that fails on the PR head and passes after the change, or none>.
NOTES:
- <each finding with no proposal and why, or none>
```

`grill.md`:

```text
VERDICT: OPEN | CLEAR
SUMMARY: <one or two sentences>
DIRECTIONS:
- <direction>: <what the user gets>; cost: <what it costs>; or none
DECISIONS:
- <area>: <choice>. Why: <reason>; or none
EDGE CASES:
- [blocking|minor] <area>: when <trigger>, <effect>. Handle: <proposed handling>. Test: integration | unit | none; or none
QUESTIONS:
- [blocking|minor] <area>: <question>. Options: <2 to 4 options>. Recommend: <option>, because <reason>; or none
NOTES:
- <non-blocking note, or none>
```

A grill returns `OPEN` when at least one blocking edge case or question remains that `Prior rounds` does not hold, and `CLEAR` otherwise. An edge case is blocking when, without a decision on its handling, the build would do the wrong thing, lose data, or break a flow of the goal; a question is blocking when its answer changes what the user gets.

A `qa` result lists each command under `CHECKS` with its exit code and key output line, and each log, screenshot, and recording under `EVIDENCE`; `qa` writes no tests, so the contract has no test list. A `review` or `oracle` result lists the fixes that the reviewer made under `FIXES`, with their paths, or `none` when its access is read-only; `FINDINGS` holds only the findings that it reports. Worker `NOTES` are optional. A review or oracle finding needs a concrete failure scenario. When CRAP is requested, a CRAP finding instead names the changed function and its complexity, coverage, and CRAP values. This exception applies in every round.

Severity meanings for review findings: P0 breaks the build, loses data, or opens a security hole. P1 is a wrong result in a normal path. P2 is a wrong result in an edge case, a named missing test, or a requested CRAP finding above 30. P3 is style or clarity.

## 12. Plans

### 12.1 Template

`omt plan new <slug> --title <title>` writes (title defaults to the slug):

```markdown
# <title>

<!-- omt-plan v1 slug=<slug> created=<ISO timestamp> -->

## Summary

<at most 15 lines for the owner: what changes for them, the work, the main risk, the open decisions, and what is not in this plan>

## Objective

<what changes for the user, in one paragraph>

## Done when

- [ ] D1. <a check that can fail: a command, a test, or an observable result>

## Research

<research questions, their cited answers, and sources; or "none">

## Roles

<paste the output of `omt roles` here>

## Tests

An empty section means no new tests.

- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.

## Units

- [ ] U1. <title>
  - Role: main
  - Scope: <files or directories>
  - Done when: <condition>
  - Verify: `<command>`
  - Depends on: none

## Final verification

- [ ] F1. The full test suite passes: `<command>`
- [ ] F2. The oracle role approves the whole change.

## Log

- <ISO timestamp> plan created
```

`--light` leaves out the `F2` line. `Role: main` means that the main thread builds the unit. `ui` marks a unit that implements a design or changes UI, and `execute` marks a unit that goes to a child as an independent track. The parser does not read the role. The `## Summary`, `## Research`, and `## Tests` sections are in both forms. `--max-parallel <n>` adds ` max-parallel=<n>` before the `-->` of the header comment. `--profile <name>` adds ` profile=<name>` after the limit keys. `omt plan mark` appends its log lines after the last line.

### 12.2 Grammar and status

Checkbox lines start at column zero and match `^- \[( |x|X|~)\] (U|D|F)(\d+)\. (.*)$`. A space means open, `x` or `X` means done, and `~` means blocked.

The header comment is the first line of the file that is only an `<!-- omt-plan v1 ... -->` comment; the template writes it as line 3. The parser reads `slug`, `profile`, and `max-parallel` only from this header, so an example header that the body quotes later does not change them. The header comment `<!-- omt-plan v1 slug=<slug> created=<ISO timestamp> -->` can have an optional `max-parallel=<n>` key. `<n>` is an integer from 1 to 32, the same range as `limits.maxParallel`. The parser ignores a missing or invalid numeric limit. A `max-tasks` key, the task budget of older releases, has no effect. `headerWarnings(markdown)` returns `the max-tasks header key is no longer used; remove it` for a header that has it, and an empty array otherwise. The parser returns the `profile` text without validation. Commands resolve that name against config. The parser does not read the `## Research` or `## Tests` section.

`parsePlan(markdown)` returns:

```ts
interface PlanItem { kind: "U" | "D" | "F"; id: string; title: string; state: "open" | "done" | "blocked"; line: number } // id is kind plus number, for example "U4"; line is 1-based
interface PlanStatus {
  title: string;
  slug?: string;
  profile?: string; // the header profile key; status replaces it with the effective name
  maxParallel?: number; // the header max-parallel key, when it is valid
  items: PlanItem[];
  counts: Record<"U" | "D" | "F", { open: number; done: number; blocked: number; total: number }>;
  next?: PlanItem; // the first open U item in file order
  ready: PlanItem[]; // the open U items, in file order, whose dependencies are all done
  complete: boolean; // every U, D, and F item is done; false for a plan with no items
}
```

`omt plan status` adds `warnings: string[]` to this object: the result of `headerWarnings(markdown)`, then the result of `dependencyWarnings(markdown)` in file order of the units, and empty when there are none. `parsePlan` does not return it.

Human output of `omt plan status`:

```text
plan: auth-refactor (/home/me/app/.omt/plans/auth-refactor.md)
profile: normal
units: 3/7 done, 1 blocked, 3 open
done-when: 0/2
final: 0/2
next: U4 Add the token refresh endpoint
ready: U4, U6
```

`ready` reads the plan after it blanks every fenced line, so a checkbox inside a code fence is never ready and never satisfies a dependency. The dependencies of a unit are the `\bU\d+\b` tokens in its `Depends on` field (`  - Depends on: ...` under the item). An empty field, a missing field, or `none` means no dependencies. A self reference is ignored. A unit is ready when it is open and every other token names a `U` item of the plan in state `done`. A token that names no unit of the plan keeps the unit out of `ready`. A blocked unit is never ready. A unit id that appears on more than one `U` item is never ready, and a dependency on that id is unresolved. `next` does not check dependencies.

`warnings` reads the same `Depends on` tokens and holds these texts:

- `<U> depends on <T>, which is not a unit of the plan`, for a token that names no `U` item.
- `<U> depends on itself`, for a self reference.
- `the unit dependencies form a cycle: U1 -> U2 -> U1`, for the first cycle that a depth-first search finds.

A unit that waits on such a dependency never becomes ready, so the warnings tell the main thread why `ready` is empty.

## 13. Claude Code ultrawork hook

`omt hook user-prompt-submit` reads the hook input JSON from stdin and looks at its `prompt` string.

Detection (`detectUltrawork(prompt)`). The start checks in rules 1 to 3 ignore leading whitespace.

1. Return false when the prompt contains `<!-- omt-brief` or starts with `Act as the `. Both mark a delegated child's brief. T3 loads user settings in child sessions too, so without this rule a brief that mentions ultrawork would start a nested loop.
2. Return false when the prompt starts with `/omt-ulw`. The skill is already loading.
3. Return false when the prompt starts with `<task-notification>` or `Delegated task `. Claude Code sends the result of a background task to the session as a prompt that starts with the tag, and T3 sends the result of a finished child task as a new turn that starts with `Delegated task `. Neither holds a user request. The tag or the words later in a prompt do not skip it.
4. Remove fenced code blocks, inline code spans, lines that start with `>`, and text inside double quotes.
5. Match the phrase `start ulw` or `start ultrawork`, case-insensitive: the word `start`, one or more spaces or tabs, then `ulw` or `ultrawork`. `start` has no letter, digit, `_`, `-`, `/`, or `$` directly before it, and the keyword has none of these directly after it. So `restart ulw`, `starting ulw`, and `start ulw-mode` do not match, and `start ulw: fix the login` does. The bare words do not match, because they also appear when the user only asks about ultrawork. `/omt-ulw` and `$omt-ulw` load the skill directly and need no match.
6. Skip a match that is negated. A match is negated when one of the words `no`, `not`, `never`, `without`, `dont`, `don't`, or `don’t` (case-insensitive) comes before its word `start` on the same line, with at most two other words between them. The negator is a whole word. It has no letter, digit, or `_` directly before it, so `know` and `cannot` do not negate. A word is a run of letters, digits, `'`, and `’`. Only spaces or tabs separate the negator, the words, and the match, so a comma, a period, a non-breaking space, or a line break ends the window. Return true at the first match that is not negated, so `no start ulw here, but start ultrawork this` matches. The window is wide on purpose. A missed match costs less than a false one, because the agent can still load omt-ulw from its skill description, but a false match tells it to run the loop against the user's words. The cost is that `don't forget to start ulw` stays silent.

On a match the command prints one line of JSON and exits 0:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<pointer>"}}
```

The pointer text is at most 1,000 characters. It gives the build contract. Its text is:

```text
omt ultrawork is on for this request. Load the omt-ulw skill before anything else and follow its steps in order, from step 0. You explore, ask question batches, plan, and build in this thread. One review child and one QA child check the work. Done needs evidence: report done only after the checks ran and passed, and quote their output.
```

On no match, on empty input, or on invalid JSON, the command prints nothing and exits 0. It ignores arguments after the hook name and never exits non-zero. Only `omt hook` with no hook name or an unknown one is a usage error.

## 14. Install, uninstall, and doctor

### 14.1 Bundled skills

The bundled skills are the directories in `<packageRoot>/skills/` that contain `SKILL.md`. A missing `skills/` directory gives no bundled skills. In binary mode, `<packageRoot>/skills` is the embedded directory (section 5). The install copies a skill with `readdir`, `readFile`, and `writeFile`, not `fs.cp`, so that it can read the embedded directory. The copy keeps a symlink as a link and keeps the permission bits of each file.

### 14.2 Install plan

`omt install` first builds a plan without writing anything.

The plan first checks where the CLI runs from, because the install records that path. It reads `cliPath` and its real path:

- A one-shot runner cache, matched from the cache root: an npx cache (`<npm cache>/_npx/<hash>/node_modules/`), a pnpm dlx cache (`<pnpm cache>/dlx/<hash>/<id>/node_modules/`, where the cache folder is named `pnpm`, or `pnpm-cache` on Windows, and pnpm 8 has no `<id>`; with a custom `cache-dir` of any name, a `dlx/<hash>/<id>/node_modules/` path counts only when `npm_config_user_agent` starts with `pnpm/`, which pnpm dlx sets, and `dlx/<hash>/pkg` is a symlink that resolves to `dlx/<hash>/<id>`, which pnpm dlx writes for each cache entry; `pnpm exec` sets the same user agent, so the user agent alone does not show a dlx cache), or a bunx cache (`<temp>/bunx-<uid>-<package>/node_modules/`, or `<bun install cache>/.bunx-<uid>/<package>@<version>/node_modules/` from Bun 1.4.4). An older pnpm runs dlx from `<temp>/dlx-<pid>/node_modules/`, which counts as a one-shot cache too. A `_npx`, `dlx`, or `bunx-` directory at another place, such as `<temp>/project/fixtures/dlx-123/`, or `<temp>/project/dlx/x/node_modules/` without the pnpm user agent or without the `pkg` symlink, is no cache. A project install from a one-shot cache writes the runner shim of section 14.8. A user install from it is refused, because it would leave no `omt` command for the skills and the hook.
- Any other path inside the temp directory (`os.tmpdir()` or its real path): every install is refused, because such a path can disappear.

The one-shot check runs first, because the bunx cache is inside the temp directory. A refusal exits 1. It prints `refusing the user install: the omt CLI runs from ...` or `refusing --project: the omt CLI runs from ...` with the path, and a hint that names `npm i -g oh-my-t3`, `pnpm add -g oh-my-t3`, `bun add -g oh-my-t3`, `mise use -g github:gabimoncha/oh-my-t3`, and `npx oh-my-t3 install --project`.

Skill copies go to `skillRoots().agents/<name>`. Each target is one of:

- `create`: the target is absent.
- `update`: the target is managed, the hash of the installed files equals the marker hash, and the marker hash differs from the source hash.
- `unchanged`: the target is managed and the marker hash equals the source hash.
- `conflict`: the target exists and is not managed, or it is managed but the hash of the installed files differs from the marker hash (the user edited it). This holds even when the source is unchanged.

Links go to `skillRoots().claude/<name>`, and to `skillRoots().gemini/<name>` when that target is selected. The link is relative. Its target is computed from real paths, `path.relative(realpath(link root), join(realpath(agents root), name))`, so the link resolves even when a root is itself a symlink. Each link is `create`, `unchanged` (a symlink that resolves to the canonical directory), or `conflict` (anything else). Before planning links, resolve each root and the agents root with `fs.realpath` (a missing root resolves to its own path). When a link root and the agents root are the same directory, plan no links for that root.

The user config is `create` when absent, else `unchanged`.

The plan also holds a harness step. The install runs `detectHarnesses` (section 5.13), with the file of `--capabilities` when given. When the config step is `create`, a default driver is missing, and at least one driver is detected, the starter gets `"harnesses": [<recommended>]`, inserted after the `defaults` line with `setTopLevelValue`. When the config exists, the install never edits it. When its effective `harnesses` (unset means both default drivers) differ from `recommended` and a driver is detected, the step holds the hint `run omt detect --write`. The Claude hook, only with `--hooks`, is `create`, `update`, or `unchanged` (section 14.4).

Retired skills. A retired skill is a skill that the bundle no longer ships and that an earlier install of the scope wrote. A name counts only when all of these hold: the scope's manifest `skillsRoot` resolves to the current agents root, its `skills` list names it, `<agents root>/<name>` is a managed directory (the check that the uninstall makes, section 14.6), and in project scope `project.existing.skills` does not name it. A folder that the manifest does not list, or that has no marker, is the user's, and the plan never touches it. Reinstall preserves `project.existing` entries for skills and links absent from the new plan, so a later uninstall still keeps them. For each retired skill the plan holds a skill step `remove` with the reason `(no longer shipped)`. When the hash of its files differs from the marker hash, the step is `conflict` with `(locally modified)`, as for a bundled skill, and `--force` makes it `replace`. The plan also holds a link step `remove` with `(no longer shipped)` for each link at `<link root>/<name>`, in every link root of the scope, that is a symlink resolving to the retired folder, except a link that `project.existing.links` names. Recorded links are checked too, including links under a previous `CLAUDE_CONFIG_DIR`. When a recorded retired folder is already missing, remove only recorded symlinks that still point to that folder. Keep a link that now points elsewhere. A link to a skill that stays (a `conflict` or `keep`) gets no step. The plan output and `--dry-run` show these lines with the other actions, for example `remove   omt-loop  (no longer shipped)`.

`--targets` is a comma-separated subset of `agents`, `claude`, and `gemini`. `agents` is always included. The default is `agents,claude`, plus `gemini` when `<home>/.gemini` exists.

A directory is managed when it contains `.omt-managed.json`:

```json
{ "package": "oh-my-t3code", "version": "0.1.0", "skill": "omt-ulw", "hash": "<sha256>" }
```

The hash is SHA-256 over the sorted relative paths and the contents of a skill directory. The marker file itself is not part of the hash, and neither is any file named `.DS_Store` (Finder writes these). The marker stores the hash of the files as installed, which equals the source hash at install time.

Before removal, the apply checks that each link still has its planned target. After a skill folder is moved aside, it must still have its ownership marker and planned content hash. A folder that appeared after a missing-folder plan is kept. A changed path stops the apply with `file_changed`.

### 14.3 Install flow

1. Print the plan, grouped by skills, links, config, and hooks. One line per action, such as `create   omt-ulw`. After the config action, a `Harnesses (T3 settings and PATH):` or `Harnesses (capabilities):` section prints one indented line per driver (section 5.13). When the starter gets a `harnesses` key, it prints `the starter config gets "harnesses": <value>` and the effect lines. With no driver detected, it prints `no harness detected; sign in to Claude Code or Codex, then run omt detect`. With the hint of section 14.2, it prints `the config's harnesses differ from the recommendation <value or "(no key)">; run omt detect --write`. This section comes before the confirmation prompt.
2. With any `conflict` and no `--force`, print a hint that names `--force` and exit 1. With `--force`, mark each conflict as `replace` in the plan.
3. With `--dry-run`, stop here and exit 0. Nothing is written. When every action is `unchanged`, skip the prompt in step 4.
4. Without `--yes`: when `isTTY` is true, ask `Apply this plan? [y/N] ` and continue only on `y` or `yes`. Any other answer prints `Nothing was changed.` and exits 1. When it is false, print `Re-run with --yes to apply.` and exit 1. Nothing is written in either case.
5. Apply:
   - For each `replace`, move the existing path to `<configDir>/backups/<YYYYMMDDHHmmss>/<root name>/<name>`. When the stamp directory already exists, use `<YYYYMMDDHHmmss>-<n>` with the lowest free `n`. Backups never stay inside a skill root, because Cursor and OpenCode scan skill roots recursively and would load a backup as a duplicate skill.
   - For each `create`, `update`, or `replace` copy, build the new directory at `<parent of the agents root>/.omt-tmp-<random>`, write the marker into it, then move it into place. For an existing target, first rename it to `<parent of the agents root>/.omt-old-<random>`, then rename the new directory in, then delete the old one. Temp directories never sit inside a skill root. When the delete of a scratch directory fails, the run stops with an error that names the directory.
   - When a swap fails, delete the temp directory and move the old directory back, so the installed skill stays in place.
   - Before the skill copies, check and remove each retired skill, then remove that skill's links. If a skill check fails, its links stay in place. A `remove` skill is renamed to `<parent of the agents root>/.omt-old-<random>`, then deleted. When its files no longer have the hash that the plan read, it moves back and the run stops. A `replace` retired skill moves to `<configDir>/backups/<stamp>/agents/<name>` and gets no new copy.
   - Create the links, write the starter user config, add the hook, and write the manifest.
6. Print a summary and the next steps: restart agent sessions in T3 so they load the new skills, then try `$omt-ulw <task>`.

With `--project`, right after the plan in step 1, the install prints one line about the current checkout's worktree setup, `Worktree setup: <status> <message>`, from the `summary` of section 5.11. It prints it also with `--dry-run`. The line has no indent, so it is not a plan action. It changes no exit code.

A second run on an unchanged system shows only `unchanged` actions and writes nothing except the manifest timestamp.

### 14.4 Claude hook entry

In user scope, the hook command runs the CLI with the runtime that runs it now:

```text
"<runtimePath>" "<cliPath>" hook user-prompt-submit # oh-my-t3code
```

In binary mode, the binary runs by itself:

```text
"<cliPath>" hook user-prompt-submit # oh-my-t3code
```

In project scope, the command calls the shim instead, so one file holds the runtime and CLI paths:

```text
"<root>/.omt/bin/omt" hook user-prompt-submit # oh-my-t3code
```

The trailing comment is the signature that marks the entry as managed. The check of section 14.2 refuses an install that would record a path that can disappear.

The installer edits `claudeSettingsPath()`:

1. A missing file counts as `{}`. A file that is not valid JSON is an error, and the installer changes nothing.
2. Under `hooks.UserPromptSubmit`, add `{ "hooks": [{ "type": "command", "command": "<command>", "timeout": 10 }] }`. When an entry with the signature exists, replace its command instead.
3. Keep every other key and entry unchanged. Serialize an existing file in its own style: detect the indentation from the first indented line (2 spaces, 4 spaces, or a tab), and keep compact JSON compact. The write serializes the whole file in that indentation, so a mixed layout, such as inline arrays in an indented file, becomes fully indented. An empty object such as `{}` shows no style and gets 2-space indentation. Keep a final newline only when the old file had one, and keep CRLF line ends. A new file gets 2-space indentation and a final newline.
4. When the new content equals the old content, write nothing. This is the `unchanged` case.
5. Otherwise back up the old file, with mode 0600, to `<configDir>/backups/<YYYYMMDDHHmmss>/claude-settings.json`, then write. A missing file needs no backup. When this write adds the entry to an existing file (the `create` action), the manifest hook records the backup as `backup`. An `update` backup is not recorded there, because it holds an older omt entry. In project scope an `update` makes no backup when the file is in the layout that omt writes, that is, when serializing the parsed file in its detected style gives its exact bytes. Then the rewrite changes only the command of the omt entry. A file in any other layout gets the backup, so its original bytes stay recoverable. A settings path that is a dangling symlink counts as a missing file, and the write creates the link's target. The new `settings.json` keeps the mode of the old one. When `settings.json` is a symlink, write next to its real path and rename onto the real path, so the symlink stays in place.

Verify the hook schema against the current Claude Code hooks documentation before you write this code.

### 14.5 Manifest

`manifestPath()` holds:

```json
{
  "package": "oh-my-t3code",
  "version": "0.1.0",
  "installedAt": "<ISO timestamp>",
  "skillsRoot": "<agents root>",
  "skills": ["omt", "omt-ulw"],
  "links": [{ "path": "<link path>", "target": "<relative target>" }],
  "config": { "path": "<user config path>", "created": true },
  "hooks": [{ "kind": "claude-user-prompt-submit", "settingsPath": "<path>", "command": "<command>", "created": true, "backup": "<path>" }],
  "backups": ["<path>"]
}
```

A new install records `acceptedDefaults: { version: 1, cliVersion, config: DEFAULT_CONFIG }`. A later install preserves the previous accepted snapshot. An older manifest without a snapshot stays without one until the user reviews defaults.

A new install merges into an existing manifest. After the merge, `skills` keeps only the names that the plan keeps: a bundled skill, or a retired skill that stays (a `keep` step). So the record drops a removed retired skill, and a recorded name that is no longer shipped and is no longer managed (its folder is gone or has no marker). `links` drops each removed link, and each link whose name `skills` no longer lists. `created` is present, and true, when an install created the settings file. A later run keeps it. `backup` is the install-time backup of the settings file (section 14.4). A later run keeps the old value when it records none.

### 14.6 Uninstall

`omt uninstall` builds its plan from the manifest and from a scan:

- Remove each link in the Claude and Gemini roots that is a symlink resolving to a managed directory, except a link to a kept skill.
- Remove each managed skill directory in the agents root. In project scope, a skill or link that was in place before the install stays (section 14.8). A locally modified skill (its hash differs from the marker hash) is planned as `keep` with `(locally modified)` and stays in place. With `--force`, it is moved to `<configDir>/backups/<stamp>/agents/<name>` instead.
- Remove each hook entry with the signature, with the same style, backup, and symlink rules as section 14.4. When the manifest says that an install created the settings file, and removing the entry leaves `{}`, delete the file without a backup. When the settings path is a symlink, delete the link's target, which the install created, and keep the link.
- Exact restore: when the manifest hook has a `backup`, and the JSON left after removing the entry deep-equals the parsed backup, write the backup's bytes back exactly and make no new backup. Then delete that backup, and remove its stamp directory and `backups/` when they become empty. Otherwise write the edited JSON in the file's own style, after a new backup.
- Keep the user config unless `--purge` is given. `--purge` also removes the config directory when it is then empty.
- Remove the manifest.

The plan lists the user config and the manifest only when they exist. Two names of one directory or file (a symlink, or `/tmp` and `/private/tmp`) count as one, so the plan lists each skill, link, and settings file once. It never removes a path that is not managed. It leaves the skill roots in place, even when they are empty. A manifest or Claude settings file that is not valid JSON stops the command before any change. The confirmation flow is the same as for install.

### 14.7 Doctor

`omt doctor` first reviews pending defaults for the active install, unless the config has errors. `--project` selects the project snapshot. Without that flag, an active project snapshot takes precedence over the user snapshot. `--yes` accepts defaults. `--dry-run` writes nothing and skips daily checks and automatic updates. JSON adds `defaults: { changed, applied, changes }`.

Then doctor runs these checks and prints one line per check, such as `PASS  config  11 roles`:

| Id | PASS | WARN | FAIL | INFO |
| --- | --- | --- | --- | --- |
| `runtime` | binary mode, with the message `omt <version> binary`; otherwise `ctx.runtimeName` is `node` with `ctx.runtimeVersion` 22 or later, or `bun` with 1.4.4 or later | | an older Node or Bun; the message names both minimum versions | |
| `config` | no issues | warnings only | any error | |
| `defaults` | `current defaults` when the accepted and shipped defaults match | | | `<n> changes available; run omt doctor to review` |
| `update` | only when the update check is on (section 5.14), also with `--project`: `omt <v> is the latest (checked <date>)` | | never: a failed check is `INFO` | `omt <latest> is out; run omt update`; or `the update check failed: <reason>` |
| `harnesses` | the config sets no `harnesses` key: `claudeAgent, codex`; or the key holds both | | | a restricted harness list: `<list> only; <effects>`; effects follow the selected role chains as in section 5.13, so a single family reports `cross-family review: the same family reviews` |
| `skills` | every bundled skill is installed, managed, and current, and no retired skill is left | missing, outdated, or locally modified skills; a retired skill (section 14.2) that is still in place, as `no longer shipped: <names> in <agents root>; run omt install` | the CLI has no bundled skills (section 14.1) | |
| `links` | every Claude link resolves to its canonical directory | a missing link | a broken or conflicting link | |
| `hooks` | the manifest hook is present in the Claude settings, and the paths in its command exist | the manifest hook is missing from the settings | a path in the hook's command does not exist | no hook installed; suggest `omt install --hooks` |
| `path` | an executable `omt` exists in a `PATH` directory | none found; skills fall back to manual role resolution, and the message names the install channels of section 14.2 | | |
| `t3` | `t3SettingsPath()` exists | it does not exist | | |
| `homes` | every T3 `claudeAgent` instance that sets `config.homePath` has the skills linked in `<homePath>/skills` | an instance with a `homePath` that lacks the skills; a settings file that cannot be read or is not valid JSON | | no instance sets a `homePath` |
| `roles` | every role resolves (only with `--capabilities`) | some roles are unavailable | the `execute` role is unavailable | |

With `--project`, doctor checks the project scope (section 14.8). It runs `runtime`, `config`, `defaults`, and `harnesses` as above, and `skills`, `links`, and `hooks` against the project paths. It replaces `path` and `homes` with these checks, keeps `t3` and `roles`, and adds `worktree` after `t3`. `worktree` checks the checkout of the current directory, which can be a linked worktree, while the other project checks use the main checkout:

| Id | PASS | WARN | FAIL | INFO |
| --- | --- | --- | --- | --- |
| `shim` | `.omt/bin/omt` is present, carries the signature, is executable, and its recorded runtime and CLI paths exist; for a runner shim, the message names the runner command | the shim is missing or not managed, or its recorded runtime does not exist (the shim falls back to `bun` or `node` on `PATH`) | the shim's recorded CLI path does not exist, or the shim is not executable | |
| `exclude` | the exclude file holds the block of this root | the exclude file has no block for this root, or it holds a block for a root that no longer exists | | no `.git` in the root or a parent directory, or the last install ran with `--no-git-exclude` and there is no block |
| `worktree` | the current checkout's managed setup is current, waits for completion, and every worktree check passes (section 5.11) | setup is missing, invalid, incomplete, blocked, does not wait, or the pnpm store is not `set` (the message then holds the store problem); also a read error | | no setup is needed, or a custom setup waits for completion |

In project scope, every install hint names the running CLI, because `omt` may not be on `PATH` and the shim may be broken. The hint is `"<cliPath>" install --project` in binary mode, `node "<cliPath>" install --project` or `bun "<cliPath>" install --project` in bundle mode, after the runtime that runs the bundle (`runtimeName`), so the hint works with no `node` on `PATH` under Bun, and `bun "<cliPath>" install --project` in source mode. When the CLI runs from a one-shot cache, as it does through a runner shim, the hint is `npx --yes omt3@<version> install --project`, or the `pnpm dlx` or `bunx` form of the shim.

The `hooks` check reads the settings paths from the manifest. With no manifest hook, it looks for a signed entry in `claudeSettingsPath()`. The `homes` check reads `providerInstances` from `t3SettingsPath()` and never writes it. It looks at instances whose `driver` is `claudeAgent`, expands a leading `~`, and accepts a link or a managed copy for each skill. The `roles` check is left out without `--capabilities`. `checkDefaults(loaded)` in `src/install/doctor.ts` builds the `defaults` check, and `checkHarnesses(loaded)` builds the `harnesses` check from the effective `config.harnesses`. After `omt install` applies a plan, it loads the config and prints `note: defaults <message>` when that check is `INFO`. The status set is `PASS`, `WARN`, `FAIL`, and `INFO`. `--json` prints `{ "ok": boolean, "checks": [{ "id", "status", "message" }] }`, where `ok` is false when any check fails. The exit code is 1 when any check fails.

### 14.8 Project scope

`--project` installs into one repository, so the owner can try oh-my-t3 there without touching the global skill roots, the global Claude settings, or `PATH`. The project root is `findProjectRoot(cwd)`. `install`, `uninstall`, and `doctor` with `--project` refuse, with exit 2 and a hint, a root that is the home directory, or whose skill roots, `settings.local.json`, or `.omt` are the user-scope agents root, Claude skills root, `claudeSettingsPath()`, or `configDir()`. That happens in the home directory, or below it when the home directory holds `.git` or `.omt`. Project scope reuses the planning, apply, backup, marker, hash, hook, and manifest rules of sections 14.2 to 14.6, with these paths:

| Item | User scope | Project scope |
| --- | --- | --- |
| Skill copies | `~/.agents/skills/<name>` | `<root>/.agents/skills/<name>` |
| Claude links | `<claudeConfigDir>/skills/<name>` | `<root>/.claude/skills/<name>`, relative link `../../.agents/skills/<name>` |
| Gemini links | optional | none |
| Config | `<configDir>/config.jsonc` (user starter) | `<root>/.omt/config.jsonc` (project starter), plus `.omt/plans/` |
| Hook (`--hooks`) | `<claudeConfigDir>/settings.json` | `<root>/.claude/settings.local.json` |
| Backups | `<configDir>/backups/<stamp>/...` | `<root>/.omt/backups/<stamp>/...` |
| Manifest | `<configDir>/install.json` | `<root>/.omt/install.json` |
| CLI shim | none | `<root>/.omt/bin/omt` |
| Git exclude | none | a managed block in the repository's `info/exclude` |

Skills and links that were in place before the install. A repository can track a setup that `--no-git-exclude` wrote, or hold a copy of a skill that the user made. A skill or link counts as existing when the plan finds it in place (`unchanged` or `update`) and no earlier install of this root created it. The manifest lists the existing skill names and link paths as `existing`, and its `skills` and `links` lists name only the skills and links that an install created or replaced. The block does not list an existing path, so git sees it as before the install. The uninstall keeps an existing skill or link with `keep (existed before the install)`, also with `--force`. So a clone of a committed setup can run `install --project` to get the shim, and `uninstall --project` leaves the tracked setup in place. When the install updates an outdated existing skill, git shows its files as modified, and the uninstall keeps the updated copy. Without a manifest, the uninstall cannot know which paths existed, and it removes every managed skill and link.

`--targets` with `gemini` and `--project` is a usage error (exit 2). Antigravity reads `<root>/.agents/skills` directly. The default targets are `agents,claude`.

Shim inspection rejects text over 65,536 characters. Channel detection rejects CLI paths over 32,768 characters and uses path segments for global install layouts.

The shim is `<root>/.omt/bin/omt`, with mode 0755. Its second line is the signature. Its body depends on the run mode of the CLI that installs it (section 5).

In source mode, the shim runs the recorded `src/cli.ts` with the recorded Bun. When that Bun is gone, it uses `bun` on `PATH`, so a Bun upgrade does not break the shim or the project hook:

```sh
#!/bin/sh
# oh-my-t3code project shim
runtime="<runtimePath>"
cli="<cliPath>"
[ -x "$runtime" ] || runtime=bun
exec "$runtime" "$cli" "$@"
```

In bundle mode, the shim runs the recorded `dist/cli.js` with the recorded runtime, or with `node` on `PATH` when that runtime is gone. In binary mode, it runs the recorded binary. In both modes, the shim runs the fallback lines when the recorded file is gone:

```sh
#!/bin/sh
# oh-my-t3code project shim
runtime="<runtimePath>"
cli="<cliPath>"
if [ -f "$cli" ]; then
  [ -x "$runtime" ] || runtime=node
  exec "$runtime" "$cli" "$@"
fi
<fallback lines>
```

```sh
#!/bin/sh
# oh-my-t3code project shim
cli="<cliPath>"
if [ -x "$cli" ]; then
  exec "$cli" "$@"
fi
<fallback lines>
```

The fallback lines run `<root>/node_modules/.bin/omt`, where `<root>` is two directories above the shim. Without it, they run the first `omt` on `PATH` that is an executable file and not the shim itself (`-ef "$0"`), so `.omt/bin` on `PATH` cannot make the shim call itself. An empty `PATH` entry, also the last one (`PATH=/usr/bin:`), means the current directory. The loop splits `$PATH:`, because field splitting drops a trailing empty field. When neither exists, the shim prints `omt: the omt CLI is not installed; see https://github.com/gabimoncha/oh-my-t3#install` to stderr and exits 127:

```sh
case $0 in */*) root=${0%/*}/../.. ;; *) root=../.. ;; esac
if [ -x "$root/node_modules/.bin/omt" ]; then
  exec "$root/node_modules/.bin/omt" "$@"
fi
IFS=:
set -f
dirs="$PATH:"
for dir in $dirs; do
  if [ -f "${dir:-.}/omt" ] && [ -x "${dir:-.}/omt" ] && [ ! "${dir:-.}/omt" -ef "$0" ]; then
    exec "${dir:-.}/omt" "$@"
  fi
done
echo "omt: the omt CLI is not installed; see https://github.com/gabimoncha/oh-my-t3#install" >&2
exit 127
```

A project install from a one-shot runner cache (section 14.2) writes a runner shim. The shim calls the same runner with the pinned version, so a cleared cache does not break the project. After a cache clean, the runner needs the network to download the package again:

```sh
#!/bin/sh
# oh-my-t3code project shim
exec npx --yes omt3@<version> "$@"
```

The last line is `exec npx --yes omt3@<version> "$@"`, `exec pnpm dlx omt3@<version> "$@"`, or `exec bunx omt3@<version> "$@"`. The cache path names the runner. When it does not, as for `<temp>/dlx-<pid>`, `npm_config_user_agent` names it: `npm/` for npx, `pnpm/` for pnpm, and `bun/` for bunx. Otherwise the runner is npx. A version that holds a character other than a letter, a digit, `.`, `+`, or `-` is refused. After a run that writes a runner shim, the install prints `note: .omt/bin/omt runs <runner command>, which needs the network again after its cache is cleared`.

A shim that an earlier omt wrote, in the Node format below, still counts as managed. `install` updates it, `doctor` reads its node and CLI paths, and `uninstall` removes it:

```sh
#!/bin/sh
# oh-my-t3code project shim
node="<nodePath>"
[ -x "$node" ] || node=node
exec "$node" "<cliPath>" "$@"
```

The shim is `create` (absent), `update` (managed, different content), `unchanged`, or `conflict` (a path without the signature). With `--force`, a conflict becomes `replace`, and the old file moves to `<root>/.omt/backups/<stamp>/bin/omt`. The check of section 14.2 decides whether `--project` may run from a one-shot cache or a temp directory. A runtime or CLI path that contains `"`, `$`, a backquote, a backslash, or a newline is refused.

`.omt/.gitignore` holds the lines `ledger.jsonl`, `evidence/`, `bin/`, `install.json`, `backups/`, `plans/`, `locks/`, `guardrails.md`, and `grills/`. When the file is missing, the install creates it with these lines. A dangling symlink at that path is the user's, the same as a dangling settings link: the install leaves it alone, with `keep (a dangling symlink; left alone)`, and never writes its target. With the git exclude step on, the install never edits an existing `.omt/.gitignore`, because the repository may track it. One exception upgrades an unedited file: when the previous manifest lists the file in `project.files` and the file's SHA-256 equals the recorded hash, an earlier install created it and nobody edited it. Then the install appends the missing lines, the plan shows `update` for the file, and the manifest records the new hash. With `--no-git-exclude`, a setup meant to be committed, the install appends the missing lines and never removes a line. The manifest then records the file's old content and the hash of what the install wrote, as `gitignoreRestore`, and the uninstall writes the old content back while the file still has that hash.

The git exclude step is on by default. `--no-git-exclude` turns it off: the install writes no block, removes a block that an earlier install wrote for this root (the plan shows `remove managed block in <file>  (--no-git-exclude)`), and the manifest records `"gitExcludeOff": true`. The installer finds the exclude file without running git:

- Walk up from the root to the nearest directory `<top>` that holds `.git`. `<top>` is the repository top level, which is the root itself or a parent of it (a package in a monorepo).
- When `<top>/.git` is a directory, the file is `<top>/.git/info/exclude`.
- When `<top>/.git` is a file with a `gitdir: <path>` line (a worktree), the git directory is that path, resolved from `<top>`. When the git directory holds a `commondir` file, the common directory is its content, resolved from the git directory; otherwise it is the git directory. The file is `<common dir>/info/exclude`.
- When no `.git` is found, the step is skipped. The plan shows `skip` with the reason, and the install prints a `note:` line.

Each entry is anchored at `<top>`: the root's path relative to `<top>` prefixes it, as in `/pkg/.agents/skills/omt/`. A backslash goes before each `\`, `[`, `]`, `*`, and `?` in that path, and before a trailing space, so git reads the path literally. An entry starts with `/`, so a leading `!` or `#` cannot occur.

Worktrees share one exclude file, so each root has its own block, with the root in both markers. The install replaces the block of its root in place, and every other line of the file stays unchanged. A new block goes at the end of the file:

```text
# >>> oh-my-t3code project install: <root> >>>
/.agents/skills/<name>/
/.claude/skills/<name>
/.agents/.omt-*/
/.omt/bin/
/.omt/install.json
/.omt/backups/
/.omt/config.jsonc
/.omt/.gitignore
/.claude/settings.local.json
# <<< oh-my-t3code project install: <root> <<<
```

The block runs from a BEGIN marker of the root to the next END marker of the root. A BEGIN marker without an END marker after it is no block: the install appends a new block, and no edit ever deletes to the end of the file.

The block always lists each skill copy and each link that the manifest records, except the existing ones, the scratch directories `/.agents/.omt-*/` of section 14.3, then `/.omt/bin/`, `/.omt/install.json`, and `/.omt/backups/`. It also lists each file that an install created: `/.omt/config.jsonc`, `/.omt/.gitignore`, and `/.claude/settings.local.json`. It lists no directory that only holds those entries, such as `/.omt/` or `/.omt/plans/`, because git never shows an empty directory. So a new file in `.omt/` of another worktree shows in git. A plan in `.omt/plans/` does not, because `.omt/.gitignore` holds `plans/`.

So after `install --project`, with or without `--hooks`, `git status --porcelain` shows nothing new. The one exception is a `settings.local.json` that the repository tracks: it shows as modified while the hook is installed. The manifest records what an install created, so a later run keeps the same block.

Git applies the common exclude file to every worktree, with each entry anchored at that worktree's top level. So the block of one worktree also hides the same paths in the other worktrees, such as a `.omt/config.jsonc` that the user creates there. In a repository with worktrees, the plan marks the step `(shared by all worktrees)`. A repository has one project install, in the main checkout. Because `findProjectRoot` resolves a linked worktree to its main checkout (section 4), `install`, `uninstall`, and `doctor` with `--project` in a worktree act on the main checkout. A second install from another worktree is an idempotent rerun. The skill folders stay in the main checkout, so a harness finds them in a worktree only if it reads the skill folders of the main checkout.

Stale blocks. Install and uninstall also replace or remove a block that belongs to no live project:

- the block of another spelling of the same root, a path whose real path equals the root's real path (a symlink, or `/tmp` and `/private/tmp`);
- the block of a root that no longer exists, such as a removed worktree or a moved clone;
- the block of the root that the manifest names, when it differs from the current root (a copied or moved project), and that root keeps no install of its own in this exclude file.

Doctor warns about a block whose root no longer exists.

The manifest records how the install changed the exclude file, as `excludeFile`: `created` (the file was missing), `dirCreated` (its `info/` directory was missing), and `addedNewline` (the install added a final newline before it appended the block). When the uninstall removes the last block, it removes that newline again, deletes a file that the install created and that is then empty, and removes an `info/` directory that the install created when it is empty. When the exclude file already holds the block of another root, such as another worktree, the install copies `excludeFile` from the manifest of that root, when that manifest names the same exclude file. Every root then holds the facts of the first install, so whichever root removes the last block undoes them. So the exclude file gets its exact bytes back, in any uninstall order.

When the install makes a backup in `<root>/.omt/backups/`, it also writes `<root>/.omt/backups/.gitignore` with the single line `*` when that file is missing, so a backup never shows in git, even after an uninstall. A run that makes no backup does not write it. The uninstall writes it too when it makes a backup.

`settingsCreated` is true only when nothing was at the settings path, so a dangling symlink there stays the user's: the block does not list it, and the uninstall keeps the link (section 14.6).

Write order: the install writes the exclude block first, then a provisional manifest that lists what the run will create (the `dirs`, the `files` with their planned hashes, including `.omt/backups/.gitignore` when the run will make a backup, `omtDirCreated`, and `settingsCreated`), and only then any other path. At the end it rewrites the manifest with what it did create. So a run that fails midway leaves no file that git shows or that the next run takes for the user's. When the exclude write fails, the install stops before any other write, and the hint names `--no-git-exclude`. The uninstall uses the mirror order: it changes the exclude block last, after every delete and after the manifest. A delete that fails stops the run with an error that names the path and says to run the command again; the block still hides every path that stays, and the next run finishes the work.

The exclude file can be a symlink to Git storage outside the project. Project `.omt/.gitignore` and hook settings can be symlinks only when a write resolves inside the project. Planning checks the destination, and apply checks it again before mutation. A repository manifest hash does not authorize an external destination. Each authorized write goes to the real path, so the link stays a link. When the exact-bytes rule would delete a file that the install created and that is now a symlink, the uninstall writes the empty content to the target and keeps the link. Install and uninstall in project scope first delete the scratch directories `<root>/.agents/.omt-tmp-*` and `.omt-old-*` that an interrupted run left; the plan lists each one as `remove <path>  (left by an interrupted run)`.

The manifest adds `"scope": "project"`, `"root": "<root>"`, and:

```json
"project": {
  "omtDirCreated": true,
  "settingsCreated": true,
  "shim": "<shim path>",
  "gitExclude": "<exclude path>",
  "excludeFile": { "created": false, "dirCreated": false, "addedNewline": false },
  "existing": { "skills": ["omt"], "links": ["<root>/.claude/skills/omt"] },
  "files": [{ "path": "<root>/.omt/config.jsonc", "sha256": "<hash of the content the install wrote>" }],
  "dirs": ["<root>/.omt", "<root>/.omt/plans", "<root>/.agents", "<root>/.agents/skills", "<root>/.claude", "<root>/.claude/skills"]
}
```

`files` lists `.omt/config.jsonc`, `.omt/.gitignore`, and `.omt/backups/.gitignore` when an install created them. `dirs` lists each of `.omt`, `.omt/plans`, `.omt/bin`, `.omt/backups`, `.agents`, `.agents/skills`, `.claude`, and `.claude/skills` that was absent before an install and present after it. A later run merges both lists into the old ones. `gitExcludeOff` and `gitignoreRestore` are present only after a `--no-git-exclude` install. `existing` is present only when an install found an existing skill or link.

Every command reads a project manifest relative to the current root. Each recorded path inside the recorded `root` maps to the same relative path under the current root, and each recorded path outside it is dropped. Then only the paths that a project install writes stay: `skillsRoot` only when it is `<root>/.agents/skills`, skill names and link names that are one path segment, links and `existing` links directly in `<root>/.claude/skills`, the config only at `<root>/.omt/config.jsonc`, the shim only at `<root>/.omt/bin/omt`, hooks only for `<root>/.claude/settings.local.json`, hook `backup` and `backups` paths only under `<root>/.omt/backups/`, `files` only for `.omt/.gitignore`, `.omt/config.jsonc`, and `.omt/backups/.gitignore`, and `dirs` only for the directories that the `dirs` list below names. So a copied or moved clone, or a manifest that the repository tracks or that someone copied in, never makes a run act on another project, on the user install, or on a project file that no install writes. The exclude file always comes from the current root.

`omt uninstall --project` follows section 14.6 with the project paths, and also:

- It removes the shim when it carries the signature, and the manifest.
- It keeps each existing skill and link (see above). It removes only the links whose real target is a directory in `<root>/.agents/skills`, so a link to the user install, such as `<root>/.claude/skills/x -> ~/.agents/skills/x`, stays.
- It removes the hook entry from `settings.local.json`, with the exact-restore rule of section 14.6. When an install created that file and only `{}` is left, it deletes the file without a backup.
- It rewrites the root's exclude block with only the paths that stay: each kept skill and its kept link (not an existing one), each kept file that an install created, an edited config that an install created, a `settings.local.json` that an install created and that stays because other keys are left in it (Claude Code writes permissions there), and the manifest when it stays. It removes the block when nothing stays, with the exact-bytes rule above, and it removes stale blocks.
- It removes each file in the manifest `files` list while its SHA-256 equals the recorded hash. A created `.omt/.gitignore` that was edited stays, with `keep (edited after the install)`. A created `.omt/.gitignore` also stays while `.omt/ledger.jsonl` or `.omt/evidence/` exists, with `keep (keeps the ledger and evidence that stay out of git)`, and the reduced block hides it.
- With `gitignoreRestore`, it writes the old `.omt/.gitignore` back while the file still has the recorded hash, with `update (removes the lines that the install added)`. A created `.omt/config.jsonc` that was edited stays with `keep (edited after the install; add --purge to remove it)`, and `--purge` removes it. A config that no install created stays, with `keep (not created by omt install)`, also with `--purge`.
- It removes `.omt/backups/.gitignore` when an install created it, it still holds what the install wrote, and it is the last file in `.omt/backups/`.
- Then it removes each directory in the manifest `dirs` list when it is empty, in this order: `.omt/bin/`, `.omt/backups/`, `.omt/plans/`, `.agents/skills/`, `.agents/`, `.claude/skills/`, `.claude/`, `.omt/`. It never removes a directory that an install did not create, even an empty `.omt/bin/` or `.omt/backups/`.
- It never removes the plans, the ledger, the evidence, or a backup other than the install-time backup that an exact restore wrote back.
- When it keeps a locally modified skill, it keeps the manifest too, with `keep (a locally modified skill is kept)`, so that a later `uninstall --project --force` still knows the created directories.
- When a file that an install created stays (a kept `.omt/.gitignore`, an edited created config, or a created `settings.local.json` with other keys left in it), it rewrites the manifest as a reduced manifest, with `keep (records the created files that stay)`. The reduced manifest lists no skill, link, hook, or backup. Its `files` lists the kept created files, `config` stays only for a kept created config, `settingsCreated` is true only while that settings file stays, and `omtDirCreated`, `gitExclude`, `excludeFile`, `existing`, and `dirs` stay as recorded. So a later install still counts these files as created and keeps their block entries, and a later uninstall keeps the same reduced block and every existing skill and link. When no created file stays, the uninstall removes the reduced manifest and the block. When the repository's exclude file holds no block of the root, as after a `--no-git-exclude` install, no block can hide a reduced manifest, so the uninstall removes the manifest. The kept files then count as the user's.
- It removes every hook entry that has the omt signature (section 14.6), also one that was in the settings file before the install, such as a tracked `settings.local.json` that holds the entry of another clone. Such a file shows as modified in git after the uninstall.

So the project tree after `uninstall --project`, and the exclude file, are byte for byte as before the install, apart from data that the user created meanwhile (plans, ledger, evidence), what keeps that data out of git (`.omt/.gitignore` and a reduced block), the reduced manifest that records the created files that stay, the exception for an omt entry that was in the settings file before the install, and an existing skill that the install updated. A file that the user edited stays, with its block entry. A backup that the uninstall could not restore exactly stays in `.omt/backups/`, hidden from git by its `.gitignore`. A path that `install --force` replaced stays in `.omt/backups/<stamp>/` too, and the uninstall does not move it back. Git does not show it there, so a replaced path that git showed before the install is gone from `git status`.

Project list. `omt install --project` adds the root to `projectsPath()` (section 4) after a successful apply, also when it prints `Everything is up to date.`, and never with `--dry-run` or after a refusal. `omt uninstall --project` removes the root after an applied uninstall. `omt update` reads the list to sync each project (section 5.14). On its apply path, it adds the current root when `<root>/.omt/install.json` exists, and removes each root whose folder or project manifest is gone. `src/install/projects.ts` exports `readProjects(path)`, `addProject(path, root, now)`, and `removeProjects(path, roots)`. The file is `{ "version": 1, "projects": [{ "root": "<root>", "addedAt": "<ISO timestamp>" }] }`, written with `writeFileAtomic`. `addProject` dedupes roots by real path. An absent file is an empty list. A file that is not valid JSON is the `projects_invalid` error, with a hint to delete the file.

`addProject` and `removeProjects` read and write the list under a lock, `<path>.lock`. The lock is a directory that holds one empty file, named after a random token of its owner. omt builds the directory under a temp name and renames it to `<path>.lock`, so the directory and the token file appear at the same time. While another owner holds the lock, omt tries again with a backoff from 10 ms to 200 ms, for at most 5 seconds. A token file older than 30 seconds is stale, and omt removes it and the empty directory. After 5 seconds, it is the `projects_locked` error, with the hint `another omt command is updating <path>; run the command again`. The owner removes only its own token file and then the empty directory.

Install and uninstall have already changed the project files when they edit the list. So a `projects_invalid` or `projects_locked` error prints `warning: <message>` and `hint: <hint>` on stderr, and the command keeps its normal output and exit code.

User scope and project scope never read or write each other's files, except the project list: `install --project` and `uninstall --project` edit it, and `omt update` reads it and syncs each recorded project.

## 15. Skills

### 15.1 Common rules

- Each skill is `skills/<name>/SKILL.md` with YAML frontmatter. `name` equals the directory name. `description` is at most 1,024 characters.
- A user-invoked skill sets `disable-model-invocation: true` (read by Claude, Cursor, and Pi). It also ships `agents/openai.yaml`, because Codex reads that file instead:

  ```yaml
  interface:
    display_name: "<Display name>"
    short_description: "<one line>"
  policy:
    allow_implicit_invocation: false
  ```

- Skills call the CLI as `omt` on `PATH`. A global install puts it there: `npm i -g oh-my-t3`, `pnpm add -g oh-my-t3`, `bun add -g oh-my-t3`, or `mise use -g github:gabimoncha/oh-my-t3`. When `command -v omt` finds nothing, a skill uses `.omt/bin/omt` from the project root, which `omt install --project` creates, also from a dev dependency or from a one-shot run such as `npx omt3 install --project`. When that file is missing, as in a linked worktree, a skill uses the shim of the main checkout, `"$(git rev-parse --path-format=absolute --git-common-dir)/../.omt/bin/omt"`. Without any of them, a skill falls back to the manual steps in `roles.md` and `brief.md`. The rule lives in the section "The CLI" of `skills/omt/references/delegation.md`. A shim from a one-shot run calls its runner (`npx`, `pnpm dlx`, or `bunx`) with the pinned version, and the runner needs the network again after its cache is cleared. Skills never call a runner themselves.
- Skills name T3 tools by their base names (`delegate_task`, `task_status`). The first skill text that names a tool says that harnesses may add a prefix, such as `mcp__t3-code__delegate_task`.
- Shared reference lives in `skills/omt/references/`. Other skills link to it with relative paths such as `../omt/references/delegation.md`.
- Every relative link in a skill must resolve to a file in the repository. A test checks this.
- Write for agents. Front-load the trigger words in each description. Give each step a completion criterion. State the target behavior instead of a ban where possible.
- On git actions, reply style, tests, and model choice, the user's own instructions win over omt defaults: the user's message first, then the user's `AGENTS.md` or `CLAUDE.md`. omt owns the workflow steps. The rule lives in the section "User instructions win" of `skills/omt/references/delegation.md`, which every workflow skill reads first, and the router `skills/omt/SKILL.md` repeats it.
- Git actions follow the `workflow.git` policy, which is the owner's standing approval for each action that it marks `auto`. The policy acts with no question only on the user's own work. Before each commit, push, PR, or merge, a skill runs `omt git check <action> --json` with `--plan <slug>`, or with `--profile <profile>` in a run with no plan file (section 5.15). Once per run, it reads the `host` field of a first check and the login from `gh api --hostname <host> user -q .login`, and asks the owner when either is missing. It passes `--user <login> --host <host>`, names the checked repo in each `gh` PR command with `--repo <host>/<owner>/<repo>` from the check, never from an existing `GH_REPO` environment value or the current folder, and, for each action, `merge` too, lists every open PR from the branch with `gh pr list --repo <host>/<owner>/<repo> --head <branch> --state open --json number,author,headRefName,headRepositoryOwner,url --limit 100` and keeps the PRs whose `headRefName` is the current branch and whose `headRepositoryOwner` is the checked owner. It passes `--pr-author` with any kept PR's author that is not the user, else with the user when the user wrote all kept PRs, and no `--pr-author` when none is kept. It asks when the command fails or returns 100 PRs. The list covers open PRs in the checked repo only, so a PR that another person opens from the user's branch into another repo, such as an upstream repo, gives no `ask`, and a push to the branch also updates that PR. `omt-code-review` passes the reviewed PR's author and also applies this list rule to the PR's head branch. It pushes only with `git push origin HEAD:<branch>`, never to another remote. It acts on `auto`, asks the owner on `ask`, and skips the action and reports it on `off`. A check that exits non-zero or prints no decision counts as `ask`. Before the run's first edit task, it saves the `git status --porcelain` output. At commit time, it stages only the paths that the run changed and that the saved output does not name. It commits only those paths with `git commit --only -m <message> -- <paths>`, after `git commit --dry-run --porcelain --only -- <paths>` shows that the commit takes no other path, so that changes that another session staged stay out of the commit. For a path that the saved output names, or when the output is missing or the run's changes are unclear, it asks the owner. It opens a ready PR only in the `origin` repo (`gh pr create --repo <host>/<owner>/<repo>`), against the given base or else the `defaultBranch` field of `omt git check pr --json`, asks the owner for the base when that field is `null`, and lets the push update an open PR. A PR to a repo of another owner asks. A force push always asks, a `plan`-mode run makes no git action, and children never commit. When a PR would change more files than the `maxPrFiles` field of `omt git check pr --json`, the skill cuts the branch's commits into slices of at most that many files, without rewriting them, opens one PR per slice against the slice below it, and links them with `gh stack link`. Without `gh stack`, or when no cut fits, it asks the owner. The rules live in the sections "Git actions" and "Stacked PRs" of `delegation.md`.

### 15.2 Skill list

| Skill | Invocation | Purpose |
| --- | --- | --- |
| `omt` | user | Router. Lists the omt workflows, when to use each, and the shared references. |
| `omt-ulw` | model | Ultrawork build flow: mode and branch check, question or goal, explore, frame, ask question batches, plan, design check, build in the main thread, one review child, the fix diff and fixes, one QA child, failed-check fixes, ship and report. Trigger words: ulw, ultrawork, build or fix with subagents in T3. |
| `omt-plan` | model | Plan only, also when `omt-ulw` calls it: explore in the main thread, ask owner question batches, write the plan and approved test list with `## Summary` last, review by `plan.review` with 1 `plan-review` child and at most 2 rounds, and show the summary. |
| `omt-grill` | model | Test a goal before its plan: find the facts in the main thread, get one second opinion from 1 `grill` child on the other family, ask the user question batches with decisions, questions, and edge cases, check each answer against the facts, and write the grill file that `omt-plan` reads. Trigger words: grill, stress-test, edge cases, brainstorm, vague goal, before a plan. |
| `omt-design` | model | Draw `design.variants` options per screen in a new Paper file, in the main thread on Claude Opus or in 1 routed `design` child otherwise, show screenshots by screen, apply owner steering until approval, write `docs/design/<slug>.md` in the main thread, and build the screens in the same thread on request. |
| `omt-code-review` | model | Review uncommitted changes, a branch, a commit, or a PR with report-only children awaited in the turn: 1 reviewer for a small diff, or 2 to 4 grouped reviewers and 1 oracle over the whole change for a large diff. The main thread merges the findings and makes every approved fix. The profile controls group count, families, oracle, and offers. PRs use the eleven steps in section 15.4. |
| `omt-research` | model | A cited answer: the main thread answers a narrow question itself, and a broad question gets 2 to 4 parallel read-only children whose claims the main thread checks. |
| `omt-swarm` | user | Build one plan as parallel tracks: split the plan units into tracks with disjoint scopes, launch each track in its own worktree thread with `t3_thread_launch`, wait with `t3_thread_wait`, run 1 `review` child over all track diffs before the merge, merge the track branches, run 1 `qa` child on the merged code, and open one PR. Invoking it is the explicit user request that T3 requires for new threads. |
| `omt-help` | model | Help and a short tour. Read-only: it maps a question to a workflow skill, a CLI command, or a config change, grounds each answer in the output of read commands (`omt --help`, `omt doctor --project --dry-run`, `omt roles`, `omt detect`, and others), links the docs on GitHub, and hands every write to `omt-setup`. |
| `omt-setup` | model | Set up, configure, or update omt through the CLI: the doctor check, the harnesses (`omt detect`, with `--capabilities` in a T3 thread), defaults review (`omt doctor`), worktree setup, profile and role edits, and an update. It shows each command or edit first, runs `--dry-run` where the command has it, and passes `--yes` only after the user agrees. |

Rules that the skills must carry:

- `omt-ulw` runs the full build flow for every task. The main thread explores, asks question batches, plans, builds every unit, writes the planned tests, and fixes. Children review and test: one review child (step 8) and one QA child (step 10) check the work. A LIGHT run skips the plan review and the owner approval of the plan, but it still has the review child and the QA child. `omt plan new <slug> --light` creates the LIGHT plan, and `omt-plan` writes and reviews the HEAVY plan, which the owner approves. A large unit with a disjoint scope may go to an `execute` child, to a `ui` child for a `ui` unit, or to a `writing` child for a `writing` unit, as an independent track. A `ui` unit is built by the main thread when it runs Claude Opus, and by a `ui` child otherwise, with the configured role fallbacks. An approved design spec is optional. When one exists, the unit follows it. Otherwise it implements the task requirements directly, with Anthropic's optional `frontend-design` skill when available. A design pass runs first only when the user requests one. The main thread records every child dispatch and result in the ledger.
- Before each dispatch with a plan file, the main thread runs `omt ledger stats --plan <slug>` and requires `can dispatch: yes`, which compares `active` with `maxParallel`. Without a plan file and with a selected run profile, it compares ledger `active` with that profile's `maxParallel`. `ledger stats` has no `--profile` flag. This comparison also applies to ledger-only review and design ids. Without the CLI, it counts tasks itself. No skill sets or checks a task budget.
- Only `qa` drives a device, a Simulator UI, a browser, or a computer. The main thread drives no device. Every other child lists each device check, with its steps and expected result, for the main thread to send to `qa`. The default `qa` chain tries Sol at medium effort, then Sonnet at low effort. A local-tool `INCONCLUSIVE` result gets one retry on the next rung of another provider, with a higher attempt. After that retry, the workflow fixes or stops.
- `omt-ulw` review child (step 8): the `review` role, built with `--against <main thread driver>` from the step 0 `modelSelection`, so it runs on the other family. When `build.oracle` requires the oracle for the run's tier, the review child uses the `oracle` role with unit `F2` instead, also when `build.review` is `off`, so no extra thread runs. Its context is the objective, the done conditions, the plan `## Summary`, and the scope paths, never the main thread's history. It fixes each local finding itself, a clear fix inside the changed files that agrees with the plan Summary, when its Access line allows edits. It reports every other finding, and it lists its fixes with their paths under `FIXES`. The main thread reads the fix diff of those paths before QA starts, and review and QA never run at the same time. `build.review: first-round` runs one review, `every-round` runs one more review after the main thread fixes the reported findings, up to `maxReviewRounds` reviews, and `off` runs none. Open findings after the last review go to the owner.
- `omt-ulw` QA child (step 10): one `qa` child runs every verify command, the final checks, and the device flows. It edits nothing and writes no tests. It returns each command with its exit code and a log path, and screenshot paths for device flows. The main thread reads only the exit codes and the last lines of the failed logs. It fixes each failed check, and QA runs only the failed checks again, with at most 2 re-runs; then the main thread stops and asks the owner. `build.qa: planned` makes the main thread write the plan's approved `## Tests` lines during the build, and `off` leaves `## Tests` empty. With `build.failureProofs: on`, the main thread proves each new test fails without the change, in a private copy of the working tree.
- The `omt-ulw` main thread asks every open owner question in one batch, with 2 to 4 options and a recommendation each, and asks the next batch after the answers until no question is open. A question that the code can answer is not an owner question. Later status messages do not repeat open questions.
- A brief for a role in `plan` interaction mode carries the plan-mode line (section 9.2). When a summary is `Child task completed without an assistant result.`, the main thread reads the child with `t3_thread_read` (view `messages`, which includes proposed plans) before it re-dispatches.
- The main thread waits for its children inside its turn. For one child it calls `delegate_task` with `mode: "wait"` and a `timeoutMs` of at most 3,600,000. For parallel children it dispatches each with `mode: "async"`, then calls `t3_thread_wait` with `threadId` and `runId` for each, then `task_status` for each. On `waitTimedOut: true`, it waits again or reads `task_status`. A turn ends only for the owner: a batch of questions, a plan approval, or the report. No skill starts a heartbeat or calls `schedule_task` to wait. A later wake that names tasks it already read needs no action.
- The main thread settles each child that it started with `delegate_task` right after it reads the final result with `task_status` and records it. In `plan` interaction mode it records nothing and settles all the same; after `task_cancel` it settles after the `cancelled` or `interrupted` entry; after a `mode: "wait"` return it calls `task_status` first. It calls `t3_thread_organize` with `action: "settle"` and `threadId` set to the `childThreadId`, never the `taskId`, when `status` is `completed`, `failed`, `cancelled`, or `interrupted`, `hasPendingChildRuns` and `hasPendingQuestion` are `false`, and it will not send that child a message with `t3_thread_send` (a new task for the same unit is not such a message). When a condition is false or the settle returns an error, it does not cancel the child. A settle error never stops the run and never triggers a Failure codes action. Before the first settle of a run, the main thread runs `git rev-parse --git-dir --git-common-dir`; when it prints two different paths, the main thread works in a git worktree and settles no child in that run. T3 runs the project's settle script, also one inherited from T3 settings, in a settled thread's worktree, a non-isolated child shares the main thread's worktree, and a thread in the main checkout runs no settle script (`ThreadSettlementService` `cleanUpSettledThread`). A settle sweep catches what the per-result settle missed. The main thread runs it after a skipped or failed settle, after each `task_cancel`, before it stops the run to ask the owner, and before its final report; a skill that another skill called leaves the sweep to the caller. The sweep starts from tasks, not threads: it reads its task ids from `omt ledger list --plan <slug> --json`, or the ids it kept in `plan` mode, calls `task_status` for each, and skips an id that returns `task_not_found` (another thread's task, not a lost task). A child is done when the per-result condition holds; a thread that shows `completed` can still wait for its own children, so the thread status alone is not enough. Then it pages `t3_thread_list` with `includeSubagents: true`, following `nextCursor` until it is `null`, settles each done child whose thread shows `settled: false`, and settles each finished thread below a done child, linked by `relationshipToParent: "subagent"`, that shows `settled: false`. Starting from task ids keeps forks and other threads out. The main thread settles only its children and their children: never its own thread, a top-level thread, or any other thread, and never with `archive`. A child that may start children gets the brief's children line and settles its own children; the sweep covers the children of a cancelled or failed child. A later task neither uses processes that an earlier child left running nor counts on them being gone, because a settle ends them only when the provider closes the thread (Codex after its unload delay). `omt-plan` explore and `plan-review` tasks follow the same rules. Measured on 2026-10-17: T3 sent `thread/unsubscribe` 3 ms after the settle of a delegated Codex child, and a settle unsubscribed a Codex thread and its native subagents within 4 ms; a delegated child settled its own Codex child, which was unsubscribed 2 ms later; a settled Claude child's process and a settled Cursor child's MCP servers exited within 10 seconds. Without a settle, each finished child stayed loaded for 30 idle minutes, a Codex thread then for the Codex unload delay, and the Codex native subagents of an idle parent until the app-server stopped.
- The `omt` router lists `omt worktree check` and `omt worktree setup` and links `worktrees.md`. `omt-ulw` step 0 and the section "Worktree setup" of `delegation.md` point to `worktrees.md` for the first run in a project. No skill runs the worktree check before every CLI command. `docs/agents/quickstart.md` runs the check before it reports the install as complete.
- `interaction_mode_escalation_denied` and `runtime_mode_escalation_denied` are stop codes: report them and do not fall back. `provider_unavailable`, `model_unavailable`, and an `invalid_request` about options move to the next rung with the next attempt number.
- On `provider_unavailable` for a target that names only `driverKind`, the skill first retries that target once, with the next attempt number and `providerInstanceId` in place of `driverKind`, set to the same value. The target is the one that failed, rung 1 or a fallback, so the skill keeps it until the retry is sent. Observed T3 behavior is the reason. T3 checks a named provider instance again before it refuses it, but it takes a `driverKind`-only target from a cached provider snapshot that can be stale.
- `omt-swarm` takes a plan file from `omt-plan`, or from `omt-grill` and then `omt-plan`; with no plan it tells the user to run `omt-plan` first and stops. It asks no question batches and runs no plan review. Its step 0 checks with `t3_thread_configure` that the caller runs in `full-access` runtime mode and `default` interaction mode, which `t3_thread_launch` requires, and that the caller is on a feature branch. The main thread splits the plan units into at most `maxParallel` tracks with disjoint scopes and does not build. Each track gets a plan `<slug>-<track>` created with `--light --profile <profile>` from the parent plan. It copies its units, approved tests, applicable done conditions and final checks, and approved design references. The track tier follows the `omt-ulw` LIGHT/HEAVY rule, and the main thread runs `omt plan limit <slug>-<track> <k>` with a lower `<k>` instead of changing `limits` in the config, because all worktrees share one `.omt/`. Each track is a top-level thread, not a delegated child, launched with `t3_thread_launch` in its own worktree on branch `omt/<slug>/<track>` from the base commit. Its launch message does not use `omt brief`. It tells the track to read its own modes and model selection, its plan, tier, and effective profile, then apply the `F2` rule and design check before `omt-ulw` steps 7 to 12 for its units only, with its own review and QA children, and to commit on its branch by the git rules of section 15.1 with no push and no PR. The main thread waits for each track inside its turn with `t3_thread_wait` and `untilDelegatedWorkSettled: true`, with no `schedule_task` heartbeat, and records each track in the ledger with role `swarm`. Before the merge, 1 `review` child on the other family reviews each track diff (`git diff <base>...<track branch>`) against the plan Summary, fixes local findings uncommitted in the track worktrees, and reports the rest. The main thread reads each fix diff with `git -C <track worktree> diff`, commits the accepted fixes on the track branch, and fixes the kept findings itself, or sends a finding that needs deep knowledge of one track to that track with `t3_thread_send` and waits. The main thread merges the track branches into its branch after `omt git check merge` allows each merge, and resolves conflicts; a conflict that needs deep knowledge of one track goes to that track with `t3_thread_send`. Then 1 `qa` child runs every check and device flow of the plan on the merged code and edits nothing. The main thread fixes failures, and QA re-runs only the failed checks, at most 2 re-runs, before the owner gets the failures. The main thread then commits, pushes, and opens or updates one PR by the git rules, links it, and reports each done condition with evidence and each track's result. It never settles a track thread.
- Plain `omt-setup` runs check whether Anthropic's optional `frontend-design` skill is available and recommend installing the official skill when missing. Setup never installs it without the user's request. A missing skill does not block setup or UI work. The shared reference `skills/omt/references/frontend-design.md` defines the availability check, design use, and direct UI use. UI implementation from an approved spec does not need to load that skill again.
- `omt-ulw`, `omt-plan`, `omt-grill`, `omt-design`, `omt-code-review`, and `omt-research` start with a step 0 that calls `t3_thread_configure` with no arguments and reads `interactionMode`. In `plan` mode they dispatch only children in `plan` interaction mode: read-only roles, and `review` or `oracle` tasks with `interactionMode: "plan"` set in `delegateTask` (the defaults makes those two edit roles). They write no files, and deliver the result in the final message, or ask the user to switch to default mode. No skill calls `orchestrator_capabilities` to read its modes, because that result holds the full provider and model catalog.
- Step 0 of `omt-ulw` and `omt-plan` also links to the branch check in `delegation.md`. It finds the default branch from the repository metadata (`refs/remotes/origin/HEAD`, then `init.defaultBranch` when that branch exists, then `main` or `master`) and keeps its full ref as `<default>` (`refs/remotes/origin/<name>`, or `refs/heads/<name>` for a local result), so that a tag with the same name cannot match. It counts `git rev-list --count HEAD..<default>`. When the count is above 0, `plan` mode only reports it. `default` mode runs `git merge --ff-only <default>` when the worktree is clean and `HEAD` is an ancestor of the default branch; otherwise it reports the count and asks the user. When no default branch is found, the skill skips the check and says so.
- `omt-plan` finishes independent research and a draft plan before it asks all open owner decisions in one batch, with 2 to 4 options and a recommendation each, and asks the next batch after the answers until no question is open. The first batch includes the proposed `## Tests` lines and reasons for layers outside `plan.testLayers`. Each research question, answer, and source goes under `## Research`. It names shared resources and wraps verify commands with `omt lock run <resource> -- <command>`. It runs `omt plan limit <slug> 1` only for shared build state without `flock` or `lockf`, or for commands that leave processes running after exit. Those commands run outside the lock. Edit and hash the absolute plan path from `omt plan status`. Compute the hash after every edit, including header changes, before the next brief.
- Every plan has a `## Summary` of at most 15 lines for the owner, in plain words with no `path:line` citations and no code blocks. The planning standard (`skills/omt/references/planning.md`) puts it last, and `omt-plan` step 3 updates it after each review fix. The `plan-review` persona blocks a summary line that the rest of the plan does not support. `omt-ulw` fills it last in a LIGHT plan too.
- `omt-plan` step 5 shows the plan before it hands off, also when `omt-ulw` called it. The reply holds the `## Summary` text in full, the plan path, the review result, and each open decision.
- `omt-ulw` selects the slug and effective profile before the first explore brief in step 2. Before a plan exists, it compares ledger `active` with that profile's `maxParallel`.
- `omt-ulw` step 7 builds the units in the order of the `ready:` line of `omt plan status <slug>`. The role of a unit that the main thread builds is `main`.
- Skills write and name evidence files in the directory that `omt paths --evidence` prints, never under a path relative to `.omt/evidence/`, so a worktree uses the shared evidence directory.
- Skills tick plan items with `omt plan mark` and create LIGHT plans with `omt plan new <slug> --light`. They record a dispatch with `--task-id`, `--provider`, and `--model`, and the result with the same plan, unit, role, round, and attempt, without the task id. `--provider` is `target.providerInstanceId`, or `target.driverKind` when the target has no instance id, and `--model` is `target.model`, both from the target of the `delegate_task` call that returned the task. After a fallback, that is the fallback's target.
- Relevance check: before the main thread fixes the reported findings of a review, it keeps a finding that breaks a done condition, a plan requirement, or the correctness of the changed code for inputs the plan covers. It drops the others: a style preference, an input or a state that the plan rules out, a case that cannot happen in the planned flow, or a missing test that the plan or task does not name. It keeps a missing check on an input shaped like real data for code that reads outside data. It never drops a finding because its case is rare or unlikely; a race or an order of events that the planned flow allows breaks correctness. It records each dropped finding with its reason under `Log` in the plan and in the next `--prior-file`. A requested CRAP finding keeps its complexity, coverage, and CRAP values instead of a failure scenario. When it drops every finding of the last oracle round, it marks `F2` done, and the report lists the dropped oracle findings.
- A `BLOCK` review verdict for a wrong approach, or for a finding whose fix changes the plan, marks the unit blocked for a re-plan or an owner question.
- `qa` saves a screenshot for each device flow, or a recording for motion. It lists every evidence path. The `omt-ulw` report shows each QA screenshot as a Markdown image with its absolute path, grouped by screen, and says so when no device flow ran. The report lists each done condition with its evidence: the command, its exit code, and its log path.
- `qa` runs the given commands and device flows without new tests or edits. The task captures each exit code with the command that runs it. It closes every device or browser session that it opens and never restarts or replaces a shared device daemon. A local-tool failure returns `INCONCLUSIVE`. After a QA re-run passes, ULW and swarm mark the corresponding `D` and `F` items done. Section 15.5 defines test writing and failure proofs.
- Design artifacts get no model review. No `review`, `oracle`, `plan-review`, or other model task looks at files under `docs/design/`; the owner is the design review. `omt-ulw` review and oracle briefs, and `omt-code-review` reviewer groups, diff commands, and oracle input leave `docs/design/` out; `omt-ulw` QA, review, and oracle briefs of `ui` units leave out `docs/design/`, every visual-match done condition, and design context, and keep code and behavior checks; `omt-code-review` lists the design files for the owner, and a change that holds only design files goes to the owner. Code review of `ui` units stays. A `design` or `ui` dispatch tries its configured fallback when T3 refuses a target. It stops and reports when every configured target fails.
- UI units use the `ui` role in HEAVY and LIGHT runs. When an approved design spec exists, they cite and follow it. Without one, they implement the task requirements directly, with Anthropic's `frontend-design` skill when available. `omt-plan` plans an `omt-design` step only when the user requests a design pass first. `omt-ulw` step 6 waits for approval of a requested design before the affected UI units. Otherwise it permits direct implementation. The `omt-plan` hand-off returns to step 5 for owner approval, then passes through step 6.
- `qa` leaves every file unchanged. Its scope names the code under test, not files it may change.
- `plan-review`, `review`, and `oracle` are cross-family relative to the author of the change. A reviewer comes from the family other than the author's; when that family is not available, the same family reviews, except for `omt-ulw`, the pre-merge `omt-swarm` review, `omt-plan` with `plan.review: two-families`, and the `omt-grill` second opinion. These flows check each target before dispatch or fallback, and stop when the target is in the author's family. The `oracle` is the whole-change gate from the family other than the main implementer's.
- `omt-ulw` builds the review or oracle brief (step 8) with `--against <driver>`, the main thread's driver from step 0, because the ledger has no work dispatch for the units that the main thread built.
- `omt-plan` plans only, also when `omt-ulw` calls it. The main thread explores and sends only broad reads to `explore` children, awaited in the turn. It asks owner question batches until no question is open; a question that the code can answer is not an owner question. It writes the plan file itself, with `## Summary` last; it starts no `plan` child.
- `omt-plan` applies `plan.review`. `owner` dispatches no plan reviewer and waits for owner approval of the plan and test list. `two-families` dispatches 1 `plan-review` child with `--against <main thread driver>` from the step 0 `modelSelection`, and does not fall back to the main thread's family. `one` dispatches 1 `plan-review` child with no `--against`, on any family. Each dispatch passes the effective `plan.testLayers` in the task and waits in the turn with `mode: "wait"`. Round 1 freezes the reviewer's blocking findings. The main thread fixes the blockers in the plan itself, and one re-review in round 2 checks only the frozen blockers and the regressions from the fixes. There are at most 2 review rounds; blockers still open after round 2 go to the owner in one batch. The hand-off shows the `## Summary` in the reply, returns to `omt-ulw` step 5 when `omt-ulw` called it, and stops otherwise.
- `omt-plan` step 1 reads `$(omt paths --grills)/<slug>.md` when it exists and puts its goal, decisions, and edge cases under `## Research`. Step 2 asks no grill decision again, asks each pending edge case with the grill's open questions, and offers `omt-grill` first when no grill file exists and the goal has no done condition that can fail or 4 or more owner decisions remain. Step 3 turns each accepted or changed edge case with `Test: integration` or `Test: unit` into a `## Tests` line of that layer, never an e2e line, and maps no dropped or pending edge case. A changed edge case uses the user's handling from the grill file. In `plan` mode, step 0 also allows `grill` dispatches and takes the grill text from the conversation.
- `omt-grill` finds the facts first: the main thread reads the code, and sends broad reads to `explore` children and docs or web questions to `research` children, units `GX<k>`, awaited in the turn. It dispatches 1 `grill` child once per grill as a second opinion, `--unit grill --against <main thread driver>`, with no fallback to the main thread's family, and never sends that child a later batch. The main thread merges its own items with the child's, asks question batches, and checks each answer against the facts, with `explore` or `research` children for broad checks. It repeats until no question is open, no edge case is pending, and a direction is chosen, or the user stops. When `omt roles --role grill --json` fails with `unknown_role`, it checks whether an override removed the role, shows the issue, and offers `omt-setup`. It writes the grill file at `$(omt paths --grills)/<slug>.md` and ends with a grill summary, no plan and no code, and an offer of `omt-plan`. In `plan` mode it dispatches only `explore`, `research`, and `grill`, builds briefs without `--save`, writes no grill file and no ledger entry, and delivers the grill text in the final message.
- `omt-research` answers a narrow question in the main thread, with no child, and cites `path:line` or a URL for each fact. A broad question, one that covers many areas or sources, gets 2 to 4 read-only `explore` or `research` children in parallel, awaited in the turn. The main thread merges their answers and opens each cited source to check each claim before it writes the cited answer.
- `omt-design` reads the main thread's `modelSelection` in step 0. When the model is Claude Opus, the main thread draws the `design.variants` variants in Paper itself. With any other model, 1 routed `design` child draws them, one child at a time, with the configured fallbacks. Both paths load Anthropic's `frontend-design` skill when available. Without Paper, they use HTML mockups or platform-native previews. The owner picks one variant per screen and steers until they approve. Then the main thread writes `docs/design/<slug>.md`, which `ui` units cite. When the owner asks to build the screens in the same thread, it follows `omt-ulw` steps 7 to 12, and QA checks behavior only.
- `omt-code-review` sizes the review by the changed lines from `git diff --shortstat` or the PR's stats, without `docs/design/`. Below 200 lines is small: 1 reviewer over the whole change, which uses the `oracle` role when `review.oracle` is `on`, so no second thread runs. 200 lines or more is large: 2 groups below 1,000, 3 below 3,000, and 4 otherwise, each with 1 `review` child, then 1 `oracle` child over the whole change when `review.oracle` is `on`. `review.reviewers: auto` follows this rule; a number from 1 to 4 overrides it, where 1 gives the small shape and 2 to 4 give the large shape with that many groups. `review.families: one` runs each reviewer on its role's first available rung. `both` gives the groups to the two families in turn, or, in the small shape, runs 1 `review` child from each family and no oracle; it requires both families to be available. A review starts at most 4 reviewers and 1 oracle. Round 1 passes no `--against` unless selecting both families. The large-shape oracle uses the family other than the provider that ran most reviewers of that round. The main thread waits for the children in its turn: `mode: "wait"` for one, and `mode: "async"` with `t3_thread_wait` and `runId` for a parallel group. `review.fixLoop: offer` asks before each fix loop; after yes the main thread fixes the P0 to P2 findings itself. A round after fixes runs 1 `review` child over all the fixes of that round, unit `FIX`, with `--against <main thread driver>`, or `--against auto` when an `execute` child made them. Every round is a fresh task.
- `omt-ulw`, `omt-plan`, and `omt-design` read `omt profile show --plan <slug> --json` when the plan file exists. Otherwise they use `omt profile show <name> --json`, or omit the name for the config selection. Before plan creation, every brief, roles, and route call carries the selected `--profile`. `omt-plan` creates a HEAVY plan with `--profile <name>` to store the effective profile. A LIGHT plan stores a profile only when the run has an explicit `--profile`. Otherwise, it has no `profile=` header and follows the current config. The planner keeps an existing plan file and never passes `--force`.
- `omt-ulw` reloads the profile on each switch and context reset. `build.oracle: heavy` requires the oracle only for HEAVY, `always` for both tiers, and `off` for neither. After plan creation and profile switches, the main thread adds or removes the `F2` oracle item to match that rule. The run ends with one commit, a push, and a PR by the git rules of section 15.1.
- A busy lock is not a defect of the change. Apply these rules to a `qa` result and to a command that you run yourself. When a busy lock makes `qa` return `INCONCLUSIVE`, skip the retry on another provider. For a busy lock, run `omt lock list`. When `omt lock list` shows the lock as free, dispatch the next attempt with the same target, or run your own command again. Count that attempt toward the second busy lock. Treat the holder as a task of this run only when an active task of this run gave that command. For that holder, wait for the task to end. Then dispatch the next attempt with the same target, or run your own command again. For any other holder, stop it only when you own it or have permission. Otherwise ask the owner. Never take over or clear a held lock. After a second busy lock for the same check, ask the owner. A failure in a file outside the run's scope while an independent-track child is active waits for that child to end, then runs once more.

### 15.3 Shared references in `skills/omt/references/`

- `delegation.md`: the T3 rules. Starts with the precedence rule of section 15.1. Covers the `delegate_task` fields, getting arguments from `omt brief --save --json` or `omt route`, and `clientRequestId` per round and attempt (section 10). Covers waiting for children inside the turn and the wake message, which names only task ids, from section 15.2. It also covers `task_status` and `task_cancel`, releasing finished children, the failure codes with the recovery for each, the 120,000-character prompt limit, the shared checkout, depth and parallel limits, fast mode, device routing to `qa`, shared build locks, and when `t3_thread_launch` is allowed.
- `roles.md`: the default roles and when to choose each one. Covers how to resolve them with `omt roles` and `omt route`, and how to resolve them by hand when the CLI is missing, including the effort option table per driver and the manual cross-family rule (start from the first rung whose family differs from the family of the provider recorded for the unit's last work dispatch, with the family rule of section 8.3). Covers `--against` and the cross-family roles. Also covers falling back to the next rung on `provider_unavailable`, `model_unavailable`, or `invalid_request`, and custom roles and templates.
- `brief.md`: the brief layout, how to write the task text (deliverable, scope, verify, stop condition), and one complete example.
- `results.md`: how the parent reads each result block, records it, settles the child, and reads review fix lists, QA exit codes, and guardrail proposals. A done claim stays unverified until the parent or `qa` checks it.
- `roles/<role>.md`: one persona file per default role, plus `_generic.md`.
- `results/<kind>.md`: the contracts from section 11.
- `frontend-design.md`: the availability check for Anthropic's optional `frontend-design` skill, its use in a design pass, and its use in direct UI implementation without an approved spec.
- `worktrees.md`: the T3 worktree setup on first use. Run `omt worktree check`. Work out the effective saved scripts in the order of T3's `resolveProjectScripts`: `projectSettingsOverrides[projectId].defaultProjectScripts` first (an explicit empty list wins), then `defaultProjectScripts` when `projectSettingsFolded` is true, then the legacy `projectScriptOverrides`, the project's `scripts`, and `defaultProjectScripts`. A project read alone never proves activation. Keep a compatible setup and verify a custom command (frozen install, `async: false`, store reuse across two checkouts). Generate a missing setup only with the owner's yes. Import it only after `t3.json`, `.t3/`, and for pnpm `pnpm-workspace.yaml` are committed on the base branch of new worktrees and the owner's yes covers activation, through T3 Project Settings or a tool that writes the same project override, with the inherited scripts copied in. Never change `defaultProjectScripts`. Read the effective scripts back, or report activation as unverified.

### 15.4 Pull request review

`omt-code-review <number>` with the `normal` profile enables all PR steps. The `prototype` profile turns them off. Every profile uses the same order. Steps 1, 2, 6, and 10 always run. Other steps use `workflow.review` switches. The skill posts no GitHub comment or review.

Reviewers are report-only. The defaults give `review` and `oracle` edit access with `interactionMode: default`, because the `omt-ulw` reviewer fixes local findings. `omt-code-review` keeps its reviewers report-only in every run: each `review` and `oracle` task says `Report every finding with its fix. Change no files, and write none under FIXES.`, and the skill sets `interactionMode: "plan"` in the `delegateTask` of each `review` and `oracle` call, so the child cannot edit. Because the brief of an edit role has no plan-mode line, the task also tells the child to stay in plan mode and put the result block in its final assistant message. The main thread makes every fix, CI fixes included, and writes every approved test. The main thread waits for its children inside its turn and ends a turn only for the owner: a question, an offer, or the report.

The review uses the ledger-only id `review-<slug>`. It reads `omt profile show <name> --json`, not `--plan`, and passes `--profile <name>` to each brief and role lookup. It reloads the profile after a context reset. Dispatch limits use ledger counts and that profile's limits, not the ledger's config-profile `can dispatch` line. Plan mode omits `--save`, evidence writes, and ledger writes. A PR step that needs a checkout, a file write, or an edit stops for a switch to default mode.

1. Target. Run `gh pr view <n> --json number,title,body,url,baseRefName,headRefName,files,additions,deletions`. Link the PR immediately with `link_pull_request` when available. Save the original branch, or the detached HEAD commit. `review.ci: fix`, `review.verify: changed-flows`, `review.tests: offer`, or `review.crap: report` requires a clean PR checkout. Check `git status --porcelain`. With changes, stop for the owner. Otherwise run `gh pr checkout <n>`. When no step needs a checkout, keep the current branch. Size and group files by the rules in section 15.2. Run `gh pr view <n> --json baseRefOid,headRefOid` once and save both values. Run `git fetch origin <baseRefName> pull/<n>/head` once.
2. Rules. List root and ancestor `AGENTS.md` and `CLAUDE.md` files for each changed file. Add `CONTRIBUTING.md`, linked rule docs, and relevant project skills under `.claude/skills/` and `.agents/skills/`. Add lint, format, type-check, and CI config files. Every review task gets the list. A finding that breaks a written rule cites its file and line.
3. CI. With `review.ci` other than `off`, run `gh pr checks <n> --json name,state,bucket,link,workflow` before step 7, before step 10, and on each PR-event wake. Current checks are the CI state. For each failing GitHub Actions check, save the last 400 lines from `gh run view --job <job-id> --log-failed`. The job id comes from its link. Use `<evidence>/ci-<slug>-<check>.log` with a safe check filename. For another CI system, save its link. With no checks, `check` reports `no CI checks`. `fix` runs the project's check command as `omt lock run check -- <command>` and treats a failure as a failing check. Check and coverage commands run one at a time, also without lock tools. The skill never ends a turn to wait for a pending check. When checks are still pending at step 10, `watch_pull_request` is the last action of the report turn. When no check is pending, unwatch before an owner wait or review end. An owner stop also unwatches. A missing watch tool is reported with the pending checks.
4. Coverage. With `review.crap: report`, find a `coverage` or `test:coverage` script, or a coverage step in CI. Run it once as `omt lock run coverage -- <command>`. Put lcov at `<evidence>/coverage-<slug>.lcov` through a supported output option or a copy after the run. With no coverage command, give reviewers no coverage file. `off` skips this step.
5. Round 1. Dispatch report-only review groups with the rules and coverage path. With `review.crap: report`, request calculations for each added or changed function. With `review.verify: changed-flows`, dispatch one `qa` task for changed screens, CLI commands, or API routes. Its task names the flows and project build and run commands. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `qa` task. It writes no tests or product files and reports a covering test file or `none` per flow. Only qa drives devices. A local-tool `INCONCLUSIVE` gets one retry on the next rung of another provider. No child of this step edits, so the reviewers and the qa task run in parallel with `mode: "async"`, and the main thread waits for each with `t3_thread_wait` and `runId` in the same turn. Collect all verdicts before step 6.
6. Merge and oracle. Merge duplicates and sort by severity. Keep failure scenarios for non-CRAP findings and all three CRAP values for CRAP findings. A qa flow with `NOT VERIFIED` becomes P1 with evidence. With `review.oracle: on`, the oracle confirms or refutes findings and adds confirmed misses. Keep confirmed rule citations and CRAP values.
7. CI fixes. `review.ci: check` reports failures without fixes. `fix` waits for all round-1 review and qa verdicts. Then the main thread fixes each failing check itself: it reproduces the failure with a local command from the log or link, fixes it, and runs the command again. A failure that needs unavailable secrets or services is reported as blocked. One `review` child, unit `FIX`, then reviews all the CI fixes of the round. Keep the changed paths. Repeated CI fixes stop at `maxReviewRounds`. Changes stay uncommitted until step 11.
8. Guardrails. With `review.guardrails: propose`, dispatch one read-only `guardrail` task with `mode: "wait"` after the enabled oracle and the CI fix review. Give it merged findings, CI failures, rule files, CRAP results, and existing `.omt/guardrails.md`. For each finding, choose the first applicable class: `check`, then `rule-fix`, then `new-rule`. A check names a tool, config change, and proof command that fails on the PR head and passes after the change. A rule fix cites and corrects an unclear or conflicting rule. A new rule states its text and destination. A judgment-only finding gets a reason and no proposal. Skip existing proposals. Run `omt init` before appending when `.omt/.gitignore` lacks `guardrails.md`. The main thread appends `- [ ] G<k> <date> PR #<n> <class>: <proposal>. Where: <file>. Proof: <command or none>.`. Each id is one above the highest existing id. The owner can turn proposals into separate-branch omt-ulw work. The guardrail child edits no file.
9. CRAP. With `review.crap: report`, collect the calculations requested in step 5. For each added or changed function, use `CRAP = complexity² × (1 − coverage)³ + complexity`. Complexity starts at 1. Add 1 for each `if`, `else if`, loop, `case`, `catch`, `&&`, `||`, `??`, and `?:`. Coverage is the fraction of function lines that lcov marks as hit. Without data, use 0 and state `no coverage data`. A CRAP value above 30 is P2 with complexity, coverage, and CRAP values. Include these findings before merge, oracle, and guardrails. With `review.guardrails: propose`, missing complexity lint or a coverage gate requires a check proposal in step 8. With guardrails off, report each missing check as a note.
10. Report. Write `<evidence>/review-<slug>-r<n>.md` in the review result format. Include verdict, findings by severity, applicable rule citations, CI state, reviewed CI fixes with paths, verify screenshots, and CRAP findings. List verified flows without tests and guardrail proposals. List design files for owner review. Show the current branch or detached commit and the return command. Use `git switch <original branch>` or `git switch --detach <original commit>`. If checks remain pending, report them and keep the watch. New failures on wake return to step 7 and update steps 8 to 10.
11. Offers. `review.fixLoop: offer` asks before each fix loop; after yes, the main thread fixes the findings itself. `review.tests: offer` proposes one e2e test per verified flow without a covering test, with exact flow and file lines, and offers no test when the project has no e2e framework. The owner approves the exact lines. The `qa` role edits nothing and writes no tests, so after yes the main thread writes only the approved tests. The `execute` role cannot add test files or cases. Then one `qa` child runs the new tests and returns each exit code and log. Name the PR's changed paths, excluding `docs/design/`, as the code under test in the `qa` task. The test changes get one fix review before the commit. Product failures need an owner-approved fix loop. Before any approved edit, perform step 1's checkout procedure if the PR is not yet checked out. Report the branch and return command after a late checkout. Before finishing, call `list_thread_pull_requests` when available and link the PR if missing. Report linking failures. Commit and push follow the git rules of section 15.1, with `--profile <profile>`. Make one commit per fix or approved test set, using only its changed paths. Combine changes to the same file into one commit. After push, watch only when CI is enabled and step 3 found checks, then end the turn immediately. Otherwise unwatch and end. Only `review.ci: fix` starts another CI fix round for a repeated failure.

Round-1 review and oracle tasks use the saved PR commits, with or without a PR checkout:

```sh
git diff <baseRefOid>...<headRefOid> -- <paths> ':(exclude)docs/design'
git show <headRefOid>:<path>
```

Each review gets only its group's paths. The oracle gets `.`. With no PR checkout, these tasks run no tests or builds on the working tree. Reviews of uncommitted CI fixes, fix-loop changes, and approved test changes use `git diff HEAD -- <fix paths>` and read the working tree. An oracle after a fix loop also reads the working tree:

```sh
git status --porcelain -- <the round's fix paths>
git diff HEAD -- <the round's fix paths> ':(exclude)docs/design'
```

Every review round is a fresh delegated task. A round after fixes runs 1 `review` child over all of its fixes, not one per fix. Prior findings and responses go in `--prior-file`. Design files remain excluded throughout.

### 15.5 Test policy

- Children `execute`, `ui`, and `writing` add no test files or cases and make no failure proofs. They can update an existing test broken by their change and report that update under `NOTES`. The `omt-ulw` main thread writes the planned tests, including tests for units built by an independent child. After that child finishes, the main thread writes its tests, makes the configured failure proofs, and reruns verification before marking the unit done.
- Every plan has `## Tests`. The owner approves its lines with the plan. Each line is `- <layer> <unit>: <flow or case>. File: <path>. Reason: <why>.`. An empty section means no new tests. `build.qa: off` leaves the section empty.
- The planner proposes only `plan.testLayers` without a request. Other layers need a reason and owner approval. Integration tests are the default layer: real code through the interface that production uses, with only external services faked. e2e tests cover only core user journeys and failures that need the client, server, and backend together, with no edge cases as e2e lines. Unit tests cover only pure logic with real branching. Other test kinds require an owner request. The reason of each line names the bug or regression that the test catches.
- `qa` runs verify commands, final checks, and device flows against the running artifact. It writes no tests and edits no files. The `omt-ulw` main thread writes only the approved lines, in integration, e2e, then unit order, and maps each new test file or case to a line.
- With `build.failureProofs: on`, the `omt-ulw` main thread proves that each new test fails when the tested product behavior is broken. It uses a private copy of tracked and untracked working-tree files, not `HEAD`. It never changes the shared checkout for a failure proof. It breaks product behavior, not a fixture, mock, or helper. The copy is removed on every exit path. With `off`, it skips proofs.
- A missing test is a review finding only when the plan or task names it. The relevance check drops other missing-test findings. It still keeps missing real-data checks for code that reads outside data. PR review reports uncovered verified flows and requested CRAP findings, and offers exact test lines under `review.tests`.

## 16. Tests

Each module has tests in `test/`. Use `test/helpers.ts` to make temp directories and a fake `CliContext` that records stdout and stderr. Tests never read or write the real home directory.

Required coverage:

- JSONC: comments, comment markers inside strings, trailing commas, a byte order mark, and error positions. `test/config/jsonc-edit.test.ts` checks `setJsoncValue`: nested set, insert, and removal with line and block comments, trailing commas, CRLF, a byte order mark, duplicate keys, empty and one-line objects, missing parents, the upward removal, a missing path, the 100-column rendering, and the error codes. It parses each result and checks that the comments outside the edited value stay.
- Profiles: `test/config/profiles.test.ts` checks presets, sparse overrides, code-point limits, per-key pruning, profile removal, legacy `roles.test` warnings, and merged-layer inheritance errors. `test/profile/resolve.test.ts` checks precedence, root-to-child application, limits, roles, models, implicit normal inheritance, cycles, depth, and non-mutation. `test/profile/profile.test.ts` runs custom-profile selection, plan switches, profile limits, output sources, and errors through the CLI.
- Locks: `test/lock/lock.test.ts` checks real process contention, wrapper SIGKILL, inherited background holders, Node child waits, failure and signal release, wait output, holder metadata, inode preservation, no-tool fallback, argument errors, and help. It also checks shared ignored locks across linked worktrees, nested projects, separate Git directories, and trailing-space paths.
- Fast mode: `test/routing/fast.test.ts` uses `test/fixtures/capabilities-live.json` for advertised options, unsupported models, false overrides, precedence, raw options, and unverified mapping. The older `capabilities.json` fixture still checks fallback when Haiku is absent.
- Config: defaults pass validation, the exact default chains and `crossFamily` flags, one current configuration without the retired keys and roles, accepted snapshots, defaults confirmation and refusal, one warning for each retired key or role that a layer sets (at root and in a profile) with no effect on the effective config, layering order, `null` removal, chain replacement, new-role defaults, `crossFamily` kept, set, and overridden by a layer, every validation error class (including a non-boolean `crossFamily`), and a syntax error that skips one file.
- Routing: a fixture with Claude, Codex, Pi, and Cursor enabled and Grok disabled. Cover a resolved role, fallback past a disabled provider, a missing model, effort mapping for each driver, nearest-value mapping, invalid raw options, driver-only rungs, unverified mode, and the MCP content wrapper.
- Routing also covers both mode ceilings, the inherited-instance preference for driver-only rungs, and a rung whose provider instance is not registered: with a `driver` it runs on an instance of that driver with its note, and without a `driver` it fails.
- Cross-family routing: the reorder for `--against claudeAgent` and `--against codex` on `review`, a role without `crossFamily` that ignores `--against` with its note, a chain with only same-family rungs that keeps its order with the same-family note, a provider instance id that maps to its driver kind with capabilities and through a configured rung without capabilities, a worker family that matches no rung with its note, and an unavailable other-family rung that falls back to the same family with the note.
- Cross-family routing also covers a rung that names only a provider. A configured rung maps that provider to its driver, the same way as the `--against` value. The rung is in the worker's family for the reorder and for each note, through `--against <provider>` and through `--against auto`. `workerFamily` and `rungFamily` give the same family for the same provider id.
- `pickWorker`: `--unit` takes the last worker entry of the unit, the plan-wide majority, the tie rule with replaced entries, entries without a unit, an invalid provider with its warning, no worker entries, and roles with result `review` or `test` that do not count as workers. A mixed-provider review plan gives each fix unit `F<k>` a reviewer from the family other than its fix worker's. `--against auto` without `--plan` is a usage error (exit 2).
- Defaults: unverified default targets name `providerInstanceId`, and a user rung with only a `driver` still gives a `driverKind` target.
- Brief: every section, omitted sections, access and delegation lines, plan mode, per-role test policy, CLI and shared-build lines, template lookup, title, and JSON payload. Also cover saved bytes, request-id and hash paths, the short pointer, complete ledger command, unavailable-route writes, profile flags with missing plan files, the device line for every role except `qa`, the `qa` access and test lines, and an unknown-role exit for `verify`, `quick`, and `deep`.
- Plan: the template with `## Tests`, every checkbox state, counts, next unit, `complete`, profile headers, plan profile switches, and effective status output, and each dependency warning: an unknown unit, a self-dependency, a cycle, units inside code fences, and the `warning:` lines and the JSON `warnings` field of `omt plan status`, including the `max-tasks` header warning. `plan limit --tasks` and `plan new --max-tasks` exit 2 and change no file.
- Ledger: append, list, stats, a malformed line, and `requestId` sanitizing with round and attempt. `canDispatch` depends only on `active` and `maxParallel`, also after many dispatched entries, and stats ignores a config `maxTasksPerRun` and a plan `max-tasks`.
- Hook: a detection matrix (inside a code block, inside quotes, `ulwx`, `$ulw`, `ULTRAWORK`, a prompt with `<!-- omt-brief`, a prompt that starts with `Act as the `, a prompt that starts with `/omt-ulw`, a prompt that starts with `<task-notification>`, negated keywords and the two-word window, a 200,000-character negated prompt), invalid JSON, the output shape, and the build-contract text of the pointer.
- Install: create, idempotent rerun, conflict without and with `--force`, a locally modified managed skill, backups outside the skill roots, `--dry-run` and a declined prompt write nothing, non-TTY without `--yes`, roots that resolve to the same directory, hook add and update that keep other settings, an unchanged hook writes nothing, a symlinked `settings.json` stays a symlink, `--hooks` refused for a temp `cliPath`, uninstall removes only managed paths, and `--purge`.
- Project install: the files of section 14.8, an idempotent rerun, `--dry-run`, the exclude file for a `.git` directory and a worktree `.git` file, block replacement, no `.git`, `--no-git-exclude` (also on a reinstall, and its `.omt/.gitignore` restore), the conditional `.omt` and `settings.local.json` lines, the hook in `settings.local.json`, uninstall with a locally modified skill and `--purge`, `--targets gemini` (exit 2), a temp `cliPath`, and the shim conflict and update. Also: a copied project, a moved clone round trip, a tracked manifest with paths outside the root, a symlinked path to the root, the home directory as the root (exit 2), a dangling settings symlink, a failed scratch delete, glob characters in a package path, worktrees, a block whose root is gone, the exact bytes of the exclude file, a kept created `settings.local.json`, and a kept ledger. Also: a reinstall that appends `plans/`, `locks/`, and `guardrails.md` to an unedited `.omt/.gitignore` that an earlier install created, and one that leaves an edited file alone. Also: uninstall, reinstall, and a second uninstall after each kind of kept created file, each with an empty `git status`; an uninstall that fails midway; a symlinked exclude file and `.omt/.gitignore`; a crafted tracked manifest that names project files; a package copied inside the same repository; and the exact paths that stay after a failed install and its uninstall.
- Doctor: each status that the table in section 14.7 defines, with `runtimeName` and `runtimeVersion` injected through the context.
- Worktree setup: `test/commands/worktree-setup.test.ts` covers the cases in section 5.11: init, `install --project --dry-run`, setup dry run and apply, check, and `doctor --project` from a linked worktree (shared `.omt`, setup files in the worktree); a Bun and a pnpm runner with controlled executables (versions, flags, environment, lockfiles, failure exit codes, a failed linker query, CI warning); existing, invalid, and partial `t3.json`, ambiguous and unsupported managers, linker settings with TOML comments, each persistent-store status with the created, kept, and incomplete `pnpm-workspace.yaml`, symlinked and dangling `.t3` folders and runners, a home-directory alias, conflicting output paths, idempotency, and a dry run that writes nothing; and `launchSpec` for Windows. Tests never start a real package manager. They start the runner with `node`, the command in `t3.json`, and with Bun when no `node` is on `PATH`. `test/e2e/binary.test.ts` (Bun project) and `test/e2e/packages.test.ts` (pnpm and Bun projects) run `worktree setup --yes` through the shim and compare the written runner with `templates/worktree-setup.mjs`, so the binary and the bundle prove that they carry the runner.
- Skills: `test/skills/*.test.ts` replaces `test/skills.test.ts`. `common` checks frontmatter and links. `personas` checks role and result files, test policy, CRAP, and guardrails. `plan-design` checks profile selection, question batches, planned test lines, shared-build rules, the single plan reviewer per `plan.review` value with at most 2 rounds, and the design drawer and variant counts. `grill` (`test/skills/grill.test.ts`) checks the mode check, the branch-check link, the stop on a missing `grill` role with the `omt-setup` offer, the facts step with `GX<k>` explore and research units, the one `grill` child per grill with its `--against` value, the answer check, the stop rule, the path from `omt paths --grills`, and no writes in plan mode. `research` (`test/skills/research.test.ts`) checks the narrow answer with no child, the 2 to 4 parallel children for a broad question, and the claim check. `ulw` checks the build contract: the banner, the steps, the review child and the QA child rules, waiting inside the turn, ledger records, LIGHT and HEAVY tiers, the design exclusion, the git rules, and the report, and that no skill names omt-loop or a stall heartbeat. `code-review` (`test/skills/code-review.test.ts`) checks the size rule with its small and large shapes, the report-only reviewers with `interactionMode: "plan"`, waiting inside the turn, the single fix review per round, each PR step, commit-based round-1 reads, working-tree fix reviews, the offers with tests written by the main thread and run by `qa`, linking, and watches.
- Schema: the committed schema equals the generated one, and it allows the same keys as the validator.
- CLI: `--help`, `--version`, an unknown command (exit 2), and an unknown flag (exit 2), run as a child process. `test/cli.test.ts` also checks that `omt help` and `omt help config` print the same text as `omt --help` and `omt config -h`. `test/cli-help.test.ts` runs every command in `COMMANDS` except `hook` with probe arguments from its usage text. It records the options of each `parseArgs` call through `observeParseArgs` in `src/util/args.ts`, and fails when a usage text does not name a flag that its parser accepts, or when no probe of a command reaches a parser.
- Config explain: `test/e2e/config-explain.test.ts` runs `omt config explain` and `omt config explain --profile fast-proto --json` as a child process with a temp user and project config, and checks a source from the defaults, the user file, the project file, and a profile.
- Config editor: `test/config/editor-server.test.ts` checks that the server refuses a wrong token, a wrong `Host`, a foreign `Origin`, `Origin: null`, a POST without `Origin`, `Sec-Fetch-Site: cross-site`, an unknown path, a wrong method, a wrong `Content-Type`, and a body over 1 MiB, and that no response has an `Access-Control-*` header. It checks 409 `config_changed` for a stale `base` and for the second of two writes with the same `base`, and 422 `config_invalid` for a new error, each with the file unchanged. It checks that `closed` resolves after a close beacon with no ping, before and after the first ping, and that a ping after the beacon keeps the server open. `test/e2e/config-edit-web.test.ts` runs `omt config edit --web --no-open` as a child process with the `childEnv` helper, reads the URL, loads the page and `api/state`, pings, writes a nested profile value, checks that the file keeps every comment, and sends SIGINT for exit 0. `test/config/editor-maintainer.test.ts` checks maintainer mode: the empty base, that the user config is not read, the completeness check, a write to the defaults file, the skill file list without a symlink, a skill file save, 409 for a stale `base`, 422 for a changed `SKILL.md` name, 400 for a path outside `references/` or through a symlink, 404 for a new file, and 404 for both skill file routes outside maintainer mode. `test/config/editor-catalog.test.ts` checks the catalog with and without capabilities, the compact option form, the `SKILL.md` reads and the refused names, and that the page renders skill markdown without HTML and with no `javascript:` link.
- Commands: `roles`, `route`, `brief`, and `doctor` in `test/commands/`, including the `brief --json` payload fields, the title rule, `brief --json --against` with its target and fallbacks, `route --against auto` against a ledger, and the `CROSS` column and `crossFamily` field of `omt roles`.
- End to end: one child-process flow in a temp `HOME` (`test/e2e.test.ts`) runs `install`, `doctor`, `roles`, `route`, `init`, `plan`, `profile`, `brief`, `ledger`, `hook`, and `uninstall` in a temp git project. It runs the CLI with `process.execPath`, because a version-manager `node` shim can fail when `HOME` is a temp directory. A second flow runs `install --project --hooks --yes` in a temp git project, runs `.omt/bin/omt`, checks that `git status --porcelain` is empty, and uninstalls.

## 17. Packaging and release

The public brand, primary npm package, and repository name are `oh-my-t3`. `src/brand.ts` defines the CLI package names and repository identity. `docs/branding.md` records the public commands and compatibility identities. `test/branding.test.ts` checks links and install examples against this contract. Existing config directories, managed-file markers, pinned `omt3` runner shims, and archive names retain their original identities.

`bun run release` runs `bun scripts/release.ts [--target <platform>]... [--outdir <dir>]`. Without `--target`, it covers every platform in the table. The default output directory is `dist/release`. The script reads the version from `package.json` and runs `scripts/build.ts --outdir <outdir>/build` with one `--target` per platform, so each output directory has its own build. An unknown platform or flag is a usage error (exit 2). The script checks the flags before it deletes or builds anything.

The script owns its output directory. It writes the marker file `<outdir>/.omt-release` and then removes `<outdir>/build`, `<outdir>/npm`, and `<outdir>/github`. It exits 1 and deletes nothing in these cases:

- The output directory exists, is not empty, and has no `.omt-release` marker.
- The output directory is the filesystem root, the home directory, the repository root, or a parent of the repository root. The script resolves symbolic links before it compares the paths.
- The output directory is the `skills/` directory or inside it, after the script resolves symbolic links. The compiled binary embeds `skills/`, so output there would ship as skill content.
- `git ls-files --others -- skills` prints a file. These are untracked and ignored files, for example `.DS_Store`. The script lists them. The compiled binary embeds `skills/` as it is on disk, so the release starts only from a clean `skills/`.

The npm packages get only the files that `git ls-files -- skills` lists.

| Platform | Bun compile target |
| --- | --- |
| `darwin-arm64` | `bun-darwin-arm64` |
| `darwin-x64` | `bun-darwin-x64` |
| `linux-arm64` | `bun-linux-arm64` |
| `linux-x64` | `bun-linux-x64` |
| `linux-arm64-musl` | `bun-linux-arm64-musl` |
| `linux-x64-musl` | `bun-linux-x64-musl` |

The script writes these paths under `<outdir>`:

- `npm/oh-my-t3/`, `npm/oh-my-t3code/`, and `npm/omt3/`. The three directories are identical except the `name` field. Each holds `package.json`, `dist/cli.js` (mode 0755), `skills/`, `assets/icon.svg`, `assets/banner.png`, `README.md`, and `LICENSE`. The `package.json` has the repository version, the description, `type: "module"`, the license, the repository, the homepage, `bin: { "omt": "dist/cli.js", "omt3": "dist/cli.js", "oh-my-t3code": "dist/cli.js", "oh-my-t3": "dist/cli.js" }`, `files: ["dist", "skills", "assets", "README.md", "LICENSE"]`, and `engines.node: ">=22"`. It has no dependencies and no scripts. `dist/cli.js` reads `skills/` from the package root (section 5). The packages hold no `templates/`, because `dist/cli.js` inlines the worktree setup runner (section 5.11).
- `github/oh-my-t3code-v<version>-<platform>.tar.gz` for each platform. The archive holds only `omt` (mode 0755) at its root.
- `github/SHA256SUMS`, with one `<sha256>  <archive name>` line per archive, so `shasum -a 256 -c SHA256SUMS` checks them.

The script publishes nothing. At the end it prints the owner's publish commands, in this order:

1. `bun publish --access public` in `npm/oh-my-t3`.
2. `bun publish --access public` in `npm/oh-my-t3code`.
3. `bun publish --access public` in `npm/omt3`.
4. `gh release create v<version> <outdir>/github/*`.

The commands use paths relative to the current directory. A path with a character other than a letter, a digit, `_`, `.`, `/`, or `-` is in single quotes. The `/*` glob stays outside the quotes, so the shell expands it.

### 17.1 Workflows

Three GitHub Actions workflows run the tests, the release, and the site deploy. All three set workflow-level `permissions: {}`, and each job sets its own permissions. Each job with steps runs on `ubuntu-24.04`. Each action is pinned by its full commit SHA, with a `# vX.Y.Z` comment. `actions/checkout` runs with `persist-credentials: false`. Where a job uses them, `jdx/mise-action` installs mise 2026.10.17 with `add_shims_to_path: false`, `install: true`, and `cache: false`, so Bun, Node, and npm come from `mise.toml`. `actions/setup-node` installs Node 24.22.1, with `package-manager-cache: false`. CI and the npm publishing job then install npm 11.21.1 and check its exact version.

`.github/workflows/ci.yml` (name `CI`):

- Triggers: `push` to `main`, `pull_request` to `main`, and `workflow_call`.
- Concurrency group `ci-${{ github.event_name }}-${{ github.ref }}`. A new run cancels the previous run only for `pull_request`. The group does not use `github.workflow`, because in a `workflow_call` run that is the caller's name, so the group would match the release group and deadlock the release run.
- One job, `verify`, with `contents: read`. Its steps are, in order: checkout, mise, Node, the pinned npm release, `pnpm/action-setup` with pnpm 12.13.0 and `run_install: false`, `node --check templates/worktree-setup.mjs`, the bun-folder check, `bun install --frozen-lockfile`, and `bun run verify`.
- The bun-folder check prints `command -v` and `realpath` for `bun`, `node`, `npm`, `npx`, and `pnpm`. It fails when `bun` is in the folder of `node`, `npm`, or `pnpm`, or in `/usr/bin` or `/bin`. This is the rule of `tools()` in `test/e2e/registry.ts`.

`.github/workflows/release.yml` (name `Release`):

- Trigger: `push` of a tag that matches `v*`.
- Concurrency group `release-${{ github.ref }}`, with `cancel-in-progress: false`.
- Jobs: `verify`, then `build`, then `npm` and `github` in parallel.

| Job | Needs | Permissions | Does |
| --- | --- | --- | --- |
| `verify` | none | `contents: read` | Calls `./.github/workflows/ci.yml` as a reusable workflow. |
| `build` | `verify` | `contents: read` | Checkout and mise. Reads the version with `jq` and fails when the tag is not `v` plus the `version` of `package.json`. Runs `bun install --frozen-lockfile` and `bun scripts/release.ts`. Fails unless `dist/release/github` holds 6 `.tar.gz` archives and `SHA256SUMS`, and `sha256sum -c SHA256SUMS` passes. Uploads `dist/release/npm` and `dist/release/github` as the artifact `release`, with root `dist/release`, `if-no-files-found: error`, and `retention-days: 7`. |
| `npm` | `build` | `contents: read`, `id-token: write` | Runs in the environment `npm`. Downloads `release` to `dist/release`. Fails when `dist/release/npm/<pkg>/package.json` is missing for `oh-my-t3code`, `omt3`, or `oh-my-t3`. Sets up Node, then publishes each package. |
| `github` | `build` | `contents: write` | Downloads `release` to `dist/release`. Creates or checks the GitHub release. |

The `npm` job uses npm trusted publishing (OIDC). No npm token is stored. For each of `oh-my-t3`, `oh-my-t3code`, and `omt3`, it reads the version from the package's `package.json` and runs `npm view <pkg>@<version> version` outside the package folder:

- Exit 0 with the version as output: the version is published. The job skips the package.
- Exit 1 with `E404` in the output: the job runs `npm publish --access public --tag latest` in the package folder.
- Any other result, or a failed `npm publish`: the package fails.

The job tries all three packages before it fails. The job summary lists the failed packages, if any, and the published packages. The job exits 1 when a package failed.

The `github` job uses `GH_TOKEN: ${{ github.token }}`. It expects the 6 archives and `SHA256SUMS`, 7 assets in total, and fails otherwise. Then it runs `gh release view <tag>`:

- No release: the job runs `gh release create <tag> --verify-tag --title <tag> --generate-notes dist/release/github/*`.
- A published release that has all 7 assets: the job skips.
- A draft, or a release with missing assets: the job fails. It prints the draft state, the missing assets, and the recovery commands `gh release upload "<tag>" <files> --clobber` and `gh release edit "<tag>" --draft=false`, or tells the owner to delete the draft release and re-run the job.
- Any other `gh release view` error: the job fails.

`.github/workflows/site.yml` (name `Site`):

- Triggers: `pull_request` and `push` to `main` that change `site/**`, the root `package.json`, or `.github/workflows/site.yml`, and `workflow_dispatch`. A push or a pull request that changes no file in these paths does not start the workflow.
- Job `check`, with `contents: read` and the concurrency group `site-check-<ref>` with `cancel-in-progress: true`. It runs in `site/`: checkout, mise, Node, `bun install --frozen-lockfile`, `bun run typecheck`, `bun run build`, `bunx playwright install --with-deps chromium webkit`, and `bun run e2e`. When a step fails, it uploads `site/test-results/` as the artifact `site-e2e-report` for 7 days.
- Job `deploy` needs `check` and runs only for a push or a manual start on `main`, never for a pull request. It has `contents: read`, the environment `site`, and the concurrency group `site-deploy` with `cancel-in-progress: false`, so two deploys never run at the same time. It runs in `site/`: checkout, mise, and `bun install --frozen-lockfile`. It lists Pages projects with Wrangler and creates `oh-my-t3` with production branch `main` when absent. It verifies that the project owns `oh-my-t3.pages.dev`, then runs `bun run deploy`. After that succeeds, it deploys a static HTTP 301 redirect from `oh-my-t3code` to the new site, with the path preserved. These steps read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the secrets. The token is an account token with only the `Pages Write` permission.

### 17.2 Site

`site/` holds the landing page. It is a separate Bun package with its own `package.json` and `bun.lock`, so its dependencies never reach the CLI or the npm packages. The root `bun test` and `bun run typecheck` do not cover it.

- Stack: TanStack Start (React) with Vite. The only route, `/`, is prerendered at build time, so `dist/client` holds the whole site as static files. The site runs on the Cloudflare Pages project `oh-my-t3`, at `https://oh-my-t3.pages.dev`. `wrangler.jsonc` names the project and sets `pages_build_output_dir`. `public/404.html` is the page for an unknown path.
- Scripts: `dev`, `build`, `preview`, `typecheck`, `e2e` (`playwright test`), and `deploy` (`vite build` and `wrangler pages deploy --branch main`, a production deployment).
- End-to-end tests: `e2e/site.e2e.ts` runs in Chromium and WebKit at 1440 x 1000 and in WebKit as an iPhone 15. `e2e/serve.ts` serves `dist/client` the way Cloudflare Pages does, with `404.html` and status 404 for an unknown path. The tests check that the page renders with no errors and no sideways scroll, the 404 page, the order of the hero runs, the install tabs, the skill tour, the roles block, and reduced motion.
- `site/AGENTS.md` is the guide for agents that change the site.
- Design: the existing marketing design in Paper, updated for the `oh-my-t3` brand. [Brand assets and Paper references](design/brand-rename.md) record the file, pages, and exports. The pictures in `site/public/img/` and `site/src/art/` are the design's SVG exports.
- Copy ownership: website source owns final wording. Paper description slots specify content purpose and approximate length, while brand names, commands, and functional identifiers stay real. Copy-only site edits require no duplicate Paper edit. [The Paper copy policy](design/paper-drift.md) records the slots and embedded banner previews. The site displays the root `package.json` version through `site/src/site.ts`.
- Changes from the design, after the owner's review of the live site:
  - The hero picture is split in two, with ulw on the left and swarm on the right, on the same grid. The ulw run plays first while the swarm panel shows its last frame, dimmed; then the swarm run plays. Both then stay on their last frame, and "Play again" plays them again.
    - The two pictures put Build at x 200 and Review on the rail at x 300.
    - `omt-ulw`: one line, because the main thread builds. It goes from Goal to Plan, through three unit stations at Build, to Review. The review reports a finding: a dashed loop goes back to Build, the second pass to Review draws in yellow, and then the line goes on to QA and Done. The line draws at one speed, so it does not stop at the stations.
    - `omt-swarm`: three tracks leave the plan at Split at different times and speeds. Each track builds and checks in its own thread. All tracks reach one review on the rail, then join at Merge, go through one QA station, and end in one pull request.
  - The state chart shows the states of one change: Planned, Built, In review, Tested, and Done, or Blocked. It plays two trips while the chart is in view. In the first, a review requests changes, the change goes back to Built, its second pass draws in yellow, and the second review approves it. In the second, a review blocks the change. The verdict of each review lights up.
  - Skills is one list with a pointer: `omt-ulw`, `omt-plan`, `omt-grill`, `omt-design`, `omt-code-review`, `omt-research`, `omt-help`, `omt-setup`, `omt-swarm`, and `omt`. The last two rows say "by name only". The `omt-design` caption says that a Claude Opus main thread or one design child draws the variants. The `omt` picture names the workflows that the `omt` skill lists. The picture of the selected skill plays next to the list (above it on a narrow screen), and then the pointer goes to the next skill. A click or an arrow key selects a skill and stops the tour. `src/components/metro.tsx` draws these pictures and the two hero pictures, and `src/components/scenes.ts` defines them.
  - Under the skill tour, a Roles block says that skills name roles, never models, that each role has an ordered list of models, that review roles run on the other family, and that profiles change switches, limits, and roles. It lists the 12 default roles in three groups: Find, Check, and Build.
  - The requirements say that design and UI tasks run with either provider.
  - Install has two steps with tabs, side by side, and no Names list. Step 1 gets the `omt` command: Bun (the default), pnpm, mise, or a one-shot run. Step 2 installs the skills for all projects (`omt install --hooks`) or for one project (`omt install --project --hooks`). A one-shot run allows only the project install, because the user install refuses a CLI that runs from a one-shot cache (section 14.2).
  - The page text is short: one line for each step of How it works, one line under the state chart, and one line of notes under Install. The requirements ask for the latest T3 Code release.
  - Text has three steps on the ground, measured with APCA: white for headings and key text, `#c8c8c8` for body copy, and `#9a9a9a` for labels and meta. Rules are `#2a2a2a`. Sections use one rhythm: `--gap-section` between sections, `--gap-block` between the parts of one section, and `--gap-heading` under a section heading.
  - The animations pause while they are out of view. With reduced motion, each picture shows its last frame, and nothing moves on by itself.
