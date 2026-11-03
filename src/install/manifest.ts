import { parseDefaultsSnapshot } from "../config/defaultsState.ts";
import type { DefaultsSnapshot } from "../config/defaultsState.ts";
import { basename, dirname, join, relative, sep } from "node:path";
import { isWithin, omtDir, projectClaudeSettingsPath, projectConfigPath, projectInstallDirs, projectShimPath, projectSkillRoots } from "../paths.ts";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { PACKAGE_NAME } from "./skills.ts";

export interface ManifestLink {
  path: string;
  target: string;
}

export interface ManifestHook {
  kind: "claude-user-prompt-submit";
  settingsPath: string;
  command: string;
  created?: boolean; // the install created the settings file
  backup?: string; // the backup of the settings file before an install added the entry
}

export interface ManifestFile {
  path: string;
  sha256: string; // hash of the content that the install wrote
}

// What the install changed in the exclude file, so the uninstall can give back its exact bytes.
export interface ManifestExcludeFile {
  created: boolean; // the install created the exclude file
  dirCreated: boolean; // the install created its info/ directory
  addedNewline: boolean; // the install added a final newline before it appended the block
}

// Skill names and link paths that were in place before the first install, such as a setup that the
// repository tracks; the uninstall keeps them.
export interface ManifestExisting {
  skills: string[];
  links: string[];
}

export interface ManifestProject {
  omtDirCreated: boolean; // the install created <root>/.omt3
  settingsCreated: boolean; // the install created <root>/.claude/settings.local.json
  shim?: string;
  gitExclude?: string; // the exclude file that holds the managed block
  excludeFile?: ManifestExcludeFile;
  gitExcludeOff?: boolean; // the last install ran with --no-git-exclude
  gitignoreRestore?: { before: string; sha256: string }; // an existing .omt3/.gitignore that the install appended to
  existing?: ManifestExisting;
  files?: ManifestFile[]; // files the install created, such as .omt3/config.jsonc and .omt3/.gitignore
  dirs?: string[]; // directories the install created
}

