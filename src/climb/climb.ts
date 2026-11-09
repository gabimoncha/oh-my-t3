import { createHash } from "node:crypto";
import { OmtError, usageError } from "../util/errors.ts";

export type ClimbDirection = "up" | "down";

export interface ClimbJudge {
  name: string;
  tier: number; // 1 scores every round; tier n+1 scores a round only after tiers 1 to n meet the target in it
}

export interface ClimbRound {
  n: number;
  key: string; // random; names the judges' files and units, so that they do not show the round number
  started: string;
  labels: Record<string, string>; // blind label, such as "B", -> subject, such as "current"
}

export interface ClimbScore {
  round: number;
  judge: string;
  subject: string;
  value: number; // the worst category, or the single score
  categories?: Record<string, number>;
  ts: string;
}

export interface Climb {
  version: 1;
  slug: string;
  created: string;
  target: number;
  direction: ClimbDirection;
  maxRounds: number;
  plateau: { rounds: number; minGain: number };
  judges: ClimbJudge[];
  categories: string[];
  beat: string[]; // subjects that the current subject must score better than, for each judge in the same round
  rounds: ClimbRound[];
  scores: ClimbScore[];
}

export type ClimbAction = "round" | "score" | "judge-tier" | "change" | "met" | "plateau" | "limit";

export interface ClimbNext {
  action: ClimbAction;
  tier?: number; // with judge-tier: the tier that scores the round next
  reason: string;
}

export interface ClimbCell {
  round: number;
  raw: number;
  value: number; // raw minus the judge's baseline drift in that round
}

export interface ClimbRow {
  judge: string;
  tier: number;
  subject: string;
  cells: ClimbCell[];
}

export interface ClimbStatus {
  slug: string;
  target: number;
  direction: ClimbDirection;
  round: number;
  maxRounds: number;
  beat: string[];
  next: ClimbNext;
  rows: ClimbRow[];
}

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CURRENT = "current";
export const BASELINE = "baseline";

export function checkName(kind: string, name: string): string {
  if (!NAME_RE.test(name)) throw usageError(`invalid ${kind} name "${name}"`, "use lowercase letters, digits, and hyphens, at most 32 characters");
  return name;
}

export function parseNumber(flag: string, text: string): number {
  const value = text.trim() === "" ? Number.NaN : Number(text);
  if (!Number.isFinite(value)) throw usageError(`${flag}: "${text}" is not a number`);
  return value;
}

// A judge spec is <name> or <name>@<tier>.
export function parseJudge(spec: string): ClimbJudge {
  const at = spec.lastIndexOf("@");
  const name = checkName("judge", at === -1 ? spec : spec.slice(0, at));
  if (at === -1) return { name, tier: 1 };
  const tierText = spec.slice(at + 1);
  const tier = Number(tierText);
  if (!/^\d+$/.test(tierText) || tier < 1 || tier > 9) throw usageError(`--judge ${spec}: the tier must be 1 to 9`);
  return { name, tier };
}

export function worst(direction: ClimbDirection, values: number[]): number {
  return direction === "up" ? Math.min(...values) : Math.max(...values);
}

function better(direction: ClimbDirection, a: number, b: number): boolean {
  return direction === "up" ? a > b : a < b;
}

const EPSILON = 1e-9;

export function meets(climb: Pick<Climb, "direction" | "target">, value: number): boolean {
  return climb.direction === "up" ? value >= climb.target - EPSILON : value <= climb.target + EPSILON;
}

// Deterministic, so that a test can predict the labels; the judges never see the CLI.
export function blindLabels(slug: string, round: number, subjects: string[]): Record<string, string> {
  const order = [...subjects];
  const bytes = createHash("sha256").update(`${slug}:${round}`).digest();
  for (let i = order.length - 1; i > 0; i--) {
    const j = (bytes[i % bytes.length] ?? 0) % (i + 1);
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  const labels: Record<string, string> = {};
  order.forEach((subject, index) => {
    let label = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      label = String.fromCharCode(65 + (n - 1) % 26) + label;
    }
    labels[label] = subject;
  });
  return labels;
}

