import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { writeFile } from "../helpers.ts";
import { doctor } from "../run.ts";
import { makeFixture, readJson, recordOldHook, withOldHook, writeSkill } from "./fixture.ts";

const RESEARCH = "omt-research";

// An install of the release before T3 covered these features left the omt-research skill and its links,
// the Claude prompt hook, the limits.maxParallel key, and the project's ledger and lock files. omt update
// must leave a clean install in user scope and in each recorded project.
test("omt update removes omt-research, the prompt hook, limits.maxParallel, and the project ledger and locks", async () => {
  const f = makeFixture();
  const project = join(f.root, "project");
  mkdirSync(join(project, ".git"));
  writeSkill(f.packageRoot, RESEARCH, { "SKILL.md": "---\nname: omt-research\n---\nResearch.\n" });
  await f.runOk(["install", "--yes"]);
  await f.runOk(["install", "--project", "--yes"], { cwd: project });

  const userSettings = `${JSON.stringify({ theme: "dark" }, null, 2)}\n`;
  writeFile(f.settings, `${JSON.stringify(withOldHook({ theme: "dark" }), null, 2)}\n`);
  recordOldHook(f, f.settings);
  const projectSettings = join(project, ".claude", "settings.local.json");
  writeFile(projectSettings, `${JSON.stringify(withOldHook({}), null, 2)}\n`);
  recordOldHook(join(project, ".omt3", "install.json"), projectSettings, { created: true });
  const userConfig = join(f.configDir, "config.jsonc");
  const projectConfig = join(project, ".omt3", "config.jsonc");
  for (const config of [userConfig, projectConfig]) writeFileSync(config, '{\n  "version": 1,\n  "limits": { "maxParallel": 2, "maxDepth": 2 }\n}\n');
  const ledger = join(project, ".omt3", "ledger.jsonl");
  const locks = join(project, ".omt3", "locks");
  writeFile(ledger, '{"ts":"2026-11-01T00:00:00.000Z","role":"execute","status":"dispatched"}\n');
  writeFile(join(locks, "ledger.lock"), "");
  writeFile(join(locks, "build.lock"), "");
  rmSync(join(f.packageRoot, "skills", RESEARCH), { recursive: true });

  const { ctx } = await f.runOk(["update", "--skills-only", "--yes"]);
  const out = ctx.out();
  assert.match(out, /^ {2}remove {3}omt-research {2}\(no longer shipped\)$/m);
  assert.match(out, new RegExp(`removed ${ledger.replaceAll(".", "\\.")}; the ledger is retired`));
  assert.match(out, new RegExp(`removed ${locks.replaceAll(".", "\\.")}; omt lock is retired`));

  for (const root of [f.home, project]) {
    assert.ok(!existsSync(join(root, ".agents", "skills", RESEARCH)), `${root}: skill`);
    assert.throws(() => lstatSync(join(root, ".claude", "skills", RESEARCH)), `${root}: link`);
  }
  assert.ok(!(readJson(f.manifest).skills as string[]).includes(RESEARCH));
  assert.ok(!(readJson(join(project, ".omt3", "install.json")).skills as string[]).includes(RESEARCH));

  assert.equal(readFileSync(f.settings, "utf8"), userSettings);
  assert.ok(!existsSync(projectSettings), "the settings file that only the hook created is gone");
  assert.deepEqual(readJson(f.manifest).hooks, []);
  assert.deepEqual(readJson(join(project, ".omt3", "install.json")).hooks, []);

  for (const config of [userConfig, projectConfig]) {
    const text = readFileSync(config, "utf8");
    assert.doesNotMatch(text, /maxParallel/, config);
    assert.match(text, /"maxDepth": 2/, config);
  }
  assert.ok(!existsSync(ledger));
  assert.ok(!existsSync(locks));

  for (const [argv, cwd] of [[[], f.root], [["--project"], project]] as const) {
    const report = await doctor(f, [...argv], { cwd });
    assert.equal(report.get("skills").status, "PASS", `${cwd}: ${report.get("skills").message}`);
    assert.ok(!report.report.checks.some((check) => check.id === "hooks"), cwd);
  }
});

// omt update of v0.7.1 runs this CLI's sync with OMT_UPDATE_DEFER_DEFAULTS=1 and then reviews the defaults with its
// own code, which knows nothing of the retired ledger, locks, or maxParallel. The deferred sync must clean them.
test("a deferred update, as v0.7.1 starts it, still removes the retired config keys and project state", async () => {
  const f = makeFixture();
  const project = join(f.root, "project");
  mkdirSync(join(project, ".git"));
  await f.runOk(["install", "--yes"]);
  await f.runOk(["install", "--project", "--yes"], { cwd: project });
  const projectConfig = join(project, ".omt3", "config.jsonc");
  writeFileSync(projectConfig, '{\n  "version": 1,\n  "limits": { "maxParallel": 2 }\n}\n');
  const ledger = join(project, ".omt3", "ledger.jsonl");
  writeFile(ledger, "{}\n");
  writeFile(join(project, ".omt3", "locks", "build.lock"), "");

  await f.runOk(["update", "--skills-only", "--yes"], { env: { OMT_UPDATE_DEFER_DEFAULTS: "1" } });
  assert.doesNotMatch(readFileSync(projectConfig, "utf8"), /maxParallel/);
  assert.ok(!existsSync(ledger));
  assert.ok(!existsSync(join(project, ".omt3", "locks")));
});
