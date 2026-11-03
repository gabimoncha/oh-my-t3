import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { GIT, PACKAGE_ROOT, gitEnv, gitRepo, spawnOmt, tempDir, writeFile } from "../../helpers.ts";

const FIXTURES = join(PACKAGE_ROOT, "test", "fixtures", "fake-gh");

export interface FakeHost {
  root: string;
  cwd: string;
  git: (args: string[], cwd?: string) => string;
  omt: (args: string[], cwd?: string) => { code: number | null; stdout: string; stderr: string };
  config: (value: unknown) => void;
  prs: (branch: string, value: unknown) => void;
  flag: (name: string, text?: string) => void;
  ghLog: () => string[];
  pushLog: () => string[];
  gitLog: () => string[];
  body: (n: number) => string;
}

function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line !== "") : [];
}

// A temp repo on branch main, with a fake gh and a git wrapper first on PATH. Every path that omt
// reads points into the temp folder. `origin` adds git@github.com:alice/app.git, and `login` is
// what `gh api user` prints.
export function fakeHost(options: { files?: Record<string, string>; origin?: boolean; login?: string } = {}): FakeHost {
  const root = tempDir("omt-git-host-");
  const cwd = join(root, "project");
  const git = gitRepo(root, cwd, options.files ?? {});
  writeFile(join(cwd, ".git", "info", "exclude"), ".omt/\n");
  const bin = join(root, "bin");
  const state = join(root, "fake");
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  for (const tool of ["gh", "git"]) {
    copyFileSync(join(FIXTURES, tool), join(bin, tool));
    chmodSync(join(bin, tool), 0o755);
  }
  if (options.origin !== false) git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  if (options.login !== "") writeFileSync(join(state, "login"), `${options.login ?? "alice"}\n`);
  const env = {
    ...gitEnv(root),
    PATH: [bin, dirname(GIT), process.env.PATH ?? ""].join(delimiter),
    FAKE_REAL_GIT: GIT,
    FAKE_GH_DIR: state,
    FAKE_GH_LOG: join(state, "gh.log"),
    FAKE_GIT_LOG: join(state, "git.log"),
  };
  return {
    root,
    cwd,
    git,
    omt: (args, at = cwd) => spawnOmt(args, { root, cwd: at, env }),
    config: (value) => writeFile(join(cwd, ".omt", "config.jsonc"), JSON.stringify(value)),
    prs: (branch, value) => writeFileSync(join(state, `prs-${branch.replaceAll("/", "_")}.json`), JSON.stringify(value)),
    flag: (name, text = "") => writeFileSync(join(state, name), text),
    ghLog: () => lines(join(state, "gh.log")),
    pushLog: () => lines(join(state, "git.log")).filter((line) => line.startsWith("push")),
    gitLog: () => lines(join(state, "git.log")),
    body: (n) => readFileSync(join(state, `body-${n}.txt`), "utf8"),
  };
}
