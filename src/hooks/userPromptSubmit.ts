import type { CliContext } from "../types.ts";

// The bare words also appear when the user only talks about ultrawork, so only the phrase starts a run.
const PHRASE_RE = /(?<![\p{L}\p{N}_\-/$])start[ \t]+(?:ulw|ultrawork)(?![\p{L}\p{N}_\-/$])/giu;
const NEGATOR_RE = /(?<![\p{L}\p{N}_])(?:no|not|never|without|dont|don['’]t)$/iu;
const WINDOW_CHAR_RE = /^[\p{L}\p{N}'’]$/u;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function charBefore(text: string, end: number): string {
  const low = text.charCodeAt(end - 1);
  const high = text.charCodeAt(end - 2);
  if (low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff) return text.slice(end - 2, end);
  return text.slice(end - 1, end);
}

// Looks back over at most three words. Each word is in the window of at most three matches, so detection stays linear in the prompt length.
function isNegated(text: string, index: number): boolean {
  let pos = index;
  for (let words = 0; words < 3; words++) {
    const sepEnd = pos;
    while (pos > 0 && (text[pos - 1] === " " || text[pos - 1] === "\t")) pos--;
    if (pos === sepEnd) return false;
    const wordEnd = pos;
    for (let ch = charBefore(text, pos); pos > 0 && WINDOW_CHAR_RE.test(ch); ch = charBefore(text, pos)) {
      pos -= ch.length;
    }
    if (pos === wordEnd) return false;
    if (NEGATOR_RE.test(text.slice(Math.max(0, pos - 2), wordEnd))) return true;
  }
  return false;
}

function stripIgnored(prompt: string): string {
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of prompt.split(/\r?\n/)) {
    const marker = FENCE_RE.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (marker !== undefined) {
      fence = marker;
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/(`+)[\s\S]*?\1/g, " ")
    .replace(/"[^"\n]*"/g, " ")
    .replace(/“[^”\n]*”/g, " ");
}

export function detectUltrawork(prompt: string): boolean {
  if (prompt.includes("<!-- omt-brief")) return false;
  const start = prompt.trimStart();
  if (start.startsWith("Act as the ")) return false;
  if (start.startsWith("/omt-ulw")) return false;
  if (start.startsWith("<task-notification>")) return false;
  if (start.startsWith("Delegated task ")) return false;
  const text = stripIgnored(prompt);
  for (const match of text.matchAll(PHRASE_RE)) {
    if (!isNegated(text, match.index)) return true;
  }
  return false;
}

export function ultraworkContext(): string {
  return [
    "omt ultrawork is on for this request.",
    "Load the omt-ulw skill before anything else and follow its steps in order, from step 0.",
    "You explore, ask question batches, plan, and build in this thread.",
    "One review child and one QA child check the work.",
    "Done needs evidence: report done only after the checks ran and passed, and quote their output.",
  ].join(" ");
}

export async function runUserPromptSubmitHook(ctx: CliContext): Promise<number> {
  try {
    const input = await ctx.readStdin();
    if (input.trim() === "") return 0;
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed !== "object" || parsed === null) return 0;
    const prompt = (parsed as { prompt?: unknown }).prompt;
    if (typeof prompt !== "string" || !detectUltrawork(prompt)) return 0;
    const output = {
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ultraworkContext() },
    };
    ctx.stdout(`${JSON.stringify(output)}\n`);
  } catch {
    // A hook failure must never block the user's prompt.
  }
  return 0;
}
