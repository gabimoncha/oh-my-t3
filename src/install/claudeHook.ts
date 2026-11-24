import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { OmtError } from "../util/errors.ts";
import { readFileIfExists, writeFileAtomic } from "../util/fs.ts";
import { isRecord } from "../util/json.ts";
import { projectWriteTarget, writeTargetFor } from "./fsops.ts";

// Earlier releases added a Claude Code UserPromptSubmit hook with this signature. omt now only removes it.
export const HOOK_SIGNATURE = "# oh-my-t3code";
export const HOOK_EVENT = "UserPromptSubmit";

type Json = Record<string, unknown>;

export function isManagedCommand(command: unknown): boolean {
  return typeof command === "string" && command.trimEnd().endsWith(HOOK_SIGNATURE);
}

export function parseSettings(text: string | undefined, path: string): Json {
  if (text === undefined || text.trim() === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new OmtError("claude_settings", `${path} is not valid JSON; nothing was changed`, {
      hint: "fix the file, then run the command again",
      cause: error,
    });
  }
  if (!isRecord(value)) throw new OmtError("claude_settings", `${path} does not hold a JSON object; nothing was changed`);
  if (value.hooks !== undefined && !isRecord(value.hooks)) {
    throw new OmtError("claude_settings", `"hooks" in ${path} is not an object; nothing was changed`);
  }
  const event = (value.hooks as Json | undefined)?.[HOOK_EVENT];
  if (event !== undefined && !Array.isArray(event)) {
    throw new OmtError("claude_settings", `"hooks.${HOOK_EVENT}" in ${path} is not an array; nothing was changed`);
  }
  return value;
}

// How a settings file is formatted, so that an edit keeps the owner's style.
export interface JsonStyle {
  indent: string; // "" is compact
  finalNewline: boolean;
  crlf: boolean;
}

export const DEFAULT_JSON_STYLE: JsonStyle = { indent: "  ", finalNewline: true, crlf: false };

export function detectJsonStyle(text: string | undefined): JsonStyle {
  if (text === undefined || text.trim() === "") return DEFAULT_JSON_STYLE;
  // An empty object such as "{}" shows no style, so it gets the default indentation.
  const empty = /^\s*\{\s*\}\s*$/.test(text);
  const indent = empty ? DEFAULT_JSON_STYLE.indent : (/\n([ \t]+)\S/.exec(text)?.[1] ?? "");
  return {
    indent: indent.startsWith("\t") ? "\t" : indent,
    finalNewline: text.endsWith("\n"),
    crlf: text.includes("\r\n"),
  };
}

export function serializeSettings(settings: Json, style: JsonStyle = DEFAULT_JSON_STYLE): string {
  const text = `${JSON.stringify(settings, null, style.indent)}${style.finalNewline ? "\n" : ""}`;
  return style.crlf ? text.replaceAll("\n", "\r\n") : text;
}

function managedHandlers(settings: Json): Json[] {
  const groups = (settings.hooks as Json | undefined)?.[HOOK_EVENT];
  if (!Array.isArray(groups)) return [];
  const found: Json[] = [];
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) continue;
    for (const handler of group.hooks) {
      if (isRecord(handler) && isManagedCommand(handler.command)) found.push(handler);
    }
  }
  return found;
}

export function findManagedCommands(settings: Json): string[] {
  return managedHandlers(settings).map((handler) => handler.command as string);
}

// Returns a copy of the settings without managed entries. Groups, the event key, and `hooks`
// are dropped only when removing the managed entry left them empty.
export function withoutHook(settings: Json): Json {
  const next = structuredClone(settings);
  const hooks = next.hooks;
  if (!isRecord(hooks) || !Array.isArray(hooks[HOOK_EVENT])) return next;
  const groups: unknown[] = [];
  let changed = false;
  for (const group of hooks[HOOK_EVENT] as unknown[]) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) {
      groups.push(group);
      continue;
    }
    const kept = group.hooks.filter((handler) => !(isRecord(handler) && isManagedCommand(handler.command)));
    if (kept.length === group.hooks.length) {
      groups.push(group);
      continue;
    }
    changed = true;
    if (kept.length > 0) groups.push({ ...group, hooks: kept });
  }
  if (!changed) return next;
  if (groups.length > 0) {
    hooks[HOOK_EVENT] = groups;
  } else {
    delete hooks[HOOK_EVENT];
    if (Object.keys(hooks).length === 0) delete next.hooks;
  }
  return next;
}

export interface HookChange {
  settingsPath: string;
  command: string; // the removed command
  action: "remove";
  before: string | undefined; // file content now, undefined when the file is missing
  after: string; // content to write
  empty?: boolean; // only {} is left
  restoreBackup?: string; // `after` holds the bytes of this install-time backup, which is then deleted
}

function parsesTo(text: string, value: Json): boolean {
  try {
    return isDeepStrictEqual(text.trim() === "" ? {} : JSON.parse(text), value);
  } catch {
    return false;
  }
}

// When the settings left after the removal equal the install-time backup, the change writes the
// backup's bytes back, so the file is exactly what it was before the install.
export async function planHookRemoval(settingsPath: string, installBackup?: string): Promise<HookChange | undefined> {
  const before = await readFileIfExists(settingsPath);
  if (before === undefined) return undefined;
  const settings = parseSettings(before, settingsPath);
  const current = findManagedCommands(settings);
  if (current.length === 0) return undefined;
  const remaining = withoutHook(settings);
  const change: HookChange = {
    settingsPath,
    command: current[0] ?? "",
    action: "remove",
    before,
    after: serializeSettings(remaining, detectJsonStyle(before)),
    empty: isDeepStrictEqual(remaining, {}),
  };
  const backup = installBackup === undefined ? undefined : await readFileIfExists(installBackup);
  if (installBackup !== undefined && backup !== undefined && parsesTo(backup, remaining)) {
    change.after = backup;
    change.restoreBackup = installBackup;
  }
  return change;
}

// Backs up the old file into `backupDir` (no backup when it is undefined), then writes onto the real
// path so a symlink stays a symlink. Returns the backup path, if one was written.
export async function writeHookChange(change: HookChange, backupDir: string | undefined, root?: string): Promise<string | undefined> {
  const current = await readFileIfExists(change.settingsPath);
  if (current !== change.before) {
    throw new OmtError("claude_settings", `${change.settingsPath} changed after the plan was made; nothing was written`, {
      hint: "run the command again",
    });
  }
  let backup: string | undefined;
  if (backupDir !== undefined && change.before !== undefined && change.restoreBackup === undefined) {
    backup = join(backupDir, "claude-settings.json");
    for (let n = 1; (await readFileIfExists(backup)) !== undefined; n += 1) {
      backup = join(backupDir, `claude-settings-${n}.json`);
    }
    const target = root === undefined ? backup : await projectWriteTarget(root, backup);
    await writeFileAtomic(target, change.before, { mode: 0o600 });
  }
  const target = root === undefined ? await writeTargetFor(change.settingsPath) : await projectWriteTarget(root, change.settingsPath);
  await writeFileAtomic(target, change.after);
  return backup;
}
