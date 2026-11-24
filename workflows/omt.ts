// oh-my-t3 (omt) workflows. omt install and omt update write this file, and omt uninstall removes it.
// Edits are kept: omt does not replace a file that differs from the copy it wrote.
//
// omt-ulw: the review, fix, and QA steps of omt-ulw on a committed build.
// omt-code-review: the report-only reviewers and the oracle of omt-code-review.
// omt-climb: the rounds of gates, blind judges, and changes of omt-climb, which runs only as this workflow.
// Each run ends by sending a short message to the thread that started it, because T3 does not wake that thread.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

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

// ---------- omt-climb ----------

// The climb rules: pure functions of the scores, exported for test/workflows.test.ts.

export type Direction = "up" | "down";
export const CURRENT = "current";
export const BASELINE = "baseline";
const EPSILON = 1e-9;
const EXTRA_ROUNDS = 5; // the rounds that an owner's "raise limit" or "change approach" adds at least
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface ClimbJudge {
  name: string;
  tier: number; // tier 1 scores every round; tier n+1 scores a round only after tiers 1 to n meet the target in it
  command: string; // a command that prints one number, or "" for a model judge
}

export interface ClimbScore {
  round: number;
  judge: string;
  subject: string; // current, baseline, or a reference
  value: number; // the worst category
}

export interface ClimbState {
  target: number;
  direction: Direction;
  maxRounds: number;
  plateau: { rounds: number; minGain: number };
  since: number; // the round in which the owner chose to go on; the plateau window starts there
  judges: readonly ClimbJudge[];
  beat: readonly string[]; // references that current must score better than, for each model judge
  round: number;
  scores: readonly ClimbScore[];
}

export interface ClimbNext {
  action: "score" | "change" | "met" | "plateau" | "limit";
  tier?: number; // with score: the tier that scores the round next
  reason: string;
}

export interface ClimbSettings {
  target: number;
  direction: Direction;
  maxRounds: number;
  plateau: { rounds: number; minGain: number };
  judges: readonly ClimbJudge[];
  references: readonly { name: string; files: readonly string[] }[];
  beat: readonly string[];
  categories: readonly string[];
  capture: string;
}

const format = (value: number) => String(Number(value.toFixed(2)));

const better = (direction: Direction, a: number, b: number) => (direction === "up" ? a > b : a < b);

export function meets(state: Pick<ClimbState, "direction" | "target">, value: number): boolean {
  return state.direction === "up" ? value >= state.target - EPSILON : value <= state.target + EPSILON;
}

const scoreOf = (scores: readonly ClimbScore[], round: number, judge: string, subject: string) =>
  scores.find((score) => score.round === round && score.judge === judge && score.subject === subject);

// The rise of a judge's baseline score since the first round in which it scored the baseline.
// A round without a baseline score from the judge gets no correction.
export function drift(scores: readonly ClimbScore[], judge: string, round: number): number {
  const first = scores.filter((score) => score.judge === judge && score.subject === BASELINE).sort((a, b) => a.round - b.round)[0];
  const now = scoreOf(scores, round, judge, BASELINE);
  return first === undefined || now === undefined ? 0 : now.value - first.value;
}

export function calibrated(scores: readonly ClimbScore[], judge: string, round: number): number | undefined {
  const score = scoreOf(scores, round, judge, CURRENT);
  return score === undefined ? undefined : score.value - drift(scores, judge, round);
}

// The gain toward the target from round a to round b: the worst calibrated score among the judges that scored both.
export function progress(state: ClimbState, a: number, b: number): number | undefined {
  const sign = state.direction === "up" ? 1 : -1;
  const common = state.judges.filter(
    (judge) => calibrated(state.scores, judge.name, a) !== undefined && calibrated(state.scores, judge.name, b) !== undefined,
  );
  if (common.length === 0) return undefined;
  const at = (round: number) => Math.min(...common.map((judge) => sign * (calibrated(state.scores, judge.name, round) as number)));
  return at(b) - at(a);
}

