import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { OPT_IN_SKILLS } from "../../src/install/skills.ts";
import { writeFile } from "../helpers.ts";
import { doctor } from "../run.ts";
import { makeFixture, readJson, snapshot, writeSkill } from "./fixture.ts";
import type { Fixture } from "./fixture.ts";

const SWARM = "omt-swarm";

function swarmFixture(): Fixture {
  const f = makeFixture();
  writeSkill(f.packageRoot, SWARM, { "SKILL.md": "---\nname: omt-swarm\n---\nSwarm v1.\n" });
  return f;
}

// An install from before opt-in skills existed: omt-swarm is installed and recorded, with no opt-in record.
function dropOptIn(manifestPath: string): void {
  const manifest = readJson(manifestPath);
  delete manifest.optIn;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function assertDoctorClean(f: Fixture, argv: string[] = []): Promise<void> {
  const report = await doctor(f, argv);
  for (const id of ["skills", "links"]) {
    const check = report.get(id);
    assert.equal(check.status, "PASS", `${id}: ${check.message}`);
  }
}

test("omt-swarm is the opt-in skill", () => {
  assert.deepEqual(OPT_IN_SKILLS, [SWARM]);
});

test("a default install skips omt-swarm, and doctor does not report it as missing", async () => {
  const f = swarmFixture();
  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.doesNotMatch(ctx.out(), /omt-swarm/);
  assert.ok(existsSync(join(f.agents, "alpha", "SKILL.md")));
  assert.ok(!existsSync(join(f.agents, SWARM)));
  assert.throws(() => lstatSync(join(f.claudeSkills, SWARM)));
  const manifest = readJson(f.manifest);
  assert.deepEqual(manifest.skills, ["alpha", "beta"]);
  assert.equal(manifest.optIn, undefined);
  await assertDoctorClean(f);
  assert.match((await doctor(f)).get("skills").message, /^2 skills installed/);
});

test("a default project install skips omt-swarm", async () => {
  const f = swarmFixture();
  const project = join(f.root, "project");
  writeFile(join(project, ".git", "info", "exclude"), "");
  await f.runOk(["install", "--project", "--yes"]);
  assert.ok(existsSync(join(project, ".agents", "skills", "alpha", "SKILL.md")));
  assert.ok(!existsSync(join(project, ".agents", "skills", SWARM)));
  assert.throws(() => lstatSync(join(project, ".claude", "skills", SWARM)));
  await assertDoctorClean(f, ["--project"]);
});

test("--with omt-swarm installs it and records the choice, so a later install and doctor keep it", async () => {
  const f = swarmFixture();
  await f.runOk(["install", "--with", SWARM, "--yes"]);
  assert.equal(readFileSync(join(f.agents, SWARM, "SKILL.md"), "utf8"), "---\nname: omt-swarm\n---\nSwarm v1.\n");
  assert.ok(lstatSync(join(f.claudeSkills, SWARM)).isSymbolicLink());
  const manifest = readJson(f.manifest);
  assert.deepEqual(manifest.optIn, [SWARM]);
  assert.deepEqual(manifest.skills, ["alpha", "beta", SWARM]);

  const again = await f.runOk(["install", "--yes"]);
  assert.match(again.ctx.out(), /^ {2}unchanged omt-swarm$/m);
  assert.match(again.ctx.out(), /Everything is up to date\./);
  assert.deepEqual(readJson(f.manifest).optIn, [SWARM]);
  await assertDoctorClean(f);
  assert.doesNotMatch((await doctor(f)).get("skills").message, /no longer shipped|not selected/);
});

test("--with omt-swarm in project scope installs it and records the choice in the project manifest", async () => {
  const f = swarmFixture();
  const project = join(f.root, "project");
  writeFile(join(project, ".git", "info", "exclude"), "");
  await f.runOk(["install", "--project", "--with", SWARM, "--yes"]);
  assert.ok(existsSync(join(project, ".agents", "skills", SWARM, "SKILL.md")));
  assert.deepEqual(readJson(join(project, ".omt3", "install.json")).optIn, [SWARM]);
  await assertDoctorClean(f, ["--project"]);
});

test("omt update keeps and updates an opted-in copy", async () => {
  const f = swarmFixture();
  await f.runOk(["install", "--with", SWARM, "--yes"]);
  writeSkill(f.packageRoot, SWARM, { "SKILL.md": "---\nname: omt-swarm\n---\nSwarm v2.\n" });

  const { ctx } = await f.runOk(["update", "--skills-only", "--yes"]);
  assert.match(ctx.out(), /^ {2}update {3}omt-swarm$/m);
  assert.equal(readFileSync(join(f.agents, SWARM, "SKILL.md"), "utf8"), "---\nname: omt-swarm\n---\nSwarm v2.\n");
  assert.ok(lstatSync(join(f.claudeSkills, SWARM)).isSymbolicLink());
  assert.deepEqual(readJson(f.manifest).optIn, [SWARM]);
  await assertDoctorClean(f);
});

test("omt update removes an unedited omt-swarm copy without an opt-in record, and doctor then passes", async () => {
  const f = swarmFixture();
  await f.runOk(["install", "--with", SWARM, "--yes"]);
  dropOptIn(f.manifest);

  const warned = (await doctor(f)).get("skills");
  assert.equal(warned.status, "WARN");
  assert.match(warned.message, /^opt-in, not selected: omt-swarm in .*; run omt install$/);
  assert.equal((await doctor(f)).get("links").status, "PASS");

  const { ctx } = await f.runOk(["update", "--skills-only", "--yes"]);
  assert.match(ctx.out(), /^ {2}remove {3}omt-swarm {2}\(opt-in, not selected\)$/m);
  assert.ok(!existsSync(join(f.agents, SWARM)));
  assert.throws(() => lstatSync(join(f.claudeSkills, SWARM)));
  assert.ok(existsSync(join(f.agents, "alpha", "SKILL.md")));
  const manifest = readJson(f.manifest);
  assert.deepEqual(manifest.skills, ["alpha", "beta"]);
  assert.equal(manifest.optIn, undefined);
  await assertDoctorClean(f);
});

test("an edited omt-swarm copy without an opt-in record is a conflict, and omt update keeps it", async () => {
  const f = swarmFixture();
  await f.runOk(["install", "--with", SWARM, "--yes"]);
  dropOptIn(f.manifest);
  writeFile(join(f.agents, SWARM, "SKILL.md"), "Edited swarm.\n");

  const refused = await f.run(["install", "--yes"]);
  assert.equal(refused.code, 1);
  assert.match(refused.ctx.out(), /^ {2}conflict omt-swarm {2}\(locally modified\)$/m);

  const { ctx } = await f.runOk(["update", "--skills-only", "--yes"]);
  assert.match(ctx.out(), /kept omt-swarm {2}\(locally modified; opt-in, not selected; omt install --force backs it up and removes it\)/);
  assert.equal(readFileSync(join(f.agents, SWARM, "SKILL.md"), "utf8"), "Edited swarm.\n");
  assert.ok(lstatSync(join(f.claudeSkills, SWARM)).isSymbolicLink());

  // Selecting it again makes it a bundled skill with local edits, as for any other skill.
  const selected = await f.run(["install", "--with", SWARM, "--yes"]);
  assert.equal(selected.code, 1);
  assert.match(selected.ctx.out(), /^ {2}conflict omt-swarm {2}\(locally modified\)$/m);
});

for (const [name, message] of [
  ["alpha", /--with alpha: alpha is installed by default; --with takes only an opt-in skill/],
  ["omt-nope", /--with omt-nope: unknown skill/],
] as const) {
  test(`--with ${name} exits 2 and writes nothing`, async () => {
    const f = swarmFixture();
    const before = snapshot(f.root);
    const { code, ctx } = await f.run(["install", "--with", name, "--yes"]);
    assert.equal(code, 2);
    assert.match(ctx.err(), message);
    assert.match(ctx.err(), /the opt-in skills are omt-swarm/);
    assert.deepEqual(snapshot(f.root), before);
  });
}

test("omt install --help describes --with", async () => {
  const f = swarmFixture();
  const { ctx } = await f.runOk(["install", "--help"]);
  assert.match(ctx.out(), /\[--with <skill>\]\.\.\./);
  assert.match(ctx.out(), /^ {2}--with <skill> {4}also install this opt-in skill \(omt-swarm\)/m);
});
