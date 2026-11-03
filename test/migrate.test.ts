import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { run as runUpdateCommand } from "../src/commands/update.ts";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { main } from "../src/main.ts";
import { CLI_PATH, GIT, childEnv, fakeContext, gitEnv, gitRepo, spawnOmt, tempDir, writeFile } from "./helpers.ts";

type Env = NodeJS.ProcessEnv;

function omt(root: string, args: string[], cwd: string, env: Env = {}, input = "") {
  return spawnOmt(args, { root, cwd, env: { PWD: cwd, ...env }, input });
}

function ok(root: string, args: string[], cwd: string, env: Env = {}) {
  const result = omt(root, args, cwd, env);
  assert.equal(result.code, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function hintLines(stderr: string): string[] {
  return stderr.split("\n").filter((line) => line.startsWith("hint: ") && line.includes("omt migrate"));
}

function replaceIn(path: string, from: string, to: string): void {
  if (!existsSync(path)) return;
  writeFileSync(path, readFileSync(path, "utf8").replaceAll(from, to));
}

// Turns a project install of this CLI into what 0.6.x wrote: the state in .omt/, and every recorded path,
// the hook command, and the exclude block naming .omt/.
function toLegacyProject(dir: string, gitDir = join(dir, ".git")): void {
  renameSync(join(dir, ".omt3"), join(dir, ".omt"));
  replaceIn(join(dir, ".omt", "install.json"), `${dir}/.omt3/`, `${dir}/.omt/`);
  replaceIn(join(dir, ".omt", "install.json"), `${dir}/.omt3"`, `${dir}/.omt"`);
  replaceIn(join(dir, ".claude", "settings.local.json"), `${dir}/.omt3/`, `${dir}/.omt/`);
  replaceIn(join(gitDir, "info", "exclude"), "/.omt3/", "/.omt/");
}

function installedProject(root: string, name = "project", env: Env = {}): string {
  const dir = join(root, name);
  gitRepo(root, dir);
  ok(root, ["install", "--project", "--hooks", "--yes"], dir, env);
  return dir;
}

function legacyProject(root: string, name = "project", env: Env = {}): string {
  const dir = installedProject(root, name, env);
  toLegacyProject(dir);
  const settings = readFileSync(join(dir, ".claude", "settings.local.json"), "utf8");
  assert.match(settings, /\/\.omt\/bin\/omt\\" hook user-prompt-submit/, "the fixture has the old hook command");
  assert.match(readFileSync(join(dir, ".git", "info", "exclude"), "utf8"), /^\/\.omt\/bin\/$/m, "the fixture has the old exclude entry");
  return dir;
}

// The user folder lives under XDG_CONFIG_HOME, so these tests clear OMT_CONFIG_DIR.
const XDG: Env = { OMT_CONFIG_DIR: "" };

test("a project with only .omt/ keeps working and prints one migrate hint", () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  ok(root, ["plan", "new", "old"], dir);
  assert.ok(existsSync(join(dir, ".omt", "plans", "old.md")), "a new plan goes into the old folder");
  assert.ok(!existsSync(join(dir, ".omt3")), "no new folder appears before migrate");
  ok(root, ["ledger", "add", "--role", "explore", "--status", "completed"], dir);
  assert.ok(existsSync(join(dir, ".omt", "ledger.jsonl")));

  assert.equal(ok(root, ["paths", "--omt"], dir).stdout, `${join(dir, ".omt")}\n`, "paths --omt names the folder in use");
  const list = ok(root, ["plan", "list"], dir);
  assert.match(list.stdout, /^old /m);
  assert.deepEqual(hintLines(list.stderr), [`hint: omt reads the old folder ${join(dir, ".omt")}; run "omt migrate" to move it`]);
  assert.equal(list.stderr.split("\n").filter((line) => line !== "").length, 1, list.stderr);

  const ledger = ok(root, ["ledger", "list"], dir);
  assert.match(ledger.stdout, /explore/);
  writeFile(join(dir, ".omt", "config.jsonc"), JSON.stringify({ version: 1, limits: { maxParallel: 3 } }));
  const config = ok(root, ["config", "show"], dir);
  assert.match(config.stdout, /"maxParallel": 3/);
  assert.equal(hintLines(config.stderr).length, 1);

  mkdirSync(join(dir, ".omt3"));
  const both = ok(root, ["plan", "list"], dir);
  assert.deepEqual(hintLines(both.stderr), [
    `hint: the old folder ${join(dir, ".omt")} sits beside ${join(dir, ".omt3")}; run "omt migrate" to move it`,
  ]);
});

test("a project with .omt3/ prints no hint", () => {
  const root = tempDir("omt-migrate-");
  const dir = installedProject(root);
  ok(root, ["plan", "new", "fresh"], dir);
  assert.ok(existsSync(join(dir, ".omt3", "plans", "fresh.md")));
  const list = ok(root, ["plan", "list"], dir);
  assert.equal(list.stderr, "");
});

test("an old user folder keeps working and is named in the hint, unless OMT_CONFIG_DIR is set", () => {
  const root = tempDir("omt-migrate-");
  const dir = join(root, "project");
  gitRepo(root, dir);
  const old = join(root, "home", ".config", "oh-my-t3code");
  writeFile(join(old, "config.jsonc"), JSON.stringify({ version: 1, limits: { maxParallel: 5 } }));

  const shown = ok(root, ["config", "show"], dir, XDG);
  assert.match(shown.stdout, /"maxParallel": 5/);
  assert.deepEqual(hintLines(shown.stderr), [`hint: omt reads the old folder ${old}; run "omt migrate" to move it`]);
  const path = ok(root, ["config", "path"], dir, XDG);
  assert.match(path.stdout, new RegExp(`${old}/config\\.jsonc`));

  const explicit = ok(root, ["config", "show"], dir, { OMT_CONFIG_DIR: old });
  assert.match(explicit.stdout, /"maxParallel": 5/);
  assert.equal(hintLines(explicit.stderr).length, 0, "OMT_CONFIG_DIR names the folder, so it is never old");
});

test("one hint line names both an old project folder and an old user folder", () => {
  const root = tempDir("omt-migrate-");
  const dir = join(root, "project");
  gitRepo(root, dir);
  mkdirSync(join(dir, ".omt", "plans"), { recursive: true });
  const old = join(root, "home", ".config", "oh-my-t3code");
  mkdirSync(old, { recursive: true });
  const list = ok(root, ["plan", "list"], dir, XDG);
  assert.deepEqual(hintLines(list.stderr), [
    `hint: omt reads the old folder ${join(dir, ".omt")}; omt reads the old folder ${old}; run "omt migrate" to move them`,
  ]);
  const doctor = omt(root, ["doctor"], dir, XDG);
  assert.match(doctor.stdout, /WARN\s+folders/);
});

test("the shadowed-state warning names the worktree's own .omt3 or .omt", () => {
  for (const name of [".omt3", ".omt"]) {
    const root = tempDir("omt-migrate-");
    const main = join(root, "main");
    const git = gitRepo(root, main);
    mkdirSync(join(main, ".omt3"));
    const worktree = join(root, "wt");
    git(["worktree", "add", "-q", "-b", "wt", worktree]);
    writeFile(join(worktree, name, "plans", "x.md"), "# x\n");
    const list = ok(root, ["plan", "list"], worktree);
    assert.match(list.stderr, new RegExp(`^warning: ${join(worktree, name).replaceAll(".", "\\.")} holds plans or a ledger that omt no longer reads; move them to ${join(main, ".omt3").replaceAll(".", "\\.")}$`, "m"));
  }
});

function git(root: string, cwd: string, args: string[]): string {
  return execFileSync(GIT, args, { cwd, env: gitEnv(root), encoding: "utf8" });
}

function hookCommand(dir: string): string {
  const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8")) as {
    hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] };
  };
  const command = settings.hooks.UserPromptSubmit[0]?.hooks[0]?.command;
  assert.ok(command !== undefined);
  return command;
}