export interface ParsedScore {
  label: string;
  value?: number;
  categories?: Record<string, number>;
}

// Reads the SCORES block of a score result: lines like "- B: hierarchy=8.5 contrast=9" or "- A: 7".
export function parseScoresBlock(text: string): ParsedScore[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*SCORES:\s*$/.test(line));
  if (start === -1) throw new OmtError("climb_result", "the result has no SCORES: block");
  const parsed: ParsedScore[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*[A-Z][A-Z ]*:\s*/.test(line) && !/^\s*-/.test(line)) break;
    const match = /^\s*-\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (match === null) {
      if (/^\s*-/.test(line)) throw new OmtError("climb_result", `invalid score line: ${line.trim()}`);
      continue;
    }
    const label = (match[1] as string).toUpperCase();
    const body = match[2] as string;
    if (/^-?\d+(\.\d+)?(\s*\/\s*10)?$/.test(body)) {
      parsed.push({ label, value: parseNumber(`label ${label}`, body.replace(/\s*\/\s*10$/, "")) });
      continue;
    }
    const categories: Record<string, number> = {};
    for (const pair of body.replace(/\s*\/\s*10\b/g, "/10").split(/[\s,]+/)) {
      if (pair === "") continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new OmtError("climb_result", `label ${label}: "${pair}" is not <category>=<score>`);
      const name = checkName("category", pair.slice(0, eq).toLowerCase());
      if (Object.hasOwn(categories, name)) throw new OmtError("climb_result", `label ${label}: category "${name}" is given twice`);
      categories[name] = parseNumber(`label ${label} ${name}`, pair.slice(eq + 1).replace(/\/10$/, ""));
    }
    parsed.push({ label, categories });
  }
  if (parsed.length === 0) throw new OmtError("climb_result", "the SCORES: block has no score lines");
  return parsed;
}

export function checkCategories(climb: Climb, categories: Record<string, number>): void {
  if (climb.categories.length === 0) return;
  for (const name of Object.keys(categories)) {
    if (!climb.categories.includes(name)) throw usageError(`unknown category "${name}"`, `the climb has ${climb.categories.join(", ")}`);
  }
  const missing = climb.categories.filter((name) => !(name in categories));
  if (missing.length > 0) throw usageError(`missing ${missing.length === 1 ? "category" : "categories"} ${missing.join(", ")}`);
}

function scoreOf(climb: Climb, round: number, judge: string, subject: string): ClimbScore | undefined {
  return climb.scores.find((score) => score.round === round && score.judge === judge && score.subject === subject);
}

// The rise of a judge's baseline score since the first round in which the judge scored the baseline.
// A round without a baseline score from the judge gets no correction.
function drift(climb: Climb, judge: string, round: number): number {
  const first = climb.scores
    .filter((score) => score.judge === judge && score.subject === BASELINE)
    .sort((a, b) => a.round - b.round)[0];
  const now = scoreOf(climb, round, judge, BASELINE);
  return first === undefined || now === undefined ? 0 : now.value - first.value;
}

export function calibrated(climb: Climb, round: number, judge: string): number | undefined {
  const score = scoreOf(climb, round, judge, CURRENT);
  return score === undefined ? undefined : score.value - drift(climb, judge, round);
}

function format(value: number): string {
  return String(Number(value.toFixed(2)));
}

// The worst calibrated score, as a gain toward the target, among the judges that scored both rounds.
function progress(climb: Climb, a: number, b: number): number | undefined {
  const sign = climb.direction === "up" ? 1 : -1;
  const common = climb.judges.filter((judge) => calibrated(climb, a, judge.name) !== undefined && calibrated(climb, b, judge.name) !== undefined);
  if (common.length === 0) return undefined;
  const at = (round: number) => Math.min(...common.map((judge) => sign * (calibrated(climb, round, judge.name) as number)));
  return at(b) - at(a);
}

