import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { loadConfig } from "../../src/config/load.ts";
import { tempDir, writeFile } from "../helpers.ts";

function setup() {
  const root = tempDir();
  const home = join(root, "home");
  const project = join(root, "project");
  const cwd = join(project, "src", "deep");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const configDir = join(root, "cfg");
  const env = { OMT_CONFIG_DIR: configDir };
  const userPath = join(configDir, "config.jsonc");
  const projectPath = join(project, ".omt3", "config.jsonc");
  const load = () => loadConfig({ cwd, env, homedir: home });
  return { userPath, projectPath, write: writeFile, load };
}

test("with no files the result is the defaults, and every source is listed", async () => {
  const { userPath, projectPath, load } = setup();
  const loaded = await load();
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(loaded.sources, [
    { kind: "defaults", present: true },
    { kind: "user", path: userPath, present: false },
    { kind: "project", path: projectPath, present: false },
  ]);
});

test("layers apply in order: defaults, then user, then project", async () => {
  const { userPath, projectPath, write, load } = setup();
  write(userPath, '// user\n{ "limits": { "maxParallel": 8, "maxDepth": 2, }, "roles": { "explore": null } }');
  write(projectPath, '{ "limits": { "maxParallel": 2 }, "roles": { "review": { "runtimeMode": "auto" } } }');
  const loaded = await load();
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(loaded.config.limits, { ...DEFAULT_CONFIG.limits, maxParallel: 2, maxDepth: 2 });
  assert.equal(loaded.config.roles.explore, undefined);
  assert.equal(loaded.config.roles.review?.runtimeMode, "auto");
  assert.deepEqual(
    loaded.sources.map((source) => source.present),
    [true, true, true],
  );
});

test("a JSONC syntax error is one error issue, and only that file is skipped", async () => {
  const { userPath, projectPath, write, load } = setup();
  write(userPath, '{ "limits": { "maxParallel": 8 } }');
  write(projectPath, '{\n  "limits": { "maxParallel": 2 }\n  "roles": {}\n}');
  const loaded = await load();
  assert.equal(loaded.config.limits.maxParallel, 8);
  assert.equal(loaded.issues.length, 1);
  const issue = loaded.issues[0];
  assert.equal(issue?.source, projectPath);
  assert.equal(issue?.path, "");
  assert.equal(issue?.severity, "error");
  assert.ok(issue?.message.startsWith("3:3: "), issue?.message);
  assert.equal(loaded.sources[2]?.present, true);
});

test("validation and merge issues carry the file path as source", async () => {
  const { userPath, write, load } = setup();
  write(userPath, '{ "version": 2, "roles": { "new-one": { "access": "edit" } }, "limits": { "maxDepth": 9 } }');
  const loaded = await load();
  assert.deepEqual(
    loaded.issues.map((issue) => [issue.source, issue.path]),
    [
      [userPath, "version"],
      [userPath, "limits.maxDepth"],
      [userPath, "roles.new-one"],
    ],
  );
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
});

test("the project config is found from a nested working directory", async () => {
  const { projectPath, write, load } = setup();
  write(projectPath, '{ "roles": { "explore": null } }');
  assert.equal((await load()).config.roles.explore, undefined);
});

test("an I/O error other than a missing file throws", async () => {
  const { userPath, load } = setup();
  mkdirSync(userPath, { recursive: true });
  await assert.rejects(load());
});
