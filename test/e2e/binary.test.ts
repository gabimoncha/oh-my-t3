import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { onTestFinished, test } from "bun:test";
import { gitRepo, PACKAGE_ROOT, tempDir } from "../helpers.ts";
import { isolatedEnv } from "./registry.ts";

function skillFiles(root: string, relative = ""): string[] {
  return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = join(relative, entry.name);
    if (relative === "" && entry.name === ".omt-managed.json") return [];
    return entry.isDirectory() ? skillFiles(root, path) : [path];
  }).sort();
}

test("compiled host binary installs matching skills and hooks, passes doctor, and runs roles through the shim", () => {
  const parent = join(PACKAGE_ROOT, "dist", "test-e2e");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "binary-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const homeRoot = tempDir("omt-binary-home-");
  const env = isolatedEnv(homeRoot);
  const project = join(root, "project");
  gitRepo(homeRoot, project, { "package.json": JSON.stringify({ packageManager: "bun@1.4.4" }), "bun.lock": "" });

  function run(command: string, args: string[], cwd = project, timeout = 30_000): string {
    const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  }

  const build = join(root, "build");
  run(process.execPath, [join(PACKAGE_ROOT, "scripts", "build.ts"), "--binary", "--outdir", build], PACKAGE_ROOT, 90_000);
  const binary = join(build, "bin", "omt");
  assert.ok(statSync(binary).isFile(), "the build must write the host binary");
  // --with selects every opt-in skill, so the install holds every bundled skill.
  run(binary, ["install", "--project", "--hooks", "--with", "omt-swarm", "--yes"]);

  const bundled = join(PACKAGE_ROOT, "skills");
  const installed = join(project, ".agents", "skills");
  const names = readdirSync(bundled).sort();
  assert.ok(names.length > 0, "the repository must contain skills");
  assert.deepEqual(readdirSync(installed).sort(), names, "installed skill names must match skills/");
  for (const name of names) {
    const source = join(bundled, name);
    const target = join(installed, name);
    const files = skillFiles(source);
    assert.deepEqual(skillFiles(target), files, `installed files must match skills/${name}`);
    for (const file of files) {
      assert.deepEqual(readFileSync(join(target, file)), readFileSync(join(source, file)), `installed content must match skills/${name}/${file}`);
    }
  }

  const shim = join(project, ".omt", "bin", "omt");
  const doctor = run(shim, ["doctor", "--project"]);
  assert.doesNotMatch(doctor, /^FAIL\b/m);
  assert.match(doctor, /^PASS\s+runtime\s+omt \S+ binary$/m);
  assert.match(doctor, /^PASS\s+hooks\s/m);
  const roles = run(shim, ["roles"]);
  assert.match(roles, /^ROLE\s+STATUS\s+TARGET\s+ACCESS\s+MODE\s+CROSS$/m);
  assert.match(roles, /^execute\s+unverified\s+/m);

  // The binary embeds the worktree setup runner, so setup writes its exact bytes with no templates/ folder.
  run(shim, ["worktree", "setup", "--yes"]);
  assert.deepEqual(readFileSync(join(project, ".t3", "omt-worktree-setup.mjs")), readFileSync(join(PACKAGE_ROOT, "templates", "worktree-setup.mjs")));
  assert.match(run(shim, ["worktree", "check"]), /^PASS\s+setup\s/m);
}, 120_000);
