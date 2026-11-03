import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { confirmChannel, detectChannel, linksProjectCli, newCliCommand, updateAction } from "../../src/update/channel.ts";
import type { ChannelInput, ChannelKind, RunCommand } from "../../src/update/channel.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

function inputAt(root: string, path: string, overrides: Partial<ChannelInput> = {}): ChannelInput {
  const ctx = fakeContext({ root });
  const cliPath = join(root, path);
  const packageRoot = dirname(dirname(cliPath));
  writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "omt3", version: "0.2.0" }));
  writeFile(cliPath, "");
  return { build: "bundle", cliPath, packageRoot, cwd: ctx.cwd, env: ctx.env, tempRoot: join(root, "tmp"), ...overrides };
}

const shapes: { name: string; path: string; kind: ChannelKind; build?: ChannelInput["build"]; runner?: string }[] = [
  { name: "npm under mise Node", path: "home/.local/share/mise/installs/node/24.22.1/lib/node_modules/omt3/dist/cli.js", kind: "npm-global" },
  { name: "pnpm 10 store", path: "home/Library/pnpm/global/5/node_modules/.pnpm/omt3@0.2.0/node_modules/omt3/dist/cli.js", kind: "pnpm-global" },
  { name: "pnpm 11 global folder", path: "home/Library/pnpm/global/v11/omt3/node_modules/omt3/dist/cli.js", kind: "pnpm-global" },
  { name: "Bun global", path: "home/.bun/install/global/node_modules/omt3/dist/cli.js", kind: "bun-global" },
  { name: "mise release", path: "home/.local/share/mise/installs/github-gabimoncha-oh-my-t3code/0.2.0/omt", kind: "mise-github", build: "binary" },
  { name: "renamed mise release", path: "home/.local/share/mise/installs/github-gabimoncha-oh-my-t3/0.2.0/omt", kind: "mise-github", build: "binary" },
  { name: "mise npm before npm global", path: "home/.local/share/mise/installs/npm-omt3/0.2.0/lib/node_modules/omt3/dist/cli.js", kind: "mise-npm" },
  { name: "source before npm global", path: "clone/lib/node_modules/omt3/dist/cli.js", kind: "source", build: "source" },
  { name: "release binary", path: "home/bin/omt", kind: "binary", build: "binary" },
  { name: "unknown bundle", path: "custom/omt3/dist/cli.js", kind: "unknown" },
  { name: "npx cache", path: "home/.npm/_npx/abcdef/node_modules/omt3/dist/cli.js", kind: "one-shot", runner: "npx" },
  { name: "pnpm dlx cache", path: "home/Library/Caches/pnpm/dlx/hash/id/node_modules/omt3/dist/cli.js", kind: "one-shot", runner: "pnpm" },
  { name: "Bun 1.4.4 bunx cache", path: "cache/.bunx-501/omt3@0.2.0/node_modules/omt3/dist/cli.js", kind: "one-shot", runner: "bunx" },
];

for (const packageName of ["omt3", "oh-my-t3code", "oh-my-t3"]) {
  for (const shape of shapes) {
    test(`detectChannel: ${packageName}, ${shape.name}`, async () => {
      const root = tempDir();
      const input = inputAt(root, shape.path.replaceAll("omt3", packageName), shape.build === undefined ? {} : { build: shape.build });
      writeFile(join(input.packageRoot, "package.json"), JSON.stringify({ name: packageName, version: "0.2.0" }));
      const found = detectChannel(input);
      assert.equal(found.kind, shape.kind);
      assert.equal(found.packageName, shape.build === "bundle" || shape.build === undefined ? packageName : "oh-my-t3");
      if (found.kind === "mise-github") {
        const action = updateAction(found, "0.3.0");
        assert.equal(action.kind, "run");
        if (action.kind === "run") assert.deepEqual(action.argv, ["mise", "use", "-g", "github:gabimoncha/oh-my-t3@0.3.0"]);
      }
      if (["npm-global", "pnpm-global", "bun-global", "mise-npm"].includes(found.kind)) {
        const action = updateAction(found, "0.3.0");
        assert.equal(action.kind, "run");
        if (action.kind === "run") assert.ok(action.argv.some((arg) => arg === `${packageName}@0.3.0` || arg === `npm:${packageName}@0.3.0`));
      }
      if (shape.runner !== undefined) {
        assert.equal(found.runner, shape.runner);
        assert.equal(found.key, `one-shot:${shape.runner}:0.2.0`);
      }
      if (!["npm-global", "pnpm-global", "bun-global"].includes(found.kind)) {
        assert.equal(await confirmChannel(found, input, async () => { throw new Error("unexpected manager command"); }), found);
      }
    });
  }
}

