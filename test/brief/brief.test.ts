import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { briefTitle, renderBrief } from "../../src/brief/render.ts";
import type { BriefInput } from "../../src/brief/render.ts";
import { findRoleTemplate, loadResultContract } from "../../src/brief/templates.ts";
import type { TemplateRoots } from "../../src/brief/templates.ts";
import type { BriefJsonOutput, RolesReport, RouteOutput } from "../../src/types.ts";
import { CAPS_FILE, makeProject } from "../commands/shared.ts";
import { omtExit, tempDir, writeFile } from "../helpers.ts";
import { LIVE_CAPS_FILE } from "../routing/shared.ts";

const PERSONA = "# Role: execute (persona)\n\nYou implement one unit.\n";
const CONTRACT = "```text\nSTATUS: DONE | BLOCKED | ESCALATE\n```";

const READ_ONLY = "- Access: read-only. Change no files. Run only commands that leave the repository unchanged.";
const EDIT_SCOPED =
  "- Access: edit. Change only the files in Scope. If the task needs a change outside Scope, stop and report it under OPEN.";
const EDIT_FREE = "- Access: edit. Change only what the task needs.";
const PLAN_MODE =
  "- Mode: you run in plan mode. Stay in it. Do not call ExitPlanMode and do not write a proposed plan. Put the result block in your final assistant message.";

function input(fields: Partial<BriefInput> = {}): BriefInput {
  return {
    role: "execute",
    task: "Add the flag.",
    round: 1,
    depth: 1,
    maxDepth: 2,
    access: "edit",
    interactionMode: "default",
    ...fields,
  };
}

test("renderBrief renders every section in order", () => {
  const text = renderBrief(
    input({
      task: "\nAdd the flag.\n",
      context: "The CLI lives in src/.",
      scope: ["src/cli.ts", "test/"],
      done: ["The flag works", "Tests pass"],
      verify: ["pnpm check"],
      prior: "Round 1: missing test.",
      round: 2,
      depth: 2,
      maxDepth: 2,
      plan: "auth",
      unit: "U3",
    }),
    PERSONA,
    `\n${CONTRACT}\n\n`,
  );
  const expected = `<!-- omt-brief v1 role=execute round=2 depth=2/2 plan=auth unit=U3 -->

# Role: execute

# Role: execute (persona)

You implement one unit.

# Task

Add the flag.

# Context

The CLI lives in src/.

# Scope

- \`src/cli.ts\`
- \`test/\`

# Constraints

${EDIT_SCOPED}
- Delegation: you are at depth 2 of 2. Do all work yourself. Start no subagents and no delegated tasks.
- CLI: Run omt as omt.
- Tests: write no new test file and no new test case, and do not prove that tests can fail. Update an existing test only when your change breaks it, and say so under NOTES.
- You do not see the parent conversation. This brief is your full context. If you need something that is missing, say so in your final message.
- Other agents may edit other files in this repository at the same time. Leave changes outside your scope alone. Do not commit, push, or create branches.
- Processes: do not run \`pkill\`, \`killall\`, or another kill by name, because it can stop your own run. Stop only a process that you started, by its PID. Give each command that can run long a time limit, for example \`timeout 900 <command>\`. Close each device or browser session that you or your script opens on every exit path, for example \`trap '<close command>' EXIT\`.
- Shared files: never break and restore files in the shared checkout, for example to prove that a test can fail. The main thread makes that proof in a private copy.
- Shared builds: run a command that the task wraps in \`omt lock run\` exactly as written. Retry a failed build or test only when the file is outside your scope and outside the task's named code under test. The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it. Wait 60 seconds and run the command once more. When it fails there again, report the command, the outside-scope file, and the message as another unit's state. For a failure in your scope or the named code under test, follow your result block. For \`test\` results, return \`VERDICT: NOT VERIFIED\` for that failure. When \`omt lock run\` exits 75, report the command, the lock name, and its message. Leave the lock to the main thread. For both reports: in \`work\` results, keep the \`STATUS\` that your own work earns and put the report under \`OPEN\`. For \`test\` results, including \`qa\`, return \`VERDICT: INCONCLUSIVE\` and put the report under \`FAILURES\`. For other results, put the report under \`NOTES\`, or before the result block when it has no \`NOTES\`.
- Devices: do not drive a device, Simulator UI, browser, or computer yourself (\`agent-device\`, \`agent-browser\`, computer use, UI flows); only the qa role does that. List each device check with its steps and expected result under \`OPEN\` or \`NOTES\`, or before your result block when it has neither; the main thread sends it to the qa task.

# Done when

- The flag works
- Tests pass

# Verify

- \`pnpm check\`

# Prior rounds

Round 1: missing test.

# Final message

End your work with the block below as your final message. Keep it under 60 lines and put nothing after it.

${CONTRACT}
`;
  assert.equal(text, expected);
});

