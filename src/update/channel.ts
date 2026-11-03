import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MISE_GITHUB_TOOL, PACKAGE_NAME, PACKAGE_NAMES, REPOSITORY_URL } from "../brand.ts";
import { findProjectRoot } from "../paths.ts";
import type { Env } from "../paths.ts";
import { oneShotRunner, runnerCommand } from "../install/project.ts";
import type { Runner } from "../install/project.ts";
import type { CliBuild } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { realOrSelf } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";

export type ChannelKind =
  | "npm-global" | "pnpm-global" | "bun-global" | "mise-github" | "mise-npm"
  | "dev-dependency" | "one-shot" | "source" | "binary" | "unknown";

export interface Channel {
  kind: ChannelKind;
  label: string; // for people, such as "npm global" or "mise (release binary)"
  packageName: "oh-my-t3code" | "omt3" | "oh-my-t3";
  key: string; // the same key means the same install
  projectRoot?: string; // dev-dependency: the folder above the first node_modules; one-shot: the project of cwd
  packageManager?: "npm" | "pnpm" | "bun" | "yarn"; // dev-dependency: from the lockfile
  runner?: Runner; // one-shot
}

export interface ChannelInput {
  build: CliBuild;
  cliPath: string;
  argv1?: string;
  cwd: string;
  packageRoot: string;
  env: Env;
  tempRoot?: string;
}

// `env` holds variables that the command gets in addition to the environment of omt.
export type RunCommand = (argv: string[], opts: { cwd?: string; inherit?: boolean; toStderr?: boolean; env?: Env }) => Promise<{ code: number; stdout: string }>;

export type UpdateAction = { kind: "run"; argv: string[]; display: string } | { kind: "hint"; text: string } | { kind: "repin" };

const RELEASES_URL = `${REPOSITORY_URL}/releases`;
// Set by omt update for the new CLI of a global channel: the CLI file that the package manager reported.
const CONFIRMED_GLOBAL_CLI = "OMT_UPDATE_GLOBAL_CLI";

const LABELS: Readonly<Record<ChannelKind, string>> = {
  "npm-global": "npm global",
  "pnpm-global": "pnpm global",
  "bun-global": "Bun global",
  "mise-github": "mise (release binary)",
  "mise-npm": "mise (npm package)",
  "dev-dependency": "dev dependency",
  "one-shot": "one-shot runner",
  source: "source clone",
  binary: "release binary",
  unknown: "unknown",
};

type GlobalKind = "npm-global" | "pnpm-global" | "bun-global";

interface GlobalCandidate {
  kind: GlobalKind;
  root: string;
  shared: boolean;
}

function pathCandidates(path: string): (GlobalCandidate | undefined)[] {
  const parts = path.split("/");
  const n = parts.length;
  if (parts[n - 1] !== "cli.js" || parts[n - 2] !== "dist" || !PACKAGE_NAMES.includes(parts[n - 3] ?? "") || parts[n - 4] !== "node_modules") return [];
  const candidate = (kind: GlobalKind, end: number, shared = false): GlobalCandidate => ({ kind, root: parts.slice(0, end).join("/"), shared });
  const five = parts[n - 5] === "5" && parts[n - 6] === "global" ? n - 3
    : parts[n - 6] === ".pnpm" && parts[n - 7] === "node_modules" && parts[n - 8] === "5" && parts[n - 9] === "global" ? n - 6 : undefined;
  const versioned = /^v\d+$/.test(parts[n - 6] ?? "") && parts[n - 7] === "global" && parts[n - 5] !== "";
  const links = parts.lastIndexOf("links", n - 5);
  const shared = links >= 1 && parts.slice(links + 1, n - 4).every((part) => part !== "");
  return [
    five === undefined ? undefined : candidate("pnpm-global", five),
    versioned ? candidate("pnpm-global", n - 5) : undefined,
    shared ? candidate("pnpm-global", links + 1, true) : undefined,
    parts[n - 5] === "global" && parts[n - 6] === "install" && parts[n - 7] === ".bun" ? candidate("bun-global", n - 4) : undefined,
    parts[n - 5] === "lib" ? candidate("npm-global", n - 3) : undefined,
  ];
}

function slashes(path: string): string {
  return path.replaceAll("\\", "/");
}