for (const manager of ["npm", "pnpm10", "pnpm11", "bun"] as const) {
  test(`confirmChannel: ${manager} captured global output`, async () => {
    const root = tempDir();
    const globalRoot = join(root, manager === "npm" ? "home/.local/share/mise/installs/node/24.22.1/lib/node_modules" : manager === "bun" ? "home/.bun/install/global" : manager === "pnpm10" ? "home/Library/pnpm/global/5/node_modules" : "home/Library/pnpm/global/v11");
    const folder = manager === "bun" ? join(globalRoot, "node_modules/omt3") : manager === "pnpm11" ? join(globalRoot, "omt3/node_modules/omt3") : join(globalRoot, "omt3");
    const input = inputAt(root, join(folder.slice(root.length + 1), "dist/cli.js"));
    const argv = manager === "bun" ? ["bun", "pm", "ls", "-g"] : [manager === "npm" ? "npm" : "pnpm", "root", "-g"];
    const run: RunCommand = async (actual, opts) => {
      assert.deepEqual(actual, argv);
      assert.deepEqual(opts, {});
      return { code: 0, stdout: manager === "bun" ? `${globalRoot} node_modules (96 installed)\n├── omt3@0.2.0\n` : `${globalRoot}\n` };
    };
    const found = detectChannel(input);
    assert.equal(found.kind, manager === "npm" ? "npm-global" : manager === "bun" ? "bun-global" : "pnpm-global");
    assert.equal(await confirmChannel(found, input, run), found);
    assert.equal((await confirmChannel(found, input, async () => ({ code: 1, stdout: "" }))).kind, "unknown");
    assert.equal((await confirmChannel(found, input, async () => ({ code: 0, stdout: `${root}/other\n` }))).kind, "unknown");
  });
}

test("confirmChannel: pnpm 11 shared store uses argv1 for the project", async () => {
  const root = tempDir();
  const input = inputAt(root, "home/Library/pnpm/store/v11/links/omt3@0.2.0/hash/node_modules/omt3/dist/cli.js");
  const project = join(root, "app");
  writeFile(join(project, "package.json"), '{"devDependencies":{"omt3":"0.2.0"}}');
  writeFile(join(project, "pnpm-lock.yaml"), "");
  input.argv1 = join(project, "node_modules/.bin/omt");
  const found = detectChannel(input);
  assert.equal(found.kind, "pnpm-global");
  const globalRoot = join(root, "home/Library/pnpm/global/v11");
  const link = join(globalRoot, "omt3/node_modules/omt3");
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(input.packageRoot, link);
  const run: RunCommand = async (argv) => {
    assert.deepEqual(argv, ["pnpm", "root", "-g"]);
    return { code: 0, stdout: `${globalRoot}\n` };
  };
  assert.equal(await confirmChannel(found, input, run), found);
  const fallback = await confirmChannel(found, input, async () => ({ code: 1, stdout: "" }));
  assert.equal(fallback.kind, "dev-dependency");
  assert.equal(fallback.projectRoot, project);
  assert.equal(fallback.packageManager, "pnpm");
  assert.equal(fallback.key, `dev:${project}`);
});

test("detectChannel: direct project dependency", () => {
  const root = tempDir();
  const input = inputAt(root, "app/node_modules/oh-my-t3/dist/cli.js");
  writeFile(join(input.packageRoot, "package.json"), '{"name":"oh-my-t3","version":"0.2.0"}');
  writeFile(join(root, "app/package.json"), '{"dependencies":{"oh-my-t3":"0.2.0"}}');
  writeFile(join(root, "app/bun.lock"), "");
  const found = detectChannel(input);
  assert.equal(found.kind, "dev-dependency");
  assert.equal(found.projectRoot, join(root, "app"));
  assert.equal(found.packageManager, "bun");
  assert.equal(found.packageName, "oh-my-t3");
  assert.equal(linksProjectCli(found, input.cliPath), true);
  const action = updateAction(found, "0.3.0");
  assert.equal(action.kind, "hint");
  if (action.kind === "hint") assert.match(action.text, /bun add -D oh-my-t3@0\.3\.0/);
});

test("newCliCommand: Bun uses the current runtime and bundle", async () => {
  const root = tempDir();
  const input = inputAt(root, "home/.bun/install/global/node_modules/omt3/dist/cli.js");
  const ctx = fakeContext({ root });
  assert.equal(ctx.runtimeName, "bun");
  const command = await newCliCommand(detectChannel(input), "0.2.0", async (argv) => {
    assert.deepEqual(argv, ["bun", "pm", "ls", "-g"]);
    return { code: 0, stdout: `${root}/home/.bun/install/global node_modules (96 installed)\n` };
  });
  assert.deepEqual(command, [ctx.runtimePath, input.cliPath]);
  assert.equal(command.some((arg) => arg.endsWith("/bin/omt")), false);
});

test("newCliCommand: pnpm 11 picks the folder with the target package version", async () => {
  const root = tempDir();
  const input = inputAt(root, "home/Library/pnpm/global/v11/omt3/node_modules/omt3/dist/cli.js");
  const found = detectChannel(input);
  assert.equal(found.kind, "pnpm-global");
  const globalRoot = join(root, "home/Library/pnpm/global/v11");
  const targetFolder = join(globalRoot, "z-updated/node_modules/omt3");
  writeFile(join(targetFolder, "package.json"), JSON.stringify({ name: "omt3", version: "0.3.0" }));
  writeFile(join(targetFolder, "dist/cli.js"), "");
  const command = await newCliCommand(found, "0.3.0", async (argv, opts) => {
    assert.deepEqual(argv, ["pnpm", "root", "-g"]);
    assert.deepEqual(opts, {});
    return { code: 0, stdout: `${globalRoot}\n` };
  });
  assert.deepEqual(command, [process.execPath, join(targetFolder, "dist/cli.js")]);
});

test("channel detection bounds malformed shim paths with repeated links segments", () => {
  const ctx = fakeContext({ root: tempDir() });
  const base: ChannelInput = { build: "bundle", cliPath: "/links".repeat(100_000), packageRoot: ctx.cwd, cwd: ctx.cwd, env: ctx.env };
  assert.equal(detectChannel(base).kind, "unknown");
  assert.equal(detectChannel({ ...base, cliPath: "/links".repeat(4000) + "/bad" }).kind, "unknown");
});
