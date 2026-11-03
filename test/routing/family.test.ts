import assert from "node:assert/strict";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { configuredDrivers, crossFamilyOrder, pickWorker, rungFamily, workerFamily } from "../../src/routing/family.ts";
import { resolveRole, toRouteOutput } from "../../src/routing/resolve.ts";
import type { Capabilities, LedgerEntry, RoleConfig, Rung } from "../../src/types.ts";
import { caps, role } from "./shared.ts";

// The fixture plus a second Claude instance "claudeWork" and a Codex instance "codexWork".
function capsWithInstances(): Capabilities {
  const c = caps();
  const claude = c.providers.find((p) => p.providerInstanceId === "claudeAgent");
  const codex = c.providers.find((p) => p.providerInstanceId === "codex");
  assert.ok(claude && codex);
  c.providers.push({ ...structuredClone(claude), providerInstanceId: "claudeWork" });
  c.providers.push({ ...structuredClone(codex), providerInstanceId: "codexWork" });
  return c;
}

const REVIEW = DEFAULT_CONFIG.roles.review as RoleConfig;
const CLAUDE_MEDIUM = { providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "medium" } };
const CODEX_MEDIUM = { providerInstanceId: "codex", model: "gpt-6-astra", options: { reasoningEffort: "medium" } };

test("rungFamily is the registered instance's driver kind, else the driver, else the configured driver, else the provider id", () => {
  const c = capsWithInstances();
  const drivers = new Map([["claude-max", "claudeAgent"]]);
  assert.equal(rungFamily({ driver: "codex" }), "codex");
  assert.equal(rungFamily({ provider: "claudeWork", driver: "claudeAgent" }, c), "claudeAgent");
  assert.equal(rungFamily({ provider: "claudeWork" }, c), "claudeAgent");
  assert.equal(rungFamily({ provider: "codexWork", driver: "claudeAgent" }, c), "codex");
  assert.equal(rungFamily({ provider: "claudeAgent", driver: "claudeAgent" }, { providers: [] }), "claudeAgent");
  assert.equal(rungFamily({ provider: "claudeWork" }), "claudeWork");
  assert.equal(rungFamily({ provider: "ghost" }, c), "ghost");
  assert.equal(rungFamily({ provider: "claude-max" }, undefined, drivers), "claudeAgent");
  assert.equal(rungFamily({ provider: "claude-max" }, c, drivers), "claudeAgent");
  assert.equal(rungFamily({ provider: "claude-max", driver: "codex" }, undefined, drivers), "codex");
  assert.equal(rungFamily({ provider: "codex-pro" }, undefined, drivers), "codex-pro");
  assert.equal(rungFamily({}), undefined);
});

test("workerFamily and rungFamily map the same provider id to the same family", () => {
  const c = capsWithInstances();
  const drivers = new Map([
    ["claude-max", "claudeAgent"],
    ["codexWork", "claudeAgent"],
  ]);
  for (const id of ["claude-max", "claudeWork", "codexWork", "codex", "claudeAgent", "codex-pro", "cursor"]) {
    for (const [capabilities, map] of [
      [undefined, undefined],
      [undefined, drivers],
      [c, undefined],
      [c, drivers],
    ] as const) {
      assert.equal(workerFamily(id, capabilities, map), rungFamily({ provider: id }, capabilities, map), id);
    }
  }
});

test("workerFamily maps a provider instance id to its driver kind with capabilities or a configured rung", () => {
  const c = capsWithInstances();
  assert.equal(workerFamily("codexWork", c), "codex");
  assert.equal(workerFamily("codex", c), "codex");
  assert.equal(workerFamily("codexWork"), "codexWork");
  assert.equal(workerFamily("cursor", c), "cursor");
  const drivers = new Map([["claude-max", "claudeAgent"]]);
  assert.equal(workerFamily("claude-max", undefined, drivers), "claudeAgent");
  assert.equal(workerFamily("claude-other", undefined, drivers), "claude-other");
  assert.equal(workerFamily("codexWork", c, drivers), "codex");
});

