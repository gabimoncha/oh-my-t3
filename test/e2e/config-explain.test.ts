import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import type { ExplainReport } from "../../src/config/explain.ts";
import { spawnOmt, tempDir, writeFile } from "../helpers.ts";

test("config explain reports default, user, project, and profile sources in text and JSON", () => {
  const root = tempDir("omt-config-explain-");
  const project = join(root, "project");
  const userPath = join(root, "home", ".config", "oh-my-t3", "config.jsonc");
  const projectPath = join(project, ".omt3", "config.jsonc");
  mkdirSync(join(project, ".git"), { recursive: true });
  writeFile(userPath, JSON.stringify({
    version: 1,
    profile: "fast-proto",
    limits: { maxReviewRounds: 7 },
    profiles: {
      "fast-proto": {
        description: "Fast prototype",
        extends: "prototype",
        limits: { maxParallel: 2 },
      },
    },
  }));
  writeFile(projectPath, JSON.stringify({ version: 1, limits: { maxParallel: 4 } }));

  const options = { root, cwd: project, env: { PWD: project } };
  const text = spawnOmt(["config", "explain"], options);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stderr, "");
  const lines = text.stdout.split("\n");
  assert.ok(lines.includes(`user: ${userPath}`));
  assert.ok(lines.includes(`project: ${projectPath}`));
  assert.ok(lines.includes("defaults: current"));
  assert.ok(lines.includes("profile: fast-proto (config)"));
  const rootLines = lines.slice(lines.indexOf("root:") + 1, lines.indexOf("effective:"));
  const effectiveLines = lines.slice(lines.indexOf("effective:") + 1);
  for (const line of [
    "limits.maxDepth  1  defaults",
    "limits.maxReviewRounds  7  user",
    "limits.maxParallel  4  project",
  ]) {
    assert.ok(rootLines.includes(line), `root output must include ${line}`);
  }
  assert.ok(
    effectiveLines.includes("limits.maxParallel  2  profile fast-proto (user)"),
    "effective output must attribute maxParallel to profile fast-proto (user)",
  );

  const json = spawnOmt(["config", "explain", "--profile", "fast-proto", "--json"], options);
  assert.equal(json.code, 0, json.stderr);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout) as ExplainReport;
  assert.deepEqual(report.defaults, { source: "current" });
  assert.deepEqual(report.profile, { name: "fast-proto", source: "argument" });
  for (const [entries, path, value, source] of [
    [report.root, ["limits", "maxDepth"], 1, { kind: "defaults" }],
    [report.root, ["limits", "maxReviewRounds"], 7, { kind: "user", path: userPath }],
    [report.root, ["limits", "maxParallel"], 4, { kind: "project", path: projectPath }],
    [report.effective, ["limits", "maxParallel"], 2, {
      kind: "profile",
      profile: "fast-proto",
      declaredIn: { kind: "user", path: userPath },
    }],
  ] as const) {
    const entry = entries.find((entry) => JSON.stringify(entry.path) === JSON.stringify(path));
    assert.ok(entry, `${path.join(".")} must exist in the report`);
    assert.equal(entry.value, value, `${path.join(".")} value`);
    assert.deepEqual(entry.source, source, `${path.join(".")} source`);
  }
});
