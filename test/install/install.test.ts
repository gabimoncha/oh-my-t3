import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { USER_STARTER_CONFIG } from "../../src/config/starter.ts";
import { MANAGED_MARKER, hashDir } from "../../src/util/fs.ts";
import { assertAllUnchanged, makeFixture, readJson, snapshot, STAMP, writeSkill } from "./fixture.ts";
import { writeFile } from "../helpers.ts";
import type { Fixture } from "./fixture.ts";

function assertNoSkillRootBackups(f: Fixture): void {
  for (const root of [f.agents, f.claudeSkills, f.gemini]) {
    if (!existsSync(root)) continue;
    for (const path of Object.keys(snapshot(root))) {
      assert.ok(!path.includes(".omt-tmp-") && !path.includes(".omt-old-"), `scratch path inside ${root}: ${path}`);
    }
  }
  for (const dir of [dirname(f.agents)]) {
    for (const path of Object.keys(snapshot(dir))) {
      assert.ok(!/\.omt-(tmp|old)-/.test(path), `leftover scratch directory ${path}`);
    }
  }
}

test("install creates managed skills, relative links, the starter config, and the manifest", async () => {
  const f = makeFixture();
  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.match(ctx.out(), /create {3}alpha/);
  assert.match(ctx.out(), /create {3}beta/);
  assert.doesNotMatch(ctx.out(), /not-a-skill/);

  for (const name of ["alpha", "beta"]) {
    const dir = join(f.agents, name);
    const marker = readJson(join(dir, MANAGED_MARKER));
    assert.equal(marker.package, "oh-my-t3code");
    assert.equal(marker.version, "0.1.0");
    assert.equal(marker.skill, name);
    assert.equal(marker.hash, await hashDir(join(f.packageRoot, "skills", name)));
    assert.equal(marker.hash, await hashDir(dir));

    const link = join(f.claudeSkills, name);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readlinkSync(link), relative(f.claudeSkills, dir));
    assert.ok(!readlinkSync(link).startsWith("/"));
    assert.equal(realpathSync(link), realpathSync(dir));
  }
  assert.equal(readFileSync(join(f.agents, "beta", "references", "notes.md"), "utf8"), "Beta notes.\n");
  assert.ok(!existsSync(join(f.agents, "not-a-skill")));
  assert.ok(!existsSync(f.gemini), "gemini is not a default target without ~/.gemini");
  assert.equal(readFileSync(join(f.configDir, "config.jsonc"), "utf8"), USER_STARTER_CONFIG);

  const manifest = readJson(f.manifest);
  assert.equal(manifest.package, "oh-my-t3code");
  assert.equal(manifest.installedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(manifest.skillsRoot, f.agents);
  assert.deepEqual(manifest.skills, ["alpha", "beta"]);
  assert.deepEqual(manifest.links, [
    { path: join(f.claudeSkills, "alpha"), target: relative(f.claudeSkills, join(f.agents, "alpha")) },
    { path: join(f.claudeSkills, "beta"), target: relative(f.claudeSkills, join(f.agents, "beta")) },
  ]);
  assert.deepEqual(manifest.config, { path: join(f.configDir, "config.jsonc"), created: true });
  assert.deepEqual(manifest.hooks, []);
  assert.ok(!existsSync(f.backups));
  assertNoSkillRootBackups(f);
  assert.match(ctx.out(), /Restart agent sessions/);
  assert.match(ctx.out(), /\$omt-ulw <task>/);
});

test("a second install shows only unchanged and writes nothing but the manifest timestamp", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes", "--hooks"]);
  const before = snapshot(f.home);
  const { ctx } = await f.runOk(["install", "--yes", "--hooks"], {
    now: () => new Date("2026-02-03T04:05:06.000Z"),
  });
  assertAllUnchanged(ctx.out());
  const after = snapshot(f.home);
  const manifestKey = relative(f.home, f.manifest);
  const changed = Object.keys({ ...before, ...after }).filter((key) => before[key] !== after[key]);
  assert.deepEqual(changed, [manifestKey]);
  const manifest = readJson(f.manifest);
  assert.equal(manifest.installedAt, "2026-02-03T04:05:06.000Z");
  assert.deepEqual(manifest.config, { path: join(f.configDir, "config.jsonc"), created: true });
});

test("a changed bundled skill is an update", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  writeSkill(f.packageRoot, "alpha", { "SKILL.md": "---\nname: alpha\n---\nAlpha v2.\n" });
  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.match(ctx.out(), /update {3}alpha/);
  assert.match(ctx.out(), /unchanged beta/);
  assert.equal(readFileSync(join(f.agents, "alpha", "SKILL.md"), "utf8"), "---\nname: alpha\n---\nAlpha v2.\n");
  assert.equal(readJson(join(f.agents, "alpha", MANAGED_MARKER)).hash, await hashDir(join(f.agents, "alpha")));
  assert.ok(!existsSync(f.backups));
  assertNoSkillRootBackups(f);
});