test("configuredDrivers maps each provider that a rung names with a driver, first rung wins", () => {
  const roles = {
    a: role([{ provider: "claude-max", driver: "claudeAgent", model: "m" }, { driver: "codex", model: "n" }], { crossFamily: true }),
    b: role([{ provider: "claude-max", driver: "other", model: "m" }, { provider: "solo", model: "n" }], { crossFamily: true }),
  };
  assert.deepEqual([...configuredDrivers(roles)], [["claude-max", "claudeAgent"]]);
  assert.deepEqual([...configuredDrivers(DEFAULT_CONFIG.roles)].sort(), [["claudeAgent", "claudeAgent"], ["codex", "codex"]]);
});

test("crossFamilyOrder is a stable partition: other families first, then the worker's family", () => {
  const chain: Rung[] = [
    { driver: "claudeAgent", model: "a" },
    { driver: "codex", model: "b" },
    { driver: "claudeAgent", model: "c" },
    { driver: "cursor", model: "d" },
  ];
  assert.deepEqual(crossFamilyOrder(chain, "claudeAgent"), [1, 3, 0, 2]);
  assert.deepEqual(crossFamilyOrder(chain, "codex"), [0, 2, 3, 1]);
  assert.deepEqual(crossFamilyOrder(chain, "pi"), [0, 1, 2, 3]);
  const providerOnly: Rung[] = [
    { provider: "claude-max", model: "a" },
    { provider: "codex-pro", model: "b" },
  ];
  const drivers = new Map([["claude-max", "claudeAgent"]]);
  assert.deepEqual(crossFamilyOrder(providerOnly, "claudeAgent", undefined, drivers), [1, 0]);
  assert.deepEqual(crossFamilyOrder(providerOnly, "claudeAgent"), [0, 1]);
});

test("review against claudeAgent starts on codex, and against codex starts on claudeAgent", () => {
  const againstClaude = resolveRole("review", REVIEW, undefined, { against: "claudeAgent" });
  assert.deepEqual(againstClaude.delegateTask?.target, CODEX_MEDIUM);
  assert.deepEqual(againstClaude.fallbacks, [CLAUDE_MEDIUM]);
  assert.deepEqual(againstClaude.notes, ["cross-family: worker family claudeAgent; the configured order applies"]);

  const againstCodex = resolveRole("review", REVIEW, undefined, { against: "codex" });
  assert.deepEqual(againstCodex.delegateTask?.target, CLAUDE_MEDIUM);
  assert.deepEqual(againstCodex.fallbacks, [CODEX_MEDIUM]);
  assert.deepEqual(againstCodex.attempts.map((a) => a.index), [1, 0]);
  assert.deepEqual(againstCodex.notes, ["cross-family: worker family codex; other families first"]);
});

test("without --against the configured order applies and no note is added", () => {
  const resolution = resolveRole("review", REVIEW);
  assert.deepEqual(resolution.delegateTask?.target, CODEX_MEDIUM);
  assert.equal(resolution.notes, undefined);
  assert.equal(resolution.crossFamily, true);
  assert.deepEqual(toRouteOutput(resolution).notes, []);
});

test("a role without crossFamily ignores --against and says so", () => {
  const execute = DEFAULT_CONFIG.roles.execute as RoleConfig;
  const resolution = resolveRole("execute", execute, undefined, { against: "claudeAgent" });
  assert.equal(resolution.delegateTask?.target.providerInstanceId, "claudeAgent");
  assert.deepEqual(resolution.attempts.map((a) => a.index), [0, 1]);
  assert.deepEqual(resolution.notes, ["role execute is not cross-family; --against has no effect"]);
  const unset = resolveRole("r", role([{ driver: "claudeAgent", model: "m" }, { driver: "codex", model: "n" }], { crossFamily: undefined }), undefined, {
    against: "claudeAgent",
  });
  assert.equal(unset.crossFamily, false);
  assert.equal(unset.delegateTask?.target.driverKind, "claudeAgent");
  assert.deepEqual(unset.notes, ["role r is not cross-family; --against has no effect"]);
});

