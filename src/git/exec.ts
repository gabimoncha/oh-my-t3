import { spawnSync } from "node:child_process";
import type { CliContext } from "../types.ts";
import { OmtError } from "../util/errors.ts";

export type ToolContext = Pick<CliContext, "cwd" | "env">;

export interface ToolResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | undefined; // set when the tool could not start, for example when it is not on PATH
}

// Runs `git` or `gh` from PATH, as the user's shell would.
export function runTool(
  ctx: ToolContext,
  command: "git" | "gh",
  args: string[],
  options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv } = {},
): ToolResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ctx.cwd,
    env: { ...ctx.env, ...options.env },
    encoding: "utf8",
    input: options.input ?? "",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

export function firstLine(result: ToolResult): string {
  const text = result.error?.message ?? (result.stderr.trim() || result.stdout.trim());
  return text.split(/\r?\n/)[0]?.trim() || `exit code ${String(result.status)}`;
}

export function ok(result: ToolResult): boolean {
  return result.error === undefined && result.status === 0;
}

// Runs git and returns its stdout, or throws an OmtError (exit 1) with git's first error line.
export function git(ctx: ToolContext, args: string[], options: { cwd?: string; input?: string } = {}): string {
  const result = runTool(ctx, "git", args, options);
  if (!ok(result)) throw new OmtError("git_failed", `git ${args[0] ?? ""} failed: ${firstLine(result)}`);
  return result.stdout;
}

export function trimEnd(text: string): string {
  return text.replace(/\r?\n$/, "");
}
