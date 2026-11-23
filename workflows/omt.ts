// oh-my-t3 (omt) workflows. omt install and omt update write this file, and omt uninstall removes it.
// Edits are kept: omt does not replace a file that differs from the copy it wrote.
//
// omt-ulw: the review, fix, and QA steps of omt-ulw on a committed build.
// omt-code-review: the report-only reviewers and the oracle of omt-code-review.
// Each run ends by sending a short message to the thread that started it, because T3 does not wake that thread.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { workflow, step, agent, ask, stop, title } = T3;

// ---------- shared ----------

const exec = (command: string, args: readonly string[], cwd: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) =>
        execFile(command, [...args], { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
          error ? reject(new Error(`${[command, ...args].join(" ").slice(0, 300)} failed: ${stderr.trim() || error.message}`)) : resolve(stdout),
        ),
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

const Model = Schema.Struct({
  instanceId: Schema.String,
  model: Schema.String,
  options: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.Union([Schema.String, Schema.Boolean]) })),
});
type Model = typeof Model.Type;

const Routed = Schema.Struct({
  brief: Schema.String,
  title: Schema.String,
  interactionMode: Schema.String,
  targets: Schema.Array(Model),
});
type Routed = typeof Routed.Type;

interface Target {
  providerInstanceId?: string;
  driverKind?: string;
  model: string;
  options?: Record<string, string | boolean>;
}

const toModel = (target: Target): Model => ({
  instanceId: target.providerInstanceId ?? target.driverKind ?? "",
  model: target.model,
  options: Object.entries(target.options ?? {}).map(([id, value]) => ({ id, value })),
});

interface BriefArgs {
  role: string;
  unit: string;
  round: number;
  task: string;
  context?: string;
  scope?: readonly string[];
  verify?: readonly string[];
  against?: string;
}