test("a chain with only same-family rungs keeps its order and adds the same-family note", () => {
  const chain: Rung[] = [
    { driver: "claudeAgent", model: "claude-opus-5-5" },
    { driver: "claudeAgent", model: "claude-sonnet-5-5" },
  ];
  const resolution = resolveRole("r", role(chain, { crossFamily: true }), undefined, { against: "claudeAgent" });
  assert.equal(resolution.delegateTask?.target.model, "claude-opus-5-5");
  assert.deepEqual(resolution.attempts.map((a) => a.index), [0, 1]);
  assert.deepEqual(resolution.notes, [
    "cross-family: worker family claudeAgent; the configured order applies",
    "cross-family: no rung outside family claudeAgent is available; the same family reviews",
  ]);
});

test("a worker family that matches no rung keeps the order and says so, without a reorder note", () => {
  const chain: Rung[] = [
    { provider: "claude-max", driver: "claudeAgent", model: "claude-opus-5-5" },
    { provider: "codex-pro", driver: "codex", model: "gpt-6-astra" },
  ];
  const resolution = resolveRole("r", role(chain, { crossFamily: true }), undefined, { against: "claude-other" });
  assert.equal(resolution.delegateTask?.target.providerInstanceId, "claude-max");
  assert.deepEqual(resolution.attempts.map((a) => a.index), [0, 1]);
  assert.deepEqual(resolution.notes, [
    "cross-family: no rung is in family claude-other; check that --against names a driver or a configured provider, or pass --capabilities",
  ]);
  const mapped = resolveRole("r", role(chain, { crossFamily: true }), undefined, {
    against: "claude-max",
    drivers: new Map([["claude-max", "claudeAgent"]]),
  });
  assert.equal(mapped.delegateTask?.target.providerInstanceId, "codex-pro");
  assert.deepEqual(mapped.notes, ["cross-family: worker family claudeAgent; other families first"]);
});

test("a rung that names only a provider gets its family from the configured drivers, like the worker", () => {
  const drivers = new Map([
    ["claude-max", "claudeAgent"],
    ["claude-team", "claudeAgent"],
  ]);
  const chain: Rung[] = [
    { provider: "claude-max", model: "claude-opus-5-5", effort: "high" },
    { provider: "codex-pro", model: "gpt-6-astra", effort: "high" },
  ];
  const resolution = resolveRole("r", role(chain, { crossFamily: true }), undefined, { against: "claude-max", drivers });
  assert.equal(resolution.delegateTask?.target.providerInstanceId, "codex-pro");
  assert.deepEqual(resolution.fallbacks.map((f) => f.providerInstanceId), ["claude-max"]);
  assert.deepEqual(resolution.attempts.map((a) => a.index), [1, 0]);
  assert.deepEqual(resolution.notes, ["cross-family: worker family claudeAgent; other families first"]);

  const byDriver = resolveRole("r", role(chain, { crossFamily: true }), undefined, { against: "claudeAgent", drivers });
  assert.equal(byDriver.delegateTask?.target.providerInstanceId, "codex-pro");

  const sameFamily: Rung[] = [
    { provider: "claude-max", model: "claude-opus-5-5" },
    { provider: "claude-team", model: "claude-sonnet-5-5" },
  ];
  const same = resolveRole("r", role(sameFamily, { crossFamily: true }), undefined, { against: "claude-max", drivers });
  assert.equal(same.delegateTask?.target.providerInstanceId, "claude-max");
  assert.deepEqual(same.notes, [
    "cross-family: worker family claudeAgent; the configured order applies",
    "cross-family: no rung outside family claudeAgent is available; the same family reviews",
  ]);
});

test("with capabilities a provider instance id maps to its driver kind before the reorder", () => {
  const c = capsWithInstances();
  const chain: Rung[] = [
    { provider: "claudeWork", model: "claude-opus-5-5", effort: "high" },
    { provider: "codexWork", model: "gpt-6-astra", effort: "high" },
  ];
  const resolution = resolveRole("r", role(chain, { crossFamily: true }), c, { against: "claudeAgent" });
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.delegateTask?.target, {
    providerInstanceId: "codexWork",
    model: "gpt-6-astra",
    options: { reasoningEffort: "high" },
  });
  const byInstance = resolveRole("r", role(chain, { crossFamily: true }), c, { against: "codexWork" });
  assert.equal(byInstance.delegateTask?.target.providerInstanceId, "claudeWork");
  assert.deepEqual(byInstance.notes, ["cross-family: worker family codex; the configured order applies"]);
});