test("renderBrief leaves out empty optional sections but keeps the required ones", () => {
  const text = renderBrief(input({ context: "  ", scope: [], done: [""], verify: [], prior: "" }), PERSONA, CONTRACT);
  assert.match(text, /^<!-- omt-brief v1 role=execute round=1 depth=1\/2 -->\n/);
  for (const heading of ["Role: execute", "Task", "Constraints", "Final message"]) {
    assert.match(text, new RegExp(`^# ${heading}$`, "m"));
  }
  for (const heading of ["Context", "Scope", "Done when", "Verify", "Prior rounds"]) {
    assert.doesNotMatch(text, new RegExp(`^# ${heading}$`, "m"));
  }
  assert.ok(text.endsWith(`${CONTRACT}\n`));
});

test("renderBrief picks the access line from access and scope", () => {
  const lines = (fields: Partial<BriefInput>) => renderBrief(input(fields), PERSONA, CONTRACT).split("\n");
  assert.ok(lines({ access: "read-only", scope: ["src/"] }).includes(READ_ONLY));
  assert.ok(lines({ access: "edit", scope: ["src/"] }).includes(EDIT_SCOPED));
  const free = lines({ access: "edit" });
  assert.ok(free.includes(EDIT_FREE));
  assert.ok(!free.includes(EDIT_SCOPED));
});

test("renderBrief picks the delegation line from depth and maxDepth", () => {
  const below = renderBrief(input({ depth: 1, maxDepth: 3 }), PERSONA, CONTRACT);
  assert.match(
    below,
    /^- Delegation: you are at depth 1 of 3\. You may delegate with the T3 delegate_task tool\. Give each child depth 2 in its brief\.$/m,
  );
  for (const depth of [3, 4]) {
    const at = renderBrief(input({ depth, maxDepth: 3 }), PERSONA, CONTRACT);
    assert.match(
      at,
      new RegExp(
        `^- Delegation: you are at depth ${depth} of 3\\. Do all work yourself\\. Start no subagents and no delegated tasks\\.$`,
        "m",
      ),
    );
  }
});

test("renderBrief gives every role except qa the device hand-off line, and qa an edit-nothing access line", () => {
  const DEVICES = "- Devices: do not drive a device, Simulator UI, browser, or computer yourself (`agent-device`, `agent-browser`, computer use, UI flows); only the qa role does that. List each device check with its steps and expected result under `OPEN` or `NOTES`, or before your result block when it has neither; the main thread sends it to the qa task.";
  for (const fields of [
    { role: "execute", depth: 1, maxDepth: 1 },
    { role: "ui", depth: 1, maxDepth: 2 },
    { role: "review", interactionMode: "plan", access: "read-only", depth: 1, maxDepth: 2 },
  ] as const) {
    const text = renderBrief(input(fields), PERSONA, CONTRACT);
    assert.ok(text.split("\n").includes(DEVICES), fields.role);
    assert.doesNotMatch(text, /omt brief verify|`verify` task/, fields.role);
  }
  const atMax = renderBrief(input({ role: "execute", depth: 1, maxDepth: 1 }), PERSONA, CONTRACT);
  assert.match(atMax, /^- Delegation: you are at depth 1 of 1\. Do all work yourself\. Start no subagents and no delegated tasks\.$/m);
  const qa = renderBrief(input({ role: "qa", scope: ["src/"], depth: 1, maxDepth: 1 }), PERSONA, CONTRACT);
  assert.doesNotMatch(qa, /- Devices:/);
  assert.match(qa, /^- Access: edit no files in the repository\. Write only command output, logs, and screenshots under the Evidence directory\.$/m);
  assert.match(qa, /^- Delegation: you are at depth 1 of 1\. Do all work yourself\. Start no subagents and no delegated tasks\.$/m);
});

