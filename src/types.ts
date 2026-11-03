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
  owners: string[]; // GitHub owners besides the user whose repos count as the user's own
  maxPrFiles: number; // most changed files in one PR before the skills split it into a stack; 0 means no limit
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
  update?: UpdateMode; // absent means "off"
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
  defaults: OmtConfig;
  sources: ConfigSource[];
  issues: ConfigIssue[];
  defaultsSource: string; // "current", or the accepted-defaults snapshot path
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
  t3Role: T3Role;
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
    task: string; // the rendered brief
    title: string;
    target: ResolvedTarget;
    role: T3Role;
    interactionMode: InteractionMode;
    runtimeMode: RuntimeMode;
    mode: "async";
    clientRequestId?: string; // present when --plan and --unit are given
  };
  fallbacks: ResolvedTarget[]; // not a delegate_task field; the targets after this one, in order
  targetKey: string; // pass it to --tried in plan mode; with --save the ledger records it
  ledger?: { done: string }; // present when --save recorded the start

}

export type LedgerStatus =
  | "dispatched"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "verified"
  | "rejected";

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
  targetKey?: string; // the target of a dispatch, such as codex/gpt-6-astra; omt brief --fallback skips tried keys
}

export interface LedgerStats {
  plan?: string;
  dispatched: number; // entries with status "dispatched"
  active: number; // dispatched entries that no terminal entry closes (see ledger closes())
  terminal: number; // entries with a terminal status: every status except "dispatched"
  limits: { maxParallel: number };
  planMaxParallel?: number; // the plan header max-parallel; set only when the plan has one
  canDispatch: boolean; // active < maxParallel
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

export type PackageManagerName = "pnpm" | "bun";

export interface WorktreeManager {
  status: "ok" | "none" | "blocked";
  manager?: PackageManagerName; // set when status is "ok"
  lockfile?: string; // file name in the checkout, set when status is "ok"
  version?: string; // the exact declared version, when package.json pins one
  declaredBy?: string; // "packageManager" or "devEngines.packageManager"
  message?: string;
  action?: string;
}

export interface WorktreeLinker {
  status: "default" | "isolated" | "incompatible" | "unverified";
  message: string;
  source?: string;
  action?: string;
}

// The pnpm setting in pnpm-workspace.yaml that keeps the global virtual store after a later
// pnpm run or pnpm exec. "no-file": omt worktree setup creates the file.
// "version-dependent": the result depends on a pnpm version that package.json does not pin.
export interface WorktreeStore {
  status: "set" | "no-file" | "missing" | "off" | "version-dependent" | "unverified";
  message: string;
  action?: string;
}

export type WorktreeSetupStatus = "not-needed" | "missing" | "invalid" | "no-setup" | "managed" | "custom";

export interface WorktreeSetup {
  status: WorktreeSetupStatus;
  message: string;
  command?: string; // the first runOnWorktreeCreate script's command
  async?: boolean; // that script's async value; undefined when it is not set
  runner?: "current" | "different" | "missing" | "linked" | "occupied"; // for "managed" and "missing": the state of the runner file; "linked": it or .t3 is a symlink; "occupied": .t3 is not a folder
  issues?: string[]; // for "invalid": each schema or syntax problem
}

export interface WorktreeCheck {
  id: string;
  status: "PASS" | "WARN" | "FAIL" | "INFO";
  message: string;
}

export interface WorktreeReport {
  root: string; // the checkout that was inspected; never redirected to the main checkout
  checkout: boolean; // true when root holds .git
  mainCheckout?: string; // set when root is a linked worktree
  t3File: string;
  runnerFile: string;
  manager: WorktreeManager;
  linker?: WorktreeLinker; // set when a manager was found
  workspaceFile: string; // <root>/pnpm-workspace.yaml
  store?: WorktreeStore; // set for pnpm
  complete: boolean; // the managed setup needs no further file change in the checkout
  setup: WorktreeSetup;
  canGenerate: boolean; // omt worktree setup may write the missing files
  blockers: string[]; // why it may not
  activation: string;
  next?: string;
  checks: WorktreeCheck[];
  summary: WorktreeCheck; // one line for init, install --project, and doctor --project
}
