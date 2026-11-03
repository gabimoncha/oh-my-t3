import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import { gitRepo } from "../helpers.ts";
import { releaseRegistry, run, tools } from "./registry.ts";
import { manifestPath, projectConfigPath, projectManifestPath, userConfigPath } from "../../src/paths.ts";

const RESTART = "Restart agent sessions in T3 Code so they load the new skills.";
const LONG = 300_000;

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}

async function installAll(omt: string, env: NodeJS.ProcessEnv, root: string, project: string): Promise<void> {
  mkdirSync(root, { recursive: true });
  await run(omt, ["install", "--yes"], root, env);
  gitRepo(env.HOME!, project);
  await run(omt, ["install", "--project", "--yes"], project, env);
}

async function globalInstall(tool: ReturnType<typeof tools>, env: NodeJS.ProcessEnv, root: string, version: string, packageName = "oh-my-t3code"): Promise<string> {
  const prefix = join(root, "global-prefix");
  env.npm_config_prefix = prefix;
  env.NPM_CONFIG_PREFIX = prefix;
  await run(tool.npm, ["install", "-g", `${packageName}@${version}`], root, env);
  return join(prefix, "bin", "omt");
}

test("global npm oh-my-t3 install of A updates to B with --yes: CLI, user skills, project skills, manifests, defaults", async () => {
  const tool = tools();
  const reg = await releaseRegistry("u6-global-", tool, { next: true });
  const A = reg.version;
  const B = reg.nextVersion!;
  const env = reg.env("global", tool.nodePath);
  const project = join(reg.root, "project");
  const omt = await globalInstall(tool, env, reg.root, A, "oh-my-t3");
  assert.ok(existsSync(omt), "global bin omt must exist");
  const versionA = lastLine((await run(omt, ["--version"], reg.root, env)));
  assert.equal(versionA, A, "omt --version before the update");
  await installAll(omt, env, join(reg.root, "user-cwd"), project);

  const userCfg = userConfigPath(env, env.HOME!);
  const projCfg = projectConfigPath(project);
  mkdirSync(dirname(userCfg), { recursive: true });
  writeFileSync(userCfg, '{\n  // Keep this override.\n  "defaults": "2026-10",\n  "limits": { "maxParallel": 2 }\n}\n');
  writeFileSync(projCfg, '{\n  // Keep this override.\n  "defaults": "2026-10",\n  "limits": { "maxParallel": 2 }\n}\n');

  const line = () => `This line exists only in the e2e update build ${B}.`;
  const skillFiles = [
    join(env.HOME!, ".agents", "skills", "omt-setup", "SKILL.md"),
    join(env.CLAUDE_CONFIG_DIR!, "skills", "omt-setup", "SKILL.md"),
    join(project, ".agents", "skills", "omt-setup", "SKILL.md"),
    join(project, ".claude", "skills", "omt-setup", "SKILL.md"),
  ];
  for (const file of skillFiles) assert.ok(!readFileSync(file, "utf8").includes(line()), `${file} must not have the B line yet`);

  const out = await run(omt, ["update", "--yes"], join(reg.root, "user-cwd"), env);

  assert.equal(lastLine(await run(omt, ["--version"], reg.root, env)), B, "omt --version after the update must print B");
  for (const file of skillFiles) assert.ok(readFileSync(file, "utf8").includes(line()), `${file} must have the B line`);
  assert.equal(JSON.parse(readFileSync(manifestPath(env, env.HOME!), "utf8")).version, B, "user manifest must record B");
  assert.equal(JSON.parse(readFileSync(projectManifestPath(project), "utf8")).version, B, "project manifest must record B");
  assert.match(out, /changed\s+omt-setup/, "output must name the changed skill");
  assert.ok(out.includes(RESTART), "output must print the restart line");
  for (const file of [userCfg, projCfg]) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /"defaults"/);
    assert.match(text, /Keep this override/);
    assert.match(text, /"maxParallel": 2/);
  }
}, LONG);

test("npx omt3@A install --project, then .omt3/bin/omt update --yes pins the shim to B", async () => {
  const tool = tools();
  const reg = await releaseRegistry("u6-oneshot-", tool, { next: true });
  const A = reg.version;
  const B = reg.nextVersion!;
  const env = reg.env("oneshot", tool.nodePath);
  const project = join(reg.root, "project");
  gitRepo(env.HOME!, project);
  await run(tool.npx, ["--yes", `omt3@${A}`, "install", "--project", "--yes"], project, env);
  const shim = join(project, ".omt3", "bin", "omt");
  assert.ok(readFileSync(shim, "utf8").split("\n").includes(`exec npx --yes omt3@${A} "$@"`), "shim must pin A");
  const out = await run(shim, ["update", "--yes"], project, env);
  const text = readFileSync(shim, "utf8");
  assert.ok(text.split("\n").includes(`exec npx --yes omt3@${B} "$@"`), `shim must pin B; shim is:\n${text}`);
  assert.equal(lastLine(await run(shim, ["--version"], project, env)), B, "shim --version must print B");
  for (const file of [join(project, ".agents", "skills", "omt-setup", "SKILL.md"), join(project, ".claude", "skills", "omt-setup", "SKILL.md")]) {
    assert.ok(readFileSync(file, "utf8").includes(`This line exists only in the e2e update build ${B}.`), `${file} must have the B line`);
  }
  assert.ok(out.includes(RESTART), "output must print the restart line");
}, LONG);

test("global npm oh-my-t3code install of A switches to oh-my-t3 B with --yes, and the project shim follows", async () => {
  const tool = tools();
  const reg = await releaseRegistry("u6-switch-", tool, { next: true });
  const B = reg.nextVersion!;
  const env = reg.env("switch", tool.nodePath);
  const project = join(reg.root, "project");
  const omt = await globalInstall(tool, env, reg.root, reg.version);
  await installAll(omt, env, join(reg.root, "user-cwd"), project);

  const out = await run(omt, ["update", "--yes"], join(reg.root, "user-cwd"), env);

  assert.match(out, /run: npm uninstall -g oh-my-t3code\n/);
  assert.match(out, new RegExp(`run: npm install -g oh-my-t3@${B.replaceAll(".", "\\.")}\\n`));
  const lib = join(reg.root, "global-prefix", "lib", "node_modules");
  assert.equal(existsSync(join(lib, "oh-my-t3code")), false, "npm must have removed oh-my-t3code");
  assert.equal(JSON.parse(readFileSync(join(lib, "oh-my-t3", "package.json"), "utf8")).version, B);
  assert.equal(lastLine(await run(omt, ["--version"], reg.root, env)), B, "the omt bin must run oh-my-t3 B");
  assert.equal(lastLine(await run(join(project, ".omt3", "bin", "omt"), ["--version"], project, env)), B, "the project shim must run B");
  assert.equal(JSON.parse(readFileSync(projectManifestPath(project), "utf8")).version, B, "project manifest must record B");
}, LONG);
