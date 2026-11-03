import assert from "node:assert/strict";
import { readFileSync, symlinkSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { test } from "bun:test";
import type { EditorState } from "../../src/config/editor/api.ts";
import { startConfigEditor } from "../../src/config/editor/server.ts";
import type { ConfigEditor } from "../../src/config/editor/server.ts";
import { userConfigPath } from "../../src/paths.ts";
import { PACKAGE_ROOT, fakeContext, tempDir, writeFile } from "../helpers.ts";

function send(editor: ConfigEditor, route: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(editor.url);
    const req = request({
      hostname: "127.0.0.1", port: editor.port, path: `${url.pathname}${route}`, method: body === undefined ? "GET" : "POST",
      headers: { Host: url.host, Origin: url.origin, "Content-Type": "application/json" }, agent: false,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, json: text === "" ? null : JSON.parse(text) }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function setup() {
  const root = tempDir("omt-editor-maintainer-");
  const ctx = fakeContext({ root });
  // A user config that maintainer mode must ignore.
  writeFile(userConfigPath(ctx.env, ctx.homedir), '{ "version": 1, "limits": { "maxParallel": 2 } }\n');
  const clone = join(root, "clone");
  const defaultsPath = join(clone, "src", "config", "defaults.jsonc");
  writeFile(defaultsPath, readFileSync(join(PACKAGE_ROOT, "src", "config", "defaults.jsonc"), "utf8"));
  const skillsRoot = join(clone, "skills");
  writeFile(join(skillsRoot, "omt", "SKILL.md"), "---\nname: omt\ndescription: Router.\n---\n\n# omt\n");
  writeFile(join(skillsRoot, "omt", "references", "roles", "explore.md"), "# Explore\n");
  writeFile(join(skillsRoot, "omt", "agents", "openai.yaml"), "x: 1\n");
  writeFile(join(root, "outside.md"), "secret\n");
  symlinkSync(join(root, "outside.md"), join(skillsRoot, "omt", "references", "link.md"));
  return { ctx, defaultsPath, skillsRoot, root };
}

test("maintainer mode edits the built-in defaults on an empty base and ignores the user config", async () => {
  const { ctx, defaultsPath, skillsRoot } = setup();
  const editor = await startConfigEditor(ctx, { open: false, idleMs: 2_000, closeGraceMs: 100, maintainer: { defaultsPath, skillsRoot } });
  try {
    const state = (await send(editor, "api/state")).json as EditorState;
    assert.equal(state.mode, "defaults");
    assert.deepEqual(state.files.map((file) => [file.kind, file.path, file.present]), [["user", defaultsPath, true], ["project", "", false]]);
    assert.deepEqual(state.issues, []);
    assert.deepEqual(state.skills, ["omt"]);
    const maxParallel = state.explain.root.find((entry) => entry.path.join(".") === "limits.maxParallel");
    assert.equal(maxParallel?.value, 6);
    const base = state.files[0]!.hash;

    const removed = await send(editor, "api/write", { file: "user", base, edits: [{ path: ["limits", "maxDepth"], remove: true }] });
    assert.equal(removed.status, 422);
    assert.match(removed.json.newErrors[0].message, /built-in defaults must keep/);

    const project = await send(editor, "api/write", { file: "project", base, edits: [{ path: ["limits", "maxParallel"], value: 5 }] });
    assert.equal(project.status, 400);

    const written = await send(editor, "api/write", { file: "user", base, edits: [{ path: ["limits", "maxParallel"], value: 5 }] });
    assert.equal(written.status, 200);
    assert.equal(written.json.state.mode, "defaults");
    assert.match(readFileSync(defaultsPath, "utf8"), /^\/\/ The built-in omt defaults[\s\S]*"maxParallel": 5,/);
  } finally { await editor.close(); }
});

test("maintainer mode lists and saves skill files and refuses other paths", async () => {
  const { ctx, defaultsPath, skillsRoot } = setup();
  const editor = await startConfigEditor(ctx, { open: false, idleMs: 2_000, closeGraceMs: 100, maintainer: { defaultsPath, skillsRoot } });
  try {
    const listed = await send(editor, "api/skill-files?name=omt");
    assert.equal(listed.status, 200);
    const files = listed.json.files as { path: string; hash: string; text: string }[];
    // The symlink to a file outside the skill is not listed.
    assert.deepEqual(files.map((file) => file.path), ["SKILL.md", "references/roles/explore.md"]);
    const explore = files.find((file) => file.path === "references/roles/explore.md")!;

    const saved = await send(editor, "api/skill-file", { name: "omt", path: explore.path, base: explore.hash, text: "# Explore v2\n" });
    assert.equal(saved.status, 200);
    assert.equal(readFileSync(join(skillsRoot, "omt", explore.path), "utf8"), "# Explore v2\n");
    const stale = await send(editor, "api/skill-file", { name: "omt", path: explore.path, base: explore.hash, text: "# again\n" });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "skill_changed");

    const main = files.find((file) => file.path === "SKILL.md")!;
    const badName = await send(editor, "api/skill-file", { name: "omt", path: "SKILL.md", base: main.hash, text: "---\nname: other\n---\n" });
    assert.equal(badName.status, 422);

    for (const body of [
      { name: "omt", path: "../outside.md", base: "x", text: "" },
      { name: "omt", path: "agents/openai.yaml", base: "x", text: "" },
      { name: "../x", path: "SKILL.md", base: "x", text: "" },
      { name: "omt", path: "references/link.md", base: "x", text: "changed\n" },
    ]) {
      const refused = await send(editor, "api/skill-file", body);
      assert.equal(refused.status, 400, JSON.stringify(body));
    }
    assert.equal(readFileSync(join(skillsRoot, "..", "..", "outside.md"), "utf8"), "secret\n");
    const created = await send(editor, "api/skill-file", { name: "omt", path: "references/new.md", base: "x", text: "new\n" });
    assert.equal(created.status, 404);
  } finally { await editor.close(); }
});

test("without maintainer mode, the skill file routes answer 404", async () => {
  const ctx = fakeContext({ root: tempDir("omt-editor-maintainer-") });
  const editor = await startConfigEditor(ctx, { open: false, idleMs: 2_000, closeGraceMs: 100 });
  try {
    assert.equal((await send(editor, "api/skill-files?name=omt")).status, 404);
    assert.equal((await send(editor, "api/skill-file", { name: "omt", path: "SKILL.md", base: "x", text: "" })).status, 404);
    assert.equal(((await send(editor, "api/state")).json as EditorState).mode, "config");
  } finally { await editor.close(); }
});
