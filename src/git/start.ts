import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { errorCode, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { checkPlanSlug } from "../util/ids.ts";
import { git, ok, runTool, trimEnd } from "./exec.ts";
import type { ToolContext } from "./exec.ts";

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// The id of a start record: the plan slug of --plan, or the run id of --run.
export function runIdFrom(values: { plan?: string | undefined; run?: string | undefined }): string {
  if (values.plan !== undefined && values.run !== undefined) throw usageError("--plan and --run exclude each other");
  if (values.plan !== undefined) return checkPlanSlug(values.plan, "--plan");
  if (values.run === undefined) throw usageError("pass --plan <slug> or --run <id>");
  if (!RUN_ID_RE.test(values.run)) throw usageError(`invalid --run "${values.run}"`, "a run id matches ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
  return values.run;
}

export interface Checkout {
  top: string; // the top folder of the work tree
  gitDir: string; // the git dir of this checkout; a linked worktree has its own
  prefix: string; // the current folder below `top`, with a trailing slash, or ""
}

export function readCheckout(ctx: ToolContext): Checkout {
  const probe = runTool(ctx, "git", ["rev-parse", "--is-inside-work-tree"]);
  if (!ok(probe) || probe.stdout.trim() !== "true") {
    throw new OmtError("not_a_repo", "the current folder is not in a git work tree");
  }
  const [top, gitDir, prefix] = trimEnd(git(ctx, ["rev-parse", "--show-toplevel", "--absolute-git-dir", "--show-prefix"])).split("\n");
  if (top === undefined || gitDir === undefined) throw new OmtError("git_failed", "git rev-parse printed no top folder");
  return { top, gitDir, prefix: prefix ?? "" };
}

export interface StatusEntry {
  x: string; // the index column
  y: string; // the work-tree column
}

// Each path that `git status` reports, relative to the top folder. A rename reports both paths.
export function readStatus(ctx: ToolContext, top: string): Map<string, StatusEntry> {
  const out = git(ctx, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: top });
  const fields = out.split("\0");
  const entries = new Map<string, StatusEntry>();
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field === undefined || field.length < 4) continue;
    const entry = { x: field[0] ?? " ", y: field[1] ?? " " };
    entries.set(field.slice(3), entry);
    if ("RC".includes(entry.x) || "RC".includes(entry.y)) {
      i++;
      const from = fields[i];
      if (from !== undefined && from !== "") entries.set(from, entry);
    }
  }
  return entries;
}

// The SHA-256 of a path's content, "symlink:<hash>" for a link, or "deleted".
export async function contentHash(top: string, path: string): Promise<string> {
  const full = join(top, path);
  try {
    const info = await lstat(full);
    if (info.isSymbolicLink()) return `symlink:${createHash("sha256").update(await readlink(full)).digest("hex")}`;
    if (info.isDirectory()) return "directory";
    return createHash("sha256").update(await readFile(full)).digest("hex");
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return "deleted";
    throw error;
  }
}

export interface StartRecord {
  version: 1;
  id: string;
  createdAt: string;
  head: string | null;
  paths: Record<string, string>; // each path changed at the start, with its content hash
}

export function startHash(record: StartRecord, path: string): string | undefined {
  return Object.hasOwn(record.paths, path) ? record.paths[path] : undefined;
}

export function startPath(checkout: Checkout, id: string): string {
  return join(checkout.gitDir, "omt", `start-${id}.json`);
}

export async function readStart(checkout: Checkout, id: string): Promise<StartRecord | undefined> {
  const path = startPath(checkout, id);
  const text = await readFileIfExists(path);
  if (text === undefined) return undefined;
  try {
    const record = JSON.parse(text) as StartRecord;
    if (record.version !== 1 || typeof record.paths !== "object" || record.paths === null) throw new Error("unknown format");
    return record;
  } catch (error) {
    throw new OmtError("bad_start", `cannot read the start record ${path}: ${(error as Error).message}`, {
      hint: "run omt git start --force to write it again",
    });
  }
}

export async function writeStart(ctx: ToolContext & { now: () => Date }, checkout: Checkout, id: string): Promise<StartRecord> {
  const head = runTool(ctx, "git", ["rev-parse", "--verify", "--quiet", "HEAD"], { cwd: checkout.top });
  const entries: [string, string][] = [];
  for (const path of [...readStatus(ctx, checkout.top).keys()].sort()) entries.push([path, await contentHash(checkout.top, path)]);
  const paths = Object.fromEntries(entries);
  const record: StartRecord = {
    version: 1,
    id,
    createdAt: ctx.now().toISOString(),
    head: ok(head) ? head.stdout.trim() : null,
    paths,
  };
  await writeFileAtomic(startPath(checkout, id), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
