import assert from "node:assert/strict";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { resolveAll, resolveRole, toRouteOutput } from "../../src/routing/resolve.ts";
import type { Capabilities, ProviderCapability, RoleConfig, Rung } from "../../src/types.ts";
import { OmtError } from "../../src/util/errors.ts";
import { omtExit } from "../helpers.ts";
import { caps, role } from "./shared.ts";

function provider(caps: Capabilities, id: string): ProviderCapability {
  const found = caps.providers.find((p) => p.providerInstanceId === id);
  assert.ok(found, id);
  return found;
}

test("a resolved role uses the first ok rung and keeps later ok rungs as fallbacks", () => {
  const execute = DEFAULT_CONFIG.roles.execute;
  assert.ok(execute);
  const resolution = resolveRole("execute", execute, caps());
  assert.deepEqual(resolution, {
    role: "execute",
    description: execute.description,
    access: "edit",
    result: "work",
    t3Role: "implementation",
    interactionMode: "default",
    runtimeMode: "inherit",
    crossFamily: false,
    status: "resolved",
    delegateTask: {
      target: { providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "low" } },
      role: "implementation",
      interactionMode: "default",
      runtimeMode: "inherit",
    },
    fallbacks: [{ providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "high" } }],
    attempts: [
      {
        index: 0,
        rung: execute.chain[0],
        ok: true,
        notes: [],
        target: { providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "low" } },
      },
      {
        index: 1,
        rung: execute.chain[1],
        ok: true,
        notes: [],
        target: { providerInstanceId: "codex", model: "gpt-6.1-sol", options: { reasoningEffort: "high" } },
      },
    ],
  });
});

test("falls back past a disabled provider", () => {
  const resolution = resolveRole(
    "r",
    role([
      { driver: "grok", model: "grok-build", effort: "high" },
      { provider: "codex", model: "gpt-6-astra", effort: "high" },
    ]),
    caps(),
  );
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.attempts[0]?.ok, false);
  assert.equal(
    resolution.attempts[0]?.reason,
    "provider grok cannot run child tasks: Provider instance is disabled.; Provider executable is not installed.",
  );
  assert.deepEqual(resolution.delegateTask?.target, {
    providerInstanceId: "codex",
    model: "gpt-6-astra",
    options: { reasoningEffort: "high" },
  });
  assert.deepEqual(resolution.fallbacks, []);
});

test("a disabled provider with no constraints says no reason given", () => {
  const c = caps();
  provider(c, "grok").constraints = [];
  const resolution = resolveRole("r", role([{ provider: "grok", model: "grok-build" }]), c);
  assert.equal(resolution.attempts[0]?.reason, "provider grok cannot run child tasks: no reason given");
});

test("a missing model fails the rung", () => {
  const resolution = resolveRole("r", role([{ driver: "codex", model: "gpt-9" }]), caps());
  assert.equal(resolution.status, "unavailable");
  assert.equal(resolution.delegateTask, undefined);
  assert.equal(resolution.attempts[0]?.reason, "model gpt-9 is not advertised by codex");
});

test("an unknown provider, an unknown driver, and a driver mismatch fail the rung", () => {
  const resolution = resolveRole(
    "r",
    role([
      { provider: "claudeWork", model: "claude-opus-5-5" },
      { driver: "gemini", model: "gemini-4" },
      { provider: "codex", driver: "claudeAgent", model: "gpt-6-astra" },
    ]),
    caps(),
  );
  assert.equal(resolution.status, "unavailable");
  assert.deepEqual(
    resolution.attempts.map((a) => a.reason),
    [
      "provider instance claudeWork is not registered in T3",
      "no provider instance with driver gemini",
      "provider instance codex has driver codex, not claudeAgent",
    ],
  );
});

