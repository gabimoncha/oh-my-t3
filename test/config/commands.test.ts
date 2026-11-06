import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run as config } from "../../src/commands/config.ts";
import { run as init } from "../../src/commands/init.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { parseJsonc } from "../../src/config/jsonc.ts";
import { PROJECT_STARTER_CONFIG, USER_STARTER_CONFIG } from "../../src/config/starter.ts";
import { validateLayer } from "../../src/config/validate.ts";
import { OmtError } from "../../src/util/errors.ts";
import { logicalCwd } from "../../src/main.ts";
import { findProjectRoot } from "../../src/paths.ts";
import { OMT_GITIGNORE, fakeContext, omtExit, spawnOmt, tempDir, writeFile } from "../helpers.ts";

function setup() {
  const root = tempDir();
  const project = join(root, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  const configDir = join(root, "cfg");
  const userPath = join(configDir, "config.jsonc");
  const projectPath = join(project, ".omt3", "config.jsonc");
  const ctx = (argv: string[]) => fakeContext({
    root,
    argv,
    env: { HOME: join(root, "home"), OMT_CONFIG_DIR: configDir },
  });
  return { root, project, configDir, userPath, projectPath, ctx, write: writeFile };
}

test("config show --defaults prints the 12 default roles as JSON", async () => {
  const { ctx } = setup();
  const c = ctx(["show", "--defaults"]);
  assert.equal(await config(c), 0);
  const printed = JSON.parse(c.out());
  assert.deepEqual(printed, DEFAULT_CONFIG);
  assert.equal(Object.keys(printed.roles).length, 12);
  assert.equal("visuals" in printed, false);
});

test("an old config with retired keys and roles still loads, with one warning per key, and the keys have no effect", async () => {
  const { ctx, write, userPath } = setup();
  write(userPath, JSON.stringify({
    limits: { maxParallel: 2, maxTasksPerRun: 9 },
    roles: { verify: { fast: true }, quick: null, deep: { description: "Deep." }, plan: { fast: true } },
    profiles: {
      normal: { workflow: { build: { verify: "heavy", checkpoint: "unit", stallMinutes: 20, review: "off" } } },
      prototype: { limits: { maxTasksPerRun: 3 }, roles: { verify: { fast: true } } },
    },
  }));
  const c = ctx([]);
  assert.equal(await config(c), 0);
  const printed = JSON.parse(c.out());
  assert.deepEqual(printed.limits, { ...DEFAULT_CONFIG.limits, maxParallel: 2 });
  for (const name of ["verify", "quick", "deep", "plan"]) assert.equal(name in printed.roles, false, name);
  assert.deepEqual(printed.profiles.normal.workflow.build, { ...DEFAULT_CONFIG.profiles.normal?.workflow?.build, review: "off" });
  assert.equal("limits" in printed.profiles.prototype, DEFAULT_CONFIG.profiles.prototype?.limits !== undefined);
  assert.deepEqual(printed.profiles.prototype.limits, DEFAULT_CONFIG.profiles.prototype?.limits);
  assert.equal("roles" in printed.profiles.prototype && Object.keys(printed.profiles.prototype.roles).length > 0, false);
  const paths = [
    "limits.maxTasksPerRun",
    "roles.verify",
    "roles.quick",
    "roles.deep",
    "roles.plan",
    "profiles.normal.workflow.build.verify",
    "profiles.normal.workflow.build.checkpoint",
    "profiles.normal.workflow.build.stallMinutes",
    "profiles.prototype.limits.maxTasksPerRun",
    "profiles.prototype.roles.verify",
  ];
  assert.equal(c.err(), paths.map((path) => `warning ${userPath} ${path}: ${path} is no longer used; remove it\n`).join(""));
});

test("an old config with visuals still loads, with a warning that drops the key", async () => {
  const { ctx, write, userPath } = setup();
  write(userPath, '{ "visuals": { "plan": false }, "limits": { "maxParallel": 2 } }');
  const c = ctx([]);
  assert.equal(await config(c), 0);
  const printed = JSON.parse(c.out());
  assert.equal("visuals" in printed, false);
  assert.equal(printed.limits.maxParallel, 2);
  assert.equal(c.err(), `warning ${userPath} visuals: visuals is no longer used; remove it\n`);
});

test("config with no subcommand shows the effective config and prints issues to stderr", async () => {
  const { ctx, write, userPath } = setup();
  write(userPath, '{ "limits": { "maxParallel": 7, "maxDepth": 99 } }');
  const c = ctx([]);
  assert.equal(await config(c), 0);
  assert.equal(JSON.parse(c.out()).limits.maxParallel, 7);
  assert.equal(c.err(), `error ${userPath} limits.maxDepth: must be an integer from 0 to 3, got 99\n`);
});

test("config path prints both paths with absent and present", async () => {
  const { ctx, write, userPath, projectPath } = setup();
  let c = ctx(["path"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), `user: ${userPath} (absent)\nproject: ${projectPath} (absent)\n`);
  write(userPath, "{}");
  write(projectPath, "{}");
  c = ctx(["path"]);
  await config(c);
  assert.equal(c.out(), `user: ${userPath} (present)\nproject: ${projectPath} (present)\n`);
});

test("config validate prints config ok when there is no issue", async () => {
  const { ctx } = setup();
  const c = ctx(["validate"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), "config ok\n");
});

test("config validate prints each issue and exits 1 on an error", async () => {
  const { ctx, write, userPath, projectPath } = setup();
  write(userPath, '{ "bogus": 1 }');
  write(projectPath, "{ oops }");
  const c = ctx(["validate"]);
  assert.equal(await config(c), 1);
  const lines = c.out().trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? "", new RegExp(`^error ${userPath} bogus: unknown key "bogus"`));
  assert.ok(lines[1]?.startsWith(`error ${projectPath}: 1:3: `), String(lines[1]));
  assert.equal(lines[1]?.split(projectPath).length, 2, "prints the path once");
});

