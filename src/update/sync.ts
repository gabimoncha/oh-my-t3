import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { applyInstall } from "../install/apply.ts";
import type { Manifest } from "../install/manifest.ts";
import { buildInstallPlan, installHasChanges, loadScopeManifest, renderInstallPlan, scopePaths } from "../install/plan.ts";
import type { InstallPlan, ScopePaths, TargetName } from "../install/plan.ts";
import { isManagedShim, oneShotRunner, runnerCommand, shimContent, shimPaths } from "../install/project.ts";
import type { Runner } from "../install/project.ts";
import { addProject, readProjects, removeProjects } from "../install/projects.ts";
import { findProjectRoot, manifestPath, projectManifestPath, projectShimPath, projectsPath, skillRoots } from "../paths.ts";
import type { CliBuild, CliContext } from "../types.ts";
import { errorMessage, OmtError } from "../util/errors.ts";
import { lstatIfExists, pathExists, readFileIfExists, realOrSelf, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { shimChannel } from "./channel.ts";
import type { Channel, ChannelKind, RunCommand } from "./channel.ts";
import { compareVersions } from "./check.ts";

export interface ScopeResult {
  scope: "user" | "project";
  root?: string;
  status: "synced" | "unchanged" | "skipped" | "failed";
  changed: string[]; // the skills that the sync wrote
  kept: { name: string; reason: string }[];
  note?: string;
}

export interface SyncOptions {
  projectOnly: boolean;
  runners: "delegate" | "skip";
  targetVersion: string; // shim rule 6 pins a runner shim to this version when it is newer than the pin
  run?: RunCommand; // shim rule 6 only; tests pass a fake. Absent: spawnReading
}

// Shim rule 6: the runner shim gets the newer pin, then the project syncs itself through it.
export interface RunnerSync {
  root: string;
  shim: string;
  before: string; // the shim that the plan read; the pin is written only while the file still holds it
  runner: Runner;
  pin: string;
  target: string;
  run: RunCommand;
}

export interface SyncEntry {
  header: string; // "user: ~/.agents/skills" or "project: <root>"
  result: ScopeResult; // the result of the plan; applySync returns the result of the apply
  plan?: InstallPlan; // the user scope, and shim rules 3 and 4: sync in this process
  runner?: RunnerSync;
  gone?: boolean; // shim rule 1: the root leaves the project list on the apply path
  current?: boolean; // the current project, which the apply path adds to the project list
}

export type ProjectShim =
  | { kind: "runner"; path: string; text: string; command: string; runner: Runner; pin: string }
  | { kind: "path"; path: string; text: string; cli: string; build: CliBuild };

// A dev dependency or a one-shot runner serves one project, and an unknown CLI can be either, so they leave the
// user install alone.
const USER_CHANNELS: ReadonlySet<ChannelKind> = new Set<ChannelKind>([
  "npm-global",
  "pnpm-global",
  "bun-global",
  "mise-github",
  "mise-npm",
  "source",
  "binary",
]);

const RUNNERS: readonly Runner[] = ["npx", "pnpm", "bunx"];

const STATUSES: readonly ScopeResult["status"][] = ["synced", "unchanged", "skipped", "failed"];

// The managed shim of a project, or undefined when there is none or its body names no CLI. A shim that
// cannot be read throws, so that scope fails with the error instead of reporting no shim.
export async function readProjectShim(root: string): Promise<ProjectShim | undefined> {
  const path = projectShimPath(root);
  if ((await lstatIfExists(path))?.isFile() !== true) return undefined;
  const text = await readFileIfExists(path);
  if (text === undefined || !isManagedShim(text)) return undefined;
  const paths = shimPaths(text);
  const command = paths.runner;
  if (command !== undefined) {
    // runnerCommand refuses a pin with any other character.
    const pin = /omt3@([0-9A-Za-z.+-]+)$/.exec(command)?.[1];
    if (pin === undefined) return undefined;
    const runner = RUNNERS.find((candidate) => runnerCommand(candidate, pin) === command);
    return runner === undefined ? undefined : { kind: "runner", path, text, command, runner, pin };
  }
  if (paths.cli === undefined) return undefined;
  // The body shows the run mode of the CLI that wrote it (section 14.8).
  const build: CliBuild = paths.runtime === undefined ? "binary" : paths.runtimeFallback === "bun" ? "source" : "bundle";
  return { kind: "path", path, text, cli: paths.cli, build };
}

// The channel of the CLI that a path shim records, with the package root that CLI would find for itself.
export function pathShimChannel(ctx: Pick<CliContext, "env">, root: string, shim: { cli: string; build: CliBuild }): Channel {
  const packageRoot = shim.build === "binary" ? dirname(shim.cli) : dirname(dirname(shim.cli));
  return shimChannel({ build: shim.build, cliPath: shim.cli, cwd: root, packageRoot, env: ctx.env });
}

function failureNote(error: unknown): string {
  const hint = error instanceof OmtError ? error.hint : undefined;
  return hint === undefined ? errorMessage(error) : `${errorMessage(error)}; ${hint}`;
}

// A project list error must not stop discovery of the current project.
function listWarning(error: unknown): string {
  const hint = error instanceof OmtError ? error.hint : undefined;
  return `warning: ${errorMessage(error)}\n${hint === undefined ? "" : `hint: ${hint}\n`}`;
}

function sameRoot(a: string, b: string): boolean {
  return a === b || realOrSelf(a) === realOrSelf(b);
}

function isStatus(value: unknown): value is ScopeResult["status"] {
  return STATUSES.some((status) => status === value);
}

function spawnReading(ctx: CliContext): RunCommand {
  return (argv, opts) => new Promise((resolve) => {
    const [command, ...args] = argv;
    if (command === undefined) {
      resolve({ code: 127, stdout: "" });
      return;
    }
    const env = opts.env === undefined ? ctx.env : { ...ctx.env, ...opts.env };
    const child = spawn(command, args, { cwd: opts.cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => ctx.stderr(chunk));
    child.on("error", (error) => {
      ctx.stderr(`${errorMessage(error)}\n`);
      resolve({ code: 127, stdout });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

function childScope(value: unknown, root: string): ScopeResult | undefined {
  if (!isRecord(value) || !Array.isArray(value.scopes)) return undefined;
  const scope: unknown = value.scopes.find((entry: unknown) =>
    isRecord(entry) && entry.scope === "project" && typeof entry.root === "string" && sameRoot(entry.root, root),
  );
  if (!isRecord(scope) || !isStatus(scope.status) || !Array.isArray(scope.changed) || !Array.isArray(scope.kept)) return undefined;
  if (!scope.changed.every((name: unknown) => typeof name === "string")) return undefined;
  const kept: ScopeResult["kept"] = [];
  for (const entry of scope.kept) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.reason !== "string") return undefined;
    kept.push({ name: entry.name, reason: entry.reason });
  }
  if (scope.note !== undefined && typeof scope.note !== "string") return undefined;
  return {
    scope: "project",
    root,
    status: scope.status,
    changed: scope.changed,
    kept,
    ...(scope.note === undefined ? {} : { note: scope.note }),
  };
}

// The steps that the owner confirmed. The git exclude step is not one of them, because projects of one
// repository share the exclude file, and the apply of one project changes what the next one reads.
function confirmedSteps(plan: InstallPlan): string {
  return JSON.stringify([
    plan.skills.map((step) => [step.name, step.action]),
    plan.links.map((link) => [link.path, link.action]),
    plan.project?.shim.action ?? null,
  ]);
}

function isNewer(target: string, pin: string): boolean {
  try {
    return compareVersions(target, pin) > 0;
  } catch {
    // A version that is not x.y.z cannot be compared, so the pin stays.
    return false;
  }
}

// An update repeats the choices of the scope's last install, which its manifest records.
function manifestOptions(paths: ScopePaths, manifest: Manifest | undefined): { targets: TargetName[]; hooks: boolean; gitExclude: boolean } {
  const targets: TargetName[] = ["agents"];
  for (const name of ["claude", "gemini"] as const) {
    const root = paths.linkRoots[name];
    if (root !== undefined && manifest?.links.some((link) => dirname(link.path) === root) === true) targets.push(name);
  }
  return { targets, hooks: (manifest?.hooks.length ?? 0) > 0, gitExclude: manifest?.project?.gitExcludeOff !== true };
}

export async function planHere(ctx: CliContext, scope: "user" | "project"): Promise<InstallPlan> {
  const paths = await scopePaths(ctx, scope);
  const { manifest } = await loadScopeManifest(paths);
  return buildInstallPlan(ctx, { ...manifestOptions(paths, manifest), force: false, scope, sync: true });
}

function planned(base: SyncEntry, plan: InstallPlan): SyncEntry {
  const changed = plan.skills.filter((step) => step.action === "create" || step.action === "update" || step.action === "replace" || step.action === "remove");
  const kept = plan.skills.filter((step) => step.action === "keep");
  return {
    ...base,
    plan,
    result: {
      ...base.result,
      status: installHasChanges(plan) ? "synced" : "unchanged",
      changed: changed.map((step) => step.name),
      kept: kept.map((step) => ({ name: step.name, reason: step.reason ?? "" })),
    },
  };
}

function noted(base: SyncEntry, status: "skipped" | "failed", note: string, extra: Partial<SyncEntry> = {}): SyncEntry {
  return { ...base, ...extra, result: { ...base.result, status, note } };
}

// Each recorded project once, then the current project when it holds an install of its own.
interface ProjectTarget {
  root: string;
  current: boolean;
  error?: string;
}

async function projectTargets(ctx: CliContext, projectOnly: boolean): Promise<ProjectTarget[]> {
  let recorded: string[] = [];
  try {
    recorded = (await readProjects(projectsPath(ctx.env, ctx.homedir))).map((entry) => entry.root);
  } catch (error) {
    ctx.stderr(listWarning(error));
  }
  let current = ctx.cwd;
  let installed = false;
  let discoveryError: string | undefined;
  try {
    current = findProjectRoot(ctx.cwd);
    installed = await pathExists(projectManifestPath(current));
  } catch (error) {
    discoveryError = failureNote(error);
  }
  const targets: ProjectTarget[] = [];
  for (const root of [...recorded, ...(installed || discoveryError !== undefined ? [current] : [])]) {
    if (targets.some((target) => sameRoot(target.root, root))) continue;
    const isCurrent = sameRoot(root, current);
    targets.push({
      root,
      current: installed && isCurrent,
      ...(isCurrent && discoveryError !== undefined ? { error: discoveryError } : {}),
    });
  }
  return projectOnly ? targets.filter((target) => sameRoot(target.root, current)) : targets;
}

// Whether this CLI syncs the project itself: a runner shim that calls the runner and version that run now, or a
// path shim whose CLI is this file or has the running channel. omt migrate uses the same rule.
export function shimRunsHere(ctx: CliContext, channel: Channel, root: string, shim: ProjectShim): boolean {
  if (shim.kind === "runner") {
    const running = oneShotRunner(ctx.cliPath, ctx.env);
    return running !== undefined && shim.command === runnerCommand(running, ctx.version);
  }
  // The running CLI's own file is its install, whatever channel detection makes of the path.
  return realOrSelf(shim.cli) === realOrSelf(ctx.cliPath) || pathShimChannel(ctx, root, shim).key === channel.key;
}

// The shim rules of section 5.14, in order.
async function planProject(ctx: CliContext, channel: Channel, options: SyncOptions, target: ProjectTarget): Promise<SyncEntry> {
  const { root } = target;
  const base: SyncEntry = {
    header: `project: ${root}`,
    result: { scope: "project", root, status: "skipped", changed: [], kept: [] },
    ...(target.current ? { current: true } : {}),
  };
  try {
    if (target.error !== undefined) return noted(base, "failed", target.error);
    if (!(await pathExists(root)) || !(await pathExists(projectManifestPath(root)))) {
      return noted(base, "skipped", "gone; removed from the project list", { gone: true });
    }
    const shim = await readProjectShim(root);
    if (shim === undefined) return noted(base, "skipped", "no managed shim; run omt install --project there");
    const runThere = `run ${shim.path} update --project there`;
    if (shimRunsHere(ctx, channel, root, shim)) return planned(base, await planHere({ ...ctx, cwd: root }, "project"));
    if (shim.kind === "runner") {
      if (options.runners === "skip" || !isNewer(options.targetVersion, shim.pin)) return noted(base, "skipped", `runs ${shim.command}; ${runThere}`);
      const runner: RunnerSync = {
        root,
        shim: shim.path,
        before: shim.text,
        runner: shim.runner,
        pin: shim.pin,
        target: options.targetVersion,
        run: options.run ?? spawnReading(ctx),
      };
      return { ...base, runner, result: { ...base.result, status: "synced" } };
    }
    return noted(base, "skipped", `runs another omt (${shim.cli}); ${runThere}`);
  } catch (error) {
    return noted(base, "failed", failureNote(error));
  }
}

// One entry per target: the user scope when the running CLI is the user install, then each project.
export async function planSync(ctx: CliContext, channel: Channel, options: SyncOptions): Promise<SyncEntry[]> {
  const entries: SyncEntry[] = [];
  if (!options.projectOnly && USER_CHANNELS.has(channel.kind)) {
    const agents = skillRoots(ctx.env, ctx.homedir).agents;
    const base: SyncEntry = {
      header: `user: ${join("~", relative(ctx.homedir, agents))}`,
      result: { scope: "user", status: "skipped", changed: [], kept: [] },
    };
    try {
      if (await pathExists(manifestPath(ctx.env, ctx.homedir))) entries.push(planned(base, await planHere(ctx, "user")));
    } catch (error) {
      entries.push(noted(base, "failed", failureNote(error)));
    }
  }
  for (const target of await projectTargets(ctx, options.projectOnly)) entries.push(await planProject(ctx, channel, options, target));
  return entries;
}

// A plan whose only writes are the manifests' version and timestamp asks no question, as in omt install.
export function syncHasChanges(entries: SyncEntry[]): boolean {
  return entries.some((entry) => entry.gone === true || entry.runner !== undefined || (entry.plan !== undefined && installHasChanges(entry.plan)));
}

function actionLine(action: string, subject: string): string {
  return `  ${action.padEnd(8)} ${subject}\n`;
}

export function renderSyncPlan(entries: SyncEntry[]): string {
  let text = "";
  for (const entry of entries) {
    text += `${entry.header}\n`;
    if (entry.plan !== undefined) {
      text += renderInstallPlan(entry.plan);
    } else if (entry.runner !== undefined) {
      const { shim, runner, target } = entry.runner;
      text += actionLine("pin", `${shim} -> ${runnerCommand(runner, target)}`);
      text += actionLine("run", `${shim} update --skills-only --project --yes --json`);
    } else {
      text += actionLine(entry.result.status === "failed" ? "fail" : "skip", `(${entry.result.note ?? ""})`);
    }
    for (const kept of entry.result.kept) text += `kept ${kept.name}  (${kept.reason})\n`;
  }
  return text;
}

// The pin moves only after the runner starts the target version, so a failed download keeps the old pin.
async function syncThroughRunner(sync: RunnerSync, result: ScopeResult): Promise<ScopeResult> {
  const command = runnerCommand(sync.runner, sync.target);
  const check = await sync.run([...command.split(" "), "--version"], { cwd: sync.root }).catch(() => ({ code: 127, stdout: "" }));
  if (check.code !== 0 || check.stdout.trim().split(/\r?\n/).at(-1)?.trim() !== sync.target) {
    return { ...result, status: "failed", note: `${command} did not start; the shim keeps ${sync.pin}` };
  }
  if ((await readFileIfExists(sync.shim)) !== sync.before) {
    throw new OmtError("file_changed", `${sync.shim} changed after the plan was made; nothing was written`, {
      hint: "run the command again",
    });
  }
  await writeFileAtomic(sync.shim, shimContent({ kind: "runner", runner: sync.runner, version: sync.target }), { mode: 0o755 });
  await chmod(sync.shim, 0o755);
  const child = [sync.shim, "update", "--skills-only", "--project", "--yes", "--json"];
  const done = await sync.run(child, { cwd: sync.root, env: { OMT_UPDATE_DEFER_DEFAULTS: "1" } });
  const exit = `${child.join(" ")} exited ${done.code}`;
  let value: unknown;
  try {
    value = JSON.parse(done.stdout);
  } catch {
    return { ...result, status: "failed", changed: [], kept: [], note: `${exit}; invalid JSON output` };
  }
  const scope = childScope(value, sync.root);
  if (scope === undefined) return { ...result, status: "failed", changed: [], kept: [], note: `${exit}; no valid project scope in JSON output` };
  return done.code === 0 ? scope : { ...scope, status: "failed", note: `${exit}${scope.note === undefined ? "" : `; ${scope.note}`}` };
}

// The owner can edit a skill while the confirmation question waits, so the apply plans each scope again first.
async function applyEntry(ctx: CliContext, entry: SyncEntry): Promise<ScopeResult> {
  try {
    if (entry.plan !== undefined) {
      const root = entry.plan.project?.root;
      const fresh = await planHere(root === undefined ? ctx : { ...ctx, cwd: root }, entry.plan.scope);
      if (confirmedSteps(fresh) !== confirmedSteps(entry.plan)) {
        return { ...entry.result, status: "failed", changed: [], note: "changed since the plan; run omt update again" };
      }
      await applyInstall(fresh, ctx.now());
      return planned(entry, fresh).result;
    }
    if (entry.runner !== undefined) return await syncThroughRunner(entry.runner, entry.result);
    return { ...entry.result };
  } catch (error) {
    return { ...entry.result, status: "failed", changed: [], note: failureNote(error) };
  }
}

// A failed scope does not stop the others. The project list changes only here, on the apply path.
export async function applySync(ctx: CliContext, entries: SyncEntry[]): Promise<ScopeResult[]> {
  const results: ScopeResult[] = [];
  for (const entry of entries) results.push(await applyEntry(ctx, entry));
  const list = projectsPath(ctx.env, ctx.homedir);
  const warn = (error: unknown) => ctx.stderr(listWarning(error));
  const gone = entries.flatMap((entry) => (entry.gone === true && entry.result.root !== undefined ? [entry.result.root] : []));
  if (gone.length > 0) await removeProjects(list, gone).catch(warn);
  for (const entry of entries) {
    if (entry.current === true && entry.result.root !== undefined) await addProject(list, entry.result.root, ctx.now()).catch(warn);
  }
  return results;
}
