import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "bun:test";
import { run as doctor } from "../../src/commands/doctor.ts";
import { run as install } from "../../src/commands/install.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { explainConfig } from "../../src/config/explain.ts";
import { applyDefaults, defaultsSnapshotPath, planDefaults, reviewDefaults } from "../../src/config/defaultsState.ts";
import { loadConfig, readConfigLayers } from "../../src/config/load.ts";
import { projectConfigPath } from "../../src/paths.ts";
import { fakeContext, gitRepo, tempDir, writeFile } from "../helpers.ts";

async function setup() {
  const root = tempDir("omt-accepted-defaults-");
  const initial = fakeContext({ root });
  gitRepo(initial.homedir, initial.cwd);
  assert.equal(await install({ ...initial, argv: ["--project", "--yes"] }), 0);
  const ctx = fakeContext({ root });
  const path = defaultsSnapshotPath(ctx, "project");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.acceptedDefaults.config.roles.execute.chain[0].effort = "medium";
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  return { ctx, path, before: readFileSync(path, "utf8") };
}

test("doctor shows the diff and preserves accepted defaults and overrides after refusal", async () => {
  const { ctx, path, before } = await setup();
  const config = projectConfigPath(ctx.cwd);
  writeFile(config, '{\n  // Keep this override.\n  "defaults": "2026-12",\n  "limits": { "maxParallel": 2 }\n}\n');
  const configBefore = readFileSync(config, "utf8");
  const prompts: string[] = [];
  await doctor({ ...ctx, argv: ["--project"], isTTY: true, prompt: async (question) => { prompts.push(question); return "no"; } });
  assert.deepEqual(prompts, ["Use the current defaults? [y/N] "]);
  assert.match(ctx.out(), /roles\.execute\.chain:.*medium.*->.*low/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(readFileSync(config, "utf8"), configBefore);
  const loaded = await loadConfig(ctx);
  assert.equal(loaded.config.roles.execute?.chain[0]?.effort, "medium");
  assert.equal(loaded.config.limits.maxParallel, 2);
});

test("doctor accepts current defaults and removes only the retired pin", async () => {
  const { ctx, path } = await setup();
  const config = projectConfigPath(ctx.cwd);
  writeFile(config, '{\n  // Keep this override.\n  "defaults": "2026-12",\n  "limits": { "maxParallel": 2 }\n}\n');
  await doctor({ ...ctx, argv: ["--project", "--yes", "--json"] });
  const report = JSON.parse(ctx.out());
  assert.equal(report.defaults.applied, true);
  assert.match(readFileSync(config, "utf8"), /Keep this override/);
  assert.doesNotMatch(readFileSync(config, "utf8"), /"defaults"/);
  const loaded = await loadConfig(ctx);
  assert.equal(loaded.config.roles.execute?.chain[0]?.effort, DEFAULT_CONFIG.roles.execute?.chain[0]?.effort);
  assert.equal(loaded.config.limits.maxParallel, 2);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).acceptedDefaults.config, DEFAULT_CONFIG);
});

for (const argv of [["--project", "--json"], ["--project", "--dry-run"], ["--project"]]) {
  test(`doctor ${argv.join(" ")} without confirmation writes nothing`, async () => {
    const { ctx, path, before } = await setup();
    await doctor({ ...ctx, argv, isTTY: false, prompt: async () => assert.fail("must not prompt") });
    assert.equal(readFileSync(path, "utf8"), before);
    if (argv.includes("--json")) assert.equal(JSON.parse(ctx.out()).defaults.applied, false);
  });
}

test("defaults review marks settings overridden by the user", async () => {
  const { ctx } = await setup();
  writeFile(projectConfigPath(ctx.cwd), JSON.stringify({ roles: { execute: { chain: [{ driver: "codex", model: "gpt-6.1-sol", effort: "high" }] } } }));
  const plan = await planDefaults(ctx, "project");
  assert.equal(plan.changes.find((change) => change.path === "roles.execute.chain")?.overriddenBy, projectConfigPath(ctx.cwd));
  await reviewDefaults({ ...ctx, isTTY: false }, "project", { yes: false, dryRun: true, json: false });
  assert.match(ctx.out(), /overridden by/);
});