test("renderBrief names --max-depth when it differs from the configured max depth", () => {
  const raised = renderBrief(input({ depth: 1, maxDepth: 3, configuredMaxDepth: 1 }), PERSONA, CONTRACT);
  assert.match(
    raised,
    /^- Delegation: you are at depth 1 of 3\. You may delegate with the T3 delegate_task tool\. Give each child depth 2, and pass --max-depth 3 to omt brief\.$/m,
  );
  const same = renderBrief(input({ depth: 1, maxDepth: 3, configuredMaxDepth: 3 }), PERSONA, CONTRACT);
  assert.match(same, /Give each child depth 2 in its brief\.$/m);
});

test("renderBrief preserves plan and explicit profile flags for child briefs", () => {
  for (const [fields, selection] of [
    [{ plan: "dp" }, "--plan dp"],
    [{ profile: "deepp" }, "--profile deepp"],
    [{ plan: "dp", profile: "deepp" }, "--plan dp --profile deepp"],
  ] as const) {
    for (const configuredMaxDepth of [1, 2]) {
      const maxDepthFlag = configuredMaxDepth === 2 ? "" : " --max-depth 2";
      const text = renderBrief(input({ ...fields, configuredMaxDepth }), PERSONA, CONTRACT);
      assert.ok(text.split("\n").includes(`- Delegation: you are at depth 1 of 2. You may delegate with the T3 delegate_task tool. For each child, pass ${selection} --depth 2${maxDepthFlag} to omt brief.`));
      const atMax = renderBrief(input({ ...fields, depth: 2, configuredMaxDepth }), PERSONA, CONTRACT);
      assert.ok(atMax.split("\n").includes("- Delegation: you are at depth 2 of 2. Do all work yourself. Start no subagents and no delegated tasks."));
    }
  }
});

test("renderBrief adds the plan-mode line after the delegation line only in plan mode", () => {
  const plan = renderBrief(input({ interactionMode: "plan", access: "read-only" }), PERSONA, CONTRACT).split("\n");
  const index = plan.indexOf(PLAN_MODE);
  assert.ok(index > 0);
  assert.match(plan[index - 1] ?? "", /^- Delegation: /);
  for (const mode of ["default", "inherit"] as const) {
    assert.ok(!renderBrief(input({ interactionMode: mode }), PERSONA, CONTRACT).includes("Mode: you run in plan mode"));
  }
});

