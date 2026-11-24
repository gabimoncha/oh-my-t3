import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { run as doctor } from "../../src/commands/doctor.ts";
import { run as install } from "../../src/commands/install.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { explainConfig } from "../../src/config/explain.ts";
import { applyDefaults, cleanRetired, defaultsSnapshotPath, planDefaults, reviewDefaults } from "../../src/config/defaultsState.ts";
import { loadConfig, readConfigLayers } from "../../src/config/load.ts";
import { omtDir, projectConfigPath } from "../../src/paths.ts";
import { fakeContext, gitRepo, tempDir, writeFile } from "../helpers.ts";

async function setup() {
  const root = tempDir("omt-accepted-defaults-");
  const initial = fakeContext({ root });
  gitRepo(initial.homedir, initial.cwd);
  assert.equal(await install({ ...initial, argv: ["--project", "--yes"] }), 0);
  const ctx = fakeContext({ root });
  const path = defaultsSnapshotPath(ctx, "project");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.acceptedDefaults.config.roles.execute.chain[0].effort = "low";
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  return { ctx, path, before: readFileSync(path, "utf8") };
}

test("doctor shows the diff and preserves accepted defaults and overrides after refusal, and still removes a retired key", async () => {
  const { ctx, path, before } = await setup();
  const config = projectConfigPath(ctx.cwd);
  writeFile(config, '{\n  // Keep this override.\n  "defaults": "2026-12",\n  "limits": { "maxReviewRounds": 2 }\n}\n');
  const prompts: string[] = [];
  await doctor({ ...ctx, argv: ["--project"], isTTY: true, prompt: async (question) => { prompts.push(question); return "no"; } });
  assert.deepEqual(prompts, ["Use the current defaults? [y/N] "]);
  assert.match(ctx.out(), /roles\.execute\.chain:.*low.*->.*medium/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(readFileSync(config, "utf8"), '{\n  // Keep this override.\n  "limits": { "maxReviewRounds": 2 }\n}\n');
  const loaded = await loadConfig(ctx);
  assert.equal(loaded.config.roles.execute?.chain[0]?.effort, "low");
  assert.equal(loaded.config.limits.maxReviewRounds, 2);
});

test("doctor accepts current defaults and removes only the retired pin", async () => {
  const { ctx, path } = await setup();
  const config = projectConfigPath(ctx.cwd);
  writeFile(config, '{\n  // Keep this override.\n  "defaults": "2026-12",\n  "limits": { "maxReviewRounds": 2 }\n}\n');
  await doctor({ ...ctx, argv: ["--project", "--yes", "--json"] });
  const report = JSON.parse(ctx.out());
  assert.equal(report.defaults.applied, true);
  assert.match(readFileSync(config, "utf8"), /Keep this override/);
  assert.doesNotMatch(readFileSync(config, "utf8"), /"defaults"/);
  const loaded = await loadConfig(ctx);
  assert.equal(loaded.config.roles.execute?.chain[0]?.effort, DEFAULT_CONFIG.roles.execute?.chain[0]?.effort);
  assert.equal(loaded.config.limits.maxReviewRounds, 2);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).acceptedDefaults.config, DEFAULT_CONFIG);
});

test("doctor removes every retired key without a prompt and keeps comments, overrides, and emptied parents with a comment", async () => {
  const { ctx } = await setup();
  const config = projectConfigPath(ctx.cwd);
  writeFile(config, [
    "{",
    "  // Keep this override.",
    '  "roles": {',
    '    "guardrail": { "chain": [{ "driver": "codex", "model": "m" }] },',
    '    "grill": null',
    "  },",
    '  "limits": { "maxReviewRounds": 2, "maxTasksPerRun": 5 },',
    '  "profiles": {',
    '    "normal": { "workflow": { "review": { "guardrails": "propose" } } },',
    '    "prototype": { "workflow": { "review": {',
    "      // Keep this note.",
    '      "guardrails": "off"',
    '    }, "git": { "pullRequests": "off", "owners": ["acme"], "maxPrFiles": 10 } } }',
    "  }",
    "}",
    "",
  ].join("\n"));
  const before = readFileSync(config, "utf8");
  const dry = await cleanRetired(ctx, "project", { dryRun: true });
  assert.deepEqual(dry.keys, [
    "roles.guardrail",
    "roles.grill",
    "limits.maxTasksPerRun",
    "profiles.normal.workflow.review.guardrails",
    "profiles.prototype.workflow.review.guardrails",
    "profiles.prototype.workflow.git",
  ]);
  assert.equal(readFileSync(config, "utf8"), before, "a dry run writes nothing");
  await doctor({ ...ctx, argv: ["--project"], isTTY: true, prompt: async () => "no" });
  assert.match(ctx.out(), /removed the retired keys from .*: roles\.guardrail, roles\.grill, limits\.maxTasksPerRun, /);
  const after = readFileSync(config, "utf8");
  assert.match(after, /Keep this override/);
  assert.match(after, /Keep this note/);
  assert.doesNotMatch(after, /guardrail|grill|maxTasksPerRun|"normal"|"git"/);
  const loaded = await loadConfig(ctx);
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.config.limits.maxReviewRounds, 2);
  assert.deepEqual((await cleanRetired(ctx, "project", { dryRun: true })).keys, []);
});

