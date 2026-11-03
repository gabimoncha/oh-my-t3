import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, copyFile, cp, mkdir, readdir, readFile, readlink, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyInstall } from "../install/apply.ts";
import { isManagedCommand } from "../install/claudeHook.ts";
import { findGitExclude } from "../install/project.ts";
import { addProject, readProjects } from "../install/projects.ts";
import { openStarts, readLedger } from "../ledger/ledger.ts";
import { heldLocks } from "../lock/lock.ts";
import { configDirPair, findProjectRoot, projectClaudeSettingsPath, projectShimPath, projectsPath, stateDirPair } from "../paths.ts";
import type { FolderPair } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { offlineChannel } from "../update/channel.ts";
import { planHere, readProjectShim, shimRunsHere } from "../update/sync.ts";
import { errorMessage } from "../util/errors.ts";
import { errorCode, lstatIfExists, pathExists, readFileIfExists, realOrSelf, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";

export type TargetKind = "project" | "user";

// What a merge of a legacy folder into an existing current folder still has to do.
export interface MergeWork {
  move: string[]; // files only in the legacy folder, relative to it
  append: string[]; // ledger lines that the current ledger lacks
  roots: { root: string; addedAt: string }[]; // projects.json entries that the current list lacks
  differ: string[]; // files with different content in both folders
}

export interface MigrationTarget extends FolderPair {
  kind: TargetKind;
  root?: string; // the project root
  action: "move" | "merge" | "skip";
  reason?: string; // why the target is skipped
  merge?: MergeWork;
  install: boolean; // the folder that stays holds a project install that the migration syncs and checks
  notes: string[];
}

export interface TargetResult {
  target: MigrationTarget;
  status: "moved" | "merged" | "skipped" | "failed";
  note?: string;
}

const LEDGER = "ledger.jsonl";
const PROJECTS = "projects.json";
// The install writes these again, so a merge never copies them; they must already match.
const PROJECT_INSTALL_FILES = ["install.json", "bin", "backups"];
const USER_INSTALL_FILES = ["install.json", "backups"];
const PROJECT_SKIPPED = ["locks"];
const USER_SKIPPED = ["update-check.json", `${PROJECTS}.lock`];

function topName(rel: string): string {
  return rel.split("/")[0] ?? rel;
}

async function listFiles(dir: string, skipped: string[]): Promise<string[]> {
  const files: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(join(dir, rel), { withFileTypes: true });
    for (const entry of entries) {
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (rel === "" && skipped.includes(entry.name)) continue;
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk("");
  return files.sort();
}

async function sameEntry(a: string, b: string): Promise<boolean> {
  const [left, right] = [await lstatIfExists(a), await lstatIfExists(b)];
  if (left === undefined || right === undefined) return false;
  if (left.isSymbolicLink() || right.isSymbolicLink()) {
    return left.isSymbolicLink() && right.isSymbolicLink() && (await readlink(a)) === (await readlink(b));
  }
  if (!left.isFile() || !right.isFile()) return false;
  return (await readFile(a)).equals(await readFile(b));
}

function lines(text: string | undefined): string[] {
  return (text ?? "").split("\n").filter((line) => line.trim() !== "");
}

// Compares the legacy folder with the current one. `kept` names files whose current copy the owner chose.
// `dataOnly` leaves out the install-owned files, for the compare after a sync rewrote them.
async function compare(
  kind: TargetKind,
  pair: FolderPair,
  kept: ReadonlySet<string> = new Set(),
  dataOnly = false,
): Promise<{ work: MergeWork; installFiles: string[] }> {
  const work: MergeWork = { move: [], append: [], roots: [], differ: [] };
  const installFiles: string[] = [];
  const owned = kind === "project" ? PROJECT_INSTALL_FILES : USER_INSTALL_FILES;
  for (const rel of await listFiles(pair.legacy, kind === "project" ? PROJECT_SKIPPED : USER_SKIPPED)) {
    const legacy = join(pair.legacy, rel);
    const current = join(pair.current, rel);
    if (kind === "project" && rel === LEDGER) {
      const have = new Set(lines(await readFileIfExists(current)));
      work.append.push(...lines(await readFileIfExists(legacy)).filter((line) => !have.has(line)));
      continue;
    }
    if (kind === "user" && rel === PROJECTS) {
      // A list that cannot be read throws, so the target fails and both folders stay.
      const have = await readProjects(current);
      for (const entry of await readProjects(legacy)) {
        if (!have.some((other) => other.root === entry.root || realOrSelf(other.root) === realOrSelf(entry.root))) work.roots.push(entry);
      }
      continue;
    }
    if (dataOnly && owned.includes(topName(rel))) continue;
    if (kept.has(rel) || (await sameEntry(legacy, current))) continue;
    if (owned.includes(topName(rel))) installFiles.push(rel);
    else if (await lstatIfExists(current)) work.differ.push(rel);
    else work.move.push(rel);
  }
  return { work, installFiles };
}

function hasWork(work: MergeWork): boolean {
  return work.move.length + work.append.length + work.roots.length + work.differ.length > 0;
}

function shortList(items: string[]): string {
  return items.length <= 5 ? items.join(", ") : `${items.slice(0, 5).join(", ")}, and ${items.length - 5} more`;
}

// The project's open ledger starts, from the legacy ledger and, when it exists, the current one.
async function openRun(pair: FolderPair): Promise<string[]> {
  const ids: string[] = [];
  for (const dir of [pair.legacy, pair.current]) {
    const { entries } = await readLedger(join(dir, LEDGER));
    for (const entry of openStarts(entries)) ids.push(entry.clientRequestId ?? entry.taskId ?? `${entry.plan ?? "-"}/${entry.unit ?? "-"}/${entry.role}`);
  }
  return [...new Set(ids)];
}

// The locks that a command holds in either folder: the ledger lock, which exists only while held, and
// the omt lock files that a process holds.
async function heldStateLocks(ctx: CliContext, pair: FolderPair): Promise<string[]> {
  const held: string[] = [];
  for (const dir of [pair.legacy, pair.current]) {
    const ledgerLock = join(dir, "locks", "ledger.lock");
    if (await pathExists(ledgerLock)) held.push(ledgerLock);
    held.push(...(await heldLocks(ctx, join(dir, "locks"))));
  }
  return [...new Set(held)];
}

// Why a project cannot move now, or undefined. The apply asks again, because a run can start during the question.
async function busyProject(ctx: CliContext, pair: FolderPair): Promise<string | undefined> {
  const open = await openRun(pair);
  if (open.length > 0) {
    return `an open run (${shortList(open)}); let it finish, or close each start with "omt ledger done <id> --status cancelled"`;
  }
  const locks = await heldStateLocks(ctx, pair);
  if (locks.length > 0) return `a command holds ${shortList(locks)}; run omt migrate again when it ends`;
  return undefined;
}

function userLocks(pair: FolderPair): string[] {
  return [join(pair.legacy, `${PROJECTS}.lock`), join(pair.current, `${PROJECTS}.lock`)];
}

async function busyUser(pair: FolderPair): Promise<string | undefined> {
  for (const lock of userLocks(pair)) {
    if (await pathExists(lock)) return `another omt command holds ${lock}; run omt migrate again when it ends`;
  }
  return undefined;
}

function skip(target: MigrationTarget, reason: string): MigrationTarget {
  return { ...target, action: "skip", reason };
}

async function planProject(ctx: CliContext, root: string): Promise<MigrationTarget | undefined> {
  const pair = stateDirPair(root);
  if (!(await pathExists(pair.legacy))) return undefined;
  const both = await pathExists(pair.current);
  const target: MigrationTarget = { kind: "project", root, ...pair, action: both ? "merge" : "move", install: false, notes: [] };
  const ignore = await readFileIfExists(join(root, ".gitignore"));
  if (ignore !== undefined && /(^|[\s/])\.omt(\/|$)/m.test(ignore)) {
    target.notes.push(`${join(root, ".gitignore")} names .omt; omt never edits it, so change it to .omt3 yourself`);
  }
  try {
    const busy = await busyProject(ctx, pair);
    if (busy !== undefined) return skip(target, busy);
    if (both) {
      const { work, installFiles } = await compare("project", pair);
      if (installFiles.length > 0) {
        return skip(target, `both folders hold an install that differs (${shortList(installFiles)}); remove one install with "omt uninstall --project", or remove ${pair.legacy} by hand`);
      }
      target.merge = work;
    }
    // omtDir picks the current folder when both exist, so the shim read here is the install that stays.
    const installed = await pathExists(join(both ? pair.current : pair.legacy, "install.json"));
    if (installed) {
      const shim = await readProjectShim(root);
      if (shim === undefined) return skip(target, `no managed shim; run "omt install --project" in ${root}, then omt migrate`);
      const channel = offlineChannel({ build: ctx.build, cliPath: ctx.cliPath, argv1: process.argv[1], cwd: ctx.cwd, packageRoot: ctx.packageRoot, env: ctx.env });
      if (!shimRunsHere(ctx, channel, root, shim)) {
        const runs = shim.kind === "runner" ? shim.command : shim.cli;
        return skip(target, `runs another omt (${runs}), which cannot read .omt3; run ${shim.path} update --project there, then omt migrate`);
      }
      target.install = true;
    }
  } catch (error) {
    return skip(target, errorMessage(error));
  }
  return target;
}

async function planUser(ctx: CliContext): Promise<MigrationTarget | undefined> {
  const pair = configDirPair(ctx.env, ctx.homedir);
  if (pair === undefined || !(await pathExists(pair.legacy))) return undefined;
  const both = await pathExists(pair.current);
  const target: MigrationTarget = { kind: "user", ...pair, action: both ? "merge" : "move", install: false, notes: [] };
  const busy = await busyUser(pair);
  if (busy !== undefined) return skip(target, busy);
  if (both) {
    try {
      const { work, installFiles } = await compare("user", pair);
      if (installFiles.length > 0) {
        return skip(target, `both folders hold an install that differs (${shortList(installFiles)}); keep one by hand`);
      }
      target.merge = work;
    } catch (error) {
      return skip(target, `${errorMessage(error)}; both folders stay`);
    }
  }
  return target;
}

function sameRoot(a: string, b: string): boolean {
  return a === b || realOrSelf(a) === realOrSelf(b);
}

// The current project (the main checkout for a linked worktree, or the folder of a parent .omt), each
// project in projects.json, then the user folder last, because the projects come from its list.
export async function planMigration(ctx: CliContext): Promise<MigrationTarget[]> {
  const roots: string[] = [findProjectRoot(ctx.cwd)];
  // When both user folders exist, configDir reads the current one, and the legacy list can name other projects.
  const pair = configDirPair(ctx.env, ctx.homedir);
  const lists = [projectsPath(ctx.env, ctx.homedir), ...(pair === undefined ? [] : [join(pair.legacy, PROJECTS)])];
  for (const list of [...new Set(lists)]) {
    try {
      for (const entry of await readProjects(list)) roots.push(entry.root);
    } catch (error) {
      ctx.stderr(`warning: ${errorMessage(error)}\n`);
    }
  }
  const targets: MigrationTarget[] = [];
  const seen: string[] = [];
  for (const root of roots) {
    if (seen.some((other) => sameRoot(other, root))) continue;
    seen.push(root);
    const target = await planProject(ctx, root);
    if (target !== undefined) targets.push(target);
  }
  const user = await planUser(ctx);
  if (user !== undefined) targets.push(user);
  return targets;
}

export function migrationHasWork(targets: MigrationTarget[]): boolean {
  return targets.some((target) => target.action !== "skip");
}

function mergeSummary(work: MergeWork): string {
  const parts: string[] = [];
  if (work.move.length > 0) parts.push(`move ${work.move.length} file${work.move.length === 1 ? "" : "s"}`);
  if (work.append.length > 0) parts.push(`add ${work.append.length} ledger line${work.append.length === 1 ? "" : "s"}`);
  if (work.roots.length > 0) parts.push(`add ${work.roots.length} project${work.roots.length === 1 ? "" : "s"} to the list`);
  if (work.differ.length > 0) parts.push(`ask about ${shortList(work.differ)}, which differ`);
  return parts.length === 0 ? "every file is already there; delete the old folder" : `${parts.join(", ")}; then delete the old folder`;
}

export function renderMigrationPlan(targets: MigrationTarget[]): string {
  let text = "";
  for (const target of targets) {
    const label = target.kind === "project" ? "project" : "user   ";
    if (target.action === "skip") text += `  skip   ${label} ${target.legacy}: ${target.reason ?? ""}\n`;
    else if (target.action === "move") text += `  move   ${label} ${target.legacy} -> ${target.current}\n`;
    else text += `  merge  ${label} ${target.legacy} -> ${target.current}: ${mergeSummary(target.merge ?? { move: [], append: [], roots: [], differ: [] })}\n`;
    for (const note of target.notes) text += `         note: ${note}\n`;
  }
  if (migrationHasWork(targets)) {
    text += "Each moved project gets its hook command, git exclude block, manifest, and skills updated. Then omt runs its shim and its hook.\n";
    text += "End agent sessions in these projects first: a session that still holds an old path can write to it again.\n";
  }
  return text;
}

type Saved = Map<string, string | undefined>;

async function saveTexts(paths: string[]): Promise<Saved> {
  const saved: Saved = new Map();
  for (const path of paths) saved.set(path, await readFileIfExists(path));
  return saved;
}

async function restoreTexts(saved: Saved): Promise<void> {
  for (const [path, text] of saved) {
    if (text === undefined) await rm(path, { force: true });
    else if ((await readFileIfExists(path)) !== text) await writeFileAtomic(path, text);
  }
}

// Maps each recorded path in the legacy folder to the current folder. A manifest records absolute paths, and
// the hook command holds the shim path inside quotes, so the mapping replaces the prefix anywhere in a string.
function mapPaths(value: unknown, pairs: FolderPair[]): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const { legacy, current } of pairs) {
      if (out === legacy) out = current;
      out = out.replaceAll(`${legacy}/`, `${current}/`).replaceAll(`${legacy}"`, `${current}"`);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => mapPaths(item, pairs));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapPaths(item, pairs)]));
  return value;
}

