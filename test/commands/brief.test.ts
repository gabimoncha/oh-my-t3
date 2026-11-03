import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { requestId } from "../../src/ledger/ledger.ts";
import type { BriefJsonOutput } from "../../src/types.ts";
import { CAPS_FILE, makeProject } from "./shared.ts";

const DELEGATE_TASK_FIELDS = ["task", "title", "target", "role", "interactionMode", "runtimeMode", "mode"];

function parse(text: string): BriefJsonOutput {
  return JSON.parse(text) as BriefJsonOutput;
}

test("brief prints the rendered brief with every given section", async () => {
  const { ctx } = await makeProject().runOk([
    "brief",
    "execute",
    "--task",
    "Add the endpoint.",
    "--context",
    "The API lives in src/api.",
    "--scope",
    "src/api",
    "--done",
    "the test passes",
    "--verify",
    "pnpm test",
    "--plan",
    "auth",
    "--unit",
    "U3",
    "--round",
    "2",
  ]);
  const text = ctx.out();
  assert.match(text, /^<!-- omt-brief v1 role=execute round=2 depth=1\/1 plan=auth unit=U3 -->\n/);
  for (const heading of ["# Role: execute", "# Task", "# Context", "# Scope", "# Constraints", "# Done when", "# Verify", "# Final message"]) {
    assert.match(text, new RegExp(`^${heading}$`, "m"), heading);
  }
  assert.match(text, /^STATUS: DONE \| BLOCKED \| ESCALATE$/m);
  assert.doesNotMatch(text, /^# Prior rounds$/m);
});

test("brief --json holds exactly the delegate_task fields, without clientRequestId by default", async () => {
  const { ctx } = await makeProject().runOk(["brief", "review", "--task", "Check the diff.", "--json"]);
  const output = parse(ctx.out());
  assert.deepEqual(Object.keys(output), ["delegateTask", "fallbacks", "targetKey"]);
  assert.deepEqual(Object.keys(output.delegateTask).sort(), [...DELEGATE_TASK_FIELDS].sort());
  assert.equal(output.delegateTask.mode, "async");
  assert.equal(output.delegateTask.role, "review");
  assert.equal(output.delegateTask.interactionMode, "default");
  assert.equal(output.delegateTask.runtimeMode, "inherit");
  assert.equal(output.delegateTask.title, "review: Check the diff.");
  assert.deepEqual(output.delegateTask.target, { providerInstanceId: "codex", model: "gpt-6-astra", options: { reasoningEffort: "medium" } });
  assert.deepEqual(output.fallbacks, [{ providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "medium" } }]);
  assert.match(output.delegateTask.task, /^<!-- omt-brief v1 role=review round=1 depth=1\/1 -->/);
  assert.equal(ctx.err(), "");
});

test("brief --json adds clientRequestId only with both --plan and --unit", async () => {
  const project = makeProject();
  const both = parse(
    (await project.runOk(["brief", "review", "--task", "x", "--plan", "auth", "--unit", "U3", "--round", "2", "--attempt", "3", "--json"])).ctx.out(),
  );
  assert.equal(both.delegateTask.clientRequestId, requestId("auth", "U3", "review", 2, 3));
  assert.equal(both.delegateTask.clientRequestId, "omt:auth:U3:review:r2:a3");
  assert.deepEqual(Object.keys(both.delegateTask).sort(), [...DELEGATE_TASK_FIELDS, "clientRequestId"].sort());

  const planOnly = parse((await project.runOk(["brief", "review", "--task", "x", "--plan", "auth", "--json"])).ctx.out());
  assert.equal("clientRequestId" in planOnly.delegateTask, false);
  const unitOnly = parse((await project.runOk(["brief", "review", "--task", "x", "--unit", "U3", "--json"])).ctx.out());
  assert.equal("clientRequestId" in unitOnly.delegateTask, false);
});

test("brief --json accepts a plan id without a plan file and keeps it in the request id and header", async () => {
  const project = makeProject();
  const plan = join(project.cwd, ".omt", "plans", "review-x.md");
  assert.equal(existsSync(plan), false);
  const { code, ctx } = await project.run(["brief", "review", "--task", "t", "--plan", "review-x", "--unit", "G1", "--json"]);
  assert.equal(code, 0, ctx.err());
  const output = parse(ctx.out());
  assert.equal(output.delegateTask.clientRequestId, "omt:review-x:G1:review:r1:a1");
  assert.match(output.delegateTask.task, /^<!-- omt-brief v1 role=review round=1 depth=1\/1 plan=review-x unit=G1 -->\n/);
  assert.equal(existsSync(plan), false);
});

