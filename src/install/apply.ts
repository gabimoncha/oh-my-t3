import { DEFAULT_CONFIG } from "../config/defaults.ts";
import { randomBytes } from "node:crypto";
import { chmod, readdir, readlink, rename, rm, rmdir, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { starterConfig } from "../config/starter.ts";
import { errorMessage, OmtError } from "../util/errors.ts";
import { copyDir, ensureDir, hashDir, lstatIfExists, pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isOmtLayout, writeHookChange } from "./claudeHook.ts";
import type { HookChange } from "./claudeHook.ts";
import { movePath, newBackupDir, projectWriteTarget, writeTargetFor } from "./fsops.ts";
import { mergeManifest, writeManifest } from "./manifest.ts";
import type { Manifest, ManifestFile, ManifestHook } from "./manifest.ts";
import { removesRetired, replaceableSteps, sha256 } from "./plan.ts";
import type { FileStep, HookStep, InstallPlan, PlanAction, SkillStep, UninstallPlan } from "./plan.ts";
import { BACKUPS_GITIGNORE } from "./project.ts";
import { isManagedDir, PACKAGE_NAME, writeMarker } from "./skills.ts";

export interface ApplyResult {
  changed: string[]; // paths written, created, or removed
  backups: string[];
}

function scratchPath(agentsRoot: string, kind: "tmp" | "old"): string {
  return join(dirname(agentsRoot), `.omt-${kind}-${randomBytes(6).toString("hex")}`);
}

// Lazily creates one backup directory per run, so a run without backups leaves no empty directory.
// In project scope, `backups/.gitignore` holds `*`, so git never shows a backup; `onIgnore` gets it when this run wrote it.
function backupDirFor(stateDir: string, now: Date, root?: string, onIgnore?: (file: ManifestFile) => void): () => Promise<string> {
  let dir: string | undefined;
  return async () => {
    if (dir !== undefined) return dir;
    dir = await newBackupDir(stateDir, now);
    const ignore = join(stateDir, "backups", ".gitignore");
    if (root !== undefined) {
      await projectWriteTarget(root, dir);
      await projectWriteTarget(root, ignore);
    }
    if (root !== undefined && !(await pathExists(ignore))) {
      await writeFileAtomic(ignore, BACKUPS_GITIGNORE);
      onIgnore?.({ path: ignore, sha256: sha256(BACKUPS_GITIGNORE) });
    }
    return dir;
  };
}

async function removeEmptyDir(dir: string): Promise<boolean> {
  try {
    await rmdir(dir);
    return true;
  } catch {
    // The directory is missing or holds other files.
    return false;
  }
}

// Deletes a scratch directory. A failure names the path; the next run removes it.
async function removeScratch(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (error) {
    throw new OmtError("scratch", `cannot delete the scratch directory ${dir}: ${errorMessage(error)}`, {
      hint: "fix the permissions, then run the command again; the next run removes the directory",
      cause: error,
    });
  }
}

async function removeScratchDirs(dirs: string[], result: ApplyResult): Promise<void> {
  for (const dir of dirs) {
    await removeScratch(dir);
    result.changed.push(dir);
  }
}

// Builds the new skill directory next to the agents root, then swaps it into place. The old folder must
// still have the hash that the plan read. Else the old folder goes back, so an edit saved after the plan stays.
async function installSkill(step: SkillStep, plan: InstallPlan): Promise<void> {
  const temp = scratchPath(plan.agentsRoot, "tmp");
  let old: string | undefined;
  try {
    await copyDir(step.source, temp);
    const hash = await hashDir(temp);
    if (hash !== step.sourceHash) {
      throw new OmtError("skill_changed", `the bundled skill ${step.name} changed while installing`, {
        hint: "run the command again",
      });
    }
    await writeMarker(temp, { package: PACKAGE_NAME, version: plan.version, skill: step.name, hash });
    await ensureDir(plan.agentsRoot);
    if (await pathExists(step.path)) {
      old = scratchPath(plan.agentsRoot, "old");
      await rename(step.path, old);
      // The hash runs after the move, so a later write to the skill path cannot reach the folder that this run deletes.
      if (step.installedHash === undefined || (await hashDir(old).catch(() => undefined)) !== step.installedHash) {
        throw new OmtError("file_changed", `${step.path} changed after the plan was made; it was kept, and nothing more was written`, {
          hint: "run the command again",
        });
      }
    }
    await rename(temp, step.path);
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    if (old !== undefined && !(await pathExists(step.path))) await rename(old, step.path);
    throw error;
  }
  if (old !== undefined) await removeScratch(old);
}

// A settings file that the install created and that holds only the omt entry is deleted without a
// backup. For a symlink, the install created its target, so the target goes and the link stays.
// An exact restore writes the install-time backup's bytes back, then deletes that backup.
// Returns the backup that this write made, if any.
async function writeHook(step: HookStep, backupDir: () => Promise<string>, result: ApplyResult, skipBackup = false, root?: string): Promise<string | undefined> {
  if (root !== undefined) await projectWriteTarget(root, step.settingsPath);
  let backup: string | undefined;
  if (step.removeFile === true) {
    if ((await readFileIfExists(step.settingsPath)) !== step.before) {
      throw new OmtError("claude_settings", `${step.settingsPath} changed after the plan was made; nothing was written`, {
        hint: "run the command again",
      });
    }
    await rm(root === undefined ? await writeTargetFor(step.settingsPath) : await projectWriteTarget(root, step.settingsPath), { force: true });
  } else if (step.restoreBackup !== undefined) {
    await writeHookChange(step as HookChange, undefined, root);
    await rm(step.restoreBackup, { force: true });
    const stampDir = dirname(step.restoreBackup);
    if (await removeEmptyDir(stampDir)) await removeEmptyDir(dirname(stampDir));
  } else {
    const needsBackup = step.action !== "unchanged" && step.before !== undefined && !skipBackup;
    backup = await writeHookChange(step as HookChange, needsBackup ? await backupDir() : undefined, root);
    if (backup !== undefined) result.backups.push(backup);
  }
  result.changed.push(step.settingsPath);
  return backup;
}

// Writes `after` only when the file still holds what the plan read. A `deleteFile` step deletes the
// file instead, and then its `removeDir` when that is empty. A symlink at the path stays a symlink:
// the write goes to its real path, and a delete empties the target and keeps the link.
async function writeFileStep(step: FileStep, mode?: number, root?: string): Promise<void> {
  if ((await readFileIfExists(step.path)) !== step.before) {
    throw new OmtError("file_changed", `${step.path} changed after the plan was made; nothing more was written`, {
      hint: "run the command again",
    });
  }
  const target = root === undefined ? await writeTargetFor(step.path) : await projectWriteTarget(root, step.path);
  if (step.deleteFile === true && target === step.path) {
    await removePath(step.path);
    if (step.removeDir !== undefined) await removeEmptyDir(step.removeDir);
    return;
  }
  await writeFileAtomic(target, step.after, mode === undefined ? {} : { mode });
}

// Deletes a path. A failure names the path; running the command again finishes the work.
async function removePath(path: string, options: { recursive?: boolean } = {}): Promise<void> {
  try {
    await rm(path, { force: true, ...options });
  } catch (error) {
    throw new OmtError("remove", `cannot delete ${path}: ${errorMessage(error)}`, {
      hint: "fix the permissions, then run the command again",
      cause: error,
    });
  }
}

// Moves a skill out of the skills directory, then deletes it, so a partial delete never leaves a
// half-removed skill that agents would load. With `hash`, the folder must still have it after the move;
// else it goes back, so an edit saved after the plan stays.
async function removeSkillDir(path: string, hash?: string): Promise<void> {
  const old = scratchPath(dirname(path), "old");
  try {
    await rename(path, old);
  } catch (error) {
    throw new OmtError("remove", `cannot move ${path} out of the skills directory: ${errorMessage(error)}`, {
      hint: "fix the permissions, then run the command again",
      cause: error,
    });
  }
  if (hash !== undefined && (!(await isManagedDir(old)) || (await hashDir(old).catch(() => undefined)) !== hash)) {
    if (!(await pathExists(path))) await rename(old, path);
    throw new OmtError("file_changed", `${path} changed after the plan was made; it was kept, and nothing more was written`, {
      hint: "run the command again",
    });
  }
  await removeScratch(old);
}

// Removes each retired skill before its links, so a failed skill check keeps the links in place.
async function removeRetired(plan: InstallPlan, backupDir: () => Promise<string>, result: ApplyResult): Promise<void> {
  for (const step of plan.skills) {
    if (!removesRetired(step)) continue;
    if (step.action === "replace") {
      const backup = join(await backupDir(), "agents", step.name);
      await movePath(step.path, backup);
      result.backups.push(backup);
      result.changed.push(step.path);
    } else if (await lstatIfExists(step.path) !== undefined) {
      if (step.installedHash === undefined) {
        throw new OmtError("file_changed", `${step.path} appeared after the plan was made; it was kept`, { hint: "run the command again" });
      }
      await removeSkillDir(step.path, step.installedHash);
      result.changed.push(step.path);
    }
    for (const link of plan.links) {
      if (link.name !== step.name || !removesRetired(link)) continue;
      if ((await readlink(link.path).catch(() => undefined)) !== link.target) {
        throw new OmtError("file_changed", `${link.path} changed after the plan was made; it was kept`, { hint: "run the command again" });
      }
      await removePath(link.path);
      result.changed.push(link.path);
    }
  }
}

// The record after a run that removed retired skills: the merge keeps every name of the previous
// manifest, so the names and links of skills that this plan no longer keeps go here.
function pruneRetired(manifest: Manifest, plan: InstallPlan): Manifest {
  const kept = new Set(plan.skills.filter((step) => !removesRetired(step)).map((step) => step.name));
  const removedLinks = new Set(plan.links.filter(removesRetired).map((link) => link.path));
  return {
    ...manifest,
    skills: manifest.skills.filter((name) => kept.has(name)),
    links: manifest.links.filter((link) => !removedLinks.has(link.path) && kept.has(basename(link.path))),
  };
}

// Returns the created files that this run wrote, with the hash of what it wrote.
async function applyProjectInstall(
  plan: InstallPlan,
  backupDir: () => Promise<string>,
  result: ApplyResult,
): Promise<ManifestFile[]> {
  const project = plan.project;
  if (project === undefined) return [];
  const files: ManifestFile[] = [];
  if (project.plans.action === "create") {
    await ensureDir(project.plans.path);
    result.changed.push(project.plans.path);
  }
  if (project.gitignore.action === "create" || project.gitignore.action === "update") {
    await writeFileStep(project.gitignore, undefined, project.root);
    result.changed.push(project.gitignore.path);
    if (project.gitignoreCreated) files.push({ path: project.gitignore.path, sha256: sha256(project.gitignore.after) });
  }
  const shim = project.shim;
  if (shim.action === "replace") {
    const backup = join(await backupDir(), "bin", "omt");
    await movePath(shim.path, backup);
    result.backups.push(backup);
    shim.before = undefined;
  }
  if (shim.action === "create" || shim.action === "update" || shim.action === "replace") {
    await writeFileStep(shim, 0o755, project.root);
    await chmod(shim.path, 0o755);
    result.changed.push(shim.path);
  }
  return files;
}

async function existing(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) if (await pathExists(path)) found.push(path);
  return found;
}

