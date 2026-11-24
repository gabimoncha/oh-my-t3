import { errorMessage, OmtError } from "../util/errors.ts";

function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function parseError(text: string, source: string, offset: number, reason: string): OmtError {
  const { line, column } = position(text, offset);
  return new OmtError("jsonc_parse", `${source}:${line}:${column}: ${reason}`);
}

function blank(char: string): string {
  return char === "\n" || char === "\r" ? char : " ";
}

function skipString(chars: ArrayLike<string>, start: number): number {
  let i = start + 1;
  while (i < chars.length && chars[i] !== '"' && chars[i] !== "\n") {
    i += chars[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}

function stripComments(text: string, source: string): string[] {
  const out = text.split("");
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      i = skipString(text, i);
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        out[i] = blank(text[i] as string);
        i++;
      }
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw parseError(text, source, i, "unterminated block comment");
      for (let j = i; j < end + 2; j++) out[j] = blank(text[j] as string);
      i = end + 2;
    } else {
      i++;
    }
  }
  return out;
}

function stripTrailingCommas(chars: string[]): void {
  let i = 0;
  while (i < chars.length) {
    const char = chars[i];
    if (char === '"') {
      i = skipString(chars, i);
      continue;
    }
    if (char === ",") {
      let j = i + 1;
      while (j < chars.length && /\s/.test(chars[j] as string)) j++;
      if (chars[j] === "}" || chars[j] === "]") chars[i] = " ";
    }
    i++;
  }
}

// JSON.parse does not report a position for every error, so this scanner finds the offset of the first one.
function errorOffset(json: string): number {
  let i = 0;
  const fail = (): never => {
    throw i;
  };
  const ws = () => {
    while (i < json.length && " \t\n\r".includes(json[i] as string)) i++;
  };
  const expect = (char: string) => {
    if (json[i] !== char) fail();
    i++;
  };
  const string = () => {
    expect('"');
    for (;;) {
      const char = json[i];
      if (char === undefined || char < " ") fail();
      i++;
      if (char === '"') return;
      if (char === "\\") {
        const escape = json[i];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(json.slice(i + 1, i + 5))) fail();
          i += 5;
        } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) {
          i++;
        } else {
          fail();
        }
      }
    }
  };
  const value = (): void => {
    ws();
    const char = json[i];
    if (char === "{") {
      i++;
      ws();
      if (json[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        string();
        ws();
        expect(":");
        value();
        ws();
        if (json[i] === "}") {
          i++;
          return;
        }
        expect(",");
      }
    }
    if (char === "[") {
      i++;
      ws();
      if (json[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (json[i] === "]") {
          i++;
          return;
        }
        expect(",");
      }
    }
    if (char === '"') return string();
    for (const literal of ["true", "false", "null"]) {
      if (json.startsWith(literal, i)) {
        i += literal.length;
        return;
      }
    }
    const number = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    number.lastIndex = i;
    if (!number.test(json)) fail();
    i = number.lastIndex;
  };
  try {
    value();
    ws();
    return i;
  } catch (offset) {
    return offset as number;
  }
}

export function parseJsonc(text: string, source: string): unknown {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const chars = stripComments(body, source);
  stripTrailingCommas(chars);
  const json = chars.join("");
  try {
    return JSON.parse(json);
  } catch (error) {
    const reason = errorMessage(error).replace(/, ".*" is not valid JSON$/s, "").replace(/ in JSON at position \d+.*$/s, "");
    throw parseError(body, source, errorOffset(json), reason);
  }
}

interface Member {
  key: string;
  keyStart: number;
  keyEnd: number;
  colon: number;
  valueStart: number;
  valueEnd: number;
  comma: number | undefined; // offset of the comma after the value
}

function skipSpace(chars: string[], i: number): number {
  while (i < chars.length && /\s/.test(chars[i] as string)) i++;
  return i;
}

function skipValue(chars: string[], i: number): number {
  if (chars[i] === '"') return skipString(chars, i);
  if (chars[i] === "{" || chars[i] === "[") {
    let depth = 0;
    while (i < chars.length) {
      const char = chars[i];
      if (char === '"') {
        i = skipString(chars, i);
        continue;
      }
      if (char === "{" || char === "[") depth++;
      if (char === "}" || char === "]") depth--;
      i++;
      if (depth === 0) return i;
    }
    return i;
  }
  while (i < chars.length && !/[\s,}\]]/.test(chars[i] as string)) i++;
  return i;
}

interface ObjectScan {
  open: number;
  close: number;
  members: Member[];
}

