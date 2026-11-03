import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { PROJECT_STARTER_CONFIG } from "../../src/config/starter.ts";
import {
  excludeBegin,
  excludeEnd,
  excludePattern,
  findGitExclude,
  withExcludeBlock,
  withGitignoreLines,
  withoutExcludeBlocks,
} from "../../src/install/project.ts";
import { detectJsonStyle } from "../../src/install/claudeHook.ts";
import { MANAGED_MARKER } from "../../src/util/fs.ts";
import { childEnv, CLI_PATH, gitRepo, OMT_GITIGNORE, writeFile } from "../helpers.ts";
import { assertAllUnchanged, contentTree, makeFixture, readJson, snapshot, STAMP } from "./fixture.ts";
import type { Fixture } from "./fixture.ts";
import { doctor } from "../run.ts";

const GIT_EXCLUDE_DEFAULT = "# git ls-files --others --exclude-from=.git/info/exclude\n# *~\n";

interface ProjectFixture extends Fixture {
  project: string;
  exclude: string;
}

// A fixture whose project is a git repository with the default info/exclude.
function projectFixture(git = true): ProjectFixture {
  const f = makeFixture();
  const project = join(f.root, "project");
  const exclude = join(project, ".git", "info", "exclude");
  if (git) {
    mkdirSync(join(project, ".git", "info"), { recursive: true });
    writeFileSync(exclude, GIT_EXCLUDE_DEFAULT);
  }
  return { ...f, project, exclude };
}

function block(root: string, ...entries: string[]): string {
  return [excludeBegin(root), ...entries, excludeEnd(root)].join("\n");
}

const SKILL_ENTRIES = [
  "/.agents/skills/alpha/",
  "/.agents/skills/beta/",
  "/.claude/skills/alpha",
  "/.claude/skills/beta",
  "/.agents/.omt-*/",
  "/.omt/bin/",
  "/.omt/install.json",
  "/.omt/backups/",
];

// The entries for the files in .omt that an install created.
const CREATED_OMT = ["/.omt/config.jsonc", "/.omt/.gitignore"];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("install --project writes copies, relative links, config, shim, .gitignore, manifest, and exclude block", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);

  for (const name of ["alpha", "beta"]) {
    assert.ok(existsSync(join(f.project, ".agents", "skills", name, MANAGED_MARKER)));
    const link = join(f.project, ".claude", "skills", name);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readlinkSync(link), `../../.agents/skills/${name}`);
    assert.equal(realpathSync(link), realpathSync(join(f.project, ".agents", "skills", name)));
  }
  assert.equal(readFileSync(join(f.project, ".omt", "config.jsonc"), "utf8"), PROJECT_STARTER_CONFIG);
  assert.ok(statSync(join(f.project, ".omt", "plans")).isDirectory());
  assert.equal(
    readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"),
    OMT_GITIGNORE,
  );

  const shim = join(f.project, ".omt", "bin", "omt");
  assert.equal(
    readFileSync(shim, "utf8"),
    `#!/bin/sh\n# oh-my-t3code project shim\nruntime="${process.execPath}"\ncli="${CLI_PATH}"\n[ -x "$runtime" ] || runtime=bun\nexec "$runtime" "$cli" "$@"\n`,
  );
  assert.equal(statSync(shim).mode & 0o777, 0o755);

  const manifest = readJson(join(f.project, ".omt", "install.json"));
  assert.equal(manifest.scope, "project");
  assert.equal(manifest.root, f.project);
  assert.equal(manifest.skillsRoot, join(f.project, ".agents", "skills"));
  assert.deepEqual(manifest.config, { path: join(f.project, ".omt", "config.jsonc"), created: true });
  const omt = join(f.project, ".omt");
  assert.deepEqual(manifest.project, {
    omtDirCreated: true,
    settingsCreated: false,
    shim,
    gitExclude: f.exclude,
    excludeFile: { created: false, dirCreated: false, addedNewline: false },
    files: [
      { path: join(omt, ".gitignore"), sha256: sha256(OMT_GITIGNORE) },
      { path: join(omt, "config.jsonc"), sha256: sha256(PROJECT_STARTER_CONFIG) },
    ],
    dirs: [omt, join(omt, "plans"), join(omt, "bin"), ...[".agents", ".agents/skills", ".claude", ".claude/skills"].map((dir) => join(f.project, dir))],
  });

  assert.equal(readFileSync(f.exclude, "utf8"), `${GIT_EXCLUDE_DEFAULT}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  assert.deepEqual(Object.keys(snapshot(f.home)), ["", ".config", ".config/oh-my-t3code", ".config/oh-my-t3code/projects.json"], "the home directory holds only the project list");

  const again = await f.runOk(["install", "--project", "--yes"]);
  assertAllUnchanged(again.ctx.out(), { ignoreNone: true });
  assert.match(again.ctx.out(), /Everything is up to date\./);
});

test("install --project --dry-run writes nothing", async () => {
  const f = projectFixture();
  const before = snapshot(f.root);
  const { ctx } = await f.runOk(["install", "--project", "--hooks", "--dry-run"]);
  assert.match(ctx.out(), /create {3}.*\.omt[/\\]bin[/\\]omt/);
  assert.match(ctx.out(), /create {3}managed block in /);
  assert.deepEqual(snapshot(f.root), before);
});

test("findGitExclude handles a .git directory, a worktree .git file with commondir, and no .git", async () => {
  const f = projectFixture();
  assert.deepEqual(await findGitExclude(f.project), { path: f.exclude, top: f.project });

  const main = join(f.root, "main-repo", ".git");
  const worktree = join(f.root, "wt");
  mkdirSync(join(main, "worktrees", "wt"), { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(main, "worktrees", "wt", "commondir"), "../..\n");
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, "worktrees", "wt")}\n`);
  assert.deepEqual(await findGitExclude(worktree), { path: join(main, "info", "exclude"), top: worktree });

  const noCommon = join(f.root, "wt2");
  mkdirSync(join(f.root, "gitdir2"), { recursive: true });
  mkdirSync(noCommon, { recursive: true });
  writeFileSync(join(noCommon, ".git"), "gitdir: ../gitdir2\n");
  assert.deepEqual(await findGitExclude(noCommon), { path: join(f.root, "gitdir2", "info", "exclude"), top: noCommon });

  const plain = join(f.root, "plain");
  mkdirSync(plain);
  const none = await findGitExclude(plain);
  assert.equal(none.path, undefined);
  assert.match(none.note ?? "", /no \.git/);
});

