import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };
import * as brief from "./commands/brief.ts";
import * as climb from "./commands/climb.ts";
import * as config from "./commands/config.ts";
import * as detect from "./commands/detect.ts";
import * as doctor from "./commands/doctor.ts";
import * as git from "./commands/git.ts";
import * as hook from "./commands/hook.ts";
import * as init from "./commands/init.ts";
import * as install from "./commands/install.ts";
import * as ledger from "./commands/ledger.ts";
import * as lock from "./commands/lock.ts";
import * as migrate from "./commands/migrate.ts";
import * as paths from "./commands/paths.ts";
import * as plan from "./commands/plan.ts";
import * as profile from "./commands/profile.ts";
import * as roles from "./commands/roles.ts";
import * as route from "./commands/route.ts";
import * as uninstall from "./commands/uninstall.ts";
import * as update from "./commands/update.ts";
import * as worktree from "./commands/worktree.ts";
import type { CliBuild, CliContext, CommandRun } from "./types.ts";
import { legacyHint } from "./migrate/hint.ts";
import { findProjectRoot, hasProjectMarker, omtDir, shadowedWorktreeState } from "./paths.ts";
import { errorMessage, OmtError, usageError } from "./util/errors.ts";

export interface CommandModule {
  summary: string;
  usage: string;
  run: CommandRun;
}

export const COMMANDS: Readonly<Record<string, CommandModule>> = {
  install,
  uninstall,
  update,
  migrate,
  doctor,
  init,
  config,
  detect,
  roles,
  route,
  brief,
  plan,
  climb,
  profile,
  ledger,
  lock,
  worktree,
  git,
  paths,
  hook,
};

const STATE_COMMANDS = new Set(["plan", "climb", "ledger", "brief", "route", "init"]);
// hook runs on each prompt, and update and migrate report legacy folders themselves.
const NO_LEGACY_HINT = new Set(["hook", "update", "migrate"]);
// Run from a folder outside any project, these commands would write plans, ledger entries, or evidence paths there.
const PROJECT_COMMANDS = new Set(["plan", "climb", "profile", "ledger", "brief", "lock"]);

// scripts/build.ts defines OMT_BUILD as "bundle" or "binary". The sources run without it.
declare const OMT_BUILD: string | undefined;

const BUILD: CliBuild =
  typeof OMT_BUILD === "string" && (OMT_BUILD === "bundle" || OMT_BUILD === "binary") ? OMT_BUILD : "source";

// The bundle dist/cli.js and the sources src/main.ts sit one folder below the package root. A binary
// holds skills/ in its embedded root, and its own path is the CLI path.
function locate(): { packageRoot: string; cliPath: string } {
  if (BUILD === "binary") return { packageRoot: import.meta.dir, cliPath: process.execPath };
  const here = fileURLToPath(import.meta.url);
  return { packageRoot: dirname(dirname(here)), cliPath: join(dirname(here), `cli${extname(here)}`) };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) resolve("");
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

// process.cwd() is always the real path. $PWD keeps the path as the user typed it, such as /var
// instead of /private/var, so printed paths match the paths built from $HOME. findProjectRoot walks
// up by name, so $PWD is kept only when its walk finds the same real root as the physical walk.
export function logicalCwd(env: Record<string, string | undefined>, physical: string): string {
  const pwd = env.PWD;
  if (pwd === undefined || !isAbsolute(pwd)) return physical;
  try {
    if (realpathSync(pwd) !== physical) return physical;
    return realpathSync(findProjectRoot(pwd)) === realpathSync(findProjectRoot(physical)) ? pwd : physical;
  } catch {
    return physical;
  }
}

