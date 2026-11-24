import { test } from "bun:test";
import assert from "node:assert/strict";
import { parseJsonc, setJsoncValue } from "../../src/config/jsonc.ts";
import { OmtError } from "../../src/util/errors.ts";

function check(
  input: string,
  path: readonly string[],
  value: unknown,
  expected: unknown,
  text: string,
  removedComments: readonly string[] = [],
): void {
  const result = setJsoncValue(input, path, value);
  assert.equal(result, text, "exact output text");
  assert.deepEqual(parseJsonc(result, "result.jsonc"), expected, "parsed result");
  const tokens = /"(?:[^"\\\n]|\\.)*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g;
  for (const [token] of input.matchAll(tokens)) {
    if (token.startsWith('"') || removedComments.includes(token)) continue;
    assert.ok(result.includes(token), `comment kept: ${token}`);
  }
  for (const comment of removedComments) {
    assert.ok(!result.includes(comment), `comment removed with its value: ${comment}`);
  }
}

test("nested set keeps line and block comments and treats arrays as leaves", () => {
  const input = `// head
{
  /* block
     over lines */
  "profiles": {
    "prototype": { // profile
      "limits": { "maxReviewRounds": /* before */ 2 /* after */ },
    },
  },
}
`;
  check(input, ["profiles", "prototype", "limits", "maxReviewRounds"], 3,
    { profiles: { prototype: { limits: { maxReviewRounds: 3 } } } }, input.replace("2 /* after */", "3 /* after */"));
  for (const leaf of ["null", "false", '"old"', '["old", /* inside */ "value"]']) {
    check(`{ "roles": { "execute": ${leaf} } }`, ["roles", "execute", "fast"], true,
      { roles: { execute: { fast: true } } }, '{ "roles": { "execute": {"fast":true} } }',
      leaf.includes("/* inside */") ? ["/* inside */"] : []);
  }
  check('{ "chain": [/* replaced */ 1], "url": "https://host/*text*/" }', ["chain"], [2, 3],
    { chain: [2, 3], url: "https://host/*text*/" }, '{ "chain": [2,3], "url": "https://host/*text*/" }', ["/* replaced */"]);
  check('{ "a": [1, 2] }', ["a", "0"], 9, { a: { "0": 9 } }, '{ "a": {"0":9} }');
});

test("nested insert keeps sibling indentation, commas, and property comments", () => {
  for (const comma of ["", ","]) {
    for (const comment of ["// keep", "/* keep */"]) {
      check(`{\n  "limits": {\n      "a": 1${comma} ${comment}\n  }\n}\n`, ["limits", "b"], 2,
        { limits: { a: 1, b: 2 } },
        `{\n  "limits": {\n      "a": 1, ${comment}\n      "b": 2${comma}\n  }\n}\n`);
    }
  }
  check('{ "a": {"b": 1} }', ["a", "c"], 2, { a: { b: 1, c: 2 } }, '{ "a": {"b": 1, "c": 2} }');
  check('{\n  "a": {\n    "b": 1 /* multi\n      line */\n  }\n}', ["a", "c"], 2,
    { a: { b: 1, c: 2 } }, '{\n  "a": {\n    "b": 1, "c": 2 /* multi\n      line */\n  }\n}');
});

test("empty objects become multiline and insert after their comments", () => {
  check('{\n  "roles": {}\n}\n', ["roles", "execute"], { fast: true },
    { roles: { execute: { fast: true } } }, '{\n  "roles": {\n    "execute": {"fast":true}\n  }\n}\n');
  check('{\n  "a": { /* first */ /* last */ }\n}', ["a", "b"], 1,
    { a: { b: 1 } }, '{\n  "a": { /* first */ /* last */\n    "b": 1\n  }\n}');
  check('{\n  "a": {\n    // first\n    /* last */\n  }\n}', ["a", "b"], 1,
    { a: { b: 1 } }, '{\n  "a": {\n    // first\n    /* last */\n    "b": 1\n  }\n}');
  const tabs = '{\n\t"a": {\n\t\t"b": 1\n\t},\n\t"c": {}\n}';
  check(tabs, ["c", "d"], 2, { a: { b: 1 }, c: { d: 2 } },
    tabs.replace('"c": {}', '"c": {\n\t\t"d": 2\n\t}'));
});

