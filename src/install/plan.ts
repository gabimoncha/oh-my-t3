import { createHash } from "node:crypto";
import { lstat, readdir, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  claudeSettingsPath,
  configDir,
  evidenceDir,
  findProjectRoot,
  isWithin,
  ledgerPath,
  manifestPath,
  omtDir,
  plansDir,
  projectClaudeSettingsPath,
  projectConfigPath,
  projectInstallDirs,
  projectManifestPath,
  projectShimPath,
  projectSkillRoots,
  skillRoots,
  userConfigPath,
} from "../paths.ts";
import { loadConfig } from "../config/load.ts";
import type { Capabilities, CliContext, HarnessReport } from "../types.ts";
import { usageError } from "../util/errors.ts";
import { errorCode, hashDir, isSymlink, lstatIfExists, pathExists, readFileIfExists, realOrSelf } from "../util/fs.ts";
import { plural } from "../util/output.ts";
import { hookCommand, planHookInstall, planHookRemoval, shimHookCommand } from "./claudeHook.ts";
import type { HookChange } from "./claudeHook.ts";
import { projectWriteTarget, resolveReal } from "./fsops.ts";
import { allDetected, DEFAULT_HARNESSES, detectHarnesses, formatHarnessLine, formatHarnessValue, harnessEffects } from "./harness.ts";
import { classifyLink, planLinks } from "./links.ts";
import type { LinkRoot, LinkRootName, SkippedRoot } from "./links.ts";
import { manifestText, readManifest, rebaseManifest } from "./manifest.ts";
import type { Manifest, ManifestExcludeFile, ManifestExisting, ManifestFile } from "./manifest.ts";
import {
  assertInstallSource,
  excludeBlockLines,
  excludeBlockRoots,
  excludePattern,
  findGitExclude,
  isManagedShim,
  runtimeOf,
  SCRATCH_NAME,
  scratchPattern,
  shimContent,
  shimTarget,
  withExcludeBlock,
  withGitignoreLines,
  withoutExcludeBlocks,
} from "./project.ts";
import type { Runner } from "./project.ts";
import { classifySkill, isManagedDir, listBundledSkills, OPT_IN_SKILLS, readMarker, selectedSkills } from "./skills.ts";

export type TargetName = "agents" | LinkRootName;
export const TARGET_NAMES: readonly TargetName[] = ["agents", "claude", "gemini"];

export type PlanAction = "create" | "update" | "unchanged" | "conflict" | "replace" | "remove" | "keep";

export interface SkillStep {
  name: string;
  source: string;
  path: string;
  sourceHash: string;
  installedHash?: string; // update: the hash of the installed skill; the apply replaces only a folder that still has it
  action: PlanAction;
  reason?: string;
  backup?: boolean; // uninstall --force: move a locally modified skill to the backups before removal
  existed?: boolean; // uninstall --project: kept, because it was in place before the install
  retired?: boolean; // install: a managed skill that the bundle no longer ships, or an opt-in skill that the scope did not select
}

export interface LinkStep {
  root: LinkRootName;
  name: string;
  path: string;
  target: string;
  action: PlanAction;
  reason?: string;
  existed?: boolean; // uninstall --project: kept, because it was in place before the install
  retired?: boolean; // install: points at a retired skill that the plan removes
}

export interface ConfigStep {
  path: string;
  action: PlanAction;
  reason?: string;
  harnesses?: string[]; // install: the harnesses key that a created starter gets
}

// install: the harness detection, and what it means for the config.
export interface HarnessStep {
  report: HarnessReport;
  hint?: string; // the existing config's effective harnesses differ from the recommendation
}

export interface HookStep extends Omit<HookChange, "action"> {
  action: PlanAction;
  removeFile?: boolean; // uninstall --project: the install created the file, and only {} is left
}

// A text file that the plan rewrites as a whole. `before` is undefined when the file is missing.
export interface FileStep {
  path: string;
  action: PlanAction;
  before: string | undefined;
  after: string;
  reason?: string;
  deleteFile?: boolean; // delete the file instead of writing an empty `after`
  removeDir?: string; // then remove this directory when it is empty
}

export type InstallScope = "user" | "project";

// Where one scope keeps its files. `stateDir` holds the backups.
export interface ScopePaths {
  scope: InstallScope;
  root?: string;
  agentsRoot: string;
  linkRoots: Partial<Record<LinkRootName, string>>;
  stateDir: string;
  configPath: string;
  manifestPath: string;
  settingsPath: string;
}

// A project root whose paths are the user-scope paths (the home directory, for example) would make
// a project install write, and a project uninstall delete, the user install.
async function assertProjectRoot(ctx: CliContext, root: string): Promise<void> {
  const user = skillRoots(ctx.env, ctx.homedir);
  const project = projectSkillRoots(root);
  const pairs: [string, string][] = [
    [root, ctx.homedir],
    [project.agents, user.agents],
    [project.claude, user.claude],
    [projectClaudeSettingsPath(root), claudeSettingsPath(ctx.env, ctx.homedir)],
    [omtDir(root), configDir(ctx.env, ctx.homedir)],
  ];
  const resolved = await Promise.all(pairs.map(async ([a, b]) => [await resolveReal(a), await resolveReal(b)]));
  if (resolved.some(([a, b]) => a === b)) {
    throw usageError(
      `refusing --project: the project root ${root} is your home directory or shares paths with the user install`,
      "run the command inside a project directory (run git init there first when it has no .git), or drop --project for the user install",
    );
  }
}

export async function scopePaths(ctx: CliContext, scope: InstallScope): Promise<ScopePaths> {
  if (scope === "user") {
    const roots = skillRoots(ctx.env, ctx.homedir);
    return {
      scope,
      agentsRoot: roots.agents,
      linkRoots: { claude: roots.claude, gemini: roots.gemini },
      stateDir: configDir(ctx.env, ctx.homedir),
      configPath: userConfigPath(ctx.env, ctx.homedir),
      manifestPath: manifestPath(ctx.env, ctx.homedir),
      settingsPath: claudeSettingsPath(ctx.env, ctx.homedir),
    };
  }
  const root = findProjectRoot(ctx.cwd);
  await assertProjectRoot(ctx, root);
  const roots = projectSkillRoots(root);
  for (const path of [omtDir(root), roots.agents, roots.claude]) await projectWriteTarget(root, path);
  return {
    scope,
    root,
    agentsRoot: roots.agents,
    linkRoots: { claude: roots.claude },
    stateDir: omtDir(root),
    configPath: projectConfigPath(root),
    manifestPath: projectManifestPath(root),
    settingsPath: projectClaudeSettingsPath(root),
  };
}