test("renderBrief adds the children line only when the child may start children", () => {
  const CHILDREN = "- Children: after you read a child's result, settle the child with the T3 `t3_thread_organize` tool, with `action: \"settle\"` and the child's `childThreadId`, never the `taskId`. Skip a child that still runs or waits for an answer. Settle nothing when `git rev-parse --git-dir --git-common-dir` prints two different paths, because then you work in a git worktree. A settle error is not a failure of your task.";
  const lines = (fields: Parameters<typeof input>[0]) => renderBrief(input(fields), PERSONA, CONTRACT).split("\n");
  for (const fields of [
    { role: "execute", depth: 1, maxDepth: 2 },
    { role: "qa", depth: 1, maxDepth: 2 },
    { role: "explore", access: "read-only", interactionMode: "plan", depth: 1, maxDepth: 2 },
  ] as const) {
    const text = lines(fields);
    assert.ok(text.includes(CHILDREN), JSON.stringify(fields));
    assert.equal(text[text.indexOf(CHILDREN) + 1], "- CLI: Run omt as omt.", JSON.stringify(fields));
  }
  for (const fields of [
    { role: "execute", depth: 2, maxDepth: 2 },
    { role: "qa", depth: 2, maxDepth: 2 },
    { role: "explore", access: "read-only", interactionMode: "plan", depth: 2, maxDepth: 2 },
  ] as const) {
    assert.ok(!lines(fields).includes(CHILDREN), JSON.stringify(fields));
  }
});

test("briefTitle follows the title rule", () => {
  assert.equal(briefTitle("review", "\n  \n  token refresh  \nmore"), "review: token refresh");
  assert.equal(briefTitle("review", "token refresh", "U3"), "review U3: token refresh");
  assert.equal(briefTitle("review", "token refresh", "U3", 1), "review U3: token refresh");
  assert.equal(briefTitle("review", "token refresh", "U3", 2), "review U3 r2: token refresh");
  assert.equal(briefTitle("review", "token refresh", undefined, 3), "review r3: token refresh");
  const long = briefTitle("execute", "x".repeat(200), "U1");
  assert.equal(long.length, 72);
  assert.ok(long.startsWith("execute U1: xxx"));
});

function fixture(): TemplateRoots & { configDir: string } {
  const root = tempDir();
  const homedir = join(root, "home");
  const configDir = join(root, "config");
  mkdirSync(homedir, { recursive: true });
  return {
    packageRoot: join(root, "pkg"),
    projectRoot: join(root, "project"),
    env: { OMT_CONFIG_DIR: configDir },
    homedir,
    configDir,
  };
}

test("findRoleTemplate uses project, user, package, then the generic template", async () => {
  const roots = fixture();
  const generic = join(roots.packageRoot, "skills", "omt", "references", "roles", "_generic.md");
  const bundled = join(roots.packageRoot, "skills", "omt", "references", "roles", "review.md");
  const user = join(roots.configDir, "roles", "review.md");
  const project = join(roots.projectRoot, ".omt", "roles", "review.md");
  writeFile(generic, "generic");

  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: generic, content: "generic" });
  writeFile(bundled, "bundled");
  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: bundled, content: "bundled" });
  writeFile(user, "user");
  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: user, content: "user" });
  writeFile(project, "project");
  assert.deepEqual(await findRoleTemplate(roots, "review"), { path: project, content: "project" });
  assert.deepEqual(await findRoleTemplate(roots, "custom"), { path: generic, content: "generic" });
});

test("findRoleTemplate fails when no template exists", async () => {
  const roots = fixture();
  await assert.rejects(findRoleTemplate(roots, "review"), omtExit(1));
});

test("findRoleTemplate never reads outside the roles directories for a path-like role", async () => {
  const roots = fixture();
  writeFile(join(roots.packageRoot, "skills", "omt", "references", "roles", "_generic.md"), "generic");
  writeFile(join(roots.packageRoot, "secret.md"), "secret");
  const found = await findRoleTemplate(roots, "../../../secret");
  assert.equal(found.content, "generic");
});

test("loadResultContract reads and trims the contract for a result kind", async () => {
  const roots = fixture();
  writeFile(join(roots.packageRoot, "skills", "omt", "references", "results", "review.md"), `\n${CONTRACT}\n\n`);
  assert.equal(await loadResultContract(roots.packageRoot, "review"), CONTRACT);
  await assert.rejects(loadResultContract(roots.packageRoot, "work"), omtExit(1));
});

