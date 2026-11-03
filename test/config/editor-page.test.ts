import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { test } from "bun:test";
import { editorState, explainProfile } from "../../src/config/editor/api.ts";
import type { EditorState } from "../../src/config/editor/api.ts";
import { projectConfigPath, userConfigPath } from "../../src/paths.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

const script = readFileSync(new URL("../../templates/config-editor/app.js", import.meta.url), "utf8");

function page(state: EditorState) {
  const context = createContext({
    location: { pathname: "/editor/" },
    navigator: { platform: "Linux" },
    state,
  });
  runInContext(`${script.split("// ---------- global keys and start ----------")[0]}\nrender = () => {}; setState(state);`, context);
  return {
    run<T = unknown>(expression: string): T {
      return runInContext(expression, context) as T;
    },
    put(name: string, value: unknown) { context[name] = value; },
  };
}

function setup(project = '{ "version": 1, "profile": "normal" }', user?: string) {
  const ctx = fakeContext({ root: tempDir("omt-editor-page-") });
  writeFile(join(ctx.cwd, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFile(projectConfigPath(ctx.cwd), project);
  if (user) writeFile(userConfigPath(ctx.env, ctx.homedir), user);
  return ctx;
}

test("profile preview computes the actual eight preset differences without changing the saved default", async () => {
  const ctx = setup();
  const ui = page(await editorState(ctx));
  ui.put("prototype", await explainProfile(ctx, "prototype"));
  ui.run('app.explain = prototype; app.profile = "prototype"; index();');
  assert.equal(ui.run("previewDifferences().size"), 8);
  assert.equal(ui.run("app.state.selectedProfile"), "normal");
  assert.equal(ui.run("totalQueued()"), 0);
  assert.equal(ui.run('displayedLeaf(["workflow", "build", "review"]).value'), "first-round");
  assert.equal(ui.run('previewDifferences().has(pk(["roles", "review", "chain"]))'), false);
});

test("flow controls and settings share pending profile edits while QA stays in the flow", async () => {
  const ctx = setup();
  const ui = page(await editorState(ctx));
  assert.equal(ui.run('stageValue(["workflow", "build", "qa"], "off")'), true);
  assert.equal(ui.run('displayedLeaf(["workflow", "build", "qa"]).value'), "off");
  assert.equal(ui.run('queued("project", ["profiles", "normal", "workflow", "build", "qa"]).value'), "off");
  assert.equal(ui.run('stageModel("build").some(stage => stage.id === "qa")'), true);
  ui.run('stageValue(["workflow", "build", "review"], "off");');
  assert.equal(ui.run('stageModel("build").find(stage => stage.id === "review").title'), "Review");
  ui.run('stageValue(["workflow", "build", "oracle"], "off");');
  assert.equal(ui.run('stageModel("build").find(stage => stage.id === "review").title'), "Review skipped");
});

test("returning an inline value to its inherited value removes the pending edit", async () => {
  const ui = page(await editorState(setup()));
  ui.run('stageValue(["workflow", "build", "review"], "off");');
  assert.equal(ui.run("totalQueued()"), 1);
  ui.run('stageValue(["workflow", "build", "review"], "every-round");');
  assert.equal(ui.run("totalQueued()"), 0);
});

test("explicit reload keeps unsaved edits and rebases only the changed file for a new review", async () => {
  const ctx = setup('{ "version": 1, "limits": { "maxParallel": 4 } }', '{ "version": 1, "limits": { "maxParallel": 2 } }');
  const ui = page(await editorState(ctx));
  ui.run('switchEditIn("user"); stageValue(["limits", "maxParallel"], 7); switchEditIn("project"); stageValue(["limits", "maxParallel"], 8);');
  const userBase = ui.run('app.bases.user');
  writeFile(projectConfigPath(ctx.cwd), '{ "version": 1, "limits": { "maxParallel": 5 } }');
  const next = await editorState(ctx);
  ui.put("nextState", next);
  ui.run('api = async () => nextState; openReview = () => {}; app.conflict = {file: "project"};');
  await ui.run<Promise<void>>('reloadForReview("project")');
  assert.equal(ui.run("totalQueued()"), 2);
  assert.equal(ui.run("app.bases.user"), userBase);
  assert.equal(ui.run("app.bases.project"), next.files.find((file) => file.kind === "project")!.hash);
  assert.equal(ui.run("app.conflict"), null);
  assert.equal(ui.run('displayedLeaf(["limits", "maxParallel"]).value'), 8);
});

test("base edits remain shadowed by a profile until that profile is edited", async () => {
  const ctx = setup();
  const ui = page(await editorState(ctx));
  ui.put("prototype", await explainProfile(ctx, "prototype"));
  ui.run('app.explain = prototype; app.profile = "prototype"; index(); app.scope = "base";');
  ui.run('stageValue(["limits", "maxReviewRounds"], 8);');
  assert.equal(ui.run('queued("project", ["limits", "maxReviewRounds"]).value'), 8);
  assert.equal(ui.run('displayedLeaf(["limits", "maxReviewRounds"]).value'), 2);
  ui.run('app.scope = "profile"; stageValue(["limits", "maxReviewRounds"], 6);');
  assert.equal(ui.run('displayedLeaf(["limits", "maxReviewRounds"]).value'), 6);
  ui.run('unqueue("project", ["profiles", "prototype", "limits", "maxReviewRounds"]);');
  assert.equal(ui.run('displayedLeaf(["limits", "maxReviewRounds"]).value'), 2);
});

test("reset reveals the other file's staged value and keeps its queue separate", async () => {
  const ctx = setup('{ "version": 1, "limits": { "maxParallel": 4 } }', '{ "version": 1, "limits": { "maxParallel": 2 } }');
  const ui = page(await editorState(ctx));
  ui.run('switchEditIn("user"); stageValue(["limits", "maxParallel"], 7);');
  assert.equal(ui.run('displayedLeaf(["limits", "maxParallel"]).value'), 4);
  ui.run('switchEditIn("project"); stageValue(["limits", "maxParallel"], undefined, true);');
  assert.equal(ui.run('displayedLeaf(["limits", "maxParallel"]).value'), 7);
  assert.equal(ui.run('queueCount("user")'), 1);
  assert.equal(ui.run('queueCount("project")'), 1);
});

test("a failed preview retains the last report and a late response cannot replace a newer selection", async () => {
  const ctx = setup('{ "version": 1, "profile": "normal", "profiles": { "pr-heavy": { "description": "Review with two families." } } }');
  const ui = page(await editorState(ctx));
  ui.put("prototype", await explainProfile(ctx, "prototype"));
  ui.put("prHeavy", await explainProfile(ctx, "pr-heavy"));
  ui.run('api = () => Promise.reject(new Error("Cannot load profile"));');
  await ui.run<Promise<void>>('pickProfile("prototype")');
  assert.equal(ui.run("app.profile"), "normal");
  assert.equal(ui.run("app.explain.profile.name"), "normal");
  assert.equal(ui.run("app.previewError.name"), "prototype");
  ui.run('globalThis.pending = []; api = () => new Promise(resolve => pending.push(resolve));');
  const older = ui.run<Promise<void>>('pickProfile("prototype")');
  assert.equal(ui.run("canEdit()"), false);
  const newer = ui.run<Promise<void>>('pickProfile("pr-heavy")');
  ui.run('pending[1](prHeavy);');
  await newer;
  ui.run('pending[0](prototype);');
  await older;
  assert.equal(ui.run("app.profile"), "pr-heavy");
  assert.equal(ui.run("app.explain.profile.name"), "pr-heavy");
  assert.equal(ui.run("app.previewPending"), null);
});

test("profile cards list the values that a profile changes from its parent", async () => {
  const ctx = setup();
  const ui = page(await editorState(ctx));
  assert.equal(ui.run('profileChanges("normal").length > 0'), true);
  assert.equal(ui.run('profileChanges("prototype").length'), 8);
  assert.equal(ui.run('JSON.stringify(profileChanges("prototype").find(c => c.rel.join(".") === "workflow.build.review"))'),
    JSON.stringify({ rel: ["workflow", "build", "review"], value: "first-round", before: "every-round" }));
});

test("every skill names its child roles, so each role page can name its skills", async () => {
  const ctx = setup();
  const ui = page(await editorState(ctx));
  assert.equal(ui.run('JSON.stringify(skillRoles("research"))'), '["explore","research"]');
  assert.equal(ui.run('skillRoles("build").includes("execute")'), true);
  assert.equal(ui.run('Object.keys(SKILLS).filter(key => !SKILLS[key].flow).length'), 6);
});
