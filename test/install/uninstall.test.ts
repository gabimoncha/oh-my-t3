import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { writeFile } from "../helpers.ts";
import { makeFixture, readJson, recordOldHook, snapshot, STAMP, withOldHook } from "./fixture.ts";
import type { Fixture } from "./fixture.ts";

// What an install of an earlier release with --hooks left: the omt entry in the settings file, the manifest
// record, and the install-time backup of the file as it was before, when there was one.
async function installWithOldHook(f: Fixture, before: string | undefined, settingsPath = f.settings): Promise<void> {
  await f.runOk(["install", "--yes"]);
  const backup = before === undefined ? undefined : join(f.backups, "20251201000000", "claude-settings.json");
  if (backup !== undefined && before !== undefined) writeFile(backup, before);
  const settings = before === undefined ? {} : JSON.parse(before) as Record<string, unknown>;
  writeFileSync(settingsPath, `${JSON.stringify(withOldHook(settings), null, 2)}\n`);
  recordOldHook(f, f.settings, backup === undefined ? { created: true } : { backup });
}

test("uninstall removes only managed paths and keeps the user config", async () => {
  const f = makeFixture();
  const userHook = { type: "command", command: "echo mine" };
  const settingsText = JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [userHook] }] } }, null, 2);
  writeFile(f.settings, settingsText);
  await installWithOldHook(f, settingsText);

  // Paths that omt does not manage.
  mkdirSync(join(f.agents, "user-skill"), { recursive: true });
  writeFileSync(join(f.agents, "user-skill", "SKILL.md"), "mine\n");
  symlinkSync(join(f.agents, "user-skill"), join(f.claudeSkills, "user-skill"));
  mkdirSync(join(f.claudeSkills, "real-dir"));
  writeFileSync(join(f.agents, "README.md"), "notes\n");

  const { ctx } = await f.runOk(["uninstall", "--yes"], { now: () => new Date("2026-01-02T03:04:06.000Z") });
  assert.match(ctx.out(), /remove {3}.*alpha/);

  assert.deepEqual(readdirSync(f.agents).sort(), ["README.md", "user-skill"]);
  assert.deepEqual(readdirSync(f.claudeSkills).sort(), ["real-dir", "user-skill"]);
  assert.ok(lstatSync(join(f.claudeSkills, "user-skill")).isSymbolicLink());
  assert.equal(readFileSync(f.settings, "utf8"), settingsText, "the install-time backup is written back byte for byte");
  assert.ok(existsSync(join(f.configDir, "config.jsonc")));
  assert.ok(!existsSync(f.manifest));
  assert.ok(!existsSync(f.backups), "the restored backup, its stamp directory, and the empty backups directory are gone");
  for (const name of readdirSync(dirname(f.agents))) assert.doesNotMatch(name, /\.omt-(tmp|old)-/);
});

test("uninstall finds managed skills by scan when the manifest is gone", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  rmSync(f.manifest);
  await f.runOk(["uninstall", "--yes"]);
  assert.deepEqual(readdirSync(f.agents), []);
  assert.deepEqual(readdirSync(f.claudeSkills), []);
});

test("uninstall --purge removes the config and the empty config directory", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  const { ctx } = await f.runOk(["uninstall", "--yes", "--purge"]);
  assert.match(ctx.out(), /remove {3}.*config\.jsonc/);
  assert.ok(!existsSync(f.configDir));
});

test("uninstall deletes a settings.json that an earlier install --hooks created, without a backup", async () => {
  const f = makeFixture();
  await installWithOldHook(f, undefined);
  await f.runOk(["uninstall", "--yes"]);
  assert.ok(!existsSync(f.settings));
  assert.ok(!existsSync(f.backups));
});

test("uninstall keeps a created settings.json that gained other keys", async () => {
  const f = makeFixture();
  await installWithOldHook(f, undefined);
  writeFileSync(f.settings, JSON.stringify({ ...readJson(f.settings), theme: "dark" }, null, 2));
  await f.runOk(["uninstall", "--yes"]);
  assert.deepEqual(readJson(f.settings), { theme: "dark" });
  assert.ok(existsSync(join(f.backups, STAMP, "claude-settings.json")));
});

test("uninstall --purge keeps the config directory when it still holds other files", async () => {
  const f = makeFixture();
  writeFile(f.settings, '{ "theme": "dark" }\n');
  await installWithOldHook(f, '{ "theme": "dark" }\n');
  mkdirSync(join(f.configDir, "roles"));
  writeFileSync(join(f.configDir, "roles", "x.md"), "mine\n");
  await f.runOk(["uninstall", "--yes", "--purge"]);
  assert.ok(!existsSync(join(f.configDir, "config.jsonc")));
  assert.ok(existsSync(join(f.configDir, "roles", "x.md")));
  assert.ok(!existsSync(f.backups));
});

