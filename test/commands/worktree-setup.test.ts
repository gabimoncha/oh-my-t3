import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { CLI_PATH, NODE, PACKAGE_ROOT, childEnv, gitRepo, tempDir, writeFile } from "../helpers.ts";

function fixture(manager = "pnpm", version: string | undefined = "12.13.0", lock = "pnpm-lock.yaml") {
  const root = tempDir("omt-setup-");
  const project = join(root, "project");
  const git = gitRepo(root, project, {
    "package.json": JSON.stringify(version === undefined ? {} : { packageManager: `${manager}@${version}` }),
    [lock]: "",
  });
  const env = childEnv(root);
  for (const key of Object.keys(env)) {
    if (/^(OMT_|XDG_|CLAUDE_|T3CODE_)/.test(key)) env[key] = join(root, "environment", key);
    if (/^(npm_config_|pnpm_config_|BUN_|COREPACK_|CI$)/i.test(key)) delete env[key];
  }
  env.OMT_CONFIG_DIR = join(root, "home", ".config", "omt");
  env.XDG_CONFIG_HOME = join(root, "home", ".config");
  env.CLAUDE_CONFIG_DIR = join(root, "home", ".claude");
  env.T3CODE_HOME = join(root, "home", ".t3");
  mkdirSync(env.HOME!, { recursive: true });
  const bin = join(root, "bin");
  mkdirSync(bin);
  env.PATH = bin;
  const run = (file: string, args: string[], cwd = project) => {
    const result = spawnSync(file, args, { cwd, env, encoding: "utf8", timeout: 30_000 });
    assert.ifError(result.error);
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
  const cli = (args: string[], cwd = project) => run(process.execPath, [CLI_PATH, ...args], cwd);
  const setup = (dry = false) => cli(["worktree", "setup", dry ? "--dry-run" : "--yes"]);
  // T3 starts the generated runner with `node`, the command in t3.json.
  const runner = () => run(NODE, [join(project, ".t3", "omt-worktree-setup.mjs")], root);
  const record = join(root, "calls.jsonl");
  const tool = (actual = version ?? "12.13.0", exit = 0, query = "isolated", queryExit = 0) => {
    const path = join(bin, manager);
    writeFile(path, `#!${process.execPath}\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: process.cwd(), env: process.env }) + "\\n");\nif (args[0] === "--version") console.log(${JSON.stringify(actual)});\nelse if (args[0] === "config") { console.log(${JSON.stringify(query)}); process.exitCode = ${queryExit}; }\nelse process.exitCode = ${exit};\n`);
    chmodSync(path, 0o755);
  };
  const calls = (): { args: string[]; cwd: string; env: Record<string, string> }[] => existsSync(record)
    ? readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { root, project, git, env, cli, setup, runner, tool, calls, run };
}

function ok(result: { code: number | null; out: string; err: string }) {
  assert.equal(result.code, 0, result.out + result.err);
  return result;
}

function bytes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(path: string, rel = "") {
    for (const name of readdirSync(path)) {
      if (name === ".git") continue;
      const key = join(rel, name);
      const full = join(path, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) result[key] = `link:${realpathSync(full)}`;
      else if (stat.isDirectory()) { result[key] = "directory"; walk(full, key); }
      else result[key] = readFileSync(full).toString("base64");
    }
  }
  walk(root);
  return result;
}

