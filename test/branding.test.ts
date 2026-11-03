import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_NAME, PACKAGE_NAMES, REPOSITORY, REPOSITORY_URL } from "../src/brand.ts";
import { INSTALL_CHANNELS, INSTALL_URL } from "../src/install/project.ts";
import { PACKAGE_ROOT } from "./helpers.ts";

function read(path: string): string {
  return readFileSync(join(PACKAGE_ROOT, path), "utf8");
}

test("the primary package and all aliases publish the same CLI from the renamed repository", () => {
  const manifest = JSON.parse(read("package.json")) as { name: string; repository: string; bin: Record<string, string> };
  assert.equal(manifest.name, PACKAGE_NAME);
  assert.equal(manifest.repository, `github:${REPOSITORY}`);
  assert.deepEqual([...PACKAGE_NAMES].sort(), ["oh-my-t3", "oh-my-t3code", "omt3"].sort());
  for (const command of ["omt", ...PACKAGE_NAMES]) assert.equal(manifest.bin[command], "dist/cli.js");
  const workflow = read(".github/workflows/release.yml");
  const loops = [...workflow.matchAll(/for pkg in ([^;]+); do/g)];
  assert.equal(loops.length, 2);
  for (const loop of loops) assert.deepEqual(loop[1]?.split(" "), PACKAGE_NAMES);
  assert.equal(INSTALL_URL, `${REPOSITORY_URL}#install`);
  assert.ok(INSTALL_CHANNELS.includes(`npm i -g ${PACKAGE_NAME}`));
});

test("the README, install guide, and agent quick start teach the primary package", () => {
  for (const path of ["README.md", "docs/install.md", "docs/agents/quickstart.md"]) {
    const text = read(path);
    assert.ok(text.includes(`npm i -g ${PACKAGE_NAME}`), `${path} must teach the primary install`);
    assert.ok(text.includes(`npx ${PACKAGE_NAME}`), `${path} must teach the primary one-shot command`);
    assert.doesNotMatch(text, /(?:npm i -g|pnpm add -g|bun add -g) oh-my-t3code\b/, path);
  }
  assert.match(read("README.md"), /^# oh-my-t3$/m);
  assert.ok(read("docs/releasing.md").includes(`--repo ${REPOSITORY}`));
  assert.ok(read("site/src/site.ts").includes(`"${REPOSITORY_URL}"`));
  assert.ok(read("site/src/site.ts").includes(`"https://www.npmjs.com/package/${PACKAGE_NAME}"`));
});

test("the site rebuilds when the shared release version changes", () => {
  const filters = [...read(".github/workflows/site.yml").matchAll(/paths:\n((?:\s+- [^\n]+\n)+)/g)];
  assert.equal(filters.length, 2);
  for (const filter of filters) assert.match(filter[1] ?? "", /^\s+- "package\.json"$/m);
});

function files(dir: string): string[] {
  return readdirSync(join(PACKAGE_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test("maintained source and docs use the current repository links", () => {
  const paths = ["README.md", "AGENTS.md", "package.json", ...files("src"), ...files("skills"), ...files("docs"), ...files("site/src")];
  const oldRepository = /(?:github(?:usercontent)?\.com\/|github:)gabimoncha\/oh-my-t3code\b/;
  for (const path of paths) {
    if (!/\.(?:md|ts|tsx|json|html)$/.test(path) || path.startsWith("docs/research/") || path.startsWith("docs/design/")) continue;
    assert.doesNotMatch(read(path), oldRepository, path);
  }
});