export function nextAction(state: ClimbState): ClimbNext {
  const round = state.round;
  const has = (judge: ClimbJudge) => scoreOf(state.scores, round, judge.name, CURRENT) !== undefined;
  const scored = state.judges.filter(has);
  const top = scored.length === 0 ? Math.min(...state.judges.map((judge) => judge.tier)) : Math.max(...scored.map((judge) => judge.tier));
  const due = state.judges.filter((judge) => judge.tier <= top);
  const missing = due.filter((judge) => !has(judge));
  if (missing.length > 0) {
    return {
      action: "score",
      tier: Math.min(...missing.map((judge) => judge.tier)),
      reason: `round ${round} needs a score from ${missing.map((judge) => judge.name).join(", ")}`,
    };
  }
  const failures: string[] = [];
  for (const judge of due) {
    const value = calibrated(state.scores, judge.name, round) as number;
    if (!meets(state, value)) failures.push(`${judge.name} ${format(value)} ${state.direction === "up" ? "<" : ">"} ${format(state.target)}`);
    if (judge.command !== "") continue;
    const own = (scoreOf(state.scores, round, judge.name, CURRENT) as ClimbScore).value;
    for (const subject of state.beat) {
      const other = scoreOf(state.scores, round, judge.name, subject);
      if (other === undefined) failures.push(`${judge.name} gave no score for ${subject}`);
      else if (!better(state.direction, own, other.value)) failures.push(`${judge.name} scored ${subject} ${format(other.value)}, ${CURRENT} ${format(own)}`);
    }
  }
  if (failures.length === 0) {
    const higher = state.judges.filter((judge) => judge.tier > top).map((judge) => judge.tier);
    if (higher.length === 0) return { action: "met", reason: `every judge meets the target in round ${round}` };
    return { action: "score", tier: Math.min(...higher), reason: `tiers 1 to ${top} meet the target in round ${round}` };
  }
  const reason = failures.join("; ");
  if (round >= state.maxRounds) return { action: "limit", reason: `round ${round} is the last of ${state.maxRounds}: ${reason}` };
  const from = round - state.plateau.rounds;
  if (from >= Math.max(1, state.since)) {
    const gain = progress(state, from, round);
    if (gain !== undefined && gain < state.plateau.minGain - EPSILON) {
      return {
        action: "plateau",
        reason: `the gain over the last ${state.plateau.rounds} rounds is ${format(gain)}, below ${format(state.plateau.minGain)}: ${reason}`,
      };
    }
  }
  return { action: "change", reason };
}