function projectRecord(plan: InstallPlan, files: ManifestFile[], dirs: string[]): Manifest["project"] {
  const project = plan.project;
  if (project === undefined) return undefined;
  const exclude = project.exclude !== undefined && project.exclude.action !== "remove" ? project.exclude : undefined;
  return {
    omtDirCreated: project.omtDirCreated,
    settingsCreated: project.settingsCreated,
    shim: project.shim.path,
    ...(exclude === undefined ? {} : { gitExclude: exclude.path }),
    ...(exclude === undefined || project.excludeFile === undefined ? {} : { excludeFile: project.excludeFile }),
    ...(project.excludeNote === "--no-git-exclude" ? { gitExcludeOff: true } : {}),
    ...(project.gitignoreRestore === undefined ? {} : { gitignoreRestore: project.gitignoreRestore }),
    ...(project.existing.skills.length + project.existing.links.length === 0 ? {} : { existing: project.existing }),
    files,
    dirs,
  };
}

// The backups .gitignore that this run will write, so the provisional manifest can record it.
async function plannedBackupsIgnore(plan: InstallPlan, skipHookBackup: boolean): Promise<ManifestFile | undefined> {
  if (plan.project === undefined) return undefined;
  const path = join(plan.stateDir, "backups", ".gitignore");
  if (await pathExists(path)) return undefined;
  const replaces = replaceableSteps(plan).some((step) => step.action === "replace");
  const hook = plan.hook;
  const hookBackup = hook !== undefined && hook.action !== "unchanged" && hook.before !== undefined && !skipHookBackup;
  return replaces || hookBackup ? { path, sha256: sha256(BACKUPS_GITIGNORE) } : undefined;
}

