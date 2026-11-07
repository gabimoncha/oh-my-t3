import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CliContext } from "../src/types.ts";
import { OmtError } from "../src/util/errors.ts";
import { onTestFinished } from "bun:test";

export const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CLI_PATH = join(PACKAGE_ROOT, "src", "cli.ts");

// The absolute path of a tool on the real PATH, skipping version-manager shims, which can loop
// when HOME is a temp directory. Tests that set a temp HOME call tools by this path.
function findTool(name: string, fallback: string): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir === "" || /[/\\]shims$/.test(dir)) continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // Not in this directory.
    }
  }
  return fallback;
}

export const GIT = findTool("git", "/usr/bin/git");
// The generated worktree setup runner runs with `node`. Without Node, the tests run it with Bun.
export const NODE = findTool("node", process.execPath);

// Creates a temp directory that the test runner removes after the test, even when it fails.
export function tempDir(prefix = "omt-test-"): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

export const OMT_GITIGNORE = "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\nplans/\nlocks/\nguardrails.md\ngrills/\n";

export function omtExit(code: number): (error: unknown) => error is OmtError {
  return (error: unknown): error is OmtError => error instanceof OmtError && error.exitCode === code;
}

export function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// A child-process environment where every variable that affects omt paths points into `root`.
export function childEnv(root: string): NodeJS.ProcessEnv {
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  mkdirSync(tmp, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    OMT_CONFIG_DIR: join(home, ".config", "oh-my-t3"),
    XDG_CONFIG_HOME: join(home, ".config"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    T3CODE_HOME: join(home, ".t3"),
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    // The daily update check is on by default; a test that needs it removes this variable.
    NO_UPDATE_NOTIFIER: "1",
  };
}

export function spawnOmt(args: string[], { root, cwd = root, env = {}, input = "" }: {
  root: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    env: { ...childEnv(root), ...env },
    encoding: "utf8",
    input,
    timeout: 30_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// A child environment for git: no system or global config, and a fixed author.
export function gitEnv(root: string): NodeJS.ProcessEnv {
  return {
    ...childEnv(root),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
}

// Makes `dir` a git repository on branch main with one commit, and returns a git runner for it.
// Tests may run git; src never does.
export function gitRepo(root: string, dir: string, files: Record<string, string> = {}) {
  const env = gitEnv(root);
  const git = (args: string[], cwd = dir) => execFileSync(GIT, args, { cwd, env, encoding: "utf8" });
  mkdirSync(dir, { recursive: true });
  git(["init", "-q", "-b", "main"]);
  for (const [path, content] of Object.entries({ "README.md": "# demo\n", ...files })) {
    writeFile(join(dir, path), content);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init"]);
  return git;
}

export interface FakeContext extends CliContext {
  out: () => string;
  err: () => string;
  prompts: string[];
}

export interface FakeContextOptions extends Partial<CliContext> {
  root?: string; // temp directory to hold home/ and project/; required unless homedir and cwd are given
  answer?: string; // what prompt() returns
  stdin?: string; // what readStdin() returns
}

export function fakeContext(overrides: FakeContextOptions = {}): FakeContext {
  const { root, answer = "", stdin = "", ...rest } = overrides;
  if (root === undefined && (rest.homedir === undefined || rest.cwd === undefined)) {
    throw new Error("fakeContext needs root, or both homedir and cwd, so that it never uses the real home directory");
  }
  const home = rest.homedir ?? join(root as string, "home");
  const cwd = rest.cwd ?? join(root as string, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  let stdout = "";
  let stderr = "";
  const prompts: string[] = [];
  const ctx: CliContext = {
    argv: [],
    cwd,
    homedir: home,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    readStdin: async () => stdin,
    isTTY: false,
    prompt: async (question) => {
      prompts.push(question);
      return answer;
    },
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    packageRoot: PACKAGE_ROOT,
    cliPath: CLI_PATH,
    build: "source",
    runtimePath: process.execPath,
    runtimeName: process.versions.bun === undefined ? "node" : "bun",
    runtimeVersion: process.versions.bun ?? process.versions.node,
    version: "0.1.0",
    ...rest,
    // The daily update check is on by default; a test that needs it passes NO_UPDATE_NOTIFIER: undefined.
    env: { HOME: home, NO_UPDATE_NOTIFIER: "1", ...rest.env },
  };
  return { ...ctx, out: () => stdout, err: () => stderr, prompts };
}

export interface ProjectContext extends FakeContext {
  at: (argv: string[]) => ProjectContext;
}

export function projectContext(argv: string[] = []): ProjectContext {
  const ctx = fakeContext({ root: tempDir(), argv });
  mkdirSync(join(ctx.cwd, ".git"));
  const at = (argv: string[]): ProjectContext => ({
    ...fakeContext({ homedir: ctx.homedir, cwd: ctx.cwd, env: ctx.env, argv }),
    at,
  });
  return { ...ctx, at };
}
