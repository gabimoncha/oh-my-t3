import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { run as install } from "../../src/commands/install.ts";
import { DEFAULT_CONFIG, withUpdaterLimits } from "../../src/config/defaults.ts";
import { defaultsSnapshotPath } from "../../src/config/defaultsState.ts";
import type { RunCommand } from "../../src/update/channel.ts";
import { runUpdate } from "../../src/update/flow.ts";
import type { UpdateOptions } from "../../src/update/flow.ts";
import { fakeContext, gitRepo, tempDir } from "../helpers.ts";

const options: UpdateOptions = {
  check: false, dryRun: false, yes: false, skillsOnly: false, project: false, json: false,
};

for (const scenario of [
  { name: "accepts current defaults", isTTY: true, answer: "yes", applied: true },
  { name: "keeps accepted defaults after refusal", isTTY: true, answer: "no", applied: false },
  { name: "--yes accepts without another prompt", isTTY: true, yes: true, applied: true },
  { name: "JSON reports changes without a prompt", isTTY: true, json: true, applied: false },
  { name: "no TTY reports changes without writing", isTTY: false, applied: false },
]) {
  test(`defaults review after update: ${scenario.name}`, async () => {
    const root = tempDir("omt-defaults-review-");
    const fixture = { root, build: "binary" as const, cliPath: "/opt/omt-qa/omt" };
    const setup = fakeContext(fixture);
    gitRepo(root, setup.cwd);
    assert.equal(await install({ ...setup, argv: ["--yes"] }), 0);
    const path = defaultsSnapshotPath(setup, "user");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.acceptedDefaults.config.roles.execute.chain[0].effort = "low";
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const before = readFileSync(path, "utf8");
    const ctx = fakeContext(fixture);
    const calls: string[][] = [];
    const run: RunCommand = async (argv) => {
      calls.push(argv);
      assert.deepEqual(argv.slice(-3), ["config", "show", "--defaults"]);
      return { code: 0, stdout: JSON.stringify(DEFAULT_CONFIG) };
    };
    const prompts: string[] = [];
    assert.equal(await runUpdate(ctx, { ...options, yes: scenario.yes ?? false, json: scenario.json ?? false }, {
      latest: ctx.version, run, isTTY: scenario.isTTY,
      prompt: async (question) => { prompts.push(question); return scenario.answer ?? "no"; },
      fetch: (() => { throw new Error("The defaults review must not use the network"); }) as unknown as typeof fetch,
    }), 0);
    assert.equal(prompts.length, scenario.answer === undefined ? 0 : 1);
    if (prompts.length > 0) assert.equal(prompts[0], "Use the current defaults? [Y/n] ");
    const output = scenario.json ? ctx.err() : ctx.out();
    assert.match(output, /roles\.execute\.chain:.*low.*->.*medium/);
    assert.equal(readFileSync(path, "utf8") !== before, scenario.applied);
    assert.ok(calls.length > 0);
    if (scenario.json) {
      const report = JSON.parse(ctx.out());
      assert.equal(report.defaults[0].changed, true);
      assert.equal(report.defaults[0].applied, false);
      assert.equal("set" in report.defaults[0], false);
    }
  });
}

// Regression: the update asked the same defaults question once per scope, so 3 projects with the same
// accepted defaults showed the same diff 3 times. An empty answer must also accept.
test("defaults review after update asks once for scopes with the same diff, and Enter accepts", async () => {
  const root = tempDir("omt-defaults-once-");
  const fixture = { root, build: "binary" as const, cliPath: "/opt/omt-qa/omt" };
  const setup = fakeContext(fixture);
  gitRepo(root, setup.cwd);
  assert.equal(await install({ ...setup, argv: ["--yes"] }), 0);
  const projects = [join(root, "alpha"), join(root, "beta")];
  for (const project of projects) {
    gitRepo(root, project);
    assert.equal(await install({ ...setup, cwd: project, argv: ["--project", "--yes"] }), 0);
  }
  const paths = [defaultsSnapshotPath(setup, "user"), ...projects.map((project) => defaultsSnapshotPath({ ...setup, cwd: project }, "project"))];
  for (const path of paths) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.acceptedDefaults.config.roles.execute.chain[0].effort = "low";
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const ctx = fakeContext(fixture);
  const prompts: string[] = [];
  assert.equal(await runUpdate(ctx, { ...options, skillsOnly: true }, {
    isTTY: true,
    run: async () => assert.fail("skills-only must not start another CLI"),
    prompt: async (question) => { prompts.push(question); return ""; },
  }), 0);
  assert.deepEqual(prompts, ["Use the current defaults? [Y/n] "]);
  assert.equal(ctx.out().match(/Default settings update:/g)?.length, 1);
  assert.match(ctx.out(), new RegExp(`Applies to: user, .*${projects[0]}.*, .*${projects[1]}`));
  for (const path of paths) {
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).acceptedDefaults.config, withUpdaterLimits(DEFAULT_CONFIG));
  }
});

for (const deferred of [false, true]) {
  test(`skills sync ${deferred ? "defers defaults to its parent" : "shows pending defaults in a dry run"}`, async () => {
    const root = tempDir("omt-defaults-sync-");
    const fixture = { root, build: "binary" as const, cliPath: "/opt/omt-qa/omt" };
    const setup = fakeContext(fixture);
    gitRepo(root, setup.cwd);
    assert.equal(await install({ ...setup, argv: ["--yes"] }), 0);
    const path = defaultsSnapshotPath(setup, "user");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.acceptedDefaults.config.roles.execute.chain[0].effort = "low";
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const before = readFileSync(path, "utf8");
    const ctx = fakeContext({ ...fixture, env: deferred ? { OMT_UPDATE_DEFER_DEFAULTS: "1" } : {} });
    assert.equal(await runUpdate(ctx, {
      ...options, skillsOnly: true, yes: true, dryRun: !deferred, json: true,
    }, { run: async () => assert.fail("skills-only must not start another CLI") }), 0);
    const report = JSON.parse(ctx.out());
    assert.equal(readFileSync(path, "utf8"), before);
    if (deferred) {
      assert.deepEqual(report.defaults, []);
      assert.doesNotMatch(ctx.err(), /Default settings update/);
    } else {
      assert.equal(report.defaults[0].changed, true);
      assert.equal(report.defaults[0].applied, false);
      assert.match(ctx.err(), /roles\.execute\.chain:.*low.*->.*medium/);
    }
  });
}
