import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { envPath, t3HomeDir } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { errorCode, lstatIfExists, pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import type { ManifestFile } from "./manifest.ts";
import type { PlanAction } from "./plan.ts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

// The bundled T3 workflow files (workflows/*.ts) and their copies in the T3 workflows folder. Only a
// user install writes them, because T3 reads one folder for the whole machine.

export interface WorkflowStep {
  name: string; // the file name, such as omt.ts
  source: string;
  path: string;
  action: PlanAction;
  reason?: string;
  sourceHash?: string;
  ownedHash?: string; // the hash that the manifest recorded when omt last wrote the path
}

export interface WorkflowPlan {
  dir: string;
  skipped?: string; // why the install writes no workflow file
  steps: WorkflowStep[];
}

type Env = CliContext["env"];

// The folder that T3 loads workflow files from: T3CODE_WORKFLOWS, or the workflows folder of the T3 home.
export function workflowsDir(env: Env, homedir: string): string {
  return envPath(env, "T3CODE_WORKFLOWS") ?? join(t3HomeDir(env, homedir), "workflows");
}

export async function listBundledWorkflows(packageRoot: string): Promise<{ name: string; path: string }[]> {
  let names: string[];
  try {
    names = await readdir(join(packageRoot, "workflows"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(".ts")).sort().map((name) => ({ name, path: join(packageRoot, "workflows", name) }));
}

// The workflow names that a file defines, such as omt-ulw.
export function definedWorkflows(text: string): string[] {
  return [...text.matchAll(/\bworkflow\(\s*"([^"]+)"/g)].map((match) => match[1] as string);
}

export type WorkflowsState = { state: "on" | "off" | "unknown"; message: string; unfinished: Map<string, number> };

const UNFINISHED = new Set(["running", "waiting", "paused"]);

// Asks the T3 server through the t3 CLI whether workflows are on, and counts the unfinished runs of each
// workflow. OMT_T3 names another t3 command.
export function t3Workflows(ctx: Pick<CliContext, "env" | "cwd">): WorkflowsState {
  const command = ctx.env.OMT_T3 ?? "t3";
  const result = spawnSync(command, ["workflow", "list", "--json"], {
    cwd: ctx.cwd,
    env: ctx.env,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const unfinished = new Map<string, number>();
  if (result.error !== undefined) {
    return { state: "unknown", message: `cannot run ${command}: ${result.error.message}`, unfinished };
  }
  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  if (result.status !== 0) {
    if (/Workflows are off/.test(output)) return { state: "off", message: "T3 Workflows is off; turn it on in T3 Settings → Labs → Workflows", unfinished };
    return { state: "unknown", message: `${command} workflow list failed: ${output.trim().split("\n")[0] ?? `exit ${String(result.status)}`}`, unfinished };
  }
  try {
    const runs = JSON.parse(result.stdout) as { workflow?: unknown; status?: unknown }[];
    for (const run of runs) {
      if (typeof run.workflow === "string" && typeof run.status === "string" && UNFINISHED.has(run.status)) {
        unfinished.set(run.workflow, (unfinished.get(run.workflow) ?? 0) + 1);
      }
    }
  } catch {
    return { state: "unknown", message: `${command} workflow list printed no JSON`, unfinished };
  }
  return { state: "on", message: "T3 Workflows is on", unfinished };
}

function unfinishedIn(text: string, state: WorkflowsState): number {
  return definedWorkflows(text).reduce((sum, name) => sum + (state.unfinished.get(name) ?? 0), 0);
}

function heldBack(count: number, verb: string): string {
  return `${count} unfinished T3 workflow runs use it; ${verb} after they end or are cancelled`;
}

// One step per bundled file. A file that omt did not write, or that changed since, is a conflict. A file
// whose workflows have unfinished runs is kept, because T3 refuses a file that drops a version in use.
export async function planWorkflows(ctx: CliContext, recorded: ManifestFile[] | undefined): Promise<WorkflowPlan> {
  const dir = workflowsDir(ctx.env, ctx.homedir);
  const bundled = await listBundledWorkflows(ctx.packageRoot);
  const plan: WorkflowPlan = { dir, steps: [] };
  if (bundled.length === 0) return plan;
  if (envPath(ctx.env, "T3CODE_WORKFLOWS") === undefined && !(await pathExists(t3HomeDir(ctx.env, ctx.homedir)))) {
    plan.skipped = `no T3 home at ${t3HomeDir(ctx.env, ctx.homedir)}`;
    return plan;
  }
  if ((await lstatIfExists(dir))?.isFile() === true) {
    plan.skipped = `T3CODE_WORKFLOWS names the file ${dir}, not a folder`;
    return plan;
  }
  let state: WorkflowsState | undefined;
  for (const file of bundled) {
    const path = join(dir, file.name);
    const source = (await readFileIfExists(file.path)) ?? "";
    const before = await readFileIfExists(path);
    const owned = recorded?.find((entry) => entry.path === path);
    const step: WorkflowStep = { name: file.name, source: file.path, path, action: "create", sourceHash: sha256(source) };
    if (owned !== undefined) step.ownedHash = owned.sha256;
    if (before === source) step.action = "unchanged";
    else if (before !== undefined && owned === undefined) Object.assign(step, { action: "conflict", reason: "not managed by omt" });
    else if (before !== undefined && owned?.sha256 !== sha256(before)) Object.assign(step, { action: "conflict", reason: "locally modified" });
    else if (before !== undefined) {
      state ??= t3Workflows(ctx);
      const count = unfinishedIn(before, state);
      step.action = count > 0 ? "keep" : "update";
      if (count > 0) step.reason = heldBack(count, "run omt update");
    }
    plan.steps.push(step);
  }
  return plan;
}

export async function applyWorkflows(plan: WorkflowPlan): Promise<string[]> {
  const changed: string[] = [];
  for (const step of plan.steps) {
    if (step.action !== "create" && step.action !== "update" && step.action !== "replace") continue;
    await writeFileAtomic(step.path, (await readFileIfExists(step.source)) ?? "");
    changed.push(step.path);
  }
  return changed;
}

// What the manifest keeps after an install: each path that omt wrote, or wrote before and keeps.
export function workflowRecords(plan: WorkflowPlan): ManifestFile[] {
  return plan.steps.flatMap((step) => {
    const written = ["create", "update", "replace", "unchanged"].includes(step.action);
    const hash = written ? step.sourceHash : step.ownedHash;
    return hash === undefined ? [] : [{ path: step.path, sha256: hash }];
  });
}

// Uninstall: remove each recorded file that still holds what omt wrote and has no unfinished runs.
export async function planWorkflowRemoval(ctx: CliContext, recorded: ManifestFile[] | undefined, force: boolean): Promise<WorkflowStep[]> {
  const steps: WorkflowStep[] = [];
  let state: WorkflowsState | undefined;
  for (const entry of recorded ?? []) {
    const text = await readFileIfExists(entry.path);
    if (text === undefined) continue;
    const step: WorkflowStep = { name: entry.path, source: "", path: entry.path, action: "remove" };
    if (sha256(text) !== entry.sha256 && !force) Object.assign(step, { action: "keep", reason: "locally modified; add --force to remove it" });
    else {
      state ??= t3Workflows(ctx);
      const count = unfinishedIn(text, state);
      if (count > 0) Object.assign(step, { action: "keep", reason: heldBack(count, "run omt uninstall again") });
    }
    steps.push(step);
  }
  return steps;
}

export async function removeWorkflows(steps: WorkflowStep[]): Promise<string[]> {
  const removed: string[] = [];
  for (const step of steps) {
    if (step.action !== "remove") continue;
    await rm(step.path, { force: true });
    removed.push(step.path);
  }
  return removed;
}