// Comments are blanked in `chars`, so the offsets match the original text. `open` is the offset of the "{".
function objectMembers(chars: string[], open: number): ObjectScan {
  const members: Member[] = [];
  let i = skipSpace(chars, open + 1);
  while (chars[i] === '"') {
    const keyStart = i;
    const keyEnd = skipString(chars, i);
    const key = JSON.parse(chars.slice(keyStart, keyEnd).join("")) as string;
    const colon = skipSpace(chars, keyEnd);
    const valueStart = skipSpace(chars, colon + 1);
    const valueEnd = skipValue(chars, valueStart);
    i = skipSpace(chars, valueEnd);
    const comma = chars[i] === "," ? i : undefined;
    members.push({ key, keyStart, keyEnd, colon, valueStart, valueEnd, comma });
    if (comma === undefined) break;
    i = skipSpace(chars, comma + 1);
  }
  // parseJsonc reads "{,}" as an empty object.
  if (members.length === 0 && chars[i] === ",") i = skipSpace(chars, i + 1);
  return { open, close: skipSpace(chars, i), members };
}

interface Level {
  object: ObjectScan;
  matches: number[]; // indices of the members with this level's key
}

function lastMatch(level: Level): Member | undefined {
  const index = level.matches.at(-1);
  return index === undefined ? undefined : level.object.members[index];
}

// Follows the path through the last member with each key, the one that JSON.parse keeps. It stops at a missing key
// and at a value that is not an object, so a path never indexes into an array.
function walk(chars: string[], path: readonly string[]): Level[] {
  const levels: Level[] = [];
  let object = objectMembers(chars, skipSpace(chars, 0));
  for (const key of path) {
    const level = { object, matches: object.members.flatMap((member, index) => (member.key === key ? [index] : [])) };
    levels.push(level);
    const member = lastMatch(level);
    if (levels.length === path.length || member === undefined || chars[member.valueStart] !== "{") break;
    object = objectMembers(chars, member.valueStart);
  }
  return levels;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

// The whitespace before the key when the key starts its line.
function indentOf(text: string, member: Member | undefined): string | undefined {
  if (member === undefined) return undefined;
  const before = text.slice(lineStart(text, member.keyStart), member.keyStart);
  return /^[ \t]*$/.test(before) ? before : undefined;
}

// The whitespace at the start of the line that holds `offset`.
function lineIndent(text: string, offset: number): string {
  const start = lineStart(text, offset);
  let end = start;
  while (text[end] === " " || text[end] === "\t") end++;
  return text.slice(start, end);
}

// The end of the line at `offset` (before its "\r\n" or "\n") when only spaces and complete one-line comments
// follow there, else undefined. `offset` must lie outside strings and comments.
function endOfLine(text: string, offset: number): number | undefined {
  let i = offset;
  for (;;) {
    const char = text[i];
    if (char === undefined || char === "\n") return i;
    if (char === "\r" && text[i + 1] === "\n") return i;
    if (char === " " || char === "\t") {
      i++;
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      if (end === -1) return text.length;
      return text[end - 1] === "\r" ? end - 1 : end;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end === -1 || text.slice(i, end).includes("\n")) return undefined;
      i = end + 2;
    } else {
      return undefined;
    }
  }
}

// Removes one member and the comma it needs, and keeps every comment. A property alone on its line takes the line with it.
function removeMember(body: string, members: Member[], index: number): string {
  const member = members[index] as Member;
  const own = member.comma;
  const comma = own ?? members[index - 1]?.comma;
  let start = member.keyStart;
  let end = member.valueEnd;
  const last = own ?? member.valueEnd - 1;
  const rest = body.slice(member.valueEnd, last + 1);
  const lineEnd = /^[ \t]*,?$/.test(rest) ? /^[ \t]*(\r?\n)/.exec(body.slice(last + 1)) : null;
  const indent = indentOf(body, member);
  const wholeLine = indent !== undefined && lineEnd !== null;
  if (wholeLine) {
    start = lineStart(body, member.keyStart);
    end = last + 1 + lineEnd[0].length;
  }
  // A comment between the key and the colon describes the member's place, not its value, so it stays.
  const notes = body.slice(member.keyEnd, member.colon).match(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g) ?? [];
  const newline = lineEnd?.[1] ?? (body.includes("\r\n") ? "\r\n" : "\n");
  const kept = notes.length === 0
    ? ""
    : wholeLine
      ? notes.map((note) => `${indent}${note}${newline}`).join("")
      : notes.map((note) => (note.startsWith("//") ? `${note}${newline}` : `${note} `)).join("");
  const ranges: [number, number, string][] = [[start, end, kept]];
  if (comma !== undefined && (comma < start || comma >= end)) ranges.push([comma, comma + 1, ""]);
  ranges.sort((a, b) => b[0] - a[0]);
  let out = body;
  for (const [from, to, text] of ranges) out = out.slice(0, from) + text + out.slice(to);
  return out;
}

