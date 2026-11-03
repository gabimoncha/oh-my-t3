import { legacyFolders } from "../paths.ts";
import type { LegacyUse } from "../paths.ts";
import type { CliContext } from "../types.ts";

function phrase(use: LegacyUse): string {
  return use.both ? `the old folder ${use.legacy} sits beside ${use.current}` : `omt reads the old folder ${use.legacy}`;
}

// One line that names each legacy folder omt reads or that sits beside its current folder, or undefined.
export function legacyHint(ctx: Pick<CliContext, "cwd" | "env" | "homedir">): string | undefined {
  const found = legacyFolders(ctx.cwd, ctx.env, ctx.homedir);
  const uses = [found.project, found.global].filter((use): use is LegacyUse => use !== undefined);
  if (uses.length === 0) return undefined;
  return `hint: ${uses.map(phrase).join("; ")}; run "omt migrate" to move ${uses.length === 1 ? "it" : "them"}\n`;
}