test("an unmanaged skill directory is a conflict, and nothing is written without --force", async () => {
  const f = makeFixture();
  mkdirSync(join(f.agents, "alpha"), { recursive: true });
  writeFileSync(join(f.agents, "alpha", "SKILL.md"), "user skill\n");
  const before = snapshot(f.home);
  const { code, ctx } = await f.run(["install", "--yes"]);
  assert.equal(code, 1);
  assert.match(ctx.out(), /conflict alpha {2}\(exists and is not managed by omt\)/);
  assert.match(ctx.err(), /--force/);
  assert.deepEqual(snapshot(f.home), before);
});

test("--force backs up a conflicting skill outside the skill roots, then installs", async () => {
  const f = makeFixture();
  mkdirSync(join(f.agents, "alpha"), { recursive: true });
  writeFileSync(join(f.agents, "alpha", "SKILL.md"), "user skill\n");
  const { ctx } = await f.runOk(["install", "--yes", "--force"]);
  assert.match(ctx.out(), /replace {2}alpha/);
  const backup = join(f.backups, STAMP, "agents", "alpha");
  assert.equal(readFileSync(join(backup, "SKILL.md"), "utf8"), "user skill\n");
  assert.ok(existsSync(join(f.agents, "alpha", MANAGED_MARKER)));
  assert.deepEqual(readJson(f.manifest).backups, [backup]);
  assertNoSkillRootBackups(f);
});

test("a locally modified managed skill is a conflict; --force backs it up", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  writeFileSync(join(f.agents, "beta", "references", "notes.md"), "my edit\n");
  const before = snapshot(f.home);
  const refused = await f.run(["install", "--yes"]);
  assert.equal(refused.code, 1);
  assert.match(refused.ctx.out(), /conflict beta {2}\(locally modified\)/);
  assert.deepEqual(snapshot(f.home), before);

  await f.runOk(["install", "--yes", "--force"]);
  assert.equal(readFileSync(join(f.backups, STAMP, "agents", "beta", "references", "notes.md"), "utf8"), "my edit\n");
  assert.equal(readFileSync(join(f.agents, "beta", "references", "notes.md"), "utf8"), "Beta notes.\n");
  assertNoSkillRootBackups(f);
});

test("a conflicting link is reported and --force backs it up under the root name", async () => {
  const f = makeFixture();
  mkdirSync(join(f.claudeSkills, "alpha"), { recursive: true });
  writeFileSync(join(f.claudeSkills, "alpha", "SKILL.md"), "user claude skill\n");
  mkdirSync(join(f.root, "elsewhere"), { recursive: true });
  symlinkSync(join(f.root, "elsewhere"), join(f.claudeSkills, "beta"));
  const refused = await f.run(["install", "--yes"]);
  assert.equal(refused.code, 1);
  assert.match(refused.ctx.out(), /conflict .*alpha .*\(exists and is not a symlink\)/);
  assert.match(refused.ctx.out(), /conflict .*beta .*\(symlink points elsewhere\)/);

  await f.runOk(["install", "--yes", "--force"]);
  assert.equal(readFileSync(join(f.backups, STAMP, "claude", "alpha", "SKILL.md"), "utf8"), "user claude skill\n");
  assert.ok(lstatSync(join(f.backups, STAMP, "claude", "beta")).isSymbolicLink());
  assert.equal(realpathSync(join(f.claudeSkills, "alpha")), realpathSync(join(f.agents, "alpha")));
  assert.equal(realpathSync(join(f.claudeSkills, "beta")), realpathSync(join(f.agents, "beta")));
  assert.ok(existsSync(join(f.root, "elsewhere")));
});

test("--dry-run prints the plan and writes nothing", async () => {
  const f = makeFixture();
  const before = snapshot(f.home);
  const { ctx } = await f.runOk(["install", "--dry-run", "--hooks"]);
  assert.match(ctx.out(), /create {3}alpha/);
  assert.match(ctx.out(), /Dry run/);
  assert.deepEqual(snapshot(f.home), before);
});

test("a declined prompt writes nothing; an accepted prompt applies", async () => {
  const f = makeFixture();
  const before = snapshot(f.home);
  for (const answer of ["", "n", "no", "nope"]) {
    const { code, ctx } = await f.run(["install"], { isTTY: true, answer });
    assert.equal(code, 1);
    assert.deepEqual(ctx.prompts, ["Apply this plan? [y/N] "]);
    assert.deepEqual(snapshot(f.home), before);
  }
  await f.runOk(["install"], { isTTY: true, answer: "Yes" });
  assert.ok(existsSync(join(f.agents, "alpha", MANAGED_MARKER)));
});