interface Layout {
  nl: string;
  step: string; // the indentation that one nesting level adds
}

const LINE_WIDTH = 100;

// `used` counts the other columns of the value's line: the text before the value and a comma right after it.
function render(value: unknown, layout: Layout, indent: string, used: number): string {
  const json = JSON.stringify(value);
  if (used + json.length <= LINE_WIDTH) return json;
  return JSON.stringify(value, null, layout.step).split("\n").join(layout.nl + indent);
}

// The indentation of the first member found in a top-level object value, minus the root member indentation.
function indentStep(body: string, chars: string[], root: ObjectScan): string {
  const firstIndent = (members: Member[]) => members.map((member) => indentOf(body, member)).find((indent) => indent !== undefined);
  const outer = firstIndent(root.members);
  for (const member of root.members) {
    if (chars[member.valueStart] !== "{") continue;
    const inner = firstIndent(objectMembers(chars, member.valueStart).members);
    if (inner === undefined) continue;
    return outer !== undefined && inner.length > outer.length && inner.startsWith(outer) ? inner.slice(outer.length) : "  ";
  }
  return "  ";
}

function replaceValue(body: string, member: Member, value: unknown, layout: Layout): string {
  const used = member.valueStart - lineStart(body, member.valueStart) + (member.comma === member.valueEnd ? 1 : 0);
  const json = render(value, layout, lineIndent(body, member.valueStart), used);
  return body.slice(0, member.valueStart) + json + body.slice(member.valueEnd);
}

// Adds a member after `anchor` with the comma that the object needs. When only spaces and one-line comments follow
// the anchor on its line, the member goes on the next line, so a same-line comment stays with its property. Else it
// goes on the same line, so it never lands inside a comment.
function insertAfter(body: string, anchor: Member, indent: string, key: string, value: unknown, layout: Layout): string {
  const comma = anchor.comma;
  const after = comma === undefined ? anchor.valueEnd : comma + 1;
  const lineEnd = endOfLine(body, after);
  const insert = lineEnd ?? after;
  const trailing = comma === undefined ? "" : ",";
  const name = `${JSON.stringify(key)}: `;
  let added: string;
  if (lineEnd === undefined) {
    const used = after - lineStart(body, after) + (comma === undefined ? 1 : 0) + 1 + name.length + trailing.length;
    added = ` ${name}${render(value, layout, lineIndent(body, after), used)}${trailing}`;
  } else {
    added = `${layout.nl}${indent}${name}${render(value, layout, indent, indent.length + name.length + trailing.length)}${trailing}`;
  }
  return comma === undefined
    ? body.slice(0, after) + "," + body.slice(after, insert) + added + body.slice(insert)
    : body.slice(0, insert) + added + body.slice(insert);
}

// A new top-level key goes after "version" or "defaults", whichever is last, or first in the object.
function insertTopLevel(body: string, chars: string[], root: ObjectScan, key: string, value: unknown, layout: Layout): string {
  const { open, close, members } = root;
  const anchor = members.findLast((entry) => entry.key === "version" || entry.key === "defaults");
  const indent = indentOf(body, anchor ?? members[0]) ?? "  ";
  if (anchor !== undefined) return insertAfter(body, anchor, indent, key, value, layout);
  const name = `${JSON.stringify(key)}: `;
  if (members.length > 0) {
    const property = `${name}${render(value, layout, indent, indent.length + name.length + 1)}`;
    const insert = endOfLine(body, open + 1) ?? open + 1;
    return body.slice(0, insert) + `${layout.nl}${indent}${property},` + body.slice(insert);
  }
  const property = `${name}${render(value, layout, indent, indent.length + name.length)}`;
  const multiline = chars.slice(open + 1, close).includes("\n");
  return body.slice(0, open + 1) + `${layout.nl}${indent}${property}` + (multiline ? "" : layout.nl) + body.slice(open + 1);
}

// A new nested key goes after the last member, with the indentation of its siblings. In an object with no member,
// it goes after the last comment, with the parent's indentation plus one step, and a one-line object becomes
// multi-line with the closing brace at the parent's indentation.
function appendMember(body: string, chars: string[], object: ObjectScan, parent: Member, key: string, value: unknown, layout: Layout): string {
  const parentIndent = lineIndent(body, parent.keyStart);
  const anchor = object.members.at(-1);
  if (anchor !== undefined) {
    const sibling = object.members.map((member) => indentOf(body, member)).findLast((indent) => indent !== undefined);
    return insertAfter(body, anchor, sibling ?? parentIndent + layout.step, key, value, layout);
  }
  // parseJsonc reads "{,}" as an empty object; the stray comma cannot stay in front of the new member.
  const stray = chars.indexOf(",", object.open);
  if (stray !== -1 && stray < object.close) {
    body = body.slice(0, stray) + " " + body.slice(stray + 1);
    chars[stray] = " ";
  }
  let end = object.close;
  while (end > object.open + 1 && body[end - 1] === chars[end - 1]) end--;
  const indent = parentIndent + layout.step;
  const name = `${JSON.stringify(key)}: `;
  const added = `${layout.nl}${indent}${name}${render(value, layout, indent, indent.length + name.length)}`;
  if (body.slice(end, object.close).includes("\n")) {
    const insert = endOfLine(body, end) ?? end;
    return body.slice(0, insert) + added + body.slice(insert);
  }
  return body.slice(0, end) + added + layout.nl + parentIndent + body.slice(object.close);
}

