import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childEnv, spawnOmt, tempDir, writeFile } from "../helpers.ts";

function codexOnlyMachine() {
  const root = tempDir();
  const project = join(root, "project");
  const bin = join(root, "bin");
  mkdirSync(join(project, ".git"), { recursive: true });
  const codex = join(bin, "codex");
  writeFile(codex, "#!/bin/sh\nexit 0\n");
  chmodSync(codex, 0o755);
  const env: NodeJS.ProcessEnv = { ...childEnv(root), PWD: project, PATH: bin };
  const settings = join(env.T3CODE_HOME as string, "userdata", "settings.json");
  writeFile(settings, JSON.stringify({ providerInstances: { claudeAgent: { driver: "claudeAgent", enabled: false } } }));
  const config = join(project, ".omt3", "config.jsonc");
  const cli = (args: string[]) => spawnOmt(args, { root, cwd: project, env });
  return { bin, settings, config, cli };
}

test("e2e U3: Codex-only install", () => {
  const f = codexOnlyMachine();
  const install = f.cli(["install", "--project", "--yes"]);
  assert.equal(install.code, 0, install.stderr);
  assert.equal(install.stderr, "");
  assert.match(readFileSync(f.config, "utf8"), /"harnesses"\s*:\s*\[\s*"codex"\s*\]/);

  const roles = f.cli(["roles"]);
  assert.equal(roles.code, 0, roles.stderr);
  assert.equal(roles.stderr, "");
  assert.match(roles.stdout, /^design\s+\S+\s+codex\/gpt-6-astra reasoningEffort=high/m);
  assert.match(roles.stdout, /^ui\s+\S+\s+codex\/gpt-6\.1-sol reasoningEffort=high/m);
  assert.match(roles.stdout, /^writing\s+\S+\s+codex\//m);
});

test("e2e U3: detect and write flow", () => {
  const f = codexOnlyMachine();
  writeFile(f.config, '{\n  "version": 1\n}\n');
  const detect = f.cli(["detect", "--json"]);
  assert.equal(detect.code, 0, detect.stderr);
  assert.equal(detect.stderr, "");
  const report = JSON.parse(detect.stdout) as { harnesses: { driver: string; detected: boolean }[] };
  assert.equal(report.harnesses.find((harness) => harness.driver === "claudeAgent")?.detected, false);

  const codex = f.cli(["detect", "--write", "--project", "--yes"]);
  assert.equal(codex.code, 0, codex.stderr);
  assert.equal(codex.stderr, "");
  assert.deepEqual(JSON.parse(readFileSync(f.config, "utf8")).harnesses, ["codex"]);

  writeFile(f.settings, "{}\n");
  const claude = join(f.bin, "claude");
  writeFile(claude, "#!/bin/sh\nexit 0\n");
  chmodSync(claude, 0o755);
  const both = f.cli(["detect", "--write", "--project", "--yes"]);
  assert.equal(both.code, 0, both.stderr);
  assert.equal(both.stderr, "");
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(f.config, "utf8")), "harnesses"), false);

  const roles = f.cli(["roles"]);
  assert.equal(roles.code, 0, roles.stderr);
  assert.equal(roles.stderr, "");
  assert.match(roles.stdout, /^writing\s+\S+\s+claudeAgent\//m);
});


test("detect and doctor keep Codex-only UI support with a retired defaults pin", () => {
  const f = codexOnlyMachine();
  writeFile(f.config, JSON.stringify({ harnesses: ["codex"] }));
  const latest = f.cli(["detect"]);
  assert.equal(latest.code, 0, latest.stderr);
  assert.doesNotMatch(latest.stdout, /design and ui: unavailable/);
  const latestDoctor = f.cli(["doctor"]);
  assert.doesNotMatch(latestDoctor.stdout, /design and ui.*unavailable/);

  writeFile(f.config, JSON.stringify({ defaults: "2026-12", harnesses: ["codex"] }));
  const pinned = f.cli(["detect"]);
  assert.equal(pinned.code, 0, pinned.stderr);
  assert.doesNotMatch(pinned.stdout, /design and ui: unavailable/);
  const pinnedDoctor = f.cli(["doctor"]);
  assert.doesNotMatch(pinnedDoctor.stdout, /design and ui: unavailable/);
});
