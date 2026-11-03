import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  claudeConfigDir,
  claudeSettingsPath,
  configDir,
  evidenceDir,
  findProjectRoot,
  mainCheckoutOf,
  ledgerPath,
  manifestPath,
  omtDir,
  plansDir,
  projectConfigPath,
  projectRolesDir,
  shadowedWorktreeState,
  skillRoots,
  t3HomeDir,
  t3SettingsPath,
  userConfigPath,
  userRolesDir,
} from "../src/paths.ts";
import { gitRepo, tempDir } from "./helpers.ts";

const HOME = "/fake/home";

test("configDir prefers OMT_CONFIG_DIR, then XDG_CONFIG_HOME, then ~/.config", () => {
  assert.equal(configDir({ OMT_CONFIG_DIR: "/omt", XDG_CONFIG_HOME: "/xdg" }, HOME), "/omt");
  assert.equal(configDir({ XDG_CONFIG_HOME: "/xdg" }, HOME), "/xdg/oh-my-t3");
  assert.equal(configDir({}, HOME), "/fake/home/.config/oh-my-t3");
  assert.equal(configDir({ OMT_CONFIG_DIR: "", XDG_CONFIG_HOME: "" }, HOME), "/fake/home/.config/oh-my-t3");
});

test("user config files live in the config directory", () => {
  assert.equal(userConfigPath({}, HOME), "/fake/home/.config/oh-my-t3/config.jsonc");
  assert.equal(manifestPath({}, HOME), "/fake/home/.config/oh-my-t3/install.json");
  assert.equal(userRolesDir({}, HOME), "/fake/home/.config/oh-my-t3/roles");
  assert.equal(userConfigPath({ OMT_CONFIG_DIR: "/omt" }, HOME), "/omt/config.jsonc");
  assert.equal(manifestPath({ OMT_CONFIG_DIR: "/omt" }, HOME), "/omt/install.json");
  assert.equal(userRolesDir({ OMT_CONFIG_DIR: "/omt" }, HOME), "/omt/roles");
});

test("project paths live under <root>/.omt3", () => {
  assert.equal(omtDir("/repo"), "/repo/.omt3");
  assert.equal(projectConfigPath("/repo"), "/repo/.omt3/config.jsonc");
  assert.equal(projectRolesDir("/repo"), "/repo/.omt3/roles");
  assert.equal(plansDir("/repo"), "/repo/.omt3/plans");
  assert.equal(ledgerPath("/repo"), "/repo/.omt3/ledger.jsonl");
  assert.equal(evidenceDir("/repo"), "/repo/.omt3/evidence");
});

test("claude paths honor CLAUDE_CONFIG_DIR", () => {
  assert.equal(claudeConfigDir({}, HOME), "/fake/home/.claude");
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/cc" }, HOME), "/cc");
  assert.equal(claudeSettingsPath({}, HOME), "/fake/home/.claude/settings.json");
  assert.equal(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "/cc" }, HOME), "/cc/settings.json");
});

test("skillRoots uses the agents, claude, and gemini roots", () => {
  assert.deepEqual(skillRoots({}, HOME), {
    agents: "/fake/home/.agents/skills",
    claude: "/fake/home/.claude/skills",
    gemini: "/fake/home/.gemini/config/skills",
  });
  assert.equal(skillRoots({ CLAUDE_CONFIG_DIR: "/cc" }, HOME).claude, "/cc/skills");
});

test("t3 paths honor T3CODE_HOME", () => {
  assert.equal(t3HomeDir({}, HOME), "/fake/home/.t3");
  assert.equal(t3HomeDir({ T3CODE_HOME: "/t3" }, HOME), "/t3");
  assert.equal(t3SettingsPath({}, HOME), "/fake/home/.t3/userdata/settings.json");
  assert.equal(t3SettingsPath({ T3CODE_HOME: "/t3" }, HOME), "/t3/userdata/settings.json");
});

test("findProjectRoot finds the nearest ancestor with .git or .omt3", () => {
  const root = tempDir();
  const repo = join(root, "repo");
  const deep = join(repo, "a", "b");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(deep, { recursive: true });
  assert.equal(findProjectRoot(deep), repo);
  assert.equal(findProjectRoot(repo), repo);

  mkdirSync(join(repo, "a", ".omt3"));
  assert.equal(findProjectRoot(deep), join(repo, "a"));
});

test("findProjectRoot accepts .git as a file, as in a worktree", () => {
  const root = tempDir();
  const worktree = join(root, "wt");
  mkdirSync(join(worktree, "src"), { recursive: true });
  writeFileSync(join(worktree, ".git"), "gitdir: /elsewhere/.git/worktrees/wt\n");
  assert.equal(findProjectRoot(join(worktree, "src")), worktree);
});

test("findProjectRoot returns cwd when no marker exists", () => {
  const root = tempDir();
  const dir = join(root, "plain", "dir");
  mkdirSync(dir, { recursive: true });
  const found = findProjectRoot(dir);
  // On some machines the temp directory sits inside a repository; then the root is above `root`.
  assert.ok(found === dir || root.startsWith(`${found}${sep}`), found);
});

// A main checkout with one commit and a linked worktree next to it.
function worktreeRepo() {
  const root = tempDir();
  const main = join(root, "main");
  const worktree = join(root, "wt");
  const git = gitRepo(root, main);
  git(["worktree", "add", "-q", worktree]);
  return { root, main, worktree, git };
}

const real = (path: string | undefined) => (path === undefined ? undefined : realpathSync(path));

test("mainCheckoutOf reads the main checkout of a linked worktree without git", () => {
  const { main, worktree } = worktreeRepo();
  assert.equal(real(mainCheckoutOf(worktree)), realpathSync(main));
  assert.equal(mainCheckoutOf(main), undefined, "a normal checkout has no main checkout");
  assert.equal(mainCheckoutOf(join(worktree, "nope")), undefined);
});