test("install --project in a worktree installs into the main checkout and its exclude file", async () => {
  const f = projectFixture(false);
  const mainRepo = join(f.root, "main-repo");
  const main = join(mainRepo, ".git");
  mkdirSync(join(main, "worktrees", "project"), { recursive: true });
  writeFileSync(join(main, "worktrees", "project", "commondir"), "../..\n");
  writeFileSync(join(f.project, ".git"), `gitdir: ${join(main, "worktrees", "project")}\n`);
  await f.runOk(["install", "--project", "--yes"]);
  assert.equal(readFileSync(join(main, "info", "exclude"), "utf8"), `${block(mainRepo, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  assert.ok(existsSync(join(mainRepo, ".omt", "install.json")));
  assert.deepEqual(readdirSync(f.project), [".git"], "the worktree gets no files");
});

test("the exclude block replaces an older block and keeps every other line", async () => {
  const f = projectFixture();
  writeFileSync(f.exclude, `first\n${block(f.project, "/old-entry")}\nlast\n`);
  const { ctx } = await f.runOk(["install", "--project", "--yes"]);
  assert.match(ctx.out(), /update {3}managed block in /);
  assert.equal(readFileSync(f.exclude, "utf8"), `first\n${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\nlast\n`);

  assert.equal(withExcludeBlock("a", "/r", ["/x"]), `a\n${block("/r", "/x")}\n`);
  assert.equal(withExcludeBlock(undefined, "/r", ["/x"]), `${block("/r", "/x")}\n`);
  assert.equal(withoutExcludeBlocks(`a\n${block("/r", "/x")}\nb\n`, ["/r"]), "a\nb\n");
  assert.equal(withoutExcludeBlocks(`a\n${block("/r", "/x")}\nb\n`, ["/other"]), `a\n${block("/r", "/x")}\nb\n`);
  assert.equal(withoutExcludeBlocks("a\nb\n", ["/r"]), "a\nb\n");
});

test("install --project without .git prints a note and writes no block", async () => {
  const f = projectFixture(false);
  mkdirSync(join(f.project, ".omt"));
  const { ctx } = await f.runOk(["install", "--project", "--yes"]);
  assert.match(ctx.out(), /skip {5}\(.*has no \.git, and no parent directory has one; git exclude skipped\)/);
  assert.match(ctx.out(), /^note: .*has no \.git/m);
  assert.ok(existsSync(join(f.project, ".omt", "bin", "omt")));
  assert.equal(readJson(join(f.project, ".omt", "install.json")).project !== undefined, true);
});

test("--no-git-exclude writes no block; it needs --project", async () => {
  const f = projectFixture();
  const { ctx } = await f.runOk(["install", "--project", "--no-git-exclude", "--yes"]);
  assert.match(ctx.out(), /skip {5}\(--no-git-exclude\)/);
  assert.equal(readFileSync(f.exclude, "utf8"), GIT_EXCLUDE_DEFAULT);
  assert.equal((await f.run(["install", "--no-git-exclude", "--yes"])).code, 2);
});

test("created .omt files and /.claude/settings.local.json are excluded only when the install created them", async () => {
  const f = projectFixture();
  mkdirSync(join(f.project, ".omt"));
  mkdirSync(join(f.project, ".claude"));
  writeFileSync(join(f.project, ".claude", "settings.local.json"), '{ "theme": "dark" }\n');
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.equal(
    readFileSync(f.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`,
  );
  const project = readJson(join(f.project, ".omt", "install.json")).project as Record<string, unknown>;
  assert.equal(project.omtDirCreated, false);
  assert.equal(project.settingsCreated, false);
  assert.deepEqual(
    project.dirs,
    [join(".omt", "plans"), join(".omt", "bin"), join(".omt", "backups"), ".agents", join(".agents", "skills"), join(".claude", "skills")].map((dir) => join(f.project, dir)),
  );

  const g = projectFixture();
  await g.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.equal(
    readFileSync(g.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(g.project, ...SKILL_ENTRIES, ...CREATED_OMT, "/.claude/settings.local.json")}\n`,
  );
  // A second run still knows that it created both paths.
  const again = await g.run(["install", "--project", "--hooks", "--yes"]);
  assertAllUnchanged(again.ctx.out(), { ignoreNone: true });
});

test("--hooks --project edits only settings.local.json, and uninstall removes only the omt entry", async () => {
  const f = projectFixture();
  const local = join(f.project, ".claude", "settings.local.json");
  mkdirSync(join(f.project, ".claude"));
  const mine = { type: "command", command: "echo mine" };
  writeFileSync(local, JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [mine] }] } }, null, 2));
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.ok(!existsSync(f.settings), "the user settings.json stays absent");
  assert.ok(!existsSync(join(f.project, ".claude", "settings.json")));
  const settings = readJson(local) as { theme: string; hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] } };
  assert.equal(settings.hooks.UserPromptSubmit.length, 2);
  assert.match(settings.hooks.UserPromptSubmit[1]?.hooks[0]?.command ?? "", /hook user-prompt-submit # oh-my-t3code$/);

  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.deepEqual(readJson(local), { theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [mine] }] } });
  assert.ok(!existsSync(join(f.project, ".omt", "backups")), "the install-time backup was restored and removed");
});

test("uninstall --project removes what the install added and keeps plans and the ledger", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  writeFileSync(join(f.project, ".omt", "ledger.jsonl"), "{}\n");
  writeFileSync(join(f.project, ".omt", "plans", "demo.md"), "# demo\n");

  const { ctx } = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.deepEqual(ctx.out().match(/backup/g), null, "a created settings file holding only the omt entry is deleted without a backup");
  assert.match(ctx.out(), /keep {5}.*\.gitignore {2}\(keeps the ledger and evidence that stay out of git\)/);
  assert.match(ctx.out(), /keep {5}.*install\.json {2}\(records the created files that stay\)/);
  assert.equal(readFileSync(f.exclude, "utf8"), `${GIT_EXCLUDE_DEFAULT}${block(f.project, "/.omt/.gitignore", "/.omt/install.json")}\n`);
  assert.deepEqual(readdirSync(f.project).sort(), [".git", ".omt"]);
  assert.deepEqual(readdirSync(join(f.project, ".omt")).sort(), [".gitignore", "install.json", "ledger.jsonl", "plans"]);
  assert.deepEqual(readdirSync(join(f.project, ".omt", "plans")), ["demo.md"]);
  assert.deepEqual(readJson(join(f.home, ".config", "oh-my-t3code", "projects.json")), { version: 1, projects: [] });

  const g = projectFixture();
  await g.runOk(["install", "--project", "--hooks", "--yes"]);
  await g.runOk(["uninstall", "--project", "--yes"]);
  assert.deepEqual(readdirSync(g.project), [".git"]);
});

test("uninstall --project keeps an edited created file; --purge removes an edited created config", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);
  const config = join(f.project, ".omt", "config.jsonc");
  const gitignore = join(f.project, ".omt", ".gitignore");
  writeFileSync(config, `${PROJECT_STARTER_CONFIG}// mine\n`);
  writeFileSync(gitignore, "mine\n");
  const kept = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.match(kept.ctx.out(), /keep {5}.*config\.jsonc {2}\(edited after the install; add --purge to remove it\)/);
  assert.match(kept.ctx.out(), /keep {5}.*\.gitignore {2}\(edited after the install\)/);
  assert.ok(existsSync(config));
  assert.ok(existsSync(gitignore));

  const g = projectFixture();
  await g.runOk(["install", "--project", "--yes"]);
  writeFileSync(join(g.project, ".omt", "config.jsonc"), "{}\n");
  await g.runOk(["uninstall", "--project", "--purge", "--yes"]);
  assert.deepEqual(readdirSync(g.project), [".git"]);
});

test("uninstall --project keeps a locally modified skill without --force", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);
  writeFileSync(join(f.project, ".agents", "skills", "alpha", "SKILL.md"), "edited\n");
  const { ctx } = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.match(ctx.out(), /keep {5}.*alpha {2}\(locally modified\)/);
  assert.ok(existsSync(join(f.project, ".agents", "skills", "alpha", "SKILL.md")));
  assert.ok(lstatSync(join(f.project, ".claude", "skills", "alpha")).isSymbolicLink());
  assert.ok(!existsSync(join(f.project, ".agents", "skills", "beta")));

  await f.runOk(["uninstall", "--project", "--yes", "--force"]);
  assert.ok(!existsSync(join(f.project, ".agents")));
  assert.ok(existsSync(join(f.project, ".omt", "backups", STAMP, "agents", "alpha", "SKILL.md")));
});

test("uninstall --project --purge removes the config only when the install created it", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);
  writeFileSync(join(f.project, ".omt", "plans", "demo.md"), "# demo\n");
  await f.runOk(["uninstall", "--project", "--purge", "--yes"]);
  assert.ok(!existsSync(join(f.project, ".omt", "config.jsonc")));
  assert.ok(existsSync(join(f.project, ".omt", "plans", "demo.md")));

  const g = projectFixture();
  mkdirSync(join(g.project, ".omt"));
  writeFileSync(join(g.project, ".omt", "config.jsonc"), '{ "version": 1 }\n');
  await g.runOk(["install", "--project", "--yes"]);
  const kept = await g.runOk(["uninstall", "--project", "--purge", "--yes"]);
  assert.match(kept.ctx.out(), /keep {5}.*config\.jsonc {2}\(not created by omt install\)/);
  assert.equal(readFileSync(join(g.project, ".omt", "config.jsonc"), "utf8"), '{ "version": 1 }\n');
});

test("--targets gemini with --project is a usage error, and a temp cliPath is refused", async () => {
  const f = projectFixture();
  const before = snapshot(f.root);
  const gemini = await f.run(["install", "--project", "--targets", "agents,gemini", "--yes"]);
  assert.equal(gemini.code, 2);
  assert.match(gemini.ctx.err(), /gemini target is not available with --project/);

  const temp = await f.run(["install", "--project", "--yes"], { cliPath: join(tmpdir(), "omt-x", "cli.js") });
  assert.equal(temp.code, 1);
  assert.match(temp.ctx.err(), /refusing --project: the omt CLI runs from a temporary path/);
  assert.match(temp.ctx.err(), /^hint: /m);
  assert.deepEqual(snapshot(f.root), before);
});

test("the shim: an unmanaged file conflicts, --force backs it up, and a changed managed shim updates", async () => {
  const f = projectFixture();
  const shim = join(f.project, ".omt", "bin", "omt");
  mkdirSync(join(f.project, ".omt", "bin"), { recursive: true });
  writeFileSync(shim, "#!/bin/sh\necho mine\n");
  const conflict = await f.run(["install", "--project", "--yes"]);
  assert.equal(conflict.code, 1);
  assert.match(conflict.ctx.out(), /conflict .*omt {2}\(exists and is not managed by omt\)/);

  await f.runOk(["install", "--project", "--yes", "--force"]);
  assert.equal(readFileSync(join(f.project, ".omt", "backups", STAMP, "bin", "omt"), "utf8"), "#!/bin/sh\necho mine\n");
  assert.match(readFileSync(shim, "utf8"), /^# oh-my-t3code project shim$/m);

  const moved = await f.runOk(["install", "--project", "--yes"], { runtimePath: "/opt/bun/bin/bun" });
  assert.match(moved.ctx.out(), /update {3}.*\.omt[/\\]bin[/\\]omt/);
  assert.match(readFileSync(shim, "utf8"), /^runtime="\/opt\/bun\/bin\/bun"$/m);
});

test("a directory at the shim path is a conflict", async () => {
  const f = projectFixture();
  mkdirSync(join(f.project, ".omt", "bin", "omt"), { recursive: true });
  const { code, ctx } = await f.run(["install", "--project", "--yes"]);
  assert.equal(code, 1);
  assert.match(ctx.out(), /conflict .*omt {2}\(exists and is not a file\)/);
});

test("withGitignoreLines appends the missing lines and keeps the others", () => {
  assert.equal(withGitignoreLines(undefined), OMT_GITIGNORE);
  assert.equal(withGitignoreLines("ledger.jsonl\nevidence/\nmine"), "ledger.jsonl\nevidence/\nmine\nbin/\ninstall.json\nbackups/\nplans/\nlocks/\nguardrails.md\ngrills/\n");
  const full = "x\nbackups/\nbin/\ninstall.json\nevidence/\nledger.jsonl\nplans/\nlocks/\nguardrails.md\ngrills/\n";
  assert.equal(withGitignoreLines(full), full);
});

test("install --project leaves an existing .omt/.gitignore alone; --no-git-exclude appends the missing lines", async () => {
  const f = projectFixture();
  mkdirSync(join(f.project, ".omt"));
  writeFileSync(join(f.project, ".omt", ".gitignore"), "ledger.jsonl\nevidence/\nnotes/\n");
  await f.runOk(["install", "--project", "--yes"]);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), "ledger.jsonl\nevidence/\nnotes/\n");
  assert.doesNotMatch(readFileSync(f.exclude, "utf8"), /\.gitignore/);

  const g = projectFixture();
  mkdirSync(join(g.project, ".omt"));
  writeFileSync(join(g.project, ".omt", ".gitignore"), "ledger.jsonl\nevidence/\nnotes/\n");
  await g.runOk(["install", "--project", "--no-git-exclude", "--yes"]);
  assert.equal(
    readFileSync(join(g.project, ".omt", ".gitignore"), "utf8"),
    "ledger.jsonl\nevidence/\nnotes/\nbin/\ninstall.json\nbackups/\nplans/\nlocks/\nguardrails.md\ngrills/\n",
  );
});

