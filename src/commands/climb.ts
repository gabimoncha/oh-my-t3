import { randomBytes } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { projectWriteTarget } from "../install/fsops.ts";
import { climbPath, findProjectRoot } from "../paths.ts";
import {
  BASELINE,
  CURRENT,
  blindLabels,
  checkCategories,
  checkName,
  climbStatus,
  formatMarkdown,
  formatStatus,
  parseClimb,
  parseJudge,
  parseNumber,
  parseScoresBlock,
  worst,
} from "../climb/climb.ts";
import type { Climb, ClimbScore } from "../climb/climb.ts";
import { readInput } from "./shared.ts";
import type { CliContext, CommandRun } from "../types.ts";
import { checkPositionals, parseArgs, positiveInt } from "../util/args.ts";
import { OmtError, usageError } from "../util/errors.ts";
import { checkPlanSlug } from "../util/ids.ts";
import { ensureDir, errorCode, pathExists, readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { formatJson } from "../util/output.ts";

export const summary = "Keep the scores of a hill climb and print its next action.";

export const usage = `Usage: omt climb new <slug> --target <n> --judge <name>[@<tier>]... [--direction up|down]
                     [--max-rounds <n>] [--plateau <n>] [--min-gain <n>]
                     [--category <name>]... [--beat <subject>]... [--force]
       omt climb round <slug> [--subject <name>]... [--json]
       omt climb score <slug> --judge <name> [--round <n>]
                       (--score <n> [--subject <name>]
                        | --category <name>=<n>... [--subject <name>]
                        | --result-file <file>)
       omt climb set <slug> [--target <n>] [--max-rounds <n>]
       omt climb status <slug> [--json | --markdown]

A climb repeats change, check, and score until every judge meets the target.
The climb file is .omt3/plans/<slug>.climb.json.

Subcommands:
  new <slug>        write the climb file
  round <slug>      start the next round; print the blind label of each
                    subject (current, and each --subject)
  score <slug>      record one judge's scores for the round
  set <slug>        change the target or the round limit
  status <slug>     print the scores and the next action: round, score,
                    judge-tier, change, met, plateau, or limit

Options:
  --target <n>      the score that each judge must reach
  --judge <name>[@<tier>]
                    with new: a judge and its tier (default 1); repeatable.
                    Tier n+1 scores a round only after tiers 1 to n meet
                    the target in it. With score: the judge that scored
  --direction up|down
                    with new: up when a higher score is better (default up)
  --max-rounds <n>  the round limit (default 10)
  --plateau <n>     with new: the window in rounds for the plateau check
                    (default 2)
  --min-gain <n>    with new: the least gain over the window (default 0.2)
  --category <name> with new: a category that each judge scores; repeatable
  --category <name>=<n>
                    with score: the score of one category; repeatable
  --beat <subject>  with new: the current subject must score better than
                    this subject for each judge in the same round; repeatable
  --subject <name>  with round: a subject next to current, such as baseline
                    or a competitor; repeatable. With score: the subject of
                    --score or --category (default current)
  --round <n>       with score: the round (default the latest)
  --score <n>       with score: one score for the subject
  --result-file <file>
                    with score: a judge's result block (- for stdin); its
                    SCORES lines name blind labels
  --force           with new: overwrite an existing climb file
  --json            print JSON
  --markdown        with status: print the PR table
  -h, --help        print this help
`;

async function readClimb(root: string, slug: string): Promise<{ path: string; climb: Climb }> {
  const path = climbPath(root, slug);
  const text = await readFileIfExists(path);
  if (text === undefined) {
    throw new OmtError("climb_not_found", `climb "${slug}" not found at ${path}`, { hint: `run "omt climb new ${slug}" to create it` });
  }
  return { path, climb: parseClimb(text, path) };
}

async function writeClimb(ctx: CliContext, path: string, climb: Climb): Promise<void> {
  await writeFileAtomic(await projectWriteTarget(findProjectRoot(ctx.cwd), path), formatJson(climb));
}

const LOCK_WAIT_MS = 10_000;

// Judges finish in parallel, so two score commands can run at once; each read-modify-write holds this lock.
async function withLock<T>(path: string, body: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  await ensureDir(dirname(lock));
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      // No automatic stale recovery: two waiters could both remove a stale lock and then a live one.
      if (Date.now() > deadline) {
        throw new OmtError("climb_locked", `another omt climb command holds ${lock}`, { hint: "run the command again; when no omt climb command runs, a crashed command left the file, so remove it" });
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await body();
  } finally {
    await rm(lock, { force: true });
  }
}

function slugArg(positionals: string[], sub: string): string {
  const slug = positionals[1];
  if (slug === undefined) throw usageError(`climb ${sub} needs a <slug>`);
  checkPositionals(positionals, 2);
  return checkPlanSlug(slug);
}

function unique(kind: string, names: string[]): string[] {
  for (const name of names) checkName(kind, name);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw usageError(`${kind} "${name}" is given twice`);
    seen.add(name);
  }
  return names;
}

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