// e2e U1: pnpm init, install dry run, setup, check, and doctor in a linked checkout.
test("U1 pnpm linked checkout keeps shared state and local setup files", () => {
  const f = fixture();
  const linked = join(f.root, "linked");
  f.git(["worktree", "add", "-q", linked]);
  ok(f.cli(["init"], linked));
  assert.ok(existsSync(join(f.project, ".omt3", "config.jsonc")));
  assert.ok(!existsSync(join(linked, ".omt3")));
  const before = bytes(linked);
  assert.match(ok(f.cli(["install", "--project", "--dry-run"], linked)).out, /Dry run: nothing was written/);
  assert.deepEqual(bytes(linked), before);
  assert.match(ok(f.cli(["worktree", "setup", "--dry-run"], linked)).out, /Dry run: nothing was written/);
  assert.deepEqual(bytes(linked), before);
  ok(f.cli(["worktree", "setup", "--yes"], linked));
  assert.equal(readFileSync(join(linked, "pnpm-workspace.yaml"), "utf8"), "enableGlobalVirtualStore: true\n");
  assert.equal(readFileSync(join(linked, ".t3", "omt-worktree-setup.mjs"), "utf8"), readFileSync(join(PACKAGE_ROOT, "templates", "worktree-setup.mjs"), "utf8"));
  assert.equal(JSON.parse(readFileSync(join(linked, "t3.json"), "utf8")).scripts[0].async, false);
  for (const name of ["t3.json", ".t3", "pnpm-workspace.yaml"]) assert.ok(!existsSync(join(f.project, name)), name);
  const report = JSON.parse(ok(f.cli(["worktree", "check", "--json"], linked)).out);
  assert.equal(realpathSync(report.root), realpathSync(linked));
  assert.equal(realpathSync(report.mainCheckout), realpathSync(f.project));
  assert.equal(report.complete, true);
  assert.equal(report.summary.status, "PASS");
  assert.match(report.activation, /import Setup in T3 Project Settings/);
  assert.match(ok(f.cli(["doctor", "--project"], linked)).out, /PASS\s+worktree/);
  const applied = bytes(linked);
  assert.match(ok(f.cli(["worktree", "setup", "--yes"], linked)).out, /Everything is up to date/);
  assert.deepEqual(bytes(linked), applied);
  assert.ok(!existsSync(join(linked, ".omt3")));
});

// e2e U1: Bun generation and the standalone runner with a controlled executable.
test("U1 Bun generated runner installs frozen dependencies in its own checkout", () => {
  const f = fixture("bun", "1.4.4", "bun.lock");
  ok(f.setup());
  f.tool();
  assert.match(ok(f.runner()).out, /dependencies installed/);
  const install = f.calls().at(-1)!;
  assert.deepEqual(install.args, ["install", "--linker", "isolated", "--frozen-lockfile"]);
  assert.equal(realpathSync(install.cwd), realpathSync(f.project));
  assert.equal(install.env.BUN_INSTALL_GLOBAL_STORE, "1");
  assert.equal(install.env.COREPACK_ENABLE_NETWORK, "0");
  assert.ok(!existsSync(join(f.project, "pnpm-workspace.yaml")));
});

test("U2 repository setup blocks until its current manager finishes and adapts to a manager change", () => {
  const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, "t3.json"), "utf8"));
  const setup = config.scripts.find((script: { runOnWorktreeCreate?: boolean }) => script.runOnWorktreeCreate === true);
  assert.ok(setup, "repository selects a worktree setup script");
  assert.equal(setup.runOnWorktreeCreate, true);
  assert.equal(setup.async, false, "repository setup waits for completion");
  assert.equal(setup.command, "node .t3/omt-worktree-setup.mjs", "repository setup runs the managed command");
  const runner = readFileSync(join(PACKAGE_ROOT, ".t3", "omt-worktree-setup.mjs"), "utf8");
  assert.equal(runner, readFileSync(join(PACKAGE_ROOT, "templates", "worktree-setup.mjs"), "utf8"), "repository runner matches the generator bytes");

  const manifest = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(manifest);
  const locks = { pnpm: ["pnpm-lock.yaml"], bun: ["bun.lock", "bun.lockb"] };
  const present = Object.entries(locks).filter(([, files]) => files.some((file) => existsSync(join(PACKAGE_ROOT, file))));
  const engines = pkg.devEngines?.packageManager;
  const engine = Array.isArray(engines) ? engines[0] : engines;
  const pin = typeof pkg.packageManager === "string" ? /^(pnpm|bun)@([^+]+)(?:\+.*)?$/.exec(pkg.packageManager) : undefined;
  const expected: unknown = pin?.[1] ?? engine?.name ?? (present.length === 1 ? present[0]![0] : undefined);
  assert.ok(expected === "pnpm" || expected === "bun", "current manifest and lockfiles select a supported manager");
  assert.ok(locks[expected].some((file) => existsSync(join(PACKAGE_ROOT, file))), "current manager has a lockfile");
  const versions: Record<string, string> = { pnpm: "12.13.0", bun: "1.4.4" };
  versions[expected] = pin?.[2] ?? engine?.version ?? versions[expected]!;
  const f = fixture(expected, versions[expected], locks[expected][0]);
  writeFile(join(f.project, "package.json"), manifest);
  for (const file of Object.values(locks).flat()) {
    rmSync(join(f.project, file), { force: true });
    if (existsSync(join(PACKAGE_ROOT, file))) copyFileSync(join(PACKAGE_ROOT, file), join(f.project, file));
  }
  for (const file of ["pnpm-workspace.yaml", ".npmrc", "bunfig.toml"]) {
    if (existsSync(join(PACKAGE_ROOT, file))) writeFile(join(f.project, file), readFileSync(join(PACKAGE_ROOT, file), "utf8"));
  }
  writeFile(join(f.project, ".t3", "omt-worktree-setup.mjs"), runner);
  const record = join(f.root, "managers.jsonl");
  for (const manager of ["pnpm", "bun"]) {
    const executable = join(f.env.PATH!, manager);
    writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ manager: ${JSON.stringify(manager)}, args, cwd: process.cwd() }) + "\\n");