const OLD_GITIGNORE = "ledger.jsonl\nevidence/\nbin/\ninstall.json\nbackups/\n";

function manifestFiles(manifest: Record<string, unknown>): string[] {
  return (manifest.project as { files: { path: string }[] }).files.map((file) => file.path);
}

function gitignoreRecord(manifest: Record<string, unknown>, gitignore: string): { path: string; sha256: string } | undefined {
  const project = manifest.project as { files: { path: string; sha256: string }[] };
  return project.files.find((file) => file.path === gitignore);
}

// Writes the .gitignore and manifest hash that an earlier install with five lines left.
function downgradeGitignore(f: ProjectFixture, text: string, recorded: string): void {
  const gitignore = join(f.project, ".omt", ".gitignore");
  writeFileSync(gitignore, text);
  const manifestPath = join(f.project, ".omt", "install.json");
  const manifest = readJson(manifestPath);
  const record = gitignoreRecord(manifest, gitignore);
  if (record !== undefined) record.sha256 = sha256(recorded);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("a reinstall appends plans/, locks/, guardrails.md, and grills/ to an unedited .omt/.gitignore that an earlier install created", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);
  downgradeGitignore(f, OLD_GITIGNORE, OLD_GITIGNORE);
  const { ctx } = await f.runOk(["install", "--project", "--yes"]);
  assert.match(ctx.out(), /update {3}.*\.gitignore/);
  const gitignore = join(f.project, ".omt", ".gitignore");
  assert.equal(readFileSync(gitignore, "utf8"), `${OLD_GITIGNORE}plans/\nlocks/\nguardrails.md\ngrills/\n`);
  const record = gitignoreRecord(readJson(join(f.project, ".omt", "install.json")), gitignore);
  assert.equal(record?.sha256, sha256(`${OLD_GITIGNORE}plans/\nlocks/\nguardrails.md\ngrills/\n`));
});

test("a reinstall leaves an edited .omt/.gitignore alone", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);
  downgradeGitignore(f, `${OLD_GITIGNORE}mine\n`, OLD_GITIGNORE);
  await f.runOk(["install", "--project", "--yes"]);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), `${OLD_GITIGNORE}mine\n`);
});

test("doctor --project checks the shim and the exclude block, and skips path and homes", async () => {
  const f = projectFixture();
  const empty = await doctor(f, ["--project"]);
  assert.deepEqual(
    empty.report.checks.map((c) => c.id),
    ["runtime", "config", "defaults", "harnesses", "skills", "links", "hooks", "shim", "exclude", "t3", "worktree"],
  );
  assert.equal(empty.get("shim").status, "WARN");
  assert.equal(empty.get("exclude").status, "WARN");

  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const ok = await doctor(f, ["--project"]);
  assert.equal(ok.get("skills").status, "PASS");
  assert.equal(ok.get("links").status, "PASS");
  assert.equal(ok.get("hooks").status, "PASS");
  assert.equal(ok.get("shim").status, "PASS");
  assert.equal(ok.get("exclude").status, "PASS");

  const shim = join(f.project, ".omt", "bin", "omt");
  writeFileSync(shim, readFileSync(shim, "utf8").replace(CLI_PATH, join(f.root, "gone", "cli.ts")));
  const broken = await doctor(f, ["--project"]);
  assert.equal(broken.get("shim").status, "FAIL");
  assert.equal(broken.code, 1);

  writeFileSync(f.exclude, GIT_EXCLUDE_DEFAULT);
  assert.equal((await doctor(f, ["--project"])).get("exclude").status, "WARN");

  const g = projectFixture(false);
  mkdirSync(join(g.project, ".omt"));
  assert.equal((await doctor(g, ["--project"])).get("exclude").status, "INFO");
  assert.deepEqual(readdirSync(g.project), [".omt"], "doctor writes nothing");
});

// A fixture whose project is a real git repository with one commit.
function gitFixture(files: Record<string, string> = {}) {
  const f = projectFixture(false);
  const git = gitRepo(f.root, f.project, files);
  const status = (cwd = f.project) => git(["status", "--porcelain", "--ignored", "--untracked-files=all"], cwd);
  const shown = (cwd = f.project) => git(["status", "--porcelain", "-uall"], cwd);
  return { ...f, git, status, shown };
}

const SETTINGS = { permissions: { allow: ["Bash(ls)"] }, theme: "dark" };

test("a settings.local.json in its own style is edited in that style and restored byte for byte", async () => {
  const styles: Record<string, string> = {
    "4 spaces, newline": `${JSON.stringify(SETTINGS, null, 4)}\n`,
    "4 spaces, no newline": JSON.stringify(SETTINGS, null, 4),
    "tab, newline": `${JSON.stringify(SETTINGS, null, "\t")}\n`,
    "tab, no newline": JSON.stringify(SETTINGS, null, "\t"),
    "compact, newline": `${JSON.stringify(SETTINGS)}\n`,
    "compact, no newline": JSON.stringify(SETTINGS),
  };
  for (const [name, text] of Object.entries(styles)) {
    const f = gitFixture({ ".claude/settings.local.json": text });
    const local = join(f.project, ".claude", "settings.local.json");
    const before = f.status();
    await f.runOk(["install", "--project", "--hooks", "--yes"]);
    assert.equal(f.git(["status", "--porcelain"]), " M .claude/settings.local.json\n", name);
    const edited = readFileSync(local, "utf8");
    const indent = name.startsWith("4") ? 4 : name.startsWith("tab") ? "\t" : undefined;
    const newline = name.endsWith(", newline") ? "\n" : "";
    assert.equal(edited, `${JSON.stringify(JSON.parse(edited), null, indent)}${newline}`, `${name}: the edit keeps the style`);
    assert.equal(readFileSync(join(f.project, ".omt", "backups", ".gitignore"), "utf8"), "*\n", name);

    await f.runOk(["uninstall", "--project", "--yes"]);
    assert.equal(readFileSync(local, "utf8"), text, `${name}: restored byte for byte`);
    assert.equal(f.git(["status", "--porcelain"]), "", name);
    assert.equal(f.status(), before, name);
    assert.ok(!existsSync(join(f.project, ".omt")), `${name}: the backup and .omt are gone`);
  }
});

test("backups/.gitignore hides a backup that the uninstall keeps", async () => {
  const f = gitFixture({ ".claude/settings.local.json": `${JSON.stringify(SETTINGS, null, 2)}\n` });
  const local = join(f.project, ".claude", "settings.local.json");
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const ignore = join(f.project, ".omt", "backups", ".gitignore");
  assert.equal(readFileSync(ignore, "utf8"), "*\n");
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  const files = manifestFiles(manifest);
  assert.ok(files.includes(ignore));
  assert.equal((manifest.hooks as { backup?: string }[])[0]?.backup, join(f.project, ".omt", "backups", STAMP, "claude-settings.json"));

  // The user edits the file while omt is installed, so the uninstall cannot restore the backup.
  writeFileSync(local, JSON.stringify({ ...readJson(local), model: "opus" }, null, 2) + "\n");
  await f.runOk(["uninstall", "--project", "--yes"], { now: () => new Date("2026-01-02T03:04:06.000Z") });
  assert.deepEqual(readJson(local), { ...SETTINGS, model: "opus" });
  assert.ok(existsSync(join(f.project, ".omt", "backups", "20260102030406", "claude-settings.json")));
  assert.equal(readFileSync(ignore, "utf8"), "*\n");
  assert.equal(f.git(["status", "--porcelain"]), " M .claude/settings.local.json\n", "git shows no backup");
});

test.skipIf(process.getuid?.() === 0)("an exclude file that cannot be written stops the install before any other write", async () => {
  const f = projectFixture();
  const info = dirname(f.exclude);
  chmodSync(f.exclude, 0o444);
  chmodSync(info, 0o555);
  const before = snapshot(f.root);
  const { code, ctx } = await f.run(["install", "--project", "--hooks", "--yes"]);
  chmodSync(info, 0o755);
  chmodSync(f.exclude, 0o644);
  assert.equal(code, 1);
  assert.match(ctx.err(), /cannot write the git exclude block/);
  assert.match(ctx.err(), /--no-git-exclude/);
  assert.deepEqual(snapshot(f.root), before);
});

