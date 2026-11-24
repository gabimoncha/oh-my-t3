import { loadConfig } from "../config/load.ts";
import { PROVIDER_PATTERN } from "../config/validate.ts";
import { findProjectRoot, planPath } from "../paths.ts";
import { parsePlan } from "../plan/parse.ts";
import { effectiveConfig } from "../profile/resolve.ts";
import type { EffectiveConfigOptions } from "../profile/resolve.ts";
import { parseCapabilities } from "../routing/capabilities.ts";
import { configuredDrivers } from "../routing/family.ts";
import type { ResolveOptions } from "../routing/resolve.ts";
import type { Capabilities, CliContext, ConfigIssue, OmtConfig } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { readFileIfExists } from "../util/fs.ts";
import { checkPlanSlug, checkUnitId } from "../util/ids.ts";

export function formatIssue(issue: ConfigIssue): string {
  const where = issue.path === "" ? issue.source : `${issue.source} ${issue.path}`;
  return `${issue.severity} ${where}: ${issue.message}\n`;
}

export async function loadConfigReporting(ctx: CliContext) {
  const loaded = await loadConfig(ctx);
  for (const issue of loaded.issues) ctx.stderr(formatIssue(issue));
  return loaded;
}

export async function loadEffectiveConfigReporting(
  ctx: CliContext,
  options: EffectiveConfigOptions & { plan?: string | undefined; allowMissingPlan?: boolean } = {},
) {
  let planProfile = options.planProfile;
  if (options.plan !== undefined) {
    checkPlanSlug(options.plan, "--plan");
    const path = planPath(findProjectRoot(ctx.cwd), options.plan);
    const markdown = await readFileIfExists(path);
    if (markdown === undefined && !options.allowMissingPlan) {
      throw new OmtError("plan_not_found", `plan "${options.plan}" not found at ${path}`);
    }
    planProfile = markdown === undefined ? undefined : parsePlan(markdown).profile;
  }
  const loaded = await loadConfigReporting(ctx);
  const effective = effectiveConfig(loaded, { profile: options.profile, planProfile });
  for (const issue of effective.issues.slice(loaded.issues.length)) ctx.stderr(formatIssue(issue));
  return effective;
}

const AGAINST_RE = new RegExp(PROVIDER_PATTERN);

// Reads a text input flag: "-" means stdin.
export async function readInput(ctx: CliContext, flag: string, file: string): Promise<string> {
  if (file === "-") return ctx.readStdin();
  const text = await readFileIfExists(file);
  if (text === undefined) throw new OmtError("file_not_found", `--${flag}: file not found: ${file}`);
  return text;
}

export async function readCapabilities(ctx: CliContext, file: string | undefined): Promise<Capabilities | undefined> {
  if (file === undefined) return undefined;
  return parseCapabilities(await readInput(ctx, "capabilities", file));
}

export interface AgainstFlags {
  against?: string | undefined;
  plan?: string | undefined;
  unit?: string | undefined;
}

// Usage checks for --against; run them before any work.
export function checkAgainst(flags: AgainstFlags): void {
  if (flags.plan !== undefined) checkPlanSlug(flags.plan, "--plan");
  if (flags.unit !== undefined) checkUnitId(flags.unit);
  if (flags.against === undefined) return;
  if (flags.against === "auto") {
    throw usageError("--against auto is no longer supported", "pass the provider instance id or driver kind of the worker");
  }
  if (!AGAINST_RE.test(flags.against)) {
    throw usageError(`invalid --against "${flags.against}"`, "name a provider instance id or a driver kind");
  }
}

export function againstOptions(config: OmtConfig, against: string | undefined): ResolveOptions {
  return against === undefined ? {} : { against, drivers: configuredDrivers(config.roles) };
}