// A project hook update needs no backup when the file is in the layout that omt writes, because then
// the rewrite changes only the command of the omt entry (the shim path moves with the project). A file
// in any other layout, such as one with inline arrays, gets a backup, which is not the hook `backup`.
function skipsHookBackup(plan: InstallPlan): boolean {
  const hook = plan.hook;
  return plan.project !== undefined && hook?.action === "update" && hook.before !== undefined && isOmtLayout(hook.before, hook.settingsPath);
}

// A sync owns only what the previous manifest owned, or what this run wrote. A kept conflict changes no
// ownership: the merge keeps the previous record of an owned one, and an unowned one stays unowned.
function owns(plan: InstallPlan, action: PlanAction, owned: boolean, existing: boolean): boolean {
  if (plan.sync !== true) return !existing;
  return action !== "keep" && (owned || ((action === "create" || action === "update" || action === "replace") && !existing));
}

function installManifest(plan: InstallPlan, now: Date, fields: Pick<Manifest, "config" | "hooks" | "backups" | "project">): Manifest {
  const ownedSkills = new Set(plan.previous?.skills ?? []);
  const ownedLinks = new Set((plan.previous?.links ?? []).map((link) => link.path));
  return {
    ...(plan.project === undefined ? {} : { scope: "project" as const, root: plan.project.root }),
    package: PACKAGE_NAME,
    version: plan.version,
    ...(plan.previous === undefined
      ? { acceptedDefaults: { version: 1 as const, cliVersion: plan.version, config: DEFAULT_CONFIG } }
      : plan.previous.acceptedDefaults === undefined ? {} : { acceptedDefaults: plan.previous.acceptedDefaults }),
    installedAt: now.toISOString(),
    skillsRoot: plan.agentsRoot,
    // A project manifest lists only what an install owns; `project.existing` lists the rest.
    skills: plan.skills
      .filter((step) => !removesRetired(step))
      .filter((step) => owns(plan, step.action, ownedSkills.has(step.name), plan.project?.existing.skills.includes(step.name) === true))
      .map((step) => step.name),
    links: plan.links
      .filter((link) => !removesRetired(link))
      .filter((link) => owns(plan, link.action, ownedLinks.has(link.path), plan.project?.existing.links.includes(link.path) === true))
      .map((link) => ({ path: link.path, target: link.target })),
    ...fields,
  };
}