test("mainCheckoutOf takes a relative or absolute commondir, and rejects a bare or broken layout", () => {
  const root = tempDir();
  const gitDir = join(root, "repo", ".git", "worktrees", "wt");
  const worktree = join(root, "wt");
  mkdirSync(gitDir, { recursive: true });
  mkdirSync(worktree);
  writeFileSync(join(worktree, ".git"), "gitdir: ../repo/.git/worktrees/wt\n");
  writeFileSync(join(gitDir, "commondir"), "../..\n");
  const config = join(root, "repo", ".git", "config");
  writeFileSync(config, "[core]\n\tbare = false\n");
  assert.equal(mainCheckoutOf(worktree), join(root, "repo"));
  for (const text of ["[core]\n\tbare = true\n", "[Core]\n\tBare = yes ; comment\n", "[core]\n\tbare\n"]) {
    writeFileSync(config, text);
    assert.equal(mainCheckoutOf(worktree), undefined, `bare: ${JSON.stringify(text)}`);
  }
  writeFileSync(config, '[core "x"]\n\tbare = true\n[core]\n\tbare = false\n');
  assert.equal(mainCheckoutOf(worktree), join(root, "repo"), "a subsection is not [core]");
  writeFileSync(config, "[core]\n\tbare = false\n");
  writeFileSync(join(gitDir, "commondir"), `${join(root, "repo", ".git")}\n`);
  assert.equal(mainCheckoutOf(worktree), join(root, "repo"));

  const bare = join(root, "bare.git", "worktrees", "wt");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, "commondir"), "../..\n");
  writeFileSync(join(worktree, ".git"), `gitdir: ${bare}\n`);
  assert.equal(mainCheckoutOf(worktree), undefined, "a bare repository has no main checkout");

  writeFileSync(join(worktree, ".git"), `gitdir: ${join(root, "gone")}\n`);
  assert.equal(mainCheckoutOf(worktree), undefined, "a broken gitdir");
  writeFileSync(join(worktree, ".git"), "not a gitdir line\n");
  assert.equal(mainCheckoutOf(worktree), undefined);
});

test("findProjectRoot resolves a linked worktree to its main checkout", () => {
  const { main, worktree } = worktreeRepo();
  mkdirSync(join(worktree, "src"));
  assert.equal(realpathSync(findProjectRoot(join(worktree, "src"))), realpathSync(main), "main without .omt3");
  mkdirSync(join(main, ".omt3"));
  assert.equal(realpathSync(findProjectRoot(worktree)), realpathSync(main), "main with .omt3");
  mkdirSync(join(worktree, ".omt3"));
  assert.equal(realpathSync(findProjectRoot(worktree)), realpathSync(main), "the worktree's own .omt3 never wins");
  assert.equal(findProjectRoot(main), main, "a normal checkout is unchanged");
  assert.equal(findProjectRoot(worktree), main, "the root keeps the path form of the cwd");
});

test("findProjectRoot keeps a worktree of a bare repository stored at <repo>/.git", () => {
  const root = tempDir();
  const seed = join(root, "seed");
  const git = gitRepo(root, seed);
  const common = join(root, "repo", ".git");
  git(["init", "-q", "--bare", "-b", "main", common], root);
  git(["push", "-q", common, "main"]);
  const worktree = join(root, "wt");
  git(["worktree", "add", "-q", worktree, "main"], common);
  assert.equal(mainCheckoutOf(worktree), undefined);
  assert.equal(findProjectRoot(worktree), worktree);
});

test("findProjectRoot keeps a worktree whose gitdir is broken", () => {
  const { worktree } = worktreeRepo();
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(worktree, "gone")}\n`);
  assert.equal(findProjectRoot(worktree), worktree);
});

test("shadowedWorktreeState reports a worktree .omt3 with plans or a ledger", () => {
  const { main, worktree } = worktreeRepo();
  assert.equal(shadowedWorktreeState(worktree), undefined);
  mkdirSync(join(worktree, ".omt3", "plans"), { recursive: true });
  writeFileSync(join(worktree, ".omt3", "plans", "notes.txt"), "x\n");
  mkdirSync(join(worktree, ".omt3", "plans", "dir.md"));
  mkdirSync(join(worktree, ".omt3", "ledger.jsonl"));
  assert.equal(shadowedWorktreeState(worktree), undefined, "only regular .md files and a regular ledger file count");
  writeFileSync(join(worktree, ".omt3", "plans", "x.md"), "# x\n");
  assert.deepEqual(shadowedWorktreeState(worktree), { worktree, main, dir: join(worktree, ".omt3") });
  mkdirSync(join(main, ".omt3", "plans"), { recursive: true });
  writeFileSync(join(main, ".omt3", "plans", "y.md"), "# y\n");
  assert.equal(shadowedWorktreeState(main), undefined, "the main checkout is never shadowed");

  const other = worktreeRepo();
  mkdirSync(join(other.worktree, ".omt3"));
  writeFileSync(join(other.worktree, ".omt3", "ledger.jsonl"), "");
  assert.deepEqual(shadowedWorktreeState(other.worktree), { worktree: other.worktree, main: other.main, dir: join(other.worktree, ".omt3") });

  const legacy = worktreeRepo();
  mkdirSync(join(legacy.worktree, ".omt", "plans"), { recursive: true });
  writeFileSync(join(legacy.worktree, ".omt", "plans", "x.md"), "# x\n");
  assert.deepEqual(shadowedWorktreeState(legacy.worktree), { worktree: legacy.worktree, main: legacy.main, dir: join(legacy.worktree, ".omt") });
});
