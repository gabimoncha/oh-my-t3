import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCapabilities } from "../../src/routing/capabilities.ts";
import type { Capabilities, RoleConfig, Candidate } from "../../src/types.ts";
import { PACKAGE_ROOT } from "../helpers.ts";

export const CAPS_FILE = join(PACKAGE_ROOT, "test", "fixtures", "capabilities.json");
export const CAPS_TEXT = readFileSync(CAPS_FILE, "utf8");
export const LIVE_CAPS_FILE = join(PACKAGE_ROOT, "test", "fixtures", "capabilities-live.json");

export function liveCaps(overrides: Partial<Capabilities> = {}): Capabilities {
  return { ...parseCapabilities(readFileSync(LIVE_CAPS_FILE, "utf8")), ...overrides };
}

export function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return { ...parseCapabilities(CAPS_TEXT), ...overrides };
}

export function role(chain: Candidate[], overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    description: "Test role.",
    access: "read-only",
    result: "review",
    t3Role: "review",
    interactionMode: "plan",
    runtimeMode: "inherit",
    chain,
    ...overrides,
  };
}