// Renders the role's brief with omt and routes the role: the first target, then its fallbacks.
const route = (omt: readonly string[], cwd: string, plan: string, args: BriefArgs) =>
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), "omt-workflow-"));
    try {
      writeFileSync(join(dir, "task.md"), args.task);
      const flags = [
        "brief", args.role, "--task-file", join(dir, "task.md"),
        "--plan", plan, "--unit", args.unit, "--round", String(args.round), "--workflow", "--json",
      ];
      if (args.context !== undefined && args.context.trim() !== "") {
        writeFileSync(join(dir, "context.md"), args.context);
        flags.push("--context-file", join(dir, "context.md"));
      }
      for (const path of args.scope ?? []) flags.push("--scope", path);
      for (const command of args.verify ?? []) flags.push("--verify", command);
      if (args.against !== undefined && args.against !== "") flags.push("--against", args.against, "--strict");
      const [command, ...prefix] = omt;
      const out = JSON.parse(yield* exec(command ?? "omt", [...prefix, ...flags], cwd)) as {
        delegateTask: { task: string; title: string; target: Target; interactionMode: string };
        fallbacks: Target[];
      };
      const routed: Routed = {
        brief: out.delegateTask.task,
        title: out.delegateTask.title,
        interactionMode: out.delegateTask.interactionMode,
        targets: [out.delegateTask.target, ...out.fallbacks].map(toModel),
      };
      return routed;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

const modeOf = (mode: string) => (mode === "plan" || mode === "default" ? mode : undefined);

// Walks the routed targets with agent.try. It moves to the next target only when T3 could not start
// the agent; an agent that ran and failed ends the walk.
const runRouted = <A, I>(
  name: string,
  routed: Routed,
  options: { project: string; returns: Schema.Codec<A, I>; workspace?: unknown; interactionMode?: string; timeout: string },
) =>
  Effect.gen(function* () {
    let reason = "no target";
    for (const [index, model] of routed.targets.entries()) {
      const mode = options.interactionMode ?? modeOf(routed.interactionMode);
      const attempt = yield* agent.try(`${name}/${index + 1}`, {
        project: options.project,
        brief: routed.brief,
        title: routed.title,
        model,
        returns: options.returns,
        timeout: options.timeout,
        ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
        ...(mode === undefined ? {} : { interactionMode: mode }),
      });
      if (attempt.outcome === "done") return attempt;
      reason = attempt.reason;
      if (attempt.thread !== undefined) break;
    }
    return { outcome: "failed" as const, reason };
  });

const wake = (thread: string, message: string, cwd: string) =>
  exec("t3", ["thread", "send", thread, message], cwd).pipe(Effect.as(message));

const Finding = Schema.Struct({
  severity: Schema.Literals(["P0", "P1", "P2", "P3"]),
  location: Schema.String,
  problem: Schema.String,
  scenario: Schema.String,
  fix: Schema.String,
});

const Report = Schema.Struct({
  verdict: Schema.Literals(["APPROVE", "REQUEST_CHANGES", "BLOCK"]),
  summary: Schema.String,
  findings: Schema.Array(Finding),
  notes: Schema.Array(Schema.String),
});

const Omt = Schema.Array(Schema.String);

// ---------- omt-ulw ----------

const UlwInput = Schema.Struct({
  project: Schema.String, // the T3 project folder: omt paths --root
  plan: Schema.String,
  round: Schema.Number,
  base: Schema.String, // the commit before the build
  head: Schema.String, // the build commit
  review: Schema.Literals(["review", "oracle", "off"]),
  family: Schema.String, // the main thread's driver, for the cross-family review
  context: Schema.String, // objective, done conditions, plan Summary
  scope: Schema.Array(Schema.String),
  checks: Schema.Array(Schema.String), // every verify command and final check
  flows: Schema.String, // device flows, each with steps and the expected result; or ""
  thread: Schema.String, // the main thread to wake
  omt: Omt, // how to run omt, such as ["omt"] or ["/repo/.omt3/bin/omt"]
});

const Reviewed = Schema.Struct({
  ...Report.fields,
  fixes: Schema.Array(Schema.String),
  head: Schema.String,
});

const Check = Schema.Struct({ command: Schema.String, exit: Schema.Number, log: Schema.String });

const Qa = Schema.Struct({
  verdict: Schema.Literals(["VERIFIED", "NOT VERIFIED", "INCONCLUSIVE"]),
  checks: Schema.Array(Check),
  failures: Schema.Array(Schema.String),
  evidence: Schema.Array(Schema.String),
});

const Fixed = Schema.Struct({ fixes: Schema.Array(Schema.String), head: Schema.String });

const worktree = (baseRef: string) => ({ type: "worktree", baseRef, startFromOrigin: false });

const reviewTask = (input: typeof UlwInput.Type) =>
  [
    `Review the build of plan ${input.plan}. Your worktree starts at the build commit ${input.head}.`,
    `Get the change with \`git diff ${input.base}..${input.head} -- <scope paths>\` and read each changed file in full. Leave \`docs/design/\` out.`,
    "Fix each local finding yourself: a clear fix inside the changed files that agrees with the plan Summary. Run the verify commands that cover the fix, then commit the fixes in your worktree.",
    "Report every other finding with its fix. List your fixes under fixes, and give `git rev-parse HEAD` as head, also when you changed nothing.",
  ].join("\n\n");

const qaTask = (input: typeof UlwInput.Type, head: string, checks: readonly string[]) =>
  [
    `Run the checks of plan ${input.plan} on commit ${head}, which your worktree starts at. The code under test is the scope paths.`,
    `Run each command in Verify and report its exit code and log path.${input.flows.trim() === "" ? "" : `\n\nRun these device flows and save a screenshot of each:\n\n${input.flows}`}`,
    `Commands:\n${checks.map((command) => `- \`${command}\``).join("\n")}`,
  ].join("\n\n");

const fixTask = (qa: typeof Qa.Type) =>
  [
    "QA ran on your commits, and these checks failed:",
    qa.checks.filter((check) => check.exit !== 0).map((check) => `- \`${check.command}\` exit ${check.exit}, log ${check.log}`).join("\n"),
    qa.failures.map((failure) => `- ${failure}`).join("\n"),
    "Find the cause in each log, fix it in the changed files, run the check yourself, and commit the fix. Give your fixes and `git rev-parse HEAD` as head.",
  ].join("\n\n");

