import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { isManagedCommand, parseSettings, withoutHook } from "../../src/install/claudeHook.ts";
import { backupStamp } from "../../src/install/fsops.ts";
import { mergeManifest } from "../../src/install/manifest.ts";
import type { Manifest } from "../../src/install/manifest.ts";
import { assertInstallSource } from "../../src/install/project.ts";
import { classifySkill, listBundledSkills, writeMarker } from "../../src/install/skills.ts";
import { OmtError } from "../../src/util/errors.ts";
import { hashDir } from "../../src/util/fs.ts";
import { tempDir } from "../helpers.ts";

test("assertInstallSource refuses temp paths, and one-shot caches except for a project install", () => {
  const user = (cliPath: string, tempRoot = "/tmpx") => () => assertInstallSource(cliPath, {}, "user", tempRoot);
  const project = (cliPath: string, tempRoot = "/tmpx") => assertInstallSource(cliPath, {}, "project", tempRoot);
  assert.throws(user(join(tmpdir(), "x", "cli.js"), tmpdir()), OmtError);
  assert.throws(() => project(join(tmpdir(), "x", "cli.js"), tmpdir()), OmtError);
  assert.throws(user("/opt/t/cli.js", "/opt/t"), OmtError);
  const npx = "/u/.npm/_npx/1/node_modules/oh-my-t3code/dist/cli.js";
  assert.throws(user(npx), OmtError);
  assert.equal(project(npx), "npx");
  const dlx = "/Users/u/Library/Caches/pnpm/dlx/abc123/198f-1a2b/node_modules/oh-my-t3code/src/cli.ts";
  assert.throws(user(dlx), OmtError);
  assert.equal(project(dlx), "pnpm");
  assert.throws(user("/home/u/.cache/pnpm/dlx/x/node_modules/oh-my-t3code/cli.js"), OmtError);
  assert.equal(project("/tmpx/bunx-501-omt3@0.1.0/node_modules/omt3/dist/cli.js"), "bunx");
  assert.doesNotThrow(user("/home/u/.local/share/pnpm/global/5/node_modules/oh-my-t3code/cli.js"));
  assert.doesNotThrow(user("/usr/local/lib/node_modules/oh-my-t3code/dist/cli.js"));
  assert.doesNotThrow(user("/opt/tmpx-other/cli.js", "/opt/tmpx"));
});

test("withoutHook removes only the omt entry and keeps unrelated entries", () => {
  const settings = {
    hooks: {
      UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: "echo a" }] }],
      Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
    },
  };
  const withOmt = structuredClone(settings);
  withOmt.hooks.UserPromptSubmit.push({ matcher: "", hooks: [{ type: "command", command: "x # oh-my-t3code" }] });
  assert.ok(isManagedCommand("x # oh-my-t3code"));
  assert.ok(!isManagedCommand("echo hi"));
  assert.deepEqual(withoutHook(withOmt), settings);
  assert.equal(withOmt.hooks.UserPromptSubmit.length, 2, "the input is not mutated");
  assert.deepEqual(withoutHook({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "z # oh-my-t3code" }] }] } }), {});

  const shared = { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo a" }, { type: "command", command: "z # oh-my-t3code" }] }] } };
  assert.deepEqual(withoutHook(shared), { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo a" }] }] } });
});

test("parseSettings rejects settings with the wrong shape", () => {
  assert.deepEqual(parseSettings(undefined, "s"), {});
  assert.throws(() => parseSettings("[]", "s"), /does not hold a JSON object/);
  assert.throws(() => parseSettings('{"hooks": []}', "s"), /"hooks" in s is not an object/);
  assert.throws(() => parseSettings('{"hooks": {"UserPromptSubmit": {}}}', "s"), /is not an array/);
});

test("classifySkill covers create, unchanged, update, and each conflict", async () => {
  const root = tempDir();
  const source = join(root, "source");
  const target = join(root, "target");
  mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "v1\n");
  assert.equal((await classifySkill(source, target)).action, "create");

  writeFileSync(join(root, "file"), "x");
  assert.deepEqual(await classifySkill(source, join(root, "file")), {
    action: "conflict",
    sourceHash: await hashDir(source),
    reason: "exists and is not a directory",
  });

  mkdirSync(target);
  writeFileSync(join(target, "SKILL.md"), "v1\n");
  assert.equal((await classifySkill(source, target)).reason, "exists and is not managed by omt");
  writeFileSync(join(target, ".omt-managed.json"), "{ broken");
  assert.equal((await classifySkill(source, target)).reason, "has an invalid omt marker");

  const marker = { package: "oh-my-t3code", version: "0.1.0", skill: "s", hash: await hashDir(target) };
  await writeMarker(target, marker);
  assert.equal((await classifySkill(source, target)).action, "unchanged");
  writeFileSync(join(source, "SKILL.md"), "v2\n");
  assert.equal((await classifySkill(source, target)).action, "update");
  writeFileSync(join(target, "SKILL.md"), "edited\n");
  assert.equal((await classifySkill(source, target)).reason, "locally modified");
});

test("listBundledSkills returns sorted directories that hold SKILL.md", async () => {
  const root = tempDir();
  for (const name of ["zeta", "alpha", "empty"]) mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(join(root, "skills", "zeta", "SKILL.md"), "z");
  writeFileSync(join(root, "skills", "alpha", "SKILL.md"), "a");
  writeFileSync(join(root, "skills", "file.md"), "f");
  assert.deepEqual(
    (await listBundledSkills(root)).map((skill) => skill.name),
    ["alpha", "zeta"],
  );
  assert.deepEqual(await listBundledSkills(join(root, "missing")), []);
});

test("mergeManifest unions entries and keeps config.created", () => {
  const base: Manifest = {
    package: "oh-my-t3code",
    version: "0.1.0",
    installedAt: "a",
    skillsRoot: "/s",
    skills: ["omt", "omt-ulw"],
    links: [{ path: "/c/omt", target: "../s/omt" }],
    config: { path: "/cfg", created: true },
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: "/set", command: "old" }],
    backups: ["/b1"],
  };
  const merged = mergeManifest(base, {
    ...base,
    installedAt: "b",
    skills: ["omt", "omt-plan"],
    links: [{ path: "/g/omt", target: "../s/omt" }],
    config: { path: "/cfg", created: false },
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: "/set", command: "new" }],
    backups: ["/b2"],
  });
  assert.equal(merged.installedAt, "b");
  assert.deepEqual(merged.skills, ["omt", "omt-plan", "omt-ulw"]);
  assert.deepEqual(merged.links.map((link) => link.path), ["/c/omt", "/g/omt"]);
  assert.deepEqual(merged.config, { path: "/cfg", created: true });
  assert.deepEqual(merged.hooks.map((hook) => hook.command), ["new"]);
  assert.deepEqual(merged.backups, ["/b1", "/b2"]);
});

test("backupStamp formats UTC as YYYYMMDDHHmmss", () => {
  assert.equal(backupStamp(new Date("2026-01-02T03:04:05.000Z")), "20260102030405");
});