function assertMigrated(root: string, dir: string, gitDir = join(dir, ".git")): void {
  assert.ok(!existsSync(join(dir, ".omt")), `${dir}/.omt is gone`);
  assert.ok(existsSync(join(dir, ".omt3", "install.json")));
  assert.match(hookCommand(dir), new RegExp(`^"${dir}/\\.omt3/bin/omt" hook user-prompt-submit`));
  const exclude = readFileSync(join(gitDir, "info", "exclude"), "utf8");
  assert.match(exclude, /^\/\.omt3\/bin\/$/m);
  assert.doesNotMatch(exclude, /\/\.omt\//);
  const manifest = readFileSync(join(dir, ".omt3", "install.json"), "utf8");
  assert.doesNotMatch(manifest, /\/\.omt[/"]/);
  assert.match(manifest, /\/\.omt3\/bin\/omt/);
  assert.match(readFileSync(join(dir, ".agents", "skills", "omt", "references", "delegation.md"), "utf8"), /`\.omt3\/bin\/omt`/);
  const version = spawnSync(join(dir, ".omt3", "bin", "omt"), ["--version"], { cwd: dir, env: childEnv(root), encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  const hook = spawnSync("/bin/sh", ["-c", hookCommand(dir)], { cwd: dir, env: childEnv(root), encoding: "utf8", input: JSON.stringify({ prompt: "start ulw" }) });
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(hook.stdout, /hookSpecificOutput/);
  assert.equal(hintLines(ok(root, ["plan", "list"], dir).stderr).length, 0, "no hint after migrate");
}

// A listing of every file under dir with its mode and a hash of its content.
function listing(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = join(dir, rel, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(join(rel, name));
      else out.push(`${join(rel, name)} ${(stat.mode & 0o777).toString(8)} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
    }
  };
  walk("");
  return out;
}

test("omt migrate moves a project's .omt/ and updates the hook, the exclude block, the manifest, and the skills", () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  ok(root, ["plan", "new", "old"], dir);
  ok(root, ["ledger", "add", "--role", "explore", "--status", "completed"], dir);
  const result = ok(root, ["migrate", "--yes"], dir);
  assert.match(result.stdout, new RegExp(`^  move   project ${join(dir, ".omt")} -> ${join(dir, ".omt3")}$`, "m"));
  assert.match(result.stdout, new RegExp(`^moved    ${join(dir, ".omt")} -> ${join(dir, ".omt3")}$`, "m"));
  assertMigrated(root, dir);
  assert.ok(existsSync(join(dir, ".omt3", "plans", "old.md")));
  assert.match(readFileSync(join(dir, ".omt3", "ledger.jsonl"), "utf8"), /explore/);
  assert.equal(ok(root, ["migrate", "--yes"], dir).stdout, "Nothing to migrate.\n");
});

test("omt migrate from a linked worktree moves the main checkout's .omt/", () => {
  const root = tempDir("omt-migrate-");
  const main = legacyProject(root, "main");
  const worktree = join(root, "wt");
  git(root, main, ["worktree", "add", "-q", "-b", "wt", worktree]);
  const result = ok(root, ["migrate", "--yes"], worktree);
  assert.match(result.stdout, new RegExp(`moved    ${join(main, ".omt")} -> `));
  assertMigrated(root, main);
  assert.ok(!existsSync(join(worktree, ".omt3")));
});

test("omt migrate moves a parent-folder .omt/ found above the current folder", () => {
  const root = tempDir("omt-migrate-");
  const parent = join(root, "parent");
  writeFile(join(parent, ".omt", "plans", "x.md"), "# x\n");
  const sub = join(parent, "sub");
  mkdirSync(sub);
  const result = ok(root, ["migrate", "--yes"], sub);
  assert.match(result.stdout, new RegExp(`moved    ${join(parent, ".omt")} -> ${join(parent, ".omt3")}`));
  assert.equal(readFileSync(join(parent, ".omt3", "plans", "x.md"), "utf8"), "# x\n");
  assert.ok(!existsSync(join(parent, ".omt")));
});

test("omt migrate moves every project in projects.json, then the user folder", () => {
  const root = tempDir("omt-migrate-");
  const a = legacyProject(root, "a", XDG);
  const b = legacyProject(root, "b", XDG);
  ok(root, ["install", "--yes"], a, XDG);
  const config = join(root, "home", ".config");
  renameSync(join(config, "oh-my-t3"), join(config, "oh-my-t3code"));
  replaceIn(join(config, "oh-my-t3code", "install.json"), `${config}/oh-my-t3/`, `${config}/oh-my-t3code/`);
  writeFile(join(config, "oh-my-t3code", "config.jsonc"), JSON.stringify({ version: 1, limits: { maxParallel: 5 } }));
  assert.match(readFileSync(join(config, "oh-my-t3code", "install.json"), "utf8"), /oh-my-t3code\/config\.jsonc/);

  const result = ok(root, ["migrate", "--yes"], a, XDG);
  assert.match(result.stdout, /^  move   user    /m);
  assertMigrated(root, a);
  assertMigrated(root, b);
  assert.ok(!existsSync(join(config, "oh-my-t3code")));
  const manifest = readFileSync(join(config, "oh-my-t3", "install.json"), "utf8");
  assert.doesNotMatch(manifest, /oh-my-t3code\//);
  assert.match(manifest, new RegExp(`${config}/oh-my-t3/config\\.jsonc`));
  const shown = ok(root, ["config", "show"], b, XDG);
  assert.match(shown.stdout, /"maxParallel": 5/);
  assert.equal(hintLines(shown.stderr).length, 0);
});

test("with OMT_CONFIG_DIR set, omt migrate leaves an old user folder alone", () => {
  const root = tempDir("omt-migrate-");
  const dir = join(root, "project");
  gitRepo(root, dir);
  const old = join(root, "home", ".config", "oh-my-t3code");
  writeFile(join(old, "config.jsonc"), "{}\n");
  assert.equal(ok(root, ["migrate", "--yes"], dir).stdout, "Nothing to migrate.\n");
  assert.ok(existsSync(old));
});

test("an open ledger start skips its project, and a plan with open units does not", () => {
  const root = tempDir("omt-migrate-");
  const busy = legacyProject(root, "busy");
  const idle = legacyProject(root, "idle");
  ok(root, ["ledger", "add", "--role", "execute", "--status", "dispatched", "--plan", "p", "--unit", "U1", "--client-request-id", "req-1"], busy);
  ok(root, ["plan", "new", "later"], idle);
  const result = ok(root, ["migrate", "--yes"], busy);
  assert.match(result.stdout, new RegExp(`^skipped  ${join(busy, ".omt")}: an open run \\(req-1\\); .*omt ledger done <id> --status cancelled`, "m"));
  assert.ok(existsSync(join(busy, ".omt")) && !existsSync(join(busy, ".omt3")));
  assertMigrated(root, idle);
  assert.ok(existsSync(join(idle, ".omt3", "plans", "later.md")));
});

test("with both folders, an old folder whose files are all included is deleted, and extra files move in", () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  ok(root, ["plan", "new", "old"], dir);
  ok(root, ["ledger", "add", "--role", "explore", "--status", "completed"], dir);
  ok(root, ["migrate", "--yes"], dir);

  writeFile(join(dir, ".omt", "plans", "old.md"), readFileSync(join(dir, ".omt3", "plans", "old.md"), "utf8"));
  const included = ok(root, ["migrate", "--yes"], dir);
  assert.match(included.stdout, /every file is already there; delete the old folder/);
  assert.match(included.stdout, /^merged   /m);
  assert.ok(!existsSync(join(dir, ".omt")));

  const ledger = readFileSync(join(dir, ".omt3", "ledger.jsonl"), "utf8");
  const extra = `${JSON.stringify({ ts: "2026-01-01T00:00:00.000Z", role: "qa", status: "completed" })}\n`;
  writeFile(join(dir, ".omt", "ledger.jsonl"), `${ledger}${extra}`);
  writeFile(join(dir, ".omt", "plans", "stray.md"), "# stray\n");
  const merged = ok(root, ["migrate", "--yes"], dir);
  assert.match(merged.stdout, /move 1 file, add 1 ledger line; then delete the old folder/);
  assert.equal(readFileSync(join(dir, ".omt3", "plans", "stray.md"), "utf8"), "# stray\n");
  assert.equal(readFileSync(join(dir, ".omt3", "ledger.jsonl"), "utf8"), `${ledger}${extra}`);
  assert.ok(!existsSync(join(dir, ".omt")));
});

test("with both folders, a file that differs asks on a TTY and skips without one; a differing install skips", async () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  ok(root, ["plan", "new", "old"], dir);
  ok(root, ["migrate", "--yes"], dir);
  writeFile(join(dir, ".omt", "plans", "old.md"), "# the old copy\n");
  const before = { legacy: listing(join(dir, ".omt")), current: listing(join(dir, ".omt3")) };

  const plain = ok(root, ["migrate", "--yes"], dir);
  assert.match(plain.stdout, /^skipped  .*plans\/old\.md differ; run omt migrate in a terminal/m);
  assert.deepEqual({ legacy: listing(join(dir, ".omt")), current: listing(join(dir, ".omt3")) }, before);

  const ctx = fakeContext({ cwd: dir, homedir: join(root, "home"), env: childEnv(root), isTTY: true, answer: "t" });
  assert.equal(await main(["migrate", "--yes"], ctx), 0, ctx.err());
  assert.ok(ctx.prompts.some((question) => question.startsWith("plans/old.md differs: keep the copy in")));
  assert.equal(readFileSync(join(dir, ".omt3", "plans", "old.md"), "utf8"), "# the old copy\n");
  assert.ok(!existsSync(join(dir, ".omt")));

  writeFile(join(dir, ".omt", "install.json"), "{}\n");
  const install = ok(root, ["migrate", "--yes"], dir);
  assert.match(install.stdout, /both folders hold an install that differs \(install\.json\)/);
  assert.ok(existsSync(join(dir, ".omt", "install.json")));
});

test("omt migrate changes nothing on a no, without a TTY and --yes, or with --dry-run", async () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  const before = listing(join(dir, ".omt"));

  const dry = ok(root, ["migrate", "--dry-run"], dir);
  assert.match(dry.stdout, /^  move   project /m);
  const plain = omt(root, ["migrate"], dir);
  assert.equal(plain.code, 1);
  assert.match(plain.stderr, /Re-run with --yes to apply\./);
  const ctx = fakeContext({ cwd: dir, homedir: join(root, "home"), env: childEnv(root), isTTY: true, answer: "n" });
  assert.equal(await main(["migrate"], ctx), 1);
  assert.deepEqual(ctx.prompts, ["Apply this plan? [y/N] "]);

  assert.ok(!existsSync(join(dir, ".omt3")));
  assert.deepEqual(listing(join(dir, ".omt")), before);
});

test("a project whose shim runs another omt is skipped", () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  replaceIn(join(dir, ".omt", "bin", "omt"), `cli="${CLI_PATH}"`, `cli="${join(root, "elsewhere", "src", "cli.ts")}"`);
  const result = ok(root, ["migrate", "--yes"], dir);
  assert.match(result.stdout, /^  skip   project .*: runs another omt \(.*elsewhere.*\), which cannot read \.omt3; run .* update --project there, then omt migrate$/m);
  assert.ok(existsSync(join(dir, ".omt")) && !existsSync(join(dir, ".omt3")));
});

test("a failed check after the copy deletes the copy and restores the hook and the exclude block", () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  chmodSync(join(dir, ".omt", "bin", "omt"), 0o644);
  const before = listing(join(dir, ".omt"));
  const settings = readFileSync(join(dir, ".claude", "settings.local.json"), "utf8");
  const exclude = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");

  const result = omt(root, ["migrate", "--yes"], dir);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /^failed   .*--version failed.*; rolled back, .* is unchanged$/m);
  assert.ok(!existsSync(join(dir, ".omt3")));
  assert.deepEqual(listing(join(dir, ".omt")), before);
  assert.equal(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"), settings);
  assert.equal(readFileSync(join(dir, ".git", "info", "exclude"), "utf8"), exclude);
});

test("omt update offers the migration on a terminal, and only prints a hint with --yes", async () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  const seams = (prompts: string[]) => ({
    latest: "0.1.0",
    isTTY: true,
    prompt: async (question: string) => {
      prompts.push(question);
      return "y";
    },
    run: async (argv: string[]) => {
      assert.deepEqual(argv.slice(-3), ["config", "show", "--defaults"]);
      return { code: 0, stdout: JSON.stringify(DEFAULT_CONFIG) };
    },
    fetch: (() => assert.fail("the update test must not use the network")) as unknown as typeof fetch,
  });

  const quiet = fakeContext({ cwd: dir, homedir: join(root, "home"), env: childEnv(root), argv: ["--yes"] });
  const quietPrompts: string[] = [];
  assert.equal(await runUpdateCommand(quiet, seams(quietPrompts)), 0, quiet.err());
  assert.match(quiet.err(), new RegExp(`^hint: old omt folders remain \\(${join(dir, ".omt")}\\); run "omt migrate" to move them$`, "m"));
  assert.ok(!quietPrompts.includes("Move them now? [y/N] "));
  assert.ok(existsSync(join(dir, ".omt")) && !existsSync(join(dir, ".omt3")));

  const ctx = fakeContext({ cwd: dir, homedir: join(root, "home"), env: childEnv(root) });
  const prompts: string[] = [];
  assert.equal(await runUpdateCommand(ctx, seams(prompts)), 0, ctx.err());
  assert.ok(prompts.includes("Move them now? [y/N] "), prompts.join("\n"));
  assert.match(ctx.out(), /^Old omt folders:$/m);
  assert.match(ctx.out(), new RegExp(`^moved    ${join(dir, ".omt")} -> `, "m"));
  assertMigrated(root, dir);
});

test("a folder that appears during the question is never deleted", async () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  const ctx = fakeContext({
    cwd: dir,
    homedir: join(root, "home"),
    env: childEnv(root),
    isTTY: true,
    prompt: async () => {
      writeFile(join(dir, ".omt3", "unique.md"), "made meanwhile\n");
      return "y";
    },
  });
  assert.equal(await main(["migrate"], ctx), 1);
  assert.match(ctx.out(), /appeared after the plan; nothing changed/);
  assert.equal(readFileSync(join(dir, ".omt3", "unique.md"), "utf8"), "made meanwhile\n");
  assert.ok(existsSync(join(dir, ".omt", "install.json")));
});

test("a held ledger lock skips its project", () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  writeFile(join(dir, ".omt", "locks", "ledger.lock"), `${process.pid} token\n`);
  const result = ok(root, ["migrate", "--yes"], dir);
  assert.match(result.stdout, /skip   project .*: a command holds .*ledger\.lock; run omt migrate again when it ends/);
  assert.ok(existsSync(join(dir, ".omt")) && !existsSync(join(dir, ".omt3")));
});

test("with both folders and the same install in each, the old folder is deleted", () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  ok(root, ["plan", "new", "old"], dir);
  ok(root, ["migrate", "--yes"], dir);
  execFileSync("cp", ["-Rp", join(dir, ".omt3"), join(dir, ".omt")]);
  const result = ok(root, ["migrate", "--yes"], dir);
  assert.match(result.stdout, /^merged   /m);
  assert.ok(!existsSync(join(dir, ".omt")));
  assertMigrated(root, dir);
});

test("with both user folders, projects in the old list move, and an unreadable old list keeps both folders", () => {
  const root = tempDir("omt-migrate-");
  const a = legacyProject(root, "a", XDG);
  const config = join(root, "home", ".config");
  renameSync(join(config, "oh-my-t3"), join(config, "oh-my-t3code"));
  writeFile(join(config, "oh-my-t3", "config.jsonc"), "{}\n");
  const other = join(root, "elsewhere");
  gitRepo(root, other);

  const result = ok(root, ["migrate", "--yes"], other, XDG);
  assert.match(result.stdout, new RegExp(`moved    ${join(a, ".omt")} -> `));
  assertMigrated(root, a);
  assert.match(result.stdout, /^merged   .*oh-my-t3code/m);
  assert.deepEqual(JSON.parse(readFileSync(join(config, "oh-my-t3", "projects.json"), "utf8")).projects.map((entry: { root: string }) => entry.root), [a]);

  writeFile(join(config, "oh-my-t3code", "projects.json"), "not json\n");
  const broken = ok(root, ["migrate", "--yes"], other, XDG);
  assert.match(broken.stdout, /skip   user    .*not valid JSON; both folders stay/);
  assert.ok(existsSync(join(config, "oh-my-t3code", "projects.json")));
});

test("a lock taken while migrate asks about a differing file skips the merge", async () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  ok(root, ["plan", "new", "old"], dir);
  ok(root, ["migrate", "--yes"], dir);
  writeFile(join(dir, ".omt", "plans", "old.md"), "# the old copy\n");
  const lock = join(dir, ".omt", "locks", "ledger.lock");
  const ctx = fakeContext({
    cwd: dir,
    homedir: join(root, "home"),
    env: childEnv(root),
    isTTY: true,
    prompt: async () => {
      writeFile(lock, `${process.pid} token\n`);
      return "t";
    },
  });
  assert.equal(await main(["migrate", "--yes"], ctx), 0, ctx.err());
  assert.match(ctx.out(), /^skipped  .*: a command holds .*ledger\.lock/m);
  assert.ok(existsSync(lock));
  assert.equal(readFileSync(join(dir, ".omt", "plans", "old.md"), "utf8"), "# the old copy\n");
  assert.notEqual(readFileSync(join(dir, ".omt3", "plans", "old.md"), "utf8"), "# the old copy\n");
});

test("an empty answer about a differing file changes nothing", async () => {
  const root = tempDir("omt-migrate-");
  const dir = legacyProject(root);
  ok(root, ["plan", "new", "old"], dir);
  ok(root, ["migrate", "--yes"], dir);
  writeFile(join(dir, ".omt", "plans", "old.md"), "# the old copy\n");
  const before = { legacy: listing(join(dir, ".omt")), current: listing(join(dir, ".omt3")) };
  const ctx = fakeContext({ cwd: dir, homedir: join(root, "home"), env: childEnv(root), isTTY: true, answer: "" });
  assert.equal(await main(["migrate", "--yes"], ctx), 1);
  assert.match(ctx.out(), /^failed   .*no k or t for plans\/old\.md; nothing changed, both folders stay$/m);
  assert.deepEqual({ legacy: listing(join(dir, ".omt")), current: listing(join(dir, ".omt3")) }, before);
});