test.skipIf(process.getuid?.() === 0)("the provisional manifest records what the install will create before the other writes", async () => {
  const f = projectFixture();
  // A read-only .agents makes the skill copy fail after the exclude block and the manifest.
  mkdirSync(join(f.project, ".agents"));
  chmodSync(join(f.project, ".agents"), 0o555);
  const failed = await f.run(["install", "--project", "--yes"]);
  chmodSync(join(f.project, ".agents"), 0o755);
  assert.equal(failed.code, 1);
  assert.match(readFileSync(f.exclude, "utf8"), /^\/\.omt\/config\.jsonc$/m);
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  const project = manifest.project as { omtDirCreated: boolean; dirs: string[]; files: { path: string }[] };
  assert.equal(project.omtDirCreated, true);
  assert.ok(project.dirs.includes(join(f.project, ".omt", "plans")));
  assert.ok(project.files.some((file) => file.path === join(f.project, ".omt", "config.jsonc")));
});

test("uninstall keeps a reduced exclude block for the paths that stay", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);
  writeFileSync(join(f.project, ".agents", "skills", "alpha", "SKILL.md"), "edited\n");
  const kept = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.match(kept.ctx.out(), /update {3}managed block in .*\(keeps only the paths that stay\)/);
  assert.equal(
    readFileSync(f.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(f.project, "/.agents/skills/alpha/", "/.claude/skills/alpha", "/.omt/install.json")}\n`,
  );
  await f.runOk(["uninstall", "--project", "--yes", "--force"]);
  assert.equal(readFileSync(f.exclude, "utf8"), GIT_EXCLUDE_DEFAULT);
});

test("installs from two worktrees make one install with one block in the main checkout", async () => {
  const f = gitFixture();
  const w1 = join(f.root, "w1");
  const w2 = join(f.root, "w2");
  f.git(["worktree", "add", "-q", w1]);
  f.git(["worktree", "add", "-q", w2]);
  const before = readFileSync(f.exclude, "utf8");
  await f.runOk(["install", "--project", "--yes"], { cwd: w1 });
  const again = await f.runOk(["install", "--project", "--yes"], { cwd: w2 });
  assertAllUnchanged(again.ctx.out(), { ignoreNone: true });
  const text = readFileSync(f.exclude, "utf8");
  assert.equal(excludeBlockCount(text), 1);
  assert.ok(text.includes(excludeBegin(f.project)), "the block has the root that a cwd in the main checkout gives");
  for (const wt of [w1, w2]) {
    for (const path of [".agents", ".claude", ".omt"]) assert.ok(!existsSync(join(wt, path)), `no ${path} in ${wt}`);
  }
  assert.ok(existsSync(join(f.project, ".omt", "install.json")));
  assert.equal(f.git(["status", "--porcelain"]), "");

  await f.runOk(["uninstall", "--project", "--yes"], { cwd: w2 });
  assert.ok(!existsSync(join(f.project, ".omt", "install.json")), "an uninstall from a worktree removes the one install");
  assert.equal(readFileSync(f.exclude, "utf8"), before);
});

function excludeBlockCount(text: string): number {
  return text.split("\n").filter((line) => line.startsWith("# >>> oh-my-t3code project install: ")).length;
}

test("a monorepo package with its own .omt uses the repository's exclude file with prefixed entries", async () => {
  const f = gitFixture({ "pkg/.omt/notes.md": "# x\n", "pkg/index.ts": "export {};\n" });
  const pkg = join(f.project, "pkg");
  const before = f.status();
  await f.runOk(["install", "--project", "--yes"], { cwd: pkg });
  const text = readFileSync(f.exclude, "utf8");
  assert.match(text, /^\/pkg\/\.agents\/skills\/alpha\/$/m);
  assert.match(text, /^\/pkg\/\.omt\/config\.jsonc$/m);
  assert.equal(f.git(["status", "--porcelain"]), "");
  await f.runOk(["uninstall", "--project", "--yes"], { cwd: pkg });
  assert.equal(f.status(), before);
});

test("a BEGIN marker without its END marker counts as no block", async () => {
  const f = projectFixture();
  const original = `${GIT_EXCLUDE_DEFAULT}${excludeBegin(f.project)}\nmine-1\nmine-2\n`;
  writeFileSync(f.exclude, original);
  await f.runOk(["install", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), `${original}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  await f.runOk(["install", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), `${original}${block(f.project, ...SKILL_ENTRIES, ...CREATED_OMT)}\n`);
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), original);
});

test("uninstall keeps .omt/bin and .omt/backups that the user created", async () => {
  const f = projectFixture();
  mkdirSync(join(f.project, ".omt", "bin"), { recursive: true });
  mkdirSync(join(f.project, ".omt", "backups"));
  await f.runOk(["install", "--project", "--yes"]);
  const dirs = (readJson(join(f.project, ".omt", "install.json")).project as { dirs: string[] }).dirs;
  assert.ok(!dirs.includes(join(f.project, ".omt", "bin")));
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.deepEqual(readdirSync(join(f.project, ".omt")).sort(), ["backups", "bin"]);
  assert.deepEqual(readdirSync(join(f.project, ".omt", "bin")), []);
});

test("the shim falls back to bun on PATH when the recorded runtime is missing", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"], { runtimePath: join(f.root, "gone", "bun") });
  const shim = join(f.project, ".omt", "bin", "omt");
  const env = { ...childEnv(f.root), PATH: `${dirname(process.execPath)}:/usr/bin:/bin` };
  const out = execFileSync(shim, ["--version"], { cwd: f.project, env, encoding: "utf8" });
  assert.match(out, /^\d+\.\d+\.\d+/);
  const report = await doctor(f, ["--project"]);
  assert.equal(report.get("shim").status, "WARN");
});

test("the project hook command calls the shim", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const shim = join(f.project, ".omt", "bin", "omt");
  const settings = readJson(join(f.project, ".claude", "settings.local.json")) as {
    hooks: { UserPromptSubmit: { hooks: { command: string }[] }[] };
  };
  const command = settings.hooks.UserPromptSubmit[0]?.hooks[0]?.command ?? "";
  assert.equal(command, `"${shim}" hook user-prompt-submit # oh-my-t3code`);
  const out = execFileSync("/bin/sh", ["-c", command], {
    cwd: f.project,
    env: childEnv(f.root),
    input: JSON.stringify({ prompt: "start ulw fix the bug", hook_event_name: "UserPromptSubmit" }),
    encoding: "utf8",
  });
  assert.match(out, /omt-ulw/);
  assert.equal((await doctor(f, ["--project"])).get("hooks").status, "PASS");
});

test("doctor --project names the running CLI in its install hint", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--yes"]);
  const shim = join(f.project, ".omt", "bin", "omt");
  writeFileSync(shim, readFileSync(shim, "utf8").replace(CLI_PATH, join(f.root, "moved", "cli.ts")));
  const { report } = await doctor(f, ["--project"]);
  const message = report.checks.find((c) => c.id === "shim")?.message ?? "";
  assert.ok(message.includes(`run bun "${CLI_PATH}" install --project`), message);
});

const INLINE_SETTINGS = '{\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n';

test("uninstall in a copied project changes only the copy, and an install there records only the copy's paths", async () => {
  const f = gitFixture({ ".claude/settings.local.json": INLINE_SETTINGS });
  const treeBefore = contentTree(f.project);
  const statusBefore = f.status();
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const copy = join(f.root, "copy");
  cpSync(f.project, copy, { recursive: true, verbatimSymlinks: true });
  const original = contentTree(f.project);

  const removed = await f.runOk(["uninstall", "--project", "--yes"], { cwd: copy });
  assert.doesNotMatch(removed.ctx.out(), new RegExp(`${f.project}/`), "the plan names no path of the original");
  assert.deepEqual(contentTree(f.project), original, "the original install stays");
  assert.deepEqual(contentTree(copy), treeBefore, "the copy is back to the tree before the install");
  assert.equal(f.status(copy), statusBefore);
  assert.equal(readFileSync(join(copy, ".git", "info", "exclude"), "utf8"), readFileSync(f.exclude, "utf8").replace(/# >>>[^]*<<<[^\n]*\n/, ""));

  const second = join(f.root, "second");
  cpSync(f.project, second, { recursive: true, verbatimSymlinks: true });
  await f.runOk(["install", "--project", "--hooks", "--yes"], { cwd: second });
  const manifest = readFileSync(join(second, ".omt", "install.json"), "utf8");
  assert.ok(!manifest.includes(`${f.project}/`), "the manifest of the copy names no path of the original");
  const exclude = readFileSync(join(second, ".git", "info", "exclude"), "utf8");
  assert.ok(!exclude.includes("/../"), exclude);
  assert.ok(!exclude.includes(excludeBegin(f.project)), "the copied block of the original is replaced");
  assert.equal(f.shown(second), " M .claude/settings.local.json\n", "git shows only the tracked settings file");
});

test("a tracked project manifest with paths outside the root never touches the user install", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--hooks", "--yes"]);
  const user = snapshot(f.home);
  mkdirSync(join(f.project, ".omt"));
  const manifest = {
    scope: "project",
    root: f.project,
    package: "oh-my-t3code",
    version: "0.1.0",
    installedAt: "",
    skillsRoot: f.agents,
    skills: ["alpha", "beta"],
    links: [{ path: join(f.claudeSkills, "alpha"), target: "../../.agents/skills/alpha" }],
    config: { path: join(f.configDir, "config.jsonc"), created: true },
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: f.settings, command: "x # oh-my-t3code", created: true }],
    backups: [],
    project: { omtDirCreated: false, settingsCreated: false, shim: join(f.root, "elsewhere", "omt"), files: [{ path: join(f.configDir, "config.jsonc"), sha256: "x" }], dirs: [f.agents] },
  };
  writeFileSync(join(f.project, ".omt", "install.json"), JSON.stringify(manifest));
  const removed = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.doesNotMatch(removed.ctx.out(), new RegExp(f.home));
  assert.deepEqual(snapshot(f.home), user);
});

