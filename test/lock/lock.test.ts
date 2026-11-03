import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { onTestFinished, test } from "bun:test";
import { childEnv, CLI_PATH, fakeContext, GIT, gitEnv, gitRepo, OMT_GITIGNORE, tempDir, writeFile } from "../helpers.ts";

const hasLockTool = ["flock", "lockf"].some((name) => (process.env.PATH ?? "").split(delimiter).some((dir) => {
  try {
    const path = resolve(dir, name);
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}));
const lockTest = test.skipIf(!hasLockTool);

async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await delay(20);
  }
}

async function waitForFile<T>(path: string, parse: (text: string) => T | undefined, message: string): Promise<T> {
  let value: T | undefined;
  await waitFor(() => {
    try {
      value = parse(readFileSync(path, "utf8"));
      return value !== undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return false;
    }
  }, message);
  assert.notEqual(value, undefined);
  return value as T;
}

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 2;
}

function parsePid(text: string): number | undefined {
  const pid = Number(text);
  return /^\d+\n$/.test(text) && isPid(pid) ? pid : undefined;
}

function parsePids(text: string): number[] | undefined {
  if (!text.endsWith("\n")) return undefined;
  try {
    const pids: unknown = JSON.parse(text);
    return Array.isArray(pids) && pids.length === 2 && pids.every(isPid) ? pids : undefined;
  } catch {
    return undefined;
  }
}

function fixture() {
  const children = new Set<ChildProcess>();
  const pids = new Map<number, string>();
  onTestFinished(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
    for (const [pid, ended] of pids) {
      assert.ok(isPid(pid));
      if (existsSync(ended) && readFileSync(ended, "utf8") === "done\n") continue;
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  });
  const root = tempDir();
  const ctx = fakeContext({ root, env: childEnv(root) });
  mkdirSync(join(ctx.cwd, ".omt3"));
  function start(args: string[], cwd = ctx.cwd, env: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...ctx.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    children.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (text: string) => { stdout += text; });
    child.stderr.setEncoding("utf8").on("data", (text: string) => { stderr += text; });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    return { child, exited, out: () => stdout, err: () => stderr };
  }
  async function run(args: string[], cwd = ctx.cwd, env: NodeJS.ProcessEnv = {}) {
    const running = start(args, cwd, env);
    const result = await running.exited;
    return { ...result, stdout: running.out(), stderr: running.err() };
  }
  let sequence = 0;
  async function hold(name = "build", signalExit?: number, cwd = ctx.cwd) {
    const id = sequence++;
    const ready = join(root, `ready-${id}`);
    const release = join(root, `release-${id}`);
    const ended = join(root, `ended-${id}`);
    const signalled = join(root, `signalled-${id}`);
    const source = `
      const fs = require("node:fs");
      const deadline = setTimeout(() => process.exit(99), 60000);
      let code = 0;
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
          code = ${signalExit ?? 0};
          fs.writeFileSync(${JSON.stringify(signalled)}, signal + "\\n");
        });
      }
      fs.writeFileSync(${JSON.stringify(ready)}, process.pid + "\\n");
      const timer = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(release)})) return;
        clearInterval(timer);
        clearTimeout(deadline);
        fs.writeFileSync(${JSON.stringify(ended)}, "done\\n");
        process.exitCode = code;
      }, 20);
    `.replaceAll("\n", " ");
    const command = [process.execPath, "-e", source];
    const running = start(["lock", "run", name, "--", ...command], cwd);
    const pid = await waitForFile(ready, parsePid, `command did not start: ${running.err()}`);
    pids.set(pid, ended);
    return { ...running, pid, command: command.join(" "), signalled, ended, release: () => writeFileSync(release, "go") };
  }
  const tryRun = (seconds = 0, cwd = ctx.cwd) => run(["lock", "run", "build", "--wait", String(seconds), "--", process.execPath, "-e", "process.exit(0)"], cwd);
  return { root, ctx, start, run, hold, tryRun, pids };
}

lockTest("D4(a): a command holds its lock after SIGKILL of the wrapper", async () => {
  const f = fixture();
  const holder = await f.hold();
  assert.equal((await f.tryRun()).code, 75);
  holder.child.kill("SIGKILL");
  assert.equal((await holder.exited).signal, "SIGKILL");
  const busy = await f.tryRun(1);
  assert.equal(busy.code, 75, busy.stderr);
  assert.ok(busy.stderr.includes(`waiting for lock build (pid ${holder.child.pid}: ${holder.command})\n`));
  assert.match(busy.stderr, /omt: lock build is busy\n$/);
  assert.equal((await f.tryRun()).code, 75, "a zero-second try still fails after SIGKILL");
  holder.release();
  await waitForFile(holder.ended, (text) => text === "done\n" ? text : undefined, "the command did not end");
  assert.equal((await f.tryRun(3)).code, 0);
}, 180_000);