test("brief --json follows the title rule", async () => {
  const project = makeProject();
  const title = async (args: string[]) =>
    parse((await project.runOk(["brief", "review", "--json", ...args])).ctx.out()).delegateTask.title;
  assert.equal(await title(["--task", "\n  token refresh  \nmore", "--unit", "U3", "--round", "2"]), "review U3 r2: token refresh");
  assert.equal(await title(["--task", "token refresh", "--unit", "U3"]), "review U3: token refresh");
  assert.equal(await title(["--task", "token refresh", "--title", "My title"]), "My title");
  assert.equal((await title(["--task", "x".repeat(200)])).length, 72);
  assert.equal((await title(["--task", "x", "--title", "y".repeat(100)])).length, 72);
});

test("brief reads the task from stdin or a file", async () => {
  const project = makeProject();
  const fromStdin = await project.runOk(["brief", "execute", "--task-file", "-"], { stdin: "Task from stdin.\n" });
  assert.match(fromStdin.ctx.out(), /^# Task\n\nTask from stdin\.$/m);
  const file = join(project.root, "task.md");
  writeFileSync(file, "Task from a file.\n");
  const fromFile = await project.run(["brief", "execute", "--task-file", file]);
  assert.match(fromFile.ctx.out(), /^# Task\n\nTask from a file\.$/m);
  const prior = join(project.root, "prior.md");
  writeFileSync(prior, "Finding 1 is fixed.\n");
  const withPrior = await project.run(["brief", "review", "--task", "x", "--prior-file", prior]);
  assert.match(withPrior.ctx.out(), /^# Prior rounds\n\nFinding 1 is fixed\.$/m);
});

test("brief rejects bad usage with exit 2", async () => {
  const project = makeProject();
  for (const argv of [
    ["brief"],
    ["brief", "execute"],
    ["brief", "execute", "--task", "x", "--task-file", "-"],
    ["brief", "execute", "--task", "  "],
    ["brief", "execute", "--task", "x", "--round", "0"],
    ["brief", "execute", "--task-file", "-", "--context-file", "-"],
    ["brief", "execute", "extra", "--task", "x"],
  ]) {
    assert.equal((await project.run(argv)).code, 2, argv.join(" "));
  }
});

test("brief fails on an unknown role and on an unavailable role with --json", async () => {
  const project = makeProject();
  const unknown = await project.run(["brief", "nope", "--task", "x"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.ctx.err(), /unknown role nope/);

  project.projectConfig('{ "version": 1, "roles": { "oracle": { "chain": [{ "driver": "grok", "model": "grok-build" }] } } }\n');
  const unavailable = await project.run(["brief", "oracle", "--task", "x", "--json", "--capabilities", CAPS_FILE]);
  assert.equal(unavailable.code, 1);
  assert.equal(unavailable.ctx.out(), "");
  assert.match(unavailable.ctx.err(), /role oracle is unavailable/);
  assert.match(unavailable.ctx.err(), /rung 1: provider grok cannot run child tasks/);
});

test("brief --json --capabilities resolves the target against T3", async () => {
  const { ctx } = await makeProject().runOk(["brief", "execute", "--task", "x", "--json", "--capabilities", CAPS_FILE]);
  assert.deepEqual(parse(ctx.out()).delegateTask.target, {
    providerInstanceId: "claudeAgent",
    model: "claude-opus-5-5",
    options: { effort: "low" },
  });
});

test("brief rejects an invalid --plan or --unit with exit code 2", async () => {
  const project = makeProject();
  for (const flags of [["--plan", "a -->"], ["--plan", "a b"], ["--plan", "A"], ["--unit", "U 1"], ["--unit", "u".repeat(65)]]) {
    const { code, ctx } = await project.run(["brief", "execute", "--task", "x", ...flags]);
    assert.equal(code, 2, flags.join(" "));
    assert.match(ctx.err(), /invalid --(plan|unit)/);
  }
});

test("brief --max-depth overrides the config max depth, and a deeper --depth is a usage error", async () => {
  const project = makeProject();
  const raised = await project.runOk(["brief", "execute", "--task", "x", "--depth", "2", "--max-depth", "3"]);
  assert.match(raised.ctx.out(), /depth=2\/3/);
  assert.match(raised.ctx.out(), /You may delegate with the T3 delegate_task tool\. Give each child depth 3, and pass --max-depth 3 to omt brief\.$/m);

  const tooDeep = await project.run(["brief", "execute", "--task", "x", "--depth", "2"]);
  assert.equal(tooDeep.code, 2);
  assert.match(tooDeep.ctx.err(), /^hint: .*--max-depth/m);

  const qaTooDeep = await project.run(["brief", "qa", "--task", "x", "--depth", "2"]);
  assert.equal(qaTooDeep.code, 2);

  for (const bad of ["4", "-1", "x"]) {
    assert.equal((await project.run(["brief", "execute", "--task", "x", "--max-depth", bad])).code, 2, bad);
  }
});

test("brief adds the evidence line for edit roles only", async () => {
  const project = makeProject();
  const edit = await project.runOk(["brief", "execute", "--task", "x"]);
  const line = `- Evidence: save command output and logs under ${join(project.cwd, ".omt", "evidence")}/.`;
  assert.ok(edit.ctx.out().split("\n").includes(line), edit.ctx.out());
  const readOnly = await project.runOk(["brief", "explore", "--task", "x"]);
  assert.doesNotMatch(readOnly.ctx.out(), /Evidence:/);
});

test("brief exits 1 when the rendered task is longer than 120,000 characters", async () => {
  const { code, ctx } = await makeProject().run(["brief", "execute", "--task", "x", "--context", "c".repeat(120_000)]);
  assert.equal(code, 1);
  assert.equal(ctx.out(), "");
  assert.match(ctx.err(), /^hint: shorten --context or --prior-file/m);
});

test("brief --json --against puts the other family first and prints the notes to stderr", async () => {
  const project = makeProject();
  const codex = await project.runOk(["brief", "review", "--task", "Check U1.", "--against", "codex", "--json"]);
  const output = parse(codex.ctx.out());
  assert.deepEqual(Object.keys(output), ["delegateTask", "fallbacks", "targetKey"]);
  assert.deepEqual(output.delegateTask.target, { providerInstanceId: "claudeAgent", model: "claude-opus-5-5", options: { effort: "medium" } });
  assert.deepEqual(output.fallbacks, [{ providerInstanceId: "codex", model: "gpt-6-astra", options: { reasoningEffort: "medium" } }]);
  assert.equal(codex.ctx.err(), "note: cross-family: worker family codex; other families first\n");

  const claude = await project.run(["brief", "review", "--task", "Check U1.", "--against", "claudeAgent", "--json"]);
  assert.deepEqual(parse(claude.ctx.out()).delegateTask.target, {
    providerInstanceId: "codex",
    model: "gpt-6-astra",
    options: { reasoningEffort: "medium" },
  });
});

test("brief --json --against auto takes the unit's worker from the ledger", async () => {
  const project = makeProject();
  project.writeOmt(
    "ledger.jsonl",
    `${JSON.stringify({ ts: "2026-10-06T00:00:00.000Z", role: "execute", status: "dispatched", plan: "p", unit: "U1", provider: "codex", model: "gpt-6.1-sol" })}\n`,
  );
  const { ctx } = await project.runOk(
    ["brief", "review", "--task", "Check U1.", "--plan", "p", "--unit", "U1", "--against", "auto", "--json"],
  );
  const output = parse(ctx.out());
  assert.equal(output.delegateTask.target.providerInstanceId, "claudeAgent");
  assert.equal(output.delegateTask.clientRequestId, "omt:p:U1:review:r1:a1");
  assert.match(ctx.err(), /^note: --against auto: worker codex from the last work dispatch of unit U1$/m);
});

test("brief --against auto without --plan is a usage error", async () => {
  const { code, ctx } = await makeProject().run(["brief", "review", "--task", "x", "--against", "auto", "--json"]);
  assert.equal(code, 2);
  assert.equal(ctx.out(), "");
  assert.match(ctx.err(), /--against auto needs --plan <slug>/);
});

test("plan, ledger, and brief warn when no .omt or .git is above the current folder", async () => {
  const project = makeProject();
  const outside = join(project.root, "outside");
  mkdirSync(outside, { recursive: true });
  const warned = await project.runOk(["brief", "execute", "--task", "x"], { cwd: outside });
  assert.match(warned.ctx.err(), /^warning: no \.omt or \.git found above .*; omt uses it as the project root\./m);
  const inside = await project.run(["brief", "execute", "--task", "x"]);
  assert.doesNotMatch(inside.ctx.err(), /no \.omt or \.git found/);
});
