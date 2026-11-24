import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { run as uninstall } from "../../src/commands/uninstall.ts";
import { applyInstall } from "../../src/install/apply.ts";
import { readManifest } from "../../src/install/manifest.ts";
import { buildInstallPlan } from "../../src/install/plan.ts";
import { shimContent } from "../../src/install/project.ts";
import { addProject, readProjects } from "../../src/install/projects.ts";
import { projectManifestPath, projectShimPath, projectsPath } from "../../src/paths.ts";
import type { CliContext } from "../../src/types.ts";
import { detectChannel } from "../../src/update/channel.ts";
import type { RunCommand } from "../../src/update/channel.ts";
import { applySync, pathShimChannel, planSync, readProjectShim, renderSyncPlan, syncHasChanges } from "../../src/update/sync.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

const options = { projectOnly: false, runners: "skip" as const, targetVersion: "0.2.0" };

function fixture() {
  const root = realpathSync(tempDir("omt-sync-"));
  const home = join(root, "home");
  const packageRoot = join(root, "package");
  writeFile(join(packageRoot, "skills", "alpha", "SKILL.md"), "Alpha v1.\n");
  const ctx = fakeContext({ root, homedir: home, env: { HOME: home }, packageRoot, version: "0.2.0" });
  return { root, ctx, packageRoot };
}

function channel(ctx: CliContext) {
  return detectChannel(ctx);
}

async function project(ctx: CliContext, root: string) {
  mkdirSync(join(root, ".git", "info"), { recursive: true });
  const local = { ...ctx, cwd: root };
  await applyInstall(await buildInstallPlan(local, {
    scope: "project", targets: ["agents", "claude"], force: false,
  }), ctx.now());
  await addProject(projectsPath(ctx.env, ctx.homedir), root, ctx.now());
  return local;
}

async function runnerFixture() {
  const f = fixture();
  const ctx = await project(f.ctx, join(f.root, "runner"));
  const shim = projectShimPath(ctx.cwd);
  writeFile(shim, shimContent({ kind: "runner", runner: "npx", version: "0.1.0" }));
  return { ...f, ctx, shim };
}

// Approved U5 unit line: recorded project shim rules, sync conflicts, and runner checks.
test("U5 same channel rewrites the shim and syncs recorded project skills", async () => {
  const f = fixture();
  const oldCli = "/opt/omt-qa/installs/github-gabimoncha-oh-my-t3code/0.1.0/omt";
  const newCli = oldCli.replace("0.1.0", "0.2.0");
  const old = await project({ ...f.ctx, build: "binary", cliPath: oldCli }, join(f.root, "same"));
  const ctx = { ...f.ctx, build: "binary" as const, cliPath: newCli };
  writeFile(join(f.packageRoot, "skills/alpha/SKILL.md"), "Alpha v2.\n");
  const shim = await readProjectShim(old.cwd);
  assert.ok(shim?.kind === "path");
  assert.equal(pathShimChannel(ctx, old.cwd, shim).key, channel(ctx).key);
  const entries = await planSync(ctx, channel(ctx), options);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.plan?.skills[0]?.action, "update");
  assert.equal(syncHasChanges(entries), true);
  assert.match(renderSyncPlan(entries), /update\s+alpha/);
  assert.equal((await applySync(ctx, entries))[0]?.status, "synced");
  assert.equal(readFileSync(join(old.cwd, ".agents/skills/alpha/SKILL.md"), "utf8"), "Alpha v2.\n");
  assert.match(readFileSync(projectShimPath(old.cwd), "utf8"), /0\.2\.0/);
});

test("U5 another channel skips the recorded project", async () => {
  const f = fixture();
  const local = await project(f.ctx, join(f.root, "other"));
  const cli = join(f.root, "other-cli/dist/cli.js");
  writeFile(projectShimPath(local.cwd), shimContent({ kind: "bundle", runtime: "/usr/bin/node", cli }));
  const before = readFileSync(projectShimPath(local.cwd), "utf8");
  const entries = await planSync(f.ctx, channel(f.ctx), options);
  assert.equal(entries[0]?.plan, undefined);
  assert.equal(entries[0]?.result.status, "skipped");
  assert.match(entries[0]?.result.note ?? "", /runs another omt/);
  assert.equal(syncHasChanges(entries), false);
  await applySync(f.ctx, entries);
  assert.equal(readFileSync(projectShimPath(local.cwd), "utf8"), before);
});