const UlwResult = Schema.Struct({
  outcome: Schema.Literals(["verified", "checks-failed", "blocked"]),
  head: Schema.String,
  review: Schema.NullOr(Reviewed),
  fixes: Schema.Array(Schema.String),
  qa: Schema.NullOr(Qa),
  qaRuns: Schema.Number,
});

const ulwOnEnd = (input: typeof UlwInput.Type, end: { id: string; outcome: string; reason?: string }) =>
  end.outcome === "completed"
    ? Effect.void
    : wake(
        input.thread,
        `omt-ulw workflow run ${end.id} for plan ${input.plan} ${end.outcome}: ${end.reason ?? "no reason"}. Run omt-ulw steps 8 to 11 in the thread.`,
        input.project,
      ).pipe(Effect.asVoid);

workflow(
  "omt-ulw",
  { version: 1, payload: UlwInput, returns: UlwResult, onEnd: ulwOnEnd },
  Effect.fn(function* (input, run) {
    yield* title(`omt-ulw ${input.plan} r${input.round}`);
    let head = input.head;
    let review: typeof Reviewed.Type | null = null;
    let fixer: { threadId: string } | undefined;
    const fixes: string[] = [];

    if (input.review !== "off") {
      const routed = yield* step.try(
        "route-review",
        { returns: Routed },
        route(input.omt, input.project, input.plan, {
          role: input.review,
          unit: input.review === "oracle" ? "F2" : "REVIEW",
          round: input.round,
          task: reviewTask(input),
          context: input.context,
          scope: input.scope,
          verify: input.checks,
          against: input.family,
        }),
      );
      if (routed.outcome === "failed") return yield* stop(`no ${input.review} target: ${routed.reason}`);
      const reviewed = yield* runRouted("review", routed.value, {
        project: input.project,
        returns: Reviewed,
        workspace: worktree(input.head),
        timeout: "3 hours",
      });
      if (reviewed.outcome === "failed") return yield* stop(`the ${input.review} agent failed: ${reviewed.reason}`);
      review = reviewed.value;
      fixer = reviewed.thread;
      head = review.head;
      fixes.push(...review.fixes);
    }

    let qa: typeof Qa.Type | null = null;
    let qaRuns = 0;
    if (review?.verdict !== "BLOCK") {
      let checks: readonly string[] = input.checks;
      // One QA run, then at most 2 re-runs of the failed checks, each after a fix.
      for (let round = 1; round <= 3; round++) {
        const routed = yield* step.try(
          `route-qa-${round}`,
          { returns: Routed },
          route(input.omt, input.project, input.plan, {
            role: "qa",
            unit: "QA",
            round,
            task: qaTask(input, head, checks),
            context: input.context,
            scope: input.scope,
            verify: checks,
          }),
        );
        if (routed.outcome === "failed") return yield* stop(`no qa target: ${routed.reason}`);
        const tested = yield* runRouted(`qa-${round}`, routed.value, {
          project: input.project,
          returns: Qa,
          workspace: worktree(head),
          timeout: "2 hours",
        });
        if (tested.outcome === "failed") return yield* stop(`the qa agent failed: ${tested.reason}`);
        qa = tested.value;
        qaRuns = round;
        if (qa.verdict === "VERIFIED" || round === 3) break;
        const failed = qa.checks.filter((check) => check.exit !== 0).map((check) => check.command);
        checks = failed.length > 0 ? failed : checks;

        let fixed;
        if (fixer !== undefined) {
          fixed = yield* agent.try(`fix-${round}`, { thread: fixer, brief: fixTask(qa), returns: Fixed, timeout: "2 hours" });
        } else {
          const routedFix = yield* step.try(
            `route-fix-${round}`,
            { returns: Routed },
            route(input.omt, input.project, input.plan, {
              role: "execute",
              unit: "QAFIX",
              round,
              task: fixTask(qa),
              context: input.context,
              scope: input.scope,
              verify: checks,
            }),
          );
          if (routedFix.outcome === "failed") return yield* stop(`no execute target: ${routedFix.reason}`);
          fixed = yield* runRouted(`fix-${round}`, routedFix.value, {
            project: input.project,
            returns: Fixed,
            workspace: worktree(head),
            timeout: "2 hours",
          });
        }
        if (fixed.outcome === "failed") return yield* stop(`the fix of the failed checks failed: ${fixed.reason}`);
        fixer = fixed.thread;
        head = fixed.value.head;
        fixes.push(...fixed.value.fixes);
      }
    }

    const outcome = review?.verdict === "BLOCK" ? "blocked" : qa?.verdict === "VERIFIED" ? "verified" : "checks-failed";
    const result: typeof UlwResult.Type = { outcome, head, review, fixes, qa, qaRuns };
    yield* step(
      "wake",
      { returns: Schema.String },
      wake(
        input.thread,
        [
          `omt-ulw workflow run ${run.id} for plan ${input.plan}: ${outcome}.`,
          `Review ${review?.verdict ?? "off"}, ${fixes.length} fixes, QA ${qa?.verdict ?? "not run"} after ${qaRuns} runs.`,
          head === input.head ? "No new commits." : `Merge the fixes with: git merge --ff-only ${head}`,
          `Read the result with: t3 workflow show ${run.id} --json`,
        ].join(" "),
        input.project,
      ),
    );
    return result;
  }),
);