// Shuffles the subjects with the random bytes of the round and names them A, B, ..., Z, AA, ...
export function blindLabels(bytes: readonly number[], subjects: readonly string[]): Record<string, string> {
  const order = [...subjects];
  for (let i = order.length - 1; i > 0; i--) {
    const j = (bytes.length === 0 ? 0 : (bytes[i % bytes.length] ?? 0)) % (i + 1);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  const labels: Record<string, string> = {};
  order.forEach((subject, index) => {
    let label = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
    labels[label] = subject;
  });
  return labels;
}

// Maps a judge's scores by label to the subjects. A subject's value is its lowest category.
export function readScores(
  labels: Readonly<Record<string, string>>,
  categories: readonly string[],
  result: { scores: readonly { label: string; category: string; score: number }[] },
): { values: { subject: string; value: number }[]; errors: string[] } {
  const errors: string[] = [];
  const values: { subject: string; value: number }[] = [];
  for (const entry of result.scores) {
    if (!(entry.label.toUpperCase() in labels)) errors.push(`unknown label ${entry.label}`);
  }
  for (const [label, subject] of Object.entries(labels)) {
    const got: number[] = [];
    for (const category of categories) {
      const matches = result.scores.filter((s) => s.label.toUpperCase() === label && s.category.toLowerCase() === category.toLowerCase());
      const entry = matches[0];
      if (entry === undefined) errors.push(`no ${category} score for ${label}`);
      else if (matches.length > 1) errors.push(`${label} ${category} is scored ${matches.length} times`);
      else if (!Number.isFinite(entry.score) || entry.score < 0 || entry.score > 10) errors.push(`${label} ${category}: ${entry.score} is not 0 to 10`);
      else got.push(entry.score);
    }
    if (got.length === categories.length) values.push({ subject, value: Math.min(...got) });
  }
  return { values, errors };
}

// The number on the last line that a scorer command prints.
export function parseScore(stdout: string): number | undefined {
  const last = stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  const value = last === "" ? Number.NaN : Number(last);
  return Number.isFinite(value) ? value : undefined;
}

export function climbInputErrors(settings: ClimbSettings): string[] {
  const errors: string[] = [];
  const positive = (value: number) => Number.isInteger(value) && value >= 1;
  if (!Number.isFinite(settings.target)) errors.push("target is not a number");
  if (!positive(settings.maxRounds)) errors.push("maxRounds is not a whole number of 1 or more");
  if (!positive(settings.plateau.rounds)) errors.push("plateau.rounds is not a whole number of 1 or more");
  if (!(settings.plateau.minGain >= 0)) errors.push("plateau.minGain is below 0");
  if (settings.judges.length === 0) errors.push("no judge");
  const names = (kind: string, list: readonly string[]) => {
    for (const name of list) if (!NAME_RE.test(name)) errors.push(`invalid ${kind} name "${name}"`);
    for (const name of new Set(list.filter((name, index) => list.indexOf(name) !== index))) errors.push(`${kind} "${name}" is given twice`);
  };
  names("judge", settings.judges.map((judge) => judge.name));
  names("reference", settings.references.map((reference) => reference.name));
  names("category", settings.categories);
  for (const judge of settings.judges) {
    if (!Number.isInteger(judge.tier) || judge.tier < 1 || judge.tier > 9) errors.push(`judge ${judge.name}: tier ${judge.tier} is not 1 to 9`);
  }
  for (const reference of settings.references) {
    if (reference.name === CURRENT || reference.name === BASELINE) errors.push(`a reference cannot be named ${reference.name}`);
    if (reference.files.length === 0) errors.push(`reference ${reference.name} has no file`);
  }
  for (const subject of settings.beat) {
    if (!settings.references.some((reference) => reference.name === subject)) errors.push(`beat names ${subject}, which is not a reference`);
  }
  const models = settings.judges.some((judge) => judge.command === "");
  if (models && settings.capture.trim() === "") errors.push("a model judge needs a capture command");
  if (models && settings.direction !== "up") errors.push("model judges score 0 to 10, higher is better, so direction must be up");
  if (!models && settings.beat.length > 0) errors.push("beat needs a model judge");
  return errors;
}

// A Markdown table of each judge and subject by round. A calibrated current value shows its raw value in parentheses.
export function climbTable(state: ClimbState): string {
  const rounds = Array.from({ length: state.round }, (_, index) => index + 1);
  const others = [...new Set(state.scores.map((score) => score.subject))].filter((subject) => subject !== CURRENT && subject !== BASELINE).sort();
  const subjects = [CURRENT, BASELINE, ...others];
  const cell = (judge: string, subject: string, round: number) => {
    const score = scoreOf(state.scores, round, judge, subject);
    if (score === undefined) return "-";
    if (subject !== CURRENT) return format(score.value);
    const value = calibrated(state.scores, judge, round) as number;
    return value === score.value ? format(value) : `${format(value)} (${format(score.value)})`;
  };
  const rows = state.judges.flatMap((judge) =>
    subjects
      .filter((subject) => subject === CURRENT || state.scores.some((score) => score.judge === judge.name && score.subject === subject))
      .map((subject) => `| ${judge.name} | ${judge.tier} | ${subject} | ${rounds.map((round) => cell(judge.name, subject, round)).join(" | ")} |`),
  );
  return [
    `| Judge | Tier | Subject | ${rounds.map((round) => `R${round}`).join(" | ")} |`,
    `| --- | --- | --- | ${rounds.map(() => "---").join(" | ")} |`,
    ...rows,
  ].join("\n");
}

// The workflow.

const ClimbJudgeInput = Schema.Struct({
  name: Schema.String,
  tier: Schema.Number,
  against: Schema.String, // a model judge's --against driver, or ""
  command: Schema.String, // a scorer command that prints one number, or "" for a model judge
});

const ClimbInput = Schema.Struct({
  project: Schema.String, // the T3 project folder: omt paths --root
  checkout: Schema.String, // the git checkout at head, where round 1 runs the gates and the capture
  slug: Schema.String,
  head: Schema.String, // the commit that round 1 scores
  goal: Schema.String, // the objective and its limits, for the change agent only
  rubric: Schema.String, // what a model judge scores; it names no target
  categories: Schema.Array(Schema.String), // empty: one category, overall
  target: Schema.Number,
  direction: Schema.Literals(["up", "down"]),
  maxRounds: Schema.Number,
  plateau: Schema.Struct({ rounds: Schema.Number, minGain: Schema.Number }),
  judges: Schema.Array(ClimbJudgeInput),
  references: Schema.Array(Schema.Struct({ name: Schema.String, files: Schema.Array(Schema.String) })),
  beat: Schema.Array(Schema.String), // references that current must score better than
  gates: Schema.Array(Schema.String), // commands that must pass before a round is scored
  capture: Schema.String, // writes the files of the current code to $OMT_CLIMB_OUT; "" with only command judges
  change: Schema.Literals(["execute", "ui"]), // the role of the change agent
  evidence: Schema.String, // omt paths --evidence
  thread: Schema.String,
  omt: Omt,
});
type ClimbInput = typeof ClimbInput.Type;

const Scores = Schema.Struct({
  verdict: Schema.Literals(["SCORED", "INCONCLUSIVE"]),
  scores: Schema.Array(Schema.Struct({ label: Schema.String, category: Schema.String, score: Schema.Number })),
  findings: Schema.Array(Schema.Struct({ label: Schema.String, category: Schema.String, flaw: Schema.String, fix: Schema.String })),
  notes: Schema.Array(Schema.String),
});

const Blind = Schema.Struct({
  key: Schema.String, // random; names the judges' folder and unit, so that they show no round
  labels: Schema.Record(Schema.String, Schema.String), // label -> subject
  files: Schema.Record(Schema.String, Schema.Array(Schema.String)), // label -> the copied files
});

const Changed = Schema.Struct({
  changes: Schema.Array(Schema.String),
  declined: Schema.Array(Schema.String), // each judge finding that the agent did not apply, with the reason
  head: Schema.String,
  worktree: Schema.String,
});

const ScoreRecord = Schema.Struct({ round: Schema.Number, judge: Schema.String, subject: Schema.String, value: Schema.Number });

const ClimbResult = Schema.Struct({
  outcome: Schema.Literals(["met", "plateau", "limit"]),
  round: Schema.Number,
  reason: Schema.String,
  head: Schema.String,
  table: Schema.String,
  scores: Schema.Array(ScoreRecord),
  changes: Schema.Array(Schema.String),
  declined: Schema.Array(Schema.String),
});

const attempt = <A>(run: () => A) =>
  Effect.try({ try: run, catch: (error) => (error instanceof Error ? error : new Error(String(error))) });

// Runs a shell command and writes its output to the log. A command that cannot start exits 127. Only a failed
// log write fails the effect, because a throw in the execFile callback would escape the promise.
const shell = (command: string, cwd: string, log: string, env: Record<string, string> = {}) =>
  Effect.tryPromise({
    try: () =>
      new Promise<{ check: typeof Check.Type; stdout: string }>((resolve, reject) =>
        execFile("sh", ["-c", command], { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
          try {
            writeFileSync(log, `$ ${command}\n${stdout}${stderr}${error === null ? "" : `\n${error.message}`}`);
          } catch (failure) {
            reject(failure);
            return;
          }
          const exit = error === null ? 0 : typeof error.code === "number" ? error.code : 127;
          resolve({ check: { command, exit, log }, stdout });
        }),
      ),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });

// A round measures the commit that its result names: HEAD is that commit, and no tracked file has an uncommitted change.
const PINNED = 'test "$(git rev-parse HEAD)" = "$(git rev-parse --verify "$OMT_CLIMB_HEAD^{commit}")" && git diff --quiet HEAD';
const pinned = (head: string, cwd: string, log: string) =>
  shell(PINNED, cwd, log, { OMT_CLIMB_HEAD: head }).pipe(
    Effect.map(({ check }) => ({ ...check, command: `HEAD is ${head}, and no tracked file has an uncommitted change` })),
  );

const runGates = (gates: readonly string[], cwd: string, head: string, logs: string, name: string) =>
  Effect.gen(function* () {
    yield* attempt(() => mkdirSync(logs, { recursive: true }));
    const pin = yield* pinned(head, cwd, join(logs, `${name}-pinned.log`));
    if (pin.exit !== 0) return [pin];
    const checks: (typeof Check.Type)[] = [];
    for (const [index, gate] of gates.entries()) checks.push((yield* shell(gate, cwd, join(logs, `${name}-gate-${index + 1}.log`))).check);
    return checks;
  });

const failIfMoved = (head: string, cwd: string, log: string) =>
  Effect.gen(function* () {
    const pin = yield* pinned(head, cwd, log);
    if (pin.exit !== 0) return yield* Effect.fail(new Error(`${cwd} no longer holds ${head} unchanged; see ${log}`));
  });

const capture = (command: string, cwd: string, head: string, out: string, log: string) =>
  Effect.gen(function* () {
    yield* failIfMoved(head, cwd, log);
    yield* attempt(() => {
      rmSync(out, { recursive: true, force: true });
      mkdirSync(out, { recursive: true });
    });
    const { check } = yield* shell(command, cwd, log, { OMT_CLIMB_OUT: out });
    if (check.exit !== 0) return yield* Effect.fail(new Error(`the capture command exited ${check.exit}; see ${log}`));
    const files = yield* attempt(() =>
      readdirSync(out, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort(),
    );
    if (files.length === 0) return yield* Effect.fail(new Error(`the capture command wrote no file to ${out}`));
    return files;
  });

const scoreCommand = (command: string, cwd: string, head: string, log: string) =>
  Effect.gen(function* () {
    yield* failIfMoved(head, cwd, log);
    const { check, stdout } = yield* shell(command, cwd, log);
    const value = parseScore(stdout);
    if (check.exit !== 0 || value === undefined) {
      return yield* Effect.fail(new Error(`the scorer \`${command}\` exited ${check.exit}${value === undefined ? " and printed no number on its last line" : ""}; see ${log}`));
    }
    return value;
  });

// Copies the files of each subject to <evidence>/climb-<key>/<label>-<k>.<ext>, so that a path shows no subject and no round.
const blind = (evidence: string, subjects: Readonly<Record<string, readonly string[]>>) =>
  attempt(() => {
    // The key is public, so it shares no bytes with the shuffle.
    const key = randomBytes(4).toString("hex");
    const labels = blindLabels([...randomBytes(16)], Object.keys(subjects));
    const folder = join(evidence, `climb-${key}`);
    mkdirSync(folder, { recursive: true });
    const files: Record<string, string[]> = {};
    for (const [label, subject] of Object.entries(labels)) {
      files[label] = (subjects[subject] ?? []).map((file, index) => {
        const copy = join(folder, `${label}-${index + 1}${extname(file)}`);
        copyFileSync(file, copy);
        return copy;
      });
    }
    return { key, labels, files };
  });

const judgeTask = (input: ClimbInput, categories: readonly string[], files: Readonly<Record<string, readonly string[]>>) =>
  [
    "Score each subject below. Each subject has a letter label, and its files follow the label. Open every file.",
    `Rubric:\n${input.rubric}`,
    `Categories: ${categories.join(", ")}. Give each label one score from 0 to 10 in each category.`,
    `Subjects:\n${Object.entries(files).map(([label, paths]) => `- ${label}: ${paths.join(", ")}`).join("\n")}`,
    "For each label, name the flaw that costs the most points in each category below 10, with a concrete fix.",
  ].join("\n\n");

const changeTask = (input: ClimbInput, round: number, head: string, next: ClimbNext, table: string, findings: readonly string[], guidance: string) =>
  [
    `Raise the score of the climb ${input.slug}. In round ${round}, the judges scored commit ${head}, the code in your worktree. Its subject is \`${CURRENT}\`.`,
    ...(guidance === "" ? [] : [guidance]),
    `Scores (a value in parentheses is the raw score before the drift correction):\n\n${table}`,
    `Not met yet: ${next.reason}`,
    findings.length > 0 ? `Findings of the judges on your code:\n${findings.map((finding) => `- ${finding}`).join("\n")}` : "The judges gave no findings.",
    "Make the changes that win the most points and fit the goal in Context. Decline a finding outside the goal, and list it under declined with the reason.",
    "Run each command in Verify until it passes, then commit. Return your changes, the declined findings, `git rev-parse HEAD` as head, and `git rev-parse --show-toplevel` as worktree.",
  ].join("\n\n");

const gateTask = (failed: readonly (typeof Check.Type)[]) =>
  [
    "These gates failed on your last commit:",
    failed.map((check) => `- \`${check.command}\` exit ${check.exit}, log ${check.log}`).join("\n"),
    "Find the cause in each log, fix it, run the gate yourself, and commit. Return your changes, an empty declined list, `git rev-parse HEAD` as head, and `git rev-parse --show-toplevel` as worktree.",
  ].join("\n\n");

const climbOnEnd = (input: ClimbInput, end: { id: string; outcome: string; reason?: string }) =>
  end.outcome === "completed"
    ? Effect.void
    : wake(
        input.thread,
        `omt-climb workflow run ${end.id} for ${input.slug} ${end.outcome}: ${end.reason ?? "no reason"}. Read the run with: t3 workflow show ${end.id} --json`,
        input.project,
      ).pipe(Effect.asVoid);

const finish = (
  input: ClimbInput,
  id: string,
  outcome: "met" | "plateau" | "limit",
  round: number,
  reason: string,
  head: string,
  table: string,
  scores: readonly ClimbScore[],
  changes: readonly string[],
  declined: readonly string[],
) =>
  Effect.gen(function* () {
    yield* step(
      "wake",
      { returns: Schema.String },
      wake(
        input.thread,
        [
          `omt-climb workflow run ${id} for ${input.slug}: ${outcome} after round ${round}. ${reason}.`,
          head === input.head ? "No new commits." : `Merge the climb with: git merge --ff-only ${head}`,
          `Read the result with: t3 workflow show ${id} --json`,
          "",
          table,
        ].join("\n"),
        input.project,
      ),
    );
    const result: typeof ClimbResult.Type = { outcome, round, reason, head, table, scores: [...scores], changes: [...changes], declined: [...declined] };
    return result;
  });

workflow(
  "omt-climb",
  { version: 1, payload: ClimbInput, returns: ClimbResult, onEnd: climbOnEnd },
  Effect.fn(function* (input, run) {
    yield* title(`omt-climb ${input.slug}`);
    const errors = climbInputErrors(input);
    if (errors.length > 0) return yield* stop(`invalid input: ${errors.join("; ")}`);
    const categories = input.categories.length > 0 ? input.categories : ["overall"];
    const models = input.judges.some((judge) => judge.command === "");
    const dir = join(input.evidence, `climb-${input.slug}-${run.id}`);
    const logs = join(dir, "logs");
    const scores: ClimbScore[] = [];
    const changes: string[] = [];
    const declined: string[] = [];
    let maxRounds = input.maxRounds;
    let since = 0;
    let guidance = "";
    let at = { head: input.head, dir: input.checkout };
    let changer: { threadId: string } | undefined;
    let baseline: readonly string[] = [];
    const state = (round: number): ClimbState => ({
      target: input.target,
      direction: input.direction,
      maxRounds,
      plateau: input.plateau,
      since,
      judges: input.judges,
      beat: input.beat,
      round,
      scores,
    });

    for (let round = 1; ; round++) {
      // Gates. After a change, the change agent fixes a failed gate, at most twice per round.
      let checks = yield* step(`gates-r${round}`, { returns: Schema.Array(Check) }, runGates(input.gates, at.dir, at.head, logs, `r${round}`));
      for (let fix = 1; checks.some((check) => check.exit !== 0); fix++) {
        const failed = checks.filter((check) => check.exit !== 0);
        const text = failed.map((check) => `\`${check.command}\` exit ${check.exit} (${check.log})`).join(", ");
        if (changer === undefined || fix > 2) return yield* stop(`the gates fail on ${at.head} in round ${round}: ${text}`);
        const fixed = yield* agent.try(`fix-gates-r${round}-${fix}`, { thread: changer, brief: gateTask(failed), returns: Changed, timeout: "2 hours" });
        if (fixed.outcome === "failed") return yield* stop(`the gate fix of round ${round} failed: ${fixed.reason}`);
        at = { head: fixed.value.head, dir: fixed.value.worktree };
        changes.push(...fixed.value.changes);
        checks = yield* step(`gates-r${round}-${fix + 1}`, { returns: Schema.Array(Check) }, runGates(input.gates, at.dir, at.head, logs, `r${round}-${fix + 1}`));
      }

      // Capture and blind labels. Round 1 scores the start commit, so its capture is the baseline.
      let blinded: typeof Blind.Type = { key: "", labels: {}, files: {} };
      if (models) {
        const files = yield* step(
          `capture-r${round}`,
          { returns: Schema.Array(Schema.String) },
          capture(input.capture, at.dir, at.head, join(dir, `r${round}`), join(logs, `r${round}-capture.log`)),
        );
        if (round === 1) baseline = files;
        const subjects: Record<string, readonly string[]> = { [CURRENT]: files };
        if (round > 1) subjects[BASELINE] = baseline;
        for (const reference of input.references) subjects[reference.name] = reference.files;
        blinded = yield* step(`labels-r${round}`, { returns: Blind }, blind(input.evidence, subjects));
      }

      // Judges, one tier at a time, the judges of a tier in parallel.
      const scoreJudge = (judge: typeof ClimbJudgeInput.Type) =>
        Effect.gen(function* () {
          if (judge.command !== "") {
            const log = join(logs, `r${round}-judge-${judge.name}.log`);
            const value = yield* step(`score-r${round}-${judge.name}`, { returns: Schema.Number }, scoreCommand(judge.command, at.dir, at.head, log));
            return { scores: [{ round, judge: judge.name, subject: CURRENT, value }], findings: [`${judge.name}: \`${judge.command}\` printed ${value}; its output is in ${log}`] };
          }
          let problem = "";
          // A judge name has no ".", so the retry's step names cannot match another judge's.
          for (const suffix of ["", ".retry"]) {
            const routed = yield* step.try(
              `route-judge-r${round}-${judge.name}${suffix}`,
              { returns: Routed },
              route(input.omt, input.project, input.slug, {
                role: "judge",
                unit: `J-${judge.name}-${blinded.key}`,
                round: 1,
                task: judgeTask(input, categories, blinded.files),
                against: judge.against,
              }),
            );
            if (routed.outcome === "failed") return yield* stop(`no judge target for ${judge.name}: ${routed.reason}`);
            const judged = yield* runRouted(`judge-r${round}-${judge.name}${suffix}`, routed.value, {
              project: input.project,
              returns: Scores,
              timeout: "1 hour",
            });
            if (judged.outcome === "failed") return yield* stop(`the judge ${judge.name} failed in round ${round}: ${judged.reason}`);
            const read =
              judged.value.verdict === "SCORED"
                ? readScores(blinded.labels, categories, judged.value)
                : { values: [], errors: [`INCONCLUSIVE: ${judged.value.notes.join("; ")}`] };
            if (read.errors.length > 0) {
              problem = read.errors.join("; ");
              continue;
            }
            const values = read.values.map(({ subject, value }) => ({ round, judge: judge.name, subject, value }));
            const own = values.find((score) => score.subject === CURRENT);
            if (round === 1 && own !== undefined) values.push({ ...own, subject: BASELINE });
            const findings = judged.value.findings
              .filter((finding) => blinded.labels[finding.label.toUpperCase()] === CURRENT)
              .map((finding) => `${judge.name}, ${finding.category}: ${finding.flaw} Fix: ${finding.fix}`);
            return { scores: values, findings };
          }
          return yield* stop(`the judge ${judge.name} gave no valid score in round ${round}: ${problem}`);
        });

      const findings: string[] = [];
      let next = nextAction(state(round));
      while (next.action === "score") {
        const tier = next.tier;
        const due = input.judges.filter((judge) => judge.tier === tier && scoreOf(scores, round, judge.name, CURRENT) === undefined);
        const results = yield* Effect.all(due.map(scoreJudge), { concurrency: 4 });
        for (const result of results) {
          scores.push(...result.scores);
          findings.push(...result.findings);
        }
        next = nextAction(state(round));
      }

      if (next.action === "met") return yield* finish(input, run.id, "met", round, next.reason, at.head, climbTable(state(round)), scores, changes, declined);
      if (next.action === "plateau" || next.action === "limit") {
        const answer = yield* ask(`ask-r${round}`, {
          title: `omt-climb ${input.slug}: ${next.action} after round ${round}. Stop, raise the limit, or change the approach?`,
          choices: ["stop", "raise limit", "change approach"],
          data: { reason: next.reason, table: climbTable(state(round)), findings },
          timeout: "2 days",
        });
        if (Option.isNone(answer) || answer.value.choice === "stop") {
          return yield* finish(input, run.id, next.action, round, next.reason, at.head, climbTable(state(round)), scores, changes, declined);
        }
        since = round;
        maxRounds = Math.max(maxRounds, round + EXTRA_ROUNDS);
        if (answer.value.choice === "change approach") {
          guidance = `The owner asked for another approach than the earlier rounds${answer.value.reason === undefined || answer.value.reason === "" ? "." : `: ${answer.value.reason}`}`;
        }
      }

      // Change. One agent thread makes every change of the climb, in its own worktree.
      const task = changeTask(input, round, at.head, next, climbTable(state(round)), findings, guidance);
      let changed;
      if (changer === undefined) {
        const routed = yield* step.try(
          `route-change-r${round}`,
          { returns: Routed },
          route(input.omt, input.project, input.slug, { role: input.change, unit: "CLIMB", round, task, context: input.goal, verify: input.gates }),
        );
        if (routed.outcome === "failed") return yield* stop(`no ${input.change} target: ${routed.reason}`);
        changed = yield* runRouted(`change-r${round}`, routed.value, {
          project: input.project,
          returns: Changed,
          workspace: worktree(at.head),
          timeout: "3 hours",
        });
      } else {
        changed = yield* agent.try(`change-r${round}`, { thread: changer, brief: task, returns: Changed, timeout: "3 hours" });
      }
      if (changed.outcome === "failed") return yield* stop(`the change of round ${round} failed: ${changed.reason}`);
      changer = changed.thread;
      at = { head: changed.value.head, dir: changed.value.worktree };
      changes.push(...changed.value.changes);
      declined.push(...changed.value.declined);
      guidance = "";
    }
  }),
);
