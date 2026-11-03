import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { DEFAULT_CONFIG, diffDefaults } from "../config/defaults.ts";
import { loadConfig } from "../config/load.ts";
import { projectShimPath, skillRoots, t3SettingsPath } from "../paths.ts";
import { resolveAll } from "../routing/resolve.ts";
import type { Capabilities, CliContext, LoadedConfig } from "../types.ts";
import { dailyCheck, recordApplyAttempt } from "../update/check.ts";
import type { DailyResult } from "../update/check.ts";
import { runUpdate } from "../update/flow.ts";
import { errorMessage } from "../util/errors.ts";
import { pathExists, readFileIfExists } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { plural } from "../util/output.ts";
import { findManagedCommands, parseSettings } from "./claudeHook.ts";
import { resolveReal } from "./fsops.ts";
import { classifyLink, planLinks } from "./links.ts";
import type { Manifest } from "./manifest.ts";
import { loadScopeManifest, retiredSkills, scopePaths } from "./plan.ts";
import type { InstallScope, ScopePaths } from "./plan.ts";
import {
  excludeBlockLines,
  excludeBlockRoots,
  findGitExclude,
  INSTALL_CHANNELS,
  isManagedShim,
  oneShotRunner,
  runnerCommand,
  shimPaths,
} from "./project.ts";
import { worktreeSummary } from "../worktree/check.ts";
import { DEFAULT_HARNESSES, harnessEffects } from "./harness.ts";
import { classifySkill, isManagedDir, listBundledSkills, OPT_IN_SKILLS, selectedSkills } from "./skills.ts";
import type { BundledSkill } from "./skills.ts";

export type CheckStatus = "PASS" | "WARN" | "FAIL" | "INFO";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

// Each seam defaults to the real one; tests pass a counting fetch and a fake update flow.
export interface UpdateCheckSeams {
  skipUpdate?: boolean;
  fetch?: typeof fetch;
  runUpdate?: typeof runUpdate;
}

type ScopeManifest = { manifest: Manifest | undefined } | { error: unknown };

export const MIN_NODE = [22, 0, 0] as const;
export const MIN_BUN = [1, 4, 4] as const;

function check(id: string, status: CheckStatus, message: string): DoctorCheck {
  return { id, status, message };
}

function atLeast(version: string, min: readonly number[]): boolean {
  const parts = version.replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (const [index, wanted] of min.entries()) {
    const part = parts[index] ?? 0;
    if (part !== wanted) return part > wanted;
  }
  return true;
}

// A binary carries its own runtime. The bundle and the sources need Node 22 or Bun 1.4.4, or later.
export function checkRuntime(ctx: Pick<CliContext, "build" | "version" | "runtimeName" | "runtimeVersion">): DoctorCheck {
  if (ctx.build === "binary") return check("runtime", "PASS", `omt ${ctx.version} binary`);
  const runtime = `${ctx.runtimeName} ${ctx.runtimeVersion}`;
  return atLeast(ctx.runtimeVersion, ctx.runtimeName === "bun" ? MIN_BUN : MIN_NODE)
    ? check("runtime", "PASS", runtime)
    : check("runtime", "FAIL", `${runtime} is too old; omt needs Node ${MIN_NODE[0]} or later, or Bun ${MIN_BUN.join(".")} or later`);
}

function checkConfig({ config, issues }: LoadedConfig): DoctorCheck {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const roles = plural(Object.keys(config.roles).length, "role");
  if (errors > 0) return check("config", "FAIL", `${plural(errors, "error")}, ${plural(warnings, "warning")}; run omt config validate`);
  if (warnings > 0) return check("config", "WARN", `${roles}, ${plural(warnings, "warning")}; run omt config validate`);
  return check("config", "PASS", roles);
}

// Doctor prints this check, and install prints its INFO message as a note after it applies.
export function checkDefaults({ defaults }: Pick<LoadedConfig, "defaults">): DoctorCheck {
  const changes = diffDefaults(defaults, DEFAULT_CONFIG, []);
  return changes.length === 0
    ? check("defaults", "PASS", "current defaults")
    : check("defaults", "INFO", `${changes.length} changes available; run omt doctor to review`);
}

export function checkHarnesses({ config }: Pick<LoadedConfig, "config">): DoctorCheck {
  const harnesses = config.harnesses;
  if (harnesses === undefined) return check("harnesses", "PASS", DEFAULT_HARNESSES.join(", "));
  const list = harnesses.join(", ");
  const effects = harnessEffects(harnesses, config.roles);
  if (effects.length > 0) return check("harnesses", "INFO", `${list} only; ${effects.join("; ")}`);
  return check("harnesses", "PASS", list);
}