test("U5 running runner syncs in process and keeps its shim", async () => {
  const f = fixture();
  const cliPath = join(f.root, "npm/_npx/abcdef/node_modules/omt3/dist/cli.js");
  const ctx = { ...f.ctx, build: "bundle" as const, cliPath, env: { HOME: f.ctx.homedir, npm_config_cache: join(f.root, "npm") } };
  const local = await project(ctx, join(f.root, "running"));
  const before = readFileSync(projectShimPath(local.cwd), "utf8");
  const run: RunCommand = async () => { assert.fail("The running runner must not start a child."); };
  const entries = await planSync(ctx, channel(ctx), { ...options, run });
  assert.ok(entries[0]?.plan);
  assert.equal(entries[0].runner, undefined);
  assert.equal(entries[0].plan.project?.shim.action, "unchanged");
  assert.equal((await applySync(ctx, entries))[0]?.status, "unchanged");
  assert.equal(readFileSync(projectShimPath(local.cwd), "utf8"), before);
});

test("U5 another runner skip leaves its pin and starts no child", async () => {
  const f = await runnerFixture();
  const before = readFileSync(f.shim, "utf8");
  const run: RunCommand = async () => { assert.fail("Skip must not run a command."); };
  const entries = await planSync(f.ctx, channel(f.ctx), { ...options, run });
  assert.equal(entries[0]?.result.status, "skipped");
  assert.match(entries[0]?.result.note ?? "", /runs npx --yes omt3@0\.1\.0/);
  assert.equal(syncHasChanges(entries), false);
  await applySync(f.ctx, entries);
  assert.equal(readFileSync(f.shim, "utf8"), before);
});

test("U5 another runner delegate checks the version and reports child JSON", async () => {
  const f = await runnerFixture();
  const calls: { argv: string[]; cwd: string | undefined }[] = [];
  const scope = { scope: "project", root: f.ctx.cwd, status: "synced", changed: ["alpha"], kept: [{ name: "beta", reason: "locally modified" }] };
  const run: RunCommand = async (argv, opts) => {
    calls.push({ argv, cwd: opts.cwd });
    if (argv.includes("--version")) {
      assert.match(readFileSync(f.shim, "utf8"), /omt3@0\.1\.0/);
      return { code: 0, stdout: "0.2.0\n" };
    }
    assert.match(readFileSync(f.shim, "utf8"), /omt3@0\.2\.0/);
    assert.equal(opts.env?.OMT_UPDATE_DEFER_DEFAULTS, "1");
    return { code: 0, stdout: JSON.stringify({ scopes: [scope] }) };
  };
  const entries = await planSync(f.ctx, channel(f.ctx), { ...options, runners: "delegate", run });
  assert.ok(entries[0]?.runner);
  assert.equal(syncHasChanges(entries), true);
  assert.match(renderSyncPlan(entries), /update --skills-only --project --yes --json/);
  assert.deepEqual(await applySync(f.ctx, entries), [scope]);
  assert.deepEqual(calls, [
    { argv: ["npx", "--yes", "omt3@0.2.0", "--version"], cwd: f.ctx.cwd },
    { argv: [f.shim, "update", "--skills-only", "--project", "--yes", "--json"], cwd: f.ctx.cwd },
  ]);
});

test("U5 removed folder leaves the project list only on apply", async () => {
  const f = fixture();
  const gone = join(f.root, "gone");
  await addProject(projectsPath(f.ctx.env, f.ctx.homedir), gone, f.ctx.now());
  const entries = await planSync(f.ctx, channel(f.ctx), options);
  assert.equal(entries[0]?.gone, true);
  assert.equal(entries[0]?.result.note, "gone; removed from the project list");
  assert.equal(syncHasChanges(entries), true);
  assert.equal((await readProjects(projectsPath(f.ctx.env, f.ctx.homedir))).length, 1);
  await applySync(f.ctx, entries);
  assert.deepEqual(await readProjects(projectsPath(f.ctx.env, f.ctx.homedir)), []);
});

