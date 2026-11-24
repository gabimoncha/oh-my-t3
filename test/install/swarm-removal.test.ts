import assert from "node:assert/strict";
import { existsSync, lstatSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { doctor } from "../run.ts";
import { makeFixture, readJson, writeSkill } from "./fixture.ts";

const SWARM = "omt-swarm";

// The retired omt-swarm was opt-in: an install wrote it with --with and recorded it under optIn.
// The bundle no longer ships it, so omt update must remove an unedited copy and drop the record.
test("omt update removes an omt-swarm copy that an opt-in install wrote, and doctor then passes", async () => {
  const f = makeFixture();
  writeSkill(f.packageRoot, SWARM, { "SKILL.md": "---\nname: omt-swarm\n---\nSwarm.\n" });
  await f.runOk(["install", "--yes"]);
  const installed = readJson(f.manifest);
  writeFileSync(f.manifest, `${JSON.stringify({ ...installed, optIn: [SWARM] }, null, 2)}\n`);
  rmSync(join(f.packageRoot, "skills", SWARM), { recursive: true });

  const warned = (await doctor(f)).get("skills");
  assert.equal(warned.status, "WARN");
  assert.match(warned.message, /^no longer shipped: omt-swarm in /);

  const { ctx } = await f.runOk(["update", "--skills-only", "--yes"]);
  assert.match(ctx.out(), /^ {2}remove {3}omt-swarm {2}\(no longer shipped\)$/m);
  assert.ok(!existsSync(join(f.agents, SWARM)));
  assert.throws(() => lstatSync(join(f.claudeSkills, SWARM)));
  const manifest = readJson(f.manifest);
  assert.deepEqual(manifest.skills, ["alpha", "beta"]);
  assert.equal(manifest.optIn, undefined);
  for (const id of ["skills", "links"]) {
    const check = (await doctor(f)).get(id);
    assert.equal(check.status, "PASS", `${id}: ${check.message}`);
  }
});

test("install no longer takes --with", async () => {
  const f = makeFixture();
  const { code, ctx } = await f.run(["install", "--with", SWARM, "--yes"]);
  assert.equal(code, 2);
  assert.match(ctx.err(), /--with/);
});