function hookRecords(plan: InstallPlan, created: boolean, backup?: string): ManifestHook[] {
  if (plan.hook === undefined) return [];
  return [
    {
      kind: "claude-user-prompt-submit",
      settingsPath: plan.hook.settingsPath,
      command: plan.hook.command,
      ...(created ? { created: true } : {}),
      ...(backup === undefined ? {} : { backup }),
    },
  ];
}

// In project scope, the exclude block and a provisional manifest go first, so a failure later in
// the run leaves no file that git shows or that the next run takes for the user's.
async function beginProjectInstall(
  plan: InstallPlan,
  now: Date,
  hookCreated: boolean,
  starter: string,
  backupsIgnore: ManifestFile | undefined,
): Promise<void> {
  const project = plan.project;
  if (project === undefined) return;
  const exclude = project.exclude;
  if (exclude !== undefined && exclude.action !== "unchanged") {
    try {
      await writeFileStep(exclude);
    } catch (error) {
      if (error instanceof OmtError) throw error;
      throw new OmtError("git_exclude", `cannot write the git exclude block to ${exclude.path}: ${errorMessage(error)}; nothing was changed`, {
        hint: "fix the file's permissions, or run the install again with --no-git-exclude",
        cause: error,
      });
    }
  }
  const files: ManifestFile[] = [];
  if (project.gitignoreCreated && (project.gitignore.action === "create" || project.gitignore.action === "update")) {
    files.push({ path: project.gitignore.path, sha256: sha256(project.gitignore.after) });
  }
  if (plan.config.action === "create") files.push({ path: plan.config.path, sha256: sha256(starter) });
  if (backupsIgnore !== undefined) files.push(backupsIgnore);
  const provisional = installManifest(plan, now, {
    config: { path: plan.config.path, created: plan.config.action === "create" },
    hooks: hookRecords(plan, hookCreated),
    backups: [],
    project: projectRecord(plan, files, project.missingDirs),
  });
  await writeManifest(plan.manifestPath, mergeManifest(plan.previous, provisional));
}

