import { evidenceDir, findProjectRoot, grillsDir, omtDir, plansDir, projectConfigPath, projectShimPath } from "../paths.ts";
import type { CommandRun } from "../types.ts";
import { parseArgs } from "../util/args.ts";
import { usageError } from "../util/errors.ts";
import { formatJson } from "../util/output.ts";

export const summary = "Print the absolute paths of the project's state folder.";

export const usage = `Usage: omt paths [--json] [--root|--omt|--plans|--grills|--evidence|--config|--shim]

Print the project root, the state folder, plans, grills, evidence, project
config, and shim paths, one "name: path" line each. From a linked git
worktree, the paths are in the main checkout. The state folder is .omt3, or
.omt in a project from an earlier release.

Options:
  --json      print an object with the keys root, omt, plans, grills,
              evidence, config, and shim
  --root      print only the project root
  --omt       print only the state folder
  --plans     print only the plans directory
  --grills    print only the grills directory
  --evidence  print only the evidence directory
  --config    print only the project config file
  --shim      print only the project shim
  -h, --help  print this help
`;

const SINGLE = ["root", "omt", "plans", "grills", "evidence", "config", "shim"] as const;

export const run: CommandRun = async (ctx) => {
  const { values } = parseArgs(ctx.argv, {
    json: { type: "boolean" },
    root: { type: "boolean" },
    omt: { type: "boolean" },
    plans: { type: "boolean" },
    grills: { type: "boolean" },
    evidence: { type: "boolean" },
    config: { type: "boolean" },
    shim: { type: "boolean" },
  }, { maxPositionals: 0 });
  const picked = SINGLE.filter((name) => values[name] === true);
  if (picked.length > 1) throw usageError(`give at most one path flag, not ${picked.map((name) => `--${name}`).join(" and ")}`);
  if (picked.length === 1 && values.json === true) throw usageError(`--json and --${picked[0]} cannot be used together`);
  const root = findProjectRoot(ctx.cwd);
  const paths = {
    root,
    omt: omtDir(root),
    plans: plansDir(root),
    grills: grillsDir(root),
    evidence: evidenceDir(root),
    config: projectConfigPath(root),
    shim: projectShimPath(root),
  };
  const one = picked[0];
  if (one !== undefined) {
    ctx.stdout(`${paths[one]}\n`);
  } else if (values.json === true) {
    ctx.stdout(formatJson(paths));
  } else {
    for (const [name, path] of Object.entries(paths)) ctx.stdout(`${name}: ${path}\n`);
  }
  return 0;
};
