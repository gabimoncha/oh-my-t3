import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { test } from "bun:test";
import { editorState } from "../../src/config/editor/api.ts";
import { bundledSkillNames, bundledSkillText, editorCatalog } from "../../src/config/editor/catalog.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { parseCapabilities } from "../../src/routing/capabilities.ts";
import { PACKAGE_ROOT, fakeContext, tempDir } from "../helpers.ts";

const capabilities = parseCapabilities(readFileSync(new URL("../fixtures/capabilities-live.json", import.meta.url), "utf8"));

test("the editor catalog lists T3 providers, models, efforts, and fast mode from capabilities", async () => {
  const ctx = fakeContext({ root: tempDir("omt-editor-catalog-") });
  const catalog = await editorCatalog(ctx, DEFAULT_CONFIG, capabilities);
  assert.equal(catalog.source, "t3");
  const codex = catalog.providers.find((provider) => provider.driver === "codex");
  assert.ok(codex);
  const sol = codex.models.find((model) => model.id === "gpt-6.1-sol");
  assert.ok(sol);
  assert.equal(sol.fast, true);
  assert.deepEqual(sol.efforts.slice(0, 3), ["low", "medium", "high"]);
  const haiku = catalog.providers.flatMap((provider) => provider.models).find((model) => model.id === "claude-haiku-5-5");
  assert.equal(haiku?.fast, false);
});

test("the editor catalog reads the compact option form of newer T3 builds", async () => {
  const ctx = fakeContext({ root: tempDir("omt-editor-catalog-") });
  const compact = parseCapabilities(readFileSync(new URL("../fixtures/capabilities-compact.json", import.meta.url), "utf8"));
  const catalog = await editorCatalog(ctx, DEFAULT_CONFIG, compact);
  const models = catalog.providers.flatMap((provider) => provider.models);
  const sol = models.find((model) => model.id === "gpt-6.1-sol");
  assert.equal(sol?.fast, true);
  assert.deepEqual(sol?.efforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(models.find((model) => model.id === "claude-opus-5-5")?.fast, true);
  assert.equal(models.find((model) => model.id === "claude-haiku-5-5")?.fast, false);
  assert.deepEqual(models.find((model) => model.id === "opencode/beam-free")?.efforts, ["low", "medium", "high", "xhigh", "max"]);
});

test("without capabilities, the editor catalog lists both drivers with the models that the config names", async () => {
  const ctx = fakeContext({ root: tempDir("omt-editor-catalog-") });
  ctx.env.PATH = tempDir("omt-editor-empty-path-");
  const catalog = await editorCatalog(ctx, DEFAULT_CONFIG, undefined);
  assert.equal(catalog.source, "local");
  assert.deepEqual(catalog.providers.map((provider) => [provider.driver, provider.available]), [["claudeAgent", false], ["codex", false]]);
  const codex = catalog.providers.find((provider) => provider.driver === "codex");
  assert.ok(codex?.models.some((model) => model.id === "gpt-6.1-terra" && model.fast === null));
});

test("the editor reads each bundled SKILL.md and refuses other paths", async () => {
  const names = await bundledSkillNames(PACKAGE_ROOT);
  assert.ok(names.includes("omt-ulw") && names.includes("omt-research") && names.includes("omt"));
  const skill = await bundledSkillText(PACKAGE_ROOT, "omt-research");
  assert.match(skill?.text ?? "", /^---\nname: omt-research\n/);
  assert.equal(await bundledSkillText(PACKAGE_ROOT, "../package.json"), undefined);
  assert.equal(await bundledSkillText(PACKAGE_ROOT, "no-such-skill"), undefined);
});

class FakeNode {
  tagName: string;
  children: FakeNode[] = [];
  attrs: Record<string, string> = {};
  text = "";
  className = "";
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  append(...kids: (FakeNode | string)[]) {
    for (const kid of kids) {
      if (typeof kid === "string") { const node = new FakeNode("#text"); node.text = kid; this.children.push(node); } else this.children.push(kid);
    }
  }
  get lastChild(): FakeNode | null { return this.children.at(-1) ?? null; }
  set textContent(value: string) { this.text = value; }
  get textContent(): string { return this.text + this.children.map((kid) => kid.textContent).join(""); }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  addEventListener() {}
}

test("the skill markdown renders headings, lists, tables, code, and safe links without HTML", async () => {
  const ctx = fakeContext({ root: tempDir("omt-editor-md-") });
  const state = await editorState(ctx);
  const script = readFileSync(new URL("../../templates/config-editor/app.js", import.meta.url), "utf8");
  const context = createContext({ location: { pathname: "/editor/" }, navigator: { platform: "Linux" }, state,
    document: { createElement: (tag: string) => new FakeNode(tag) } });
  runInContext(`${script.split("// ---------- global keys and start ----------")[0]}\nrender = () => {}; setState(state);`, context);
  const blocks = runInContext(`renderMarkdown(${JSON.stringify([
    "# Title", "", "Text with `code`, **bold**, a [link](../omt/references/roles.md), and <b>raw</b>.", "",
    "- one", "  - nested", "- two", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "```", "<script>x</script>", "```",
    "[bad](javascript:alert(1))",
  ].join("\n"))}, "omt-ulw")`, context) as FakeNode[];
  assert.deepEqual(Array.from(blocks, (block) => block.tagName), ["H2", "P", "UL", "DIV", "PRE", "P"]);
  const link = blocks[1]!.children.find((kid) => kid.tagName === "A");
  assert.equal(link?.attrs.href, "https://github.com/gabimoncha/oh-my-t3/blob/main/skills/omt/references/roles.md");
  assert.match(blocks[1]!.textContent, /<b>raw<\/b>/);
  assert.equal(blocks[2]!.children[0]!.children.at(-1)?.tagName, "UL");
  assert.equal(blocks[4]!.textContent, "<script>x</script>");
  assert.equal(blocks[5]!.children.some((kid) => kid.tagName === "A"), false);
  assert.equal(runInContext("Object.keys(SKILLS).length", context), 10);
});