export function createContext(overrides: Partial<CliContext> = {}): CliContext {
  const { packageRoot, cliPath } = locate();
  const bunVersion: string | undefined = process.versions.bun;
  return {
    argv: [],
    cwd: logicalCwd(process.env, process.cwd()),
    env: process.env,
    homedir: homedir(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    readStdin: readAllStdin,
    isTTY: process.stdin.isTTY === true,
    prompt: promptLine,
    now: () => new Date(),
    packageRoot,
    cliPath,
    build: BUILD,
    ...(BUILD === "binary" ? {} : { runtimePath: process.execPath }),
    runtimeName: bunVersion === undefined ? "node" : "bun",
    runtimeVersion: bunVersion ?? process.versions.node,
    version: pkg.version,
    ...overrides,
  };
}

export function mainUsage(): string {
  const rows = Object.keys(COMMANDS).map((name): [string, string] => [name, COMMANDS[name]?.summary ?? ""]);
  rows.push(["help [<command>]", "print this help, or one command's help"]);
  const width = Math.max(...rows.map(([name]) => name.length));
  const lines = rows.map(([name, summary]) => `  ${name.padEnd(width)}  ${summary}`);
  return [
    "Usage: omt <command> [options]",
    "",
    "Commands:",
    ...lines,
    "",
    "Options:",
    "  -h, --help     print this help, or a command's help after the command",
    "  -v, --version  print the version",
    "",
  ].join("\n");
}

function unknownCommand(name: string, isHelpTarget = false): OmtError {
  const what = name.startsWith("-") && !isHelpTarget ? `unknown option "${name}"` : `unknown command "${name}"`;
  return new OmtError("usage", what, { exitCode: 2, hint: `run "omt --help" to see the commands` });
}

function helpText(args: string[]): string {
  const [name, extra] = args;
  if (extra !== undefined) throw usageError(`unexpected argument "${extra}"`);
  if (name === undefined || name === "--help" || name === "-h") return mainUsage();
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (command === undefined) throw unknownCommand(name, true);
  return command.usage;
}

function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "--help" || arg === "-h") return true;
  }
  return false;
}

function reportError(ctx: CliContext, error: unknown): number {
  if (error instanceof OmtError) {
    ctx.stderr(`omt: ${error.message}\n`);
    if (error.hint !== undefined) ctx.stderr(`hint: ${error.hint}\n`);
    return error.exitCode;
  }
  ctx.stderr(`omt: unexpected error: ${errorMessage(error)}\n`);
  return 1;
}

function warnShadowedState(ctx: CliContext): void {
  const shadowed = shadowedWorktreeState(ctx.cwd);
  if (shadowed === undefined) return;
  const main = omtDir(shadowed.main);
  ctx.stderr(`warning: ${shadowed.dir} holds plans or a ledger that omt no longer reads; move them to ${main}\n`);
  ctx.stderr(`hint: if git tracks them, untrack them with "git rm --cached" and commit; ${basename(main)}/.gitignore keeps plans out of git\n`);
}

export async function main(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const ctx = createContext(overrides);
  try {
    const [first, ...rest] = argv;
    if (first === undefined || first === "--help" || first === "-h") {
      ctx.stdout(mainUsage());
      return 0;
    }
    if (first === "--version" || first === "-v") {
      ctx.stdout(`${ctx.version}\n`);
      return 0;
    }
    if (first === "help") {
      ctx.stdout(helpText(rest));
      return 0;
    }
    const command = Object.hasOwn(COMMANDS, first) ? COMMANDS[first] : undefined;
    if (command === undefined) throw unknownCommand(first);
    if (wantsHelp(rest)) {
      ctx.stdout(command.usage);
      return 0;
    }
    if (STATE_COMMANDS.has(first)) warnShadowedState(ctx);
    if (PROJECT_COMMANDS.has(first) && !hasProjectMarker(ctx.cwd)) {
      ctx.stderr(`warning: no .omt3, .omt, or .git found above ${ctx.cwd}; omt uses it as the project root. Run omt from the project or worktree folder.\n`);
    }
    if (!NO_LEGACY_HINT.has(first)) {
      const hint = legacyHint(ctx);
      if (hint !== undefined) ctx.stderr(hint);
    }
    return await command.run({ ...ctx, argv: rest });
  } catch (error) {
    return reportError(ctx, error);
  }
}
