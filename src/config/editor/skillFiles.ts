import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { errorCode, readFileIfExists, writeFileAtomic } from "../../util/fs.ts";
import { isRecord } from "../../util/json.ts";
import { EditorError, textHash } from "./api.ts";

// The files of one skill that maintainer mode edits: SKILL.md and the Markdown files under references/.
export interface SkillFile {
  path: string; // relative to the skill folder, with "/"
  hash: string;
  text: string;
}

const SKILL_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const SEGMENT = "[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}";
const FILE_PATH = new RegExp(`^(SKILL\\.md|references/(${SEGMENT}/){0,4}${SEGMENT}\\.md)$`);

// True when the skill folder or any part of path below it is a symlink. A missing part is not a symlink.
async function hasSymlink(skillsRoot: string, name: string, path: string): Promise<boolean> {
  let current = skillsRoot;
  for (const part of [name, ...path.split("/")]) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
  }
  return false;
}

async function referenceFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(join(dir, "references"), { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
      .filter((path) => FILE_PATH.test(path))
      .sort();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}

// undefined when the skill does not exist.
export async function skillFiles(skillsRoot: string, name: string): Promise<SkillFile[] | undefined> {
  if (!SKILL_NAME.test(name)) return undefined;
  const dir = join(skillsRoot, name);
  if (await hasSymlink(skillsRoot, name, "SKILL.md")) return undefined;
  const main = await readFileIfExists(join(dir, "SKILL.md"));
  if (main === undefined) return undefined;
  const files: SkillFile[] = [{ path: "SKILL.md", hash: textHash(main), text: main }];
  for (const path of await referenceFiles(dir)) {
    if (await hasSymlink(skillsRoot, name, path)) continue;
    const text = await readFileIfExists(join(dir, path));
    if (text !== undefined) files.push({ path, hash: textHash(text), text });
  }
  return files;
}

export interface SkillWrite {
  name: string;
  path: string;
  base: string; // the hash of the text that the edit was made on
  text: string;
}

function badRequest(message: string): EditorError {
  return new EditorError(400, "bad_request", message);
}

export function parseSkillWrite(body: string): SkillWrite {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw badRequest("the request body is not valid JSON");
  }
  if (!isRecord(value)) throw badRequest("the request body must be a JSON object");
  const { name, path, base, text } = value;
  if (typeof name !== "string" || !SKILL_NAME.test(name)) throw badRequest("name must be a skill folder name");
  if (typeof path !== "string" || !FILE_PATH.test(path) || path.split("/").includes("..")) {
    throw badRequest("path must be SKILL.md or a .md file under references/");
  }
  if (typeof base !== "string") throw badRequest("base must be the hash of the file text");
  if (typeof text !== "string") throw badRequest("text must be a string");
  return { name, path, base, text };
}

// Writes an existing skill file only. The file must still hold the text that the page loaded.
export async function writeSkillFile(skillsRoot: string, request: SkillWrite): Promise<SkillFile> {
  const dir = join(skillsRoot, request.name);
  const full = join(dir, request.path);
  const current = await readFileIfExists(full);
  if (current === undefined) throw new EditorError(404, "unknown_skill_file", `${request.name}/${request.path} does not exist`);
  if (await hasSymlink(skillsRoot, request.name, request.path)) throw badRequest("the skill file or a folder above it is a symlink");
  const inside = relative(await realpath(skillsRoot), await realpath(full));
  if (inside.startsWith("..") || inside.startsWith(sep) || !inside.startsWith(`${request.name}${sep}`)) {
    throw badRequest("the file is outside the skill folder");
  }
  if (textHash(current) !== request.base) {
    throw new EditorError(409, "skill_changed", `${request.name}/${request.path} changed since the editor loaded it; nothing was written`, {
      hint: "reload the file",
    });
  }
  if (request.path === "SKILL.md" && !request.text.startsWith(`---\nname: ${request.name}\n`)) {
    throw new EditorError(422, "skill_frontmatter", `SKILL.md must start with "---", then "name: ${request.name}"`);
  }
  if (request.text !== current) await writeFileAtomic(full, request.text);
  return { path: request.path, hash: textHash(request.text), text: request.text };
}