lockTest("D4(b): a shell background process keeps the inherited lock", async () => {
  const f = fixture();
  const pidFile = join(f.root, "background-pid");
  const release = join(f.root, "background-release");
  const ended = join(f.root, "background-ended");
  const holder = f.start(["lock", "run", "build", "--", "/bin/sh", "-c", '(while [ ! -e "$2" ]; do sleep 0.05; done; printf "done\\n" > "$3") & printf "%s\\n" "$!" > "$1"; exit 0', "sh", pidFile, release, ended]);
  const pid = await waitForFile(pidFile, parsePid, "the shell did not start its background process");
  f.pids.set(pid, ended);
  assert.equal((await holder.exited).code, 0, holder.err());
  const busy = await f.tryRun(1);
  assert.equal(busy.code, 75, busy.stderr);
  assert.match(busy.stderr, /lock build is busy/);
  writeFileSync(release, "go");
  await waitForFile(ended, (text) => text === "done\n" ? text : undefined, "the background process did not end");
  assert.equal((await f.tryRun(5)).code, 0, "the lock becomes free after the background process exits");
}, 180_000);

lockTest("D4(c): a failure and forwarded SIGTERM or SIGINT release the lock after the command exits", async () => {
  const f = fixture();
  const failed = await f.run(["lock", "run", "build", "--", process.execPath, "-e", "process.exit(23)"]);
  assert.equal(failed.code, 23, failed.stderr);
  assert.equal((await f.tryRun()).code, 0);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const holder = await f.hold("build", 27);
    holder.child.kill(signal);
    await waitForFile(holder.signalled, (text) => text === `${signal}\n` ? text : undefined, `the command did not receive ${signal}`);
    assert.equal((await f.tryRun()).code, 75, "the wrapper waits for the command to exit");
    holder.release();
    assert.equal((await holder.exited).code, 27, holder.err());
    assert.equal((await f.tryRun()).code, 0);
  }
}, 180_000);

lockTest("D4(d): a Node command holds the lock while it waits for a child with stdio inherit", async () => {
  const f = fixture();
  const ready = join(f.root, "subprocess-pids");
  const release = join(f.root, "subprocess-release");
  const ended = join(f.root, "subprocess-ended");
  const childSource = `
    const fs = require("node:fs");
    const deadline = setTimeout(() => process.exit(99), 60000);
    const timer = setInterval(() => {
      if (!fs.existsSync(${JSON.stringify(release)})) return;
      clearInterval(timer);
      clearTimeout(deadline);
    }, 20);
  `;
  const source = `
    const fs = require("node:fs");
    const child = require("node:child_process").spawn(${JSON.stringify(process.execPath)}, ["-e", ${JSON.stringify(childSource)}], { stdio: "inherit", timeout: 60000, killSignal: "SIGKILL" });
    fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify([process.pid, child.pid]) + "\\n");
    child.on("exit", code => {
      fs.writeFileSync(${JSON.stringify(ended)}, "done\\n");
      process.exitCode = code;
    });
  `;
  const holder = f.start(["lock", "run", "build", "--", process.execPath, "-e", source]);
  const pids = await waitForFile(ready, parsePids, "the Node command did not start its child");
  for (const pid of pids) f.pids.set(pid, ended);
  assert.equal((await f.tryRun()).code, 75);
  writeFileSync(release, "go");
  assert.equal((await holder.exited).code, 0, holder.err());
  assert.equal((await f.tryRun()).code, 0);
}, 180_000);

test("D4(e): without a lock tool, the command runs and returns its exit code", async () => {
  const f = fixture();
  const path = join(f.root, "empty-path");
  mkdirSync(path);
  const command = [process.execPath, "-e", 'process.stdout.write(JSON.stringify(process.argv.slice(1)) + "\\n"); process.exit(19)', "--", "--help", "--wait"];
  const result = await f.run(["lock", "run", "build", "--", ...command], f.ctx.cwd, { PATH: path });
  assert.equal(result.code, 19, result.stderr);
  assert.equal(result.stdout, '["--help","--wait"]\n');
  assert.equal(result.stderr, `warning: no flock or lockf on PATH; running ${command.join(" ")} without a lock\n`);
  assert.ok(!existsSync(join(f.ctx.cwd, ".omt3", "locks")));
}, 180_000);