// A project manifest can record its root in another spelling of the same folder, such as /private/var for
// /var, so its own root gets a pair too.
async function rewriteManifest(path: string, pair: FolderPair, root?: string): Promise<void> {
  const text = await readFileIfExists(path);
  if (text === undefined) return;
  const value: unknown = JSON.parse(text);
  const pairs = [pair];
  const recorded = isRecord(value) && typeof value.root === "string" ? value.root : undefined;
  if (root !== undefined && recorded !== undefined && recorded !== root) pairs.push(stateDirPair(recorded));
  await writeFileAtomic(path, `${JSON.stringify(mapPaths(value, pairs), null, 2)}\n`);
}

function managedHookCommand(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const groups = isRecord(value) && isRecord(value.hooks) ? value.hooks.UserPromptSubmit : undefined;
  if (!Array.isArray(groups)) return undefined;
  for (const group of groups) {
    const hooks = isRecord(group) ? group.hooks : undefined;
    if (!Array.isArray(hooks)) continue;
    for (const hook of hooks) {
      if (isRecord(hook) && isManagedCommand(hook.command)) return hook.command as string;
    }
  }
  return undefined;
}

// Runs the shim and the project hook. Returns the first failure, or undefined.
async function checkProject(ctx: CliContext, root: string): Promise<string | undefined> {
  const shim = projectShimPath(root);
  const version = spawnSync(shim, ["--version"], { cwd: root, env: ctx.env, encoding: "utf8", timeout: 120_000 });
  if (version.status !== 0) {
    return `${shim} --version failed (${version.error?.message ?? `exit ${version.status ?? version.signal}`}${version.stderr ? `: ${version.stderr.trim()}` : ""})`;
  }
  const command = managedHookCommand(await readFileIfExists(projectClaudeSettingsPath(root)));
  if (command === undefined) return undefined;
  const input = JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: root, prompt: "start ulw" });
  const hook = spawnSync("/bin/sh", ["-c", command], { cwd: root, env: ctx.env, encoding: "utf8", input, timeout: 120_000 });
  if (hook.status !== 0 || !hook.stdout.includes("hookSpecificOutput")) {
    return `the hook command failed (${hook.error?.message ?? `exit ${hook.status ?? hook.signal}`}): ${command}`;
  }
  return undefined;
}