test("without a TTY and without --yes, install refuses and writes nothing", async () => {
  const f = makeFixture();
  const before = snapshot(f.home);
  const { code, ctx } = await f.run(["install"], { isTTY: false });
  assert.equal(code, 1);
  assert.match(ctx.err(), /Re-run with --yes to apply\./);
  assert.deepEqual(ctx.prompts, []);
  assert.deepEqual(snapshot(f.home), before);
});

test("a link root that is the same directory as the agents root gets no links", async () => {
  const f = makeFixture();
  mkdirSync(f.agents, { recursive: true });
  mkdirSync(dirname(f.claudeSkills), { recursive: true });
  symlinkSync(f.agents, f.claudeSkills);
  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.match(ctx.out(), /skip .*same directory as the agents root/);
  assert.ok(lstatSync(join(f.agents, "alpha")).isDirectory());
  assert.ok(!lstatSync(join(f.agents, "alpha")).isSymbolicLink());
  assert.deepEqual(readJson(f.manifest).links, []);
});

test("a dangling link root that points at the missing agents root gets no links", async () => {
  const f = makeFixture();
  mkdirSync(dirname(f.claudeSkills), { recursive: true });
  symlinkSync(f.agents, f.claudeSkills);
  const { ctx } = await f.runOk(["install", "--yes"]);
  assert.match(ctx.out(), /skip /);
  assert.ok(existsSync(join(f.agents, "alpha", MANAGED_MARKER)));
});

test("gemini is a default target when ~/.gemini exists, and --targets selects roots", async () => {
  const f = makeFixture();
  mkdirSync(join(f.home, ".gemini"));
  const dry = await f.run(["install", "--dry-run"]);
  assert.match(dry.ctx.out(), new RegExp(`create .*${join(".gemini", "config", "skills", "alpha")}`));

  await f.runOk(["install", "--yes", "--targets", "agents"]);
  assert.ok(existsSync(join(f.agents, "alpha")));
  assert.ok(!existsSync(f.claudeSkills));
  assert.ok(!existsSync(f.gemini));

  await f.runOk(["install", "--yes", "--targets", "gemini"]);
  assert.equal(realpathSync(join(f.gemini, "alpha")), realpathSync(join(f.agents, "alpha")));
  assert.ok(!existsSync(f.claudeSkills));

  const bad = await f.run(["install", "--targets", "agents,cursor"]);
  assert.equal(bad.code, 2);
  assert.match(bad.ctx.err(), /unknown target "cursor"/);
});

test("unknown flags and positionals are usage errors", async () => {
  const f = makeFixture();
  assert.equal((await f.run(["install", "--nope"])).code, 2);
  assert.equal((await f.run(["install", "extra"])).code, 2);
  assert.equal((await f.run(["uninstall", "--nope"])).code, 2);
});

test("--hooks adds the entry and keeps every other setting", async () => {
  const f = makeFixture();
  const original = {
    model: "opus",
    permissions: { allow: ["Bash(ls)"] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo mine" }] }],
    },
  };
  const originalText = `${JSON.stringify(original, null, 4)}\n`;
  writeFile(f.settings, originalText);
  const { ctx } = await f.runOk(["install", "--yes", "--hooks"]);
  assert.match(ctx.out(), /create {3}Claude UserPromptSubmit/);
  const command = `"${process.execPath}" "${ctx.cliPath}" hook user-prompt-submit # oh-my-t3code`;
  const text = readFileSync(f.settings, "utf8");
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(JSON.parse(text), {
    ...original,
    hooks: {
      ...original.hooks,
      UserPromptSubmit: [
        { hooks: [{ type: "command", command: "echo mine" }] },
        { hooks: [{ type: "command", command, timeout: 10 }] },
      ],
    },
  });
  assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 4)}\n`, "the edit keeps the file's 4-space indentation");
  const backup = join(f.backups, STAMP, "claude-settings.json");
  assert.equal(readFileSync(backup, "utf8"), originalText);
  const manifest = readJson(f.manifest);
  assert.deepEqual(manifest.hooks, [{ kind: "claude-user-prompt-submit", settingsPath: f.settings, command, backup }]);
  assert.deepEqual(manifest.backups, [backup]);
});

test("--hooks creates settings.json when it is missing, without a backup", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes", "--hooks"]);
  const settings = readJson(f.settings) as { hooks: { UserPromptSubmit: unknown[] } };
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  assert.ok(!existsSync(f.backups));
});

test("--hooks updates the command of an existing managed entry", async () => {
  const f = makeFixture();
  const old = '"/old/node" "/old/cli.js" hook user-prompt-submit # oh-my-t3code';
  writeFile(
    f.settings,
    JSON.stringify({
      theme: "dark",
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: old, timeout: 10 }] }] },
    }),
  );
  const { ctx } = await f.runOk(["install", "--yes", "--hooks"]);
  assert.match(ctx.out(), /update {3}Claude UserPromptSubmit/);
  const settings = readJson(f.settings) as { theme: string; hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] } };
  assert.equal(settings.theme, "dark");
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  assert.equal(
    settings.hooks.UserPromptSubmit[0]?.hooks[0]?.command,
    `"${process.execPath}" "${ctx.cliPath}" hook user-prompt-submit # oh-my-t3code`,
  );
});