test("U5 edited skill stays owned and is reported as kept", async () => {
  const f = fixture();
  const ctx = await project(f.ctx, join(f.root, "edited"));
  const file = join(ctx.cwd, ".agents/skills/alpha/SKILL.md");
  writeFile(file, "Owner edit.\n");
  const entries = await planSync(ctx, channel(ctx), options);
  const kept = [{ name: "alpha", reason: "locally modified; omt install --force replaces it" }];
  assert.deepEqual(entries[0]?.result.kept, kept);
  assert.match(renderSyncPlan(entries), /kept alpha/);
  assert.deepEqual((await applySync(ctx, entries))[0]?.kept, kept);
  assert.equal(readFileSync(file, "utf8"), "Owner edit.\n");
  assert.ok((await readManifest(projectManifestPath(ctx.cwd)))?.skills.includes("alpha"));
});

test("U5 unmanaged skill stays unowned and gets no new Claude link", async () => {
  const f = fixture();
  const ctx = await project(f.ctx, join(f.root, "unmanaged"));
  writeFile(join(f.packageRoot, "skills/beta/SKILL.md"), "Bundled beta.\n");
  const file = join(ctx.cwd, ".agents/skills/beta/SKILL.md");
  writeFile(file, "Owner beta.\n");
  const entries = await planSync(ctx, channel(ctx), options);
  const link = entries[0]?.plan?.links.find((step) => step.name === "beta");
  assert.equal(link?.action, "keep");
  assert.equal(link.reason, "points at a skill that omt does not manage");
  await applySync(ctx, entries);
  const manifest = await readManifest(projectManifestPath(ctx.cwd));
  assert.equal(manifest?.skills.includes("beta"), false);
  assert.equal(manifest?.links.some((entry) => entry.path.endsWith("/beta")), false);
  assert.equal(existsSync(join(ctx.cwd, ".claude/skills/beta")), false);
  assert.equal(readFileSync(file, "utf8"), "Owner beta.\n");
});

test("U5 kept conflicting link survives later uninstall --project", async () => {
  const f = fixture();
  const ctx = await project(f.ctx, join(f.root, "link"));
  const link = join(ctx.cwd, ".claude/skills/alpha");
  const owner = join(f.root, "owner-skill");
  writeFile(join(owner, "SKILL.md"), "Owner skill.\n");
  rmSync(link);
  symlinkSync(owner, link);
  writeFile(join(f.packageRoot, "skills/beta/SKILL.md"), "Beta.\n");
  const extraLink = join(ctx.cwd, ".claude/skills/beta");
  const extraTarget = "../../.agents/skills/alpha";
  symlinkSync(extraTarget, extraLink);
  const entries = await planSync(ctx, channel(ctx), options);
  assert.equal(entries[0]?.plan?.links[0]?.action, "keep");
  assert.equal(entries[0]?.plan?.links.find((step) => step.name === "beta")?.action, "keep");
  await applySync(ctx, entries);
  assert.equal(readlinkSync(link), owner);
  const manifest = await readManifest(projectManifestPath(ctx.cwd));
  assert.ok(manifest?.project?.existing?.links.includes(extraLink));
  assert.equal(manifest?.links.some((entry) => entry.path === extraLink), false);
  assert.equal(await uninstall({ ...ctx, argv: ["--project", "--yes"] }), 0);
  assert.equal(readlinkSync(link), owner);
  assert.equal(readlinkSync(extraLink), extraTarget);
  assert.equal(readFileSync(join(owner, "SKILL.md"), "utf8"), "Owner skill.\n");
});

test("U5 failed runner version check leaves the shim unchanged", async () => {
  const f = await runnerFixture();
  const before = readFileSync(f.shim, "utf8");
  const calls: string[][] = [];
  const run: RunCommand = async (argv) => { calls.push(argv); return { code: 1, stdout: "" }; };
  const entries = await planSync(f.ctx, channel(f.ctx), { ...options, runners: "delegate", run });
  const results = await applySync(f.ctx, entries);
  assert.equal(results[0]?.status, "failed");
  assert.match(results[0]?.note ?? "", /did not start; the shim keeps 0\.1\.0/);
  assert.deepEqual(calls, [["npx", "--yes", "omt3@0.2.0", "--version"]]);
  assert.equal(readFileSync(f.shim, "utf8"), before);
});

test("U5 missing managed shim skips the recorded project", async () => {
  const f = fixture();
  const ctx = await project(f.ctx, join(f.root, "no-shim"));
  rmSync(projectShimPath(ctx.cwd));
  const entries = await planSync(f.ctx, channel(f.ctx), options);
  assert.equal(entries[0]?.result.status, "skipped");
  assert.equal(entries[0]?.result.note, "no managed shim; run omt install --project there");
  assert.equal(entries[0]?.plan, undefined);
  assert.equal(syncHasChanges(entries), false);
  await applySync(f.ctx, entries);
  assert.equal(existsSync(projectShimPath(ctx.cwd)), false);
});

