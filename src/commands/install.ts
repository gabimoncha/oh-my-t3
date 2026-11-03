import { loadConfig } from "../config/load.ts";
import { applyInstall } from "../install/apply.ts";
import { confirmApply } from "../install/confirm.ts";
import { autoUpdate, checkDefaults, updateNote } from "../install/doctor.ts";
import type { UpdateCheckSeams } from "../install/doctor.ts";
import { buildInstallPlan, installConflicts, installHasChanges, parseTargets, renderInstallPlan } from "../install/plan.ts";
import { shimPaths } from "../install/project.ts";
import { addProject, projectsWarning } from "../install/projects.ts";
import { projectsPath } from "../paths.ts";
import type { CliContext } from "../types.ts";
import { dailyCheck } from "../update/check.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { plural } from "../util/output.ts";
import { worktreeSummary } from "../worktree/check.ts";
import { readCapabilities } from "./shared.ts";

export const summary = "Install the omt skills, links, starter config, and optional Claude hook.";

export const usage = `Usage: omt install [--project [--no-git-exclude]] [--targets <list>] [--with <skill>]... [--hooks] [--capabilities <file>] [--yes] [--dry-run] [--force]

Install the bundled skills into ~/.agents/skills and link them into the
selected agent skill roots. Shows the plan first, then asks to apply it.
With --project, install into the current project instead: skills in
.agents/skills, links in .claude/skills, the CLI shim .omt/bin/omt, and the
hook in .claude/settings.local.json, all hidden from git. When omt runs
from npx, pnpm dlx, or bunx, a user install is refused. Use --project, and
the shim calls that runner. --project also prints the T3 worktree setup
state of the current checkout (omt worktree check).

An opt-in skill (omt-swarm) installs only with --with. The install records
the choice, so later installs and omt update keep it. An unedited opt-in
skill that the scope did not select is removed.

Options:
  --project         install into the project root, not the home directory
  --no-git-exclude  with --project, write no block to the repository's
                    info/exclude, and remove an earlier one
  --targets <list>  comma-separated subset of agents, claude, gemini
                    (default: agents,claude, plus gemini when ~/.gemini exists;
                    agents is always included; gemini is not available
                    with --project)
  --with <skill>    also install this opt-in skill (omt-swarm); repeat the
                    flag for more skills
  --hooks           also add the Claude Code UserPromptSubmit ultrawork hook
  --capabilities <file>
                    orchestrator_capabilities output (- for stdin) for the
                    harness detection; without it, omt reads the T3
                    settings and PATH
  --yes             apply the plan without asking
  --dry-run         print the plan and write nothing
  --force           back up conflicting paths, then install over them
  -h, --help        print this help
`;

// Runs after the summary or "Everything is up to date.", never after a refusal, a conflict, or --dry-run.
async function updateCheck(ctx: CliContext, project: boolean, seams: UpdateCheckSeams): Promise<void> {
  const { config } = await loadConfig(ctx);
  const daily = await dailyCheck(ctx, { mode: config.update, ...(seams.fetch === undefined ? {} : { fetch: seams.fetch }) });
  if (await autoUpdate(ctx, daily, { project, json: false }, seams)) return;
  const note = updateNote(daily);
  if (note !== undefined) ctx.stdout(note);
}

export async function run(ctx: CliContext, seams: UpdateCheckSeams = {}): Promise<number> {
  const { values } = parseArgs(ctx.argv, {
    targets: { type: "string" },
    hooks: { type: "boolean" },
    yes: { type: "boolean" },
    "dry-run": { type: "boolean" },
    force: { type: "boolean" },
    project: { type: "boolean" },
    "no-git-exclude": { type: "boolean" },
    capabilities: { type: "string" },
    with: { type: "string", multiple: true },
  }, { maxPositionals: 0 });
  const scope = values.project === true ? "project" : "user";
  if (values["no-git-exclude"] === true && scope !== "project") throw usageError("--no-git-exclude needs --project");
  const targets = await parseTargets(values.targets, ctx.homedir, scope);
  const plan = await buildInstallPlan(ctx, {
    targets,
    hooks: values.hooks === true,
    force: values.force === true,
    scope,
    gitExclude: values["no-git-exclude"] !== true,
    capabilities: await readCapabilities(ctx, values.capabilities),
    with: values.with ?? [],
  });

  ctx.stdout(renderInstallPlan(plan));
  if (scope === "project") {
    const worktree = await worktreeSummary(ctx);
    ctx.stdout(`Worktree setup: ${worktree.status} ${worktree.message}\n`);
  }
  const conflicts = installConflicts(plan);
  if (conflicts > 0) {
    ctx.stderr(
      `${plural(conflicts, "conflict")}: these paths exist and omt does not manage them, or they were edited.\n` +
        "hint: re-run with --force to back them up and replace them\n",
    );
    return 1;
  }
  if (values["dry-run"] === true) {
    ctx.stdout("Dry run: nothing was written.\n");
    return 0;
  }
  const changes = installHasChanges(plan);
  if (changes && !(await confirmApply(ctx, values.yes === true))) return 1;

  const result = await applyInstall(plan, ctx.now());
  if (plan.project !== undefined) {
    await addProject(projectsPath(ctx.env, ctx.homedir), plan.project.root, ctx.now()).catch((error: unknown) => {
      ctx.stderr(projectsWarning(error));
    });
  }
  if (!changes) {
    ctx.stdout("Everything is up to date.\n");
    await updateCheck(ctx, scope === "project", seams);
    return 0;
  }
  ctx.stdout(`Applied ${plural(result.changed.length, "change")}.\n`);
  for (const backup of result.backups) ctx.stdout(`backup   ${backup}\n`);
  if (plan.project?.excludeNote !== undefined && plan.project.excludeNote !== "--no-git-exclude") {
    ctx.stdout(`note: ${plan.project.excludeNote}\n`);
  }
  const runner = plan.project === undefined ? undefined : shimPaths(plan.project.shim.after).runner;
  if (runner !== undefined) ctx.stdout(`note: .omt/bin/omt runs ${runner}, which needs the network again after its cache is cleared\n`);
  const defaults = checkDefaults(await loadConfig(ctx));
  if (defaults.status === "INFO") ctx.stdout(`note: defaults ${defaults.message}\n`);
  ctx.stdout(
    plan.project === undefined
      ? "Next steps:\n" +
          "  1. Restart agent sessions in T3 Code so they load the new skills.\n" +
          "  2. Try $omt-ulw <task>.\n"
      : "Next steps:\n" +
          "  1. Restart agent sessions in T3 Code for this project so they load the new skills.\n" +
          "  2. Agents in this project call the CLI as .omt/bin/omt.\n" +
          "  3. Try $omt-ulw <task>.\n",
  );
  await updateCheck(ctx, scope === "project", seams);
  return 0;
}