test("a rung whose provider instance is not registered falls back to its driver, with a note", () => {
  const c = caps({ inheritedProviderInstanceId: "claude-main" });
  provider(c, "claudeAgent").providerInstanceId = "claude-main";
  provider(c, "codex").providerInstanceId = "codex-main";
  const execute = DEFAULT_CONFIG.roles.execute as RoleConfig;
  const resolution = resolveRole("execute", execute, c);
  assert.equal(resolution.status, "resolved");
  assert.deepEqual(resolution.delegateTask?.target, {
    providerInstanceId: "claude-main",
    model: "claude-opus-5-5",
    options: { effort: "low" },
  });
  assert.deepEqual(resolution.fallbacks, [
    { providerInstanceId: "codex-main", model: "gpt-6.1-sol", options: { reasoningEffort: "high" } },
  ]);
  assert.deepEqual(toRouteOutput(resolution).notes, [
    "rung 1: provider instance claudeAgent is not registered; using instance claude-main of driver claudeAgent",
    "rung 2: provider instance codex is not registered; using instance codex-main of driver codex",
  ]);

  const failed = resolveRole(
    "r",
    role([
      { provider: "claudeAgent", model: "claude-opus-5-5" },
      { provider: "ghost", driver: "gemini", model: "gemini-4" },
    ]),
    c,
  );
  assert.equal(failed.status, "unavailable");
  assert.deepEqual(
    failed.attempts.map((a) => a.reason),
    [
      "provider instance claudeAgent is not registered in T3",
      "provider instance ghost is not registered in T3; no provider instance with driver gemini",
    ],
  );
});

test("a provider that lists no models accepts any model", () => {
  const c = caps();
  provider(c, "opencode").canRunChildTask = true;
  const resolution = resolveRole("r", role([{ driver: "opencode", model: "anything", effort: "max" }]), c);
  assert.deepEqual(resolution.delegateTask?.target, {
    providerInstanceId: "opencode",
    model: "anything",
    options: { variant: "xhigh" },
  });
  assert.deepEqual(resolution.attempts[0]?.notes, [
    "provider opencode lists no models; T3 will check the model and its options",
    "effort max mapped to xhigh for option variant",
  ]);
});

test("maps effort onto each driver's advertised option", () => {
  const cases: [Rung, Record<string, string>, string[]][] = [
    [{ driver: "claudeAgent", model: "claude-sonnet-5-5", effort: "max" }, { effort: "max" }, []],
    [{ driver: "codex", model: "gpt-6.1-sol", effort: "max" }, { reasoningEffort: "max" }, []],
    [
      { driver: "codex", model: "gpt-6-luna", effort: "max" },
      { reasoningEffort: "xhigh" },
      ["effort max mapped to xhigh for option reasoningEffort"],
    ],
    [{ driver: "cursor", model: "composer-3", effort: "high" }, { reasoning: "high" }, []],
    [
      { driver: "cursor", model: "composer-3", effort: "max" },
      { reasoning: "high" },
      ["effort max mapped to high for option reasoning"],
    ],
    [{ driver: "pi", model: "openai-codex/gpt-6-astra", effort: "minimal" }, { thinking: "minimal" }, []],
    [
      { driver: "pi", model: "openai-codex/gpt-6-astra", effort: "max" },
      { thinking: "xhigh" },
      ["effort max mapped to xhigh for option thinking"],
    ],
  ];
  for (const [rung, options, notes] of cases) {
    const resolution = resolveRole("r", role([rung]), caps());
    assert.deepEqual(resolution.delegateTask?.target.options, options, JSON.stringify(rung));
    assert.deepEqual(resolution.attempts[0]?.notes, notes, JSON.stringify(rung));
  }
});

test("a model with no effort option gets no options and a note", () => {
  const resolution = resolveRole("r", role([{ driver: "cursor", model: "default", effort: "high" }]), caps());
  assert.deepEqual(resolution.delegateTask?.target, { providerInstanceId: "cursor", model: "default" });
  assert.deepEqual(resolution.attempts[0]?.notes, [
    "effort high not applied: the model advertises no effort option",
  ]);
});

test("raw options override the effort mapping and are validated", () => {
  const ok = resolveRole(
    "r",
    role([
      {
        driver: "claudeAgent",
        model: "claude-opus-5-5",
        effort: "high",
        options: { effort: "ultrathink", fastMode: true, contextWindow: "1m" },
      },
    ]),
    caps(),
  );
  assert.deepEqual(ok.delegateTask?.target.options, { effort: "ultrathink", fastMode: true, contextWindow: "1m" });

  const bad = resolveRole(
    "r",
    role([
      {
        driver: "claudeAgent",
        model: "claude-opus-5-5",
        options: { fastMode: "yes", contextWindow: "2m", temperature: "hot", effort: true },
      },
    ]),
    caps(),
  );
  assert.equal(bad.status, "unavailable");
  assert.equal(
    bad.attempts[0]?.reason,
    "invalid options: option fastMode needs a boolean, got \"yes\"; " +
      "option contextWindow value \"2m\" is not one of: 200k, 1m; " +
      "option temperature is not advertised by model claude-opus-5-5; " +
      "option effort value true is not one of: low, medium, high, xhigh, max, ultrathink",
  );
});

