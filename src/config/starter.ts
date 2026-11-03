import { setTopLevelValue } from "./jsonc.ts";

export const SCHEMA_URL = "https://raw.githubusercontent.com/gabimoncha/oh-my-t3/main/schema/omt.schema.json";

export const USER_STARTER_CONFIG = `// oh-my-t3 user config. It applies to every project.
// A project config in .omt/config.jsonc overrides it.
// Run \`omt config show --defaults\` to see the built-in roles and limits.
{
  "$schema": "${SCHEMA_URL}",
  "version": 1,
  // "profile": "prototype",
  // Example: a profile that builds like prototype, with failure proofs and fast implementation.
  // Run \`omt profile show <name>\` to see the workflow, roles, and limits that a profile resolves to.
  // "profiles": {
  //   "fast-proto": {
  //     "description": "Prototype with failure proofs and fast execute.",
  //     "extends": "prototype",
  //     "workflow": { "build": { "failureProofs": "on" } },
  //     "roles": { "execute": { "fast": true } },
  //   },
  // },
  "roles": {
    // Example: run reviews on Codex first, then fall back to Claude.
    // "review": {
    //   "chain": [
    //     { "driver": "codex", "model": "gpt-6-astra", "effort": "high" },
    //     { "driver": "claudeAgent", "model": "claude-opus-5-5", "effort": "high" },
    //   ],
    // },
  },
  "limits": {
    // "maxParallel": 6,
  },
  // Check for a new omt once a day in omt install and omt doctor (asks the npm registry).
  // "update": "check",
}
`;

export const PROJECT_STARTER_CONFIG = `// oh-my-t3 project config. It overrides the user config for this project.
// Run \`omt config show --defaults\` to see the built-in roles and limits,
// and \`omt profile show\` to see the effective config.
{
  "$schema": "${SCHEMA_URL}",
  "version": 1,
  // "profile": "prototype",
  // Example: a profile that builds like prototype, with failure proofs and fast implementation.
  // Run \`omt profile show <name>\` to see the workflow, roles, and limits that a profile resolves to.
  // "profiles": {
  //   "fast-proto": {
  //     "description": "Prototype with failure proofs and fast execute.",
  //     "extends": "prototype",
  //     "workflow": { "build": { "failureProofs": "on" } },
  //     "roles": { "execute": { "fast": true } },
  //   },
  // },
  "roles": {
    // Example: use a stronger model for implementation work in this project.
    // "execute": {
    //   "chain": [
    //     { "driver": "claudeAgent", "model": "claude-opus-5-5", "effort": "high" },
    //   ],
    // },
  },
  "limits": {
    // "maxParallel": 2,
  },
}
`;

// The starter used by omt install.
export function starterConfig(scope: "user" | "project", harnesses?: string[]): string {
  const starter = scope === "project" ? PROJECT_STARTER_CONFIG : USER_STARTER_CONFIG;
  return harnesses === undefined ? starter : setTopLevelValue(starter, "harnesses", harnesses);
}