// The command that runs this CLI again: the runner with the pinned version for a one-shot run, the
// binary itself, the bundle with the runtime that runs it now (node or bun), or the sources with bun.
function cliCommand(ctx: CliContext): string {
  const runner = oneShotRunner(ctx.cliPath, ctx.env);
  if (runner !== undefined) return runnerCommand(runner, ctx.version);
  if (ctx.build === "binary") return `"${ctx.cliPath}"`;
  return `${ctx.build === "bundle" ? ctx.runtimeName : "bun"} "${ctx.cliPath}"`;
}

// In project scope there may be no `omt` on PATH and the shim may be broken, so the hint names the running CLI.
function installHint(ctx: CliContext, paths: ScopePaths, flags = ""): string {
  if (paths.scope === "user") return `omt install${flags}`;
  return `${cliCommand(ctx)} install --project${flags}`;
}

async function checkSkills(ctx: CliContext, paths: ScopePaths, bundled: BundledSkill[], loaded: ScopeManifest): Promise<DoctorCheck> {
  const root = paths.agentsRoot;
  if (bundled.length === 0) {
    return check("skills", "FAIL", `the omt CLI has no bundled skills in ${join(ctx.packageRoot, "skills")}; reinstall omt`);
  }
  const groups: Record<string, string[]> = { missing: [], outdated: [], modified: [], unmanaged: [] };
  const selected = selectedSkills(bundled, optInOf(loaded));
  for (const skill of selected) {
    const result = await classifySkill(skill.dir, join(root, skill.name));
    if (result.action === "create") groups.missing?.push(skill.name);
    else if (result.action === "update") groups.outdated?.push(skill.name);
    else if (result.action === "conflict") {
      (result.reason === "locally modified" ? groups.modified : groups.unmanaged)?.push(skill.name);
    }
  }
  if ("manifest" in loaded) {
    const retired = await retiredSkills(root, loaded.manifest, bundled.map((skill) => skill.name));
    groups["no longer shipped"] = retired.filter((name) => !OPT_IN_SKILLS.includes(name));
    groups["opt-in, not selected"] = retired.filter((name) => OPT_IN_SKILLS.includes(name));
  }
  const problems = Object.entries(groups)
    .filter(([, names]) => names.length > 0)
    .map(([kind, names]) => `${kind}: ${names.join(", ")}`);
  if (problems.length > 0) return check("skills", "WARN", `${problems.join("; ")} in ${root}; run ${installHint(ctx, paths)}`);
  return check("skills", "PASS", `${plural(selected.length, "skill")} installed in ${root}`);
}

// The opt-in skills that the scope's manifest selects; none when it cannot be read.
function optInOf(loaded: ScopeManifest): string[] {
  return "manifest" in loaded ? (loaded.manifest?.optIn ?? []) : [];
}

async function checkLinks(ctx: CliContext, paths: ScopePaths, names: string[]): Promise<DoctorCheck> {
  const claude = paths.linkRoots.claude ?? "";
  const plan = await planLinks(paths.agentsRoot, [{ name: "claude", path: claude }], names);
  if (plan.skipped.length > 0) return check("links", "PASS", `${claude} is the agents skill root`);
  const missing: string[] = [];
  const broken: string[] = [];
  for (const link of plan.links) {
    if (link.action === "create") missing.push(link.name);
    else if (link.action === "conflict") broken.push(`${link.name} (${link.reason ?? "conflict"})`);
    else if (!(await isManagedDir(await resolveReal(link.canonical)))) broken.push(`${link.name} (target is missing)`);
  }
  if (broken.length > 0) return check("links", "FAIL", `broken or conflicting in ${claude}: ${broken.join(", ")}`);
  if (missing.length > 0) return check("links", "WARN", `missing in ${claude}: ${missing.join(", ")}; run ${installHint(ctx, paths)}`);
  return check("links", "PASS", `${plural(plan.links.length, "link")} in ${claude}`);
}

// The managed command is `"<runtime>" "<cli>" hook ...` or `"<binary>" hook ...` in user scope, and
// `"<shim>" hook ...` in project scope.
function commandPaths(command: string): string[] {
  const match = /^"([^"]*)"(?: "([^"]*)")?/.exec(command);
  if (match === null) return [];
  return [match[1] ?? "", ...(match[2] === undefined ? [] : [match[2]])];
}

