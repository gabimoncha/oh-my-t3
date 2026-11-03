import type { CliContext } from "../types.ts";
import { applyAndReport, migrationHasWork, planMigration, renderMigrationPlan } from "./migrate.ts";

export interface OfferOptions {
  check: boolean;
  dryRun: boolean;
  yes: boolean;
  skillsOnly: boolean;
  json: boolean;
}

// After omt update: on a terminal without --yes, show the migration and ask once; else print one hint line.
// The skills-only run is the child of another update, which makes the offer itself.
export async function offerMigration(ctx: CliContext, options: OfferOptions): Promise<number> {
  if (options.skillsOnly) return 0;
  const targets = await planMigration(ctx);
  const moving = targets.filter((target) => target.action !== "skip");
  if (moving.length === 0) return 0;
  if (options.check || options.dryRun || options.yes || options.json || !ctx.isTTY) {
    const names = moving.map((target) => target.legacy);
    const shown = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
    ctx.stderr(`hint: old omt folders remain (${shown}); run "omt migrate" to move them\n`);
    return 0;
  }
  ctx.stdout(`Old omt folders:\n${renderMigrationPlan(targets)}`);
  if (!migrationHasWork(targets)) return 0;
  const answer = (await ctx.prompt("Move them now? [y/N] ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    ctx.stdout('Nothing was moved. Run "omt migrate" when you are ready.\n');
    return 0;
  }
  return applyAndReport(ctx, targets);
}