test("a moved clone: doctor, reinstall, and uninstall give back the tree and the tracked settings byte for byte", async () => {
  const f = gitFixture({ ".claude/settings.local.json": INLINE_SETTINGS });
  const treeBefore = contentTree(f.project);
  const statusBefore = f.status();
  const excludeBefore = readFileSync(f.exclude, "utf8");
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const moved = join(f.root, "moved");
  renameSync(f.project, moved);

  const report = await doctor(f, ["--project"], { cwd: moved });
  assert.equal(report.get("hooks").status, "FAIL");
  assert.match(report.report.checks.find((c) => c.id === "hooks")?.message ?? "", /install --project --hooks/);

  const reinstalled = await f.runOk(["install", "--project", "--hooks", "--yes"], { cwd: moved });
  assert.doesNotMatch(reinstalled.ctx.out(), /^backup/m, "the update needs no new backup");
  const exclude = readFileSync(join(moved, ".git", "info", "exclude"), "utf8");
  assert.ok(!exclude.includes(excludeBegin(f.project)), "the block of the old root is replaced");
  assert.ok(exclude.includes(excludeBegin(moved)));
  assert.equal(f.shown(moved), " M .claude/settings.local.json\n");

  await f.runOk(["uninstall", "--project", "--yes"], { cwd: moved });
  assert.equal(readFileSync(join(moved, ".claude", "settings.local.json"), "utf8"), INLINE_SETTINGS);
  assert.equal(f.status(moved), statusBefore);
  assert.equal(readFileSync(join(moved, ".git", "info", "exclude"), "utf8"), excludeBefore);
  assert.deepEqual(contentTree(moved), treeBefore);
});

test("uninstall of a moved clone without a reinstall removes the old root's block and every created path", async () => {
  const f = gitFixture();
  const treeBefore = contentTree(f.project);
  const excludeBefore = readFileSync(f.exclude, "utf8");
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const moved = join(f.root, "moved");
  renameSync(f.project, moved);
  await f.runOk(["uninstall", "--project", "--yes"], { cwd: moved });
  assert.equal(readFileSync(join(moved, ".git", "info", "exclude"), "utf8"), excludeBefore);
  assert.deepEqual(contentTree(moved), treeBefore);
});

test("--project refuses a root that is the home directory or shares the user-scope paths", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--yes"]);
  const user = snapshot(f.home);
  for (const command of ["install", "uninstall", "doctor"]) {
    const { code, ctx } = await f.run([command, "--project", "--yes"].slice(0, command === "doctor" ? 2 : 3), { cwd: f.home });
    assert.equal(code, 2, `${command}: ${ctx.err()}`);
    assert.match(ctx.err(), /refusing --project: the project root .* is your home directory/);
    assert.match(ctx.err(), /^hint: /m);
  }
  mkdirSync(join(f.home, ".git"));
  mkdirSync(join(f.home, "scratch"));
  const nested = await f.run(["uninstall", "--project", "--yes"], { cwd: join(f.home, "scratch") });
  assert.equal(nested.code, 2);
  rmSync(join(f.home, ".git"), { recursive: true });
  rmSync(join(f.home, "scratch"), { recursive: true });
  assert.deepEqual(snapshot(f.home), user, "the user install stays");
});

test("a dangling settings symlink stays a symlink, and uninstall removes only the target the install created", async () => {
  const f = projectFixture();
  const local = join(f.project, ".claude", "settings.local.json");
  const target = join(f.project, "dot", "settings.local.json");
  mkdirSync(join(f.project, ".claude"));
  symlinkSync(target, local);
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.ok(lstatSync(local).isSymbolicLink());
  assert.match(readFileSync(target, "utf8"), /# oh-my-t3code/);
  assert.doesNotMatch(readFileSync(f.exclude, "utf8"), /settings\.local\.json/, "the link is the user's");
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.ok(lstatSync(local).isSymbolicLink(), "the user's link stays");
  assert.equal(readlinkSync(local), target);
  assert.ok(!existsSync(target), "the target that the install created goes");

  const g = projectFixture();
  const userTarget = join(g.root, "dot", "settings.json");
  mkdirSync(dirname(g.settings), { recursive: true });
  symlinkSync(userTarget, g.settings);
  await g.runOk(["install", "--hooks", "--yes"]);
  assert.match(readFileSync(userTarget, "utf8"), /# oh-my-t3code/);
  await g.runOk(["uninstall", "--yes"]);
  assert.ok(lstatSync(g.settings).isSymbolicLink());
  assert.ok(!existsSync(userTarget));
});

test.skipIf(process.getuid?.() === 0)("a failed delete names the scratch directory, git does not show it, and the next run removes it", async () => {
  const f = gitFixture();
  const statusBefore = f.status();
  await f.runOk(["install", "--project", "--yes"]);
  const locked = join(f.project, ".agents", "skills", "beta", "references");
  chmodSync(locked, 0o555);
  const failed = await f.run(["uninstall", "--project", "--yes"]);
  const scratch = readdirSync(join(f.project, ".agents")).filter((name) => name.startsWith(".omt-old-"));
  for (const name of scratch) chmodSync(join(f.project, ".agents", name, "references"), 0o755);
  chmodSync(join(f.project, ".agents"), 0o755);
  assert.equal(failed.code, 1);
  assert.match(failed.ctx.err(), /cannot delete the scratch directory .*\.omt-old-[0-9a-f]+/);
  assert.equal(scratch.length, 1);
  assert.equal(f.shown(), "", "the exclude block hides the scratch directory");

  const again = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.match(again.ctx.out(), /remove {3}.*\.omt-old-[0-9a-f]+ {2}\(left by an interrupted run\)/);
  assert.ok(!existsSync(join(f.project, ".agents")));
  assert.equal(f.status(), statusBefore);
});

test("excludePattern escapes the characters that git reads as globs", () => {
  assert.equal(excludePattern("/r", "/r/pkg[1]/a*b?/c\\d", true), "/pkg\\[1\\]/a\\*b\\?/c\\\\d/");
  assert.equal(excludePattern("/r", "/r/x/name  "), "/x/name\\ \\ ");
});

test("a monorepo package whose path holds glob characters is hidden from git", async () => {
  const f = gitFixture({ "pkg[1]/.omt/config.jsonc": "{}\n", "pkg1/keep.txt": "x\n" });
  const pkg = join(f.project, "pkg[1]");
  const before = f.status();
  await f.runOk(["install", "--project", "--yes"], { cwd: pkg });
  assert.equal(f.shown(), "");
  writeFileSync(join(f.project, "pkg1", "new.txt"), "x\n");
  assert.match(f.git(["status", "--porcelain"]), /^\?\? pkg1\/new\.txt$/m, "the block does not hide a sibling");
  rmSync(join(f.project, "pkg1", "new.txt"));
  await f.runOk(["uninstall", "--project", "--yes"], { cwd: pkg });
  assert.equal(f.status(), before);
});

test("the block names only the files the install writes, so new files in .omt of another worktree show in git", async () => {
  const f = gitFixture();
  const wt = join(f.root, "wt");
  f.git(["worktree", "add", "-q", wt]);
  const installed = await f.runOk(["install", "--project", "--yes"], { cwd: wt });
  assert.match(installed.ctx.out(), /managed block in .*\(shared by all worktrees\)/);
  writeFileSync(join(f.project, ".omt", "notes.md"), "# p\n");
  mkdirSync(join(wt, ".omt", "plans"), { recursive: true });
  writeFileSync(join(wt, ".omt", "plans", "mine.md"), "# mine\n");
  assert.match(f.shown(), /^\?\? \.omt\/notes\.md$/m);
  assert.match(f.shown(wt), /^\?\? \.omt\/plans\/mine\.md$/m);
});

test("a block whose root no longer exists: doctor warns, and the next install or uninstall removes it", async () => {
  const f = gitFixture();
  const wt = join(f.root, "wt");
  f.git(["worktree", "add", "-q", wt]);
  // An install of an older omt wrote a block for the worktree itself.
  writeFileSync(f.exclude, withExcludeBlock(readFileSync(f.exclude, "utf8"), wt, ["/.omt/install.json"]));
  f.git(["worktree", "remove", "--force", wt]);
  assert.ok(readFileSync(f.exclude, "utf8").includes(excludeBegin(wt)));
  const report = await doctor(f, ["--project"]);
  assert.equal(report.get("exclude").status, "WARN");
  assert.match(report.report.checks.find((c) => c.id === "exclude")?.message ?? "", /no longer exists/);
  await f.runOk(["install", "--project", "--yes"]);
  assert.ok(!readFileSync(f.exclude, "utf8").includes(excludeBegin(wt)));
});

test("--no-git-exclude: uninstall removes the lines it appended to a tracked .omt/.gitignore", async () => {
  const f = gitFixture({ ".omt/.gitignore": "foo\n" });
  const statusBefore = f.status();
  await f.runOk(["install", "--project", "--no-git-exclude", "--yes"]);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), `foo\n${OMT_GITIGNORE}`);
  const removed = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.match(removed.ctx.out(), /update {3}.*\.gitignore {2}\(removes the lines that the install added\)/);
  assert.equal(readFileSync(join(f.project, ".omt", ".gitignore"), "utf8"), "foo\n");
  assert.equal(f.status(), statusBefore);
});

