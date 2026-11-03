import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants, realpathSync } from "node:fs";
import { access, open, readdir, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { delimiter, join, relative, resolve } from "node:path";
import { findProjectRoot, omtDir } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { errorMessage, OmtError } from "../util/errors.ts";
import { errorCode, openStateFile, readFileIfExists } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";

interface LockTool {
  path: string;
  name: "flock" | "lockf";
}

interface Holder {
  pid: number;
  command: string;
  startedAt: string;
  childPid?: number;
}

async function findLockTool(ctx: Pick<CliContext, "cwd" | "env">): Promise<LockTool | undefined> {
  if (ctx.env.PATH === undefined) return undefined;
  for (const name of ["flock", "lockf"] as const) {
    for (const dir of ctx.env.PATH.split(delimiter)) {
      const path = resolve(ctx.cwd, dir, name);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, fsConstants.X_OK);
        return { path, name };
      } catch {
        // This PATH entry has no executable with this name.
      }
    }
  }
  return undefined;
}

function lockStorage(ctx: CliContext): { root: string; dir: string } {
  let root = findProjectRoot(ctx.cwd);
  const git = (args: string[]) => spawnSync("git", args, {
    cwd: root,
    env: ctx.env,
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.status === 0) {
    const worktrees = git(["worktree", "list", "--porcelain"]);
    const main = worktrees.status === 0 ? worktrees.stdout.split(/\r?\n/).find((line) => line.startsWith("worktree ")) : undefined;
    if (main?.startsWith("worktree ")) {
      const projectPath = relative(top.stdout.replace(/\r?\n$/, ""), realpathSync(root));
      const mainPath = main.slice("worktree ".length);
      const common = git(["rev-parse", "--git-common-dir"]);
      if (common.status === 0) {
        const commonPath = resolve(root, common.stdout.replace(/\r?\n$/, ""));
        if (realpathSync(mainPath) === realpathSync(commonPath)) {
          return { root: commonPath, dir: join(commonPath, "omt", "locks", projectPath) };
        }
      }
      root = join(mainPath, projectPath);
    }
  }
  return { root, dir: join(omtDir(root), "locks") };
}

function exitCode(code: number | null, signal: NodeJS.Signals | null): number {
  return code ?? (signal === null ? 1 : 128 + osConstants.signals[signal]);
}

async function runProcess(ctx: CliContext, command: string[], fd?: number, started?: (pid: number) => Promise<void>): Promise<number> {
  const [program, ...args] = command;
  if (program === undefined) throw new OmtError("lock_command", "missing command");
  const child = spawn(program, args, {
    cwd: ctx.cwd,
    env: ctx.env,
    stdio: fd === undefined ? "inherit" : ["inherit", "inherit", "inherit", fd],
  });
  const forward = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const done = new Promise<number>((resolve, reject) => {
    child.once("error", (error) => reject(new OmtError("lock_command", `cannot run ${program}: ${errorMessage(error)}`, { cause: error })));
    child.once("exit", (code, signal) => resolve(exitCode(code, signal)));
  });
  try {
    if (child.pid !== undefined && started !== undefined) {
      try {
        await started(child.pid);
      } catch (error) {
        child.kill("SIGTERM");
        await done;
        throw error;
      }
    }
    return await done;
  } finally {
    process.off("SIGINT", forward);
    process.off("SIGTERM", forward);
  }
}

async function takeLock(ctx: CliContext, tool: LockTool, file: FileHandle, seconds: number): Promise<boolean> {
  const args = tool.name === "flock" ? ["-E", "75", "-w", String(seconds), "3"] : ["-s", "-t", String(seconds), "3"];
  const code = await runProcess(ctx, [tool.path, ...args], file.fd);
  if (code === 0) return true;
  if (code === 75) return false;
  throw new OmtError("lock_tool", `${tool.name} exited with code ${code}`, { exitCode: code });
}

async function readHolder(path: string): Promise<Holder | undefined> {
  const text = await readFileIfExists(path);
  try {
    const holder: unknown = JSON.parse(text ?? "");
    if (isRecord(holder) && typeof holder.pid === "number" && typeof holder.command === "string" && typeof holder.startedAt === "string") {
      return {
        pid: holder.pid,
        command: holder.command,
        startedAt: holder.startedAt,
        ...(typeof holder.childPid === "number" ? { childPid: holder.childPid } : {}),
      };
    }
  } catch {
    // A holder can be between truncating the file and writing its JSON line.
  }
  return undefined;
}

async function writeHolder(file: FileHandle, holder: Holder): Promise<void> {
  // Replacing this inode would let another command lock a different file at the same path.
  await file.truncate(0);
  await file.writeFile(`${JSON.stringify(holder)}\n`);
}

function holderLabel(holder: Holder | undefined): string {
  return holder === undefined ? "pid unknown: unknown command" : `pid ${holder.pid}: ${holder.command}`;
}

export async function runLocked(ctx: CliContext, name: string, seconds: number, command: string[]): Promise<number> {
  const commandText = command.join(" ").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  const tool = await findLockTool(ctx);
  if (tool === undefined) {
    ctx.stderr(`warning: no flock or lockf on PATH; running ${commandText} without a lock\n`);
    return runProcess(ctx, command);
  }
  const { root, dir } = lockStorage(ctx);
  const ignore = await openStateFile(root, join(dir, ".gitignore"), false);
  try {
    await ignore.write("*\n", 0, "utf8");
    await ignore.truncate(2);
  } finally {
    await ignore.close();
  }
  const path = join(dir, `${name}.lock`);
  const file = await openStateFile(root, path);
  try {
    if (!(await takeLock(ctx, tool, file, 0))) {
      ctx.stderr(`waiting for lock ${name} (${holderLabel(await readHolder(path))})\n`);
      if (!(await takeLock(ctx, tool, file, seconds))) {
        throw new OmtError("lock_busy", `lock ${name} is busy`, { exitCode: 75 });
      }
    }
    const holder: Holder = { pid: process.pid, command: commandText, startedAt: ctx.now().toISOString() };
    await writeHolder(file, holder);
    return await runProcess(ctx, command, file.fd, async (childPid) => {
      await writeHolder(file, { ...holder, childPid });
    });
  } finally {
    await file.close();
  }
}

// The lock files in dir that a process holds now. Without flock or lockf no process can hold one, so none count.
export async function heldLocks(ctx: CliContext, dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return [];
    throw error;
  }
  const tool = await findLockTool(ctx);
  if (tool === undefined) return [];
  const held: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    const file = await open(join(dir, entry.name), "r");
    try {
      if (!(await takeLock(ctx, tool, file, 0))) held.push(join(dir, entry.name));
    } finally {
      await file.close();
    }
  }
  return held;
}

export async function listLocks(ctx: CliContext): Promise<number> {
  const { root, dir } = lockStorage(ctx);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0;
    throw error;
  }
  const tool = await findLockTool(ctx);
  if (tool === undefined) throw new OmtError("lock_tool", "no flock or lockf on PATH; cannot list locks");
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    const path = join(dir, entry.name);
    const file = await openStateFile(root, path);
    try {
      const free = await takeLock(ctx, tool, file, 0);
      const holder = free ? undefined : await readHolder(path);
      ctx.stdout(`${entry.name} ${free ? "free" : "held"}${holder === undefined ? "" : ` ${JSON.stringify(holder)}`}\n`);
    } finally {
      await file.close();
    }
  }
  return 0;
}
