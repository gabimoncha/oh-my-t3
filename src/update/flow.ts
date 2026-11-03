import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import { DEFAULT_CONFIG } from "../config/defaults.ts";
import { parseDefaultsSnapshot, reviewDefaults } from "../config/defaultsState.ts";
import { confirmApply } from "../install/confirm.ts";
import { oneShotRunner, runnerCommand, shimContent } from "../install/project.ts";
import type { Runner } from "../install/project.ts";
import { findProjectRoot, updateStatePath } from "../paths.ts";
import type { CliContext, DefaultsChange, OmtConfig } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists, realOrSelf, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { formatJson } from "../util/output.ts";
import { confirmChannel, confirmedGlobalEnv, detectChannel, linksProjectCli, newCliCommand, offlineChannel, updateAction } from "./channel.ts";
import type { Channel, ChannelInput, RunCommand, UpdateAction } from "./channel.ts";
import { compareVersions, fetchLatest } from "./check.ts";
import { applySync, pathShimChannel, planSync, readProjectShim, renderSyncPlan, syncHasChanges } from "./sync.ts";
import type { ProjectShim, ScopeResult, SyncEntry, SyncOptions } from "./sync.ts";

export interface UpdateOptions {
  check: boolean;
  dryRun: boolean;
  yes: boolean;
  skillsOnly: boolean;
  project: boolean;
  json: boolean;
}

// Each seam defaults to the real one. Auto-apply passes `latest`, so the flow sends no second request.
export interface UpdateSeams {
  latest?: string;
  run?: RunCommand;
  fetch?: typeof fetch;
  isTTY?: boolean;
  prompt?: (question: string) => Promise<string>;
}

interface DefaultsResult {
  scope: "user" | "project";
  root?: string;
  changed: boolean;
  applied: boolean;
  changes: DefaultsChange[];
}

// The runner shim that the repin action rewrites. The pin is written only while the file still holds `before`.
interface Repin {
  root: string;
  shim: string;
  before: string;
  runner: Runner;
  pin: string;
}

interface Resolved {
  channel: Channel;
  running: Channel; // the channel of the CLI that runs now; planSync compares project shims with it
  current: string;
  repin?: Repin;
}

type Say = (text: string) => void;

const REGISTRY_TIMEOUT_MS = 10_000;
const NPM_LAG = "npm publishes oh-my-t3code, omt3, and oh-my-t3 one after the other; try again in a minute";

