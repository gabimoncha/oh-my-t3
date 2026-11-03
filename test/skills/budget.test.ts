import { test } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { SKILLS_DIR } from "./shared.ts";

// Word targets from plans/skill-trim.md. A file may exceed its target by 10%. A key that ends in /*.md
// is the total of the files in that folder.
const TARGETS: Record<string, number> = {
  "omt/SKILL.md": 300,
  "omt-ulw/SKILL.md": 1_800,
  "omt-plan/SKILL.md": 1_300,
  "omt-research/SKILL.md": 700,
  "omt-code-review/SKILL.md": 1_100,
  "omt-code-review/pr-extras.md": 350,
  "omt-design/SKILL.md": 700,
  "omt-setup/SKILL.md": 1_000,
  "omt-swarm/SKILL.md": 1_500,
  "omt/references/delegation.md": 1_600,
  "omt/references/roles.md": 500,
  "omt/references/brief.md": 300,
  "omt/references/results.md": 500,
  "omt/references/worktrees.md": 500,
  "omt/references/planning.md": 350,
  "omt/references/roles/*.md": 2_600,
  "omt/references/results/*.md": 240,
};
const TOTAL = 16_000;

// Strings that the trim removes from every skill outside omt-swarm, whose top-level track threads still
// use omt ledger add and t3_thread_wait.
const BANNED: RegExp[] = [
  /gh pr checks[^\n]*--watch/,
  /ready PR/,
  /omt ultrawork:/,
  /t3_thread_configuration/,
  /ledger\.dispatched/,
  /omt ledger add/,
  /shasum/,
  /t3_thread_wait/,
];

// Files not rewritten yet. Each skill unit of the trim removes its files; the last one empties the set.
const PENDING: ReadonlySet<string> = new Set([
  "omt-plan/SKILL.md",
  "omt-research/SKILL.md",
  "omt-design/SKILL.md",
  "omt-setup/SKILL.md",
  "omt-swarm/SKILL.md",
  "omt/references/roles/*.md",
  "omt/references/results/*.md",
]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

function words(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

const FILES = walk(SKILLS_DIR).map((path) => relative(SKILLS_DIR, path));

function filesOf(key: string): string[] {
  if (!key.endsWith("/*.md")) return [key];
  const dir = key.slice(0, -"*.md".length);
  return FILES.filter((file) => file.startsWith(dir) && !file.slice(dir.length).includes("/"));
}

for (const [key, target] of Object.entries(TARGETS)) {
  test.skipIf(PENDING.has(key))(`${key} has at most ${Math.round(target * 1.1)} words`, () => {
    const count = filesOf(key).reduce((sum, file) => sum + words(readFileSync(join(SKILLS_DIR, file), "utf8")), 0);
    assert.ok(count <= target * 1.1, `${key} has ${count} words; the target is ${target}`);
  });
  test.skipIf(PENDING.has(key) || key.startsWith("omt-swarm/"))(`${key} holds none of the removed bookkeeping strings`, () => {
    for (const file of filesOf(key)) {
      const text = readFileSync(join(SKILLS_DIR, file), "utf8");
      for (const pattern of BANNED) assert.doesNotMatch(text, pattern, file);
    }
  });
}

test.skipIf(PENDING.size > 0)(`all skill files together have at most ${TOTAL} words`, () => {
  const count = FILES.reduce((sum, file) => sum + words(readFileSync(join(SKILLS_DIR, file), "utf8")), 0);
  assert.ok(count <= TOTAL, `skills/ has ${count} words`);
});

test.skipIf(PENDING.size > 0)("every skill file has a word target", () => {
  const covered = new Set(Object.keys(TARGETS).flatMap(filesOf));
  assert.deepEqual(FILES.filter((file) => !covered.has(file)), []);
});