// ---------- omt-code-review ----------

const Group = Schema.Struct({
  unit: Schema.String, // G1, G2.codex, oracle, FIX
  role: Schema.Literals(["review", "oracle"]),
  task: Schema.String, // the group's diff command, paths, and intent
  against: Schema.String, // the author's driver for --against, or ""
});

const ReviewInput = Schema.Struct({
  project: Schema.String, // the T3 project folder: omt paths --root
  checkout: Schema.String, // the git checkout that holds the change: git rev-parse --show-toplevel
  slug: Schema.String,
  round: Schema.Number,
  intent: Schema.String, // what the change does, and the rule files
  groups: Schema.Array(Group),
  oracle: Schema.NullOr(Schema.String), // the oracle's --against family, or null for no oracle pass
  fixLoop: Schema.Boolean, // ask before the main thread fixes
  thread: Schema.String,
  omt: Omt,
});

const Oracle = Schema.Struct({
  ...Report.fields,
  refuted: Schema.Array(Schema.String),
});

const ReviewResult = Schema.Struct({
  groups: Schema.Array(Schema.Struct({ unit: Schema.String, report: Report })),
  oracle: Schema.NullOr(Oracle),
  fix: Schema.Literals(["approved", "declined", "not asked"]),
});

const reportOnly = (input: typeof ReviewInput.Type, task: string) =>
  [
    `The change lives in the git checkout \`${input.checkout}\`. Run each git command there with \`git -C ${input.checkout}\`, and read files from there.`,
    task,
    "Report every finding with its fix. Change no files.",
  ].join("\n\n");

const reviewOnEnd = (input: typeof ReviewInput.Type, end: { id: string; outcome: string; reason?: string }) =>
  end.outcome === "completed"
    ? Effect.void
    : wake(
        input.thread,
        `omt-code-review workflow run ${end.id} for review-${input.slug} ${end.outcome}: ${end.reason ?? "no reason"}. Run the omt-code-review steps in the thread.`,
        input.project,
      ).pipe(Effect.asVoid);