async function checkHooks(ctx: CliContext, paths: ScopePaths, loaded: ScopeManifest): Promise<DoctorCheck> {
  const hint = installHint(ctx, paths, " --hooks");
  if ("error" in loaded) return check("hooks", "WARN", errorMessage(loaded.error));
  let settingsPaths = (loaded.manifest?.hooks ?? []).map((hook) => hook.settingsPath);
  const fromManifest = settingsPaths.length > 0;
  if (!fromManifest) settingsPaths = [paths.settingsPath];
  const commands: string[] = [];
  const absent: string[] = [];
  for (const path of settingsPaths) {
    let found: string[];
    try {
      found = findManagedCommands(parseSettings(await readFileIfExists(path), path));
    } catch (error) {
      return check("hooks", "WARN", errorMessage(error));
    }
    if (found.length === 0) absent.push(path);
    commands.push(...found);
  }
  if (commands.length === 0) {
    return fromManifest
      ? check("hooks", "WARN", `the installed hook is missing from ${absent.join(", ")}; run ${hint}`)
      : check("hooks", "INFO", `no hook installed; run ${hint} to start ultrawork on the phrase start ulw`);
  }
  const lost: string[] = [];
  for (const command of commands) {
    const paths = commandPaths(command);
    if (paths.length === 0) lost.push(command);
    for (const path of paths) if (!(await pathExists(path))) lost.push(path);
  }
  if (lost.length > 0) return check("hooks", "FAIL", `the hook command points at a missing path: ${lost.join(", ")}; run ${hint}`);
  if (absent.length > 0) return check("hooks", "WARN", `the installed hook is missing from ${absent.join(", ")}; run ${hint}`);
  return check("hooks", "PASS", `Claude UserPromptSubmit hook in ${settingsPaths.join(", ")}`);
}

async function checkShim(ctx: CliContext, paths: ScopePaths, loaded: ScopeManifest): Promise<DoctorCheck> {
  const root = paths.root ?? "";
  const hint = installHint(ctx, paths);
  if ("error" in loaded) return check("shim", "WARN", errorMessage(loaded.error));
  const shimPath = loaded.manifest?.project?.shim ?? projectShimPath(root);
  let text: string | undefined;
  try {
    text = await readFileIfExists(shimPath);
  } catch (error) {
    return check("shim", "WARN", errorMessage(error));
  }
  if (text === undefined) return check("shim", "WARN", `${shimPath} does not exist; run ${hint}`);
  if (!isManagedShim(text)) return check("shim", "WARN", `${shimPath} is not managed by omt`);
  const { runtime, runtimeFallback, cli, runner } = shimPaths(text);
  if (runner === undefined && (cli === undefined || !(await pathExists(cli)))) {
    return check("shim", "FAIL", `the shim points at a missing CLI path: ${cli ?? shimPath}; run ${hint}`);
  }
  if (!(await isExecutableFile(shimPath))) return check("shim", "FAIL", `${shimPath} is not executable; run ${hint}`);
  if (runner !== undefined) return check("shim", "PASS", `${shimPath} runs ${runner}`);
  if (runtime !== undefined && !(await pathExists(runtime))) {
    return check("shim", "WARN", `the shim's runtime ${runtime} is missing; it falls back to ${runtimeFallback ?? "node"} on PATH (run ${hint})`);
  }
  return check("shim", "PASS", shimPath);
}