async function outsideTexts(root: string): Promise<string[]> {
  const exclude = await findGitExclude(root);
  return [projectClaudeSettingsPath(root), ...(exclude.path === undefined ? [] : [exclude.path])];
}

// Syncs the install that the current folder holds, then runs the checks. Throws on any failure.
async function syncAndCheck(ctx: CliContext, root: string): Promise<void> {
  const projectCtx = { ...ctx, cwd: root };
  await applyInstall(await planHere(projectCtx, "project"), ctx.now());
  const failure = await checkProject(ctx, root);
  if (failure !== undefined) throw new Error(failure);
}

// Creates the folder, and fails when it exists, so a rollback never deletes a folder that another process made.
async function claim(path: string): Promise<boolean> {
  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

async function moveProject(ctx: CliContext, target: MigrationTarget & { root: string }): Promise<TargetResult> {
  const busy = await busyProject(ctx, target);
  if (busy !== undefined) return { target, status: "skipped", note: busy };
  const saved = await saveTexts(await outsideTexts(target.root));
  if (!(await claim(target.current))) {
    return { target, status: "failed", note: `${target.current} appeared after the plan; nothing changed, run omt migrate again` };
  }
  try {
    // The folder exists now, so cp copies each entry into it.
    for (const name of await readdir(target.legacy)) {
      await cp(join(target.legacy, name), join(target.current, name), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true });
    }
    if (target.install) {
      await rewriteManifest(join(target.current, "install.json"), target, target.root);
      await syncAndCheck(ctx, target.root);
    }
  } catch (error) {
    await rm(target.current, { recursive: true, force: true });
    await restoreTexts(saved);
    return { target, status: "failed", note: `${errorMessage(error)}; rolled back, ${target.legacy} is unchanged` };
  }
  await rm(target.legacy, { recursive: true, force: true });
  return { target, status: "moved" };
}

