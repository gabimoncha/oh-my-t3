import { DEFAULT_CONFIG } from "../config/defaults.ts";
import { mergeLayer } from "../config/merge.ts";
import { PROFILE_CHAIN_MAX, RETIRED_PROFILE_FALLBACK, retiredProfileIssue } from "../config/validate.ts";
import type { ConfigIssue, LoadedConfig, OmtConfig, ProfileConfig, Workflow } from "../types.ts";
import { OmtError, usageError } from "../util/errors.ts";

export type ProfileSource = "argument" | "plan" | "config" | "default";

export interface ResolvedProfile {
  name: string;
  source: ProfileSource;
  workflow: Workflow;
  limits: OmtConfig["limits"];
  roles: OmtConfig["roles"];
  models: OmtConfig["models"];
  issues: ConfigIssue[];
}

export interface EffectiveConfigOptions {
  profile?: string | undefined;
  planProfile?: string | undefined;
}

function profileChain(config: OmtConfig, name: string): { name: string; profile: ProfileConfig }[] {
  const chain: { name: string; profile: ProfileConfig }[] = [];
  let current: string | undefined = name;
  while (current !== undefined) {
    const names = [...chain.map((entry) => entry.name), current];
    const text = names.join(" -> ");
    if (chain.some((entry) => entry.name === current)) {
      throw new OmtError("profile_cycle", `profile cycle: ${text}`);
    }
    const profile: ProfileConfig | undefined = Object.hasOwn(config.profiles, current) ? config.profiles[current] : undefined;
    if (profile === undefined) {
      throw usageError(`unknown profile "${current}" in chain: ${text}`, `known profiles: ${Object.keys(config.profiles).join(", ")}`);
    }
    if (names.length > PROFILE_CHAIN_MAX) {
      throw new OmtError("profile_depth", `profile chain exceeds ${PROFILE_CHAIN_MAX} profiles: ${text}`);
    }
    chain.push({ name: current, profile });
    current = profile.extends ?? (current === "normal" ? undefined : "normal");
  }
  return chain.reverse();
}

export interface ProfileStep {
  name: string;
  config: OmtConfig;
  issues: ConfigIssue[];
}

// The config before the first chain step: the workflow sits in a temporary profile, so that
// mergeLayer also merges its groups and keys.
export function profileBase(config: OmtConfig): OmtConfig {
  return { ...config, profiles: { normal: structuredClone(config.profiles.normal!) } };
}

function chainSteps(config: OmtConfig, chain: { name: string; profile: ProfileConfig }[]): ProfileStep[] {
  let applied = profileBase(config);
  const steps: ProfileStep[] = [];
  for (const entry of chain) {
    const { roles, limits, models, workflow } = entry.profile;
    const merged = mergeLayer(applied, {
      roles,
      limits,
      models,
      ...(workflow === undefined ? {} : { profiles: { normal: { workflow } } }),
    }, `profile "${entry.name}"`);
    applied = merged.config;
    steps.push({ name: entry.name, config: applied, issues: merged.issues });
  }
  return steps;
}

// The config after each step of the profile's chain, from normal to the named profile.
export function profileSteps(config: OmtConfig, name: string): ProfileStep[] {
  return chainSteps(config, profileChain(config, name));
}

export function resolveProfile(config: OmtConfig, name: string): ResolvedProfile {
  const steps = profileSteps(config, name);
  const applied = steps.at(-1)?.config ?? profileBase(config);
  return {
    name,
    source: "argument",
    workflow: applied.profiles.normal!.workflow as Workflow,
    limits: applied.limits,
    roles: applied.roles,
    models: applied.models,
    issues: steps.flatMap((step) => step.issues),
  };
}

// Resolves each named profile and returns the issues of the fields that it declares, so that
// a child profile does not repeat an issue that it inherits. Skips a profile whose chain fails.
export function profileIssues(
  config: OmtConfig,
  profileSources: ReadonlyMap<string, string>,
  names: Iterable<string> = Object.keys(config.profiles),
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const name of names) {
    let chain: { name: string; profile: ProfileConfig }[];
    try {
      chain = profileChain(config, name);
    } catch (error) {
      if (error instanceof OmtError) continue;
      throw error;
    }
    for (const step of chainSteps(config, chain)) {
      if (step.name !== name) continue;
      for (const issue of step.issues) {
        issues.push({ ...issue, source: profileSources.get(name) ?? "defaults", path: `profiles.${name}.${issue.path}` });
      }
    }
  }
  return issues;
}

// The returned issues are the loaded issues, plus a warning when the argument or the plan selects a
// retired profile.
export function effectiveConfig(loaded: LoadedConfig, options: EffectiveConfigOptions = {}): LoadedConfig & { profile: ResolvedProfile } {
  const requested = options.profile ?? options.planProfile ?? loaded.config.profile;
  const retired = retiredProfileIssue(requested, options.profile !== undefined ? "--profile" : "plan header", "");
  const name = retired === undefined ? requested : RETIRED_PROFILE_FALLBACK;
  const profile = resolveProfile(loaded.config, name);
  profile.source = options.profile !== undefined ? "argument"
    : options.planProfile !== undefined ? "plan"
    : loaded.config.profile !== DEFAULT_CONFIG.profile ? "config" : "default";
  return {
    ...loaded,
    config: { ...loaded.config, profile: name, limits: profile.limits, roles: profile.roles, models: profile.models },
    profile,
    issues: retired === undefined ? loaded.issues : [...loaded.issues, retired],
  };
}
