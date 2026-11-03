import assert from "node:assert/strict";
import { test } from "bun:test";
import { parseCapabilities } from "../../src/routing/capabilities.ts";
import { OmtError } from "../../src/util/errors.ts";
import { CAPS_TEXT } from "./shared.ts";

function capsError(text: string): OmtError {
  try {
    parseCapabilities(text);
  } catch (error) {
    assert.ok(error instanceof OmtError);
    return error;
  }
  assert.fail("expected parseCapabilities to throw");
}

test("parses the fixture and keeps only the section 3 fields", () => {
  const caps = parseCapabilities(CAPS_TEXT);
  assert.equal(caps.inheritedProviderInstanceId, "claudeAgent");
  assert.equal(caps.inheritedModel, "claude-opus-5-5");
  assert.equal(caps.runtimeMode, "auto");
  assert.equal(caps.interactionMode, "default");
  assert.equal("parentThreadId" in caps, false);
  assert.equal("features" in caps, false);
  assert.deepEqual(
    caps.providers.map((p) => [p.providerInstanceId, p.canRunChildTask]),
    [
      ["codex", true],
      ["claudeAgent", true],
      ["cursor", true],
      ["pi", true],
      ["grok", false],
      ["opencode", false],
    ],
  );
  const codex = caps.providers[0];
  assert.ok(codex);
  assert.equal("canRunCrossProviderChildTask" in codex, false);
  const effort = codex.models[0]?.options[0];
  assert.deepEqual(effort?.options?.[0], { id: "low", label: "low", isDefault: true });
  assert.equal(effort !== undefined && "currentValue" in effort, false);
  assert.deepEqual(caps.providers[4]?.constraints, [
    "Provider instance is disabled.",
    "Provider executable is not installed.",
  ]);
});

test("a model without an options key gets an empty options array", () => {
  const caps = parseCapabilities(CAPS_TEXT);
  const cursor = caps.providers.find((p) => p.providerInstanceId === "cursor");
  assert.deepEqual(cursor?.models[1], { id: "default", label: "Auto", options: [] });
});

test("null optional strings become undefined", () => {
  const caps = parseCapabilities(CAPS_TEXT);
  const model = caps.providers.find((p) => p.providerInstanceId === "cursor")?.models[0];
  assert.equal(model?.id, "composer-3");
  assert.equal(model !== undefined && "label" in model, false);
  const parsed = parseCapabilities(
    JSON.stringify({
      inheritedProviderInstanceId: null,
      runtimeMode: null,
      providers: [{ providerInstanceId: "x", driverKind: "x", displayName: null, canRunChildTask: true }],
    }),
  );
  assert.deepEqual(parsed, {
    providers: [{ providerInstanceId: "x", driverKind: "x", canRunChildTask: true, constraints: [], models: [] }],
  });
});

test("missing models, constraints, and canRunChildTask get defaults", () => {
  const caps = parseCapabilities(JSON.stringify({ providers: [{ providerInstanceId: "pi", driverKind: "pi" }] }));
  assert.deepEqual(caps.providers, [
    { providerInstanceId: "pi", driverKind: "pi", canRunChildTask: false, constraints: [], models: [] },
  ]);
});

test("accepts the MCP content wrapper object", () => {
  const wrapped = JSON.stringify({ content: [{ type: "text", text: CAPS_TEXT }] });
  assert.deepEqual(parseCapabilities(wrapped), parseCapabilities(CAPS_TEXT));
});

test("accepts a bare array of content items and picks the first text item with providers", () => {
  const wrapped = JSON.stringify([
    { type: "image", data: "..." },
    { type: "text", text: "not json" },
    { type: "text", text: JSON.stringify({ note: "no providers" }) },
    { type: "text", text: CAPS_TEXT },
    { type: "text", text: JSON.stringify({ providers: [] }) },
  ]);
  assert.equal(parseCapabilities(wrapped).providers.length, 6);
});

test("accepts a trimmed file and a byte order mark", () => {
  const trimmed = {
    providers: [
      {
        providerInstanceId: "claudeAgent",
        driverKind: "claudeAgent",
        canRunChildTask: true,
        models: [{ id: "claude-opus-5-5" }],
      },
    ],
  };
  const caps = parseCapabilities("﻿" + JSON.stringify(trimmed));
  assert.deepEqual(caps.providers[0]?.models, [{ id: "claude-opus-5-5", options: [] }]);
});

test("bad input throws capabilities_parse", () => {
  for (const text of [
    "",
    "{",
    "[]",
    "42",
    JSON.stringify({ models: [] }),
    JSON.stringify({ providers: {} }),
    JSON.stringify({ content: [{ type: "text", text: "{}" }] }),
    JSON.stringify({ providers: [42] }),
    JSON.stringify({ providers: [{ driverKind: "codex" }] }),
    JSON.stringify({ providers: [{ providerInstanceId: "codex", driverKind: "codex", models: "x" }] }),
    JSON.stringify({ providers: [{ providerInstanceId: "codex", driverKind: "codex", models: [{ id: 1 }] }] }),
    JSON.stringify({ providers: [{ providerInstanceId: "codex", driverKind: "codex", constraints: [1] }] }),
    JSON.stringify({
      providers: [{ providerInstanceId: "c", driverKind: "c", models: [{ id: "m", options: [{ id: "effort" }] }] }],
    }),
  ]) {
    assert.equal(capsError(text).code, "capabilities_parse", text);
  }
});

test("reads the compact option form of newer T3 builds", async () => {
  const caps = parseCapabilities(await Bun.file(new URL("../fixtures/capabilities-compact.json", import.meta.url)).text());
  const sol = caps.providers.find((p) => p.providerInstanceId === "codex")?.models[0];
  assert.equal(sol?.id, "gpt-6.1-sol");
  assert.deepEqual(sol?.options[0], {
    id: "reasoningEffort",
    type: "select",
    options: [{ id: "low", isDefault: true }, { id: "medium" }, { id: "high" }, { id: "xhigh" }, { id: "max" }, { id: "ultra" }],
  });
  const opus = caps.providers.find((p) => p.providerInstanceId === "claudeAgent")?.models[0];
  assert.deepEqual(opus?.options[1], { id: "fastMode", type: "boolean" });
  assert.equal(caps.providers.find((p) => p.providerInstanceId === "grok")?.canRunChildTask, false);
});

test("a compact option with a bad value throws capabilities_parse", () => {
  const text = JSON.stringify({
    providers: [{ providerInstanceId: "x", driverKind: "x", models: [{ id: "m", options: [{ id: "effort", values: [1] }] }] }],
  });
  assert.equal(capsError(text).code, "capabilities_parse");
});