test("renderBrief gives every role its test policy, CLI, and shared-build rules", () => {
  for (const role of ["execute", "ui", "writing", "design", "qa", "review", "oracle", "plan-review", "guardrail", "explore", "research", "plan", "custom"]) {
    const text = renderBrief(input({ role, cliCommand: "/project/.omt/bin/omt" }), PERSONA, CONTRACT);
    assert.match(text, /^- CLI: Run omt as \/project\/\.omt\/bin\/omt\.$/m);
    const tests = text.split("\n").find((line) => line.startsWith("- Tests:"));
    assert.ok(tests, role);
    if (["execute", "ui", "writing"].includes(role)) {
      assert.match(tests, /write no new test file and no new test case/);
      assert.match(tests, /do not prove that tests can fail/);
      assert.match(tests, /Update an existing test only when your change breaks it, and say so under NOTES\./);
    } else if (role === "qa") {
      assert.equal(tests, "- Tests: write no tests and no failure proofs. Run the commands in Verify and the task's device flows, and report each command with its exit code and log path.");
    } else if (role === "review" || role === "oracle") {
      assert.equal(tests, "- Tests: a missing test is a finding only when the plan or the task names that test.");
    } else {
      assert.equal(tests, "- Tests: write no tests.");
    }
    assert.match(text, /^- Shared builds: run a command that the task wraps in `omt lock run` exactly as written\./m);
    assert.match(text, /Retry a failed build or test only when the file is outside your scope and outside the task's named code under test\./);
    assert.match(text, /The file is the one where the error occurs, such as a file with a compile or load error, also when a test in your scope loads it\./);
    assert.match(text, /Wait 60 seconds and run the command once more\./);
    assert.match(text, /When it fails there again, report the command, the outside-scope file, and the message as another unit's state\./);
    assert.match(text, /For a failure in your scope or the named code under test, follow your result block\./);
    assert.match(text, /For `test` results, return `VERDICT: NOT VERIFIED` for that failure\./);
    assert.match(text, /When `omt lock run` exits 75, report the command, the lock name, and its message\./);
    assert.match(text, /Leave the lock to the main thread\./);
    assert.match(text, /For both reports: in `work` results, keep the `STATUS` that your own work earns and put the report under `OPEN`\./);
    assert.match(text, /For `test` results, including `qa`, return `VERDICT: INCONCLUSIVE` and put the report under `FAILURES`\./);
    assert.match(text, /For other results, put the report under `NOTES`, or before the result block when it has no `NOTES`\./);
    assert.match(text, /The main thread makes that proof in a private copy\./);
  }
});

test("brief, roles, and route apply configured, plan, and explicit profiles, including model fast settings", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({
    version: 1,
    profile: "configured",
    profiles: {
      configured: {
        description: "Use the configured model without fast mode.",
        models: { "gpt-6.1-sol": { fast: false } },
        roles: { execute: { chain: [{ provider: "codex", driver: "codex", model: "gpt-6.1-sol", effort: "high" }] } },
      },
      planned: { description: "Use fast mode.", extends: "configured", models: { "gpt-6.1-sol": { fast: true } } },
      override: { description: "Disable fast mode.", extends: "planned", models: { "gpt-6.1-sol": { fast: false } } },
    },
  }));
  project.writeOmt("plans/p.md", "<!-- omt-plan v1 slug=p profile=planned -->\n");
  for (const argv of [
    ["brief", "execute", "--task", "x", "--json"],
    ["roles", "--role", "execute", "--json"],
    ["route", "execute"],
  ]) {
    for (const capabilities of [[], ["--capabilities", LIVE_CAPS_FILE]]) {
      for (const [flags, fast] of [
        [[], false],
        [["--plan", "review-x"], false],
        [["--plan", "review-x", "--profile", "planned"], true],
        [["--plan", "p"], true],
        [["--plan", "p", "--profile", "override"], false],
        [["--profile", "planned"], true],
      ] as const) {
        const { ctx } = await project.runOk([...argv, ...capabilities, ...flags]);
        const output = JSON.parse(ctx.out()) as BriefJsonOutput & RouteOutput & RolesReport;
        const target = argv[0] === "roles" ? output.roles.execute?.delegateTask?.target : output.delegateTask?.target;
        assert.deepEqual(target, {
          providerInstanceId: "codex", model: "gpt-6.1-sol",
          options: { reasoningEffort: "high", ...(fast ? { serviceTier: "priority" } : {}) },
        }, [...argv, ...capabilities, ...flags].join(" "));
      }
    }
    const unknown = await project.run([...argv, "--profile", "missing"]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.ctx.err(), /known profiles: normal, prototype, configured, planned, override/);
    const retired = await project.runOk([...argv, "--profile", "pr-review"]);
    assert.match(retired.ctx.err(), /warning --profile: profile "pr-review" is no longer used; normal runs the PR steps\n/);
  }
  const retiredBrief = await project.runOk(["brief", "execute", "--task", "x", "--profile", "pr-review", "--max-depth", "2"]);
  assert.match(retiredBrief.ctx.out(), /--profile normal\b/);
  assert.doesNotMatch(retiredBrief.ctx.out(), /pr-review/);
  const table = await project.runOk(["roles", "--role", "execute", "--plan", "p", "--capabilities", LIVE_CAPS_FILE]);
  assert.match(table.ctx.out(), /codex\/gpt-6.1-sol reasoningEffort=high serviceTier=priority/);
  const missing = await project.run(["profile", "show", "--plan", "review-x", "--json"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.ctx.out(), "");
  assert.match(missing.ctx.err(), /plan "review-x" not found at .*review-x\.md/);
});

test("brief child commands keep profile maxDepth and qa routing", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({
    version: 1,
    profiles: {
      deepp: {
        description: "Allow two worker levels and use Codex for checks.",
        limits: { maxDepth: 2 },
        roles: { qa: { chain: [{ provider: "codex", driver: "codex", model: "gpt-6.1-sol", effort: "low" }] } },
        models: { "gpt-6.1-sol": { fast: false } },
      },
      override: {
        description: "Use fast mode for checks.",
        extends: "deepp",
        models: { "gpt-6.1-sol": { fast: true } },
      },
    },
  }));
  await project.runOk(["plan", "new", "dp", "--profile", "deepp"]);
  for (const [flags, fast] of [
    [["--plan", "dp"], false],
    [["--profile", "deepp"], false],
    [["--plan", "dp", "--profile", "override"], true],
  ] as const) {
    const parent = await project.runOk(["brief", "execute", "--task", "Check the flow.", ...flags]);
    const delegation = parent.ctx.out().split("\n").find((line) => line.startsWith("- Delegation:")) ?? "";
    const childFlags = /For each child, pass (.+) to omt brief\./.exec(delegation)?.[1];
    assert.ok(childFlags, delegation);
    const child = await project.runOk(["brief", "qa", "--task", "Check the flow.", ...childFlags.split(" "), "--json"]);
    const output = JSON.parse(child.ctx.out()) as BriefJsonOutput;
    assert.match(output.delegateTask.task, /depth=2\/2/);
    assert.deepEqual(output.delegateTask.target, {
      providerInstanceId: "codex", model: "gpt-6.1-sol",
      options: { reasoningEffort: "low", ...(fast ? { serviceTier: "priority" } : {}) },
    });
  }
  const deeper = await project.run(["brief", "qa", "--task", "x", "--plan", "dp", "--depth", "3"]);
  assert.equal(deeper.code, 2);
});