if (args[0] === "--version") console.log(${JSON.stringify(versions[manager])});
else if (args[0] === "config") console.log("isolated");
`);
    chmodSync(executable, 0o755);
  }
  const check = (manager: string) => {
    rmSync(record, { force: true });
    assert.match(ok(f.runner()).out, /dependencies installed/);
    const calls: { manager: string; args: string[]; cwd: string }[] = readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(calls.length > 0);
    assert.deepEqual([...new Set(calls.map((call) => call.manager))], [manager], "runner selects the manager from checkout inputs");
    assert.deepEqual(calls[0]!.args, ["--version"]);
    assert.equal(calls.at(-1)!.args[0], "install");
    assert.ok(calls.at(-1)!.args.includes("--frozen-lockfile"));
    for (const call of calls) assert.equal(realpathSync(call.cwd), realpathSync(f.project));
  };
  check(expected);
  const migrated = expected === "pnpm" ? "bun" : "pnpm";
  for (const file of Object.values(locks).flat()) rmSync(join(f.project, file), { force: true });
  writeFile(join(f.project, "package.json"), JSON.stringify({
    ...pkg,
    packageManager: `${migrated}@${versions[migrated]}`,
    devEngines: { ...pkg.devEngines, packageManager: { name: migrated, version: versions[migrated] } },
  }));
  writeFile(join(f.project, locks[migrated][0]!), "");
  if (migrated === "pnpm") writeFile(join(f.project, "pnpm-workspace.yaml"), "enableGlobalVirtualStore: true\n");
  check(migrated);
  assert.equal(readFileSync(join(f.project, ".t3", "omt-worktree-setup.mjs"), "utf8"), runner);
});

// integration U1: Bun lockfiles, versions, environment, frozen arguments, and failures.
test("U1 Bun runner validates lockfiles and versions and propagates install failures", () => {
  for (const lock of ["bun.lock", "bun.lockb"]) {
    const f = fixture("bun", undefined, lock);
    writeFile(join(f.project, "package.json"), "{}");
    ok(f.setup());
    f.tool("1.4.4");
    ok(f.runner());
    assert.deepEqual(f.calls().at(-1)!.args, ["install", "--linker", "isolated", "--frozen-lockfile"]);
    for (const call of f.calls()) assert.equal(call.env.COREPACK_ENABLE_NETWORK, "0");
    assert.equal(f.calls().at(-1)!.env.BUN_INSTALL_GLOBAL_STORE, "1");
    f.tool("1.3.13");
    const old = f.runner();
    assert.equal(old.code, 1);
    assert.match(old.err, /needs bun 1\.4\.4 or later/);
    f.tool("1.4.4", 7);
    assert.equal(f.runner().code, 7);
    writeFile(join(f.project, "package.json"), '{"packageManager":"bun@1.4.4"}');
    f.tool("1.4.5");
    assert.match(f.runner().err, /pins bun 1\.4\.4, but bun 1\.4\.5/);
    writeFile(join(f.project, "bunfig.toml"), '[install]\nlinker = "hoisted"\n');
    const count = f.calls().length;
    assert.match(f.runner().err, /hoisted/);
    assert.equal(f.calls().length, count);
  }
  const missing = fixture("bun", "1.4.4", "unrelated.lock");
  assert.equal(missing.setup().code, 1);
  assert.match(missing.setup().err, /bun.lock or bun.lockb is missing/);
});

// integration U1: configuration, refusals, byte preservation, and dry runs.
test("U1 setup preserves configuration and refuses unsafe or unsupported inputs", () => {
  const managed = '{ // keep comments\n "unknown": 1, "scripts": [{"name":"Setup","command":"node .t3/omt-worktree-setup.mjs","runOnWorktreeCreate":true,"async":false}]\n}\n';
  for (const [content, code, diagnostic] of [
    [managed, 0, /created/],
    ['{// custom\n"scripts":[{"name":"Mine","command":"echo mine","runOnWorktreeCreate":true,"async":false}]}\n', 0, /custom setup/],
    ['{"scripts":[{"name":"Test","command":"echo test"}]}\n', 1, /add this script/],
    ['{"scripts": [}', 1, /not valid JSONC/],
    ['{"scripts":[{"name":"Bad","command":"x","async":"false"}]}', 1, /async must be true or false/],
  ] as const) {
    const f = fixture();
    writeFile(join(f.project, "t3.json"), content);
    const before = bytes(f.project);
    const dry = f.setup(true);
    assert.equal(dry.code, code, dry.err);
    assert.deepEqual(bytes(f.project), before);
    const applied = f.setup();
    assert.equal(applied.code, code, applied.err);
    assert.match(applied.out + applied.err, diagnostic);
    assert.equal(readFileSync(join(f.project, "t3.json"), "utf8"), content);
    if (code !== 0) assert.deepEqual(bytes(f.project), before);
  }
  for (const [pkg, lock, diagnostic] of [
    [{}, "bun.lock", /both .*exist/],
    [{ packageManager: "npm@11.0.0" }, "package-lock.json", /supports only Bun and pnpm/],
    [{ packageManager: "pnpm@^12.0.0" }, "pnpm-lock.yaml", /not an exact version/],
    [{ packageManager: "pnpm@10.12.0" }, "pnpm-lock.yaml", /needs pnpm 10.34.5/],
    [{ packageManager: "pnpm@10.34.4" }, "pnpm-lock.yaml", /needs pnpm 10.34.5/],
    [{ packageManager: "pnpm@11.10.0" }, "pnpm-lock.yaml", /needs pnpm 11.11.0/],
    [{ packageManager: "bun@1.4.3" }, "bun.lock", /needs bun 1.4.4/],
  ] as const) {
    const f = fixture();
    writeFile(join(f.project, "package.json"), JSON.stringify(pkg));
    writeFile(join(f.project, lock), "");
    const before = bytes(f.project);
    const result = f.setup();
    assert.equal(result.code, 1);
    assert.match(result.err, diagnostic);
    assert.deepEqual(bytes(f.project), before);
  }
  for (const conflict of ["runner", "folder", "symlink", "config-read"]) {
    const f = fixture();
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    if (conflict === "runner") writeFile(join(f.project, ".t3", "omt-worktree-setup.mjs"), "edited\n");
    if (conflict === "folder") writeFile(join(f.project, ".t3"), "occupied\n");
    if (conflict === "symlink") symlinkSync(outside, join(f.project, ".t3"));
    if (conflict === "config-read") mkdirSync(join(f.project, ".npmrc"));
    const before = bytes(f.project);
    for (const dry of [true, false]) {
      const result = f.setup(dry);
      assert.equal(result.code, 1, conflict);
      assert.match(result.err, /differs|not a folder|symlink|cannot read/);
      assert.deepEqual(bytes(f.project), before);
      assert.deepEqual(readdirSync(outside), []);
    }
  }
  for (const [version, workspace, status] of [
    ["12.13.0", "enableGlobalVirtualStore: true\n", "set"],
    ["12.13.0", "virtualStoreType: global\n", "set"],
    ["10.34.5", "virtualStoreType: global\n", "missing"],
    ["12.13.0", "virtualStoreType: project\nenableGlobalVirtualStore: true\n", "off"],
    ["10.34.5", "virtualStoreType: project\nenableGlobalVirtualStore: true\n", "set"],
    [undefined, "virtualStoreType: global\n", "version-dependent"],
    [undefined, "virtualStoreType: project\n", "off"],
    ["12.13.0", "enableGlobalVirtualStore: false\n", "off"],
    ["12.13.0", "packages:\n  - packages/*\n", "missing"],
  ] as const) {
    const f = fixture("pnpm", version);
    // An omitted version selects the lockfile without a packageManager pin.
    if (version === undefined) writeFile(join(f.project, "package.json"), "{}");
    writeFile(join(f.project, "pnpm-workspace.yaml"), workspace);
    const report = JSON.parse(ok(f.cli(["worktree", "check", "--json"])).out);
    assert.equal(report.store.status, status);
    const before = bytes(f.project);
    ok(f.setup(true));
    assert.deepEqual(bytes(f.project), before);
    const result = f.setup();
    assert.equal(result.code, status === "set" ? 0 : 1, result.out + result.err);
    assert.equal(readFileSync(join(f.project, "pnpm-workspace.yaml"), "utf8"), workspace);
    if (status !== "set") {
      assert.match(result.out, /Setup is incomplete/);
      assert.match(result.out, /enableGlobalVirtualStore: true|pin an exact pnpm version/);
      const again = f.setup(true);
      ok(again);
      assert.match(again.out, /Dry run: nothing was written/);
      assert.equal(f.setup().code, 1);
    }
  }
});

// integration U1: pnpm runner processes and Windows command construction.
test("U1 pnpm runner selects version flags and handles process and configuration failures", () => {
  for (const version of ["10.34.5", "11.11.0", "11.23.0", "12.13.0"]) {
    const f = fixture("pnpm", version);
    ok(f.setup());
    f.tool();
    f.env.CI = "1";
    const result = ok(f.runner());
    const install = f.calls().at(-1)!;
    assert.deepEqual(install.args, ["install", "--frozen-lockfile", "--config.node-linker=isolated",
      version === "10.34.5" || version === "11.11.0" ? "--config.enable-global-virtual-store=true" : "--config.virtual-store-type=global",
      ...(version === "10.34.5" ? ["--config.manage-package-manager-versions=false", "--config.package-manager-strict-version=true"] : ["--pm-on-fail=error"])]);
    for (const call of f.calls()) {
      assert.equal(call.env.COREPACK_ENABLE_NETWORK, "0");
      assert.equal(call.env.npm_config_manage_package_manager_versions, "false");
      assert.equal(call.env.npm_config_package_manager_strict_version, "true");
      assert.equal(call.env.pnpm_config_pm_on_fail, "error");
    }
    if (version === "10.34.5" || version === "11.11.0") assert.match(result.err, /can turn off the global virtual store when CI is set/);
    else assert.equal(result.err, "");
    f.tool(version, 5);
    const failed = f.runner();
    assert.equal(failed.code, 5);
    assert.match(failed.err, /install failed \(exit code 5\)/);
    f.tool("10.12.0");
    assert.match(f.runner().err, /needs pnpm 10.34.5/);
    f.tool("12.12.0");
    assert.match(f.runner().err, /pins pnpm .*but pnpm 12.12.0/);
    f.tool(version, 0, "broken", 9);
    assert.match(f.runner().err, /config get node-linker failed/);
    f.tool(version, 0, "hoisted");
    assert.match(f.runner().err, /effective pnpm config selects the hoisted linker/);
  }
  const missing = fixture();
  ok(missing.setup());
  assert.equal(missing.runner().code, 1);
  assert.match(missing.runner().err, /not found on PATH/);
  for (const version of ["11.0.0", "11.23.0"]) {
    const f = fixture();
    writeFile(join(f.project, "package.json"), "{}");
    writeFile(join(f.project, "pnpm-workspace.yaml"), "virtualStoreType: global\n");
    assert.equal(f.setup().code, 1);
    f.tool(version);
    assert.equal(f.runner().code, version === "11.23.0" ? 0 : 1);
    if (version === "11.0.0") assert.ok(f.calls().every((call) => call.args[0] !== "install"));
  }
  const f = fixture();
  ok(f.setup());
  const script = join(f.root, "windows.mjs");
  writeFile(script, `import assert from "node:assert/strict";
