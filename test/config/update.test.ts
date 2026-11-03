import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, readConfigLayers } from "../../src/config/load.ts";
import { validateLayer } from "../../src/config/validate.ts";
import { tempDir, writeFile } from "../helpers.ts";

function setup() {
  const root = tempDir();
  const homedir = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  const configDir = join(root, "config");
  return {
    opts: { cwd, env: { OMT_CONFIG_DIR: configDir }, homedir },
    userPath: join(configDir, "config.jsonc"),
    projectPath: join(cwd, ".omt3", "config.jsonc"),
  };
}

test('user update "check" validates without issues and appears in the loaded config', async () => {
  const { opts, userPath } = setup();
  const value = { update: "check" };
  assert.deepEqual(validateLayer(value, userPath), { layer: value, issues: [] });
  writeFile(userPath, JSON.stringify(value));

  const loaded = await loadConfig(opts);
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.config.update, "check");
});

test("project update is dropped with a warning and preserves the user value", async () => {
  const { opts, userPath, projectPath } = setup();
  writeFile(userPath, JSON.stringify({ update: "check" }));
  writeFile(projectPath, JSON.stringify({ update: "apply" }));
  const issues = [{
    source: projectPath,
    path: "update",
    message: `update is read only from the user config; remove it from ${projectPath}`,
    severity: "warning",
  }];

  const layers = await readConfigLayers(opts);
  const project = layers.find((layer) => layer.kind === "project");
  assert.ok(project);
  assert.equal(Object.hasOwn(project.layer, "update"), false);
  assert.deepEqual(project.issues, issues);

  const loaded = await loadConfig(opts);
  assert.deepEqual(loaded.issues, issues);
  assert.equal(loaded.config.update, "check");
});

test("user update true is dropped with an error", async () => {
  const { opts, userPath } = setup();
  const value = { update: true };
  const issues = [{
    source: userPath,
    path: "update",
    message: 'must be "off", "check", or "apply", got true',
    severity: "error",
  }];
  assert.deepEqual(validateLayer(value, userPath), { layer: {}, issues });
  writeFile(userPath, JSON.stringify(value));

  const loaded = await loadConfig(opts);
  assert.deepEqual(loaded.issues, issues);
  assert.equal(Object.hasOwn(loaded.config, "update"), false);
});