async function checkExclude(ctx: CliContext, paths: ScopePaths, loaded: ScopeManifest): Promise<DoctorCheck> {
  const root = paths.root ?? "";
  const found = await findGitExclude(root);
  if (found.path === undefined) return check("exclude", "INFO", found.note ?? "no .git");
  if ("error" in loaded) return check("exclude", "WARN", errorMessage(loaded.error));
  const off = loaded.manifest?.project?.gitExcludeOff === true;
  let text: string | undefined;
  try {
    text = await readFileIfExists(found.path);
  } catch (error) {
    return check("exclude", "WARN", errorMessage(error));
  }
  const gone: string[] = [];
  for (const other of excludeBlockRoots(text)) if (other !== root && !(await pathExists(other))) gone.push(other);
  if (gone.length > 0) {
    return check(
      "exclude",
      "WARN",
      `${found.path} holds a block for ${gone.join(", ")}, which no longer exists; it hides those paths in every worktree (run ${installHint(ctx, paths)} or uninstall --project to remove it)`,
    );
  }
  const hasBlock = excludeBlockLines(text, root) !== undefined;
  if (!hasBlock && off) return check("exclude", "INFO", "git exclude off (--no-git-exclude); git sees the project install");
  if (!hasBlock) {
    return check("exclude", "WARN", `no omt block for ${root} in ${found.path}; git sees the project install (run ${installHint(ctx, paths)})`);
  }
  return check("exclude", "PASS", `omt block in ${found.path}`);
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkPath(ctx: CliContext): Promise<DoctorCheck> {
  const names = process.platform === "win32" ? ["omt.cmd", "omt.exe", "omt"] : ["omt"];
  for (const dir of (ctx.env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      const path = join(dir, name);
      if (await isExecutableFile(path)) return check("path", "PASS", `omt is on PATH at ${path}`);
    }
  }
  return check(
    "path",
    "WARN",
    `omt is not on PATH; skills use .omt/bin/omt from a project install (omt install --project), and they need the CLI; install omt with one of: ${INSTALL_CHANNELS.join(", ")}`,
  );
}

async function checkT3(ctx: CliContext): Promise<DoctorCheck> {
  const path = t3SettingsPath(ctx.env, ctx.homedir);
  return (await pathExists(path))
    ? check("t3", "PASS", path)
    : check("t3", "WARN", `${path} does not exist; is T3 Code installed? (set T3CODE_HOME for a custom location)`);
}

function expandHome(path: string, homedir: string): string {
  if (path === "~") return homedir;
  return path.startsWith("~/") ? join(homedir, path.slice(2)) : path;
}

function claudeHomePaths(settings: unknown): { id: string; homePath: string }[] {
  if (!isRecord(settings)) return [];
  const instances = settings.providerInstances;
  if (instances === null || typeof instances !== "object") return [];
  const found: { id: string; homePath: string }[] = [];
  for (const [id, value] of Object.entries(instances as Record<string, unknown>)) {
    if (!isRecord(value)) continue;
    const config = value.config;
    const homePath = isRecord(config) ? config.homePath : undefined;
    if (value.driver === "claudeAgent" && typeof homePath === "string" && homePath.trim() !== "") {
      found.push({ id, homePath: homePath.trim() });
    }
  }
  return found;
}

async function linkedInto(skillsDir: string, agentsRoot: string, name: string): Promise<boolean> {
  const path = join(skillsDir, name);
  const canonical = join(agentsRoot, name);
  if ((await classifyLink(path, canonical)).action === "unchanged") return isManagedDir(await resolveReal(canonical));
  try {
    return await isManagedDir(await realpath(path));
  } catch {
    return false;
  }
}

async function checkHomes(ctx: CliContext, names: string[]): Promise<DoctorCheck> {
  const path = t3SettingsPath(ctx.env, ctx.homedir);
  let text: string | undefined;
  try {
    text = await readFileIfExists(path);
  } catch (error) {
    return check("homes", "WARN", `cannot read ${path}: ${errorMessage(error)}`);
  }
  if (text === undefined) return check("homes", "INFO", "no T3 settings file; no instance sets a homePath");
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return check("homes", "WARN", `${path} is not valid JSON; cannot read providerInstances`);
  }
  const homes = claudeHomePaths(settings);
  if (homes.length === 0) return check("homes", "INFO", "no claudeAgent instance sets a homePath");
  const agentsRoot = skillRoots(ctx.env, ctx.homedir).agents;
  const lacking: string[] = [];
  for (const home of homes) {
    const skillsDir = join(expandHome(home.homePath, ctx.homedir), "skills");
    const missing: string[] = [];
    for (const name of names) if (!(await linkedInto(skillsDir, agentsRoot, name))) missing.push(name);
    if (missing.length > 0) lacking.push(`${home.id} (${skillsDir}) lacks ${missing.join(", ")}`);
  }
  if (lacking.length > 0) {
    return check(
      "homes",
      "WARN",
      `${lacking.join("; ")}; run CLAUDE_CONFIG_DIR=<homePath> omt install --targets agents,claude`,
    );
  }
  return check("homes", "PASS", `${plural(homes.length, "claudeAgent instance")} with a homePath have the skills`);
}