test("config validate reports the role, missing-description, and unknown-parent errors in project profiles", () => {
  const { root, project, projectPath, write } = setup();
  write(projectPath, JSON.stringify({
    profiles: {
      custom: { description: "Custom profile", roles: { exceute: { fast: true } } },
      broken: { extends: "protoype" },
    },
  }));
  const result = spawnOmt(["config", "validate"], { root, cwd: project, env: { PWD: project } });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), [
    `error ${projectPath} profiles.custom.roles.exceute: a new role needs description, access, and chain; missing: description, access, chain`,
    `error ${projectPath} profiles.broken: a new profile needs description; missing: description`,
    `error ${projectPath} profiles.broken.extends: unknown profile "protoype" in chain: broken -> protoype`,
  ].sort());
});

test("config validate exits 0 when every issue is a warning", async () => {
  const { ctx, write, userPath } = setup();
  write(userPath, '{ "roles": { "nope": null } }');
  const c = ctx(["validate"]);
  assert.equal(await config(c), 0);
  assert.match(c.out(), /^warning .* roles\.nope: /);
});

test("config validate --json prints ok and the issues", async () => {
  const { ctx, write, userPath } = setup();
  let c = ctx(["validate", "--json"]);
  assert.equal(await config(c), 0);
  assert.deepEqual(JSON.parse(c.out()), { ok: true, issues: [] });
  write(userPath, '{ "version": 3 }');
  c = ctx(["validate", "--json"]);
  assert.equal(await config(c), 1);
  const printed = JSON.parse(c.out());
  assert.equal(printed.ok, false);
  assert.deepEqual(printed.issues, [
    { source: userPath, path: "version", message: "must be 1, got 3", severity: "error" },
  ]);
});

test("config init writes the user starter, which loads with no issues", async () => {
  const { ctx, userPath } = setup();
  const c = ctx(["init"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), `create ${userPath}\n`);
  assert.equal(readFileSync(userPath, "utf8"), USER_STARTER_CONFIG);
  const v = ctx(["validate"]);
  assert.equal(await config(v), 0);
  assert.equal(v.out(), "config ok\n");
});

test("config init refuses to overwrite without --force", async () => {
  const { ctx, write, userPath } = setup();
  write(userPath, "{ }");
  await assert.rejects(config(ctx(["init"])), (error: unknown) => {
    assert.ok(error instanceof OmtError);
    assert.equal(error.exitCode, 1);
    assert.match(error.message, /already exists/);
    return true;
  });
  assert.equal(readFileSync(userPath, "utf8"), "{ }");
  const c = ctx(["init", "--force"]);
  assert.equal(await config(c), 0);
  assert.equal(c.out(), `overwrite ${userPath}\n`);
  assert.equal(readFileSync(userPath, "utf8"), USER_STARTER_CONFIG);
});