import { launchSpec } from ${JSON.stringify(`file://${join(f.project, ".t3", "omt-worktree-setup.mjs")}`)};
const args = ["install", "--frozen-lockfile"];
const env = { Path: "C:\\\\Program Files\\\\pnpm", ComSpec: "C:\\\\Windows\\\\cmd.exe" };
const cmd = launchSpec("pnpm", args, { platform: "win32", env, exists: p => p.endsWith(".cmd") });
assert.equal(cmd.file, env.ComSpec);
assert.deepEqual(cmd.args, ["/d", "/s", "/c", '\\"\\"C:\\\\Program Files\\\\pnpm\\\\pnpm.cmd\\" install --frozen-lockfile\\"']);
assert.equal(cmd.options.windowsVerbatimArguments, true);
const exe = launchSpec("pnpm", args, { platform: "win32", env, exists: p => p.endsWith(".exe") });
assert.ok(exe.file.endsWith("pnpm.exe"));
assert.deepEqual(exe.args, args);
assert.throws(() => launchSpec("pnpm", args, { platform: "win32", env, exists: () => false }), /not found on PATH/);
for (const bad of ['%', '!', '^', '\\"', '\\n']) assert.throws(() => launchSpec("pnpm", args, { platform: "win32", env: { PATH: 'C:\\\\' + bad }, exists: p => p.endsWith(".cmd") }), /unsafe path|unsafe argument/);
assert.throws(() => launchSpec("pnpm", ["bad%arg"], { platform: "win32", env }), /unsafe argument/);
console.log("Windows command assertions passed");
`);
  assert.match(ok(f.run(process.execPath, [script])).out, /Windows command assertions passed/);
});

test("worktree runner rejects vulnerable unpinned package managers before install", () => {
  for (const [manager, version, minimum, lock] of [
    ["pnpm", "10.34.4", "10.34.5", "pnpm-lock.yaml"],
    ["pnpm", "11.10.0", "11.11.0", "pnpm-lock.yaml"],
    ["bun", "1.4.3", "1.4.4", "bun.lock"],
  ]) {
    const f = fixture(manager, undefined, lock);
    writeFile(join(f.project, "package.json"), "{}");
    ok(f.setup());
    f.tool(version);
    const result = f.runner();
    assert.equal(result.code, 1);
    assert.ok(result.err.includes(`needs ${manager} ${minimum}`), result.err);
    assert.deepEqual(f.calls().map(call => call.args), [["--version"]]);
  }
});

test("worktree linker inspection bounds long malformed assignment lines", () => {
  for (const [manager, lock, file] of [["pnpm", "pnpm-lock.yaml", ".npmrc"], ["bun", "bun.lock", "bunfig.toml"]]) {
    const f = fixture(manager, manager === "bun" ? "1.4.4" : "12.13.0", lock);
    writeFile(join(f.project, file!), "x" + " ".repeat(100_000) + "x");
    const source = `import { checkLinker } from ${JSON.stringify(`file://${join(PACKAGE_ROOT, "templates", "worktree-setup.mjs")}`)};