function checkRoles(report: ReturnType<typeof resolveAll>): DoctorCheck {
  const resolutions = Object.values(report.roles);
  const unavailable = resolutions.filter((r) => r.status === "unavailable").map((r) => r.role);
  if (unavailable.length > 0) {
    const status = unavailable.includes("execute") ? "FAIL" : "WARN";
    return check("roles", status, `unavailable: ${unavailable.join(", ")}; run omt roles --capabilities <file>`);
  }
  return check("roles", "PASS", `${plural(resolutions.length, "role")} resolve against orchestrator_capabilities`);
}

export function checkUpdate(daily: DailyResult): DoctorCheck {
  if (daily.error !== undefined) return check("update", "INFO", `the update check failed: ${daily.error}`);
  if (daily.outdated) return check("update", "INFO", `omt ${daily.latest} is out; run omt update`);
  return check("update", "PASS", `omt ${daily.current} is the latest (checked ${daily.checkedAt.slice(0, 10)})`);
}

export function updateNote(daily: DailyResult | undefined): string | undefined {
  return daily?.outdated === true ? `note: omt ${daily.latest} is out; run omt update\n` : undefined;
}

// With `update: "apply"`, runs the update flow once per version, after the command's own output.
// Returns true only after a successful update; otherwise the caller prints the note. The command keeps its exit code.
export async function autoUpdate(
  ctx: CliContext,
  daily: DailyResult | undefined,
  opts: { project: boolean; json: boolean },
  seams: UpdateCheckSeams = {},
): Promise<boolean> {
  const latest = daily?.latest;
  if (daily === undefined || !daily.outdated || latest === undefined) return false;
  if (daily.mode !== "apply" || !ctx.isTTY || daily.applyAttempted) return false;
  // With --json, stdout holds only the command's report, so the flow writes everything to stderr.
  const flowCtx: CliContext = opts.json ? { ...ctx, stdout: ctx.stderr } : ctx;
  const update = seams.runUpdate ?? runUpdate;
  try {
    await recordApplyAttempt(ctx, latest);
    const code = await update(
      flowCtx,
      { check: false, dryRun: false, yes: true, skillsOnly: false, project: opts.project, json: opts.json },
      { latest, ...(seams.fetch === undefined ? {} : { fetch: seams.fetch }) },
    );
    if (code === 0) return true;
    ctx.stderr(`warning: the automatic update failed: omt update exited ${code}\n`);
  } catch (error) {
    ctx.stderr(`warning: the automatic update failed: ${errorMessage(error)}\n`);
  }
  return false;
}

export interface DoctorRun {
  report: DoctorReport;
  daily: DailyResult | undefined;
}

export async function runDoctor(
  ctx: CliContext,
  caps?: Capabilities,
  scope: InstallScope = "user",
  seams: UpdateCheckSeams = {},
): Promise<DoctorRun> {
  const paths = await scopePaths(ctx, scope);
  const loadedConfig = await loadConfig(ctx);
  const bundled = await listBundledSkills(ctx.packageRoot);
  const daily = seams.skipUpdate === true ? undefined : await dailyCheck(ctx, { mode: loadedConfig.config.update, ...(seams.fetch === undefined ? {} : { fetch: seams.fetch }) });
  const checks = [
    checkRuntime(ctx),
    checkConfig(loadedConfig),
    checkDefaults(loadedConfig),
    ...(daily === undefined ? [] : [checkUpdate(daily)]),
    checkHarnesses(loadedConfig),
  ];
  let loaded: ScopeManifest;
  try {
    loaded = { manifest: (await loadScopeManifest(paths)).manifest };
  } catch (error) {
    loaded = { error };
  }
  const names = selectedSkills(bundled, optInOf(loaded)).map((skill) => skill.name);
  checks.push(await checkSkills(ctx, paths, bundled, loaded), await checkLinks(ctx, paths, names));
  checks.push(await checkHooks(ctx, paths, loaded));
  if (scope === "project") {
    checks.push(
      await checkShim(ctx, paths, loaded),
      await checkExclude(ctx, paths, loaded),
      await checkT3(ctx),
      await worktreeSummary(ctx),
    );
  } else {
    checks.push(await checkPath(ctx), await checkT3(ctx), await checkHomes(ctx, names));
  }
  if (caps !== undefined) {
    checks.push(checkRoles(resolveAll(loadedConfig.config, caps, undefined, loadedConfig.config.harnesses)));
  }
  return { report: { ok: !checks.some((c) => c.status === "FAIL"), checks }, daily };
}

export function formatDoctor(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.id.length));
  return report.checks.map((c) => `${c.status}  ${c.id.padEnd(width)}  ${c.message}\n`).join("");
}