// Asks about each file that differs. Returns the files whose legacy copy the owner takes, and the ones they keep.
async function askDiffering(ctx: CliContext, target: MigrationTarget, files: string[]): Promise<{ take: string[]; keep: string[] }> {
  const take: string[] = [];
  const keep: string[] = [];
  for (const rel of files) {
    const answer = (await ctx.prompt(`${rel} differs: keep the copy in ${target.current} (k) or take the copy in ${target.legacy} (t)? [k/t] `)).trim().toLowerCase();
    (answer === "t" || answer === "take" ? take : keep).push(rel);
  }
  return { take, keep };
}

async function copyInto(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  const stat = await lstatIfExists(from);
  if (stat?.isSymbolicLink() === true) {
    await rm(to, { force: true });
    await cp(from, to, { verbatimSymlinks: true });
  } else {
    await copyFile(from, to);
  }
}

async function applyMerge(target: MigrationTarget, work: MergeWork, take: string[]): Promise<void> {
  for (const rel of [...work.move, ...take]) await copyInto(join(target.legacy, rel), join(target.current, rel));
  if (work.append.length > 0) {
    const ledger = join(target.current, LEDGER);
    const before = (await readFileIfExists(ledger)) ?? "";
    const gap = before === "" || before.endsWith("\n") ? "" : "\n";
    await appendFile(ledger, `${gap}${work.append.join("\n")}\n`);
  }
  for (const entry of work.roots) await addProject(join(target.current, PROJECTS), entry.root, new Date(entry.addedAt));
}

