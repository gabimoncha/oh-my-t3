import { test } from "bun:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { validateLayer } from "../../src/config/validate.ts";

const RUNG = { driver: "codex", model: "gpt-6-astra", effort: "high" };

function paths(value: unknown): string[] {
  return validateLayer(value, "src").issues.map((issue) => issue.path);
}

test("DEFAULT_CONFIG passes validateLayer with no issues", () => {
  const { layer, issues } = validateLayer(structuredClone(DEFAULT_CONFIG), "defaults");
  assert.deepEqual(issues, []);
  assert.deepEqual(layer, DEFAULT_CONFIG);
});

test("a full valid layer is kept as given, and $schema is ignored", () => {
  const value = {
    $schema: "https://example.dev/schema.json",
    version: 1,
    roles: {
      review: { chain: [RUNG] },
      gone: null,
      custom: {
        description: "Custom role.",
        access: "edit",
        result: "test",
        t3Role: "general",
        interactionMode: "inherit",
        runtimeMode: "full-access",
        chain: [{ provider: "claude_2", model: "m", options: { thinking: true, effort: "max" } }],
      },
    },
    limits: { maxParallel: 32, maxDepth: 0, maxReviewRounds: 10 },
  };
  const { layer, issues } = validateLayer(value, "src");
  assert.deepEqual(issues, []);
  const { $schema, ...rest } = value;
  assert.equal($schema, value.$schema);
  assert.deepEqual(layer, rest);
});

test("an empty object is a valid empty layer", () => {
  assert.deepEqual(validateLayer({}, "src"), { layer: {}, issues: [] });
});

test("a root that is not an object is one error for the whole file", () => {
  for (const value of [null, [], "x", 1]) {
    const { layer, issues } = validateLayer(value, "src");
    assert.deepEqual(layer, {});
    assert.equal(issues.length, 1);
    assert.deepEqual({ ...issues[0], message: "" }, { source: "src", path: "", message: "", severity: "error" });
  }
});

test("an unknown root key is an error and is dropped", () => {
  const { layer, issues } = validateLayer({ version: 1, extra: true }, "src");
  assert.deepEqual(layer, { version: 1 });
  assert.deepEqual(
    issues.map((issue) => [issue.path, issue.severity]),
    [["extra", "error"]],
  );
});

test("$schema that is not a string is an error", () => {
  assert.deepEqual(paths({ $schema: 1 }), ["$schema"]);
});

test("version other than 1 is an error and is dropped", () => {
  const { layer, issues } = validateLayer({ version: 2 }, "src");
  assert.deepEqual(layer, {});
  assert.deepEqual(issues.map((issue) => issue.path), ["version"]);
  assert.deepEqual(paths({ version: "1" }), ["version"]);
});

test("roles and limits must be objects", () => {
  assert.deepEqual(paths({ roles: [] }), ["roles"]);
  assert.deepEqual(paths({ limits: 3 }), ["limits"]);
});

test("an invalid role name is an error and the role is dropped", () => {
  for (const name of ["Review", "1st", "-x", "a_b", "a".repeat(33)]) {
    const { layer, issues } = validateLayer({ roles: { [name]: { chain: [RUNG] } } }, "src");
    assert.deepEqual(layer.roles, {}, name);
    assert.deepEqual(issues.map((issue) => issue.path), [`roles.${name}`], name);
  }
  assert.deepEqual(paths({ roles: { ["a".repeat(32)]: null } }), []);
});

test("a role value that is not an object or null is an error", () => {
  assert.deepEqual(paths({ roles: { x: "edit" } }), ["roles.x"]);
  assert.deepEqual(paths({ roles: { x: [] } }), ["roles.x"]);
});

test("a role with one bad key is dropped as a whole, with one issue per problem", () => {
  const { layer, issues } = validateLayer(
    {
      roles: {
        review: { description: "ok", access: "write", unknown: 1, chain: [RUNG] },
        execute: { access: "edit" },
      },
    },
    "src",
  );
  assert.deepEqual(layer.roles, { execute: { access: "edit" } });
  assert.deepEqual(issues.map((issue) => issue.path), ["roles.review.access", "roles.review.unknown"]);
});

test("every role field rejects invalid values", () => {
  const cases: [string, unknown][] = [
    ["description", ""],
    ["description", "x".repeat(301)],
    ["description", 5],
    ["access", "write"],
    ["result", "done"],
    ["t3Role", "worker"],
    ["interactionMode", "auto"],
    ["runtimeMode", "yolo"],
    ["crossFamily", "yes"],
    ["crossFamily", 1],
    ["crossFamily", null],
    ["chain", []],
    ["chain", Array.from({ length: 11 }, () => RUNG)],
    ["chain", RUNG],
  ];
  for (const [key, value] of cases) {
    const { layer, issues } = validateLayer({ roles: { r: { [key]: value } } }, "src");
    assert.deepEqual(layer.roles, {}, `${key}=${JSON.stringify(value)}`);
    assert.deepEqual(issues.map((issue) => issue.path), [`roles.r.${key}`], key);
    assert.equal(issues[0]?.severity, "error");
  }
  assert.deepEqual(paths({ roles: { r: { description: "x".repeat(300), chain: Array(10).fill(RUNG) } } }), []);
});

test("crossFamily accepts only a boolean", () => {
  for (const value of [true, false]) {
    const { layer, issues } = validateLayer({ roles: { review: { crossFamily: value } } }, "src");
    assert.deepEqual(issues, []);
    assert.deepEqual(layer.roles, { review: { crossFamily: value } });
  }
  const { issues } = validateLayer({ roles: { review: { crossFamily: "true" } } }, "src");
  assert.deepEqual(
    issues.map((issue) => [issue.path, issue.message]),
    [["roles.review.crossFamily", 'must be a boolean, got "true"']],
  );
});

