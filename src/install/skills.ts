import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { errorCode, hashDir, lstatIfExists, MANAGED_MARKER, pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";

export const PACKAGE_NAME = "oh-my-t3code";

export interface BundledSkill {
  name: string;
  dir: string;
}

export interface Marker {
  package: string;
  version: string;
  skill: string;
  hash: string;
}

export type SkillAction = "create" | "update" | "unchanged" | "conflict";

export interface SkillClassification {
  action: SkillAction;
  sourceHash: string;
  reason?: string; // set for conflicts
}

export async function listBundledSkills(packageRoot: string): Promise<BundledSkill[]> {
  const root = join(packageRoot, "skills");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const skills: BundledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (await pathExists(join(dir, "SKILL.md"))) skills.push({ name: entry.name, dir });
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// Returns undefined when the directory has no marker, and null when the marker exists but is not valid.
export async function readMarker(dir: string): Promise<Marker | null | undefined> {
  const text = await readFileIfExists(join(dir, MANAGED_MARKER));
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as Partial<Marker> | null;
    if (value === null || typeof value !== "object" || typeof value.hash !== "string") return null;
    return {
      package: String(value.package ?? ""),
      version: String(value.version ?? ""),
      skill: String(value.skill ?? ""),
      hash: value.hash,
    };
  } catch {
    return null;
  }
}

export async function writeMarker(dir: string, marker: Marker): Promise<void> {
  await writeFileAtomic(join(dir, MANAGED_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
}

// A managed directory is a real directory (not a symlink) that holds the marker file.
export async function isManagedDir(path: string): Promise<boolean> {
  if (!(await lstatIfExists(path))?.isDirectory()) return false;
  return pathExists(join(path, MANAGED_MARKER));
}

export async function classifySkill(sourceDir: string, targetDir: string): Promise<SkillClassification> {
  const sourceHash = await hashDir(sourceDir);
  const stat = await lstatIfExists(targetDir);
  if (stat === undefined) return { action: "create", sourceHash };
  if (!stat.isDirectory()) return { action: "conflict", sourceHash, reason: "exists and is not a directory" };
  const marker = await readMarker(targetDir);
  if (marker === undefined) return { action: "conflict", sourceHash, reason: "exists and is not managed by omt" };
  if (marker === null) return { action: "conflict", sourceHash, reason: "has an invalid omt marker" };
  const installedHash = await hashDir(targetDir);
  if (installedHash !== marker.hash) return { action: "conflict", sourceHash, reason: "locally modified" };
  if (marker.hash === sourceHash) return { action: "unchanged", sourceHash };
  return { action: "update", sourceHash };
}