export interface Manifest {
  acceptedDefaults?: DefaultsSnapshot;
  scope?: "user" | "project"; // absent means user
  root?: string; // project root, project scope only
  package: string;
  version: string;
  installedAt: string;
  skillsRoot: string;
  skills: string[];
  optIn?: string[]; // the opt-in skills that an install of this scope selected with --with
  links: ManifestLink[];
  config?: { path: string; created: boolean };
  hooks: ManifestHook[];
  backups: string[];
  project?: ManifestProject;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function manifestFiles(value: unknown[]): ManifestFile[] {
  return value
    .filter(
      (file): file is ManifestFile =>
        isRecord(file) && typeof file.path === "string" && typeof file.sha256 === "string",
    )
    .map((file) => ({ path: file.path, sha256: file.sha256 }));
}

export async function readManifest(path: string): Promise<Manifest | undefined> {
  const text = await readFileIfExists(path);
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new OmtError("manifest", `the install manifest ${path} is not valid JSON`, {
      hint: "fix or delete the file, then run the command again",
      cause: error,
    });
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OmtError("manifest", `the install manifest ${path} does not hold a JSON object`, {
      hint: "fix or delete the file, then run the command again",
    });
  }
  const value = raw as Record<string, unknown>;
  const links = Array.isArray(value.links)
    ? value.links.filter(
        (link): link is ManifestLink =>
          isRecord(link) && typeof link.path === "string" && typeof link.target === "string",
      )
    : [];
  const hooks = Array.isArray(value.hooks)
    ? value.hooks
        .filter(
          (hook): hook is ManifestHook =>
            isRecord(hook) &&
            hook.kind === "claude-user-prompt-submit" &&
            typeof hook.settingsPath === "string" &&
            typeof hook.command === "string",
        )
        .map((hook) => ({
          kind: hook.kind,
          settingsPath: hook.settingsPath,
          command: hook.command,
          ...(hook.created === true ? { created: true } : {}),
          ...(typeof hook.backup === "string" ? { backup: hook.backup } : {}),
        }))
    : [];
  const config = value.config;
  const project = value.project as Record<string, unknown> | null | undefined;
  const excludeFile = project?.excludeFile as Record<string, unknown> | null | undefined;
  const restore = project?.gitignoreRestore;
  const existing = project?.existing as Record<string, unknown> | null | undefined;
  return {
    ...(value.scope === "project" ? { scope: "project" as const } : {}),
    ...(typeof value.root === "string" ? { root: value.root } : {}),
    package: typeof value.package === "string" ? value.package : PACKAGE_NAME,
    version: typeof value.version === "string" ? value.version : "",
    installedAt: typeof value.installedAt === "string" ? value.installedAt : "",
    ...(value.acceptedDefaults === undefined ? {} : { acceptedDefaults: parseDefaultsSnapshot(JSON.stringify(value.acceptedDefaults), path) }),
    skillsRoot: typeof value.skillsRoot === "string" ? value.skillsRoot : "",
    skills: strings(value.skills),
    ...(Array.isArray(value.optIn) ? { optIn: strings(value.optIn) } : {}),
    links,
    ...(isRecord(config) && typeof config.path === "string"
      ? { config: { path: config.path, created: config.created === true } }
      : {}),
    hooks,
    backups: strings(value.backups),
    ...(project !== null && typeof project === "object"
      ? {
          project: {
            omtDirCreated: project.omtDirCreated === true,
            settingsCreated: project.settingsCreated === true,
            ...(typeof project.shim === "string" ? { shim: project.shim } : {}),
            ...(typeof project.gitExclude === "string" ? { gitExclude: project.gitExclude } : {}),
            ...(excludeFile !== null && typeof excludeFile === "object"
              ? {
                  excludeFile: {
                    created: excludeFile.created === true,
                    dirCreated: excludeFile.dirCreated === true,
                    addedNewline: excludeFile.addedNewline === true,
                  },
                }
              : {}),
            ...(project.gitExcludeOff === true ? { gitExcludeOff: true } : {}),
            ...(isRecord(restore) && typeof restore.before === "string" && typeof restore.sha256 === "string"
              ? { gitignoreRestore: { before: restore.before, sha256: restore.sha256 } }
              : {}),
            ...(existing !== null && typeof existing === "object"
              ? { existing: { skills: strings(existing.skills), links: strings(existing.links) } }
              : {}),
            ...(Array.isArray(project.files) ? { files: manifestFiles(project.files) } : {}),
            ...(Array.isArray(project.dirs) ? { dirs: strings(project.dirs) } : {}),
          },
        }
      : {}),
  };
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) byKey.set(key(item), item);
  return [...byKey.values()];
}

// Merges a new install record into the previous manifest. Later entries win on the same key.
export function mergeManifest(previous: Manifest | undefined, next: Manifest): Manifest {
  if (previous === undefined) return next;
  const config =
    next.config === undefined
      ? previous.config
      : {
          path: next.config.path,
          created: next.config.created || (previous.config?.path === next.config.path && previous.config.created),
        };
  return {
    ...next,
    ...(previous.acceptedDefaults === undefined ? {} : { acceptedDefaults: previous.acceptedDefaults }),
    skills: unique([...previous.skills, ...next.skills], (name) => name).sort(),
    links: unique([...previous.links, ...next.links], (link) => link.path),
    ...(config === undefined ? {} : { config }),
    hooks: unique([...previous.hooks, ...next.hooks], (hook) => hook.settingsPath).map((hook) => {
      const old = previous.hooks.find((item) => item.settingsPath === hook.settingsPath);
      const backup = hook.backup ?? old?.backup;
      return {
        ...hook,
        ...(old?.created === true ? { created: true } : {}),
        ...(backup === undefined ? {} : { backup }),
      };
    }),
    backups: unique([...previous.backups, ...next.backups], (path) => path),
    ...(next.project === undefined
      ? previous.project === undefined
        ? {}
        : { project: previous.project }
      : {
          project: {
            ...next.project,
            omtDirCreated: next.project.omtDirCreated || previous.project?.omtDirCreated === true,
            settingsCreated: next.project.settingsCreated || previous.project?.settingsCreated === true,
            files: unique([...(previous.project?.files ?? []), ...(next.project.files ?? [])], (file) => file.path),
            dirs: [...new Set([...(previous.project?.dirs ?? []), ...(next.project.dirs ?? [])])],
          },
        }),
  };
}

