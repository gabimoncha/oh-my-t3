import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config/defaults.ts";
import { run } from "../src/commands/git.ts";
import { findDefaultBranch } from "../src/git/branch.ts";
import { fakeHost } from "./fixtures/fake-gh/setup.ts";
import { fakeContext, gitEnv, gitRepo, tempDir, writeFile } from "./helpers.ts";

function project() {
  const root = tempDir("omt-git-");
  const cwd = join(root, "project");
  const git = gitRepo(root, cwd);
  const env = gitEnv(root);
  const config = (value: unknown) => writeFile(join(cwd, ".omt3", "config.jsonc"), JSON.stringify(value));
  const check = async (action: string, directory = cwd, ...flags: string[]) => {
    const ctx = fakeContext({ root, cwd: directory, env, argv: ["check", action, ...flags, "--json"] });
    assert.equal(await run(ctx), 0);
    assert.equal(ctx.err(), "");
    return JSON.parse(ctx.out()) as {
      decision: string;
      branch: string | null;
      defaultBranch: string | null;
      value: string | null;
      reason: string;
      maxPrFiles: number | null;
    };
  };
  return { root, cwd, git, env, config, check };
}

test("git default branch uses origin HEAD, existing init.defaultBranch, main, then master", () => {
  const p = project();
  p.git(["branch", "configured"]);
  p.git(["branch", "master"]);
  p.git(["config", "init.defaultBranch", "configured"]);
  p.git(["update-ref", "refs/remotes/origin/upstream", "HEAD"]);
  p.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/upstream"]);
  assert.equal(findDefaultBranch(p), "upstream");
  p.git(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
  assert.equal(findDefaultBranch(p), "configured");
  p.git(["branch", "-D", "configured"]);
  assert.equal(findDefaultBranch(p), "main");
  p.git(["checkout", "-q", "-b", "feat/x"]);
  p.git(["branch", "-D", "main"]);
  assert.equal(findDefaultBranch(p), "master");
});

for (const scenario of ["detached HEAD", "no repo", "no default branch"] as const) {
  test(`git commit asks with ${scenario}`, async () => {
    const p = project();
    let cwd = p.cwd;
    if (scenario === "detached HEAD") p.git(["checkout", "-q", "--detach"]);
    if (scenario === "no repo") cwd = join(p.root, "outside");
    if (scenario === "no default branch") {
      p.git(["branch", "-m", "feat/x"]);
      p.git(["config", "init.defaultBranch", "missing"]);
    }
    const result = await p.check("commit", cwd);
    assert.equal(result.decision, "ask");
    assert.match(result.reason, scenario === "detached HEAD" ? /detached/ : scenario === "no repo" ? /not in a git repository/ : /no default branch/);
  });
}

test("git pr asks on the default branch", async () => {
  const p = project();
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  const result = await p.check("pr", p.cwd, "--user", "alice");
  assert.equal(result.decision, "ask");
  assert.equal(result.value, "auto");
  assert.match(result.reason, /default branch/);
});

test("git pullRequests off disables push and pr", async () => {
  const p = project();
  p.git(["checkout", "-q", "-b", "feat/x"]);
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  p.config({ profiles: { normal: { workflow: { git: { pullRequests: "off" } } } } });
  for (const action of ["push", "pr"]) {
    const result = await p.check(action, p.cwd, "--user", "alice");
    assert.equal(result.decision, "off", action);
    assert.equal(result.value, "off", action);
  }
});

test("git uses a previously accepted partial policy until defaults are accepted", async () => {
  const p = project();
  p.git(["checkout", "-q", "-b", "feat/x"]);
  const accepted = structuredClone(DEFAULT_CONFIG);
  delete accepted.profiles.normal!.workflow!.git;
  writeFile(join(p.cwd, ".omt3", "install.json"), JSON.stringify({
    acceptedDefaults: { version: 1, cliVersion: "0.1.0", config: accepted },
  }));
  p.config({ profiles: { normal: { workflow: { git: { merge: "auto" } } } } });
  assert.equal((await p.check("merge")).decision, "auto");
  const result = await p.check("commit");
  assert.equal(result.decision, "ask");
  assert.equal(result.value, null);
  assert.match(result.reason, /normal/);
});

test("git merge outside a repo uses the merge value", async () => {
  const p = project();
  const outside = join(p.root, "outside");
  writeFile(join(outside, ".omt3", "config.jsonc"), JSON.stringify({
    profiles: { normal: { workflow: { git: { merge: "auto" } } } },
  }));
  const result = await p.check("merge", outside);
  assert.equal(result.decision, "auto");
  assert.equal(result.value, "auto");
  assert.equal(result.branch, null);
  assert.equal(result.defaultBranch, null);
});

test("git check prints the PR file limit of the profile", async () => {
  const p = project();
  p.git(["checkout", "-q", "-b", "feat/x"]);
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  assert.equal((await p.check("pr", p.cwd, "--user", "alice")).maxPrFiles, 100);
  p.config({ profiles: { normal: { workflow: { git: { maxPrFiles: 0 } } } } });
  assert.equal((await p.check("pr", p.cwd, "--user", "alice")).maxPrFiles, 0);
  p.config({});
  assert.equal((await p.check("pr", p.cwd, "--user", "alice")).maxPrFiles, 100);
});

test("git check asks when maxPrFiles is out of range", async () => {
  const p = project();
  p.git(["checkout", "-q", "-b", "feat/x"]);
  p.git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  p.config({ profiles: { normal: { workflow: { git: { maxPrFiles: 10001 } } } } });
  const ctx = fakeContext({ root: p.root, cwd: p.cwd, env: p.env, argv: ["check", "pr", "--user", "alice", "--json"] });
  assert.equal(await run(ctx), 0);
  assert.match(ctx.err(), /maxPrFiles: must be an integer from 0 to 10000, got 10001/);
  assert.equal(JSON.parse(ctx.out()).decision, "ask");
});

function behindRepo() {
  const host = fakeHost({ origin: false });
  host.git(["checkout", "-q", "-b", "feat/x"]);
  host.git(["checkout", "-q", "main"]);
  writeFile(join(host.cwd, "later.txt"), "later\n");
  host.git(["add", "later.txt"]);
  host.git(["commit", "-q", "-m", "later"]);
  host.git(["checkout", "-q", "feat/x"]);
  return host;
}

test("git behind --ff fast-forwards a clean tree", () => {
  const host = behindRepo();
  const result = host.omt(["git", "behind", "--ff"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "fast-forwarded 1 commit from main\n");
  assert.equal(host.git(["rev-parse", "HEAD"]), host.git(["rev-parse", "main"]));
  assert.equal(host.omt(["git", "behind"]).stdout, "up to date with main\n");
});

test("git behind --ff asks on a dirty tree and leaves HEAD", () => {
  const host = behindRepo();
  const before = host.git(["rev-parse", "HEAD"]);
  writeFile(join(host.cwd, "README.md"), "# edited\n");
  const result = host.omt(["git", "behind", "--ff"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "ask: 1 commit behind main; the tree has uncommitted changes\n");
  assert.equal(host.git(["rev-parse", "HEAD"]), before);
  assert.equal(readFileSync(join(host.cwd, "README.md"), "utf8"), "# edited\n");
});

test("git behind asks without --ff, asks on a diverged branch, and skips with no default branch", () => {
  const host = behindRepo();
  assert.equal(host.omt(["git", "behind"]).stdout, "ask: 1 commit behind main; pass --ff to fast-forward\n");
  writeFile(join(host.cwd, "mine.txt"), "mine\n");
  host.git(["add", "mine.txt"]);
  host.git(["commit", "-q", "-m", "mine"]);
  assert.equal(host.omt(["git", "behind", "--ff"]).stdout, "ask: 1 commit behind main; the branch has commits that main does not have\n");
  host.git(["branch", "-m", "main", "trunk"]);
  assert.equal(host.omt(["git", "behind", "--ff"]).stdout, "skipped: no default branch found\n");
  assert.equal(host.gitLog().length, 0);
});