console.log(JSON.stringify(checkLinker(${JSON.stringify(f.project)}, ${JSON.stringify(manager)}, { env: {}, home: ${JSON.stringify(f.env.HOME)} })));`;
    const result = ok(f.run(NODE, ["--input-type=module", "-e", source]));
    assert.equal(JSON.parse(result.out).status, "unverified");
    assert.deepEqual(f.calls(), []);
  }
});

test("Bun linker inspection ignores registry URLs and still rejects inline install tables", () => {
  const f = fixture("bun", "1.4.4", "bun.lock");
  const source = `import { checkLinker } from ${JSON.stringify(`file://${join(PACKAGE_ROOT, "templates", "worktree-setup.mjs")}`)};
console.log(JSON.stringify(checkLinker(${JSON.stringify(f.project)}, "bun", { env: {}, home: ${JSON.stringify(f.env.HOME)} })));`;
  for (const [text, status] of [
    ['[install]\nregistry = "https://mirror.example/linker"\nlinker = "isolated"\n', "isolated"],
    ['[install]\nregistry = "https://mirror.example/linker"\n', "default"],
    ['[install]\nregistry = "https://mirror.example/linker"\nlinker = "hoisted"\n', "incompatible"],
    ['install = { linker = "hoisted" }\n', "unverified"],
  ] as const) {
    writeFile(join(f.project, "bunfig.toml"), text);
    const result = ok(f.run(NODE, ["--input-type=module", "-e", source]));
    assert.equal(JSON.parse(result.out).status, status, text);
  }
});