test("defaults confirmation refuses a stale snapshot and keeps the config intact", async () => {
  const { ctx, path } = await setup();
  const plan = await planDefaults(ctx, "project");
  const concurrent = `${readFileSync(path, "utf8")}\n`;
  writeFileSync(path, concurrent);
  await assert.rejects(applyDefaults(ctx, "project", plan), /changed while confirmation was open/);
  assert.equal(readFileSync(path, "utf8"), concurrent);
});

test("an old install stays without a baseline until defaults approval", async () => {
  const { ctx, path } = await setup();
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  delete manifest.acceptedDefaults;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.equal(await install({ ...ctx, argv: ["--project", "--yes"] }), 0);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).acceptedDefaults, undefined);
  const plan = await planDefaults(ctx, "project");
  assert.equal(plan.firstReview, true);
  assert.equal(plan.changed, true);
  await applyDefaults(ctx, "project", plan);
  assert.equal((await planDefaults(ctx, "project")).changed, false);
});

test("project defaults take precedence and project approval preserves the user snapshot", async () => {
  const { ctx, path } = await setup();
  assert.equal(await install({ ...ctx, argv: ["--yes"] }), 0);
  const userPath = defaultsSnapshotPath(ctx, "user");
  const user = JSON.parse(readFileSync(userPath, "utf8"));
  user.acceptedDefaults.config.roles.execute.chain[0].effort = "high";
  writeFileSync(userPath, `${JSON.stringify(user, null, 2)}\n`);
  const userBefore = readFileSync(userPath, "utf8");
  assert.equal((await loadConfig(ctx)).config.roles.execute?.chain[0]?.effort, "medium");
  await applyDefaults(ctx, "project", await planDefaults(ctx, "project"));
  assert.equal(readFileSync(userPath, "utf8"), userBefore);
  assert.equal((await loadConfig(ctx)).defaultsSource, path);
  assert.equal((await loadConfig(ctx)).config.roles.execute?.chain[0]?.effort, "low");
});

test("a project defaults snapshot cannot enable the user-only update setting", async () => {
  const { ctx, path } = await setup();
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.acceptedDefaults.config.update = "apply";
  writeFileSync(path, JSON.stringify(manifest));
  await assert.rejects(loadConfig(ctx), /does not contain valid accepted defaults/);
});

test("a malformed install record gives a manifest error", async () => {
  const { ctx, path } = await setup();
  writeFileSync(path, "{broken");
  await assert.rejects(loadConfig(ctx), /install manifest .* is not valid JSON/);
});

test("config explain reports the accepted workflow value below a profile override", async () => {
  const { ctx, path } = await setup();
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.acceptedDefaults.config.profiles.normal.workflow.build.review = "first-round";
  writeFileSync(path, JSON.stringify(manifest));
  writeFile(projectConfigPath(ctx.cwd), JSON.stringify({
    profiles: { normal: { workflow: { build: { review: "every-round" } } } },
  }));
  const report = explainConfig(await readConfigLayers(ctx), await loadConfig(ctx));
  const review = report.effective.find((entry) => entry.path.join(".") === "workflow.build.review");
  assert.equal(review?.value, "every-round");
  assert.deepEqual(review?.overridden, [{ source: { kind: "defaults" }, value: "first-round" }]);
});

test("an accepted snapshot without a key that a later release added stays valid, and the review lists the key as new", async () => {
  const root = tempDir("omt-accepted-defaults-");
  const initial = fakeContext({ root });
  gitRepo(initial.homedir, initial.cwd);
  assert.equal(await install({ ...initial, argv: ["--project", "--yes"] }), 0);
  const ctx = fakeContext({ root });
  const path = defaultsSnapshotPath(ctx, "project");
  const state = JSON.parse(readFileSync(path, "utf8"));
  delete state.acceptedDefaults.config.profiles.normal.workflow.design.tool;
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);

  const loaded = await loadConfig(ctx);
  assert.equal(loaded.config.profiles.normal?.workflow?.design?.tool, "paper");
  const plan = await planDefaults(ctx, "project");
  assert.deepEqual(plan.changes.filter((change) => change.path === "profiles.normal.workflow.design.tool").map((change) => [change.from, change.to]), [["none", '"paper"']]);
  await doctor({ ...ctx, argv: ["--project", "--dry-run"] });
  assert.match(ctx.out(), /profiles\.normal\.workflow\.design\.tool: none -> "paper"/);
});