test("config init --force keeps a symlinked config a symlink", async () => {
  const { root, ctx, configDir, userPath } = setup();
  const real = join(root, "dotfiles", "omt.jsonc");
  mkdirSync(join(root, "dotfiles"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(real, "{}");
  symlinkSync(real, userPath);
  assert.equal(await config(ctx(["init", "--force"])), 0);
  assert.ok(lstatSync(userPath).isSymbolicLink());
  assert.equal(readFileSync(real, "utf8"), USER_STARTER_CONFIG);
});

test("config rejects an unknown subcommand, an extra argument, and an unknown flag", async () => {
  const { ctx } = setup();
  await assert.rejects(config(ctx(["edit"])), omtExit(2));
  await assert.rejects(config(ctx(["show", "extra"])), omtExit(2));
  await assert.rejects(config(ctx(["show", "--yaml"])), omtExit(2));
});

test("the starter configs are valid layers", () => {
  for (const text of [USER_STARTER_CONFIG, PROJECT_STARTER_CONFIG]) {
    assert.deepEqual(validateLayer(parseJsonc(text, "starter"), "starter").issues, []);
  }
});

// init ends with one worktree setup line, which test/commands covers.
function pathLines(text: string): string {
  return text.replace(/^worktree setup: .*\n/m, "");
}

test("init creates the config, plans dir, and .gitignore in the project root", async () => {
  const { project, ctx } = setup();
  const nested = join(project, "a", "b");
  mkdirSync(nested, { recursive: true });
  const c = { ...ctx([]), cwd: nested };
  let out = "";
  c.stdout = (text) => {
    out += text;
  };
  assert.equal(await init(c), 0);
  const omt = join(project, ".omt3");
  assert.equal(
    pathLines(out),
    `create ${join(omt, "config.jsonc")}\ncreate ${join(omt, "plans")}\ncreate ${join(omt, ".gitignore")}\n`,
  );
  assert.equal(readFileSync(join(omt, "config.jsonc"), "utf8"), PROJECT_STARTER_CONFIG);
  assert.ok(statSync(join(omt, "plans")).isDirectory());
  assert.equal(readFileSync(join(omt, ".gitignore"), "utf8"), OMT_GITIGNORE);
});

test("init creates only what is missing and never overwrites the config", async () => {
  const { project, ctx, write, projectPath } = setup();
  write(projectPath, "{ /* mine */ }");
  const omt = join(project, ".omt3");
  const c = ctx([]);
  assert.equal(await init(c), 0);
  assert.equal(
    pathLines(c.out()),
    `exists ${projectPath}\ncreate ${join(omt, "plans")}\ncreate ${join(omt, ".gitignore")}\n`,
  );
  assert.equal(readFileSync(projectPath, "utf8"), "{ /* mine */ }");
  const again = ctx([]);
  assert.equal(await init(again), 0);
  assert.equal(
    pathLines(again.out()),
    `exists ${projectPath}\nexists ${join(omt, "plans")}\nexists ${join(omt, ".gitignore")}\n`,
  );
});

test("init adds the missing lines to an existing .gitignore and keeps the user's lines", async () => {
  const { project, ctx, write, projectPath } = setup();
  const ignore = join(project, ".omt3", ".gitignore");
  write(ignore, "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\n# mine\nscratch/");
  const c = ctx([]);
  assert.equal(await init(c), 0);
  assert.equal(
    pathLines(c.out()),
    `create ${projectPath}\ncreate ${join(project, ".omt3", "plans")}\nupdate ${ignore}\n`,
  );
  assert.equal(
    readFileSync(ignore, "utf8"),
    "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\n# mine\nscratch/\nplans/\nlocks/\nguardrails.md\ngrills/\n",
  );
  const again = ctx([]);
  assert.equal(await init(again), 0);
  assert.match(again.out(), new RegExp(`^exists ${ignore.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("init updates a symlinked .gitignore through its target and leaves a dangling one alone", async () => {
  const { root, project, ctx, write } = setup();
  const ignore = join(project, ".omt3", ".gitignore");
  const target = join(root, "dotfiles", "omt-gitignore");
  write(target, "ledger.jsonl\n");
  mkdirSync(join(project, ".omt3"), { recursive: true });
  symlinkSync(target, ignore);
  assert.equal(await init(ctx([])), 0);
  assert.ok(lstatSync(ignore).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), OMT_GITIGNORE);

  const other = setup();
  const dangling = join(other.project, ".omt3", ".gitignore");
  mkdirSync(join(other.project, ".omt3"), { recursive: true });
  symlinkSync(join(other.root, "missing"), dangling);
  const c = other.ctx([]);
  assert.equal(await init(c), 0);
  assert.match(c.out(), /^exists .*\.gitignore$/m);
  assert.ok(lstatSync(dangling).isSymbolicLink());
});

test("init rejects arguments", async () => {
  const { ctx } = setup();
  await assert.rejects(init(ctx(["now"])), omtExit(2));
  await assert.rejects(init(ctx(["--force"])), omtExit(2));
});

test("config init --force writes through a dangling symlink to its target", async () => {
  const { root, ctx, configDir, userPath } = setup();
  const real = join(root, "dotfiles", "omt.jsonc");
  mkdirSync(configDir, { recursive: true });
  symlinkSync(real, userPath);
  assert.equal(await config(ctx(["init", "--force"])), 0);
  assert.ok(lstatSync(userPath).isSymbolicLink());
  assert.equal(readFileSync(real, "utf8"), USER_STARTER_CONFIG);
});

test("logicalCwd keeps $PWD when it names the same directory as the real cwd", () => {
  const root = tempDir();
  const real = join(root, "real");
  const link = join(root, "link");
  mkdirSync(real);
  symlinkSync(real, link);
  const physical = realpathSync(real);
  assert.equal(logicalCwd({ PWD: link }, physical), link);
  assert.equal(logicalCwd({ PWD: root }, physical), physical);
  assert.equal(logicalCwd({ PWD: "relative" }, physical), physical);
  assert.equal(logicalCwd({}, physical), physical);
});

test("logicalCwd drops $PWD when a symlink into a subdirectory hides the project root", () => {
  const root = tempDir();
  const repo = join(root, "real", "repo");
  const pkg = join(repo, "pkg");
  const link = join(root, "pkglink");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".omt3"));
  mkdirSync(pkg);
  symlinkSync(pkg, link);
  const physical = realpathSync(pkg);
  assert.equal(logicalCwd({ PWD: link }, physical), physical);
  assert.equal(findProjectRoot(logicalCwd({ PWD: link }, physical)), realpathSync(repo));

  const repoLink = join(root, "repolink");
  symlinkSync(repo, repoLink);
  assert.equal(logicalCwd({ PWD: join(repoLink, "pkg") }, physical), join(repoLink, "pkg"));
});

test("config path prints the user and project paths unresolved", () => {
  const root = tempDir();
  const real = join(root, "real");
  const link = join(root, "link");
  mkdirSync(join(real, ".git"), { recursive: true });
  symlinkSync(real, link);
  const env = { PWD: link, OMT_CONFIG_DIR: join(link, "cfg") };
  const result = spawnOmt(["config", "path"], { root, cwd: link, env });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    `user: ${join(link, "cfg", "config.jsonc")} (absent)\nproject: ${join(link, ".omt3", "config.jsonc")} (absent)\n`,
  );
});

test("with $PWD on a symlink into a subdirectory, the CLI uses the real project root", () => {
  const root = tempDir();
  const repo = join(root, "real", "repo");
  const link = join(root, "pkglink");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".omt3"));
  writeFileSync(join(repo, ".omt3", "config.jsonc"), '{ "version": 1 }\n');
  mkdirSync(join(repo, "pkg"));
  symlinkSync(join(repo, "pkg"), link);
  const env = { PWD: link };
  const cli = (args: string[]) => spawnOmt(args, { root, cwd: link, env });

  const path = cli(["config", "path"]);
  assert.equal(path.code, 0, path.stderr);
  assert.match(path.stdout, new RegExp(`^project: ${realpathSync(repo)}/\\.omt3/config\\.jsonc \\(present\\)$`, "m"));

  const add = cli(["ledger", "add", "--role", "execute", "--status", "dispatched", "--task-id", "t1"]);
  assert.equal(add.code, 0, add.stderr);
  assert.ok(readFileSync(join(repo, ".omt3", "ledger.jsonl"), "utf8").includes('"taskId":"t1"'));
  assert.throws(() => statSync(join(repo, "pkg", ".omt3")));
});