test("cleanup deletes an empty guardrails.md and keeps one with text", async () => {
  const { ctx } = await setup();
  const file = join(omtDir(ctx.cwd), "guardrails.md");
  writeFile(file, "\n  \n");
  assert.deepEqual((await cleanRetired(ctx, "project", { dryRun: false })).files, [file]);
  assert.equal(existsSync(file), false);
  writeFile(file, "# Proposals\n");
  assert.deepEqual((await cleanRetired(ctx, "project", { dryRun: false })).files, []);
  assert.equal(readFileSync(file, "utf8"), "# Proposals\n");
  writeFile(file, "");
  assert.deepEqual((await cleanRetired(ctx, "user", { dryRun: false })).files, [], "the user scope never touches a project file");
  assert.equal(existsSync(file), true);
});

// A link at .omt3/locks to a project folder must lose only the link: a followed link deleted the folder.
test("cleanup removes a symlinked locks or ledger entry itself, never its target, and skips an entry of the wrong type", async () => {
  const { ctx } = await setup();
  const keep = join(ctx.cwd, "keep");
  writeFile(join(keep, "notes.md"), "mine\n");
  writeFile(join(ctx.cwd, "data.jsonl"), "mine\n");
  symlinkSync(keep, join(omtDir(ctx.cwd), "locks"));
  symlinkSync(join(ctx.cwd, "data.jsonl"), join(omtDir(ctx.cwd), "ledger.jsonl"));
  const cleanup = await cleanRetired(ctx, "project", { dryRun: false });
  assert.deepEqual(cleanup.files.sort(), [join(omtDir(ctx.cwd), "ledger.jsonl"), join(omtDir(ctx.cwd), "locks")]);
  assert.throws(() => lstatSync(join(omtDir(ctx.cwd), "locks")));
  assert.throws(() => lstatSync(join(omtDir(ctx.cwd), "ledger.jsonl")));
  assert.equal(readFileSync(join(keep, "notes.md"), "utf8"), "mine\n");
  assert.equal(readFileSync(join(ctx.cwd, "data.jsonl"), "utf8"), "mine\n");

  writeFile(join(omtDir(ctx.cwd), "ledger.jsonl", "inside.txt"), "a folder, not the ledger\n");
  assert.deepEqual((await cleanRetired(ctx, "project", { dryRun: false })).files, []);
  assert.ok(existsSync(join(omtDir(ctx.cwd), "ledger.jsonl", "inside.txt")));
});

test("install removes the retired keys without a prompt", async () => {
  const { ctx } = await setup();
  const config = projectConfigPath(ctx.cwd);
  writeFile(config, '{ "roles": { "guardrail": null } }\n');
  assert.equal(await install({ ...ctx, argv: ["--project", "--yes"] }), 0);
  assert.match(ctx.out(), /removed the retired keys from .*: roles\.guardrail/);
  assert.doesNotMatch(readFileSync(config, "utf8"), /guardrail/);
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
  writeFile(projectConfigPath(ctx.cwd), JSON.stringify({ roles: { execute: { chain: [{ driver: "codex", model: "gpt-6.2-sol", effort: "high" }] } } }));
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
  assert.equal((await loadConfig(ctx)).config.roles.execute?.chain[0]?.effort, "low");
  await applyDefaults(ctx, "project", await planDefaults(ctx, "project"));
  assert.equal(readFileSync(userPath, "utf8"), userBefore);
  assert.equal((await loadConfig(ctx)).defaultsSource, path);
  assert.equal((await loadConfig(ctx)).config.roles.execute?.chain[0]?.effort, "medium");
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