export function nextAction(climb: Climb): ClimbNext {
  const last = climb.rounds.at(-1);
  if (last === undefined) return { action: "round", reason: "no round has started" };
  const round = last.n;
  const scored = climb.judges.filter((judge) => scoreOf(climb, round, judge.name, CURRENT) !== undefined);
  if (scored.length === 0) return { action: "score", tier: 1, reason: `round ${round} has no score for ${CURRENT}` };
  const top = Math.max(...scored.map((judge) => judge.tier));
  const due = climb.judges.filter((judge) => judge.tier <= top);
  const missing = due.filter((judge) => !scored.includes(judge));
  if (missing.length > 0) {
    return { action: "score", tier: Math.min(...missing.map((judge) => judge.tier)), reason: `round ${round} needs a score from ${missing.map((judge) => judge.name).join(", ")}` };
  }
  const failures: string[] = [];
  for (const judge of due) {
    const value = calibrated(climb, round, judge.name) as number;
    if (!meets(climb, value)) failures.push(`${judge.name} ${format(value)} ${climb.direction === "up" ? "<" : ">"} ${format(climb.target)}`);
    const own = (scoreOf(climb, round, judge.name, CURRENT) as ClimbScore).value;
    for (const subject of climb.beat) {
      const other = scoreOf(climb, round, judge.name, subject);
      if (other === undefined) failures.push(`${judge.name} gave no score for ${subject}`);
      else if (!better(climb.direction, own, other.value)) failures.push(`${judge.name} scored ${subject} ${format(other.value)}, ${CURRENT} ${format(own)}`);
    }
  }
  if (failures.length === 0) {
    const higher = climb.judges.filter((judge) => judge.tier > top).map((judge) => judge.tier);
    if (higher.length === 0) return { action: "met", reason: `every judge meets the target in round ${round}` };
    const tier = Math.min(...higher);
    return { action: "judge-tier", tier, reason: `tiers 1 to ${top} meet the target in round ${round}` };
  }
  const reason = failures.join("; ");
  if (round >= climb.maxRounds) return { action: "limit", reason: `round ${round} is the last of ${climb.maxRounds}: ${reason}` };
  const window = climb.plateau.rounds;
  if (round > window) {
    const gain = progress(climb, round - window, round);
    if (gain !== undefined && gain < climb.plateau.minGain - EPSILON) {
      return { action: "plateau", reason: `the gain over the last ${window} rounds is ${format(gain)}, below ${format(climb.plateau.minGain)}: ${reason}` };
    }
  }
  return { action: "change", tier: 1, reason };
}

export function climbStatus(climb: Climb): ClimbStatus {
  const subjects = [CURRENT, ...new Set(climb.scores.map((score) => score.subject).filter((subject) => subject !== CURRENT).sort())];
  const rows: ClimbRow[] = [];
  for (const judge of climb.judges) {
    for (const subject of subjects) {
      const cells: ClimbCell[] = [];
      for (const round of climb.rounds) {
        const score = scoreOf(climb, round.n, judge.name, subject);
        if (score === undefined) continue;
        const value = subject === CURRENT ? (calibrated(climb, round.n, judge.name) as number) : score.value;
        cells.push({ round: round.n, raw: score.value, value });
      }
      if (cells.length > 0 || subject === CURRENT) rows.push({ judge: judge.name, tier: judge.tier, subject, cells });
    }
  }
  return {
    slug: climb.slug,
    target: climb.target,
    direction: climb.direction,
    round: climb.rounds.at(-1)?.n ?? 0,
    maxRounds: climb.maxRounds,
    beat: climb.beat,
    next: nextAction(climb),
    rows,
  };
}