test("raw options on a model without descriptors are kept with a note", () => {
  const resolution = resolveRole("r", role([{ driver: "cursor", model: "default", options: { speed: "fast" } }]), caps());
  assert.deepEqual(resolution.delegateTask?.target.options, { speed: "fast" });
  assert.deepEqual(resolution.attempts[0]?.notes, ["the model advertises no options; T3 will not check them"]);
});

test("unverified mode trusts the chain and uses driver targets", () => {
  const resolution = resolveRole(
    "r",
    role([
      { driver: "codex", model: "gpt-6-astra", effort: "minimal" },
      { provider: "claudeWork", model: "claude-opus-5-5", effort: "high" },
      { provider: "work-pi", driver: "pi", model: "m", effort: "off", options: { extra: true } },
      { driver: "cursor", model: "composer-3", effort: "high" },
    ]),
  );
  assert.equal(resolution.status, "unverified");
  assert.deepEqual(resolution.delegateTask?.target, {
    driverKind: "codex",
    model: "gpt-6-astra",
    options: { reasoningEffort: "low" },
  });
  assert.deepEqual(resolution.fallbacks, [
    { providerInstanceId: "claudeWork", model: "claude-opus-5-5" },
    { providerInstanceId: "work-pi", model: "m", options: { thinking: "off", extra: true } },
    { driverKind: "cursor", model: "composer-3" },
  ]);
  assert.deepEqual(
    resolution.attempts.map((a) => a.notes),
    [
      ["effort minimal mapped to low for option reasoningEffort"],
      ["effort high not applied: unknown option for driver claudeWork"],
      [],
      ["effort high not applied: unknown option for driver cursor"],
    ],
  );
});

test("plan-mode parent makes edit and default-mode roles unavailable", () => {
  const planParent = caps({ interactionMode: "plan" });
  const reason = "the parent thread is in plan mode; this role needs default mode";
  const chain: Rung[] = [
    { driver: "claudeAgent", model: "claude-opus-5-5" },
    { driver: "codex", model: "gpt-6-astra" },
  ];
  for (const overrides of [
    { access: "edit", interactionMode: "inherit" },
    { access: "read-only", interactionMode: "default" },
  ] as const) {
    const resolution = resolveRole("r", role(chain, overrides), planParent);
    assert.equal(resolution.status, "unavailable");
    assert.deepEqual(
      resolution.attempts.map((a) => [a.ok, a.reason]),
      [
        [false, reason],
        [false, reason],
      ],
    );
  }
  assert.equal(resolveRole("r", role(chain), planParent).status, "resolved");
  assert.equal(resolveRole("r", role(chain, { interactionMode: "inherit" }), planParent).status, "resolved");
  assert.equal(resolveRole("r", role(chain, { access: "edit" }), caps()).status, "resolved");
});

test("a role runtime mode broader than the parent's is unavailable", () => {
  const chain: Rung[] = [{ driver: "claudeAgent", model: "claude-opus-5-5" }];
  const broad = resolveRole("r", role(chain, { runtimeMode: "full-access" }), caps());
  assert.equal(broad.status, "unavailable");
  assert.equal(broad.attempts[0]?.reason, "role runtime mode full-access is broader than the parent's auto");
  for (const runtimeMode of ["inherit", "approval-required", "auto-accept-edits", "auto"] as const) {
    assert.equal(resolveRole("r", role(chain, { runtimeMode }), caps()).status, "resolved", runtimeMode);
  }
  const narrow = resolveRole("r", role(chain, { runtimeMode: "auto" }), caps({ runtimeMode: "approval-required" }));
  assert.equal(narrow.attempts[0]?.reason, "role runtime mode auto is broader than the parent's approval-required");
  assert.equal(resolveRole("r", role(chain, { runtimeMode: "full-access" })).status, "unverified");
});

