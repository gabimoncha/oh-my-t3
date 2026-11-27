import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { RolesReport } from "../../src/types.ts";
import { LIVE_CAPS_FILE } from "../routing/shared.ts";
import { CAPS_FILE, makeProject } from "./shared.ts";

test("roles prints every role unverified with the unverified footer", async () => {
  const { code, ctx } = await makeProject().run(["roles"]);
  assert.equal(code, 0);
  const lines = ctx.out().split("\n");
  assert.match(lines[0] ?? "", /^ROLE\s+STATUS\s+TARGET\s+ACCESS\s+MODE\s+CROSS$/);
  for (const name of Object.keys(DEFAULT_CONFIG.roles)) {
    assert.ok(lines.some((line) => line.startsWith(`${name} `) && line.includes("unverified")), name);
  }
  assert.ok(ctx.out().endsWith("\nunverified: pass --capabilities <file> to check the chains against T3\n"));
  assert.equal(ctx.err(), "");
});

test("roles --capabilities verifies the chains, from a file or stdin", async () => {
  const project = makeProject();
  const fromFile = await project.run(["roles", "--capabilities", CAPS_FILE]);
  assert.equal(fromFile.code, 0);
  assert.match(fromFile.ctx.out(), /^execute\s+resolved\s+claudeAgent\/claude-opus-5-5 effort=medium fastMode=false\s+edit\s+default\s+no$/m);
  assert.ok(fromFile.ctx.out().endsWith("\nverified against orchestrator_capabilities\n"));
  const fromStdin = await project.run(["roles", "--capabilities", "-"], { stdin: readFileSync(CAPS_FILE, "utf8") });
  assert.equal(fromStdin.ctx.out(), fromFile.ctx.out());
});

test("roles --role keeps the given order, drops duplicates, and --json prints the RolesReport", async () => {
  const { code, ctx } = await makeProject().run(["roles", "--role", "review", "--role", "explore", "--role", "review", "--json"]);
  assert.equal(code, 0);
  const report = JSON.parse(ctx.out()) as RolesReport;
  assert.equal(report.version, 1);
  assert.equal(report.verified, false);
  assert.deepEqual(Object.keys(report.roles), ["review", "explore"]);
  assert.deepEqual(report.limits, DEFAULT_CONFIG.limits);
  assert.equal(report.roles.review?.interactionMode, "default");
  assert.equal(report.roles.review?.t3Role, "review");
  assert.equal(report.roles.review?.runtimeMode, "inherit");
  assert.equal(report.roles.review?.crossFamily, true);
  assert.equal(report.roles.explore?.crossFamily, false);
});

test("roles shows the CROSS column for each role", async () => {
  const { ctx } = await makeProject().run(["roles"]);
  const lines = ctx.out().split("\n");
  for (const [name, role] of Object.entries(DEFAULT_CONFIG.roles)) {
    const line = lines.find((l) => l.startsWith(`${name} `));
    assert.ok(line, name);
    assert.ok(line.endsWith(role.crossFamily === true ? "  yes" : "  no"), line);
  }
});

test("roles prints config issues to stderr and fails on an unknown role", async () => {
  const project = makeProject();
  project.projectConfig('{ "version": 1, "roles": { "ghost": null } }\n');
  const warned = await project.run(["roles", "--role", "execute"]);
  assert.equal(warned.code, 0);
  assert.match(warned.ctx.err(), /^warning .*config\.jsonc roles\.ghost: /m);

  const unknown = await project.run(["roles", "--role", "nope"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.ctx.err(), /unknown role nope; known roles: explore, /);
  assert.equal(unknown.ctx.out(), "");
});

test("roles --html shows ultrafast, fast, and off per target, and counts hidden fallbacks", async () => {
  const project = makeProject();
  project.projectConfig(`{ "version": 1, "roles": { "qa": { "fast": "ultrafast", "chain": [
    { "driver": "codex", "model": "gpt-6.2-sol", "effort": "medium" },
    { "driver": "codex", "model": "gpt-6.2-astra" },
    { "driver": "claudeAgent", "model": "claude-sonnet-5-5" }
  ] } } }\n`);
  const file = join(project.root, "out", "roles.html");
  const { code, ctx } = await project.run(["roles", "--role", "qa", "--role", "execute", "--html", file, "--capabilities", LIVE_CAPS_FILE]);
  assert.equal(code, 0, ctx.err());
  assert.equal(ctx.out(), `${file}\n`);
  const html = readFileSync(file, "utf8");
  assert.ok(html.startsWith("<!doctype html>"));
  const qa = html.split("\n").find((line) => line.includes('class="role">qa<')) ?? "";
  assert.match(qa, /gpt-6\.2-sol<\/td><td>medium<\/td><td><span class="chip ultrafast">ultrafast<\/span>.*gpt-6\.2-astra <span class="dim">\+1<\/span><\/td><td>default<\/td><td><span class="chip fast">fast/);
  assert.match(html, /profile normal · verified against T3/);
  const execute = html.split("\n").find((line) => line.includes('class="role">execute<')) ?? "";
  assert.match(execute, /claude-opus-5-5<\/td><td>medium<\/td><td><span class="chip off">off/);

  const both = await project.run(["roles", "--json", "--html", file]);
  assert.equal(both.code, 2);
});

test("roles rejects a positional argument and a missing capabilities file", async () => {
  const project = makeProject();
  assert.equal((await project.run(["roles", "extra"])).code, 2);
  const missing = await project.run(["roles", "--capabilities", "/nonexistent/caps.json"]);
  assert.equal(missing.code, 1);
  assert.match(missing.ctx.err(), /file not found/);
});
