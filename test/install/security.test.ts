import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import { applyInstall, applyUninstall } from "../../src/install/apply.ts";
import { buildInstallPlan, buildUninstallPlan } from "../../src/install/plan.ts";
import { fakeContext, writeFile } from "../helpers.ts";
import { makeFixture, recordOldHook, snapshot, withOldHook } from "./fixture.ts";

test("apply refuses a retired project hook removal whose settings file became an external link after planning", async () => {
  const f = makeFixture();
  const ctx = fakeContext({ root: f.root, packageRoot: f.packageRoot });
  mkdirSync(join(ctx.cwd, ".git"));
  const local = join(ctx.cwd, ".claude", "settings.local.json");
  const settings = `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "omt hook # oh-my-t3code" }] }] } }, null, 2)}\n`;
  writeFile(local, settings);
  const plan = await buildInstallPlan(ctx, { scope: "project", targets: ["agents", "claude"], force: false });
  assert.equal(plan.hooks[0]?.settingsPath, local);
  writeFile(f.settings, settings);
  rmSync(local);
  symlinkSync(f.settings, local);
  const before = snapshot(ctx.cwd);
  await assert.rejects(applyInstall(plan, ctx.now()), /outside the project/);
  assert.deepEqual(snapshot(ctx.cwd), before);
  assert.equal(readFileSync(f.settings, "utf8"), settings);
});

test("apply refuses a hook backup restore whose stamp folder became an outside link after planning", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  const ctx = fakeContext({ root: f.root, packageRoot: f.packageRoot });
  const original = '{ "theme": "dark" }\n';
  const stamp = join(f.backups, "20251201000000");
  writeFile(join(stamp, "claude-settings.json"), original);
  writeFile(f.settings, `${JSON.stringify(withOldHook({ theme: "dark" }), null, 2)}\n`);
  recordOldHook(f, f.settings, { backup: join(stamp, "claude-settings.json") });
  const plan = await buildInstallPlan(ctx, { targets: ["agents", "claude"], force: false });
  assert.equal(plan.hooks[0]?.restoreBackup, join(stamp, "claude-settings.json"));
  const outside = join(f.root, "outside");
  writeFile(join(outside, "claude-settings.json"), original);
  rmSync(stamp, { recursive: true });
  symlinkSync(outside, stamp);
  await assert.rejects(applyInstall(plan, ctx.now()), /changed after the plan was made/);
  assert.equal(readFileSync(join(outside, "claude-settings.json"), "utf8"), original);
});

test("apply refuses a gitignore restore redirected after planning", async () => {
  const f = makeFixture();
  const ctx = fakeContext({ root: f.root, packageRoot: f.packageRoot });
  mkdirSync(join(ctx.cwd, ".git"));
  const ignore = join(ctx.cwd, ".omt3", ".gitignore");
  writeFile(ignore, "mine\n");
  const install = await buildInstallPlan(ctx, { scope: "project", targets: ["agents"], gitExclude: false, force: false });
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