test("driver-only rungs prefer the inherited provider instance", () => {
  const base = caps();
  const claude = provider(base, "claudeAgent");
  const second: ProviderCapability = { ...claude, providerInstanceId: "claudeWork", displayName: "Claude Work" };
  const withSecond = (inherited: string, mutate?: (c: Capabilities) => void): Capabilities => {
    const c = caps({ inheritedProviderInstanceId: inherited });
    c.providers.unshift(structuredClone(second));
    mutate?.(c);
    return c;
  };
  const pick = (c: Capabilities): string | undefined =>
    resolveRole("r", role([{ driver: "claudeAgent", model: "claude-opus-5-5" }]), c).delegateTask?.target
      .providerInstanceId;

  assert.equal(pick(withSecond("claudeAgent")), "claudeAgent");
  assert.equal(pick(withSecond("claudeWork")), "claudeWork");
  assert.equal(pick(withSecond("codex")), "claudeWork");
  assert.equal(
    pick(
      withSecond("claudeWork", (c) => {
        provider(c, "claudeWork").canRunChildTask = false;
      }),
    ),
    "claudeAgent",
  );
  assert.equal(
    pick(
      withSecond("codex", (c) => {
        provider(c, "claudeWork").canRunChildTask = false;
      }),
    ),
    "claudeAgent",
  );
  const allDisabled = withSecond("claudeAgent", (c) => {
    provider(c, "claudeWork").canRunChildTask = false;
    provider(c, "claudeAgent").canRunChildTask = false;
  });
  const resolution = resolveRole("r", role([{ driver: "claudeAgent", model: "claude-opus-5-5" }]), allDisabled);
  assert.equal(resolution.attempts[0]?.reason, "provider claudeWork cannot run child tasks: no reason given");
});

test("every default role resolves when its models are advertised", () => {
  const c = caps();
  const codex = provider(c, "codex");
  const sol = codex.models.find((model) => model.id === "gpt-6.1-sol");
  const claude = provider(c, "claudeAgent");
  const sonnet = claude.models.find((model) => model.id === "claude-sonnet-5-5");
  assert.ok(sol && sonnet);
  codex.models.push({ ...structuredClone(sol), id: "gpt-6.1-terra" });
  claude.models.push({ ...structuredClone(sonnet), id: "claude-haiku-5-5" });
  const expected: Record<string, [string, string, Record<string, string>]> = {
    "explore": ["codex", "gpt-6.1-terra", {"reasoningEffort": "low"}],
    "research": ["codex", "gpt-6.1-sol", {"reasoningEffort": "low", "serviceTier": "priority"}],
    "plan-review": ["codex", "gpt-6-astra", {"reasoningEffort": "medium"}],
    "execute": ["claudeAgent", "claude-opus-5-5", {"effort": "low"}],
    "review": ["codex", "gpt-6-astra", {"reasoningEffort": "medium"}],
    "oracle": ["codex", "gpt-6-astra", {"reasoningEffort": "medium"}],
    "qa": ["codex", "gpt-6.1-sol", {"reasoningEffort": "medium", "serviceTier": "priority"}],
    "guardrail": ["claudeAgent", "claude-opus-5-5", {"effort": "high"}],
    "judge": ["codex", "gpt-6.1-sol", {"reasoningEffort": "medium", "serviceTier": "priority"}],
    "writing": ["claudeAgent", "claude-opus-5-5", {"effort": "medium"}],
    "design": ["claudeAgent", "claude-opus-5-5", {"effort": "medium"}],
    "ui": ["claudeAgent", "claude-opus-5-5", {"effort": "low"}],
  };
  const report = resolveAll(DEFAULT_CONFIG, c);
  assert.equal(report.version, 1);
  assert.equal(report.verified, true);
  assert.deepEqual(report.limits, DEFAULT_CONFIG.limits);
  assert.deepEqual(Object.keys(report.roles), Object.keys(DEFAULT_CONFIG.roles));
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(DEFAULT_CONFIG.roles).sort());
  for (const [name, [providerInstanceId, model, options]] of Object.entries(expected)) {
    const resolution = report.roles[name];
    const config = DEFAULT_CONFIG.roles[name];
    assert.ok(resolution && config, name);
    assert.equal(resolution.status, "resolved", name);
    assert.deepEqual(resolution.delegateTask?.target, { providerInstanceId, model, options }, name);
    assert.equal(resolution.delegateTask?.role, config.t3Role, name);
    assert.equal(resolution.delegateTask?.interactionMode, config.interactionMode, name);
    assert.equal(resolution.fallbacks.length, config.chain.length - 1, name);
    assert.equal(resolution.attempts.filter((attempt) => !attempt.ok).length, 0, name);
  }
});

test("climb tier two selects the other judge family instead of repeating tier one", () => {
  const judge = DEFAULT_CONFIG.roles.judge;
  assert.ok(judge);
  const first = resolveRole("judge", judge, caps());
  const second = resolveRole("judge", judge, caps(), { against: "codex" });
  assert.equal(first.delegateTask?.target.providerInstanceId, "codex");
  assert.equal(second.delegateTask?.target.providerInstanceId, "claudeAgent");
});