test("every rung rule is checked with an indexed path", () => {
  const cases: [unknown, string[]][] = [
    ["codex", ["roles.r.chain[0]"]],
    [{ model: "m" }, ["roles.r.chain[0]"]],
    [{ driver: "codex" }, ["roles.r.chain[0].model"]],
    [{ driver: "codex", model: "" }, ["roles.r.chain[0].model"]],
    [{ driver: "codex", model: "m".repeat(201) }, ["roles.r.chain[0].model"]],
    [{ driver: "9codex", model: "m" }, ["roles.r.chain[0].driver"]],
    [{ provider: "a b", model: "m" }, ["roles.r.chain[0].provider"]],
    [{ provider: "p".repeat(65), model: "m" }, ["roles.r.chain[0].provider"]],
    [{ driver: "codex", model: "m", effort: "extreme" }, ["roles.r.chain[0].effort"]],
    [{ driver: "codex", model: "m", options: [] }, ["roles.r.chain[0].options"]],
    [{ driver: "codex", model: "m", options: { a: 1 } }, ["roles.r.chain[0].options.a"]],
    [{ driver: "codex", model: "m", extra: 1 }, ["roles.r.chain[0].extra"]],
  ];
  for (const [rung, expected] of cases) {
    const { layer, issues } = validateLayer({ roles: { r: { chain: [RUNG, RUNG].map((r, i) => (i === 0 ? rung : r)) } } }, "src");
    assert.deepEqual(layer.roles, {}, JSON.stringify(rung));
    assert.deepEqual(issues.map((issue) => issue.path), expected, JSON.stringify(rung));
  }
  assert.deepEqual(paths({ roles: { r: { chain: [RUNG, { provider: "x" }] } } }), ["roles.r.chain[1].model"]);
});

test("every effort on the ladder is accepted", () => {
  for (const effort of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.deepEqual(paths({ roles: { r: { chain: [{ driver: "codex", model: "m", effort }] } } }), [], effort);
  }
});

test("an invalid limit is dropped with an error, and valid limits are kept", () => {
  const { layer, issues } = validateLayer(
    { limits: { maxParallel: 0, maxDepth: 1.5, maxReviewRounds: 2, other: 1 } },
    "src",
  );
  assert.deepEqual(layer.limits, { maxReviewRounds: 2 });
  assert.deepEqual(
    issues.map((issue) => issue.path),
    ["limits.maxParallel", "limits.maxDepth", "limits.other"],
  );
  assert.ok(issues.every((issue) => issue.severity === "error" && issue.source === "src"));
  assert.deepEqual(paths({ limits: { maxDepth: 4 } }), ["limits.maxDepth"]);
  assert.deepEqual(paths({ limits: { maxParallel: "4" } }), ["limits.maxParallel"]);
});

test("retired build keys, limits, and roles are dropped with one warning each, whatever their value", () => {
  const warning = (path: string) => ({ source: "src", path, message: `${path} is no longer used; remove it`, severity: "warning" });
  for (const value of [1, "x", null, { fast: true }, 501]) {
    const { layer, issues } = validateLayer({
      limits: { maxTasksPerRun: value, maxParallel: 2 },
      roles: { verify: value, quick: value, deep: value },
      profiles: {
        normal: { workflow: { build: { verify: value, checkpoint: value, stallMinutes: value, qa: "off" } }, limits: { maxTasksPerRun: value }, roles: { deep: value } },
      },
    }, "src");
    assert.deepEqual(layer, {
      limits: { maxParallel: 2 },
      roles: {},
      profiles: { normal: { workflow: { build: { qa: "off" } }, limits: {}, roles: {} } },
    });
    assert.deepEqual(issues, [
      "limits.maxTasksPerRun",
      "roles.verify",
      "roles.quick",
      "roles.deep",
      "profiles.normal.workflow.build.verify",
      "profiles.normal.workflow.build.checkpoint",
      "profiles.normal.workflow.build.stallMinutes",
      "profiles.normal.limits.maxTasksPerRun",
      "profiles.normal.roles.deep",
    ].map(warning));
  }
  assert.deepEqual(paths({ profiles: { normal: { workflow: { review: { verify: "off" } } } } }), []);
});

test("a root visuals key is dropped with a warning, whatever its value", () => {
  for (const value of [{ plan: false }, true, null, "x"]) {
    assert.deepEqual(validateLayer({ visuals: value, version: 1 }, "src"), {
      layer: { version: 1 },
      issues: [{ source: "src", path: "visuals", message: "visuals is no longer used; remove it", severity: "warning" }],
    });
  }
});

test("the retired grill role is dropped with a warning, and the grill result kind is an error", () => {
  const { layer, issues } = validateLayer({
    version: 1,
    roles: {
      grill: { description: "Old.", access: "read-only", chain: [{ driver: "codex", model: "m" }] },
      custom: { description: "New.", access: "read-only", result: "grill", chain: [{ driver: "codex", model: "m" }] },
    },
  }, "test");
  assert.equal(layer.roles?.grill, undefined);
  assert.ok(issues.some((issue) => issue.path === "roles.grill" && issue.severity === "warning"));
  assert.ok(issues.some((issue) => issue.path === "roles.custom.result" && issue.severity === "error" && /no longer used; use "review"/.test(issue.message)));
});