test("missing parents form one nested value with top-level insertion order", () => {
  check('{\n  "version": 1,\n  "defaults": "2026-10", // pin\n  "profiles": {}\n}', ["roles", "execute", "fast"], true,
    { version: 1, defaults: "2026-10", roles: { execute: { fast: true } }, profiles: {} },
    '{\n  "version": 1,\n  "defaults": "2026-10", // pin\n  "roles": {"execute":{"fast":true}},\n  "profiles": {}\n}');
  check('{\n  "profiles": {\n    "prototype": {\n      "description": "keep"\n    }\n  }\n}',
    ["profiles", "prototype", "roles", "execute", "fast"], true,
    { profiles: { prototype: { description: "keep", roles: { execute: { fast: true } } } } },
    '{\n  "profiles": {\n    "prototype": {\n      "description": "keep",\n      "roles": {"execute":{"fast":true}}\n    }\n  }\n}');
  check('{\n  "other": true\n}', ["a", "b"], 1, { a: { b: 1 }, other: true },
    '{\n  "a": {"b":1},\n  "other": true\n}');
  check("{}", ["a", "b"], 1, { a: { b: 1 } }, '{\n  "a": {"b":1}\n}');
});

test("duplicate keys on the path merge into the last member for set and remove", () => {
  const input = '{\n  "p": { "old": 1 },\n  "p": {\n    "a": { "old": 2 },\n    "a": {\n      "k": 1,\n      "k": 2, // last\n      "keep": true\n    }\n  }\n}';
  check(input, ["p", "a", "k"], 3, { p: { a: { k: 3, keep: true } } },
    '{\n  "p": {\n    "a": {\n      "k": 3, // last\n      "keep": true\n    }\n  }\n}');
  check(input, ["p", "a", "k"], undefined, { p: { a: { keep: true } } },
    '{\n  "p": {\n    "a": {\n       // last\n      "keep": true\n    }\n  }\n}');
  const cascade = '{\n  "p": {\n    "x": {\n      "limits": { "old": 2 },\n      "limits": { "k": 3 }\n    }\n  }\n}';
  check(cascade, ["p", "x", "limits", "k"], undefined, { p: {} }, '{\n  "p": {\n  }\n}');
});

test("removal keeps comments and removes the required comma and whole lines", () => {
  const input = '{\n  "a": {\n    "first": 1,\n    "middle": 2,\n    "last": 3\n  }\n}';
  check(input, ["a", "first"], undefined, { a: { middle: 2, last: 3 } }, input.replace('    "first": 1,\n', ""));
  check(input, ["a", "middle"], undefined, { a: { first: 1, last: 3 } }, input.replace('    "middle": 2,\n', ""));
  check(input, ["a", "last"], undefined, { a: { first: 1, middle: 2 } },
    '{\n  "a": {\n    "first": 1,\n    "middle": 2\n  }\n}');
  check(input.replace('"last": 3', '"last": 3,'), ["a", "last"], undefined, { a: { first: 1, middle: 2 } },
    '{\n  "a": {\n    "first": 1,\n    "middle": 2,\n  }\n}');
  check('{ "a": {"x": /* inside */ [1, /* array */ 2], /* outside */ "y": 3} }', ["a", "x"], undefined,
    { a: { y: 3 } }, '{ "a": { /* outside */ "y": 3} }', ["/* inside */", "/* array */"]);
  check('{\n  "a": {\n    "x": 1, // keep\n    "y": 2\n  }\n}', ["a", "x"], undefined, { a: { y: 2 } },
    '{\n  "a": {\n     // keep\n    "y": 2\n  }\n}');
});

test("upward removal stops at members, comments, and root keys", () => {
  const note = '{\n  "profiles": {\n    "prototype": { // note\n      "limits": { "maxReviewRounds": 3 } }\n  }\n}\n';
  check(note, ["profiles", "prototype", "limits", "maxReviewRounds"], undefined, { profiles: { prototype: {} } },
    '{\n  "profiles": {\n    "prototype": { // note\n       }\n  }\n}\n');
  check('{\n  "p": {\n    "x": {\n      "limits": {"k": 3}\n    },\n    "keep": true\n  }\n}', ["p", "x", "limits", "k"], undefined,
    { p: { keep: true } }, '{\n  "p": {\n    "keep": true\n  }\n}');
  check('{\n  "p": {\n    "x": {"k": 3}\n  }\n}', ["p", "x", "k"], undefined, { p: {} }, '{\n  "p": {\n  }\n}');
  check('{ "p": { "x": { "k": 3 /* note */ } } }', ["p", "x", "k"], undefined,
    { p: { x: {} } }, '{ "p": { "x": {  /* note */ } } }');
});