test("an unavailable other-family rung falls back to the same family with the note and configured rung numbers", () => {
  const c = caps();
  const codex = c.providers.find((p) => p.providerInstanceId === "codex");
  assert.ok(codex);
  codex.canRunChildTask = false;
  codex.constraints = ["Provider instance is disabled."];
  const chain: Rung[] = [
    { driver: "claudeAgent", model: "claude-opus-5-5", effort: "high" },
    { driver: "codex", model: "gpt-6-astra", effort: "high" },
  ];
  const resolution = resolveRole("r", role(chain, { crossFamily: true }), c, { against: "claudeAgent" });
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.delegateTask?.target, {
    providerInstanceId: "claudeAgent",
    model: "claude-opus-5-5",
    options: { effort: "high" },
  });
  assert.deepEqual(resolution.fallbacks, []);
  assert.deepEqual(toRouteOutput(resolution).notes, [
    "cross-family: worker family claudeAgent; other families first",
    "cross-family: no rung outside family claudeAgent is available; the same family reviews",
    "rung 2: provider codex cannot run child tasks: Provider instance is disabled.",
  ]);
});

test("with capabilities, a default rung whose instance is not registered keeps its driver's family", () => {
  const c = caps();
  const claude = c.providers.find((p) => p.providerInstanceId === "claudeAgent");
  const codex = c.providers.find((p) => p.providerInstanceId === "codex");
  assert.ok(claude && codex);
  claude.providerInstanceId = "claude-main";
  codex.providerInstanceId = "codex-main";
  c.inheritedProviderInstanceId = "claude-main";
  const resolution = resolveRole("review", REVIEW, c, { against: "claude-main" });
  assert.deepEqual(resolution.delegateTask?.target, { ...CODEX_MEDIUM, providerInstanceId: "codex-main" });
  assert.deepEqual(toRouteOutput(resolution).notes, [
    "cross-family: worker family claudeAgent; the configured order applies",
    "rung 1: provider instance codex is not registered; using instance codex-main of driver codex",
    "rung 2: provider instance claudeAgent is not registered; using instance claude-main of driver claudeAgent",
  ]);

  codex.canRunChildTask = false;
  codex.constraints = ["Provider instance is disabled."];
  const sameFamily = resolveRole("review", REVIEW, c, { against: "claude-main" });
  assert.deepEqual(sameFamily.delegateTask?.target, { ...CLAUDE_MEDIUM, providerInstanceId: "claude-main" });
  assert.deepEqual(sameFamily.notes, [
    "cross-family: worker family claudeAgent; the configured order applies",
    "cross-family: no rung outside family claudeAgent is available; the same family reviews",
  ]);
});

test("resolve options notes come before the cross-family notes", () => {
  const resolution = resolveRole("review", REVIEW, undefined, { against: "codex", notes: ["first"] });
  assert.deepEqual(resolution.notes, ["first", "cross-family: worker family codex; other families first"]);
});

function entry(fields: Partial<LedgerEntry>): LedgerEntry {
  return { ts: "2026-10-06T00:00:00.000Z", role: "execute", status: "dispatched", plan: "p", ...fields };
}

const ROLES = DEFAULT_CONFIG.roles;

test("pickWorker with --unit takes the provider of the unit's last worker entry", () => {
  const entries = [
    entry({ unit: "U1", provider: "claudeAgent" }),
    entry({ unit: "U2", provider: "claudeAgent" }),
    entry({ unit: "U1", provider: "codex", role: "ui", round: 3 }),
    entry({ unit: "U1", provider: "claudeAgent", role: "review" }),
    entry({ unit: "U1", provider: "claudeAgent", status: "completed" }),
  ];
  assert.deepEqual(pickWorker(entries, ROLES, "p", "U1"), { provider: "codex", from: "unit" });
  assert.deepEqual(pickWorker(entries, ROLES, "p", "U2"), { provider: "claudeAgent", from: "unit" });
});