test("uninstall --dry-run, a declined prompt, and a missing --yes write nothing", async () => {
  const f = makeFixture();
  await installWithOldHook(f, undefined);
  const before = snapshot(f.home);
  const dry = await f.runOk(["uninstall", "--dry-run", "--purge"]);
  assert.match(dry.ctx.out(), /Dry run/);
  const declined = await f.run(["uninstall"], { isTTY: true, answer: "n" });
  assert.equal(declined.code, 1);
  assert.deepEqual(declined.ctx.prompts, ["Apply this plan? [y/N] "]);
  const noTty = await f.run(["uninstall"]);
  assert.equal(noTty.code, 1);
  assert.match(noTty.ctx.err(), /Re-run with --yes to apply\./);
  assert.deepEqual(snapshot(f.home), before);
});

test("uninstall with nothing installed reports nothing to remove", async () => {
  const f = makeFixture();
  const { ctx } = await f.runOk(["uninstall"]);
  assert.match(ctx.out(), /Nothing to remove/);
});

test("uninstall keeps a locally modified skill and the links that point at it", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  writeFileSync(join(f.agents, "alpha", "SKILL.md"), "my edits\n");

  const { ctx } = await f.runOk(["uninstall", "--yes"]);
  assert.match(ctx.out(), /keep {5}.*alpha {2}\(locally modified\)/);
  assert.match(ctx.out(), /add --force/);
  assert.deepEqual(readdirSync(f.agents), ["alpha"]);
  assert.equal(readFileSync(join(f.agents, "alpha", "SKILL.md"), "utf8"), "my edits\n");
  assert.deepEqual(readdirSync(f.claudeSkills), ["alpha"]);
  assert.ok(lstatSync(join(f.claudeSkills, "alpha")).isSymbolicLink());
  assert.ok(!existsSync(f.backups));
});

test("uninstall --force backs up a locally modified skill before it removes it", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  writeFileSync(join(f.agents, "alpha", "SKILL.md"), "my edits\n");

  const { ctx } = await f.runOk(["uninstall", "--yes", "--force"]);
  assert.deepEqual(readdirSync(f.agents), []);
  assert.deepEqual(readdirSync(f.claudeSkills), []);
  const backup = join(f.backups, STAMP, "agents", "alpha");
  assert.equal(readFileSync(join(backup, "SKILL.md"), "utf8"), "my edits\n");
  assert.match(ctx.out(), new RegExp(`backup {3}${backup}`));
});

test("uninstall with nothing installed lists only paths that exist", async () => {
  const f = makeFixture();
  const { ctx } = await f.runOk(["uninstall"]);
  assert.doesNotMatch(ctx.out(), /config\.jsonc|install\.json/);
  assert.match(ctx.out(), /Config:\n {2}none\n/);
});

test("hook removal through a symlinked settings.json keeps the link and the file mode", async () => {
  const f = makeFixture();
  const real = join(f.root, "dotfiles", "settings.json");
  writeFile(real, '{ "apiKey": "secret" }\n');
  chmodSync(real, 0o600);
  mkdirSync(dirname(f.settings), { recursive: true });
  symlinkSync(real, f.settings);
  await installWithOldHook(f, '{ "apiKey": "secret" }\n');
  assert.equal(statSync(real).mode & 0o777, 0o600);

  await f.runOk(["uninstall", "--yes"], { now: () => new Date("2026-01-02T03:04:06.000Z") });
  assert.ok(lstatSync(f.settings).isSymbolicLink());
  assert.equal(readFileSync(real, "utf8"), '{ "apiKey": "secret" }\n');
  assert.equal(statSync(real).mode & 0o777, 0o600);
  assert.ok(!existsSync(f.backups));

  // When the user changed the file meanwhile, the uninstall writes the edited JSON and a 0600 backup.
  await installWithOldHook(f, '{ "apiKey": "secret" }\n');
  rmSync(f.backups, { recursive: true });
  const installed = readJson(real);
  writeFileSync(real, JSON.stringify({ ...installed, theme: "light" }));
  await f.runOk(["uninstall", "--yes"], { now: () => new Date("2026-01-02T03:04:07.000Z") });
  assert.ok(lstatSync(f.settings).isSymbolicLink());
  assert.equal(readFileSync(real, "utf8"), '{"apiKey":"secret","theme":"light"}', "compact JSON stays compact");
  assert.equal(statSync(join(f.backups, "20260102030407", "claude-settings.json")).mode & 0o777, 0o600);
});