export async function applyInstall(plan: InstallPlan, now: Date): Promise<ApplyResult> {
  if (plan.project !== undefined) {
    for (const path of [plan.stateDir, join(plan.stateDir, "backups"), plan.agentsRoot, plan.config.path, plan.manifestPath, plan.project.plans.path, plan.project.shim.path]) {
      await projectWriteTarget(plan.project.root, path);
    }
    if (plan.hook !== undefined) await projectWriteTarget(plan.project.root, plan.hook.settingsPath);
    if (["create", "update"].includes(plan.project.gitignore.action)) await projectWriteTarget(plan.project.root, plan.project.gitignore.path);
  }
  const result: ApplyResult = { changed: [], backups: [] };
  const createdIgnores: ManifestFile[] = [];
  const backupDir = backupDirFor(plan.stateDir, now, plan.project?.root, (file) => createdIgnores.push(file));

  for (const step of replaceableSteps(plan)) {
    if (step.action === "conflict") {
      throw new OmtError("conflict", `cannot apply a plan with conflicts (${step.path})`, { hint: "use --force" });
    }
  }
  const starter = starterConfig(plan.scope, plan.config.harnesses);
  const hookCreated =
    plan.hook !== undefined &&
    (plan.hook.before === undefined ||
      plan.previous?.hooks.some((hook) => hook.settingsPath === plan.hook?.settingsPath && hook.created === true) === true);
  const skipHookBackup = skipsHookBackup(plan);
  await beginProjectInstall(plan, now, hookCreated, starter, await plannedBackupsIgnore(plan, skipHookBackup));
  await removeScratchDirs(plan.scratch, result);
  await removeRetired(plan, backupDir, result);

  for (const step of plan.skills) {
    if (step.retired === true) continue;
    if (step.action === "replace") {
      const backup = join(await backupDir(), "agents", step.name);
      await movePath(step.path, backup);
      result.backups.push(backup);
    }
    if (step.action === "create" || step.action === "update" || step.action === "replace") {
      await installSkill(step, plan);
      result.changed.push(step.path);
    }
  }

  for (const link of plan.links) {
    if (link.retired === true) continue;
    if (link.action === "replace") {
      const backup = join(await backupDir(), link.root, link.name);
      await movePath(link.path, backup);
      result.backups.push(backup);
    }
    if (link.action === "create" || link.action === "replace") {
      await ensureDir(dirname(link.path));
      await symlink(link.target, link.path, "dir");
      result.changed.push(link.path);
    }
  }

  let configCreated = false;
  if (plan.config.action === "create" && !(await pathExists(plan.config.path))) {
    await writeFileAtomic(plan.config.path, starter);
    configCreated = true;
    result.changed.push(plan.config.path);
  }

  const createdFiles = await applyProjectInstall(plan, backupDir, result);
  if (configCreated && plan.project !== undefined) createdFiles.push({ path: plan.config.path, sha256: sha256(starter) });
  let hookBackup: string | undefined;
  if (plan.hook !== undefined && plan.hook.action !== "unchanged") {
    const backup = await writeHook(plan.hook, backupDir, result, skipHookBackup, plan.project?.root);
    // Only the backup taken before the entry was first added can restore the file exactly.
    if (plan.hook.action === "create") hookBackup = backup;
  }
  if (plan.project?.exclude !== undefined && plan.project.exclude.action !== "unchanged") result.changed.push(plan.project.exclude.path);

  const manifest = installManifest(plan, now, {
    config: { path: plan.config.path, created: configCreated },
    hooks: hookRecords(plan, hookCreated, hookBackup),
    backups: result.backups,
    project: plan.project === undefined ? undefined : projectRecord(plan, [...createdFiles, ...createdIgnores], await existing(plan.project.missingDirs)),
  });
  await writeManifest(plan.manifestPath, pruneRetired(mergeManifest(plan.previous, manifest), plan));
  return result;
}