test("pickWorker without unit entries takes the provider of most units", () => {
  const entries = [
    entry({ unit: "U1", provider: "codex" }),
    entry({ unit: "U1", provider: "claudeAgent", round: 2 }),
    entry({ unit: "U2", provider: "claudeAgent" }),
    entry({ unit: "U3", provider: "codex" }),
    entry({ unit: "U2", provider: "codex", plan: "other" }),
  ];
  assert.deepEqual(pickWorker(entries, ROLES, "p"), { provider: "claudeAgent", from: "plan" });
  assert.deepEqual(pickWorker(entries, ROLES, "p", "F2"), { provider: "claudeAgent", from: "plan" });
});

test("pickWorker breaks a tie with the provider whose last worker entry comes latest", () => {
  const entries = [
    entry({ unit: "U1", provider: "claudeAgent" }),
    entry({ unit: "U2", provider: "codex" }),
    entry({ unit: "U3", provider: "claudeAgent", role: "ui" }),
    entry({ unit: "U4", provider: "codex" }),
  ];
  assert.deepEqual(pickWorker(entries, ROLES, "p"), { provider: "codex", from: "plan" });
  const swapped = [entries[1], entries[0], entries[3], entries[2]] as LedgerEntry[];
  assert.deepEqual(pickWorker(swapped, ROLES, "p"), { provider: "claudeAgent", from: "plan" });
});

test("pickWorker skips review, verify, qa, unknown roles, entries without a provider, and other plans", () => {
  const entries = [
    entry({ unit: "U1", provider: "codex", role: "review" }),
    entry({ unit: "U1", provider: "codex", role: "verify" }),
    entry({ unit: "U1", provider: "codex", role: "qa" }),
    entry({ unit: "U1", provider: "codex", role: "oracle" }),
    entry({ unit: "U1", provider: "codex", role: "swarm" }),
    entry({ unit: "U1", role: "execute" }),
    entry({ unit: "U1", provider: "codex", plan: "other" }),
  ];
  assert.equal(pickWorker(entries, ROLES, "p"), undefined);
  assert.equal(pickWorker(entries, ROLES, "p", "U1"), undefined);
  assert.equal(pickWorker([], ROLES, "p"), undefined);
});

test("pickWorker counts only the last worker entry of each unit for the tie rule", () => {
  const entries = [
    entry({ unit: "U1", provider: "codex" }),
    entry({ unit: "U2", provider: "claudeAgent" }),
    entry({ unit: "U3", provider: "codex" }),
    entry({ unit: "U4", provider: "claudeAgent" }),
    entry({ unit: "U5", provider: "codex" }),
    entry({ unit: "U5", provider: "cursor", round: 2 }),
  ];
  assert.deepEqual(pickWorker(entries, ROLES, "p"), { provider: "claudeAgent", from: "plan" });
});

test("pickWorker counts the entries without a unit together as one unit", () => {
  const entries = [
    entry({ provider: "codex" }),
    entry({ provider: "claudeAgent" }),
    entry({ provider: "claudeAgent", round: 2 }),
    entry({ unit: "U1", provider: "codex" }),
    entry({ unit: "U2", provider: "codex" }),
  ];
  assert.deepEqual(pickWorker(entries, ROLES, "p"), { provider: "codex", from: "plan" });
  const onlyWithout = [entry({ provider: "codex" }), entry({ provider: "claudeAgent" })];
  assert.deepEqual(pickWorker(onlyWithout, ROLES, "p"), { provider: "claudeAgent", from: "plan" });
  assert.deepEqual(pickWorker(onlyWithout, ROLES, "p", "U1"), { provider: "claudeAgent", from: "plan" });
});

test("pickWorker skips a provider that is not a non-empty string, warns, and keeps the last valid worker", () => {
  const warnings: string[] = [];
  const entries = [
    entry({ unit: "U1", provider: "codex" }),
    entry({ unit: "U1", provider: null as unknown as string }),
    entry({ unit: "U1", provider: 7 as unknown as string }),
    entry({ unit: "U1", provider: "" }),
    entry({ unit: "U1", provider: "claudeAgent", role: "review" }),
  ];
  assert.deepEqual(pickWorker(entries, ROLES, "p", "U1", (w) => warnings.push(w)), { provider: "codex", from: "unit" });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0] ?? "", /^skipped a ledger entry with an invalid provider null \(role execute, unit U1, ts /);
  assert.deepEqual(pickWorker(entries, ROLES, "p", "U1"), { provider: "codex", from: "unit" });
});