test("missing-path removal returns every byte unchanged", () => {
  const input = '\uFEFF{\r\n  // keep\r\n  "a": { "b": 1 },\r\n  "array": [1, 2],\r\n  "a": { "b": 2 }\r\n}\r\n';
  for (const path of [["missing"], ["missing", "x"], ["a", "missing"], ["a", "b", "x"], ["array", "0"]]) {
    check(input, path, undefined, { a: { b: 2 }, array: [1, 2] }, input);
  }
});

test("CRLF and a BOM survive set, insert, removal, and multiline rendering", () => {
  const input = '\uFEFF{\r\n  "a": {\r\n    "b": 1, // keep\r\n    "c": 2\r\n  }\r\n}\r\n';
  check(input, ["a", "b"], 3, { a: { b: 3, c: 2 } }, input.replace('"b": 1', '"b": 3'));
  check(input, ["a", "d"], 4, { a: { b: 1, c: 2, d: 4 } }, input.replace('"c": 2', '"c": 2,\r\n    "d": 4'));
  check(input, ["a", "c"], undefined, { a: { b: 1 } },
    '\uFEFF{\r\n  "a": {\r\n    "b": 1 // keep\r\n  }\r\n}\r\n');
  check('\uFEFF{\r\n  "a": {}\r\n}\r\n', ["a", "b"], 1, { a: { b: 1 } },
    '\uFEFF{\r\n  "a": {\r\n    "b": 1\r\n  }\r\n}\r\n');
  const long = "x".repeat(100);
  check(input, ["a", "c"], [long], { a: { b: 1, c: [long] } },
    input.replace('"c": 2', `"c": [\r\n      "${long}"\r\n    ]`));
});

test("rendering uses the 100-column boundary, the following comma, and the indent step", () => {
  const input = '{\n  "a": {\n      "k": 0,\n      "keep": true\n  }\n}';
  const prefix = '      "k": ';
  const fits = "x".repeat(100 - prefix.length - 5);
  check(input, ["a", "k"], [fits], { a: { k: [fits], keep: true } }, input.replace('"k": 0', `"k": ["${fits}"]`));
  const exceeds = fits + "x";
  check(input, ["a", "k"], [exceeds], { a: { k: [exceeds], keep: true } },
    input.replace('"k": 0', `"k": [\n          "${exceeds}"\n      ]`));
  const noComma = '{\n  "a": {\n      "k": 0\n  }\n}';
  check(noComma, ["a", "k"], [exceeds], { a: { k: [exceeds] } }, noComma.replace('"k": 0', `"k": ["${exceeds}"]`));
  const added = "y".repeat(100 - '    "k": '.length - 4);
  check('{\n  "a": {\n    "b": 1\n  }\n}', ["a", "k"], [added], { a: { b: 1, k: [added] } },
    `{\n  "a": {\n    "b": 1,\n    "k": ["${added}"]\n  }\n}`);
  check('{\n  "a": {\n    "b": 1\n  }\n}', ["a", "k"], [added + "y"], { a: { b: 1, k: [added + "y"] } },
    `{\n  "a": {\n    "b": 1,\n    "k": [\n      "${added}y"\n    ]\n  }\n}`);
});

test("invalid text, roots, and paths report the required OmtError code", () => {
  const cases: [string, readonly string[], string][] = [
    ["{ nope", ["a"], "jsonc_parse"],
    ['{"a": /* open', ["a"], "jsonc_parse"],
    ["[]", ["a"], "jsonc_edit"],
    ["null", ["a"], "jsonc_edit"],
    ["3", ["a"], "jsonc_edit"],
    ['"text"', ["a"], "jsonc_edit"],
    ["{}", [], "jsonc_edit"],
    ["{}", [""], "jsonc_edit"],
    ["{}", ["a", ""], "jsonc_edit"],
  ];
  for (const [input, path, code] of cases) {
    assert.throws(() => setJsoncValue(input, path, 1), (error: unknown) => {
      assert.ok(error instanceof OmtError);
      assert.equal(error.code, code);
      return true;
    });
  }
});

test("edits reject excessive duplicates and path depth before repeated scans", () => {
  const text = `{${'"profile":"normal",'.repeat(10_000)}"version":1}`;
  for (const value of ["prototype", undefined]) {
    assert.throws(() => setJsoncValue(text, ["profile"], value), /more than 16 duplicate keys/);
  }
  assert.throws(() => setJsoncValue("{}", Array(33).fill("x"), 1), /32 segments/);
});
