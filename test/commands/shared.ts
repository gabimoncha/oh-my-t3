import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tempDir, writeFile } from "../helpers.ts";
import { runMain, runOk } from "../run.ts";

export { CAPS_FILE } from "../routing/shared.ts";

export interface Project {
  root: string;
  home: string;
  cwd: string;
  run: typeof runMain;
  runOk: typeof runOk;
  writeOmt: (name: string, text: string) => void;
  projectConfig: (text: string) => void;
}

// A temp home and a temp git project; `run` calls main() with a fake context rooted there.
export function makeProject(): Project {
  const root = tempDir("omt-cmd-");
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const writeOmt = (name: string, text: string) => writeFile(join(cwd, ".omt3", name), text);
  return {
    root,
    home,
    cwd,
    run: (argv, options = {}) => runMain(argv, { root, ...options }),
    runOk: (argv, options = {}, message) => runOk(argv, { root, ...options }, message),
    writeOmt,
    projectConfig: (text) => writeOmt("config.jsonc", text),
  };
}
