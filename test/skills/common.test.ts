import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { PACKAGE_ROOT } from "../helpers.ts";
import { SKILLS_DIR, readSkill } from "./shared.ts";

const USER_INVOKED = ["omt", "omt-climb", "omt-swarm"];

function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, "missing frontmatter");
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!field) continue;
    let value = (field[2] ?? "").trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    fields[field[1] ?? ""] = value;
  }
  return fields;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function skillDirs(): string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

// Links inside fenced code blocks and inline code are examples, not links.
function relativeLinks(markdown: string): string[] {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
  const links: string[] = [];
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1] ?? "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    links.push(target);
  }
  return links;
}

test("the bundled skills are all present", () => {
  assert.deepEqual(skillDirs().sort(), [
    "omt",
    "omt-climb",
    "omt-code-review",
    "omt-design",
    "omt-plan",
    "omt-research",
    "omt-setup",
    "omt-swarm",
    "omt-ulw",
  ]);
});

for (const name of skillDirs()) {
  test(`skill ${name} has valid frontmatter`, () => {
    const fields = parseFrontmatter(readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8"));
    assert.equal(fields.name, name);
    const description = fields.description ?? "";
    assert.ok(description.length >= 1 && description.length <= 1024, `description length ${description.length}`);
    if (USER_INVOKED.includes(name)) {
      assert.equal(fields["disable-model-invocation"], "true");
      const yaml = readFileSync(join(SKILLS_DIR, name, "agents", "openai.yaml"), "utf8");
      assert.match(yaml, /^policy:\s*\n\s+allow_implicit_invocation:\s*false\s*$/m);
    } else {
      assert.equal(fields["disable-model-invocation"], undefined);
    }
  });
}

// GitHub's heading anchors: lower case, punctuation removed except - and _, each space a -.
function anchors(markdown: string): Set<string> {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, "");
  const slugs = new Set<string>();
  for (const match of prose.matchAll(/^#{1,6} (.+)$/gm)) {
    slugs.add((match[1] ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-"));
  }
  return slugs;
}

function allLinks(markdown: string): string[] {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1] ?? "").filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

test("every relative Markdown link under skills/ resolves to a file", () => {
  const broken: string[] = [];
  for (const file of walk(SKILLS_DIR).filter((path) => path.endsWith(".md"))) {
    for (const link of relativeLinks(readFileSync(file, "utf8"))) {
      const pathPart = decodeURIComponent(link.split("#")[0] ?? "");
      const target = resolve(dirname(file), pathPart);
      if (!existsSync(target) || !statSync(target).isFile()) {
        broken.push(`${relative(PACKAGE_ROOT, file)}: ${link}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test("every #anchor in a skill link names a heading of its target file", () => {
  const broken: string[] = [];
  for (const file of walk(SKILLS_DIR).filter((path) => path.endsWith(".md"))) {
    for (const link of allLinks(readFileSync(file, "utf8"))) {
      const [pathPart = "", anchor] = link.split("#");
      if (anchor === undefined || anchor === "") continue;
      const target = pathPart === "" ? file : resolve(dirname(file), decodeURIComponent(pathPart));
      if (!existsSync(target) || !target.endsWith(".md")) continue;
      if (!anchors(readFileSync(target, "utf8")).has(anchor)) broken.push(`${relative(PACKAGE_ROOT, file)}: ${link}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("each numbered step of a workflow skill ends with a Done when line", () => {
  const missing: string[] = [];
  for (const name of skillDirs().filter((dir) => dir !== "omt")) {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const steps = text.split(/\n(?=### )/).slice(1).filter((step) => /^### (?:PR )?\d/.test(step));
    for (const step of steps) {
      const body = step.split(/\n(?=## )/)[0] ?? "";
      if (!/\nDone when: /.test(body)) missing.push(`${name}: ${body.split("\n")[0]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("each mode-check step calls t3_thread_configure, and no skill reads modes from orchestrator_capabilities (common)", () => {
  const modeSteps: Record<string, string> = {
    "omt-research": "### 0. ",
  };
  for (const [name, heading] of Object.entries(modeSteps)) {
    const text = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
    const start = text.indexOf(`\n${heading}`);
    assert.ok(start >= 0, `${name} has no step ${heading.trim()}`);
    const end = text.indexOf("\n### ", start + 1);
    const step = text.slice(start, end < 0 ? undefined : end);
    assert.match(step, /t3_thread_configure/, `${name} mode step`);
    assert.doesNotMatch(step, /orchestrator_capabilities/, `${name} mode step`);
  }
  const offenders: string[] = [];
  for (const file of walk(SKILLS_DIR).filter((path) => path.endsWith(".md"))) {
    for (const sentence of readFileSync(file, "utf8").split(/(?<=[.!?])\s+|\n\s*\n/)) {
      if (!sentence.includes("orchestrator_capabilities") || !sentence.includes("interactionMode")) continue;
      if (/^Do not call `orchestrator_capabilities` to read your modes\.$/.test(sentence.trim())) continue;
      offenders.push(`${relative(PACKAGE_ROOT, file)}: ${sentence.trim()}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the mode check calls t3_thread_configure with no arguments, so it cannot set the model", () => {
  const delegation = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  assert.match(delegation, /It calls `t3_thread_configure` with no arguments\./);
  assert.match(delegation, /Pass no `threadId` and no `modelSelection`, so that the call only reads\./);
  assert.match(delegation, /acp-mcp-call t3_thread_configure '\{\}'/);
  const offenders: string[] = [];
  for (const file of walk(SKILLS_DIR).filter((path) => path.endsWith(".md"))) {
    const text = readFileSync(file, "utf8");
    if (/t3_thread_configur(?!e\b)/.test(text)) offenders.push(`${relative(PACKAGE_ROOT, file)}: retired tool name`);
    for (const call of text.match(/t3_thread_configure`? with [^.]*/g) ?? []) {
      if (!call.includes("with no arguments")) offenders.push(`${relative(PACKAGE_ROOT, file)}: ${call}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the router and delegation.md say that the user's instructions win over omt defaults", () => {
  const rule = [
    /On git actions, reply style, tests, and model choice, the user's own instructions win over omt defaults\./,
    /Their message comes first, then their `AGENTS\.md` or `CLAUDE\.md`\./,
    /omt owns the workflow steps\b/,
  ];
  const delegation = readFileSync(join(SKILLS_DIR, "omt", "references", "delegation.md"), "utf8");
  const section = delegation.slice(delegation.indexOf("\n## User instructions win\n"), delegation.indexOf("\n## The CLI\n"));
  for (const line of rule) assert.match(section, line, "delegation.md");
  const router = readFileSync(join(SKILLS_DIR, "omt", "SKILL.md"), "utf8");
  for (const line of rule) assert.match(router, line, "omt/SKILL.md");
  assert.match(router, /\(references\/delegation\.md#user-instructions-win\)/);
});

test("no skill text says that review runs on the same family as execute", () => {
  const offenders = walk(SKILLS_DIR)
    .filter((path) => path.endsWith(".md"))
    .filter((path) => /same family as `execute`/i.test(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});

test("skills name the shared evidence directory, not a bare .omt3/evidence/ path (common)", () => {
  const offenders = walk(SKILLS_DIR)
    .filter((path) => path.endsWith(".md"))
    .filter((path) => readFileSync(path, "utf8").includes(".omt3/evidence"))
    .map((path) => relative(PACKAGE_ROOT, path));
  assert.deepEqual(offenders, []);
  for (const name of ["omt-research"]) {
    assert.match(readSkill(name), /`omt paths --evidence`/, name);
  }
});