test("explore reports both missing models with the older fixture", () => {
  const resolution = resolveAll(DEFAULT_CONFIG, caps(), ["explore"]).roles.explore;
  assert.equal(resolution?.status, "unavailable");
  assert.equal(resolution?.attempts[0]?.reason, "model gpt-6.1-terra is not advertised by codex");
  assert.equal(resolution?.attempts[1]?.reason, "model claude-haiku-5-5 is not advertised by claudeAgent");
});

test("every default role is unverified with provider instance targets without capabilities", () => {
  const report = resolveAll(DEFAULT_CONFIG);
  assert.equal(report.verified, false);
  for (const [name, resolution] of Object.entries(report.roles)) {
    const first = DEFAULT_CONFIG.roles[name]?.chain[0];
    assert.ok(first, name);
    assert.equal(resolution.status, "unverified", name);
    const optionId = first.driver === "codex" ? "reasoningEffort" : "effort";
    assert.deepEqual(
      resolution.delegateTask?.target,
      { providerInstanceId: first.driver, model: first.model, options: {
        [optionId]: first.effort,
        ...(first.model === "gpt-6.1-sol" ? { serviceTier: "priority" } : {}),
      } },
      name,
    );
    assert.equal(resolution.fallbacks[0]?.providerInstanceId, DEFAULT_CONFIG.roles[name]?.chain[1]?.driver, name);
  }
});

test("a user rung that names only a driver still resolves to a driverKind target without capabilities", () => {
  const role: RoleConfig = {
    ...(DEFAULT_CONFIG.roles.execute as RoleConfig),
    chain: [{ driver: "codex", model: "gpt-6.1-sol", effort: "high" }],
  };
  assert.deepEqual(resolveRole("execute", role).delegateTask?.target, {
    driverKind: "codex",
    model: "gpt-6.1-sol",
    options: { reasoningEffort: "high" },
  });
});

test("resolveAll filters by name and rejects unknown roles", () => {
  const report = resolveAll(DEFAULT_CONFIG, caps(), ["review", "explore", "review"]);
  assert.deepEqual(Object.keys(report.roles), ["review", "explore"]);
  assert.throws(
    () => resolveAll(DEFAULT_CONFIG, caps(), ["review", "nope"]),
    (error: unknown) =>
      omtExit(1)(error) &&
      error.code === "unknown_role" &&
      error.message.includes("nope") &&
      error.message.includes("execute"),
  );
  assert.throws(() => resolveAll(DEFAULT_CONFIG, undefined, ["toString"]), OmtError);
});

test("toRouteOutput numbers notes and reasons by rung in chain order", () => {
  const resolution = resolveRole(
    "r",
    role([
      { driver: "grok", model: "grok-build" },
      { driver: "codex", model: "gpt-6-luna", effort: "max" },
      { driver: "cursor", model: "default", effort: "low" },
    ]),
    caps(),
  );
  const output = toRouteOutput(resolution);
  assert.deepEqual(Object.keys(output), [
    "role",
    "status",
    "description",
    "access",
    "result",
    "delegateTask",
    "fallbacks",
    "notes",
  ]);
  assert.deepEqual(output.delegateTask, resolution.delegateTask);
  assert.deepEqual(output.fallbacks, [{ providerInstanceId: "cursor", model: "default" }]);
  assert.deepEqual(output.notes, [
    "rung 1: provider grok cannot run child tasks: Provider instance is disabled.; Provider executable is not installed.",
    "rung 2: effort max mapped to xhigh for option reasoningEffort",
    "rung 3: effort low not applied: the model advertises no effort option",
  ]);

  const unavailable = toRouteOutput(resolveRole("r", role([{ driver: "codex", model: "gpt-9" }]), caps()));
  assert.equal(unavailable.status, "unavailable");
  assert.equal("delegateTask" in unavailable, false);
  assert.deepEqual(unavailable.notes, ["rung 1: model gpt-9 is not advertised by codex"]);
});

test("resolveRole copies the role's T3 fields, also for an unavailable role", () => {
  const custom = role([{ provider: "nope", model: "m" }], {
    access: "edit",
    t3Role: "design",
    interactionMode: "plan",
    runtimeMode: "auto",
  });
  const resolution = resolveRole("custom", custom, caps());
  assert.equal(resolution.status, "unavailable");
  assert.equal(resolution.t3Role, "design");
  assert.equal(resolution.interactionMode, "plan");
  assert.equal(resolution.runtimeMode, "auto");
});