test("brief fails for the retired verify, quick, and deep roles like any unknown role", async () => {
  const project = makeProject();
  for (const role of ["verify", "quick", "deep"]) {
    const result = await project.run(["brief", role, "--task", "x"]);
    assert.equal(result.code, 1, role);
    assert.match(result.ctx.err(), new RegExp(`unknown role ${role}; known roles: `), role);
  }
});

test("fast role settings map Opus and print unsupported model notes through each CLI command", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({ version: 1, roles: { execute: { fast: true }, explore: { fast: true, chain: [{ driver: "codex", model: "gpt-6-luna", effort: "low" }, { driver: "claudeAgent", model: "claude-sonnet-5-5", effort: "low" }] }, qa: { chain: [{ driver: "claudeAgent", model: "claude-haiku-5-5", effort: "medium" }, { driver: "claudeAgent", model: "claude-sonnet-5-5", effort: "low" }] } } }));
  const opus = await project.runOk(["brief", "execute", "--task", "x", "--json", "--capabilities", LIVE_CAPS_FILE]);
  assert.equal((JSON.parse(opus.ctx.out()) as BriefJsonOutput).delegateTask.target.options?.fastMode, true);
  const sonnetNote = "fast mode is not offered by claudeAgent/claude-sonnet-5-5";
  for (const capabilities of [[], ["--capabilities", LIVE_CAPS_FILE]]) {
    const brief = await project.runOk(["brief", "explore", "--task", "x", "--json", ...capabilities]);
    assert.match(brief.ctx.err(), new RegExp(sonnetNote));
    const route = await project.runOk(["route", "explore", ...capabilities]);
    const output = JSON.parse(route.ctx.out()) as RouteOutput;
    assert.ok(output.notes.includes(`rung 2: ${sonnetNote}`));
    assert.deepEqual(output.fallbacks[0]?.options, { effort: "low" });
  }
  const table = await project.runOk(["roles", "--role", "qa", "--capabilities", LIVE_CAPS_FILE, "--json"]);
  assert.equal((JSON.parse(table.ctx.out()) as RolesReport).roles.qa?.delegateTask?.target.model, "claude-haiku-5-5");
  project.projectConfig(JSON.stringify({ version: 1, roles: { qa: { fast: true, chain: [{ driver: "claudeAgent", model: "claude-haiku-5-5", effort: "medium" }, { driver: "claudeAgent", model: "claude-sonnet-5-5", effort: "low" }] } } }));
  const unsupported = await project.runOk(["roles", "--role", "qa", "--capabilities", LIVE_CAPS_FILE]);
  assert.match(unsupported.ctx.out(), /rung 1 claudeAgent\/claude-haiku-5-5: fast mode is not offered/);
  const fallback = await project.runOk(["route", "qa", "--capabilities", CAPS_FILE]);
  assert.equal((JSON.parse(fallback.ctx.out()) as RouteOutput).delegateTask?.target.model, "claude-sonnet-5-5");
  project.projectConfig(JSON.stringify({ version: 1, roles: {
    execute: { fast: true, chain: [{ driver: "claudeAgent", model: "claude-opus-5-5", options: { fastMode: false } }] },
    research: { chain: [{ driver: "codex", model: "gpt-6.1-sol", options: { serviceTier: "default" } }] },
  } }));
  for (const [role, expected] of [["execute", { fastMode: false }], ["research", { serviceTier: "default" }]] as const) {
    for (const capabilities of [[], ["--capabilities", LIVE_CAPS_FILE]]) {
      const result = await project.runOk(["brief", role, "--task", "x", "--json", ...capabilities]);
      assert.deepEqual((JSON.parse(result.ctx.out()) as BriefJsonOutput).delegateTask.target.options, expected);
    }
  }
});