// Sets, adds, or (with undefined) removes the value at `path` in a JSONC object. Every byte outside the edited value
// stays, with three exceptions: duplicate keys on the path are merged into the last one, an empty "{}" that gets a
// member becomes multi-line, and a removal also removes each object that it empties, up to the first object that
// keeps a member or a comment, never a top-level key. Missing parents are created as one nested value. Removing a
// path that does not exist returns the text unchanged.
export function setJsoncValue(text: string, path: readonly string[], value: unknown | undefined): string {
  if (path.length === 0) throw new OmtError("jsonc_edit", "cannot edit the config: the path is empty");
  if (path.length > 32) throw new OmtError("jsonc_edit", "cannot edit the config: the path exceeds 32 segments");
  if (path.includes("")) throw new OmtError("jsonc_edit", "cannot edit the config: the path has an empty segment");
  if (value !== undefined && JSON.stringify(value) === undefined) {
    throw new OmtError("jsonc_edit", "cannot edit the config: the value has no JSON form");
  }
  const bom = text.charCodeAt(0) === 0xfeff ? "﻿" : "";
  let body = bom === "" ? text : text.slice(1);
  const root = parseJsonc(body, "config");
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new OmtError("jsonc_edit", "cannot edit the config: its root is not an object");
  }
  const scan = () => {
    const chars = stripComments(body, "config");
    return { chars, levels: walk(chars, path) };
  };
  const first = scan();
  const duplicates = first.levels.reduce((sum, level) => sum + Math.max(0, level.matches.length - 1), 0);
  if (duplicates > 16) throw new OmtError("jsonc_edit", "cannot edit the config: the path has more than 16 duplicate keys");
  if (value === undefined && (first.levels[path.length - 1]?.matches.length ?? 0) === 0) return text;
  const layout = {
    nl: body.includes("\r\n") ? "\r\n" : "\n",
    step: indentStep(body, first.chars, (first.levels[0] as Level).object),
  };
  // JSON.parse keeps the last of duplicate keys. The others go before the edit, so that removing an emptied object
  // cannot make an older duplicate the live one. A removal removes every occurrence of the last key anyway.
  const unique = value === undefined ? path.length - 1 : path.length;
  for (;;) {
    const level = scan().levels.slice(0, unique).find((entry) => entry.matches.length > 1);
    if (level === undefined) break;
    body = removeMember(body, level.object.members, level.matches[0] as number);
  }
  if (value === undefined) {
    for (;;) {
      const level = scan().levels[path.length - 1] as Level;
      if (level.matches.length === 0) break;
      body = removeMember(body, level.object.members, level.matches[0] as number);
    }
    // levels[depth] holds the value of a member at depth `depth`; a top-level key (depth 1) always stays.
    for (let depth = path.length - 1; depth >= 2; depth--) {
      const { levels } = scan();
      const object = (levels[depth] as Level).object;
      if (object.members.length > 0 || /\S/.test(body.slice(object.open + 1, object.close))) break;
      const parent = levels[depth - 1] as Level;
      body = removeMember(body, parent.object.members, parent.matches.at(-1) as number);
    }
    return bom + body;
  }
  const { chars, levels } = scan();
  const depth = levels.length - 1;
  const level = levels[depth] as Level;
  const nested = path.slice(depth + 1).reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
  const member = lastMatch(level);
  const key = path[depth] as string;
  if (member !== undefined) {
    body = replaceValue(body, member, nested, layout);
  } else if (depth === 0) {
    body = insertTopLevel(body, chars, level.object, key, nested, layout);
  } else {
    body = appendMember(body, chars, level.object, lastMatch(levels[depth - 1] as Level) as Member, key, nested, layout);
  }
  return bom + body;
}

// The depth-1 case of setJsoncValue: sets, adds, or (with undefined) removes one top-level key.
export function setTopLevelValue(text: string, key: string, value: unknown | undefined): string {
  return setJsoncValue(text, [key], value);
}
