import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "bun:test";
import { fakeHost } from "./fixtures/fake-gh/setup.ts";
import { writeFile } from "./helpers.ts";

// A repo whose origin/main is at main, on branch feat/x with one commit per entry of `commits`.
function branch(commits: string[][] = [["one.txt"]]) {
  const host = fakeHost();
  host.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  host.git(["checkout", "-q", "-b", "feat/x"]);
  const shas: string[] = [];
  for (const [i, files] of commits.entries()) {
    for (const file of files) writeFile(join(host.cwd, file), `${file}\n`);
    host.git(["add", "-A"]);
    host.git(["commit", "-q", "-m", `commit ${i + 1}`]);
    shas.push(host.git(["rev-parse", "HEAD"]).trim());
  }
  writeFile(join(host.root, "body.md"), "The body.\n");
  const bodyPath = join(host.root, "body.md");
  const ok = (args: string[]) => {
    const result = host.omt(["git", ...args]);
    assert.equal(result.code, 0, result.stderr);
    return result.stdout;
  };
  const pr = (...flags: string[]) => ok(["pr", "--title", "Add one", "--body-file", bodyPath, "--run", "r1", ...flags]);
  const creates = () => host.ghLog().filter((line) => line.startsWith("pr create"));
  return { ...host, shas, bodyPath, ok, pr, creates };
}

const openPr = (number: number, author = "alice", head = "feat/x", base = "main") => ({
  number,
  url: `https://github.com/alice/app/pull/${number}`,
  author: { login: author },
  headRefName: head,
  headRepositoryOwner: { login: "alice" },
  baseRefName: base,
});

test("git pr pushes and opens a draft PR by default", () => {
  const b = branch();
  assert.equal(b.pr(), "created https://github.com/alice/app/pull/1 (draft)\n");
  assert.deepEqual(b.pushLog(), ["push origin HEAD:feat/x"]);
  const [create] = b.creates();
  assert.match(create ?? "", /--repo github\.com\/alice\/app --base main --head feat\/x --title Add one --body-file \S+body\.md --draft$/);
});

test("git pr --ready opens a ready PR", () => {
  const b = branch();
  assert.equal(b.pr("--ready"), "created https://github.com/alice/app/pull/1 (ready)\n");
  assert.equal(b.creates().length, 1);
  assert.doesNotMatch(b.creates()[0] ?? "", /--draft/);
});

test("git pr updates the open PR of the branch", () => {
  const b = branch();
  b.prs("feat/x", [openPr(7)]);
  assert.equal(b.pr(), "updated https://github.com/alice/app/pull/7\n");
  assert.deepEqual(b.pushLog(), ["push origin HEAD:feat/x"]);
  assert.deepEqual(b.creates(), []);
});

test("git pr asks for another author's PR and pushes nothing", () => {
  const b = branch();
  b.prs("feat/x", [openPr(7, "bob")]);
  assert.equal(b.pr(), "ask: the PR is by bob\n");
  assert.deepEqual(b.pushLog(), []);
});

test("git pr splits over maxPrFiles and pushes nothing", () => {
  const b = branch([["one.txt", "two.txt", "three.txt"]]);
  b.config({ profiles: { normal: { workflow: { git: { maxPrFiles: 2 } } } } });
  assert.equal(b.pr(), "split: 3 files, limit 2; pick cut commits and run omt git stack <sha>,...\n");
  assert.deepEqual(b.gitLog(), ["fetch --quiet origin main"]);
  assert.deepEqual(b.creates(), []);
});

test("git pr has no file limit with maxPrFiles 0", () => {
  const b = branch([["one.txt", "two.txt", "three.txt"]]);
  b.config({ profiles: { normal: { workflow: { git: { maxPrFiles: 0 } } } } });
  assert.equal(b.pr(), "created https://github.com/alice/app/pull/1 (draft)\n");
  assert.deepEqual(b.gitLog(), ["push origin HEAD:feat/x"]);
});

test("git pr asks on a rejected push and opens no PR", () => {
  const b = branch();
  b.flag("reject-push");
  assert.equal(b.pr(), "ask: the push was rejected: ! [rejected]        HEAD -> feat/x (fetch first); a force push needs the owner's yes\n");
  assert.deepEqual(b.creates(), []);
  b.pr("--force-with-lease");
  assert.deepEqual(b.pushLog(), ["push origin HEAD:feat/x", "push --force-with-lease origin HEAD:feat/x"]);
});

test("git pr --profile with pullRequests off prints off", () => {
  const b = branch();
  b.config({ profiles: { quiet: { description: "No PRs.", workflow: { git: { pullRequests: "off" } } } } });
  assert.equal(b.pr("--profile", "quiet"), "off: workflow.git.pullRequests is \"off\" in profile \"quiet\" on branch feat/x\n");
  assert.deepEqual(b.pushLog(), []);
  assert.equal(b.pr(), "created https://github.com/alice/app/pull/1 (draft)\n");
});

