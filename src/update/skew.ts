import { findProjectRoot, manifestPath, projectManifestPath } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { readFileIfExists } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";

async function manifestVersion(path: string): Promise<string | undefined | null> {
  let text: string | undefined;
  try {
    text = await readFileIfExists(path);
  } catch {
    return null;
  }
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && typeof value.version === "string" ? value.version : null;
  } catch {
    return null;
  }
}

// The skills call CLI flags of the release that installed them, so a CLI of another release can reject them.
// A project install pins its own release, so it wins over the user install.
// A source run is a contributor's clone, which differs from the installed release on purpose.
export async function versionSkewHint(ctx: Pick<CliContext, "build" | "cwd" | "env" | "homedir" | "version">): Promise<string | undefined> {
  if (ctx.build === "source") return undefined;
  const project = await manifestVersion(projectManifestPath(findProjectRoot(ctx.cwd)));
  if (project === null) return undefined;
  const scope = project === undefined ? "user" : "project";
  const installed = project ?? (await manifestVersion(manifestPath(ctx.env, ctx.homedir)));
  if (installed === undefined || installed === null || installed === ctx.version) return undefined;
  const command = scope === "project" ? "omt update --skills-only --project" : "omt update --skills-only";
  return `hint: the ${scope} skills come from omt ${installed}, and this omt is ${ctx.version}; run "${command}" to sync them\n`;
}