lockTest("concurrent runs wait once, list the holder, and preserve the lock file", async () => {
  const f = fixture();
  const holder = await f.hold();
  const path = join(f.ctx.cwd, ".omt3", "locks", "build.lock");
  assert.equal(readFileSync(join(f.ctx.cwd, ".omt3", "locks", ".gitignore"), "utf8"), "*\n");
  const owner = await waitForFile(path, (text) => {
    if (!text.endsWith("\n")) return undefined;
    try {
      const value = JSON.parse(text);
      return isPid(value.pid) && value.childPid === holder.pid && typeof value.command === "string" && typeof value.startedAt === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }, "childPid was not written");
  assert.deepEqual(Object.keys(owner).sort(), ["childPid", "command", "pid", "startedAt"]);
  assert.equal(owner.pid, holder.child.pid);
  assert.equal(owner.command, holder.command);
  assert.ok(Number.isFinite(Date.parse(owner.startedAt)));
  const inode = statSync(path).ino;
  const listed = await f.run(["lock", "list"]);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.stdout, `build.lock held ${JSON.stringify(owner)}\n`);
  const second = f.start(["lock", "run", "build", "--", process.execPath, "-e", 'process.stdout.write("second\\n")']);
  await waitFor(() => second.err().includes("waiting for lock build"), "the second run did not wait");
  assert.equal(second.out(), "");
  holder.release();
  assert.equal((await holder.exited).code, 0);
  assert.equal((await second.exited).code, 0, second.err());
  assert.equal(second.out(), "second\n");
  assert.equal(second.err(), `waiting for lock build (pid ${holder.child.pid}: ${holder.command})\n`);
  assert.equal(statSync(path).ino, inode);
  assert.equal((await f.run(["lock", "list"])).stdout, "build.lock free\n");
}, 180_000);

for (const separate of [false, true]) {
  for (const subdir of ["", "pkg"]) {
    lockTest(`linked worktrees with trailing spaces share one ignored lock for a ${subdir === "" ? "root" : "nested"} project with a ${separate ? "separate" : "normal"} git directory`, async () => {
      const f = fixture();
      const project = join(f.ctx.cwd, subdir);
      writeFile(join(project, ".omt3", ".gitignore"), OMT_GITIGNORE);
      const git = gitRepo(f.root, f.ctx.cwd);
      if (separate) {
        execFileSync(GIT, ["init", "-q", "--separate-git-dir", join(f.root, "git-store ")], {
          cwd: f.ctx.cwd,
          env: gitEnv(f.root),
          timeout: 10_000,
        });
      }
      const worktrees = [join(f.root, "worktree-one"), join(f.root, "worktree-two ")];
      for (const worktree of worktrees) git(["worktree", "add", "-q", "--detach", worktree]);
      const dir = separate ? join(f.root, "git-store ", "omt", "locks", subdir) : join(project, ".omt3", "locks");
      const path = join(dir, "build.lock");
      const holder = await f.hold("build", undefined, project);
      const inode = statSync(path).ino;
      assert.match((await f.run(["lock", "list"], project)).stdout, /^build\.lock held /);
      for (const worktree of worktrees) {
        const cwd = join(worktree, subdir);
        const busy = await f.tryRun(0, cwd);
        assert.equal(busy.code, 75, busy.stderr);
        assert.ok(!existsSync(join(cwd, ".omt3", "locks")));
        assert.match((await f.run(["lock", "list"], cwd)).stdout, /^build\.lock held /);
        assert.equal(git(["status", "--porcelain", "--untracked-files=all"], worktree), "");
      }
      assert.deepEqual(readdirSync(dir).sort(), [".gitignore", "build.lock"]);
      assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "*\n");
      if (separate) assert.ok(!existsSync(join(project, ".omt3", "locks")));
      if (subdir !== "") assert.ok(!existsSync(join(f.ctx.cwd, ".omt3", "locks")));
      assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "");
      holder.release();
      assert.equal((await holder.exited).code, 0, holder.err());
      for (const worktree of worktrees) {
        assert.equal((await f.tryRun(0, join(worktree, subdir))).code, 0);
        assert.equal(git(["status", "--porcelain", "--untracked-files=all"], worktree), "");
      }
      const linkedHolder = await f.hold("build", undefined, join(worktrees[0]!, subdir));
      for (const checkout of [f.ctx.cwd, ...worktrees]) {
        const cwd = join(checkout, subdir);
        assert.equal((await f.tryRun(0, cwd)).code, 75);
        assert.match((await f.run(["lock", "list"], cwd)).stdout, /^build\.lock held /);
        assert.equal(git(["status", "--porcelain", "--untracked-files=all"], checkout), "");
      }
      linkedHolder.release();
      assert.equal((await linkedHolder.exited).code, 0, linkedHolder.err());
      assert.equal((await f.run(["lock", "list"], project)).stdout, "build.lock free\n");
      assert.deepEqual(readdirSync(dir).sort(), [".gitignore", "build.lock"]);
      assert.equal(statSync(path).ino, inode);
      assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "");
    }, 180_000);
  }
}

