import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { fakeHost } from "./fixtures/fake-gh/setup.ts";
import { writeFile } from "./helpers.ts";

function run(options: { origin?: boolean } = {}) {
  const host = fakeHost({ files: { "a.txt": "a\n", "b.txt": "b\n", "src/lib.txt": "lib\n" }, ...options });
  host.git(["checkout", "-q", "-b", "feat/x"]);
  const edit = (path: string, text: string) => writeFile(join(host.cwd, path), text);
  const ok = (args: string[], cwd?: string) => {
    const result = host.omt(["git", ...args], cwd);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout;
  };
  const committed = () => host.git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter((line) => line !== "").sort();
  return { ...host, edit, ok, committed };
}

test("git commit takes only the run's paths and leaves earlier and staged changes", () => {
  const r = run();
  r.edit("a.txt", "a before the run\n");
  r.edit("b.txt", "b staged by another session\n");
  r.git(["add", "b.txt"]);

  assert.equal(r.ok(["start", "--run", "r1"]), "start saved: 2 paths were already changed\n");
  assert.match(r.ok(["start", "--run", "r1"]), /^kept the start from \d{4}-\d\d-\d\dT/);

  r.edit("README.md", "# changed by the run\n");
  r.edit("new/c.txt", "new\n");
  const out = r.ok(["commit", "-m", "feat: the run", "--run", "r1"]);
  assert.match(out, /^committed [0-9a-f]{7,}: 2 files\nleft: a\.txt\nleft: b\.txt\n$/);
  assert.deepEqual(r.committed(), ["README.md", "new/c.txt"]);
  assert.equal(r.git(["diff", "--cached", "--name-only"]), "b.txt\n");
  assert.equal(r.git(["diff", "--name-only"]), "a.txt\n");
  assert.ok(r.ghLog().some((line) => line.startsWith("api --hostname github.com user")));
  assert.ok(r.ghLog().some((line) => line.startsWith("pr list --repo github.com/alice/app --head feat/x")));

  r.edit("d.txt", "d\n");
  r.edit("src/lib.txt", "lib changed\n");
  assert.match(r.ok(["commit", "-m", "one", "--run", "r1", "--path", "d.txt"]), /^committed [0-9a-f]+: 1 file\n/);
  assert.deepEqual(r.committed(), ["d.txt"]);
  assert.match(r.ok(["commit", "-m", "two", "--run", "r1", "--path", "lib.txt"], join(r.cwd, "src")), /^committed [0-9a-f]+: 1 file\n/);
  assert.deepEqual(r.committed(), ["src/lib.txt"]);
  assert.equal(r.git(["diff", "--cached", "--name-only"]), "b.txt\n");
});

test("git commit asks for a path outside the run, a path changed before and during the run, and no start", () => {
  const r = run();
  r.edit("a.txt", "a before the run\n");
  r.ok(["start", "--run", "r1"]);
  const head = r.git(["rev-parse", "HEAD"]);

  assert.equal(r.ok(["commit", "-m", "x", "--run", "r2"]), "ask: no start record; run omt git start before the first edit\n");
  r.edit("README.md", "# run\n");
  assert.equal(r.ok(["commit", "-m", "x", "--run", "r1", "--path", "a.txt"]), "ask: a.txt is not a path that this run changed\n");
  r.edit("a.txt", "a changed again by the run\n");
  assert.equal(r.ok(["commit", "-m", "x", "--run", "r1"]), "ask: a.txt had changes before the run, and the run changed it too\n");
  assert.equal(r.ok(["commit", "-m", "x", "--run", "r1", "--yes"]), "ask: a.txt had changes before the run, and the run changed it too\n");
  assert.equal(r.git(["rev-parse", "HEAD"]), head);
  assert.match(r.ok(["commit", "-m", "x", "--run", "r1", "--include", "a.txt"]), /^committed [0-9a-f]+: 2 files\n$/);
  assert.deepEqual(r.committed(), ["README.md", "a.txt"]);
});

test("git commit with an ask policy prints ask and commits nothing, and --yes commits", () => {
  const r = run();
  r.config({ profiles: { normal: { workflow: { git: { branchCommits: "ask" } } } } });
  r.ok(["start", "--run", "r1"]);
  r.edit("new.txt", "new\n");
  const head = r.git(["rev-parse", "HEAD"]);
  assert.equal(r.ok(["commit", "-m", "x", "--run", "r1"]), "ask: workflow.git.branchCommits is \"ask\" in profile \"normal\" on branch feat/x\n");
  assert.equal(r.git(["rev-parse", "HEAD"]), head);
  assert.equal(r.git(["status", "--porcelain"]), "?? new.txt\n");
  assert.match(r.ok(["commit", "-m", "x", "--run", "r1", "--yes"]), /^committed [0-9a-f]+: 1 file\n$/);
});

test("git commit asks for another owner's repo and needs no gh without origin", () => {
  const foreign = run();
  foreign.git(["remote", "set-url", "origin", "git@github.com:bob/app.git"]);
  foreign.ok(["start", "--run", "r1"]);
  foreign.edit("new.txt", "new\n");
  assert.equal(foreign.ok(["commit", "-m", "x", "--run", "r1"]), "ask: bob/app is not your repo; add the owner to workflow.git.owners to allow it\n");

  const local = run({ origin: false });
  local.ok(["start", "--run", "r1"]);
  local.edit("new.txt", "new\n");
  assert.match(local.ok(["commit", "-m", "x", "--run", "r1"]), /^committed [0-9a-f]+: 1 file\n$/);
  assert.deepEqual(local.ghLog(), []);
});

test("git start writes the record in the linked worktree's own git dir", () => {
  const r = run();
  const wt = join(r.root, "wt");
  r.git(["worktree", "add", "-q", "-b", "feat/y", wt]);
  r.ok(["start", "--plan", "demo"], wt);
  const gitDir = r.git(["rev-parse", "--absolute-git-dir"], wt).trim();
  assert.ok(gitDir.includes(join(".git", "worktrees")), gitDir);
  const record = JSON.parse(readFileSync(join(gitDir, "omt", "start-demo.json"), "utf8")) as { head: string; paths: Record<string, string> };
  assert.equal(record.head, r.git(["rev-parse", "HEAD"], wt).trim());
  assert.deepEqual(record.paths, {});
  assert.equal(existsSync(join(r.cwd, ".git", "omt", "start-demo.json")), false);
  const usage = r.omt(["git", "start", "--plan", "demo", "--run", "r1"]);
  assert.equal(usage.code, 2);
});