export interface ProjectInstallSteps {
  root: string;
  plans: { path: string; action: PlanAction };
  gitignore: FileStep;
  shim: FileStep;
  exclude?: FileStep;
  excludeNote?: string; // why there is no exclude step, or why it removes the block
  excludeFile?: ManifestExcludeFile; // what the install changed in the exclude file
  shared?: boolean; // the exclude file serves other worktrees too
  gitignoreRestore?: { before: string; sha256: string };
  omtDirCreated: boolean;
  settingsCreated: boolean;
  configCreated: boolean; // an install created .omt/config.jsonc
  gitignoreCreated: boolean; // an install created .omt/.gitignore
  existing: ManifestExisting; // skills and links in place before the first install; the uninstall keeps them
  missingDirs: string[]; // directories absent before this run; the manifest records the ones the run creates
}

export interface InstallPlan {
  scope: InstallScope;
  sync?: boolean; // omt update: conflicts are kept, and a kept path changes no ownership
  version: string;
  targets: TargetName[];
  agentsRoot: string;
  stateDir: string;
  manifestPath: string;
  skills: SkillStep[];
  links: LinkStep[];
  skippedRoots: SkippedRoot[];
  config: ConfigStep;
  harnesses?: HarnessStep;
  hook?: HookStep;
  previous?: Manifest;
  optIn: string[]; // the opt-in skills that this scope selected, with --with now or in an earlier install
  project?: ProjectInstallSteps;
  scratch: string[]; // scratch directories that an interrupted run left next to the agents root
}

// A file that the install created; removed only while it holds what the install wrote.
export interface CreatedFileStep {
  path: string;
  sha256: string;
  action: PlanAction;
  reason?: string;
}

export interface ProjectUninstallSteps {
  root: string;
  shim?: { path: string; action: PlanAction };
  exclude?: FileStep;
  gitignore?: FileStep; // gives back an existing .omt/.gitignore that a --no-git-exclude install appended to
  files: CreatedFileStep[];
  backupsDir: string;
  backupsIgnore?: ManifestFile; // the backups .gitignore that an install created; removed when it is the last file there
  emptyDirs: string[]; // removed after the other steps when they are empty, in this order
}

export interface UninstallPlan {
  scope: InstallScope;
  stateDir: string;
  links: LinkStep[];
  skills: SkillStep[];
  hooks: HookStep[];
  config: ConfigStep;
  manifest: { path: string; action: PlanAction; reason?: string; rewrite?: Manifest }; // `rewrite`: the reduced manifest to write
  purge: boolean;
  project?: ProjectUninstallSteps;
  scratch: string[];
}

export async function parseTargets(value: string | undefined, homedir: string, scope: InstallScope = "user"): Promise<TargetName[]> {
  const selected = new Set<TargetName>(["agents"]);
  if (value === undefined) {
    selected.add("claude");
    if (scope === "user" && (await pathExists(join(homedir, ".gemini")))) selected.add("gemini");
  } else {
    for (const raw of value.split(",")) {
      const name = raw.trim();
      if (name === "") continue;
      if (!(TARGET_NAMES as readonly string[]).includes(name)) {
        throw usageError(`unknown target "${name}"`, "use a comma-separated subset of agents, claude, gemini");
      }
      if (name === "gemini" && scope === "project") {
        throw usageError("the gemini target is not available with --project", "Antigravity reads <project>/.agents/skills directly");
      }
      selected.add(name as TargetName);
    }
  }
  return TARGET_NAMES.filter((name) => selected.has(name));
}

