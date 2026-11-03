import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "bun:test";
import { gitRepo } from "../helpers.ts";
import { releaseRegistry, run, tools } from "./registry.ts";

test("npx oh-my-t3 installs a pinned omt3 runner shim that runs roles", async () => {
  const tool = tools();
  const registry = await releaseRegistry("oneshot-", tool);
  const env = registry.env("npx", tool.nodePath);
  const project = join(registry.root, "project");
  gitRepo(env.HOME!, project);
  await run(tool.npx, ["--yes", `oh-my-t3@${registry.version}`, "install", "--project", "--yes"], project, env);
  const shim = join(project, ".omt", "bin", "omt");
  assert.ok(readFileSync(shim, "utf8").split("\n").includes(`exec npx --yes omt3@${registry.version} "$@"`), "the shim must call npx with the release version");
  const roles = await run(shim, ["roles"], project, env);
  assert.match(roles, /^ROLE\s+STATUS\s+TARGET\s+ACCESS\s+MODE\s+CROSS$/m);
}, 240_000);

test("bunx omt3 keeps its install folder inside the isolated temp root", async () => {
  const tool = tools();
  const registry = await releaseRegistry("oneshot-bunx-", tool);
  const env = registry.env("bunx", tool.bunPath);
  const root = dirname(env.HOME!);
  const isolatedTmp = join(root, "tmp");
  for (const name of ["TMPDIR", "TMP", "TEMP"]) {
    assert.equal(env[name], isolatedTmp, `${name} must point inside the test root`);
  }
  const realTmp = tmpdir();
  const installFolders = (path: string) => new Set(
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^bunx-.*omt3/.test(entry.name))
      .map((entry) => entry.name),
  );
  const before = installFolders(realTmp);
  const output = await run(tool.bun, ["x", `omt3@${registry.version}`, "roles"], registry.root, env);
  assert.match(output, /^ROLE\s+STATUS\s+TARGET\s+ACCESS\s+MODE\s+CROSS$/m);
  // Bun 1.4.4 and later keep the bunx install folder in the install cache (.bunx-<uid>/omt3@<version>);
  // older Bun put it in TMPDIR (bunx-<uid>-omt3@<version>). Either place is inside the test root.
  const cache = env.BUN_INSTALL_CACHE_DIR!;
  const inCache = readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(".bunx-"))
    .some((entry) => readdirSync(join(cache, entry.name)).some((name) => name.startsWith("omt3@")));
  assert.ok(inCache || installFolders(isolatedTmp).size > 0, "bunx must write its omt3 install folder inside the test root");
  const added = [...installFolders(realTmp)].filter((name) => !before.has(name));
  assert.deepEqual(added, [], "bunx must leave no new omt3 install folder in the real temp directory");
}, 240_000);