function isName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !name.includes("/") && !name.includes(sep);
}

// The paths that a project install can have created. A manifest that the repository tracks, or that
// someone copied in, may name other files; the run never acts on those.
function projectAllowlist(root: string) {
  const omt = omtDir(root);
  const backups = join(omt, "backups");
  const skills = projectSkillRoots(root);
  return {
    backups,
    skills,
    files: new Set([join(omt, ".gitignore"), projectConfigPath(root), join(backups, ".gitignore")]),
    dirs: new Set(projectInstallDirs(root)),
  };
}

// Maps every path that a project manifest records from the root it was written in to `root`, and
// keeps only the paths that a project install writes. A copied or moved clone, or a manifest that the
// repository tracks, then never acts on another project, on the user install, or on a file of the
// project that omt did not create. `gitExclude` names a file in the git directory, so it stays as
// recorded; the plan finds the exclude file from `root` itself.
export function rebaseManifest(manifest: Manifest, root: string): Manifest {
  const from = manifest.root ?? root;
  const allowed = projectAllowlist(root);
  const map = (path: string): string | undefined => (isWithin(from, path) ? join(root, relative(from, path)) : undefined);
  const mapIf = (path: string, accept: (mapped: string) => boolean): string | undefined => {
    const mapped = map(path);
    return mapped !== undefined && accept(mapped) ? mapped : undefined;
  };
  const inBackups = (path: string) => path !== allowed.backups && isWithin(allowed.backups, path);
  const defined = <T>(items: (T | undefined)[]): T[] => items.filter((item): item is T => item !== undefined);
  const config = manifest.config === undefined ? undefined : mapIf(manifest.config.path, (path) => path === projectConfigPath(root));
  const { config: _config, project: _project, ...rest } = manifest;
  const project = manifest.project;
  const shim = project?.shim === undefined ? undefined : mapIf(project.shim, (path) => path === projectShimPath(root));
  const { shim: _shim, existing, ...projectRest } = project ?? { omtDirCreated: false, settingsCreated: false };
  const linkPath = (path: string) => mapIf(path, (mapped) => dirname(mapped) === allowed.skills.claude && isName(basename(mapped)));
  return {
    ...rest,
    root,
    skillsRoot: manifest.skillsRoot === "" ? "" : (mapIf(manifest.skillsRoot, (path) => path === allowed.skills.agents) ?? ""),
    skills: manifest.skills.filter(isName),
    links: defined(manifest.links.map((link) => {
      const path = linkPath(link.path);
      return path === undefined ? undefined : { ...link, path };
    })),
    ...(manifest.config === undefined || config === undefined ? {} : { config: { ...manifest.config, path: config } }),
    hooks: defined(manifest.hooks.map((hook) => {
      const settingsPath = mapIf(hook.settingsPath, (path) => path === projectClaudeSettingsPath(root));
      if (settingsPath === undefined) return undefined;
      const { backup: oldBackup, ...rest } = hook;
      const backup = oldBackup === undefined ? undefined : mapIf(oldBackup, inBackups);
      return { ...rest, settingsPath, ...(backup === undefined ? {} : { backup }) };
    })),
    backups: defined(manifest.backups.map((path) => mapIf(path, inBackups))),
    ...(project === undefined
      ? {}
      : {
          project: {
            ...projectRest,
            ...(shim === undefined ? {} : { shim }),
            ...(existing === undefined
              ? {}
              : { existing: { skills: existing.skills.filter(isName), links: defined(existing.links.map(linkPath)) } }),
            files: defined((project.files ?? []).map((file) => {
              const path = mapIf(file.path, (mapped) => allowed.files.has(mapped));
              return path === undefined ? undefined : { ...file, path };
            })),
            dirs: defined((project.dirs ?? []).map((dir) => mapIf(dir, (mapped) => allowed.dirs.has(mapped)))),
          },
        }),
  };
}

export function manifestText(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await writeFileAtomic(path, manifestText(manifest));
}