test("an unchanged hook writes nothing to settings.json and makes no backup", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes", "--hooks"]);
  const before = snapshot(dirname(f.settings));
  const { ctx } = await f.runOk(["install", "--yes", "--hooks"], { now: () => new Date("2026-03-01T00:00:00Z") });
  assert.match(ctx.out(), /unchanged Claude UserPromptSubmit/);
  assert.deepEqual(snapshot(dirname(f.settings)), before);
  assert.ok(!existsSync(f.backups));
});

test("a symlinked settings.json stays a symlink and its real file is updated", async () => {
  const f = makeFixture();
  const real = join(f.root, "dotfiles", "claude-settings.json");
  mkdirSync(dirname(real), { recursive: true });
  writeFileSync(real, '{ "theme": "light" }\n');
  mkdirSync(dirname(f.settings), { recursive: true });
  symlinkSync(relative(dirname(f.settings), real), f.settings);
  await f.runOk(["install", "--yes", "--hooks"]);
  assert.ok(lstatSync(f.settings).isSymbolicLink());
  assert.equal(realpathSync(f.settings), realpathSync(real));
  const settings = readJson(real) as { theme: string; hooks: unknown };
  assert.equal(settings.theme, "light");
  assert.ok(settings.hooks !== undefined);

  await f.runOk(["uninstall", "--yes"]);
  assert.ok(lstatSync(f.settings).isSymbolicLink());
  assert.deepEqual(readJson(real), { theme: "light" });
});

test("settings.json that is not valid JSON is an error and nothing changes", async () => {
  const f = makeFixture();
  writeFile(f.settings, "{ not json");
  const before = snapshot(f.home);
  const { code, ctx } = await f.run(["install", "--yes", "--hooks"]);
  assert.equal(code, 1);
  assert.match(ctx.err(), /not valid JSON/);
  assert.deepEqual(snapshot(f.home), before);
});

test("--hooks is refused for a temp or npx cliPath", async () => {
  const f = makeFixture();
  const before = snapshot(f.home);
  for (const cliPath of [join(tmpdir(), "omt-x", "cli.js"), "/home/u/.npm/_npx/abc/node_modules/oh-my-t3code/dist/cli.js"]) {
    const { code, ctx } = await f.run(["install", "--yes", "--hooks"], { cliPath });
    assert.equal(code, 1);
    assert.match(ctx.err(), /refusing the user install: the omt CLI runs from (a temporary path|a one-shot npx cache)/);
    assert.match(
      ctx.err(),
      /hint: install omt with one of: npm i -g oh-my-t3, pnpm add -g oh-my-t3, bun add -g oh-my-t3, mise use -g github:gabimoncha\/oh-my-t3; .*npx oh-my-t3 install --project/,
    );
  }
  assert.deepEqual(snapshot(f.home), before);
});

test("--hooks keeps the mode of a 0600 settings.json and writes the backup as 0600", async () => {
  const f = makeFixture();
  writeFile(f.settings, '{ "env": { "API_KEY": "secret" } }\n');
  chmodSync(f.settings, 0o600);
  await f.runOk(["install", "--yes", "--hooks"]);
  assert.equal(statSync(f.settings).mode & 0o777, 0o600);
  assert.equal(statSync(join(f.backups, STAMP, "claude-settings.json")).mode & 0o777, 0o600);
});

// Root ignores directory permissions.
test.skipIf(process.getuid?.() === 0)("a failed skill swap removes the temp copy and leaves the installed skill in place", async () => {
  const f = makeFixture();
  await f.runOk(["install", "--yes"]);
  const before = readFileSync(join(f.agents, "alpha", "SKILL.md"), "utf8");
  writeSkill(f.packageRoot, "alpha", { "SKILL.md": "---\nname: alpha\n---\nAlpha v2.\n" });
  chmodSync(f.agents, 0o555);
  let result;
  try {
    result = await f.run(["install", "--yes"]);
  } finally {
    chmodSync(f.agents, 0o755);
  }
  assert.equal(result.code, 1);
  assert.match(result.ctx.err(), /EACCES|permission denied/i);
  assert.equal(readFileSync(join(f.agents, "alpha", "SKILL.md"), "utf8"), before);
  assertNoSkillRootBackups(f);
});
