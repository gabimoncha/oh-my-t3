import type { CandidateAttempt, ResolvedTarget, RolesReport } from "../types.ts";

export type Speed = "off" | "fast" | "ultrafast";

export function targetSpeed(target: ResolvedTarget): Speed {
  const options = target.options ?? {};
  if (options.serviceTier === "ultrafast") return "ultrafast";
  if (options.serviceTier === "priority" || options.fastMode === true) return "fast";
  return "off";
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function targetEffort(attempt: CandidateAttempt): string {
  const options = attempt.target?.options ?? {};
  const mapped = options.reasoningEffort ?? options.effort;
  return attempt.candidate.effort ?? (typeof mapped === "string" ? mapped : "default");
}

function targetCells(attempt: CandidateAttempt | undefined, more: number): string {
  if (attempt?.target === undefined) return '<td colspan="4" class="group dim">none</td>';
  const target = attempt.target;
  const harness = target.providerInstanceId ?? target.driverKind ?? "?";
  const speed = targetSpeed(target);
  const extra = more > 0 ? ` <span class="dim">+${more}</span>` : "";
  return [
    `<td class="group dim">${escape(harness)}</td>`,
    `<td class="model">${escape(target.model)}${extra}</td>`,
    `<td>${escape(targetEffort(attempt))}</td>`,
    `<td><span class="chip ${speed}">${speed}</span></td>`,
  ].join("");
}

const STYLE = `
.wrap { font-family: var(--font-sans, system-ui, sans-serif); color: var(--foreground, #222); display: grid; gap: 12px; }
.head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.head h2 { font-size: 15px; margin: 0; font-weight: 600; }
.meta, .dim { color: var(--muted-foreground, #777); }
.meta { font-size: 12px; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 680px; }
th { text-align: left; font-weight: 500; font-size: 11px; color: var(--muted-foreground, #777); padding: 4px 6px; }
thead tr:first-child th { font-size: 12px; color: var(--foreground, #222); font-weight: 600; }
thead tr:last-child th { border-bottom: 1px solid var(--border, #ddd); }
th.group, td.group { border-left: 1px solid var(--border, #ddd); padding-left: 10px; }
td { padding: 6px; border-bottom: 1px solid var(--border, #ddd); white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
.role { font-family: var(--font-mono, ui-monospace, monospace); }
.chip { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border, #ddd); }
.chip.off { color: var(--muted-foreground, #777); }
.chip.fast { color: var(--info, #2563eb); border-color: color-mix(in srgb, var(--info, #2563eb) 40%, transparent); background: color-mix(in srgb, var(--info, #2563eb) 10%, transparent); }
.chip.ultrafast { color: var(--warning, #b45309); border-color: color-mix(in srgb, var(--warning, #b45309) 45%, transparent); background: color-mix(in srgb, var(--warning, #b45309) 12%, transparent); }
.bad { color: var(--destructive, #b91c1c); }
ul { margin: 0; padding-left: 18px; font-size: 12px; }
`;

export function formatRolesHtml(report: RolesReport, profile: string): string {
  const rows: string[] = [];
  const notes: string[] = [];
  for (const resolution of Object.values(report.roles)) {
    const ok = resolution.attempts.filter((a) => a.ok);
    const role = `<td class="role">${escape(resolution.role)}</td>`;
    if (ok.length === 0) {
      rows.push(`<tr>${role}<td colspan="8" class="group bad">unavailable</td></tr>`);
    } else {
      rows.push(`<tr>${role}${targetCells(ok[0], 0)}${targetCells(ok[1], ok.length - 2)}</tr>`);
    }
    for (const note of [...(resolution.notes ?? []), ...(ok[0]?.notes ?? [])]) notes.push(`${resolution.role}: ${note}`);
  }
  const sub = "<th class=\"group\">harness</th><th>model</th><th>effort</th><th>speed</th>";
  const noteList = notes.length === 0 ? "" : `<ul class="dim">${notes.map((n) => `<li>${escape(n)}</li>`).join("")}</ul>`;
  return `<!doctype html>
<title>omt roles</title>
<style>${STYLE}</style>
<div class="wrap">
<div class="head"><h2>omt roles</h2><span class="meta">profile ${escape(profile)} · ${report.verified ? "verified against T3" : "unverified"}</span></div>
<div class="scroll"><table>
<thead><tr><th></th><th class="group" colspan="4">Primary</th><th class="group" colspan="4">Fallback</th></tr>
<tr><th>role</th>${sub}${sub}</tr></thead>
<tbody>
${rows.join("\n")}
</tbody></table></div>
${noteList}</div>
`;
}