test("--no-git-exclude on a reinstall removes the earlier block, and doctor reports the choice as INFO", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const again = await f.runOk(["install", "--project", "--hooks", "--no-git-exclude", "--yes"]);
  assert.match(again.ctx.out(), /remove {3}managed block in .*\(--no-git-exclude\)/);
  assert.equal(readFileSync(f.exclude, "utf8"), GIT_EXCLUDE_DEFAULT);
  const report = await doctor(f, ["--project"]);
  assert.equal(report.get("exclude").status, "INFO");
  assert.match(report.report.checks.find((c) => c.id === "exclude")?.message ?? "", /--no-git-exclude/);
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.equal((await doctor(f, ["--project"])).get("exclude").status, "PASS");
});

test("the exclude file gets its exact bytes back: no final newline, or no file and no info directory", async () => {
  const f = projectFixture();
  writeFileSync(f.exclude, "*.log");
  await f.runOk(["install", "--project", "--yes"]);
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), "*.log");

  const g = projectFixture();
  rmSync(dirname(g.exclude), { recursive: true });
  await g.runOk(["install", "--project", "--yes"]);
  assert.ok(existsSync(g.exclude));
  await g.runOk(["uninstall", "--project", "--yes"]);
  assert.ok(!existsSync(dirname(g.exclude)), "the info directory that the install created goes");

  const text = withExcludeBlock("a", "/r", ["/x"]);
  assert.equal(withoutExcludeBlocks(text, ["/r"], true), "a");
  assert.equal(withoutExcludeBlocks(text, ["/r"]), "a\n");
  assert.equal(withoutExcludeBlocks(`${block("/r", "/x")}\nb`, ["/r"]), "b");
});

test("install and uninstall through a symlinked path of the same project run once and leave no block", async () => {
  const f = gitFixture();
  const alias = join(f.root, "alias");
  symlinkSync(f.project, alias);
  const treeBefore = contentTree(f.project);
  const excludeBefore = readFileSync(f.exclude, "utf8");
  await f.runOk(["install", "--project", "--hooks", "--yes"], { cwd: alias });
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.equal(excludeBlockCount(readFileSync(f.exclude, "utf8")), 1);
  await f.runOk(["uninstall", "--project", "--yes"], { cwd: alias });
  assert.equal(readFileSync(f.exclude, "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);

  await f.runOk(["install", "--project", "--hooks", "--yes"], { cwd: alias });
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);
});

test("a created settings.local.json that keeps other keys stays hidden from git after uninstall", async () => {
  const f = gitFixture();
  const statusBefore = f.status();
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  const local = join(f.project, ".claude", "settings.local.json");
  writeFileSync(local, JSON.stringify({ ...readJson(local), permissions: { allow: ["Bash(ls)"] } }, null, 2));
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.deepEqual(readJson(local), { permissions: { allow: ["Bash(ls)"] } });
  assert.equal(f.shown(), "");
  assert.notEqual(f.status(), statusBefore, "the kept file shows only as ignored");
});

test("the ledger and evidence stay out of git after uninstall", async () => {
  const f = gitFixture();
  await f.runOk(["install", "--project", "--yes"]);
  writeFileSync(join(f.project, ".omt", "ledger.jsonl"), "{}\n");
  mkdirSync(join(f.project, ".omt", "evidence"));
  writeFileSync(join(f.project, ".omt", "evidence", "run.txt"), "ok\n");
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(f.shown(), "");
});

test.skipIf(process.getuid?.() === 0)("a hook install into a new settings file writes no backups .gitignore; a failed run leaves nothing that git shows", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.ok(!existsSync(join(f.project, ".omt", "backups")));

  const g = gitFixture({ ".claude/skills/.keep": "", ".claude/settings.local.json": INLINE_SETTINGS });
  const treeBefore = contentTree(g.project);
  const excludeBefore = readFileSync(g.exclude, "utf8");
  chmodSync(join(g.project, ".claude"), 0o555);
  const failed = await g.run(["install", "--project", "--hooks", "--yes"]);
  chmodSync(join(g.project, ".claude"), 0o755);
  assert.equal(failed.code, 1);
  const manifest = readJson(join(g.project, ".omt", "install.json"));
  const files = manifestFiles(manifest);
  assert.ok(files.includes(join(g.project, ".omt", "backups", ".gitignore")), "the provisional manifest records the backups .gitignore");
  assert.equal(g.shown(), "", "git shows nothing after the failed run");
  await g.runOk(["uninstall", "--project", "--yes"]);
  const after = contentTree(g.project);
  const added = Object.keys(after).filter((path) => !(path in treeBefore));
  // The backup of the settings write that failed stays, hidden by the backups .gitignore.
  assert.deepEqual(added, [".omt", ".omt/backups", ".omt/backups/.gitignore", `.omt/backups/${STAMP}`, `.omt/backups/${STAMP}/claude-settings.json`]);
  assert.equal(readFileSync(g.exclude, "utf8"), excludeBefore, "no block hides a leftover");
  assert.equal(g.shown(), "");
  for (const path of Object.keys(treeBefore)) assert.equal(after[path], treeBefore[path], path);
});

// Each case edits the install the way normal use does, so the uninstall keeps a file that it created.
const KEPT_CASES: Record<string, (project: string) => void> = {
  "Claude Code permissions": (project) => {
    const local = join(project, ".claude", "settings.local.json");
    writeFileSync(local, JSON.stringify({ ...readJson(local), permissions: { allow: ["Bash(ls)"] } }, null, 2));
  },
  "the ledger": (project) => writeFileSync(join(project, ".omt", "ledger.jsonl"), "{}\n"),
  "an edited config": (project) => writeFileSync(join(project, ".omt", "config.jsonc"), `${PROJECT_STARTER_CONFIG}// mine\n`),
};

test("after an uninstall keeps created files, a reinstall and further uninstalls show nothing in git", async () => {
  for (const [name, edit] of Object.entries(KEPT_CASES)) {
    const f = gitFixture();
    await f.runOk(["install", "--project", "--hooks", "--yes"], undefined, name);
    edit(f.project);
    const clean = (step: string) => assert.equal(f.shown(), "", `${name}: ${step}`);
    await f.runOk(["uninstall", "--project", "--yes"], undefined, name);
    clean("first uninstall");
    const second = await f.runOk(["uninstall", "--project", "--yes"]);
    assert.match(second.ctx.out(), /Nothing to remove/, name);
    clean("second uninstall");
    await f.runOk(["install", "--project", "--hooks", "--yes"]);
    clean("reinstall");
    await f.runOk(["uninstall", "--project", "--yes"], undefined, name);
    clean("uninstall after the reinstall");
    await f.runOk(["uninstall", "--project", "--yes"], undefined, name);
    clean("last uninstall");
  }
});

test("the reduced manifest goes with the last created file that stays", async () => {
  const f = gitFixture();
  const treeBefore = contentTree(f.project);
  const excludeBefore = readFileSync(f.exclude, "utf8");
  await f.runOk(["install", "--project", "--yes"]);
  const ledger = join(f.project, ".omt", "ledger.jsonl");
  writeFileSync(ledger, "{}\n");
  await f.runOk(["uninstall", "--project", "--yes"]);
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  assert.deepEqual(manifest.skills, []);
  assert.deepEqual(manifestFiles(manifest), [join(f.project, ".omt", ".gitignore")]);
  rmSync(ledger);
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);
});

test.skipIf(process.getuid?.() === 0)("an uninstall that fails midway keeps the block, names the path, and the next run finishes", async () => {
  const f = gitFixture();
  const treeBefore = contentTree(f.project);
  const excludeBefore = readFileSync(f.exclude, "utf8");
  await f.runOk(["install", "--project", "--yes"]);
  const omt = join(f.project, ".omt");
  chmodSync(omt, 0o555);
  const failed = await f.run(["uninstall", "--project", "--yes"]);
  chmodSync(omt, 0o755);
  assert.equal(failed.code, 1);
  assert.match(failed.ctx.err(), /cannot delete .*\.omt\/\.gitignore/);
  assert.match(failed.ctx.err(), /run the command again/);
  assert.doesNotMatch(failed.ctx.err(), /unexpected error/);
  assert.ok(readFileSync(f.exclude, "utf8").includes(excludeBegin(f.project)), "the block stays until the last step");
  assert.equal(f.shown(), "");
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), excludeBefore);
  assert.deepEqual(contentTree(f.project), treeBefore);
});

