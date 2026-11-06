import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type Env = Record<string, string | undefined>;

// True when child is parent or a path inside it. A name that starts with two dots, such as `..x`, is
// a child, not a parent segment.
export function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export interface SkillRoots {
  agents: string;
  claude: string;
  gemini: string;
}

function envPath(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

export const STATE_DIR_NAME = ".omt3";
export const LEGACY_STATE_DIR_NAME = ".omt";
export const CONFIG_DIR_NAME = "oh-my-t3";
export const LEGACY_CONFIG_DIR_NAME = "oh-my-t3code";

// A folder pair: the current name, and the name that earlier releases used.
export interface FolderPair {
  current: string;
  legacy: string;
}

function defaultConfigPair(env: Env, homedir: string): FolderPair {
  const base = envPath(env, "XDG_CONFIG_HOME") ?? join(homedir, ".config");
  return { current: join(base, CONFIG_DIR_NAME), legacy: join(base, LEGACY_CONFIG_DIR_NAME) };
}

// Undefined when OMT_CONFIG_DIR names the folder, because then its name is the user's choice.
export function configDirPair(env: Env, homedir: string): FolderPair | undefined {
  return envPath(env, "OMT_CONFIG_DIR") === undefined ? defaultConfigPair(env, homedir) : undefined;
}

// The current folder when it exists, else the legacy folder when it exists, else the current folder.
// An install that has not run omt migrate keeps reading and writing its legacy folder.
function pick(pair: FolderPair): string {
  if (existsSync(pair.current)) return pair.current;
  return existsSync(pair.legacy) ? pair.legacy : pair.current;
}

export function configDir(env: Env, homedir: string): string {
  const explicit = envPath(env, "OMT_CONFIG_DIR");
  if (explicit !== undefined) return explicit;
  return pick(defaultConfigPair(env, homedir));
}

export function userConfigPath(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "config.jsonc");
}

export function manifestPath(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "install.json");
}

export function updateStatePath(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "update-check.json");
}

export function projectsPath(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "projects.json");
}

export function userRolesDir(env: Env, homedir: string): string {
  return join(configDir(env, homedir), "roles");
}

// The main checkout of a linked worktree, read from `<root>/.git` and `commondir` without running git.
// Undefined for a normal checkout, a submodule, a bare or unknown layout, or any read error.
export function mainCheckoutOf(root: string): string | undefined {
  try {
    const dotGit = join(root, ".git");
    if (!lstatSync(dotGit).isFile()) return undefined;
    const first = readFileSync(dotGit, "utf8").split(/\r?\n/, 1)[0] ?? "";
    const match = /^gitdir:\s*(.+?)\s*$/.exec(first);
    if (match === null || match[1] === undefined) return undefined;
    const gitDir = resolve(root, match[1]);
    const commonDir = readFileSync(join(gitDir, "commondir"), "utf8").trim();
    if (commonDir === "") return undefined;
    const common = resolve(gitDir, commonDir);
    if (basename(common) !== ".git" || !statSync(common).isDirectory()) return undefined;
    return isBareRepo(common) ? undefined : dirname(common);
  } catch {
    return undefined;
  }
}

// Reads the plain `bare = true` form that git writes. Hand-edited forms (quoted values, repeated
// keys, an entry on the section line) are not supported. A missing config counts as not bare,
// because git treats such a common dir as a checkout.
function isBareRepo(commonDir: string): boolean {
  const config = join(commonDir, "config");
  if (!existsSync(config)) return false;
  let core = false;
  for (const raw of readFileSync(config, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, "").trim();
    const section = /^\[(.*)\]/.exec(line);
    if (section !== null) {
      core = section[1]?.trim().toLowerCase() === "core";
      continue;
    }
    if (!core) continue;
    const entry = /^bare\s*(?:=\s*(.*))?$/i.exec(line);
    if (entry !== null) return entry[1] === undefined || /^(true|yes|on|1)$/i.test(entry[1].trim());
  }
  return false;
}

export function hasProjectMarker(cwd: string): boolean {
  return nearestMarker(cwd) !== undefined;
}

function nearestMarker(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, STATE_DIR_NAME)) || existsSync(join(dir, LEGACY_STATE_DIR_NAME)) || existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// git writes `gitdir:` as a real path. Rebuilding the main checkout under the nearest ancestor of
// the worktree whose real path contains it keeps the root that a main-checkout cwd gives, such as
// /var instead of /private/var, so both find the same project root string.
function underLogicalAncestor(worktree: string, main: string): string {
  let dir = worktree;
  for (;;) {
    try {
      const real = realpathSync(dir);
      if (isWithin(real, main)) return join(dir, relative(real, main));
    } catch {
      return main;
    }
    const parent = dirname(dir);
    if (parent === dir) return main;
    dir = parent;
  }
}

// A linked worktree resolves to its main checkout, so all worktrees share one state folder.
export function findProjectRoot(cwd: string): string {
  const dir = nearestMarker(cwd);
  if (dir === undefined) return resolve(cwd);
  const main = mainCheckoutOf(dir);
  return main === undefined ? dir : underLogicalAncestor(dir, main);
}