test("brief --save writes the full brief and returns a short task and complete ledger command", async () => {
  const project = makeProject();
  project.writeOmt("plans/p.md", "<!-- omt-plan v1 slug=p profile=prototype -->\n");
  project.writeOmt("bin/omt", "#!/bin/sh\n");
  const command = join(project.cwd, ".omt", "bin", "omt");
  const argv = ["brief", "qa", "--task", "Check the main flow.", "--context", "c".repeat(2_000),
    "--plan", "p", "--unit", "U4", "--round", "2", "--attempt", "3", "--capabilities", LIVE_CAPS_FILE, "--json"];
  const full = JSON.parse((await project.runOk(argv)).ctx.out()) as BriefJsonOutput;
  const output = JSON.parse((await project.runOk([...argv, "--save"])).ctx.out()) as BriefJsonOutput;
  const id = "omt:p:U4:qa:r2:a3";
  const path = join(project.cwd, ".omt", "evidence", "briefs", `${id}.md`);
  const text = readFileSync(path, "utf8");
  assert.equal(text, full.delegateTask.task);
  assert.ok(output.delegateTask.task.length <= 600);
  assert.equal(output.delegateTask.task, `Act as the qa sub-agent for this task. Your full brief is in the file ${path}. Read it in full first, then follow it exactly. End with the result block that the brief defines.`);
  assert.deepEqual({ ...output.delegateTask, task: text }, full.delegateTask);
  assert.deepEqual(output.fallbacks, full.fallbacks);
  assert.match(text, new RegExp(`^- CLI: Run omt as ${command.replaceAll(".", "\\.")}\\.$`, "m"));
  assert.match(text, /^- Tests: write no tests and no failure proofs\./m);
  assert.equal(output.ledger?.dispatched,
    `${command} ledger add --plan p --unit U4 --role qa --round 2 --attempt 3 --status dispatched --task-id <taskId> --client-request-id ${id} --provider codex --model gpt-6.1-sol`);
  const recorded = await project.runOk(["ledger", "add", ...output.ledger.dispatched.split(" ledger add ")[1]!.replace("<taskId>", "task-u4").split(" ")]);
  assert.equal((JSON.parse(recorded.ctx.out()) as { clientRequestId: string }).clientRequestId, id);
  assert.equal(existsSync(join(project.cwd, ".omt", "evidence", "briefs", `.${id}.md.tmp`)), false);
  assert.deepEqual(readdirSync(join(project.cwd, ".omt", "evidence", "briefs")), [`${id}.md`]);
});