async function mergeTarget(ctx: CliContext, target: MigrationTarget): Promise<TargetResult> {
  const busy = () => (target.kind === "project" ? busyProject(ctx, target) : busyUser(target));
  const before = await busy();
  if (before !== undefined) return { target, status: "skipped", note: before };
  const work = target.merge ?? { move: [], append: [], roots: [], differ: [] };
  if (work.differ.length > 0 && !ctx.isTTY) {
    return { target, status: "skipped", note: `${shortList(work.differ)} differ; run omt migrate in a terminal to choose, or remove ${target.legacy} by hand` };
  }
  const { take, keep } = await askDiffering(ctx, target, work.differ);
  // A run can start while the questions wait.
  const started = await busy();
  if (started !== undefined) return { target, status: "skipped", note: started };
  if (target.kind === "project" && target.root !== undefined && target.install) {
    const saved = await saveTexts(await outsideTexts(target.root));
    const snapshot = `${target.current}-rollback-${randomBytes(6).toString("hex")}`;
    await cp(target.current, snapshot, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true });
    try {
      await syncAndCheck(ctx, target.root);
    } catch (error) {
      await rm(target.current, { recursive: true, force: true });
      await rename(snapshot, target.current);
      await restoreTexts(saved);
      return { target, status: "failed", note: `${errorMessage(error)}; rolled back, both folders are unchanged` };
    }
    await rm(snapshot, { recursive: true, force: true });
  }
  await applyMerge(target, work, take);
  const after = await compare(target.kind, target, new Set(keep), true);
  if (hasWork(after.work) || after.installFiles.length > 0) {
    const left = [...after.work.move, ...after.work.differ, ...after.installFiles, ...(after.work.append.length > 0 ? [LEDGER] : [])];
    return { target, status: "failed", note: `${shortList(left)} still differ; ${target.legacy} stays` };
  }
  await rm(target.legacy, { recursive: true, force: true });
  return { target, status: "merged" };
}