function cellText(cell: ClimbCell | undefined): string {
  if (cell === undefined) return "-";
  return cell.value === cell.raw ? format(cell.value) : `${format(cell.value)} (${format(cell.raw)})`;
}

function targetText(status: ClimbStatus): string {
  return `${format(status.target)} or ${status.direction === "up" ? "more" : "less"}`;
}

export function formatStatus(status: ClimbStatus, path: string): string {
  const rounds = Array.from({ length: status.round }, (_, i) => i + 1);
  const header = ["JUDGE", "TIER", "SUBJECT", ...rounds.map((n) => `R${n}`)];
  const lines = [
    `climb: ${status.slug} (${path})`,
    `target: ${targetText(status)} from every judge${status.beat.length === 0 ? "" : `, better than ${status.beat.join(", ")}`}`,
    `round: ${status.round} of ${status.maxRounds}`,
  ];
  const table = status.rows.map((row) => [row.judge, String(row.tier), row.subject, ...rounds.map((n) => cellText(row.cells.find((cell) => cell.round === n)))]);
  const widths = header.map((cell, column) => Math.max(cell.length, ...table.map((row) => (row[column] ?? "").length)));
  const render = (cells: string[]) => cells.map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0))).join("  ").trimEnd();
  if (status.round > 0) lines.push(render(header), ...table.map(render));
  lines.push(`next: ${status.next.action}${status.next.tier === undefined ? "" : ` tier ${status.next.tier}`}`, `reason: ${status.next.reason}`);
  return `${lines.join("\n")}\n`;
}

export function formatMarkdown(status: ClimbStatus): string {
  const rounds = Array.from({ length: status.round }, (_, i) => i + 1);
  const lines = [
    "## Climb",
    "",
    `Target: ${targetText(status)} from every judge${status.beat.length === 0 ? "" : `, better than ${status.beat.join(", ")}`}. Rounds: ${status.round}. Result: ${status.next.action}.`,
    "",
    `| Judge | Subject | ${rounds.map((n) => `Round ${n}`).join(" | ")} |`,
    `| --- | --- | ${rounds.map(() => "---").join(" | ")} |`,
    ...status.rows.map((row) => `| ${row.judge} | ${row.subject} | ${rounds.map((n) => cellText(row.cells.find((cell) => cell.round === n))).join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}

export function parseClimb(text: string, path: string): Climb {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OmtError("climb_damaged", `${path} is not valid JSON`, { cause: error });
  }
  const climb = value as Partial<Climb> | null;
  const record = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item);
  const number = (item: unknown): item is number => typeof item === "number" && Number.isFinite(item);
  const strings = (item: unknown): item is string[] => Array.isArray(item) && item.every((entry) => typeof entry === "string");
  if (
    !record(climb) || climb.version !== 1 || typeof climb.slug !== "string" || typeof climb.created !== "string" ||
    !number(climb.target) || (climb.direction !== "up" && climb.direction !== "down") ||
    !number(climb.maxRounds) || !record(climb.plateau) ||
    !number(climb.plateau.rounds) || !number(climb.plateau.minGain) ||
    !Array.isArray(climb.judges) || !climb.judges.every((judge) => record(judge) && typeof judge.name === "string" && number(judge.tier)) ||
    !strings(climb.categories) || !strings(climb.beat) ||
    !Array.isArray(climb.rounds) || !climb.rounds.every((round) => record(round) && number(round.n) && typeof round.key === "string" && typeof round.started === "string" &&
      record(round.labels) && Object.values(round.labels).every((subject) => typeof subject === "string")) ||
    !Array.isArray(climb.scores) || !climb.scores.every((score) => record(score) && number(score.round) && typeof score.judge === "string" &&
      typeof score.subject === "string" && number(score.value) && typeof score.ts === "string" &&
      (score.categories === undefined || (record(score.categories) && Object.values(score.categories).every(number))))
  ) {
    throw new OmtError("climb_damaged", `${path} is not a climb file of version 1`);
  }
  return climb as Climb;
}