test("brief --save uses the brief hash without both plan and unit, and omits unset ledger values", async () => {
  const project = makeProject();
  for (const flags of [[], ["--plan", "p"], ["--unit", "U4"]]) {
    const argv = ["brief", "execute", "--task", "x", "--json", ...flags];
    const full = JSON.parse((await project.runOk(argv)).ctx.out()) as BriefJsonOutput;
    const hash = createHash("sha256").update(full.delegateTask.task).digest("hex").slice(0, 12);
    const path = join(project.cwd, ".omt", "evidence", "briefs", `execute-${hash}.md`);
    const output = JSON.parse((await project.runOk([...argv, "--save"])).ctx.out()) as BriefJsonOutput;
    assert.equal(readFileSync(path, "utf8"), full.delegateTask.task);
    assert.ok(output.delegateTask.task.includes(path));
    assert.equal(output.delegateTask.clientRequestId, undefined);
    assert.ok(output.ledger);
    assert.ok(output.ledger.dispatched.includes("--task-id <taskId>"));
    assert.doesNotMatch(output.ledger.dispatched, /undefined|null|--client-request-id/);
    assert.equal(output.ledger.dispatched.includes("--plan p"), flags.includes("--plan"));
    assert.equal(output.ledger.dispatched.includes("--unit U4"), flags.includes("--unit"));
    assert.match(full.delegateTask.task, /^- CLI: Run omt as omt\.$/m);
  }
});

test("brief --save writes no brief for an unavailable route", async () => {
  const project = makeProject();
  project.projectConfig(JSON.stringify({ version: 1, roles: { execute: { chain: [{ driver: "missing", model: "m" }] } } }));
  const result = await project.run(["brief", "execute", "--task", "x", "--save", "--json", "--capabilities", LIVE_CAPS_FILE]);
  assert.equal(result.code, 1);
  assert.equal(result.ctx.out(), "");
  assert.equal(existsSync(join(project.cwd, ".omt", "evidence", "briefs")), false);
});
