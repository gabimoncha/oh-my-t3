import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { main } from "../../src/main.ts";
import { manifestPath } from "../../src/paths.ts";
import { versionSkewHint } from "../../src/update/skew.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

function setup(user?: string, project?: string) {
  const root = tempDir();
  const ctx = fakeContext({ root, build: "bundle", version: "0.2.0" });
  if (user !== undefined) writeFile(manifestPath(ctx.env, ctx.homedir), user);
  if (project !== undefined) writeFile(join(ctx.cwd, ".omt3", "install.json"), project);
  return ctx;
}

const manifest = (version: string) => JSON.stringify({ package: "oh-my-t3", version });

test("skew hint: a user install of another release names the user sync command", async () => {
  assert.equal(
    await versionSkewHint(setup(manifest("0.1.0"))),
    'hint: the user skills come from omt 0.1.0, and this omt is 0.2.0; run "omt update --skills-only" to sync them\n',
  );
});

test("skew hint: a project install wins over the user install", async () => {
  assert.equal(
    await versionSkewHint(setup(manifest("0.2.0"), manifest("0.1.5"))),
    'hint: the project skills come from omt 0.1.5, and this omt is 0.2.0; run "omt update --skills-only --project" to sync them\n',
  );
  assert.equal(await versionSkewHint(setup(manifest("0.1.0"), manifest("0.2.0"))), undefined);
});

test("skew hint: none for the same release, no manifest, an unreadable manifest, or a source run", async () => {
  assert.equal(await versionSkewHint(setup(manifest("0.2.0"))), undefined);
  assert.equal(await versionSkewHint(setup()), undefined);
  assert.equal(await versionSkewHint(setup("{ not json")), undefined);
  assert.equal(await versionSkewHint(setup(undefined, JSON.stringify({ version: 2 }))), undefined);
  assert.equal(await versionSkewHint({ ...setup(manifest("0.1.0")), build: "source" }), undefined);
});

test("skew hint: agent commands print it to stderr; doctor and the hook do not", async () => {
  const roles = setup(manifest("0.1.0"));
  assert.equal(await main(["roles"], roles), 0);
  assert.match(roles.err(), /hint: the user skills come from omt 0\.1\.0, and this omt is 0\.2\.0/);
  assert.doesNotMatch(roles.out(), /hint:/);

  const hook = fakeContext({ root: tempDir(), build: "bundle", version: "0.2.0", stdin: '{"prompt":"hi"}' });
  writeFile(manifestPath(hook.env, hook.homedir), manifest("0.1.0"));
  assert.equal(await main(["hook", "user-prompt-submit"], hook), 0);
  assert.equal(hook.err(), "");

  const doctor = setup(manifest("0.1.0"));
  await main(["doctor", "--json"], doctor);
  assert.doesNotMatch(doctor.err(), /skills come from/);
});
