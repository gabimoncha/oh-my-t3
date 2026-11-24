import type { CliContext } from "../types.ts";

// Returns true when the plan may be applied. Prints the reason when it may not. An empty answer gives `defaultYes`.
export async function confirmApply(
  ctx: CliContext,
  yes: boolean,
  ask: { question: string; defaultYes: boolean } = { question: "Apply this plan? [y/N] ", defaultYes: false },
): Promise<boolean> {
  if (yes) return true;
  if (!ctx.isTTY) {
    ctx.stderr("Re-run with --yes to apply.\n");
    return false;
  }
  const answer = (await ctx.prompt(ask.question)).trim().toLowerCase();
  if (answer === "y" || answer === "yes" || (answer === "" && ask.defaultYes)) return true;
  ctx.stdout("Nothing was changed.\n");
  return false;
}