workflow(
  "omt-code-review",
  { version: 1, payload: ReviewInput, returns: ReviewResult, onEnd: reviewOnEnd },
  Effect.fn(function* (input, run) {
    yield* title(`omt-code-review ${input.slug} r${input.round}`);
    const plan = `review-${input.slug}`;
    const reviewGroup = (group: typeof Group.Type) =>
      Effect.gen(function* () {
        const routed = yield* step.try(
          `route-${group.unit}`,
          { returns: Routed },
          route(input.omt, input.project, plan, {
            role: group.role,
            unit: group.unit,
            round: input.round,
            task: reportOnly(input, group.task),
            context: input.intent,
            against: group.against,
          }),
        );
        if (routed.outcome === "failed") return yield* stop(`no ${group.role} target for ${group.unit}: ${routed.reason}`);
        const reviewed = yield* runRouted(`review-${group.unit}`, routed.value, {
          project: input.project,
          returns: Report,
          interactionMode: "plan",
          timeout: "2 hours",
        });
        if (reviewed.outcome === "failed") return yield* stop(`the reviewer of ${group.unit} failed: ${reviewed.reason}`);
        return { unit: group.unit, report: reviewed.value };
      });
    const groups = yield* Effect.all(input.groups.map(reviewGroup), { concurrency: 4 });

    let oracle: typeof Oracle.Type | null = null;
    if (input.oracle !== null) {
      const findings = groups.flatMap((group) =>
        group.report.findings.map((finding) => `- [${finding.severity}] ${finding.location} ${finding.problem} Scenario: ${finding.scenario} Fix: ${finding.fix}`),
      );
      const routed = yield* step.try(
        "route-oracle",
        { returns: Routed },
        route(input.omt, input.project, plan, {
          role: "oracle",
          unit: "oracle",
          round: input.round,
          task: reportOnly(
            input,
            [
              "Check the findings of the reviewers below against the whole change, without `docs/design/`. Confirm or refute each one with evidence, and report what they missed.",
              "Return the confirmed findings and your new ones under findings, and each refuted finding with the reason under refuted.",
              input.groups.map((group) => group.task).join("\n\n"),
              findings.length > 0 ? `Findings:\n${findings.join("\n")}` : "Findings: none",
            ].join("\n\n"),
          ),
          context: input.intent,
          against: input.oracle,
        }),
      );
      if (routed.outcome === "failed") return yield* stop(`no oracle target: ${routed.reason}`);
      const checked = yield* runRouted("oracle", routed.value, {
        project: input.project,
        returns: Oracle,
        interactionMode: "plan",
        timeout: "2 hours",
      });
      if (checked.outcome === "failed") return yield* stop(`the oracle failed: ${checked.reason}`);
      oracle = checked.value;
    }

    const final = oracle?.findings ?? groups.flatMap((group) => group.report.findings);
    const fixable = final.filter((finding) => finding.severity !== "P3");
    let fix: "approved" | "declined" | "not asked" = "not asked";
    if (input.fixLoop && fixable.length > 0) {
      const answer = yield* ask("fix", {
        title: `review-${input.slug}: let the main thread fix ${fixable.length} P0 to P2 findings?`,
        choices: ["fix", "report only"],
        data: { findings: fixable },
        timeout: "2 days",
      });
      fix = Option.isSome(answer) && answer.value.choice === "fix" ? "approved" : "declined";
    }

    const verdicts = [...groups.map((group) => `${group.unit} ${group.report.verdict}`), ...(oracle === null ? [] : [`oracle ${oracle.verdict}`])];
    yield* step(
      "wake",
      { returns: Schema.String },
      wake(
        input.thread,
        [
          `omt-code-review workflow run ${run.id} for review-${input.slug} r${input.round}: ${verdicts.join(", ")}.`,
          `${final.length} findings, ${fixable.length} of them P0 to P2. Fix loop: ${fix}.`,
          `Read the result with: t3 workflow show ${run.id} --json`,
        ].join(" "),
        input.project,
      ),
    );
    return { groups, oracle, fix };
  }),
);