// Like spawnCommand, with ctx.env, and with the child's stderr passed on, so its messages stay visible.
function spawnFor(ctx: CliContext): RunCommand {
  return (argv, opts) => new Promise((resolve) => {
    const [command, ...args] = argv;
    if (command === undefined) {
      resolve({ code: 127, stdout: "" });
      return;
    }
    const stdio: ("inherit" | "pipe" | "ignore" | number)[] = opts.inherit
      ? ["inherit", opts.toStderr ? 2 : "inherit", "inherit"]
      : ["ignore", "pipe", "pipe"];
    const env = opts.env === undefined ? ctx.env : { ...ctx.env, ...opts.env };
    const child = spawn(command, args, { cwd: opts.cwd, env, stdio, shell: false });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => ctx.stderr(chunk));
    child.on("error", () => resolve({ code: 127, stdout }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

function channelInput(ctx: CliContext): ChannelInput {
  return { build: ctx.build, cliPath: ctx.cliPath, argv1: process.argv[1], cwd: ctx.cwd, packageRoot: ctx.packageRoot, env: ctx.env };
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

function isNewer(latest: string, current: string): boolean {
  try {
    return compareVersions(latest, current) > 0;
  } catch {
    return false;
  }
}

function sameRoot(a: string | undefined, b: string): boolean {
  return a !== undefined && (a === b || realOrSelf(a) === realOrSelf(b));
}

function runsShim(ctx: CliContext, shim: ProjectShim & { kind: "runner" }): boolean {
  const running = oneShotRunner(ctx.cliPath, ctx.env);
  return running !== undefined && shim.command === runnerCommand(running, ctx.version);
}

function repinOf(root: string, shim: ProjectShim & { kind: "runner" }): Repin {
  return { root, shim: shim.path, before: shim.text, runner: shim.runner, pin: shim.pin };
}

async function projectShim(ctx: CliContext): Promise<{ root: string; shim: ProjectShim }> {
  const root = findProjectRoot(ctx.cwd);
  const shim = await readProjectShim(root);
  if (shim === undefined) throw new OmtError("update_no_shim", `no managed shim in ${root}`, { hint: "run omt install --project" });
  return { root, shim };
}

// The channel to update, or the message for a project that runs another omt. With --project, the shim of the
// project decides. confirmChannel starts the package manager, so --skills-only passes confirm: false and uses
// offlineChannel, which settles a shared pnpm store path from local files.
async function resolveChannel(ctx: CliContext, options: UpdateOptions, run: RunCommand, confirm: boolean): Promise<Resolved | { other: string; channel: Channel }> {
  const input = channelInput(ctx);
  const project = options.project ? await projectShim(ctx) : undefined;
  if (project?.shim.kind === "path") {
    // Decision Q4 comes before any global confirmation: a global install can share the CLI file with the project's
    // dependency, and the project still gets the hint, so omt runs no update command for it.
    const channel = pathShimChannel(ctx, project.root, project.shim);
    if (channel.kind === "dev-dependency") {
      if (realOrSelf(project.shim.cli) !== realOrSelf(ctx.cliPath) && !linksProjectCli(channel, ctx.cliPath)) {
        return { other: `this project runs ${project.shim.cli}; run ${project.shim.path} update --project`, channel };
      }
      return { channel, running: channel, current: ctx.version };
    }
  }
  const detected = confirm ? detectChannel(input) : offlineChannel(input);
  const running = confirm ? await confirmChannel(detected, input, run) : detected;
  const resolved: Resolved = { channel: running, running, current: ctx.version };
  if (project !== undefined) {
    const { root, shim } = project;
    if (shim.kind === "path") {
      const channel = pathShimChannel(ctx, root, shim);
      const same = realOrSelf(shim.cli) === realOrSelf(ctx.cliPath) || channel.key === running.key || channel.key === detected.key;
      if (!same) return { other: `this project runs ${shim.cli}; run ${shim.path} update --project`, channel };
    } else if (!runsShim(ctx, shim)) {
      resolved.channel = {
        kind: "one-shot",
        label: "one-shot runner",
        packageName: "omt3",
        key: `one-shot:${shim.runner}:${shim.pin}`,
        runner: shim.runner,
        projectRoot: root,
      };
      resolved.current = shim.pin;
      resolved.repin = repinOf(root, shim);
      return resolved;
    }
  }
  if (resolved.channel.kind === "one-shot" && resolved.channel.projectRoot !== undefined) {
    const shim = await readProjectShim(resolved.channel.projectRoot).catch(() => undefined);
    if (shim?.kind === "runner") resolved.repin = repinOf(resolved.channel.projectRoot, shim);
  }
  return resolved;
}

async function latestVersion(ctx: CliContext, seams: UpdateSeams): Promise<string> {
  if (seams.latest !== undefined) return seams.latest;
  const result = await fetchLatest({ env: ctx.env, timeoutMs: REGISTRY_TIMEOUT_MS, ...(seams.fetch === undefined ? {} : { fetch: seams.fetch }) });
  if (!result.ok) {
    throw new OmtError("update_registry", `cannot reach the npm registry: ${result.error}`, {
      hint: "run omt update --skills-only to sync the skills without the network",
    });
  }
  return result.version;
}

// A repin needs a runner shim to rewrite; without one the user runs the runner at the new version.
function actionFor(resolved: Resolved, latest: string): UpdateAction {
  const action = updateAction(resolved.channel, latest);
  if (action.kind !== "repin" || resolved.repin !== undefined) return action;
  const root = resolved.channel.projectRoot ?? "the project";
  return { kind: "hint", text: `run ${runnerCommand(resolved.channel.runner ?? "npx", latest)} install --project in ${root}` };
}

function commandOf(action: UpdateAction, resolved: Resolved, latest: string): string | null {
  if (action.kind === "run") return action.display;
  if (action.kind === "repin" && resolved.repin !== undefined) return runnerCommand(resolved.repin.runner, latest);
  return null;
}

function actionLine(action: UpdateAction, resolved: Resolved, latest: string): string {
  if (action.kind === "run") return `run: ${action.display}\n`;
  if (action.kind === "repin" && resolved.repin !== undefined) {
    return `pin: ${resolved.repin.shim} -> ${runnerCommand(resolved.repin.runner, latest)}\n`;
  }
  return action.kind === "hint" ? `hint: ${action.text}\n` : "";
}

function channelJson(channel: Channel) {
  return { kind: channel.kind, label: channel.label, package: channel.packageName };
}

function lagHint(channel: Channel): string | undefined {
  if (channel.kind === "mise-github") return "the GitHub release can lag npm by a few minutes; try again later";
  if (channel.kind === "npm-global" || channel.kind === "pnpm-global" || channel.kind === "bun-global") {
    return NPM_LAG;
  }
  return undefined;
}

// Keeps the record of an earlier automatic update, so auto-apply does not retry the same version.
async function writeState(ctx: CliContext, latest: string): Promise<void> {
  const path = updateStatePath(ctx.env, ctx.homedir);
  let previous: unknown;
  try {
    previous = JSON.parse((await readFileIfExists(path)) ?? "null");
  } catch {
    previous = undefined;
  }
  const state: Record<string, string> = { checkedAt: ctx.now().toISOString(), latest };
  if (isRecord(previous) && typeof previous.applyAttemptedFor === "string") state.applyAttemptedFor = previous.applyAttemptedFor;
  try {
    await writeFileAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // The state only saves a request in the daily check.
  }
}

// The pin moves only after the runner starts the new version, so a failed download keeps the old pin.
async function applyRepin(repin: Repin, latest: string, run: RunCommand): Promise<void> {
  const command = runnerCommand(repin.runner, latest);
  const check = await run([...command.split(" "), "--version"], { cwd: repin.root }).catch(() => ({ code: 127, stdout: "" }));
  if (check.code !== 0 || lastLine(check.stdout) !== latest) {
    throw new OmtError("update_runner", `${command} did not start; the shim keeps ${repin.pin}`, { hint: NPM_LAG });
  }
  if ((await readFileIfExists(repin.shim)) !== repin.before) {
    throw new OmtError("file_changed", `${repin.shim} changed after the plan was made; nothing was written`, { hint: "run the command again" });
  }
  await writeFileAtomic(repin.shim, shimContent({ kind: "runner", runner: repin.runner, version: latest }), { mode: 0o755 });
  await chmod(repin.shim, 0o755);
}

function isScopeResult(value: unknown): value is ScopeResult {
  return isRecord(value) && (value.scope === "user" || value.scope === "project") && typeof value.status === "string"
    && Array.isArray(value.changed) && Array.isArray(value.kept);
}

function childScopes(stdout: string): ScopeResult[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || !Array.isArray(value.scopes) || !value.scopes.every(isScopeResult)) return undefined;
  return value.scopes;
}

function renderResults(results: ScopeResult[]): string {
  let text = "";
  for (const result of results) {
    const header = result.scope === "user" ? "user" : `project: ${result.root ?? ""}`;
    text += `${header}  ${result.status}${result.note === undefined ? "" : `  (${result.note})`}\n`;
    for (const name of result.changed) text += `  changed  ${name}\n`;
    for (const kept of result.kept) text += `kept ${kept.name}  (${kept.reason})\n`;
  }
  return text;
}

interface DefaultsCli {
  current: (root: string) => Promise<OmtConfig | undefined>;
}

function childDefaults(cli: string[], run: RunCommand): DefaultsCli {
  return {
    current: async (root) => {
      const done = await run([...cli, "config", "show", "--defaults"], { cwd: root });
      if (done.code !== 0) return undefined;
      try {
        const config: unknown = JSON.parse(done.stdout);
        return parseDefaultsSnapshot(JSON.stringify({ version: 1, cliVersion: "", config }), "updated CLI defaults").config;
      } catch {
        return undefined;
      }
    },
  };
}

function localDefaults(): DefaultsCli {
  return { current: async () => DEFAULT_CONFIG };
}

async function defaultsStep(
  ctx: CliContext,
  options: UpdateOptions,
  results: ScopeResult[],
  cli: DefaultsCli,
): Promise<{ reports: DefaultsResult[]; failed: boolean }> {
  if (ctx.env.OMT_UPDATE_DEFER_DEFAULTS === "1") return { reports: [], failed: false };
  const target = await cli.current(ctx.cwd).catch(() => undefined);
  if (target === undefined) {
    ctx.stderr("warning: cannot read the updated CLI's defaults; run omt doctor to review them\n");
    return { reports: [], failed: true };
  }
  const scopes: { scope: "user" | "project"; root: string }[] = options.project ? [] : [{ scope: "user", root: ctx.cwd }];
  for (const result of results) {
    if (result.scope === "project" && result.root !== undefined && ["synced", "unchanged"].includes(result.status)) {
      scopes.push({ scope: "project", root: result.root });
    }
  }
  const reports: DefaultsResult[] = [];
  const seen = new Set<string>();
  for (const { scope, root } of scopes) {
    const key = `${scope}:${root}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await reviewDefaults({ ...ctx, cwd: root }, scope, { yes: options.yes, dryRun: options.dryRun, json: options.json }, target);
    reports.push({ scope, ...(scope === "project" ? { root } : {}), ...result });
  }
  return { reports, failed: false };
}

interface Report {
  current: string;
  latest: string | null;
  channel: Channel;
  action: "run" | "repin" | "hint" | "none";
  command: string | null;
  hint: string | null;
  updated: boolean;
  scopes: ScopeResult[];
  defaults: DefaultsResult[];
}

function printReport(ctx: CliContext, report: Report): void {
  const restart = report.scopes.some((scope) => scope.changed.length > 0);
  ctx.stdout(formatJson({ ...report, channel: channelJson(report.channel), restart }));
}

// Steps 7 and 8, the JSON, and the exit code of every path that applied a sync.
async function finish(ctx: CliContext, options: UpdateOptions, say: Say, report: Report, cli: DefaultsCli, failed: boolean): Promise<number> {
  // With --json the scopes and the restart flag are in the JSON, so stderr gets only the plan and the defaults.
  if (!options.json) say(renderResults(report.scopes));
  const defaults = await defaultsStep({ ...ctx, version: report.updated ? report.latest ?? ctx.version : ctx.version }, options, report.scopes, cli);
  report.defaults = defaults.reports;
  if (options.json) printReport(ctx, report);
  else if (report.scopes.some((scope) => scope.changed.length > 0)) say("Restart agent sessions in T3 Code so they load the new skills.\n");
  return failed || defaults.failed || report.scopes.some((scope) => scope.status === "failed") ? 1 : 0;
}

// Shows the sync plan of the CLI that runs now, confirms, and applies it. Undefined after a dry run or a refusal.
async function syncHere(
  ctx: CliContext,
  options: UpdateOptions,
  say: Say,
  running: Channel,
  sync: SyncOptions,
  report: Report,
  beforeApply: () => Promise<void>,
): Promise<{ code: number } | { results: ScopeResult[] }> {
  const entries = await planSync(ctx, running, sync);
  say(renderSyncPlan(entries));
  if (options.dryRun) {
    report.defaults = (await defaultsStep(ctx, options, entries.map((entry) => entry.result), localDefaults())).reports;
    say("Dry run: nothing was written.\n");
    if (options.json) printReport(ctx, { ...report, scopes: entries.map((entry) => entry.result) });
    return { code: 0 };
  }
  if (syncHasChanges(entries) && !(await confirmApply(ctx, options.yes))) return { code: 1 };
  await beforeApply();
  return { results: await applySync(ctx, entries) };
}

// The runner projects of step 6. A project whose shim pins the runner and version of this process got an
// in-process plan, but the child runs at the new version and skips it, so it moves through its runner too.
async function skippedRunners(
  ctx: CliContext,
  entries: SyncEntry[],
  scopes: ScopeResult[],
  repinned: string | undefined,
  latest: string,
  run: RunCommand,
): Promise<SyncEntry[]> {
  const runners: SyncEntry[] = [];
  for (const entry of entries) {
    const root = entry.result.root;
    if (entry.result.scope !== "project" || root === undefined || sameRoot(repinned, root)) continue;
    if (entry.runner !== undefined) {
      runners.push(entry);
      continue;
    }
    if (entry.plan === undefined) continue;
    const child = scopes.find((scope) => scope.scope === "project" && sameRoot(scope.root, root));
    if (child?.status !== "skipped") continue;
    const shim = await readProjectShim(root).catch(() => undefined);
    if (shim?.kind !== "runner" || !isNewer(latest, shim.pin)) continue;
    const sync = { root, shim: shim.path, before: shim.text, runner: shim.runner, pin: shim.pin, target: latest, run };
    runners.push({ header: entry.header, result: { ...entry.result, status: "synced", changed: [], kept: [] }, runner: sync });
  }
  return runners;
}

function runningCli(ctx: CliContext): string[] {
  return ctx.build === "binary" ? [ctx.cliPath] : [ctx.runtimePath ?? process.execPath, ctx.cliPath];
}

async function skillsOnly(ctx: CliContext, options: UpdateOptions, say: Say, run: RunCommand): Promise<number> {
  const resolved = await resolveChannel(ctx, options, run, false);
  const report: Report = {
    current: ctx.version,
    latest: null,
    channel: resolved.channel,
    action: "none",
    command: null,
    hint: null,
    updated: false,
    scopes: [],
    defaults: [],
  };
  if ("other" in resolved) return other(ctx, options, say, report, resolved.other);
  const done = await syncHere(ctx, options, say, resolved.running, {
    projectOnly: options.project,
    runners: "skip",
    targetVersion: ctx.version,
  }, report, async () => {});
  if ("code" in done) return done.code;
  report.scopes = done.results;
  return finish(ctx, options, say, report, localDefaults(), false);
}

function other(ctx: CliContext, options: UpdateOptions, say: Say, report: Report, message: string): number {
  say(`${message}\n`);
  if (options.json) printReport(ctx, { ...report, hint: message });
  return 0;
}

async function check(ctx: CliContext, options: UpdateOptions, seams: UpdateSeams, say: Say, run: RunCommand): Promise<number> {
  const resolved = await resolveChannel(ctx, options, run, true);
  if ("other" in resolved) throw new OmtError("update_check", "unreachable: --check takes no --project");
  const latest = await latestVersion(ctx, seams);
  const outdated = isNewer(latest, resolved.current);
  const action = actionFor(resolved, latest);
  say(`omt ${resolved.current} (${resolved.channel.label}); latest ${latest}\n`);
  say(outdated ? actionLine(action, resolved, latest) : `omt ${resolved.current} is the latest\n`);
  if (options.json) {
    ctx.stdout(formatJson({
      current: resolved.current,
      latest,
      outdated,
      channel: channelJson(resolved.channel),
      action: outdated ? action.kind : "none",
      command: outdated ? commandOf(action, resolved, latest) : null,
      hint: outdated && action.kind === "hint" ? action.text : null,
    }));
  }
  return 0;
}

async function update(ctx: CliContext, options: UpdateOptions, seams: UpdateSeams, say: Say, run: RunCommand): Promise<number> {
  const resolved = await resolveChannel(ctx, options, run, true);
  const report: Report = {
    current: ctx.version,
    latest: null,
    channel: resolved.channel,
    action: "none",
    command: null,
    hint: null,
    updated: false,
    scopes: [],
    defaults: [],
  };
  if ("other" in resolved) return other(ctx, options, say, report, resolved.other);
  const latest = await latestVersion(ctx, seams);
  const action = actionFor(resolved, latest);
  const newer = isNewer(latest, resolved.current);
  report.current = resolved.current;
  report.latest = latest;
  say(`omt ${resolved.current} (${resolved.channel.label}); latest ${latest}\n`);

  if (!newer || action.kind === "hint") {
    if (newer && action.kind === "hint") {
      report.action = "hint";
      report.hint = action.text;
      say(`hint: ${action.text}\n`);
    } else {
      say(`omt ${resolved.current} is the latest\n`);
    }
    const done = await syncHere(ctx, options, say, resolved.running, {
      projectOnly: options.project,
      runners: "delegate",
      targetVersion: ctx.version,
      run,
    }, report, () => writeState(ctx, latest));
    if ("code" in done) return done.code;
    report.scopes = done.results;
    return finish(ctx, options, say, report, childDefaults(runningCli(ctx), run), false);
  }

  report.action = action.kind;
  report.command = commandOf(action, resolved, latest);
  say(actionLine(action, resolved, latest));
  const entries = await planSync(ctx, resolved.running, { projectOnly: options.project, runners: "delegate", targetVersion: latest, run });
  for (const entry of entries) say(`sync: ${entry.header}\n`);
  if (options.dryRun) {
    report.defaults = (await defaultsStep(ctx, options, entries.map((entry) => entry.result), localDefaults())).reports;
    say("Defaults changes above are for the installed CLI. Review the new release's defaults after the CLI update.\n");
    say("Dry run: nothing was written.\n");
    if (options.json) printReport(ctx, { ...report, scopes: entries.map((entry) => entry.result) });
    return 0;
  }
  if (!(await confirmApply(ctx, options.yes))) return 1;
  await writeState(ctx, latest);

  if (action.kind === "run") {
    const done = await run(action.argv, { inherit: true, toStderr: options.json });
    if (done.code !== 0) {
      const hint = lagHint(resolved.channel);
      throw new OmtError("update_command", `${action.display} exited ${done.code}`, hint === undefined ? {} : { hint });
    }
  } else if (resolved.repin !== undefined) {
    await applyRepin(resolved.repin, latest, run);
  }
  report.updated = true;

  const cli = await newCliCommand(resolved.channel, latest, run);
  const version = await run([...cli, "--version"], { cwd: ctx.cwd });
  const printed = lastLine(version.stdout);
  if (version.code !== 0 || printed !== latest) {
    throw new OmtError("update_version", `the update finished, but the new omt prints ${printed === "" ? "nothing" : printed}`);
  }
  const child = [...cli, "update", "--skills-only", "--yes", ...(options.project ? ["--project"] : []), "--json"];
  // offlineChannel of the new CLI cannot confirm a shared pnpm store path by itself.
  const env = { ...confirmedGlobalEnv(resolved.channel, cli), OMT_UPDATE_DEFER_DEFAULTS: "1" };
  const synced = await run(child, { cwd: ctx.cwd, env });
  const scopes = childScopes(synced.stdout);
  let failed = synced.code !== 0;
  if (scopes === undefined) {
    failed = true;
    ctx.stderr(`warning: ${child.join(" ")} exited ${synced.code}; invalid JSON output\n`);
  }
  report.scopes = scopes ?? [];

  // Step 6: the child skipped the runner projects, because it did not ask the registry.
  const runners = await skippedRunners(ctx, entries, report.scopes, resolved.repin?.root, latest, run);
  if (runners.length > 0) {
    for (const result of await applySync(ctx, runners)) {
      const index = report.scopes.findIndex((scope) => scope.scope === "project" && result.root !== undefined && sameRoot(scope.root, result.root));
      if (index >= 0) report.scopes[index] = result;
      else report.scopes.push(result);
    }
  }
  return finish(ctx, options, say, report, childDefaults(cli, run), failed);
}

// The flow of omt update, shared with auto-apply in install and doctor (section 5.14).
export async function runUpdate(base: CliContext, options: UpdateOptions, seams: UpdateSeams = {}): Promise<number> {
  const ctx: CliContext = { ...base, isTTY: seams.isTTY ?? base.isTTY, prompt: seams.prompt ?? base.prompt };
  const run = seams.run ?? spawnFor(ctx);
  const say: Say = options.json ? ctx.stderr : ctx.stdout;
  if (options.check) return check(ctx, options, seams, say, run);
  if (options.skillsOnly) return skillsOnly(ctx, options, say, run);
  return update(ctx, options, seams, say, run);
}