// The nearest directory at or above cwd that holds .git. Unlike findProjectRoot, a linked worktree stays
// itself, because worktree setup files belong to the checkout's branch.
export function findCheckoutRoot(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function t3ProjectFilePath(root: string): string {
  return join(root, "t3.json");
}

export function worktreeRunnerPath(root: string): string {
  return join(root, ".t3", "omt-worktree-setup.mjs");
}

export function pnpmWorkspacePath(root: string): string {
  return join(root, "pnpm-workspace.yaml");
}

// A linked worktree whose own .omt3 or .omt holds plans or a ledger that omt no longer reads. `dir` is
// the first of the two that does.
export function shadowedWorktreeState(cwd: string): { worktree: string; main: string; dir: string } | undefined {
  const worktree = nearestMarker(cwd);
  if (worktree === undefined) return undefined;
  const found = mainCheckoutOf(worktree);
  if (found === undefined) return undefined;
  const main = underLogicalAncestor(worktree, found);
  for (const own of [join(worktree, STATE_DIR_NAME), join(worktree, LEGACY_STATE_DIR_NAME)]) {
    if (holdsState(own)) return { worktree, main, dir: own };
  }
  return undefined;
}

function holdsState(dir: string): boolean {
  try {
    if (readdirSync(join(dir, "plans"), { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith(".md"))) return true;
  } catch {
    // No plans directory.
  }
  return isFile(join(dir, "ledger.jsonl"));
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function stateDirPair(root: string): FolderPair {
  return { current: join(root, STATE_DIR_NAME), legacy: join(root, LEGACY_STATE_DIR_NAME) };
}

export function omtDir(root: string): string {
  return pick(stateDirPair(root));
}

// A legacy folder that omt reads now, or that sits beside the current one.
export interface LegacyUse {
  current: string;
  legacy: string;
  both: boolean; // both folders exist, and omt uses the current one
}

function legacyUse(pair: FolderPair): LegacyUse | undefined {
  if (!existsSync(pair.legacy)) return undefined;
  return { ...pair, both: existsSync(pair.current) };
}

// The legacy project and user folders that the hint names: for the project root of cwd, and for the
// user folder unless OMT_CONFIG_DIR names it.
export function legacyFolders(cwd: string, env: Env, homedir: string): { project?: LegacyUse; global?: LegacyUse } {
  const project = legacyUse(stateDirPair(findProjectRoot(cwd)));
  const pair = configDirPair(env, homedir);
  const global = pair === undefined ? undefined : legacyUse(pair);
  return { ...(project === undefined ? {} : { project }), ...(global === undefined ? {} : { global }) };
}

export function projectConfigPath(root: string): string {
  return join(omtDir(root), "config.jsonc");
}

export function projectRolesDir(root: string): string {
  return join(omtDir(root), "roles");
}

export function plansDir(root: string): string {
  return join(omtDir(root), "plans");
}

export function planPath(root: string, slug: string): string {
  return join(plansDir(root), `${slug}.md`);
}

export function climbPath(root: string, slug: string): string {
  return join(plansDir(root), `${slug}.climb.json`);
}

export function grillsDir(root: string): string {
  return join(omtDir(root), "grills");
}

export function grillPath(root: string, slug: string): string {
  return join(grillsDir(root), `${slug}.md`);
}

export function ledgerPath(root: string): string {
  return join(omtDir(root), "ledger.jsonl");
}

export function evidenceDir(root: string): string {
  return join(omtDir(root), "evidence");
}

export function projectManifestPath(root: string): string {
  return join(omtDir(root), "install.json");
}

export function projectShimPath(root: string): string {
  return join(omtDir(root), "bin", "omt");
}

export function projectSkillRoots(root: string): { agents: string; claude: string } {
  return { agents: join(root, ".agents", "skills"), claude: join(root, ".claude", "skills") };
}

export function projectInstallDirs(root: string): string[] {
  const skills = projectSkillRoots(root);
  return [
    omtDir(root),
    plansDir(root),
    dirname(projectShimPath(root)),
    join(omtDir(root), "backups"),
    dirname(skills.agents),
    skills.agents,
    dirname(skills.claude),
    skills.claude,
  ];
}

export function projectClaudeSettingsPath(root: string): string {
  return join(root, ".claude", "settings.local.json");
}

export function claudeConfigDir(env: Env, homedir: string): string {
  return envPath(env, "CLAUDE_CONFIG_DIR") ?? join(homedir, ".claude");
}

export function skillRoots(env: Env, homedir: string): SkillRoots {
  return {
    agents: join(homedir, ".agents", "skills"),
    claude: join(claudeConfigDir(env, homedir), "skills"),
    gemini: join(homedir, ".gemini", "config", "skills"),
  };
}

export function claudeSettingsPath(env: Env, homedir: string): string {
  return join(claudeConfigDir(env, homedir), "settings.json");
}

export function t3HomeDir(env: Env, homedir: string): string {
  return envPath(env, "T3CODE_HOME") ?? join(homedir, ".t3");
}

export function t3SettingsPath(env: Env, homedir: string): string {
  return join(t3HomeDir(env, homedir), "userdata", "settings.json");
}
