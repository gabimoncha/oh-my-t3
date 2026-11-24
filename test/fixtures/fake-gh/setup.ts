import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { GIT, PACKAGE_ROOT, gitEnv, gitRepo, spawnOmt, tempDir, writeFile } from "../../helpers.ts";

const FIXTURES = join(PACKAGE_ROOT, "test", "fixtures", "fake-gh");

export interface FakeHost {
  root: string;
  cwd: string;
  git: (args: string[], cwd?: string) => string;
  omt: (args: string[], cwd?: string) => { code: number | null; stdout: string; stderr: string };
  ghLog: () => string[];
}

function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line !== "") : [];
}

// A temp repo on branch main with origin git@github.com:alice/app.git, and a fake gh first on PATH that logs
// each call. Every path that omt reads points into the temp folder.
export function fakeHost(options: { files?: Record<string, string> } = {}): FakeHost {
  const root = tempDir("omt-git-host-");
  const cwd = join(root, "project");
  const git = gitRepo(root, cwd, options.files ?? {});
  writeFile(join(cwd, ".git", "info", "exclude"), ".omt3/\n");
  const bin = join(root, "bin");
  const state = join(root, "fake");
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  copyFileSync(join(FIXTURES, "gh"), join(bin, "gh"));
  chmodSync(join(bin, "gh"), 0o755);
  git(["remote", "add", "origin", "git@github.com:alice/app.git"]);
  const env = {
    ...gitEnv(root),
    PATH: [bin, dirname(GIT), process.env.PATH ?? ""].join(delimiter),
    FAKE_GH_LOG: join(state, "gh.log"),
  };
  return {
    root,
    cwd,
    git,
    omt: (args, at = cwd) => spawnOmt(args, { root, cwd: at, env }),
    ghLog: () => lines(join(state, "gh.log")),
  };
}
