import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import { applyInstall, applyUninstall } from "../../src/install/apply.ts";
import { buildInstallPlan, buildUninstallPlan } from "../../src/install/plan.ts";
import { fakeContext, writeFile } from "../helpers.ts";
import { makeFixture, snapshot } from "./fixture.ts";

test("apply refuses a project hook changed to an external link after planning", async () => {
  const f = makeFixture();
  const ctx = fakeContext({ root: f.root, packageRoot: f.packageRoot });
  mkdirSync(join(ctx.cwd, ".git"));
  const plan = await buildInstallPlan(ctx, { scope: "project", targets: ["agents", "claude"], hooks: true, force: false });
  assert.ok(plan.hook);
  mkdirSync(dirname(plan.hook.settingsPath), { recursive: true });
  symlinkSync(f.settings, plan.hook.settingsPath);
  const before = snapshot(ctx.cwd);
  await assert.rejects(applyInstall(plan, ctx.now()), /outside the project/);
  assert.deepEqual(snapshot(ctx.cwd), before);
  assert.ok(!existsSync(f.settings));
});

test("apply refuses a gitignore restore redirected after planning", async () => {
  const f = makeFixture();
  const ctx = fakeContext({ root: f.root, packageRoot: f.packageRoot });
  mkdirSync(join(ctx.cwd, ".git"));
  const ignore = join(ctx.cwd, ".omt3", ".gitignore");
  writeFile(ignore, "mine\n");
  const install = await buildInstallPlan(ctx, { scope: "project", targets: ["agents"], hooks: false, gitExclude: false, force: false });
  await applyInstall(install, ctx.now());
  const uninstall = await buildUninstallPlan(ctx, { scope: "project", purge: false });
  assert.ok(uninstall.project?.gitignore);
  const target = join(f.root, "external-ignore");
  const text = readFileSync(ignore, "utf8");
  writeFile(target, text);
  rmSync(ignore);
  symlinkSync(target, ignore);
  const before = snapshot(ctx.cwd);
  await assert.rejects(applyUninstall(uninstall, ctx.now()), /outside the project/);
  assert.equal(readFileSync(target, "utf8"), text);
  assert.deepEqual(snapshot(ctx.cwd), before);
});