test("a symlinked exclude file or .omt/.gitignore stays a symlink through install and uninstall", async () => {
  const f = gitFixture();
  const dot = join(f.root, "dot", "exclude");
  writeFile(dot, "*.log\n");
  rmSync(f.exclude);
  symlinkSync(dot, f.exclude);
  await f.runOk(["install", "--project", "--yes"]);
  assert.ok(lstatSync(f.exclude).isSymbolicLink());
  assert.ok(readFileSync(dot, "utf8").includes(excludeBegin(f.project)));
  assert.equal(f.shown(), "");
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.ok(lstatSync(f.exclude).isSymbolicLink());
  assert.equal(readFileSync(dot, "utf8"), "*.log\n");

  const g = gitFixture({ ".omt/plans/.keep": "" });
  const gitignore = join(g.project, ".omt", ".gitignore");
  const target = join(g.project, ".omt", "dot", "omt-gitignore");
  writeFile(target, "mine\n");
  symlinkSync(target, gitignore);
  await g.runOk(["install", "--project", "--no-git-exclude", "--yes"]);
  assert.ok(lstatSync(gitignore).isSymbolicLink());
  assert.match(readFileSync(target, "utf8"), /^mine\nledger\.jsonl\n/);
  await g.runOk(["uninstall", "--project", "--yes"]);
  assert.ok(lstatSync(gitignore).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), "mine\n");
});

test("a crafted tracked manifest never makes the uninstall delete or hide a file that omt did not create", async () => {
  const elsewhere = "/somewhere/else";
  const readme = "# demo\n";
  const manifest = {
    scope: "project",
    root: elsewhere,
    package: "oh-my-t3code",
    version: "0.1.0",
    installedAt: "",
    skillsRoot: elsewhere,
    skills: ["../../src", "src"],
    links: [{ path: `${elsewhere}/src`, target: "x" }],
    config: { path: `${elsewhere}/README.md`, created: true },
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: `${elsewhere}/data.json`, command: "x # oh-my-t3code", backup: `${elsewhere}/other.json` }],
    backups: [`${elsewhere}/src`],
    project: {
      omtDirCreated: true,
      settingsCreated: true,
      shim: `${elsewhere}/README.md`,
      files: [{ path: `${elsewhere}/README.md`, sha256: sha256(readme) }, { path: `${elsewhere}/src/index.ts`, sha256: sha256("export {};\n") }],
      dirs: [`${elsewhere}/empty`],
    },
  };
  const f = gitFixture({
    ".omt/install.json": JSON.stringify(manifest),
    "src/index.ts": "export {};\n",
    "data.json": "{}\n",
    "other.json": "{}\n",
    "empty/.keep": "",
  });
  rmSync(join(f.project, "empty", ".keep"));
  f.git(["add", "-A"]);
  f.git(["commit", "-q", "-m", "empty"]);
  await f.runOk(["install", "--project", "--yes"]);
  const exclude = readFileSync(f.exclude, "utf8");
  assert.doesNotMatch(exclude, /^\/(src|\.\.|README\.md)/m, exclude);
  const removed = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.doesNotMatch(removed.ctx.out(), /README|src|data\.json|other\.json/);
  for (const path of ["README.md", "src/index.ts", "data.json", "other.json", "empty"]) assert.ok(existsSync(join(f.project, path)), path);
  assert.equal(f.shown(), " D .omt/install.json\n", "only the tracked manifest changed");
});

test("a package copied inside the same repository keeps the original's block", async () => {
  const f = gitFixture({ "pkg/a/.omt/plans/x.md": "# x\n", "pkg/a/index.ts": "export {};\n" });
  const a = join(f.project, "pkg", "a");
  const b = join(f.project, "pkg", "b");
  await f.runOk(["install", "--project", "--yes"], { cwd: a });
  cpSync(a, b, { recursive: true, verbatimSymlinks: true });
  const underA = () => f.shown().split("\n").filter((line) => line.includes("pkg/a/"));
  for (const argv of [["install", "--project", "--yes"], ["uninstall", "--project", "--yes"]]) {
    await f.runOk(argv, { cwd: b });
    assert.ok(readFileSync(f.exclude, "utf8").includes(excludeBegin(a)), `${argv[0]} in the copy keeps the block of the original`);
    assert.deepEqual(underA(), [], `${argv[0]} in the copy shows no file of the original`);
  }
});

test("detectJsonStyle gives an empty object the default indentation", () => {
  for (const text of ["{}\n", "{\n}\n", "{ }"]) assert.equal(detectJsonStyle(text).indent, "  ", JSON.stringify(text));
  assert.equal(detectJsonStyle('{"a":1}\n').indent, "");
});

test("a clone of a committed --no-git-exclude setup: install and uninstall keep the tracked skills and links", async () => {
  const f = gitFixture();
  await f.runOk(["install", "--project", "--no-git-exclude", "--yes"]);
  f.git(["add", "-A"]);
  f.git(["commit", "-q", "-m", "omt setup"]);
  const bob = join(f.root, "bob");
  f.git(["clone", "-q", f.project, bob], f.root);
  const treeBefore = contentTree(bob);
  const excludeBefore = readFileSync(join(bob, ".git", "info", "exclude"), "utf8");

  await f.runOk(["install", "--project", "--yes"], { cwd: bob });
  assert.equal(f.shown(bob), "");
  const manifest = readJson(join(bob, ".omt", "install.json"));
  assert.deepEqual(manifest.skills, []);
  assert.deepEqual(manifest.links, []);
  assert.deepEqual((manifest.project as { existing: unknown }).existing, {
    skills: ["alpha", "beta"],
    links: ["alpha", "beta"].map((name) => join(bob, ".claude", "skills", name)),
  });
  assert.doesNotMatch(readFileSync(join(bob, ".git", "info", "exclude"), "utf8"), /skills/, "the block does not hide the tracked setup");

  const removed = await f.runOk(["uninstall", "--project", "--yes"], { cwd: bob });
  assert.match(removed.ctx.out(), /keep {5}.*alpha {2}\(existed before the install\)/);
  assert.doesNotMatch(removed.ctx.out(), /locally modified/);
  assert.equal(f.shown(bob), "");
  assert.deepEqual(contentTree(bob), treeBefore);
  assert.equal(readFileSync(join(bob, ".git", "info", "exclude"), "utf8"), excludeBefore);
});

test("a clone of a committed setup: a second uninstall after a reduced manifest keeps the tracked skills", async () => {
  const f = gitFixture();
  await f.runOk(["install", "--project", "--no-git-exclude", "--yes"]);
  f.git(["add", "-A"]);
  f.git(["commit", "-q", "-m", "omt setup"]);
  const bob = join(f.root, "bob");
  f.git(["clone", "-q", f.project, bob], f.root);
  await f.runOk(["install", "--project", "--hooks", "--yes"], { cwd: bob });
  const local = join(bob, ".claude", "settings.local.json");
  const settings = readJson(local);
  writeFileSync(local, `${JSON.stringify({ ...settings, permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`);

  const first = await f.runOk(["uninstall", "--project", "--yes"], { cwd: bob });
  assert.match(first.ctx.out(), /records the created files that stay/);
  const reduced = readJson(join(bob, ".omt", "install.json"));
  assert.deepEqual((reduced.project as { existing: unknown }).existing, {
    skills: ["alpha", "beta"],
    links: ["alpha", "beta"].map((name) => join(bob, ".claude", "skills", name)),
  });

  const second = await f.runOk(["uninstall", "--project", "--yes"], { cwd: bob });
  assert.match(second.ctx.out(), /keep {5}.*alpha {2}\(existed before the install\)/);
  assert.equal(f.shown(bob), "");
});

test("uninstall --project keeps a project link that points at the user install", async () => {
  const f = projectFixture();
  await f.runOk(["install", "--yes"]);
  const mine = join(f.project, ".claude", "skills", "mine");
  mkdirSync(dirname(mine), { recursive: true });
  symlinkSync(join(f.agents, "alpha"), mine);
  await f.runOk(["install", "--project", "--yes"]);
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(readlinkSync(mine), join(f.agents, "alpha"), "the user's link stays");
  assert.ok(!existsSync(join(f.project, ".claude", "skills", "alpha")));
});

test("a project hook update backs up a settings file that is not in the layout omt writes", async () => {
  const f = projectFixture();
  const local = join(f.project, ".claude", "settings.local.json");
  mkdirSync(dirname(local));
  const other = '"/other/clone/.omt/bin/omt" hook user-prompt-submit # oh-my-t3code';
  const text = `{\n  "permissions": { "allow": ["Bash(ls)", "Bash(cat)"] },\n  "hooks": { "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": ${JSON.stringify(other)} }] }] }\n}\n`;
  writeFileSync(local, text);
  const installed = await f.runOk(["install", "--project", "--hooks", "--yes"]);
  assert.match(installed.ctx.out(), /update {3}Claude UserPromptSubmit/);
  assert.equal(readFileSync(join(f.project, ".omt", "backups", STAMP, "claude-settings.json"), "utf8"), text, "the original bytes stay recoverable");
  assert.equal(readFileSync(join(f.project, ".omt", "backups", ".gitignore"), "utf8"), "*\n");
  const manifest = readJson(join(f.project, ".omt", "install.json"));
  assert.equal((manifest.hooks as { backup?: string }[])[0]?.backup, undefined, "an update backup is not the install-time backup");

  // A file in the layout that omt writes changes only in the command, so it gets no new backup.
  writeFileSync(local, readFileSync(local, "utf8").replace(join(f.project, ".omt"), "/moved/.omt"));
  const moved = await f.runOk(["install", "--project", "--hooks", "--yes"], { now: () => new Date("2026-01-02T03:04:10.000Z") });
  assert.match(moved.ctx.out(), /update {3}Claude UserPromptSubmit/);
  assert.ok(!existsSync(join(f.project, ".omt", "backups", "20260102030410")));
});

