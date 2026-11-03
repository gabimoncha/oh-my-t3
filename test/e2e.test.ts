import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import type { BriefJsonOutput, LedgerStats, RouteOutput } from "../src/types.ts";
import { childEnv, CLI_PATH, gitEnv, gitRepo, PACKAGE_ROOT, spawnOmt, tempDir } from "./helpers.ts";
import { contentTree } from "./install/fixture.ts";

const PACKAGE_VERSION = (JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string }).version;

function omtEntries(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith("omt")) : [];
}

test("end to end: install, use every command in a project, then uninstall", () => {
  const root = tempDir("omt-e2e-");
  const env = childEnv(root);
  const home = env.HOME as string;
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(project, ".git"), { recursive: true });

  const omt = (args: string[], input = "") => spawnOmt(args, { root, cwd: project, env, input });
  const ok = (args: string[], input = "") => {
    const result = omt(args, input);
    assert.equal(result.code, 0, `omt ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };

  assert.match(ok(["install", "--yes"]), /^Applied \d+ changes\.$/m);
  assert.deepEqual(omtEntries(join(home, ".agents", "skills")).sort(), [
    "omt",
    "omt-code-review",
    "omt-design",
    "omt-plan",
    "omt-research",
    "omt-setup",
    "omt-swarm",
    "omt-ulw",
  ]);

  const doctor = ok(["doctor"]);
  assert.match(doctor, /^PASS  skills  /m);
  assert.match(doctor, /^PASS  links   /m);

  assert.match(ok(["roles"]), /^execute\s+unverified\s+/m);

  const route = JSON.parse(ok(["route", "execute"])) as RouteOutput;
  assert.equal(route.status, "unverified");
  assert.equal(route.delegateTask?.role, "implementation");

  assert.match(ok(["init"]), /^create .*\.omt[/\\]config\.jsonc$/m);
  assert.match(ok(["plan", "new", "demo"]), /demo\.md$/m);
  assert.match(ok(["plan", "status", "demo"]), /^next: U1 /m);
  assert.match(ok(["profile", "list"]), /^normal\s+/m);
  const profile = JSON.parse(ok(["profile", "show", "--plan", "demo", "--json"]));
  assert.equal(profile.profile, "normal");
  assert.equal(profile.source, "default");
  assert.equal(profile.workflow.build.review, "every-round");
  assert.equal(Object.hasOwn(profile.workflow.build, "verify"), false);

  const brief = JSON.parse(ok(["brief", "execute", "--task", "x", "--plan", "demo", "--unit", "U1", "--json"])) as BriefJsonOutput;
  assert.equal(brief.delegateTask.clientRequestId, "omt:demo:U1:execute:r1:a1");
  assert.equal(brief.delegateTask.title, "execute U1: x");
  assert.equal(brief.delegateTask.mode, "async");

  const added = JSON.parse(
    ok(["ledger", "add", "--plan", "demo", "--unit", "U1", "--role", "execute", "--status", "dispatched", "--task-id", "task-1"]),
  );
  assert.equal(added.taskId, "task-1");
  const stats = JSON.parse(ok(["ledger", "stats", "--plan", "demo", "--json"])) as LedgerStats;
  assert.equal(stats.active, 1);
  assert.equal(stats.canDispatch, true);
  assert.match(ok(["ledger", "stats", "--plan", "demo"]), /^can dispatch: yes$/m);

  const hook = JSON.parse(ok(["hook", "user-prompt-submit"], JSON.stringify({ prompt: "start ulw add a demo endpoint" })));
  assert.equal(hook.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(hook.hookSpecificOutput.additionalContext, /omt-ulw/);
  assert.equal(ok(["hook", "user-prompt-submit"], JSON.stringify({ prompt: "add a demo endpoint" })), "");

  assert.match(ok(["uninstall", "--yes"]), /^Removed \d+ paths\.$/m);
  assert.deepEqual(omtEntries(join(home, ".agents", "skills")), []);
  assert.deepEqual(omtEntries(join(home, ".claude", "skills")), []);
});

test("end to end: the shared grills path works from a worktree, and plan-review routes against each family", () => {
  const p = gitProject({ "README.md": "demo\n" });

  assert.match(p.omt("init"), /^create .*\.omt[/\\]config\.jsonc$/m);
  assert.ok(readFileSync(join(p.project, ".omt", ".gitignore"), "utf8").split("\n").includes("grills/"));
  const sharedPath = `${join(realpathSync(p.project), ".omt", "grills")}\n`;
  assert.equal(p.omt("paths", "--grills"), sharedPath);

  const worktree = join(p.project, "..", "grill-worktree");
  p.git(["worktree", "add", "-q", "-b", "grill-session", worktree]);
  const paths = spawnOmt(["paths", "--grills"], { root: p.project, cwd: worktree, env: p.env });
  assert.equal(paths.code, 0, paths.stderr);
  assert.equal(paths.stdout, sharedPath);

  for (const [against, provider, model] of [
    ["codex", "claudeAgent", "claude-opus-5-5"],
    ["claudeAgent", "codex", "gpt-6-astra"],
  ] as const) {
    const brief = JSON.parse(p.omt("brief", "plan-review", "--task", "Review this plan.", "--against", against, "--json")) as BriefJsonOutput;
    assert.equal(brief.delegateTask.target.providerInstanceId, provider);
    assert.equal(brief.delegateTask.target.model, model);
  }
});

test("end to end: git policy checks each action on feature and default branches and explicit overrides", () => {
  const p = gitProject({});
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  p.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  p.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  p.git(["checkout", "-q", "-b", "feat/x"]);
  for (const branch of ["feat/x", "main"]) {
    p.git(["checkout", "-q", branch]);
    for (const action of ["commit", "push", "pr", "merge"]) {
      const expected = branch === "feat/x" && action !== "merge" ? "auto" : "ask";
      assert.match(p.omt("git", "check", action, "--user", "alice"), new RegExp(`^${expected}: `), `${branch}: ${action}`);
    }
  }
  p.git(["checkout", "-q", "feat/x"]);
  mkdirSync(join(p.project, ".omt"));
  writeFileSync(join(p.project, ".omt", "config.jsonc"), JSON.stringify({ profiles: { normal: { workflow: { git: { branchCommits: "ask" } } } } }));
  assert.match(p.omt("git", "check", "commit", "--user", "alice"), /^ask: /);
});

test("end to end: git policy permits owned repos and asks for another owner's repo or PR", () => {
  const p = gitProject({});
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  p.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  p.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  p.git(["checkout", "-q", "-b", "feat/ownership"]);

  assert.match(p.omt("git", "check", "commit", "--user", "bob"), /^ask: .*alice\/app/);
  assert.match(p.omt("git", "check", "commit", "--user", "alice"), /^auto: /);

  mkdirSync(join(p.project, ".omt"));
  writeFileSync(join(p.project, ".omt", "config.jsonc"), JSON.stringify({
    profiles: { normal: { workflow: { git: { owners: ["acme"] } } } },
  }));
  p.git(["remote", "set-url", "origin", "https://github.com/acme/app.git"]);
  assert.match(p.omt("git", "check", "commit", "--user", "bob"), /^auto: /);
  assert.match(p.omt("git", "check", "push", "--user", "bob", "--pr-author", "carol"), /^ask: .*carol/);
});

// A committed git repository in a temp root, with an omt runner whose HOME and git config point into the root.
function gitProject(files: Record<string, string>) {
  const root = tempDir("omt-e2e-project-");
  const env = gitEnv(root);
  const project = join(root, "project");
  mkdirSync(env.HOME as string, { recursive: true });
  const git = gitRepo(root, project, files);
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { cwd: project, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const omt = (...args: string[]) => {
    const result = spawnOmt(args, { root, cwd: project, env });
    assert.equal(result.code, 0, `${process.execPath} ${[CLI_PATH, ...args].join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const status = () => git(["status", "--porcelain", "--untracked-files=all", "--ignored"]);
  return { env, project, run, git, omt, status };
}

for (const [label, files] of [
  ["a tracked .omt/plans/x.md", { "README.md": "demo\n", ".omt/plans/x.md": "# x\n" }],
  ["no .omt and no .claude", { "README.md": "demo\n" }],
] as const) {
  test(`end to end: install --project with ${label} leaves no trace in git, and uninstall restores the tree`, () => {
    const p = gitProject(files);
    const excludeBefore = readFileSync(join(p.project, ".git", "info", "exclude"), "utf8");
    const treeBefore = Object.keys(contentTree(p.project));

    assert.match(p.omt("install", "--project", "--hooks", "--yes"), /^Applied \d+ changes\.$/m);
    const written = [".agents/skills/omt-ulw", ".claude/skills/omt-ulw", ".claude/settings.local.json", ".omt/bin/omt", ".omt/config.jsonc"];
    for (const path of written) {
      assert.ok(existsSync(join(p.project, path)), path);
    }
    assert.equal(p.git(["status", "--porcelain", "--untracked-files=all"]), "");
    assert.equal(p.run(join(p.project, ".omt", "bin", "omt"), ["--version"]).trim(), PACKAGE_VERSION);
    assert.match(p.run(join(p.project, ".omt", "bin", "omt"), ["roles"]), /^execute\s+unverified\s+/m);
    assert.deepEqual(omtEntries(join(p.env.HOME as string, ".agents", "skills")), []);

    assert.match(p.omt("uninstall", "--project", "--yes"), /^Removed \d+ paths\.$/m);
    assert.equal(p.status(), "");
    assert.equal(readFileSync(join(p.project, ".git", "info", "exclude"), "utf8"), excludeBefore);
    assert.deepEqual(Object.keys(contentTree(p.project)), treeBefore);
  });
}

test("end to end: --project keeps the user's own settings.local.json keys and its mode", () => {
  const p = gitProject({ "README.md": "demo\n" });
  const local = join(p.project, ".claude", "settings.local.json");
  mkdirSync(dirname(local));
  const mine = `${JSON.stringify({ theme: "dark", permissions: { allow: ["Bash(ls)"] } }, null, 2)}\n`;
  writeFileSync(local, mine, { mode: 0o600 });
  chmodSync(local, 0o600);
  const statusBefore = p.git(["status", "--porcelain", "--untracked-files=all"]);

  p.omt("install", "--project", "--hooks", "--yes");
  const settings = JSON.parse(readFileSync(local, "utf8")) as Record<string, unknown>;
  assert.equal(settings.theme, "dark");
  assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
  assert.match(JSON.stringify(settings.hooks), /# oh-my-t3code/);
  assert.equal(statSync(local).mode & 0o777, 0o600);
  assert.equal(p.git(["status", "--porcelain", "--untracked-files=all"]), statusBefore);

  p.omt("uninstall", "--project", "--yes");
  assert.equal(readFileSync(local, "utf8"), mine);
  assert.equal(statSync(local).mode & 0o777, 0o600);
});