test("git stack pushes two valid slices and opens chained draft PRs", () => {
  const b = branch([["one.txt"], ["two.txt"]]);
  const [cut] = b.shas;
  const out = b.ok(["stack", cut as string, "--title", "Add files", "--body-file", b.bodyPath, "--run", "r1"]);
  assert.equal(out, [
    "created https://github.com/alice/app/pull/1 (draft)",
    "created https://github.com/alice/app/pull/2 (draft)",
    "note: gh stack is not installed; the PRs have chained bases only",
    "",
  ].join("\n"));
  assert.deepEqual(b.pushLog(), ["push --atomic origin feat/x-1:feat/x-1 HEAD:feat/x"]);
  assert.equal(b.git(["rev-parse", "feat/x-1"]).trim(), cut);
  const [lower, top] = b.creates();
  assert.match(lower ?? "", /--base main --head feat\/x-1 --title Add files \(1\/2\) --body-file - --draft$/);
  assert.match(top ?? "", /--base feat\/x-1 --head feat\/x --title Add files --body-file \S+body\.md --draft$/);
  assert.equal(b.body(1), "Part 1 of 2: Add files\n\n- commit 1\n");

  b.flag("stack");
  b.prs("feat/x-1", [openPr(1, "alice", "feat/x-1")]);
  b.prs("feat/x", [openPr(2, "alice", "feat/x", "main")]);
  b.flag("ls-remote", `${cut}\trefs/heads/feat/x-1\n`);
  const again = b.ok(["stack", cut as string, "--title", "Add files", "--body-file", b.bodyPath, "--run", "r1"]);
  assert.equal(again, "updated https://github.com/alice/app/pull/1\nupdated https://github.com/alice/app/pull/2\n");
  assert.ok(b.ghLog().includes("pr edit 2 --repo github.com/alice/app --base feat/x-1"));
  assert.ok(b.ghLog().includes("stack link --base main 1 2"));
  assert.ok(b.ghLog().includes("GH_REPO=github.com/alice/app"));
});

test("git stack with an oversized slice pushes nothing", () => {
  const b = branch([["one.txt", "two.txt"], ["three.txt"]]);
  b.config({ profiles: { normal: { workflow: { git: { maxPrFiles: 1 } } } } });
  const [cut] = b.shas;
  const out = b.ok(["stack", cut as string, "--title", "Add files", "--body-file", b.bodyPath, "--run", "r1"]);
  assert.equal(out, "split: slice 1 of 2 changes 2 files, limit 1; pick more cut commits\n");
  assert.deepEqual(b.pushLog(), []);
  assert.deepEqual(b.creates(), []);
  assert.equal(b.git(["branch", "--list", "feat/x-1"]), "");
});

test("git stack asks when the cuts are out of order or a slice branch exists elsewhere", () => {
  const b = branch([["one.txt"], ["two.txt"], ["three.txt"]]);
  const [first, second] = b.shas as [string, string];
  const stack = (list: string) => b.ok(["stack", list, "--title", "T", "--body-file", b.bodyPath, "--run", "r1"]);
  assert.match(stack(`${second},${first}`), /^ask: \S+ is not an ancestor of \S+; list the cuts bottom first\n$/);
  b.flag("ls-remote", `${second}\trefs/heads/feat/x-1\n`);
  assert.equal(stack(first), "ask: feat/x-1 exists on origin at another commit\n");
  assert.deepEqual(b.pushLog(), []);
});

test("git stack sends every slice in one atomic push, so a rejected ref publishes nothing", () => {
  const b = branch([["one.txt"], ["two.txt"]]);
  b.flag("reject-push");
  const [cut] = b.shas;
  const out = b.ok(["stack", cut as string, "--title", "Add files", "--body-file", b.bodyPath, "--run", "r1"]);
  assert.match(out, /^ask: the push was rejected: /);
  assert.deepEqual(b.pushLog(), ["push --atomic origin feat/x-1:feat/x-1 HEAD:feat/x"]);
  assert.deepEqual(b.creates(), []);
});

test("git pr asks when --base differs from the base of the open PR, and pushes nothing", () => {
  const b = branch();
  b.prs("feat/x", [openPr(7, "alice", "feat/x", "main")]);
  assert.equal(b.pr("--base", "alt"), "ask: the open PR targets main, not alt; leave out --base, or change the PR's base first\n");
  assert.deepEqual(b.pushLog(), []);
});

test("git pr --pr updates the named PR of the user and never creates one", () => {
  const b = branch();
  b.flag("pr-7.json", JSON.stringify({
    number: 7, url: "https://github.com/alice/app/pull/7", author: { login: "alice" }, state: "OPEN",
    headRefName: "feat/x", headRepositoryOwner: { login: "alice" }, headRepository: { name: "app" }, isCrossRepository: false, baseRefName: "main",
  }));
  assert.equal(b.ok(["pr", "--pr", "7", "--run", "r1"]), "updated https://github.com/alice/app/pull/7\n");
  assert.deepEqual(b.pushLog(), ["push origin HEAD:feat/x"]);
  assert.deepEqual(b.creates(), []);
});

test("git pr --pr asks for a fork PR, a PR on another branch, and another author's PR, and pushes nothing", () => {
  const b = branch();
  const view = (fields: Record<string, unknown>) => b.flag("pr-8.json", JSON.stringify({
    number: 8, url: "https://github.com/alice/app/pull/8", author: { login: "alice" }, state: "OPEN", headRefName: "feat/x",
    headRepositoryOwner: { login: "alice" }, headRepository: { name: "app" }, isCrossRepository: false, baseRefName: "main", ...fields,
  }));
  view({ author: { login: "bob" }, headRepositoryOwner: { login: "bob" }, isCrossRepository: true });
  assert.equal(b.pr("--pr", "8"), "ask: PR #8 comes from bob/app, not alice/app; omt pushes only to origin\n");
  view({ headRefName: "feat/other" });
  assert.equal(b.pr("--pr", "8"), "ask: PR #8 is on the branch feat/other, and this checkout is on feat/x\n");
  view({ author: { login: "bob" } });
  assert.equal(b.pr("--pr", "8"), "ask: PR #8 is by bob, not by you\n");
  assert.deepEqual(b.pushLog(), []);
  assert.deepEqual(b.creates(), []);
});