test("update removes a managed project skill that the bundle no longer ships, with its link and record", async () => {
  const f = fixture();
  writeFile(join(f.packageRoot, "skills", "beta", "SKILL.md"), "Beta.\n");
  const ctx = await project(f.ctx, join(f.root, "retired"));
  const skill = join(ctx.cwd, ".agents/skills/beta");
  const link = join(ctx.cwd, ".claude/skills/beta");
  assert.ok(existsSync(join(skill, "SKILL.md")) && existsSync(link));
  rmSync(join(f.packageRoot, "skills", "beta"), { recursive: true });

  const entries = await planSync(ctx, channel(ctx), options);
  assert.equal(syncHasChanges(entries), true);
  assert.match(renderSyncPlan(entries), /^ {2}remove {3}beta {2}\(no longer shipped\)$/m);
  assert.match(renderSyncPlan(entries), new RegExp(`^ {2}remove {3}${link} -> `, "m"));
  assert.ok(existsSync(skill), "planning writes nothing");
  const results = await applySync(ctx, entries);
  assert.ok(results[0]?.changed.includes("beta"));
  assert.equal(existsSync(skill), false);
  assert.throws(() => lstatSync(link));
  assert.ok(existsSync(join(ctx.cwd, ".agents/skills/alpha/SKILL.md")));
  const manifest = await readManifest(projectManifestPath(ctx.cwd));
  assert.deepEqual(manifest?.skills, ["alpha"]);
  assert.equal(manifest?.links.some((entry) => entry.path === link), false);
});

test("update keeps a user folder that replaced a retired skill, and an edited retired skill", async () => {
  const f = fixture();
  writeFile(join(f.packageRoot, "skills", "beta", "SKILL.md"), "Beta.\n");
  writeFile(join(f.packageRoot, "skills", "gamma", "SKILL.md"), "Gamma.\n");
  const ctx = await project(f.ctx, join(f.root, "kept"));
  const beta = join(ctx.cwd, ".agents/skills/beta");
  rmSync(beta, { recursive: true });
  writeFile(join(beta, "SKILL.md"), "Owner beta.\n");
  const gamma = join(ctx.cwd, ".agents/skills/gamma/SKILL.md");
  writeFile(gamma, "Edited gamma.\n");
  rmSync(join(f.packageRoot, "skills", "beta"), { recursive: true });
  rmSync(join(f.packageRoot, "skills", "gamma"), { recursive: true });

  const entries = await planSync(ctx, channel(ctx), options);
  assert.deepEqual(entries[0]?.result.kept, [
    { name: "gamma", reason: "locally modified; no longer shipped; omt install --force backs it up and removes it" },
  ]);
  await applySync(ctx, entries);
  assert.equal(readFileSync(join(beta, "SKILL.md"), "utf8"), "Owner beta.\n");
  assert.equal(readFileSync(gamma, "utf8"), "Edited gamma.\n");
  assert.ok(existsSync(join(ctx.cwd, ".claude/skills/gamma")), "the link to a kept skill stays");
  assert.deepEqual((await readManifest(projectManifestPath(ctx.cwd)))?.skills, ["alpha", "gamma"]);
});

test("update in user scope removes a retired managed skill and its links", async () => {
  const f = fixture();
  writeFile(join(f.packageRoot, "skills", "beta", "SKILL.md"), "Beta.\n");
  const targets = ["agents", "claude"] as ("agents" | "claude")[];
  await applyInstall(await buildInstallPlan(f.ctx, { targets, force: false }), f.ctx.now());
  const skill = join(f.ctx.homedir, ".agents/skills/beta");
  const link = join(f.ctx.homedir, ".claude/skills/beta");
  assert.ok(existsSync(skill) && existsSync(link));
  rmSync(join(f.packageRoot, "skills", "beta"), { recursive: true });

  const plan = await buildInstallPlan(f.ctx, { targets, force: false, sync: true });
  assert.equal(plan.skills.find((step) => step.name === "beta")?.action, "remove");
  await applyInstall(plan, f.ctx.now());
  assert.equal(existsSync(skill), false);
  assert.throws(() => lstatSync(link));
});
