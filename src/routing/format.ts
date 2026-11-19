import type { ResolvedTarget, RoleResolution, RolesReport, Candidate, CandidateAttempt } from "../types.ts";

const HEADER = ["ROLE", "STATUS", "TARGET", "ACCESS", "MODE", "CROSS"];
// Minimum widths and gaps reproduce the example table in docs/spec.md section 5.3.
const MIN_WIDTHS = [13, 12, 47, 11, 9];
const GAPS = [2, 1, 2, 2, 2];

export const VERIFIED_FOOTER = "verified against orchestrator_capabilities";
export const UNVERIFIED_FOOTER = "unverified: pass --capabilities <file> to check the chains against T3";

export function formatTarget(target: ResolvedTarget): string {
  const head =
    target.providerInstanceId !== undefined
      ? `${target.providerInstanceId}/${target.model}`
      : `${target.driverKind}(driver)/${target.model}`;
  const options = Object.entries(target.options ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, value]) => ` ${id}=${String(value)}`);
  return head + options.join("");
}

function candidateLabel(candidate: Candidate): string {
  return `${candidate.provider ?? candidate.driver ?? "?"}/${candidate.model}`;
}

// Lines under a role: why earlier candidates were skipped, and the notes of the chosen candidate.
function detailLines(resolution: RoleResolution): string[] {
  const chosen = resolution.attempts.findIndex((a) => a.ok);
  const shown: CandidateAttempt[] = chosen < 0 ? resolution.attempts : resolution.attempts.slice(0, chosen + 1);
  const lines: string[] = [];
  for (const a of shown) {
    const prefix = `  candidate ${a.index + 1} ${candidateLabel(a.candidate)}: `;
    for (const note of a.notes) lines.push(prefix + note);
    if (a.reason !== undefined) lines.push(prefix + a.reason);
  }
  return lines;
}

export function formatRolesTable(report: RolesReport): string {
  const rows = Object.values(report.roles).map((r) => [
    r.role,
    r.status,
    r.delegateTask === undefined ? "-" : formatTarget(r.delegateTask.target),
    r.access,
    r.interactionMode,
    r.crossFamily ? "yes" : "no",
  ]);
  const widths = MIN_WIDTHS.map((min, col) =>
    Math.max(min, ...[HEADER, ...rows].map((row) => (row[col] ?? "").length + (GAPS[col] ?? 2))),
  );
  const line = (cells: string[]): string =>
    cells.map((cell, col) => (col < widths.length ? cell.padEnd(widths[col] ?? 0) : cell)).join("");
  const out = [line(HEADER)];
  Object.values(report.roles).forEach((resolution, i) => {
    out.push(line(rows[i] ?? []));
    out.push(...detailLines(resolution));
  });
  out.push("", report.verified ? VERIFIED_FOOTER : UNVERIFIED_FOOTER);
  return out.join("\n") + "\n";
}
