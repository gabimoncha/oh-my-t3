import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { PACKAGE_ROOT } from "./helpers.ts";

// T3 replays a run against the body of its workflow version, so a changed body needs a new version.
// Each entry maps the workflow versions that workflows/omt.ts defines to the hash of the file that shipped them.
const SHIPPED: Record<string, string> = {
  "omt-ulw@1 omt-code-review@1": "932ed2be4e93d5f4052c2bc5b5dc4901ea20dfe673607d35bd79c2a102c32fea",
};

test("workflows/omt.ts raises a workflow version whenever its text changes", () => {
  const text = readFileSync(join(PACKAGE_ROOT, "workflows", "omt.ts"), "utf8");
  const versions = [...text.matchAll(/\bworkflow\(\s*"([^"]+)",\s*\{\s*version:\s*(\d+)/g)].map((match) => `${match[1]}@${match[2]}`);
  const key = versions.join(" ");
  const hash = createHash("sha256").update(text).digest("hex");
  assert.ok(key in SHIPPED, `add "${key}": "${hash}" to SHIPPED after you raise the version of each changed workflow`);
  assert.equal(SHIPPED[key], hash, `workflows/omt.ts changed: raise the version of each changed workflow, then add "<versions>": "${hash}"`);
});