function strings(values: Values, key: string): string[] {
  const value = values[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(values: Values, key: string): string | undefined {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
}

async function climbNew(ctx: CliContext, root: string, slug: string, values: Values) {
  const targetText = text(values, "target");
  if (targetText === undefined) throw usageError("climb new needs --target <n>");
  const judges = strings(values, "judge").map(parseJudge);
  if (judges.length === 0) throw usageError("climb new needs at least one --judge <name>[@<tier>]");
  unique("judge", judges.map((judge) => judge.name));
  const direction = text(values, "direction") ?? "up";
  if (direction !== "up" && direction !== "down") throw usageError(`--direction must be up or down, not "${direction}"`);
  const categories = unique("category", strings(values, "category"));
  const beat = unique("subject", strings(values, "beat"));
  if (beat.includes(CURRENT)) throw usageError(`--beat ${CURRENT}: the current subject cannot beat itself`);
  const minGain = text(values, "min-gain") === undefined ? 0.2 : parseNumber("--min-gain", text(values, "min-gain") as string);
  if (minGain < 0) throw usageError("--min-gain must be 0 or more");
  const climb: Climb = {
    version: 1,
    slug,
    created: ctx.now().toISOString(),
    target: parseNumber("--target", targetText),
    direction,
    maxRounds: positiveInt("--max-rounds", text(values, "max-rounds")) ?? 10,
    plateau: { rounds: positiveInt("--plateau", text(values, "plateau")) ?? 2, minGain },
    judges: [...judges].sort((a, b) => a.tier - b.tier),
    categories,
    beat,
    rounds: [],
    scores: [],
  };
  const path = climbPath(root, slug);
  if (values.force !== true && (await pathExists(path))) {
    throw new OmtError("climb_exists", `climb already exists: ${path}`, { hint: "pass --force to overwrite it, or change it with omt climb set" });
  }
  await writeClimb(ctx, path, climb);
  ctx.stdout(`${path}\n`);
  return 0;
}

async function climbRound(ctx: CliContext, root: string, slug: string, values: Values) {
  const { path, climb } = await readClimb(root, slug);
  const extra = unique("subject", strings(values, "subject"));
  if (extra.includes(CURRENT)) throw usageError(`--subject ${CURRENT} is always part of a round`);
  const last = climb.rounds.at(-1);
  if (last !== undefined && !climb.scores.some((score) => score.round === last.n)) {
    throw new OmtError("climb_round_open", `round ${last.n} has no scores yet`, { hint: `record scores with "omt climb score ${slug}" first` });
  }
  const n = (last?.n ?? 0) + 1;
  if (n > climb.maxRounds) {
    throw new OmtError("climb_limit", `the climb has reached its limit of ${climb.maxRounds} rounds`, { hint: `raise it with "omt climb set ${slug} --max-rounds <n>"` });
  }
  const missing = climb.beat.filter((subject) => !extra.includes(subject));
  if (missing.length > 0) throw usageError(`the climb must beat ${missing.join(", ")}; pass --subject for each`);
  const labels = blindLabels(slug, n, [CURRENT, ...extra]);
  const key = randomBytes(4).toString("hex");
  climb.rounds.push({ n, key, started: ctx.now().toISOString(), labels });
  await writeClimb(ctx, path, climb);
  if (values.json === true) ctx.stdout(formatJson({ round: n, key, labels }));
  else ctx.stdout(`round ${n}\nkey ${key}\n${Object.entries(labels).map(([label, subject]) => `${label}  ${subject}\n`).join("")}`);
  return 0;
}

function categoryPairs(pairs: string[]): Record<string, number> {
  const categories: Record<string, number> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw usageError(`--category ${pair}: use <name>=<n>`);
    const name = checkName("category", pair.slice(0, eq));
    if (name in categories) throw usageError(`category "${name}" is given twice`);
    categories[name] = parseNumber(`--category ${name}`, pair.slice(eq + 1));
  }
  return categories;
}

async function climbScore(ctx: CliContext, root: string, slug: string, values: Values, resultInput?: string) {
  const { path, climb } = await readClimb(root, slug);
  const judgeName = text(values, "judge");
  if (judgeName === undefined) throw usageError("climb score needs --judge <name>");
  if (!climb.judges.some((judge) => judge.name === judgeName)) {
    throw usageError(`unknown judge "${judgeName}"`, `the climb has ${climb.judges.map((judge) => judge.name).join(", ")}`);
  }
  const roundNumber = positiveInt("--round", text(values, "round")) ?? climb.rounds.at(-1)?.n;
  const round = climb.rounds.find((candidate) => candidate.n === roundNumber);
  if (round === undefined) {
    throw new OmtError("climb_round_missing", roundNumber === undefined ? "the climb has no round yet" : `the climb has no round ${roundNumber}`, { hint: `run "omt climb round ${slug}"` });
  }
  const scoreText = text(values, "score");
  const resultFile = text(values, "result-file");
  const pairs = strings(values, "category");
  const modes = [scoreText !== undefined, resultFile !== undefined, pairs.length > 0].filter(Boolean).length;
  if (modes !== 1) throw usageError("climb score needs one of --score, --category, or --result-file");
  const subjects = Object.values(round.labels);
  const entries: { subject: string; value?: number; categories?: Record<string, number> }[] = [];
  if (resultFile !== undefined) {
    if (values.subject !== undefined) throw usageError("--subject does not apply to --result-file; its labels name the subjects");
    for (const parsed of parseScoresBlock(resultInput as string)) {
      const subject = round.labels[parsed.label];
      if (subject === undefined) throw new OmtError("climb_result", `label ${parsed.label} is not a subject of round ${round.n}`);
      if (entries.some((entry) => entry.subject === subject)) throw new OmtError("climb_result", `label ${parsed.label} is scored twice`);
      entries.push({ subject, ...(parsed.value === undefined ? {} : { value: parsed.value }), ...(parsed.categories === undefined ? {} : { categories: parsed.categories }) });
    }
  } else {
    const subject = text(values, "subject") ?? CURRENT;
    if (!subjects.includes(subject)) throw usageError(`"${subject}" is not a subject of round ${round.n}`, `the round has ${subjects.join(", ")}`);
    entries.push(scoreText !== undefined ? { subject, value: parseNumber("--score", scoreText) } : { subject, categories: categoryPairs(pairs) });
  }
  const recorded: ClimbScore[] = [];
  for (const entry of entries) {
    if (entry.categories !== undefined) checkCategories(climb, entry.categories);
    const value = entry.categories === undefined ? (entry.value as number) : worst(climb.direction, Object.values(entry.categories));
    recorded.push({
      round: round.n,
      judge: judgeName,
      subject: entry.subject,
      value,
      ...(entry.categories === undefined ? {} : { categories: entry.categories }),
      ts: ctx.now().toISOString(),
    });
  }
  climb.scores = climb.scores.filter((score) => !recorded.some((next) => next.round === score.round && next.judge === score.judge && next.subject === score.subject));
  climb.scores.push(...recorded);
  await writeClimb(ctx, path, climb);
  for (const score of recorded) ctx.stdout(`recorded ${score.judge} r${score.round} ${score.subject} ${Number(score.value.toFixed(2))}\n`);
  if (!recorded.some((score) => score.subject === CURRENT)) ctx.stderr(`warning: no score for ${CURRENT} in this result\n`);
  if (subjects.includes(BASELINE) && !recorded.some((score) => score.subject === BASELINE) && resultFile !== undefined) {
    ctx.stderr(`warning: no score for ${BASELINE}; this round gets no drift correction for ${judgeName}\n`);
  }
  return 0;
}

async function climbSet(ctx: CliContext, root: string, slug: string, values: Values) {
  const { path, climb } = await readClimb(root, slug);
  const targetText = text(values, "target");
  const maxRounds = positiveInt("--max-rounds", text(values, "max-rounds"));
  if (targetText === undefined && maxRounds === undefined) throw usageError("climb set needs --target or --max-rounds");
  const changes: string[] = [];
  if (targetText !== undefined) {
    climb.target = parseNumber("--target", targetText);
    changes.push(`target=${climb.target}`);
  }
  if (maxRounds !== undefined) {
    if (maxRounds < (climb.rounds.at(-1)?.n ?? 0)) throw usageError(`--max-rounds ${maxRounds} is below the current round ${climb.rounds.at(-1)?.n}`);
    climb.maxRounds = maxRounds;
    changes.push(`max-rounds=${maxRounds}`);
  }
  await writeClimb(ctx, path, climb);
  ctx.stdout(`set ${changes.join(" ")} for ${slug}\n`);
  return 0;
}

async function climbStatusCommand(ctx: CliContext, root: string, slug: string, values: Values) {
  if (values.json === true && values.markdown === true) throw usageError("use --json or --markdown, not both");
  const { path, climb } = await readClimb(root, slug);
  const status = climbStatus(climb);
  if (values.json === true) ctx.stdout(formatJson({ ...status, path }));
  else if (values.markdown === true) ctx.stdout(formatMarkdown(status));
  else ctx.stdout(formatStatus(status, path));
  return 0;
}

const ALLOWED: Record<string, readonly string[]> = {
  new: ["target", "judge", "direction", "max-rounds", "plateau", "min-gain", "category", "beat", "force"],
  round: ["subject", "json"],
  score: ["judge", "round", "score", "subject", "category", "result-file"],
  set: ["target", "max-rounds"],
  status: ["json", "markdown"],
};

export const run: CommandRun = async (ctx) => {
  const { values, positionals } = parseArgs(ctx.argv, {
    target: { type: "string" },
    judge: { type: "string", multiple: true },
    direction: { type: "string" },
    "max-rounds": { type: "string" },
    plateau: { type: "string" },
    "min-gain": { type: "string" },
    category: { type: "string", multiple: true },
    beat: { type: "string", multiple: true },
    subject: { type: "string", multiple: true },
    round: { type: "string" },
    score: { type: "string" },
    "result-file": { type: "string" },
    force: { type: "boolean" },
    json: { type: "boolean" },
    markdown: { type: "boolean" },
  });
  const sub = positionals[0];
  if (sub === undefined) throw usageError("climb needs a subcommand: new, round, score, set, or status");
  const allowed = ALLOWED[sub];
  if (allowed === undefined) throw usageError(`unknown climb subcommand "${sub}"`, "use new, round, score, set, or status");
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key)) throw usageError(`--${key} does not apply to climb ${sub}`);
  }
  // judge is repeatable for new; score takes one judge and one subject.
  const flat: Values = { ...values };
  if (sub === "score") {
    for (const key of ["judge", "subject"] as const) {
      const list = strings(values, key);
      if (list.length > 1) throw usageError(`climb score takes one --${key}`);
      flat[key] = list[0];
    }
  }
  const root = findProjectRoot(ctx.cwd);
  const slug = slugArg(positionals, sub);
  switch (sub) {
    case "new":
      return withLock(climbPath(root, slug), () => climbNew(ctx, root, slug, flat));
    case "round":
      return withLock(climbPath(root, slug), () => climbRound(ctx, root, slug, flat));
    case "score": {
      // Input can wait indefinitely; read it before the lock and the state snapshot.
      const resultFile = text(flat, "result-file");
      const resultInput = resultFile === undefined ? undefined : await readInput(ctx, "result-file", resultFile);
      return withLock(climbPath(root, slug), () => climbScore(ctx, root, slug, flat, resultInput));
    }
    case "set":
      return withLock(climbPath(root, slug), () => climbSet(ctx, root, slug, flat));
    default:
      return climbStatusCommand(ctx, root, slug, flat);
  }
};
