import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { definedWorkflows } from "../../src/install/workflows.ts";
import { tempDir, writeFile } from "../helpers.ts";
import { doctor } from "../run.ts";
import { makeFixture, readJson } from "./fixture.ts";
import type { Fixture } from "./fixture.ts";

const V1 = 'workflow(\n  "omt-ulw",\n  { version: 1 },\n);\n';
const V2 = 'workflow(\n  "omt-ulw",\n  { version: 2 },\n);\n';

// A fake t3 command: `t3 workflow list --json` prints the given runs, or fails like a server with workflows off.
function fakeT3(runs: unknown[] | "off"): string {
  const dir = tempDir("omt-fake-t3-");
  const out = join(dir, "out");
  writeFile(out, runs === "off" ? "Workflows are off on this server.\n" : JSON.stringify(runs));
  const script = join(dir, "t3");
  writeFile(script, runs === "off" ? `#!/bin/sh\n/bin/cat "${out}" >&2\nexit 1\n` : `#!/bin/sh\nexec /bin/cat "${out}"\n`);
  chmodSync(script, 0o755);
  return script;
}

function fixture(): Fixture & { dir: string; file: string } {
  const f = makeFixture();
  writeFile(join(f.packageRoot, "workflows", "omt.ts"), V1);
  mkdirSync(join(f.home, ".t3"), { recursive: true });
  const dir = join(f.home, ".t3", "workflows");
  return { ...f, dir, file: join(dir, "omt.ts") };
}

test("definedWorkflows reads the workflow names of a file", () => {
  assert.deepEqual(definedWorkflows(`${V1}workflow("omt-code-review", {});\n`), ["omt-ulw", "omt-code-review"]);
});

test("a user install writes the workflow file, records it, and doctor reports whether T3 runs it", async () => {
  const f = fixture();
  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.match(ctx.out(), /^T3 workflows \(.*\/\.t3\/workflows\):\n {2}create {3}omt\.ts$/m);
  assert.equal(readFileSync(f.file, "utf8"), V1);
  assert.deepEqual((readJson(f.manifest).workflows as { path: string }[]).map((entry) => entry.path), [f.file]);

  const on = (await doctor(f, [], { env: { HOME: f.home, OMT_T3: fakeT3([]) } })).get("workflows");
  assert.equal(on.status, "PASS");
  assert.match(on.message, /omt\.ts installed in .*; T3 Workflows is on$/);
  const off = (await doctor(f, [], { env: { HOME: f.home, OMT_T3: fakeT3("off") } })).get("workflows");
  assert.equal(off.status, "INFO");
  assert.match(off.message, /T3 Workflows is off, and omt-climb needs it; turn it on in T3 Settings → Labs → Workflows/);
});

test("omt update replaces the file only when no run of its workflows is unfinished", async () => {
  const f = fixture();
  await f.runOk(["install", "--yes"]);
  writeFile(join(f.packageRoot, "workflows", "omt.ts"), V2);

  const held = await f.runOk(["update", "--skills-only", "--yes"], { env: { HOME: f.home, OMT_T3: fakeT3([{ workflow: "omt-ulw", status: "waiting" }]) } });
  assert.match(held.ctx.out(), /omt\.ts/);
  assert.equal(readFileSync(f.file, "utf8"), V1, "a file with an unfinished run stays");

  await f.runOk(["update", "--skills-only", "--yes"], { env: { HOME: f.home, OMT_T3: fakeT3([{ workflow: "omt-ulw", status: "completed" }]) } });
  assert.equal(readFileSync(f.file, "utf8"), V2);
});

test("an edited or foreign workflow file is a conflict that omt update keeps", async () => {
  const f = fixture();
  writeFile(f.file, "// mine\n");
  const refused = await f.run(["install", "--yes"]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.ctx.out(), /^ {2}conflict omt\.ts {2}\(not managed by omt\)$/m);
  assert.equal(readFileSync(f.file, "utf8"), "// mine\n");

  const forced = await f.runOk(["install", "--yes", "--force"]);
  assert.match(forced.ctx.out(), /replace +omt\.ts/);
  assert.equal(readFileSync(f.file, "utf8"), V1);

  writeFile(f.file, "// edited\n");
  writeFile(join(f.packageRoot, "workflows", "omt.ts"), V2);
  const { ctx } = await f.runOk(["update", "--skills-only", "--yes"]);
  assert.match(ctx.out(), /omt\.ts/);
  assert.equal(readFileSync(f.file, "utf8"), "// edited\n");
});

test("omt uninstall removes the workflow file, and keeps it while a run is unfinished", async () => {
  const f = fixture();
  await f.runOk(["install", "--yes"]);
  const kept = await f.runOk(["uninstall", "--yes"], { env: { HOME: f.home, OMT_T3: fakeT3([{ workflow: "omt-ulw", status: "paused" }]) } });
  assert.match(kept.ctx.out(), /keep +.*omt\.ts {2}\(1 unfinished T3 workflow runs use it/);
  assert.ok(existsSync(f.file));
  assert.ok(existsSync(f.manifest), "the manifest keeps the record of the kept file");

  await f.runOk(["uninstall", "--yes"], { env: { HOME: f.home, OMT_T3: fakeT3([]) } });
  assert.ok(!existsSync(f.file));
});

test("an install writes no workflow file without a T3 home", async () => {
  const f = makeFixture();
  writeFile(join(f.packageRoot, "workflows", "omt.ts"), V1);
  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.match(ctx.out(), /^ {2}skip {5}\(no T3 home at .*\.t3\)$/m);
  assert.ok(!existsSync(join(f.home, ".t3")));
});