test("a dangling .omt/.gitignore symlink is the user's: the install writes nothing outside the project", async () => {
  const f = gitFixture();
  const gitignore = join(f.project, ".omt", ".gitignore");
  const target = join(f.root, "dot", "omt-gitignore");
  mkdirSync(dirname(gitignore));
  symlinkSync(target, gitignore);
  const statusBefore = f.status();
  const treeBefore = contentTree(f.project);
  const installed = await f.runOk(["install", "--project", "--yes"]);
  assert.match(installed.ctx.out(), /keep {5}.*\.gitignore {2}\(a dangling symlink; left alone\)/);
  assert.ok(!existsSync(target), "the link target stays absent");
  const files = manifestFiles(readJson(join(f.project, ".omt", "install.json")));
  assert.ok(!files.includes(gitignore));
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.ok(!existsSync(target));
  assert.deepEqual(contentTree(f.project), treeBefore);
  assert.equal(f.status(), statusBefore);
});

test("an install from main and a worktree is one install; an uninstall from either cwd gives the exclude file back byte for byte", async () => {
  for (const from of ["main", "worktree"]) {
    for (const start of ["*.log", undefined]) {
      const name = `uninstall from ${from}, ${start === undefined ? "no exclude file" : "no final newline"}`;
      const f = gitFixture();
      const wt = join(f.root, "wt");
      f.git(["worktree", "add", "-q", wt]);
      const info = join(f.project, ".git", "info");
      if (start === undefined) rmSync(info, { recursive: true });
      else writeFileSync(f.exclude, start);
      await f.runOk(["install", "--project", "--yes"], { cwd: f.project }, name);
      const again = await f.runOk(["install", "--project", "--yes"], { cwd: wt }, name);
      assertAllUnchanged(again.ctx.out(), { ignoreNone: true, message: `${name}: the second install is a rerun` });
      await f.runOk(["uninstall", "--project", "--yes"], { cwd: from === "main" ? f.project : wt }, name);
      assert.ok(!existsSync(join(f.project, ".omt", "install.json")), `${name}: the one install goes`);
      if (start === undefined) assert.ok(!existsSync(info), `${name}: the info directory goes`);
      else assert.equal(readFileSync(f.exclude, "utf8"), start, name);
    }
  }
});

test("--no-git-exclude: an uninstall that keeps an edited config leaves no manifest that git shows", async () => {
  const f = gitFixture();
  await f.runOk(["install", "--project", "--no-git-exclude", "--yes"]);
  writeFileSync(join(f.project, ".omt", "config.jsonc"), `${PROJECT_STARTER_CONFIG}// mine\n`);
  const removed = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.match(removed.ctx.out(), /remove {3}.*install\.json/);
  assert.ok(!existsSync(join(f.project, ".omt", "install.json")));
  assert.equal(f.shown(), "?? .omt/config.jsonc\n", "only the user's edited config shows");
});

test("a manifest hook backup outside .omt/backups is dropped, so the uninstall never writes or deletes that file", async () => {
  const f = projectFixture();
  const local = join(f.project, ".claude", "settings.local.json");
  const other = join(f.project, "other.json");
  const otherText = '{\n  "theme": "dark"\n}\n';
  mkdirSync(dirname(local));
  const command = "x # oh-my-t3code";
  writeFileSync(local, JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command }] }] } }, null, 2));
  writeFileSync(other, otherText);
  mkdirSync(join(f.project, ".omt"));
  const manifest = {
    scope: "project",
    root: f.project,
    package: "oh-my-t3code",
    version: "0.1.0",
    installedAt: "",
    skillsRoot: "",
    skills: [],
    links: [],
    hooks: [{ kind: "claude-user-prompt-submit", settingsPath: local, command, backup: other }],
    backups: [],
    project: { omtDirCreated: false, settingsCreated: false },
  };
  writeFileSync(join(f.project, ".omt", "install.json"), JSON.stringify(manifest));
  const removed = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.doesNotMatch(removed.ctx.out(), /restores the backup/);
  assert.equal(readFileSync(other, "utf8"), otherText, "the file that the manifest names stays");
  assert.deepEqual(readJson(local), { theme: "dark" });
});

test("install and uninstall remove a stale block next to the root's own block", async () => {
  const f = projectFixture();
  const gone = join(f.root, "gone");
  await f.runOk(["install", "--project", "--yes"]);
  const own = readFileSync(f.exclude, "utf8");
  writeFileSync(f.exclude, `${own}${block(gone, "/x")}\n`);
  await f.runOk(["install", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), own, "the install removes the stale block");

  writeFileSync(f.exclude, `${own}${block(gone, "/x")}\n`);
  writeFileSync(join(f.project, ".omt", "ledger.jsonl"), "{}\n");
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(
    readFileSync(f.exclude, "utf8"),
    `${GIT_EXCLUDE_DEFAULT}${block(f.project, "/.omt/.gitignore", "/.omt/install.json")}\n`,
    "the uninstall that keeps a reduced block removes the stale block",
  );
});

test("install --project removes a scratch directory that an interrupted run left", async () => {
  const f = projectFixture();
  const scratch = join(f.project, ".agents", ".omt-tmp-0123abcd");
  mkdirSync(join(scratch, "alpha"), { recursive: true });
  const { ctx } = await f.runOk(["install", "--project", "--yes"]);
  assert.match(ctx.out(), /remove {3}.*\.omt-tmp-0123abcd {2}\(left by an interrupted run\)/);
  assert.ok(!existsSync(scratch));
});

test("the exclude file gets its exact bytes back after a reinstall", async () => {
  const f = projectFixture();
  writeFileSync(f.exclude, "*.log");
  await f.runOk(["install", "--project", "--yes"]);
  await f.runOk(["install", "--project", "--yes"]);
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.equal(readFileSync(f.exclude, "utf8"), "*.log");
});

test("--project refuses a root whose paths are the user-scope Claude, config, or agents paths", async () => {
  const f = projectFixture();
  const cases: Record<string, () => Partial<Record<string, string>>> = {
    CLAUDE_CONFIG_DIR: () => ({ CLAUDE_CONFIG_DIR: join(f.project, ".claude") }),
    OMT_CONFIG_DIR: () => ({ OMT_CONFIG_DIR: join(f.project, ".omt") }),
    "a symlinked ~/.agents": () => {
      mkdirSync(join(f.project, ".agents", "skills"), { recursive: true });
      symlinkSync(join(f.project, ".agents"), join(f.home, ".agents"));
      return {};
    },
  };
  for (const [name, setup] of Object.entries(cases)) {
    const env = { HOME: f.home, ...setup() };
    const { code, ctx } = await f.run(["install", "--project", "--yes"], { env });
    assert.equal(code, 2, `${name}: ${ctx.err()}`);
    assert.match(ctx.err(), /shares paths with the user install/, name);
  }
});

test("a kept edited config that the user reverts goes with the next uninstall", async () => {
  const f = gitFixture();
  const treeBefore = contentTree(f.project);
  await f.runOk(["install", "--project", "--yes"]);
  const config = join(f.project, ".omt", "config.jsonc");
  writeFileSync(config, `${PROJECT_STARTER_CONFIG}// mine\n`);
  await f.runOk(["uninstall", "--project", "--yes"]);
  assert.ok(existsSync(config));
  writeFileSync(config, PROJECT_STARTER_CONFIG);
  const last = await f.runOk(["uninstall", "--project", "--yes"]);
  assert.match(last.ctx.out(), /remove {3}.*config\.jsonc/);
  assert.deepEqual(contentTree(f.project), treeBefore);
});

test("project hooks refuse dangling links to absent user settings", async () => {
  for (const parent of [false, true]) {
    const f = projectFixture();
    const local = join(f.project, ".claude", "settings.local.json");
    if (parent) symlinkSync(join(f.home, ".claude"), join(f.project, ".claude"));
    else {
      mkdirSync(dirname(local));
      symlinkSync(f.settings, local);
    }
    const before = snapshot(f.home);
    const result = await f.run(["install", "--project", "--hooks", "--yes"]);
    assert.ok(result.code !== 0);
    assert.match(result.ctx.err(), /outside the project|shares paths with the user install/);
    assert.deepEqual(snapshot(f.home), before);
    assert.ok(!existsSync(f.settings));
  }
});

test("a forged gitignore restore cannot write through external leaf or parent links", async () => {
  for (const parent of [false, true]) {
    const f = projectFixture();
    const target = join(f.root, "outside", ".gitignore");
    const omt = join(f.project, ".omt");
    writeFile(target, "keep\n");
    if (parent) symlinkSync(dirname(target), omt);
    else {
      mkdirSync(omt);
      symlinkSync(target, join(omt, ".gitignore"));
    }
    writeFile(join(omt, "install.json"), JSON.stringify({
      scope: "project", root: f.project, package: "oh-my-t3code", version: "0.3.0", installedAt: "",
      skillsRoot: join(f.project, ".agents", "skills"), skills: [], links: [], hooks: [], backups: [],
      project: { omtDirCreated: false, gitignoreRestore: { before: "replaced", sha256: createHash("sha256").update("keep\n").digest("hex") } },
    }));
    const before = snapshot(f.project);
    const result = await f.run(["uninstall", "--project", "--yes"]);
    assert.equal(result.code, 1, result.ctx.err());
    assert.match(result.ctx.err(), /outside the project/);
    assert.equal(readFileSync(target, "utf8"), "keep\n");
    assert.deepEqual(snapshot(f.project), before);
  }
});