export interface InstallOptions {
  targets: TargetName[];
  hooks: boolean;
  force: boolean;
  scope?: InstallScope;
  gitExclude?: boolean; // project scope only; default true
  capabilities?: Capabilities | undefined; // for the harness detection
  sync?: boolean; // omt update: keep each conflict, create no config, detect no harness, ignore force
  with?: string[]; // opt-in skills to install; the scope's recorded opt-in skills stay selected without it
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

async function isFileOrLinkToFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function fileAction(before: string | undefined, after: string): PlanAction {
  if (before === undefined) return "create";
  return before === after ? "unchanged" : "update";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Reads the manifest of the scope. A project manifest is rebased onto the current root, and `from`
// is the root it was written in when that differs (a copied, moved, or aliased project).
export async function loadScopeManifest(paths: ScopePaths): Promise<{ manifest?: Manifest; from?: string }> {
  const manifest = await readManifest(paths.manifestPath);
  if (manifest === undefined) return {};
  if (paths.root === undefined) return { manifest };
  const from = manifest.root !== undefined && manifest.root !== paths.root ? manifest.root : undefined;
  return { manifest: rebaseManifest(manifest, paths.root), ...(from === undefined ? {} : { from }) };
}

// Blocks in the exclude file that belong to no live project: another spelling of this root (a
// symlink, or /tmp and /private/tmp), a root that no longer exists, and the old root of a copied
// or moved project when that root keeps no install of its own in this exclude file.
async function staleExcludeRoots(root: string, excludePath: string, text: string | undefined, from?: string): Promise<string[]> {
  const stale: string[] = [];
  for (const other of excludeBlockRoots(text)) {
    if (other === root) continue;
    if (realOrSelf(other) === realOrSelf(root) || !(await pathExists(other))) {
      stale.push(other);
      continue;
    }
    if (other !== from) continue;
    const otherExclude = (await findGitExclude(other)).path;
    const otherManifest = await readManifest(projectManifestPath(other)).catch(() => undefined);
    if (otherExclude === undefined || realOrSelf(otherExclude) !== realOrSelf(excludePath) || otherManifest?.root !== other) {
      stale.push(other);
    }
  }
  return stale;
}

// What the first install changed in an exclude file that the block of another root already holds,
// read from that root's manifest. Worktrees share the file, and the root that removes the last block
// must undo those changes, whichever root it is.
async function sharedExcludeFacts(excludePath: string, text: string | undefined, skip: string[]): Promise<ManifestExcludeFile | undefined> {
  for (const other of excludeBlockRoots(text)) {
    if (skip.includes(other)) continue;
    const project = (await readManifest(projectManifestPath(other)).catch(() => undefined))?.project;
    if (project?.excludeFile !== undefined && project.gitExclude !== undefined && realOrSelf(project.gitExclude) === realOrSelf(excludePath)) {
      return project.excludeFile;
    }
  }
  return undefined;
}

// A worktree reads the exclude file of the common git directory, which every worktree shares.
async function isSharedExclude(excludePath: string): Promise<boolean> {
  return (await listDir(join(dirname(dirname(excludePath)), "worktrees"))).length > 0;
}

async function listScratch(agentsRoot: string): Promise<string[]> {
  const parent = dirname(agentsRoot);
  return (await listDir(parent)).filter((name) => SCRATCH_NAME.test(name)).map((name) => join(parent, name));
}

// Patterns, anchored at the repository top level, for every file that the install writes or created.
// Empty directories need no pattern, because git never shows them.
function excludeEntries(
  root: string,
  top: string,
  plan: InstallPlan,
  project: Omit<ProjectInstallSteps, "exclude" | "excludeNote">,
): string[] {
  // A skill or link that was in place before the install stays visible to git, as it was before.
  const existingSkills = new Set(project.existing.skills.map((name) => join(plan.agentsRoot, name)));
  const existingLinks = new Set(project.existing.links);
  const skills = new Set(
    [...plan.skills.map((step) => step.path), ...(plan.previous?.skills ?? []).map((name) => join(plan.agentsRoot, name))].filter(
      (path) => !existingSkills.has(path),
    ),
  );
  const links = new Set(
    [...plan.links.map((link) => link.path), ...(plan.previous?.links ?? []).map((link) => link.path)].filter((path) => !existingLinks.has(path)),
  );
  const rel = (path: string) => excludePattern(top, path);
  const entries = [...[...skills].sort().map((path) => excludePattern(top, path, true)), ...[...links].sort().map(rel)];
  const omt = omtDir(root);
  entries.push(scratchPattern(top, plan.agentsRoot));
  entries.push(excludePattern(top, dirname(project.shim.path), true), rel(projectManifestPath(root)), excludePattern(top, join(omt, "backups"), true));
  if (project.configCreated) entries.push(rel(plan.config.path));
  if (project.gitignoreCreated) entries.push(rel(project.gitignore.path));
  if (project.settingsCreated) entries.push(rel(projectClaudeSettingsPath(root)));
  return entries;
}

// The exclude step after the blocks of `roots` go; it deletes a file that the install created.
function excludeRemoval(path: string, before: string, roots: string[], state: ManifestExcludeFile | undefined): FileStep {
  const after = withoutExcludeBlocks(before, roots, state?.addedNewline === true);
  const step: FileStep = { path, before, after, action: "remove" };
  if (after === "" && state?.created === true) {
    step.deleteFile = true;
    if (state.dirCreated) step.removeDir = dirname(path);
  }
  return step;
}

// A skill or link counts as existing when it was in place before the first install of this root: the
// plan finds it in place (`unchanged` or `update`), and no earlier install of this root created it.
function existingPaths(plan: InstallPlan): ManifestExisting {
  const previous = plan.previous;
  const ownedSkills = new Set(previous?.skills ?? []);
  const ownedLinks = new Set((previous?.links ?? []).map((link) => link.path));
  const existing = previous?.project?.existing;
  const keeps = (action: PlanAction, wasExisting: boolean, owned: boolean) =>
    (action === "unchanged" || action === "update") && (wasExisting || !owned);
  return {
    skills: [
      ...(existing?.skills ?? []).filter((name) => !plan.skills.some((step) => step.name === name)),
      ...plan.skills
        .filter((step) => keeps(step.action, existing?.skills.includes(step.name) === true, ownedSkills.has(step.name)))
        .map((step) => step.name),
    ],
    links: [
      ...(existing?.links ?? []).filter((path) => !plan.links.some((link) => link.path === path)),
      ...plan.links
        .filter((link) => keeps(link.action, existing?.links.includes(link.path) === true, ownedLinks.has(link.path)))
        .map((link) => link.path),
    ],
  };
}

// A sync keeps the earlier `existing` entries, and adds each conflict that it keeps and that no earlier
// install owned. The uninstall scan keeps a managed skill or link only when `existing` names it, and the
// exclude block leaves an existing path visible to git.
function syncExistingPaths(plan: InstallPlan): ManifestExisting {
  const previous = plan.previous;
  const ownedSkills = new Set(previous?.skills ?? []);
  const ownedLinks = new Set((previous?.links ?? []).map((link) => link.path));
  const found = existingPaths(plan);
  return {
    skills: [
      ...new Set([
        ...(previous?.project?.existing?.skills ?? []),
        ...found.skills,
        ...plan.skills.filter((step) => step.action === "conflict" && !ownedSkills.has(step.name)).map((step) => step.name),
      ]),
    ],
    links: [
      ...new Set([
        ...(previous?.project?.existing?.links ?? []),
        ...found.links,
        ...plan.links.filter((link) => (link.action === "conflict" || link.action === "keep") && !ownedLinks.has(link.path)).map((link) => link.path),
      ]),
    ],
  };
}

async function planProjectInstall(
  ctx: CliContext,
  plan: InstallPlan,
  root: string,
  gitExclude: boolean,
  from: string | undefined,
  runner: Runner | undefined,
  sync: boolean,
): Promise<ProjectInstallSteps> {
  const previous = plan.previous?.project;
  const previousDirs = new Set(previous?.dirs ?? []);
  const omtDirCreated = previous?.omtDirCreated === true || !(await pathExists(omtDir(root)));
  // A dangling symlink at the settings path is the user's, so only a path with nothing there counts.
  const settingsCreated =
    previous?.settingsCreated === true ||
    (plan.hook !== undefined && plan.hook.before === undefined && !(await pathExists(plan.hook.settingsPath)));
  const configCreated =
    plan.config.action === "create" || (plan.previous?.config?.path === plan.config.path && plan.previous.config.created);
  const plans = plansDir(root);
  const gitignorePath = join(omtDir(root), ".gitignore");
  const gitignoreBefore = await readFileIfExists(gitignorePath);
  // A dangling symlink is the user's, like a dangling settings link: the install leaves it alone, so it
  // never creates a file outside the project.
  const gitignoreDangling = gitignoreBefore === undefined && (await pathExists(gitignorePath));
  const gitignoreRecord = (previous?.files ?? []).find((file) => file.path === gitignorePath);
  // An earlier install created this file and nobody edited it, so the upgrade can append to it.
  const gitignoreUnedited = gitignoreBefore !== undefined && gitignoreRecord?.sha256 === sha256(gitignoreBefore);
  // With the exclude step on, an existing .gitignore stays untouched, because it may be tracked.
  const gitignoreAfter =
    gitExclude && gitignoreBefore !== undefined && !gitignoreUnedited ? gitignoreBefore : withGitignoreLines(gitignoreBefore);
  const gitignoreCreated = !gitignoreDangling && (gitignoreBefore === undefined || gitignoreRecord !== undefined);
  let gitignoreRestore = previous?.gitignoreRestore;
  if (!gitignoreCreated && gitignoreBefore !== undefined && gitignoreAfter !== gitignoreBefore) {
    gitignoreRestore = { before: gitignoreRestore?.before ?? gitignoreBefore, sha256: sha256(gitignoreAfter) };
  }
  const missingDirs = [...previousDirs];
  for (const dir of projectInstallDirs(root)) {
    if (!missingDirs.includes(dir) && !(await pathExists(dir))) missingDirs.push(dir);
  }

  const shimPath = projectShimPath(root);
  const shimIsFile = await isRegularFile(shimPath);
  const shimBefore = shimIsFile ? await readFileIfExists(shimPath) : undefined;
  const shimAfter = shimContent(shimTarget(ctx, runner));
  const shim: FileStep = { path: shimPath, before: shimBefore, after: shimAfter, action: fileAction(shimBefore, shimAfter) };
  if (!shimIsFile && (await pathExists(shimPath))) {
    shim.action = "conflict";
    shim.reason = "exists and is not a file";
  } else if (shimBefore !== undefined && !isManagedShim(shimBefore)) {
    shim.action = "conflict";
    shim.reason = "exists and is not managed by omt";
  }
  const steps: ProjectInstallSteps = {
    root,
    plans: { path: plans, action: (await pathExists(plans)) ? "unchanged" : "create" },
    gitignore: gitignoreDangling
      ? { path: gitignorePath, before: undefined, after: "", action: "keep", reason: "a dangling symlink; left alone" }
      : { path: gitignorePath, before: gitignoreBefore, after: gitignoreAfter, action: fileAction(gitignoreBefore, gitignoreAfter) },
    shim,
    omtDirCreated,
    settingsCreated,
    configCreated,
    gitignoreCreated,
    existing: sync ? syncExistingPaths(plan) : existingPaths(plan),
    ...(gitignoreRestore === undefined ? {} : { gitignoreRestore }),
    missingDirs,
  };
  const found = await findGitExclude(root);
  if (found.path === undefined) {
    steps.excludeNote = gitExclude ? (found.note ?? "no .git") : "--no-git-exclude";
    return steps;
  }
  const before = await readFileIfExists(found.path);
  const stale = await staleExcludeRoots(root, found.path, before, from);
  const owned = [root, ...stale].some((other) => excludeBlockLines(before, other) !== undefined);
  if (!gitExclude) {
    steps.excludeNote = "--no-git-exclude";
    // A block from an earlier run would keep hiding the files that this setup means to commit.
    if (before !== undefined && owned) steps.exclude = excludeRemoval(found.path, before, [root, ...stale], previous?.excludeFile);
    return steps;
  }
  const after = withExcludeBlock(before, root, excludeEntries(root, found.top ?? root, plan, steps), stale);
  steps.exclude = {
    path: found.path,
    before,
    after,
    action: before === after ? "unchanged" : excludeBlockLines(before, root) === undefined && !owned ? "create" : "update",
  };
  steps.excludeFile = owned
    ? (previous?.excludeFile ?? { created: false, dirCreated: false, addedNewline: false })
    : ((await sharedExcludeFacts(found.path, before, [root, ...stale])) ?? {
        created: before === undefined,
        dirCreated: !(await pathExists(dirname(found.path))),
        addedNewline: before !== undefined && before !== "" && !before.endsWith("\n"),
      });
  steps.shared = await isSharedExclude(found.path);
  return steps;
}

function sameDrivers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((driver) => b.includes(driver));
}

// A created config gets the recommended harnesses when a default harness is missing. An existing config
// is never edited; the step only says when its effective value differs from the recommendation.
async function planHarnesses(ctx: CliContext, config: ConfigStep, capabilities?: Capabilities): Promise<HarnessStep> {
  const report = await detectHarnesses({ env: ctx.env, homedir: ctx.homedir, capabilities });
  if (config.action === "create") {
    if (!allDetected(report) && report.recommended.length > 0) config.harnesses = report.recommended;
    return { report };
  }
  const effective = (await loadConfig(ctx)).config.harnesses ?? DEFAULT_HARNESSES;
  return sameDrivers(effective, report.recommended) || report.recommended.length === 0
    ? { report }
    : { report, hint: "run omt detect --write" };
}

export async function buildInstallPlan(ctx: CliContext, options: InstallOptions): Promise<InstallPlan> {
  const scope = options.scope ?? "user";
  const paths = await scopePaths(ctx, scope);
  const runner = assertInstallSource(ctx.cliPath, ctx.env, scope);
  let command: string | undefined;
  if (options.hooks) {
    command =
      paths.root === undefined
        ? hookCommand(ctx.build === "binary" ? undefined : runtimeOf(ctx), ctx.cliPath)
        : shimHookCommand(projectShimPath(paths.root));
  }
  const bundled = await listBundledSkills(ctx.packageRoot);
  const { manifest: previous, from } = await loadScopeManifest(paths);
  const optIn = selectOptIn(previous, options.with ?? [], bundled.map((skill) => skill.name));
  const selected = selectedSkills(bundled, optIn);
  const skills: SkillStep[] = [];
  for (const skill of selected) {
    const path = join(paths.agentsRoot, skill.name);
    const result = await classifySkill(skill.dir, path);
    const step: SkillStep = { name: skill.name, source: skill.dir, path, ...result };
    // classifySkill returns update only for an unmodified skill, so its marker records the hash of its files.
    const installedHash = result.action === "update" ? (await readMarker(path))?.hash : undefined;
    if (installedHash !== undefined) step.installedHash = installedHash;
    skills.push(step);
  }
  const linkRoots: LinkRoot[] = [];
  for (const name of options.targets) {
    if (name === "agents") continue;
    const path = paths.linkRoots[name];
    if (path !== undefined) linkRoots.push({ name, path });
  }
  const linkPlan = await planLinks(
    paths.agentsRoot,
    linkRoots,
    selected.map((skill) => skill.name),
  );
  const links: LinkStep[] = linkPlan.links.map(({ canonical: _canonical, ...link }) => link);
  await planRetired(paths, previous, bundled, optIn, skills, links);
  const sync = options.sync === true;
  const config: ConfigStep = { path: paths.configPath, action: (await pathExists(paths.configPath)) ? "unchanged" : "create" };
  if (sync && config.action === "create") {
    config.action = "keep";
    config.reason = "absent; omt update creates no config";
  }
  const plan: InstallPlan = {
    scope,
    ...(sync ? { sync } : {}),
    version: ctx.version,
    targets: options.targets,
    agentsRoot: paths.agentsRoot,
    stateDir: paths.stateDir,
    manifestPath: paths.manifestPath,
    skills,
    links,
    skippedRoots: linkPlan.skipped,
    config,
    optIn,
    scratch: paths.root === undefined ? [] : await listScratch(paths.agentsRoot),
  };
  if (previous !== undefined) plan.previous = previous;
  if (sync) {
    const unmanaged = new Set(skills.filter((step) => step.action === "conflict" && step.reason !== "locally modified").map((step) => step.name));
    for (const link of links) {
      if (link.action !== "create" || !unmanaged.has(link.name)) continue;
      link.action = "keep";
      link.reason = "points at a skill that omt does not manage";
    }
  }
  if (!sync) plan.harnesses = await planHarnesses(ctx, plan.config, options.capabilities);
  if (command !== undefined) {
    if (paths.root !== undefined) await projectWriteTarget(paths.root, paths.settingsPath);
    plan.hook = await planHookInstall(paths.settingsPath, command);
  }
  if (paths.root !== undefined) {
    plan.project = await planProjectInstall(ctx, plan, paths.root, options.gitExclude !== false, from, runner, sync);
    if (plan.project.gitignore.action === "create" || plan.project.gitignore.action === "update") {
      await projectWriteTarget(paths.root, plan.project.gitignore.path);
    }
  }
  if (sync) {
    // An update runs with --yes or from an automatic check, so it never replaces what the user owns or edited.
    for (const step of replaceableSteps(plan)) {
      if (step.action !== "conflict") continue;
      step.action = "keep";
      step.reason =
        step.reason !== "locally modified"
          ? "not managed by omt"
          : (step as SkillStep).retired === true
            ? `locally modified; ${retiredReason(step.path)}; omt install --force backs it up and removes it`
            : "locally modified; omt install --force replaces it";
    }
  } else if (options.force) {
    for (const step of replaceableSteps(plan)) {
      if (step.action === "conflict") step.action = "replace";
    }
  }
  // A link to a kept retired skill stays, because the skill stays.
  const removed = new Set(skills.filter(removesRetired).map((step) => step.name));
  plan.links = links.filter((link) => link.retired !== true || removed.has(link.name));
  return plan;
}

// True for a retired skill or link that the apply removes (`replace` backs the skill up first).
export function removesRetired(step: { retired?: boolean; action: PlanAction }): boolean {
  return step.retired === true && (step.action === "remove" || step.action === "replace");
}

// The opt-in skills that a scope selects: the names that its manifest records and the names of --with.
// A name of --with must be an opt-in skill; any other name is a usage error.
function selectOptIn(previous: Manifest | undefined, requested: readonly string[], bundled: readonly string[]): string[] {
  for (const name of requested) {
    if (OPT_IN_SKILLS.includes(name)) continue;
    const known = bundled.includes(name);
    throw usageError(
      known ? `--with ${name}: ${name} is installed by default; --with takes only an opt-in skill` : `--with ${name}: unknown skill`,
      `the opt-in skills are ${OPT_IN_SKILLS.join(", ")}`,
    );
  }
  return OPT_IN_SKILLS.filter((name) => requested.includes(name) || previous?.optIn?.includes(name) === true);
}

// The reason of a retired step: an opt-in skill that the scope did not select, or a skill that the bundle no longer ships.
function retiredReason(path: string): string {
  return OPT_IN_SKILLS.includes(basename(path)) ? "opt-in, not selected" : "no longer shipped";
}

// The names of the skills that an earlier install of this scope wrote and that the scope no longer
// installs: the bundle no longer ships them, or they are opt-in skills that `optIn` does not select
// (default: the manifest's own `optIn`). Ownership is tied to the recorded root. Missing folders still
// count so install can remove their recorded dangling links. A folder in place before a project install
// stays the user's.
export async function retiredSkills(
  agentsRoot: string,
  manifest: Manifest | undefined,
  bundled: readonly string[],
  optIn: readonly string[] = manifest?.optIn ?? [],
): Promise<string[]> {
  if (manifest === undefined || manifest.skillsRoot === "" || await resolveReal(manifest.skillsRoot) !== await resolveReal(agentsRoot)) return [];
  const shipped = selectedSkills(bundled, optIn);
  const existing = manifest?.project?.existing?.skills ?? [];
  const names: string[] = [];
  for (const name of manifest?.skills ?? []) {
    if (shipped.includes(name) || existing.includes(name) || name !== basename(name) || name === "." || name === "..") continue;
    const path = join(agentsRoot, name);
    if (await isManagedDir(path) || await lstatIfExists(path) === undefined) names.push(name);
  }
  return names;
}

// Adds a remove step for each retired skill, and for each link in a link root of the scope that resolves
// to it. An edited retired skill is a conflict, as an edited bundled skill is.
async function planRetired(
  paths: ScopePaths,
  manifest: Manifest | undefined,
  bundled: { name: string }[],
  optIn: readonly string[],
  skills: SkillStep[],
  links: LinkStep[],
): Promise<void> {
  const names = await retiredSkills(paths.agentsRoot, manifest, bundled.map((skill) => skill.name), optIn);
  const existingLinks = manifest?.project?.existing?.links ?? [];
  const linkRoots = Object.entries(paths.linkRoots) as [LinkRootName, string][];
  for (const name of names) {
    const path = join(paths.agentsRoot, name);
    const missing = await lstatIfExists(path) === undefined;
    const reason = retiredReason(path);
    const step: SkillStep = { name, source: "", path, sourceHash: "", action: "remove", reason, retired: true };
    if (!missing && await isLocallyModified(path)) {
      step.action = "conflict";
      step.reason = "locally modified";
    } else {
      const hash = (await readMarker(path))?.hash;
      if (hash !== undefined) step.installedHash = hash;
    }
    skills.push(step);
    const candidates = linkRoots.map(([root, dir]) => ({ root, path: join(dir, name) }));
    for (const link of manifest?.links ?? []) {
      if (basename(link.path) !== name || (paths.root !== undefined && !isWithin(paths.root, link.path))) continue;
      candidates.push({ root: "claude", path: link.path });
    }
    const seen = new Set<string>();
    for (const { root, path: linkPath } of candidates) {
      const key = join(await resolveReal(dirname(linkPath)), name);
      if (seen.has(key) || existingLinks.includes(linkPath)) continue;
      seen.add(key);
      if (missing && !manifest?.links.some((link) => link.path === linkPath)) continue;
      if ((await classifyLink(linkPath, path)).action !== "unchanged") continue;
      links.push({ root, name, path: linkPath, target: await readlink(linkPath), action: "remove", reason, retired: true });
    }
  }
}

export function replaceableSteps(plan: InstallPlan): { action: PlanAction; path: string; reason?: string }[] {
  return [...plan.skills, ...plan.links, ...(plan.project === undefined ? [] : [plan.project.shim])];
}

export function installConflicts(plan: InstallPlan): number {
  return replaceableSteps(plan).filter((step) => step.action === "conflict").length;
}

export function installHasChanges(plan: InstallPlan): boolean {
  const steps: { action: PlanAction }[] = [...plan.skills, ...plan.links, plan.config];
  if (plan.scratch.length > 0) return true;
  if (plan.hook !== undefined) steps.push(plan.hook);
  if (plan.project !== undefined) {
    steps.push(plan.project.plans, plan.project.gitignore, plan.project.shim);
    if (plan.project.exclude !== undefined) steps.push(plan.project.exclude);
  }
  return steps.some((step) => step.action !== "unchanged" && step.action !== "keep");
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

// Returns the real path of a symlink that resolves to a managed skill directory.
async function managedLinkTarget(path: string): Promise<string | undefined> {
  if (!(await isSymlink(path))) return undefined;
  try {
    const target = await realpath(path);
    return (await isManagedDir(target)) ? target : undefined;
  } catch {
    return undefined;
  }
}

async function isLocallyModified(dir: string): Promise<boolean> {
  const marker = await readMarker(dir);
  return marker == null || (await hashDir(dir)) !== marker.hash;
}

// The result is compared with fs.promises.realpath in managedLinkTarget.
async function nativeRealOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

async function planProjectUninstall(root: string, manifest: Manifest | undefined, paths: ScopePaths): Promise<ProjectUninstallSteps> {
  const created = new Set(manifest?.project?.dirs ?? []);
  const omt = omtDir(root);
  const backupsDir = join(omt, "backups");
  const candidates = [
    dirname(projectShimPath(root)),
    backupsDir,
    plansDir(root),
    paths.agentsRoot,
    dirname(paths.agentsRoot),
    ...Object.values(paths.linkRoots).flatMap((dir) => [dir, dirname(dir)]),
    omt,
  ];
  const steps: ProjectUninstallSteps = {
    root,
    files: [],
    backupsDir,
    emptyDirs: candidates.filter((dir) => created.has(dir)),
  };
  const shimPath = manifest?.project?.shim ?? projectShimPath(root);
  if ((await isRegularFile(shimPath)) && isManagedShim(await readFileIfExists(shimPath))) steps.shim = { path: shimPath, action: "remove" };
  const gitignorePath = join(omt, ".gitignore");
  // The ledger and the evidence stay, so a created .omt/.gitignore stays to keep them out of git.
  const dataStays = (await pathExists(ledgerPath(root))) || (await pathExists(evidenceDir(root)));
  for (const file of manifest?.project?.files ?? []) {
    if (file.path === paths.configPath) continue;
    if (file.path === join(backupsDir, ".gitignore")) {
      steps.backupsIgnore = file;
      continue;
    }
    const text = (await isRegularFile(file.path)) ? await readFileIfExists(file.path) : undefined;
    if (text === undefined) continue;
    if (sha256(text) !== file.sha256) {
      steps.files.push({ ...file, action: "keep", reason: "edited after the install" });
    } else if (file.path === gitignorePath && dataStays) {
      steps.files.push({ ...file, action: "keep", reason: "keeps the ledger and evidence that stay out of git" });
    } else {
      steps.files.push({ ...file, action: "remove" });
    }
  }
  const restore = manifest?.project?.gitignoreRestore;
  if (restore !== undefined) {
    // A manifest hash does not authorize a destination outside the project.
    const text = (await isFileOrLinkToFile(gitignorePath)) ? await readFileIfExists(gitignorePath) : undefined;
    if (text !== undefined && sha256(text) === restore.sha256) {
      await projectWriteTarget(root, gitignorePath);
      steps.gitignore = { path: gitignorePath, before: text, after: restore.before, action: "update", reason: "removes the lines that the install added" };
    }
  }
  return steps;
}

async function createdThatStays(plan: UninstallPlan, root: string, manifest: Manifest | undefined): Promise<{ config: boolean; settings: boolean }> {
  const config = plan.config.action === "keep" && manifest?.config?.path === plan.config.path && manifest.config.created === true;
  // A settings file that the install created stays when other keys are left in it, such as the
  // permissions that Claude Code writes there.
  const settingsPath = projectClaudeSettingsPath(root);
  const settings =
    manifest?.project?.settingsCreated === true &&
    (await pathExists(settingsPath)) &&
    !plan.hooks.some((hook) => hook.settingsPath === settingsPath && hook.removeFile === true);
  return { config, settings };
}

// The record of the created files that stay after an uninstall, so a later install or uninstall still
// counts them as created and keeps their block entries. Undefined when none stays.
function reducedManifest(
  plan: UninstallPlan,
  root: string,
  manifest: Manifest | undefined,
  stays: { config: boolean; settings: boolean },
): Manifest | undefined {
  if (manifest === undefined || plan.project === undefined) return undefined;
  const project = plan.project;
  const files: ManifestFile[] = project.files.filter((file) => file.action === "keep").map(({ path, sha256 }) => ({ path, sha256 }));
  const configRecord = manifest.project?.files?.find((file) => file.path === plan.config.path);
  if (stays.config && configRecord !== undefined) files.push(configRecord);
  if (files.length === 0 && !stays.config && !stays.settings) return undefined;
  const excludeFile = manifest.project?.excludeFile;
  const gitExclude = manifest.project?.gitExclude;
  const existing = manifest.project?.existing;
  return {
    scope: "project",
    root,
    package: manifest.package,
    version: manifest.version,
    installedAt: manifest.installedAt,
    skillsRoot: manifest.skillsRoot,
    skills: [],
    links: [],
    ...(stays.config && manifest.config !== undefined ? { config: manifest.config } : {}),
    hooks: [],
    backups: [],
    project: {
      omtDirCreated: manifest.project?.omtDirCreated === true,
      settingsCreated: stays.settings,
      ...(gitExclude === undefined ? {} : { gitExclude }),
      ...(excludeFile === undefined ? {} : { excludeFile }),
      ...(existing === undefined ? {} : { existing }),
      files,
      dirs: manifest.project?.dirs ?? [],
    },
  };
}

// True when git cannot see a reduced manifest: the repository's exclude file holds a block of the root
// (or of a stale root that the uninstall rewrites), or there is no repository. Without a block, as
// after a --no-git-exclude install, a reduced manifest would show in git, so the uninstall removes it.
async function blockWillHide(root: string, from: string | undefined): Promise<boolean> {
  const found = await findGitExclude(root);
  if (found.path === undefined) return true;
  const text = await readFileIfExists(found.path);
  if (excludeBlockLines(text, root) !== undefined) return true;
  return (await staleExcludeRoots(root, found.path, text, from)).length > 0;
}

// Rewrites the root's exclude block with the paths that stay after the uninstall, or removes it when
// none stays. Stale blocks (section 14.8) go too.
async function planExcludeAfterUninstall(
  plan: UninstallPlan,
  root: string,
  manifest: Manifest | undefined,
  from: string | undefined,
  stays: { config: boolean; settings: boolean },
): Promise<FileStep | undefined> {
  const found = await findGitExclude(root);
  if (found.path === undefined) return undefined;
  const path = found.path;
  const before = await readFileIfExists(path);
  if (before === undefined) return undefined;
  const stale = await staleExcludeRoots(root, path, before, from);
  if (excludeBlockLines(before, root) === undefined && stale.length === 0) return undefined;
  const top = found.top ?? root;
  const entries = [
    ...plan.skills.filter((skill) => skill.action === "keep" && skill.existed !== true).map((skill) => excludePattern(top, skill.path, true)),
    ...plan.links.filter((link) => link.action === "keep" && link.existed !== true).map((link) => excludePattern(top, link.path)),
    ...(plan.project?.files ?? []).filter((file) => file.action === "keep").map((file) => excludePattern(top, file.path)),
  ];
  if (stays.config) {
    entries.push(excludePattern(top, plan.config.path));
  }
  if (stays.settings) entries.push(excludePattern(top, projectClaudeSettingsPath(root)));
  if (plan.manifest.action === "keep") entries.push(excludePattern(top, plan.manifest.path));
  if (entries.length === 0) {
    const step = excludeRemoval(path, before, [root, ...stale], manifest?.project?.excludeFile);
    return step.after === before ? undefined : step;
  }
  const after = withExcludeBlock(before, root, entries, stale);
  if (after === before) return undefined;
  return { path, before, after, action: "update" };
}

export async function buildUninstallPlan(
  ctx: CliContext,
  options: { purge: boolean; force?: boolean; scope?: InstallScope },
): Promise<UninstallPlan> {
  const scope = options.scope ?? "user";
  const paths = await scopePaths(ctx, scope);
  const manifestFile = paths.manifestPath;
  const { manifest, from } = await loadScopeManifest(paths);

  // The same directory can come under two names (a symlink, /tmp and /private/tmp); plan it once.
  const skillDirs = new Map<string, string>([[await resolveReal(paths.agentsRoot), paths.agentsRoot]]);
  if (manifest !== undefined && manifest.skillsRoot !== "") {
    const key = await resolveReal(resolve(manifest.skillsRoot));
    if (!skillDirs.has(key)) skillDirs.set(key, resolve(manifest.skillsRoot));
  }
  const existing = scope === "project" ? manifest?.project?.existing : undefined;
  const existed = (reason: string) => ({ action: "keep" as const, reason, existed: true });
  const skills: SkillStep[] = [];
  const kept = new Set<string>();
  for (const dir of skillDirs.values()) {
    for (const name of await listDir(dir)) {
      const path = join(dir, name);
      if (!(await isManagedDir(path))) continue;
      const step: SkillStep = { name, source: "", path, sourceHash: "", action: "remove" };
      if (existing?.skills.includes(name) === true) {
        Object.assign(step, existed("existed before the install"));
      } else if (await isLocallyModified(path)) {
        if (options.force === true) {
          step.backup = true;
          step.reason = "locally modified; backed up";
        } else {
          step.action = "keep";
          step.reason = "locally modified";
          kept.add(await nativeRealOrSelf(path));
        }
      }
      skills.push(step);
    }
  }

  const linkCandidates = new Map<string, { path: string; root: LinkRootName; name: string }>();
  const addLink = async (path: string, root: LinkRootName, name: string) => {
    const key = join(await resolveReal(dirname(path)), basename(path));
    if (!linkCandidates.has(key)) linkCandidates.set(key, { path, root, name });
  };
  const linkRoots = Object.entries(paths.linkRoots) as [LinkRootName, string][];
  for (const [root, dir] of linkRoots) {
    for (const name of await listDir(dir)) await addLink(join(dir, name), root, name);
  }
  for (const link of manifest?.links ?? []) {
    const root: LinkRootName = linkRoots.find(([, dir]) => link.path.startsWith(`${dir}/`))?.[0] ?? "claude";
    await addLink(link.path, root, basename(link.path));
  }
  const links: LinkStep[] = [];
  for (const { path, root, name } of linkCandidates.values()) {
    const target = await managedLinkTarget(path);
    if (target === undefined) continue;
    // A project link that points out of the project, such as at the user install, is the user's.
    if (scope === "project" && !skillDirs.has(dirname(target))) continue;
    const link: LinkStep = { root, name, path, target: await readlink(path), action: "remove" };
    if (existing?.links.includes(path) === true) Object.assign(link, existed("existed before the install"));
    else if (kept.has(target)) Object.assign(link, { action: "keep", reason: "points at a kept skill" });
    links.push(link);
  }

  const settingsPaths = new Map<string, string>([[await resolveReal(paths.settingsPath), paths.settingsPath]]);
  for (const hook of manifest?.hooks ?? []) {
    const key = await resolveReal(hook.settingsPath);
    if (!settingsPaths.has(key)) settingsPaths.set(key, hook.settingsPath);
  }
  const hooks: HookStep[] = [];
  for (const settingsPath of settingsPaths.values()) {
    const record = manifest?.hooks.find((hook) => hook.settingsPath === settingsPath);
    const change: HookStep | undefined = await planHookRemoval(settingsPath, record?.backup);
    if (change === undefined) continue;
    const created =
      record?.created === true ||
      (scope === "project" && settingsPath === paths.settingsPath && manifest?.project?.settingsCreated === true);
    if (created && change.empty === true) change.removeFile = true;
    hooks.push(change);
  }

  const configPath = paths.configPath;
  const configExists = await pathExists(configPath);
  const config: ConfigStep = { path: configPath, action: configExists ? (options.purge ? "remove" : "keep") : "unchanged" };
  if (scope === "project" && configExists) {
    const created = manifest?.config?.path === configPath && manifest.config.created;
    const recorded = manifest?.project?.files?.find((file) => file.path === configPath);
    const text = await readFileIfExists(configPath);
    if (!created) {
      config.action = "keep";
      config.reason = "not created by omt install";
    } else if (recorded !== undefined && text !== undefined && sha256(text) === recorded.sha256) {
      config.action = "remove";
    } else if (!options.purge) {
      config.reason = "edited after the install; add --purge to remove it";
    }
  }
  const plan: UninstallPlan = {
    scope,
    stateDir: paths.stateDir,
    links,
    skills,
    hooks,
    config,
    manifest: { path: manifestFile, action: manifest !== undefined || (await pathExists(manifestFile)) ? "remove" : "unchanged" },
    purge: options.purge,
    scratch: paths.root === undefined ? [] : await listScratch(paths.agentsRoot),
  };
  if (paths.root !== undefined) {
    plan.project = await planProjectUninstall(paths.root, manifest, paths);
    const stays = await createdThatStays(plan, paths.root, manifest);
    // The manifest knows which directories the install created; keep it until the last skill goes.
    if (kept.size > 0 && plan.manifest.action === "remove") {
      plan.manifest = { ...plan.manifest, action: "keep", reason: "a locally modified skill is kept" };
    }
    if (plan.manifest.action === "remove" && (await blockWillHide(paths.root, from))) {
      const rewrite = reducedManifest(plan, paths.root, manifest, stays);
      if (rewrite !== undefined) {
        const text = manifestText(rewrite);
        plan.manifest = {
          ...plan.manifest,
          action: "keep",
          reason: "records the created files that stay",
          ...(text === (await readFileIfExists(manifestFile)) ? {} : { rewrite }),
        };
      }
    }
    const exclude = await planExcludeAfterUninstall(plan, paths.root, manifest, from, stays);
    if (exclude !== undefined) plan.project.exclude = exclude;
  }
  return plan;
}

export function uninstallHasChanges(plan: UninstallPlan): boolean {
  return (
    plan.links.some((link) => link.action === "remove") ||
    plan.skills.some((skill) => skill.action === "remove") ||
    plan.hooks.length > 0 ||
    plan.config.action === "remove" ||
    plan.manifest.action === "remove" ||
    plan.manifest.rewrite !== undefined ||
    plan.scratch.length > 0 ||
    plan.project?.shim !== undefined ||
    plan.project?.gitignore !== undefined ||
    plan.project?.exclude !== undefined ||
    plan.project?.files.some((file) => file.action === "remove") === true
  );
}

function line(action: PlanAction, subject: string, reason?: string): string {
  return `  ${action.padEnd(8)} ${subject}${reason === undefined ? "" : `  (${reason})`}\n`;
}

// The lines are info, not plan actions, so they sit deeper than the two-space action lines.
function renderHarnesses(step: HarnessStep, config: ConfigStep): string {
  const { report } = step;
  let text = `Harnesses (${report.source === "local" ? "T3 settings and PATH" : "capabilities"}):\n`;
  for (const harness of report.harnesses) text += `    ${formatHarnessLine(harness)}`;
  if (config.harnesses !== undefined) {
    text += `    the starter config gets "harnesses": ${formatHarnessValue(config.harnesses)}\n`;
    for (const effect of harnessEffects(config.harnesses)) text += `    ${effect}\n`;
  }
  if (report.recommended.length === 0) text += "    no harness detected; sign in to Claude Code or Codex, then run omt detect\n";
  if (step.hint !== undefined) {
    text += `    the config's harnesses differ from the recommendation ${allDetected(report) ? "(no key)" : formatHarnessValue(report.recommended)}; ${step.hint}\n`;
  }
  return text;
}

export function renderInstallPlan(plan: InstallPlan): string {
  let text = `Skills (${plan.agentsRoot}):\n`;
  if (plan.skills.length === 0) text += "  none found in the package\n";
  for (const step of plan.skills) text += line(step.action, step.name, step.reason);
  const roots = new Map<string, LinkStep[]>();
  for (const link of plan.links) roots.set(dirname(link.path), [...(roots.get(dirname(link.path)) ?? []), link]);
  text += "Links:\n";
  if (roots.size === 0 && plan.skippedRoots.length === 0) text += "  none selected\n";
  for (const [root, links] of roots) {
    for (const link of links) text += line(link.action, `${join(root, link.name)} -> ${link.target}`, link.reason);
  }
  for (const skipped of plan.skippedRoots) text += `  skip     ${skipped.path}  (${skipped.reason})\n`;
  text += "Config:\n";
  text += line(plan.config.action, plan.config.path, plan.config.reason);
  if (plan.harnesses !== undefined) text += renderHarnesses(plan.harnesses, plan.config);
  text += "Hooks:\n";
  text +=
    plan.hook === undefined
      ? "  none     (add --hooks to install the Claude Code ultrawork hook)\n"
      : line(plan.hook.action, `Claude UserPromptSubmit in ${plan.hook.settingsPath}`);
  if (plan.project !== undefined) {
    const project = plan.project;
    text += `Project (${project.root}):\n`;
    text += line(project.plans.action, project.plans.path);
    text += line(project.gitignore.action, project.gitignore.path, project.gitignore.reason);
    text += line(project.shim.action, project.shim.path, project.shim.reason);
    text += "Git exclude:\n";
    if (project.exclude === undefined) {
      text += `  skip     (${project.excludeNote ?? "no .git"})\n`;
    } else {
      const reason = project.exclude.action === "remove" ? project.excludeNote : project.shared === true ? "shared by all worktrees" : undefined;
      text += line(project.exclude.action, `managed block in ${project.exclude.path}`, reason);
    }
  }
  for (const dir of plan.scratch) text += line("remove", dir, "left by an interrupted run");
  return text;
}

export function renderUninstallPlan(plan: UninstallPlan): string {
  let text = "Links:\n";
  if (plan.links.length === 0) text += "  none\n";
  for (const link of plan.links) text += line(link.action, link.path, link.reason);
  text += "Skills:\n";
  if (plan.skills.length === 0) text += "  none\n";
  for (const skill of plan.skills) text += line(skill.action, skill.path, skill.reason);
  text += "Hooks:\n";
  if (plan.hooks.length === 0) text += "  none\n";
  for (const hook of plan.hooks) {
    const reason = hook.restoreBackup === undefined ? undefined : `restores the backup ${hook.restoreBackup}`;
    text += line(hook.action, `Claude UserPromptSubmit in ${hook.settingsPath}`, reason);
  }
  text += "Config:\n";
  // "unchanged" here means the file does not exist.
  if (plan.config.action === "unchanged" && plan.manifest.action === "unchanged") text += "  none\n";
  if (plan.config.action !== "unchanged") {
    const reason = plan.config.reason ?? (plan.config.action === "keep" ? "add --purge to remove it" : undefined);
    text += line(plan.config.action, plan.config.path, reason);
  }
  if (plan.manifest.action !== "unchanged") text += line(plan.manifest.action, plan.manifest.path, plan.manifest.reason);
  if (plan.project !== undefined) {
    text += `Project (${plan.project.root}):\n`;
    const { shim, exclude, files, gitignore } = plan.project;
    if (shim === undefined && exclude === undefined && files.length === 0 && gitignore === undefined) text += "  none\n";
    if (plan.project.shim !== undefined) text += line(plan.project.shim.action, plan.project.shim.path);
    for (const file of plan.project.files) text += line(file.action, file.path, file.reason);
    if (gitignore !== undefined) text += line(gitignore.action, gitignore.path, gitignore.reason);
    if (plan.project.exclude !== undefined) {
      const reduced = plan.project.exclude.action === "update" ? "keeps only the paths that stay" : undefined;
      text += line(plan.project.exclude.action, `managed block in ${plan.project.exclude.path}`, reduced);
    }
  }
  for (const dir of plan.scratch) text += line("remove", dir, "left by an interrupted run");
  const kept = plan.skills.filter((skill) => skill.action === "keep" && skill.existed !== true).length;
  if (kept > 0) text += `${plural(kept, "locally modified skill")} kept; add --force to back up and remove them\n`;
  return text;
}
