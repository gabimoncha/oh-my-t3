import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { gitRepo, tempDir } from "../helpers.ts";
import { runMain, runOk } from "../run.ts";

// A main checkout with one commit and a linked worktree; `run` calls main() with the cwd in the worktree.
function worktreeProject() {
  const root = tempDir("omt-wt-");
  const project = join(root, "project");
  const worktree = join(root, "wt");
  gitRepo(root, project)(["worktree", "add", "-q", worktree]);
  const run = (argv: string[], cwd = worktree) => runMain(argv, { root, cwd });
  const ok = (argv: string[], cwd = worktree, message?: string) => runOk(argv, { root, cwd }, message);
  return { root, project, worktree, run, runOk: ok };
}

const WARNING = /^warning: .*[/\\]wt[/\\]\.omt3 holds plans or a ledger that omt no longer reads; move them to .*[/\\]project[/\\]\.omt3$/;

test("init, plan new, and ledger add from a worktree write under the main checkout's .omt3", async () => {
  const p = worktreeProject();
  for (const argv of [["init"], ["plan", "new", "w1"], ["ledger", "add", "--plan", "w1", "--role", "explore", "--status", "completed"]]) {
    const { ctx } = await p.runOk(argv);
    assert.doesNotMatch(ctx.err(), /warning/, `${argv.join(" ")} prints no warning`);
  }
  assert.ok(existsSync(join(p.project, ".omt3", "config.jsonc")));
  assert.ok(existsSync(join(p.project, ".omt3", "plans", "w1.md")));
  assert.match(readFileSync(join(p.project, ".omt3", "ledger.jsonl"), "utf8"), /"plan":"w1"/);
  assert.ok(!existsSync(join(p.worktree, ".omt3")), "the worktree gets no .omt3");

  await p.runOk(["plan", "status", "w1"], p.project);
});

test("omt paths prints the main checkout's paths from a worktree", async () => {
  const p = worktreeProject();
  const evidence = await p.runOk(["paths", "--evidence"]);
  assert.equal(evidence.ctx.out(), `${join(p.project, ".omt3", "evidence")}\n`);

  const root = await p.run(["paths", "--root"]);
  assert.equal(realpathSync(root.ctx.out().trim()), realpathSync(p.project));

  const json = await p.runOk(["paths", "--json"]);
  const omt = join(p.project, ".omt3");
  assert.deepEqual(JSON.parse(json.ctx.out()), {
    root: p.project,
    omt,
    plans: join(omt, "plans"),
    grills: join(omt, "grills"),
    ledger: join(omt, "ledger.jsonl"),
    evidence: join(omt, "evidence"),
    config: join(omt, "config.jsonc"),
    shim: join(omt, "bin", "omt"),
  });
});

test("omt paths prints text lines, JSON, or one path per flag", async () => {
  const p = worktreeProject();
  const omt = join(p.project, ".omt3");
  const expected: Record<string, string> = {
    root: p.project,
    omt,
    plans: join(omt, "plans"),
    grills: join(omt, "grills"),
    ledger: join(omt, "ledger.jsonl"),
    evidence: join(omt, "evidence"),
    config: join(omt, "config.jsonc"),
    shim: join(omt, "bin", "omt"),
  };
  const text = await p.runOk(["paths"], p.project);
  assert.equal(text.ctx.out(), Object.entries(expected).map(([name, path]) => `${name}: ${path}\n`).join(""));
  for (const flag of ["root", "plans", "grills", "ledger", "evidence", "config", "shim"]) {
    const one = await p.runOk(["paths", `--${flag}`], p.project);
    assert.equal(one.ctx.out(), `${expected[flag]}\n`, flag);
  }
  assert.equal((await p.run(["paths", "--root", "--plans"])).code, 2);
  assert.equal((await p.run(["paths", "--json", "--root"])).code, 2);
  assert.equal((await p.run(["paths", "extra"])).code, 2);
});

test("a worktree .omt3 with plans gives one shadowed-state warning and a hint; other state gives none", async () => {
  const p = worktreeProject();
  mkdirSync(join(p.worktree, ".omt3", "plans"), { recursive: true });
  writeFileSync(join(p.worktree, ".omt3", "config.jsonc"), "{}\n");
  mkdirSync(join(p.worktree, ".omt3", "plans", "dir.md"));
  for (const argv of [["plan", "list"], ["ledger", "list"]]) {
    const quiet = await p.runOk(argv);
    assert.equal(quiet.ctx.err(), "", `${argv.join(" ")}: no plans or ledger in the worktree`);
  }
  writeFileSync(join(p.worktree, ".omt3", "plans", "x.md"), "# x\n");
  const warned = await p.runOk(["plan", "list"]);
  const lines = warned.ctx.err().trimEnd().split("\n");
  assert.equal(lines.length, 2, warned.ctx.err());
  assert.match(lines[0] ?? "", WARNING);
  assert.equal(
    lines[1],
    'hint: if git tracks them, untrack them with "git rm --cached" and commit; .omt3/.gitignore keeps plans out of git',
  );
  assert.equal((await p.run(["paths"])).ctx.err(), "", "paths does not warn");
  assert.equal((await p.run(["plan", "list"], p.project)).ctx.err(), "", "no warning from the main checkout");
});

test("init from a worktree of a bare repository at <repo>/.git writes the worktree's .omt3", async () => {
  const root = tempDir("omt-wt-");
  const seed = join(root, "seed");
  const git = gitRepo(root, seed);
  const repo = join(root, "repo");
  git(["init", "-q", "--bare", "-b", "main", join(repo, ".git")], root);
  git(["push", "-q", join(repo, ".git"), "main"]);
  const worktree = join(root, "wt");
  git(["worktree", "add", "-q", worktree, "main"], join(repo, ".git"));
  await runOk(["init"], { root, cwd: worktree });
  assert.ok(existsSync(join(worktree, ".omt3", "config.jsonc")));
  assert.ok(!existsSync(join(repo, ".omt3")), "the bare repository gets no .omt3");
});
