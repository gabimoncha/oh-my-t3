import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { tempDir, writeFile } from "../helpers.ts";
import { runMain, runOk } from "../run.ts";

export const STAMP = "20260102030405";

export interface Fixture {
  root: string;
  home: string;
  packageRoot: string;
  agents: string;
  claudeSkills: string;
  gemini: string;
  configDir: string;
  settings: string;
  manifest: string;
  backups: string;
  run: typeof runMain;
  runOk: typeof runOk;
}

export function writeSkill(packageRoot: string, name: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const path = join(packageRoot, "skills", name, file);
    writeFile(path, content);
  }
}

export function makeFixture(): Fixture {
  const root = tempDir("omt-install-");
  const packageRoot = join(root, "package");
  writeSkill(packageRoot, "alpha", { "SKILL.md": "---\nname: alpha\n---\nAlpha.\n" });
  writeSkill(packageRoot, "beta", {
    "SKILL.md": "---\nname: beta\n---\nBeta.\n",
    "references/notes.md": "Beta notes.\n",
  });
  writeSkill(packageRoot, "not-a-skill", { "README.md": "No SKILL.md here.\n" });
  const home = join(root, "home");
  mkdirSync(join(root, "project"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const configDir = join(home, ".config", "oh-my-t3");
  return {
    root,
    home,
    packageRoot,
    agents: join(home, ".agents", "skills"),
    claudeSkills: join(home, ".claude", "skills"),
    gemini: join(home, ".gemini", "config", "skills"),
    configDir,
    settings: join(home, ".claude", "settings.json"),
    manifest: join(configDir, "install.json"),
    backups: join(configDir, "backups"),
    run: (argv, options = {}) => runMain(argv, { root, packageRoot, ...options }),
    runOk: (argv, options = {}, message) => runOk(argv, { root, packageRoot, ...options }, message),
  };
}

// A map of every path under `dir` to its type and content, used to prove that nothing was written.
export function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string, rel: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      out[rel] = `link:${readlinkSync(path)}`;
    } else if (stat.isDirectory()) {
      out[rel] = "dir";
      for (const name of readdirSync(path)) walk(join(path, name), rel === "" ? name : `${rel}/${name}`);
    } else {
      out[rel] = `file:${createHash("sha256").update(readFileSync(path)).digest("hex")}:${stat.mtimeMs}`;
    }
  };
  walk(dir, "");
  return out;
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function assertAllUnchanged(output: string, options: { message?: string; ignoreNone?: boolean } = {}): void {
  const actions = output
    .split("\n")
    .filter((line) => /^ {2}\S/.test(line))
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((action) => !options.ignoreNone || action !== "none");
  const unique = [...new Set(actions)];
  assert.deepEqual(unique, ["unchanged"], options.message ?? `actions: ${unique.join(", ")}`);
}

// Every path under `dir` except .git, with the bytes of each file and the target of each link.
export function contentTree(dir: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const walk = (path: string, rel: string) => {
    for (const name of readdirSync(path).sort()) {
      if (rel === "" && name === ".git") continue;
      const full = join(path, name);
      const key = rel === "" ? name : `${rel}/${name}`;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) out[key] = `link:${readlinkSync(full)}`;
      else if (stat.isDirectory()) {
        out[key] = "dir";
        walk(full, key);
      } else out[key] = `file:${createHash("sha256").update(readFileSync(full, "utf8")).digest("hex")}`;
    }
  };
  walk(dir, "");
  return out;
}