// The mirror of the install order: the exclude block changes last, so a run that fails midway leaves
// every remaining path hidden from git, and the next run finishes the work.
export async function applyUninstall(plan: UninstallPlan, now: Date): Promise<ApplyResult> {
  if (plan.project !== undefined) {
    for (const path of [plan.stateDir, join(plan.stateDir, "backups"), plan.config.path, plan.manifest.path]) await projectWriteTarget(plan.project.root, path);
    for (const hook of plan.hooks) await projectWriteTarget(plan.project.root, hook.settingsPath);
    if (plan.project.gitignore !== undefined) await projectWriteTarget(plan.project.root, plan.project.gitignore.path);
  }
  const result: ApplyResult = { changed: [], backups: [] };
  const backupDir = backupDirFor(plan.stateDir, now, plan.project?.root);
  await removeScratchDirs(plan.scratch, result);

  for (const link of plan.links) {
    if (link.action !== "remove") continue;
    await removePath(link.path);
    result.changed.push(link.path);
  }
  for (const skill of plan.skills) {
    if (skill.action !== "remove") continue;
    if (skill.backup === true) {
      const backup = join(await backupDir(), "agents", skill.name);
      await movePath(skill.path, backup);
      result.backups.push(backup);
      result.changed.push(skill.path);
      continue;
    }
    await removeSkillDir(skill.path);
    result.changed.push(skill.path);
  }
  for (const hook of plan.hooks) await writeHook(hook, backupDir, result, false, plan.project?.root);
  if (plan.project?.shim !== undefined) {
    await removePath(plan.project.shim.path);
    result.changed.push(plan.project.shim.path);
  }
  if (plan.project?.gitignore !== undefined) {
    await writeFileStep(plan.project.gitignore, undefined, plan.project.root);
    result.changed.push(plan.project.gitignore.path);
  }
  for (const file of plan.project?.files ?? []) {
    if (file.action !== "remove") continue;
    const text = await readFileIfExists(file.path);
    if (text === undefined || sha256(text) !== file.sha256) continue;
    await removePath(file.path);
    result.changed.push(file.path);
  }
  if (plan.config.action === "remove") {
    await removePath(plan.config.path);
    result.changed.push(plan.config.path);
  }
  if (plan.manifest.action === "remove") {
    await removePath(plan.manifest.path);
    result.changed.push(plan.manifest.path);
  } else if (plan.manifest.rewrite !== undefined) {
    await writeManifest(plan.manifest.path, plan.manifest.rewrite);
    result.changed.push(plan.manifest.path);
  }
  const ignore = plan.project?.backupsIgnore;
  if (ignore !== undefined) {
    const entries = await readdir(dirname(ignore.path)).catch(() => []);
    const text = await readFileIfExists(ignore.path);
    if (entries.length === 1 && entries[0] === ".gitignore" && text !== undefined && sha256(text) === ignore.sha256) {
      await removePath(ignore.path);
    }
  }
  for (const dir of plan.project?.emptyDirs ?? []) await removeEmptyDir(dir);
  if (plan.project?.exclude !== undefined) {
    await writeFileStep(plan.project.exclude);
    result.changed.push(plan.project.exclude.path);
  }
  if (plan.purge && plan.scope === "user") {
    try {
      await rmdir(plan.stateDir);
      result.changed.push(plan.stateDir);
    } catch {
      // The directory is missing or still holds user files, such as backups or roles.
    }
  }
  return result;
}
