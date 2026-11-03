import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { detectHarnesses } from "../../install/harness.ts";
import { EFFORT_LADDER } from "../../types.ts";
import type { Capabilities, CliContext, OmtConfig, OptionDescriptor } from "../../types.ts";
import { errorCode, readFileIfExists } from "../../util/fs.ts";
import { DEFAULT_CONFIG } from "../defaults.ts";

export interface CatalogModel {
  id: string;
  label?: string;
  efforts: string[]; // the effort values that the model accepts, on the omt ladder
  fast: boolean | null; // null when omt cannot know
}

export interface CatalogProvider {
  id: string; // the provider instance id, or the driver kind when the catalog is local
  driver: string;
  label: string;
  available: boolean;
  reason: string;
  models: CatalogModel[];
}

// The providers and models that the role editor offers. "t3" comes from orchestrator_capabilities, "local" from the
// T3 settings file, PATH, and the models that the config files and the defaults already name.
export interface Catalog {
  source: "t3" | "local";
  providers: CatalogProvider[];
}

const EFFORT_OPTION_IDS = ["effort", "reasoningEffort", "reasoning_effort", "reasoning", "variant", "thinking"];
const DRIVER_LABELS: Readonly<Record<string, string>> = { claudeAgent: "Claude Code", codex: "Codex" };

function effortsOf(descriptors: OptionDescriptor[]): string[] {
  for (const optionId of EFFORT_OPTION_IDS) {
    const descriptor = descriptors.find((d) => d.id === optionId && d.type === "select");
    const ids = (descriptor?.options ?? []).map((choice) => choice.id).filter((id) => (EFFORT_LADDER as readonly string[]).includes(id));
    if (ids.length > 0) return ids;
  }
  return [];
}

function fastOf(descriptors: OptionDescriptor[]): boolean {
  return descriptors.some((d) =>
    (d.id === "serviceTier" && d.type === "select" && (d.options ?? []).some((choice) => choice.id === "priority")) ||
    (d.id === "fastMode" && d.type === "boolean"));
}

function fromCapabilities(caps: Capabilities): Catalog {
  return {
    source: "t3",
    providers: caps.providers.map((provider) => ({
      id: provider.providerInstanceId,
      driver: provider.driverKind,
      label: provider.displayName ?? provider.providerInstanceId,
      available: provider.canRunChildTask,
      reason: provider.canRunChildTask ? "T3 can run child tasks here" : provider.constraints.join("; ") || "T3 cannot run child tasks here",
      models: provider.models.map((model) => ({
        id: model.id,
        ...(model.label === undefined ? {} : { label: model.label }),
        efforts: effortsOf(model.options),
        fast: fastOf(model.options),
      })),
    })),
  };
}

// The models that a config names, by driver.
function namedModels(configs: OmtConfig[]): Map<string, Set<string>> {
  const byDriver = new Map<string, Set<string>>();
  const add = (driver: string | undefined, model: string | undefined) => {
    if (driver === undefined || model === undefined || model === "") return;
    if (!byDriver.has(driver)) byDriver.set(driver, new Set());
    byDriver.get(driver)?.add(model);
  };
  for (const config of configs) {
    const roleSets = [config.roles, ...Object.values(config.profiles ?? {}).map((profile) => profile.roles ?? {})];
    for (const roles of roleSets) {
      for (const role of Object.values(roles ?? {})) {
        for (const entry of role?.chain ?? []) add(entry.driver ?? entry.provider, entry.model);
      }
    }
  }
  return byDriver;
}

export async function editorCatalog(ctx: CliContext, config: OmtConfig, caps: Capabilities | undefined): Promise<Catalog> {
  if (caps !== undefined) return fromCapabilities(caps);
  const report = await detectHarnesses({ env: ctx.env, homedir: ctx.homedir });
  const models = namedModels([DEFAULT_CONFIG, config]);
  return {
    source: "local",
    providers: report.harnesses.map((harness) => ({
      id: harness.driver,
      driver: harness.driver,
      label: DRIVER_LABELS[harness.driver] ?? harness.driver,
      available: harness.detected,
      reason: harness.reason,
      models: [...(models.get(harness.driver) ?? [])].sort().map((id) => ({ id, efforts: [...EFFORT_LADDER], fast: null })),
    })),
  };
}

export interface SkillText {
  name: string;
  text: string;
}

const SKILL_NAME = /^[a-z][a-z0-9-]{0,63}$/;

// The SKILL.md of one bundled skill, read from the omt package. undefined when the skill does not exist.
export async function bundledSkillText(packageRoot: string, name: string): Promise<SkillText | undefined> {
  if (!SKILL_NAME.test(name)) return undefined;
  const text = await readFileIfExists(join(packageRoot, "skills", name, "SKILL.md"));
  return text === undefined ? undefined : { name, text };
}

export async function bundledSkillNames(packageRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(join(packageRoot, "skills"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && SKILL_NAME.test(entry.name)).map((entry) => entry.name).sort();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}