async function moveUser(target: MigrationTarget): Promise<TargetResult> {
  const busy = await busyUser(target);
  if (busy !== undefined) return { target, status: "skipped", note: busy };
  // rename fails on a folder that is not empty, so a folder that another process filled stays as it is.
  await rename(target.legacy, target.current);
  try {
    await rewriteManifest(join(target.current, "install.json"), target);
  } catch (error) {
    await rename(target.current, target.legacy).catch(() => undefined);
    return { target, status: "failed", note: `${errorMessage(error)}; rolled back` };
  }
  return { target, status: "moved" };
}

export async function applyMigration(ctx: CliContext, targets: MigrationTarget[]): Promise<TargetResult[]> {
  const results: TargetResult[] = [];
  for (const target of targets) {
    try {
      if (target.action === "skip") results.push({ target, status: "skipped", note: target.reason ?? "" });
      else if (target.action === "merge") results.push(await mergeTarget(ctx, target));
      else if (target.kind === "project" && target.root !== undefined) results.push(await moveProject(ctx, { ...target, root: target.root }));
      else results.push(await moveUser(target));
    } catch (error) {
      results.push({ target, status: "failed", note: errorMessage(error) });
    }
  }
  return results;
}

// Applies the targets, prints one line each, and returns the exit code: 1 when any target failed.
export async function applyAndReport(ctx: CliContext, targets: MigrationTarget[]): Promise<number> {
  const results = await applyMigration(ctx, targets);
  ctx.stdout(renderResults(results));
  if (results.some((result) => result.status === "moved" || result.status === "merged")) {
    ctx.stdout("Restart agent sessions in T3 Code for these projects so they load the new paths.\n");
  }
  return results.some((result) => result.status === "failed") ? 1 : 0;
}

export function renderResults(results: TargetResult[]): string {
  return results
    .map(({ target, status, note }) => {
      const where = status === "moved" || status === "merged" ? `${target.legacy} -> ${target.current}` : target.legacy;
      return `${status.padEnd(8)} ${where}${note === undefined || note === "" ? "" : `: ${note}`}\n`;
    })
    .join("");
}