function readPackageJson(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function packageNameOf(input: ChannelInput): Channel["packageName"] {
  if (input.build !== "bundle") return PACKAGE_NAME;
  const name = readPackageJson(join(input.packageRoot, "package.json"))?.name;
  return name === "omt3" || name === "oh-my-t3code" ? name : PACKAGE_NAME;
}

function channel(kind: ChannelKind, packageName: Channel["packageName"], key: string, extra: Partial<Channel> = {}): Channel {
  return { kind, label: LABELS[kind], packageName, key, ...extra };
}

function bunGlobalDirs(env: Env): string[] {
  const dirs: string[] = [];
  if (env.BUN_INSTALL_GLOBAL_DIR) dirs.push(env.BUN_INSTALL_GLOBAL_DIR);
  if (env.BUN_INSTALL) dirs.push(join(env.BUN_INSTALL, "install", "global"));
  return dirs;
}

function globalCandidate(paths: string[], env: Env): GlobalCandidate | undefined {
  const normalized = paths.filter((path) => path.length <= 32_768).map(slashes);
  const candidates = normalized.map(pathCandidates);
  for (let priority = 0; priority < 5; priority++) {
    for (const options of candidates) {
      const found = options[priority];
      if (found !== undefined) return found;
    }
    if (priority !== 3) continue;
    for (const dir of bunGlobalDirs(env)) {
      for (const root of new Set([slashes(dir), slashes(realOrSelf(dir))])) {
        if (normalized.some((path) => PACKAGE_NAMES.some((name) => path === `${root}/node_modules/${name}/dist/cli.js`))) {
          return { kind: "bun-global", root, shared: false };
        }
      }
    }
  }
  return undefined;
}

// The folder above the first node_modules segment of a path.
function aboveNodeModules(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const normalized = slashes(path);
  const index = normalized.indexOf("/node_modules/");
  if (index < 0) return undefined;
  return path.slice(0, index) || "/";
}

function listsOmt(root: string): boolean {
  const manifest = readPackageJson(join(root, "package.json"));
  if (manifest === undefined) return false;
  return [manifest.devDependencies, manifest.dependencies].some(
    (deps) => isRecord(deps) && PACKAGE_NAMES.some((name) => Object.hasOwn(deps, name)),
  );
}

function lockfileManager(root: string): NonNullable<Channel["packageManager"]> {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

// The project's node_modules resolves its omt dependency to the CLI file `real`.
function linksCli(root: string, real: string): boolean {
  return PACKAGE_NAMES.some((name) => realOrSelf(join(root, "node_modules", name, "dist", "cli.js")) === real);
}

// The project of a dev-dependency channel resolves its omt dependency to the CLI file `cliPath`, so that CLI is the
// project's own omt now, also when the shim still records an older file.
export function linksProjectCli(found: Channel, cliPath: string): boolean {
  return found.kind === "dev-dependency" && found.projectRoot !== undefined && linksCli(found.projectRoot, realOrSelf(cliPath));
}

// Rule 6, or undefined when no project lists omt. With `linked`, the project must also link this CLI file,
// because a path in the shared pnpm store does not show the project that it belongs to.
function devDependency(input: ChannelInput, packageName: Channel["packageName"], linked = false): Channel | undefined {
  const real = realOrSelf(input.cliPath);
  if (input.build === "binary" || ![input.cliPath, real].some((path) => aboveNodeModules(path) !== undefined)) return undefined;
  const roots = [aboveNodeModules(input.cliPath), aboveNodeModules(real), aboveNodeModules(input.argv1), findProjectRoot(input.cwd)];
  for (const root of roots) {
    if (root === undefined || !listsOmt(root) || (linked && !linksCli(root, real))) continue;
    return channel("dev-dependency", packageName, `dev:${root}`, { projectRoot: root, packageManager: lockfileManager(root) });
  }
  return undefined;
}

// Rules 6 and 8.
function devDependencyOrUnknown(input: ChannelInput, packageName: Channel["packageName"]): Channel {
  return devDependency(input, packageName) ?? channel("unknown", packageName, `unknown:${realOrSelf(input.cliPath)}`);
}

function packageVersion(packageRoot: string): string {
  const version = readPackageJson(join(packageRoot, "package.json"))?.version;
  return typeof version === "string" ? version : "unknown";
}

// How detection settles a candidate in the shared pnpm store, which can be the global install or a project
// dependency: "confirm" leaves it to confirmChannel, and "shim" and "offline" settle it from local files.
type SharedStore = "confirm" | "shim" | "offline";

// Reads paths and package.json files only; confirmChannel checks a global candidate with its manager.
export function detectChannel(input: ChannelInput): Channel {
  return detect(input, "confirm");
}

// The channel of the CLI that a project's path shim records, with cwd set to that project. No package manager
// confirms it, and a real path in the shared pnpm store can be the global install or the project's own
// dependency, so a project whose package.json lists omt makes it a dev dependency (rule 6).
export function shimChannel(input: ChannelInput): Channel {
  return detect(input, "shim");
}

// The channel of the running CLI in omt update --skills-only, which starts no package manager. A shared pnpm
// store path stays a global candidate when argv1 is in a global folder, as the pnpm global bin passes it, or when
// the omt update that started this CLI confirmed its file with the manager. Else it is the dev dependency of a
// project that lists omt and links this CLI file, or unknown, so the sync leaves the user scope alone.
export function offlineChannel(input: ChannelInput): Channel {
  return detect(input, "offline");
}

function invokedGlobal(input: ChannelInput): boolean {
  return input.argv1 !== undefined && globalCandidate([input.argv1], input.env)?.shared === false;
}

// A custom pnpm global-dir matches no global folder pattern, so argv1 cannot show it.
function confirmedGlobal(input: ChannelInput): boolean {
  const file = input.env[CONFIRMED_GLOBAL_CLI];
  return file !== undefined && file !== "" && realOrSelf(file) === realOrSelf(input.cliPath);
}

// The environment that omt update adds for the new CLI of a global channel, whose `cli` newCliCommand returned.
export function confirmedGlobalEnv(found: Channel, cli: string[]): Env | undefined {
  const file = cli[1];
  return isGlobal(found.kind) && file !== undefined ? { [CONFIRMED_GLOBAL_CLI]: file } : undefined;
}

function detect(input: ChannelInput, sharedStore: SharedStore): Channel {
  const packageName = packageNameOf(input);
  if (input.cliPath.length > 32_768) return channel("unknown", packageName, "unknown:oversized-path");
  const real = realOrSelf(input.cliPath);
  const paths = [input.cliPath, real].map(slashes);
  if (input.build === "source") return channel("source", packageName, `source:${input.packageRoot}`);
  const runner = oneShotRunner(input.cliPath, input.env, input.tempRoot);
  if (runner !== undefined) {
    return channel("one-shot", packageName, `one-shot:${runner}:${packageVersion(input.packageRoot)}`, {
      runner,
      projectRoot: findProjectRoot(input.cwd),
    });
  }
  if (input.build === "binary" && paths.some((path) => /\/installs\/github-gabimoncha-oh-my-t3(?:code)?\/[^/]+\//.test(path))) {
    return channel("mise-github", packageName, "mise-github");
  }
  if (paths.some((path) => /\/installs\/npm-(?:oh-my-t3code|omt3|oh-my-t3)\/[^/]+\//.test(path))) {
    return channel("mise-npm", packageName, "mise-npm");
  }
  const global = globalCandidate(paths, input.env);
  if (global !== undefined) {
    const candidate = channel(global.kind, packageName, `${global.kind}:${global.root}`);
    if (!global.shared || sharedStore === "confirm") return candidate;
    if (sharedStore === "shim") return devDependency(input, packageName) ?? candidate;
    if (invokedGlobal(input) || confirmedGlobal(input)) return candidate;
    return devDependency(input, packageName, true) ?? channel("unknown", packageName, `unknown:${real}`);
  }
  if (input.build === "binary") return channel("binary", packageName, `binary:${real}`);
  return devDependencyOrUnknown(input, packageName);
}

const ROOT_COMMANDS: Readonly<Record<GlobalKind, string[]>> = {
  "npm-global": ["npm", "root", "-g"],
  "pnpm-global": ["pnpm", "root", "-g"],
  "bun-global": ["bun", "pm", "ls", "-g"],
};

function isGlobal(kind: ChannelKind): kind is GlobalKind {
  return Object.hasOwn(ROOT_COMMANDS, kind);
}

function hasCli(folder: string): boolean {
  return existsSync(join(folder, "dist", "cli.js"));
}

function pnpm11Folders(root: string, packageName: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries.sort().map((entry) => join(root, entry, "node_modules", packageName)).filter(hasCli);
}

// The global package folders that the manager reports and that hold dist/cli.js: first `<root>/<package>`,
// then the pnpm 11 folders `<root>/<dir>/node_modules/<package>`. `<dir>` can have the package name, so a
// folder counts only when its dist/cli.js exists. Undefined when the command fails.
async function globalPackageFolders(kind: GlobalKind, packageName: string, run: RunCommand): Promise<{ direct?: string; pnpm11: string[] } | undefined> {
  let result: { code: number; stdout: string };
  try {
    result = await run(ROOT_COMMANDS[kind], {});
  } catch {
    return undefined;
  }
  const first = result.stdout.split(/\r?\n/)[0]?.trim() ?? "";
  if (result.code !== 0 || first === "") return undefined;
  let dir: string | undefined = first;
  if (kind === "bun-global") {
    dir = / node_modules \([^)]*\)$/.exec(first) === null ? undefined : join(first.replace(/ node_modules \([^)]*\)$/, ""), "node_modules");
  }
  if (dir === undefined) return undefined;
  const direct = join(dir, packageName);
  return { direct: hasCli(direct) ? direct : undefined, pnpm11: kind === "pnpm-global" ? pnpm11Folders(first, packageName) : [] };
}

// Runs only in omt update. A global candidate stays only when its manager reports the same CLI file;
// else detection continues at rule 6.
export async function confirmChannel(found: Channel, input: ChannelInput, run: RunCommand): Promise<Channel> {
  if (!isGlobal(found.kind)) return found;
  const reported = await globalPackageFolders(found.kind, found.packageName, run);
  const folders = reported === undefined ? [] : [reported.direct ?? [], reported.pnpm11].flat();
  const real = realOrSelf(input.cliPath);
  if (folders.some((folder) => realOrSelf(join(folder, "dist", "cli.js")) === real)) return found;
  return devDependencyOrUnknown(input, found.packageName);
}

function installTable(version: string): string {
  return [
    `  mise, release binary: mise use -g ${MISE_GITHUB_TOOL}@${version}`,
    `  mise, npm package: mise use -g npm:oh-my-t3@${version}`,
    `  npm, global: npm i -g oh-my-t3@${version}`,
    `  pnpm, global: pnpm add -g oh-my-t3@${version}`,
    `  Bun, global: bun add -g oh-my-t3@${version}`,
    `  npm, dev dependency: npm i -D oh-my-t3@${version}`,
    `  pnpm, dev dependency: pnpm add -D oh-my-t3@${version}`,
    `  Bun, dev dependency: bun add -D oh-my-t3@${version}`,
    `  one-shot: npx oh-my-t3@${version}, bunx oh-my-t3@${version}, or pnpm dlx oh-my-t3@${version}`,
  ].join("\n");
}

const DEV_COMMANDS: Readonly<Record<NonNullable<Channel["packageManager"]>, string>> = {
  npm: "npm i -D",
  pnpm: "pnpm add -D",
  bun: "bun add -D",
  yarn: "yarn add -D",
};

// The project's own omt, through its package manager. The shim can still name the old CLI file after the
// update, such as an old folder of the shared pnpm store, so the sync after a dependency update avoids it.
const EXEC_COMMANDS: Readonly<Record<NonNullable<Channel["packageManager"]>, string>> = {
  npm: "npx omt",
  pnpm: "pnpm exec omt",
  bun: "bunx omt",
  yarn: "yarn omt",
};

function runAction(channel: Channel, version: string): { argv: string[]; display: string } | undefined {
  const spec = `${channel.packageName}@${version}`;
  switch (channel.kind) {
    case "npm-global":
      return { argv: ["npm", "install", "-g", spec], display: `npm install -g ${spec}` };
    case "pnpm-global":
      return { argv: ["pnpm", "add", "-g", spec], display: `pnpm add -g ${spec}` };
    case "bun-global":
      return { argv: ["bun", "add", "-g", spec], display: `bun add -g ${spec}` };
    case "mise-github":
    case "mise-npm": {
      const tool = channel.kind === "mise-github" ? `${MISE_GITHUB_TOOL}@${version}` : `npm:${spec}`;
      return { argv: ["mise", "use", "-g", tool], display: `mise use -g ${tool} (writes ${tool} into your global mise config)` };
    }
    default:
      return undefined;
  }
}

function hintText(channel: Channel, version: string, cliPath: string): string {
  switch (channel.kind) {
    case "source":
      return "update the clone with git pull and bun install, then run omt update --skills-only";
    case "dev-dependency": {
      const manager = channel.packageManager ?? "npm";
      return `run ${DEV_COMMANDS[manager]} ${channel.packageName}@${version} in ${channel.projectRoot}, then run ${EXEC_COMMANDS[manager]} update --skills-only --project there`;
    }
    case "binary":
      return `download the release binary from ${RELEASES_URL}, or install with mise use -g ${MISE_GITHUB_TOOL}@${version}`;
    default:
      return `omt cannot tell how it was installed (${cliPath}); update it with the command of your channel:\n${installTable(version)}`;
  }
}

export function updateAction(channel: Channel, version: string): UpdateAction {
  const run = runAction(channel, version);
  const windows = process.platform === "win32";
  if (run !== undefined) return windows ? { kind: "hint", text: `run ${run.display}` } : { kind: "run", ...run };
  if (channel.kind === "one-shot") {
    if (!windows) return { kind: "repin" };
    const command = runnerCommand(channel.runner ?? "npx", version);
    return { kind: "hint", text: `run ${command} install --project in ${channel.projectRoot}` };
  }
  return { kind: "hint", text: hintText(channel, version, channel.key.slice(channel.key.indexOf(":") + 1)) };
}

// The argv prefix that runs the CLI after the update. The global kinds run the bundle with the runtime that
// runs omt now, so a machine with only Bun does not go through the `#!/usr/bin/env node` bin.
export async function newCliCommand(channel: Channel, version: string, run: RunCommand): Promise<string[]> {
  if (isGlobal(channel.kind)) {
    const reported = await globalPackageFolders(channel.kind, channel.packageName, run);
    const folders = reported === undefined ? [] : [reported.direct ?? [], reported.pnpm11].flat();
    const folder = folders.find((candidate) => readPackageJson(join(candidate, "package.json"))?.version === version);
    if (folder === undefined) {
      const shown = folders.length === 0 ? "no folder" : folders.join(", ");
      throw new OmtError("update_new_cli", `the update finished, but ${ROOT_COMMANDS[channel.kind].join(" ")} shows no ${channel.packageName}@${version} (folders: ${shown})`);
    }
    return [process.execPath, join(folder, "dist", "cli.js")];
  }
  if (channel.kind === "mise-github") return ["mise", "exec", `${MISE_GITHUB_TOOL}@${version}`, "--", "omt"];
  if (channel.kind === "mise-npm") return ["mise", "exec", `npm:${channel.packageName}@${version}`, "--", "omt"];
  if (channel.kind === "one-shot" && channel.projectRoot !== undefined) return [join(channel.projectRoot, ".omt", "bin", "omt")];
  return channel.kind === "binary" || process.argv[1] === undefined ? [process.execPath] : [process.execPath, process.argv[1]];
}

// Runs a command without a shell. `inherit` shares the terminal; `toStderr` sends the child's stdout to
// stderr, so the JSON on stdout stays one object. Else stdout is captured and stderr is dropped.
export const spawnCommand: RunCommand = (argv, opts) =>
  new Promise((resolve) => {
    const [command, ...args] = argv;
    if (command === undefined) {
      resolve({ code: 127, stdout: "" });
      return;
    }
    const stdio: ("inherit" | "pipe" | "ignore" | number)[] = opts.inherit
      ? ["inherit", opts.toStderr ? 2 : "inherit", "inherit"]
      : ["ignore", "pipe", "ignore"];
    const env = opts.env === undefined ? process.env : { ...process.env, ...opts.env };
    const child = spawn(command, args, { cwd: opts.cwd, env, stdio, shell: false });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", () => resolve({ code: 127, stdout }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