lockTest("a project only in a linked worktree keeps the main checkout clean", async () => {
  const f = fixture();
  const git = gitRepo(f.root, f.ctx.cwd);
  const worktree = join(f.root, "worktree");
  git(["worktree", "add", "-q", worktree]);
  const project = join(worktree, "newpkg");
  mkdirSync(join(project, ".omt3"), { recursive: true });
  const initialized = await f.run(["init"], project);
  assert.equal(initialized.code, 0, initialized.stderr);
  git(["add", "newpkg"], worktree);
  git(["commit", "-q", "-m", "add project"], worktree);
  const mainProject = join(f.ctx.cwd, "newpkg");
  assert.ok(!existsSync(mainProject));
  const holder = await f.hold("build", undefined, project);
  const dir = join(mainProject, ".omt3", "locks");
  assert.deepEqual(readdirSync(dir).sort(), [".gitignore", "build.lock"]);
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "*\n");
  assert.ok(!existsSync(join(project, ".omt3", "locks")));
  for (const cwd of [project, mainProject]) {
    const busy = await f.tryRun(0, cwd);
    assert.equal(busy.code, 75, busy.stderr);
    assert.match((await f.run(["lock", "list"], cwd)).stdout, /^build\.lock held /);
  }
  for (const checkout of [f.ctx.cwd, worktree]) {
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"], checkout), "");
  }
  holder.release();
  assert.equal((await holder.exited).code, 0, holder.err());
  assert.equal((await f.run(["lock", "list"], project)).stdout, "build.lock free\n");
  assert.equal((await f.tryRun(0, mainProject)).code, 0);
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "");
}, 180_000);

test("lock validates its arguments and appears in help and project warnings", async () => {
  const f = fixture();
  for (const args of [
    [], ["clear", "build"], ["list", "build"], ["list", "--wait", "0"],
    ["run", "build"], ["run", "build", "--"], ["run", "--", process.execPath],
    ["run", "../build", "--", process.execPath], ["run", "Build", "--", process.execPath],
    ["run", "a".repeat(65), "--", process.execPath], ["run", "build", "--wait", "-1", "--", process.execPath],
    ["run", "build", "--wait", "oops", "--", process.execPath], ["run", "build", "--unknown", "--", process.execPath],
  ]) {
    const result = await f.run(["lock", ...args]);
    assert.equal(result.code, 2, `${JSON.stringify(args)}: ${result.stderr}`);
  }
  assert.match((await f.run(["--help"])).stdout, /^  lock /m);
  assert.match((await f.run(["lock", "--help"])).stdout, /^Usage: omt lock run /);
  const plain = join(f.root, "plain");
  mkdirSync(plain);
  const empty = await f.run(["lock", "list"], plain);
  assert.equal(empty.code, 0, empty.stderr);
  assert.equal(empty.stdout, "");
  assert.match(empty.stderr, /warning: no .omt3, .omt, or .git found above/);
}, 180_000);

lockTest("lock storage rejects leaf and directory symlinks without changing their targets", async () => {
  for (const parent of [false, true]) {
    const f = fixture();
    const dir = join(f.ctx.cwd, ".omt3", "locks");
    const outside = join(tempDir(), "build.lock");
    writeFile(outside, "keep\n");
    if (parent) symlinkSync(join(outside, ".."), dir);
    else {
      mkdirSync(dir);
      symlinkSync(outside, join(dir, "build.lock"));
    }
    const child = f.start(["lock", "run", "build", "--", process.execPath, "-e", "process.exit(0)"]);
    assert.equal((await child.exited).code, 1, child.err());
    assert.match(child.err(), /symlink|real directory/);
    assert.equal(readFileSync(outside, "utf8"), "keep\n");
  }
});
