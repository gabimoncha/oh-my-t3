import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { RESULT_KINDS } from "../../src/types.ts";
import { SKILLS_DIR } from "./shared.ts";

test("a persona file exists for every default role and for custom roles", () => {
  const rolesDir = join(SKILLS_DIR, "omt", "references", "roles");
  for (const role of [...Object.keys(DEFAULT_CONFIG.roles), "_generic"]) {
    assert.ok(existsSync(join(rolesDir, `${role}.md`)), `missing roles/${role}.md`);
  }
});

test("a contract file holding one text block exists for every result kind", () => {
  const resultsDir = join(SKILLS_DIR, "omt", "references", "results");
  for (const kind of RESULT_KINDS) {
    const text = readFileSync(join(resultsDir, `${kind}.md`), "utf8").trim();
    assert.match(text, /^```text\n[\s\S]+\n```$/, `results/${kind}.md`);
    assert.equal(text.split("```").length, 3, `results/${kind}.md has one fenced block`);
  }
});

test("the retired verify, quick, and deep personas are gone (personas)", () => {
  for (const role of ["verify", "quick", "deep", "test"]) {
    assert.equal(existsSync(join(SKILLS_DIR, "omt", "references", "roles", `${role}.md`)), false, role);
  }
});
