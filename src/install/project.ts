import { lstatSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { MISE_GITHUB_TOOL, PACKAGE_NAME, REPOSITORY_URL } from "../brand.ts";
import { isWithin } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { OmtError } from "../util/errors.ts";
import { errorCode, readFileIfExists, realOrSelf } from "../util/fs.ts";

export const SHIM_SIGNATURE = "# oh-my-t3code project shim";
export const INSTALL_URL = `${REPOSITORY_URL}#install`;
export const INSTALL_CHANNELS: readonly string[] = [
  `npm i -g ${PACKAGE_NAME}`,
  `pnpm add -g ${PACKAGE_NAME}`,
  `bun add -g ${PACKAGE_NAME}`,
  `mise use -g ${MISE_GITHUB_TOOL}`,
];
export const OMT_GITIGNORE_LINES: readonly string[] = ["ledger.jsonl", "evidence/", "bin/", "install.json", "backups/", "plans/", "locks/", "guardrails.md", "grills/"];
export const BACKUPS_GITIGNORE = "*\n";

// The markers carry the project root, because worktrees of one repository share one exclude file.
export function excludeBegin(root: string): string {
  return `# >>> oh-my-t3code project install: ${root} >>>`;
}

export function excludeEnd(root: string): string {
  return `# <<< oh-my-t3code project install: ${root} <<<`;
}

export type Runner = "npx" | "pnpm" | "bunx";

const RUNNER_COMMANDS: Readonly<Record<Runner, string>> = { npx: "npx --yes", pnpm: "pnpm dlx", bunx: "bunx" };

// The runner that a one-shot cache path names. Each pattern starts at the cache root:
// npx: `<npm cache>/_npx/<hash>/node_modules/`. pnpm 9 and later: `<pnpm cache>/dlx/<hash>/<id>/node_modules/`
// (`pnpm`, or `pnpm-cache` on Windows), and pnpm 8 has no `<id>`. bunx: `<temp>/bunx-<uid>-<package>/node_modules/`,
// and from Bun 1.4.4 `<bun install cache>/.bunx-<uid>/omt3@<version>/node_modules/`.
// An older pnpm and yarn use `<temp>/dlx-<pid>/node_modules/`, which names no runner (null).
// A custom pnpm cache-dir can have any name, so `<any>/dlx/<hash>/<id>/node_modules/` counts only when
// pnpm runs the CLI, as npm_config_user_agent shows, and `<hash>/pkg` is the symlink to `<id>` that pnpm
// dlx writes. `pnpm exec` sets the same user agent, so a project directory could match without the symlink.
function isPnpmDlxEntry(path: string): boolean {
  for (const match of path.matchAll(/\/dlx\/([^/]+)\/([^/]+)\/node_modules\//g)) {
    const entry = `${path.slice(0, match.index)}/dlx/${match[1]}`;
    const pkg = `${entry}/pkg`;
    try {
      if (!lstatSync(pkg).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    if (realOrSelf(pkg) === realOrSelf(`${entry}/${match[2]}`)) return true;
  }
  return false;
}

function cacheRunner(path: string, temps: string[], agent: Runner | undefined): Runner | null | undefined {
  const normalized = path.replaceAll("\\", "/");
  if (/\/_npx\/[0-9a-f]+\/node_modules\//i.test(normalized)) return "npx";
  if (/\/pnpm(?:-cache)?\/dlx\/[^/]+\/(?:[^/]+\/)?node_modules\//i.test(normalized)) return "pnpm";
  if (agent === "pnpm" && isPnpmDlxEntry(normalized)) return "pnpm";
  if (/\/\.bunx-\d+\/(?:omt3|oh-my-t3code|oh-my-t3)@[^/]+\/node_modules\//.test(normalized)) return "bunx";
  for (const temp of temps) {
    if (!isWithin(temp, path)) continue;
    const rel = relative(temp, path).replaceAll("\\", "/");
    if (/^bunx-\d+-[^/]+\/node_modules\//.test(rel)) return "bunx";
    if (/^dlx-\d+\/node_modules\//.test(rel)) return null;
  }
  return undefined;
}

// npm, pnpm, and bun set npm_config_user_agent, such as "pnpm/10.0.0 npm/? node/v22.0.0".
function agentRunner(agent: string | undefined): Runner | undefined {
  const name = /^([\w.-]+)\//.exec(agent ?? "")?.[1];
  if (name === "npm") return "npx";
  if (name === "pnpm") return "pnpm";
  if (name === "bun") return "bunx";
  return undefined;
}

// The one-shot runner that runs the CLI, or undefined when the CLI is not in a runner cache. The cache
// path names the runner; when it does not, npm_config_user_agent does; else it is npx.
export function oneShotRunner(cliPath: string, env: Record<string, string | undefined>, tempRoot: string = tmpdir()): Runner | undefined {
  const temps = [tempRoot, realOrSelf(tempRoot)];
  const agent = agentRunner(env.npm_config_user_agent);
  const found = [cliPath, realOrSelf(cliPath)].map((path) => cacheRunner(path, temps, agent));
  if (found.every((runner) => runner === undefined)) return undefined;
  return found.find((runner): runner is Runner => typeof runner === "string") ?? agent ?? "npx";
}

export function runnerCommand(runner: Runner, version: string): string {
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) {
    throw new OmtError("shim_version", `refusing --project: the version cannot be used in a shell command: ${version}`);
  }
  return `${RUNNER_COMMANDS[runner]} omt3@${version}`;
}

// A project install from a one-shot cache returns the runner, and its shim calls that runner with the
// pinned version. A user install from that cache, and any install from another temp path, would
// record a CLI path that can disappear, so they are refused.
export function assertInstallSource(
  cliPath: string,
  env: Record<string, string | undefined>,
  scope: "user" | "project",
  tempRoot: string = tmpdir(),
): Runner | undefined {
  const runner = oneShotRunner(cliPath, env, tempRoot);
  if (runner !== undefined && scope === "project") return runner;
  const temps = [tempRoot, realOrSelf(tempRoot)];
  const temporary = [cliPath, realOrSelf(cliPath)].some((path) => temps.some((temp) => isWithin(temp, path)));
  if (runner === undefined && !temporary) return undefined;
  const what = scope === "project" ? "--project" : "the user install";
  const where = runner === undefined ? "a temporary path" : `a one-shot ${runner} cache`;
  throw new OmtError("cli_path", `refusing ${what}: the omt CLI runs from ${where} (${cliPath})`, {
    hint: `install omt with one of: ${INSTALL_CHANNELS.join(", ")}; then run omt install${scope === "project" ? " --project" : ""} again. Or run npx ${PACKAGE_NAME} install --project in the project`,
  });
}

// What the project shim runs.
export type ShimTarget =
  | { kind: "source" | "bundle"; runtime: string; cli: string }
  | { kind: "binary"; cli: string }
  | { kind: "runner"; runner: Runner; version: string };

// The runtime that a shim or a user hook records: the one that runs the CLI now.
export function runtimeOf(ctx: Pick<CliContext, "build" | "runtimePath">): string {
  return ctx.runtimePath ?? (ctx.build === "source" ? "bun" : "node");
}

export function shimTarget(ctx: Pick<CliContext, "build" | "cliPath" | "runtimePath" | "version">, runner?: Runner): ShimTarget {
  if (runner !== undefined) return { kind: "runner", runner, version: ctx.version };
  if (ctx.build === "binary") return { kind: "binary", cli: ctx.cliPath };
  return { kind: ctx.build, runtime: runtimeOf(ctx), cli: ctx.cliPath };
}

function assertShellSafe(path: string): void {
  if (/["$`\\\n]/.test(path)) {
    throw new OmtError("shim_cli_path", `refusing --project: the path cannot be quoted safely for a shell: ${path}`);
  }
}

// When the recorded file is gone, a bundle or binary shim runs the project's node_modules/.bin/omt,
// then the first omt on PATH that is not the shim itself, so .omt/bin on PATH cannot make it loop.
const FALLBACK_LINES: readonly string[] = [
  "case $0 in */*) root=${0%/*}/../.. ;; *) root=../.. ;; esac",
  'if [ -x "$root/node_modules/.bin/omt" ]; then',
  '  exec "$root/node_modules/.bin/omt" "$@"',
  "fi",
  "IFS=:",
  "set -f",
  'dirs="$PATH:"',
  "for dir in $dirs; do",
  '  if [ -f "${dir:-.}/omt" ] && [ -x "${dir:-.}/omt" ] && [ ! "${dir:-.}/omt" -ef "$0" ]; then',
  '    exec "${dir:-.}/omt" "$@"',
  "  fi",
  "done",
  `echo "omt: the omt CLI is not installed; see ${INSTALL_URL}" >&2`,
  "exit 127",
];

// The sources run with the recorded Bun, or bun on PATH. The bundle runs with the recorded runtime, or
// node on PATH. A one-shot shim calls the runner, which may download the package again.
export function shimContent(target: ShimTarget): string {
  const lines = ["#!/bin/sh", SHIM_SIGNATURE];
  if (target.kind === "runner") {
    lines.push(`exec ${runnerCommand(target.runner, target.version)} "$@"`);
  } else if (target.kind === "binary") {
    assertShellSafe(target.cli);
    lines.push(`cli="${target.cli}"`, 'if [ -x "$cli" ]; then', '  exec "$cli" "$@"', "fi", ...FALLBACK_LINES);
  } else {
    for (const path of [target.runtime, target.cli]) assertShellSafe(path);
    lines.push(`runtime="${target.runtime}"`, `cli="${target.cli}"`);
    if (target.kind === "source") {
      lines.push('[ -x "$runtime" ] || runtime=bun', 'exec "$runtime" "$cli" "$@"');
    } else {
      lines.push('if [ -f "$cli" ]; then', '  [ -x "$runtime" ] || runtime=node', '  exec "$runtime" "$cli" "$@"', "fi", ...FALLBACK_LINES);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function isManagedShim(text: string | undefined): boolean {
  return text !== undefined && text.split("\n")[1] === SHIM_SIGNATURE;
}

export interface ShimPaths {
  runtime?: string; // the recorded runtime: node in the old format, node or bun in a source or bundle shim
  runtimeFallback?: string; // what runs when the recorded runtime is gone
  cli?: string; // the recorded CLI file
  runner?: string; // the runner command of a one-shot shim
}

// Reads every shim format, also the old Node shim (`node="..."` and `exec "$node" "<cli>"`).
export function shimPaths(text: string): ShimPaths {
  if (text.length > 65_536) return {};
  const runtime = /^(?:node|runtime)="([^"]*)"$/m.exec(text)?.[1];
  const runtimeFallback = /\|\| (?:node|runtime)=(\w+)$/m.exec(text)?.[1];
  const cli = /^cli="([^"]*)"$/m.exec(text)?.[1] ?? /^exec "\$node" "([^"]*)"/m.exec(text)?.[1];
  const runner = /^exec ((?:npx --yes|pnpm dlx|bunx) omt3@\S+) "\$@"$/m.exec(text)?.[1];
  return {
    ...(runtime === undefined ? {} : { runtime }),
    ...(runtimeFallback === undefined ? {} : { runtimeFallback }),
    ...(cli === undefined ? {} : { cli }),
    ...(runner === undefined ? {} : { runner }),
  };
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// Appends the missing lines and never removes one.
export function withGitignoreLines(text: string | undefined): string {
  const current = text ?? "";
  const present = new Set(splitLines(current).map((line) => line.trim()));
  const missing = OMT_GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return current;
  const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  return `${prefix}${missing.join("\n")}\n`;
}

export interface GitExclude {
  path?: string; // the exclude file, when the root is inside a repository
  top?: string; // the repository top level: the directory that holds `.git`
  note?: string; // why there is no path
}

async function dotGitKind(path: string): Promise<"dir" | "file" | undefined> {
  try {
    return (await stat(path)).isDirectory() ? "dir" : "file";
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

// Finds `info/exclude` without running git. Walks up from the root to the nearest `.git`, which is a
// directory or a file with `gitdir: <path>` (a worktree or a submodule).
export async function findGitExclude(root: string): Promise<GitExclude> {
  let top = resolve(root);
  let kind = await dotGitKind(join(top, ".git"));
  while (kind === undefined) {
    const parent = dirname(top);
    if (parent === top) return { note: `${root} has no .git, and no parent directory has one; git exclude skipped` };
    top = parent;
    kind = await dotGitKind(join(top, ".git"));
  }
  const dotGit = join(top, ".git");
  if (kind === "dir") return { path: join(dotGit, "info", "exclude"), top };
  const text = (await readFileIfExists(dotGit)) ?? "";
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (match === null || match[1] === undefined) return { note: `${dotGit} has no gitdir line; git exclude skipped` };
  const gitDir = resolve(top, match[1]);
  const commonDir = (await readFileIfExists(join(gitDir, "commondir")))?.trim();
  const common = commonDir === undefined || commonDir === "" ? gitDir : resolve(gitDir, commonDir);
  return { path: join(common, "info", "exclude"), top };
}

// Puts a backslash before each character that git reads as a glob, and before trailing spaces.
// A pattern always starts with "/", so a leading "!" or "#" cannot occur.
function escapeGlob(text: string): string {
  const escaped = text.replace(/[\\[\]*?]/g, (char) => `\\${char}`);
  return escaped.replace(/ +$/, (spaces) => "\\ ".repeat(spaces.length));
}

// The pattern for `path`, anchored at the repository top level, with glob characters escaped.
export function excludePattern(top: string, path: string, dir = false): string {
  const rel = relative(top, path).split(sep).join("/");
  return `/${escapeGlob(rel)}${dir ? "/" : ""}`;
}

// Matches the scratch directories of an install or uninstall run next to the agents root.
export function scratchPattern(top: string, agentsRoot: string): string {
  return `${excludePattern(top, dirname(agentsRoot), true)}.omt-*/`;
}

export const SCRATCH_NAME = /^\.omt-(?:tmp|old)-[0-9a-f]+$/;

// The block of one root runs from its BEGIN marker to the next END marker of the same root. A BEGIN
// marker without an END marker is no block, so no edit ever runs to the end of the file.
function blockRange(lines: string[], root: string): [number, number] | undefined {
  const begin = excludeBegin(root);
  const end = excludeEnd(root);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] !== end) continue;
    const start = lines.lastIndexOf(begin, index - 1);
    if (start !== -1) return [start, index];
  }
  return undefined;
}

export function excludeBlockLines(text: string | undefined, root: string): string[] | undefined {
  const lines = splitLines(text ?? "");
  const range = blockRange(lines, root);
  return range === undefined ? undefined : lines.slice(range[0] + 1, range[1]);
}

// The roots of every complete block in the file.
export function excludeBlockRoots(text: string | undefined): string[] {
  const prefix = "# >>> oh-my-t3code project install: ";
  const roots = new Set<string>();
  for (const line of splitLines(text ?? "")) {
    if (!line.startsWith(prefix) || !line.endsWith(" >>>")) continue;
    const root = line.slice(prefix.length, -" >>>".length);
    if (excludeBlockLines(text, root) !== undefined) roots.add(root);
  }
  return [...roots];
}

function removeBlocks(lines: string[], roots: string[]): { removed: boolean; removedLast: boolean } {
  let removed = false;
  let removedLast = false;
  for (const root of roots) {
    for (let range = blockRange(lines, root); range !== undefined; range = blockRange(lines, root)) {
      if (range[1] === lines.length - 1) removedLast = true;
      lines.splice(range[0], range[1] - range[0] + 1);
      removed = true;
    }
  }
  return { removed, removedLast };
}

// Replaces the root's block in place, or the block of a stale root (an old path of the same
// project), or appends a new block. Other blocks of the stale roots go. Every other line stays.
export function withExcludeBlock(text: string | undefined, root: string, entries: string[], stale: string[] = []): string {
  const current = text ?? "";
  const block = [excludeBegin(root), ...entries, excludeEnd(root)];
  const lines = splitLines(current);
  let range = blockRange(lines, root);
  for (const other of stale) range ??= blockRange(lines, other);
  if (range === undefined) {
    const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
    return `${prefix}${block.join("\n")}\n`;
  }
  lines.splice(range[0], range[1] - range[0] + 1, ...block);
  removeBlocks(lines, stale.filter((other) => other !== root));
  return `${lines.join("\n")}${current.endsWith("\n") ? "\n" : ""}`;
}

// Removes the blocks of the given roots. When the last block of the file goes and the install added
// the newline before it (`addedNewline`), that newline goes too, so the file gets its old bytes back.
export function withoutExcludeBlocks(text: string, roots: string[], addedNewline = false): string {
  const lines = splitLines(text);
  const { removed, removedLast } = removeBlocks(lines, roots);
  if (!removed) return text;
  if (lines.length === 0) return "";
  const finalNewline = removedLast ? !addedNewline : text.endsWith("\n");
  return `${lines.join("\n")}${finalNewline ? "\n" : ""}`;
}
