import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import { runUpdate } from "../../src/update/flow.ts";
import type { UpdateOptions } from "../../src/update/flow.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

const CURRENT = "0.1.0";
const LATEST = "0.2.0";
const OPTIONS: UpdateOptions = { check: false, dryRun: false, yes: true, skillsOnly: false, project: false, json: true };

// One fake package manager for npm, pnpm, Bun, and mise. It logs each call, keeps the global packages as
// folders under FAKE_ROOT, and fails the install of each package named in FAKE_FAIL.
const FAKE_PM = `#!/bin/sh
tool=$(basename "$0")
echo "$tool $*" >> "$FAKE_LOG"
place() {
  mkdir -p "$1/dist"
  printf '{"name":"%s","version":"%s"}\\n' "$2" "$3" > "$1/package.json"
  cp "$FAKE_CLI" "$1/dist/cli.js"
}
fails() {
  for failing in $FAKE_FAIL; do [ "$failing" = "$1" ] && exit 1; done
}
case "$tool" in
  npm|pnpm|bun)
    case "$tool" in
      npm) dir="$FAKE_ROOT/npm/lib/node_modules" ;;
      pnpm) dir="$FAKE_ROOT/pnpm/global/5/node_modules" ;;
      bun) dir="$FAKE_ROOT/bun/.bun/install/global/node_modules" ;;
    esac
    case "$1" in
      root) echo "$dir"; exit 0 ;;
      pm) echo "$(dirname "$dir") node_modules (1 installed)"; exit 0 ;;
      install|add) spec=$3; name=\${spec%@*}; fails "$name"; place "$dir/$name" "$name" "\${spec##*@}"; exit 0 ;;
      uninstall|remove) rm -rf "$dir/$3"; exit 0 ;;
    esac ;;
  mise)
    case "$1" in
      use) spec=\${3#npm:}; name=\${spec%@*}; version=\${spec##*@}; fails "$name"
        place "$FAKE_ROOT/mise/installs/npm-$name/$version/lib/node_modules/$name" "$name" "$version"; exit 0 ;;
      exec) spec=\${2#npm:}; name=\${spec%@*}; version=\${spec##*@}; shift 4
        exec "$FAKE_RUNTIME" "$FAKE_ROOT/mise/installs/npm-$name/$version/lib/node_modules/$name/dist/cli.js" "$@" ;;
      unuse) rm -rf "$FAKE_ROOT/mise/installs/npm-\${3#npm:}"; exit 0 ;;
    esac ;;
esac
exit 2
`;

// The CLI of a fake package: it prints its version, an empty sync, and the defaults, and logs its own path.
const FAKE_CLI = `import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const file = fileURLToPath(import.meta.url);
const pkg = JSON.parse(readFileSync(join(dirname(dirname(file)), "package.json"), "utf8"));
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_LOG, "cli " + pkg.name + "@" + pkg.version + " " + args.join(" ") + "\\n");
if (args[0] === "--version") console.log(pkg.version);
else if (args[0] === "update") console.log(JSON.stringify({ scopes: [] }));
else if (args[0] === "config") process.stdout.write(readFileSync(process.env.FAKE_DEFAULTS, "utf8"));
else process.exit(9);
`;

type Kind = "npm" | "pnpm" | "bun" | "mise";

const FOLDERS: Readonly<Record<Kind, (name: string, version: string) => string>> = {
  npm: (name) => `npm/lib/node_modules/${name}`,
  pnpm: (name) => `pnpm/global/5/node_modules/${name}`,
  bun: (name) => `bun/.bun/install/global/node_modules/${name}`,
  mise: (name, version) => `mise/installs/npm-${name}/${version}/lib/node_modules/${name}`,
};

function fixture(kind: Kind, packageName: string, env: Record<string, string> = {}) {
  const root = tempDir("omt-switch-");
  const bin = join(root, "bin");
  writeFile(join(bin, "fake-pm"), FAKE_PM);
  chmodSync(join(bin, "fake-pm"), 0o755);
  for (const tool of ["npm", "pnpm", "bun", "mise"]) symlinkSync(join(bin, "fake-pm"), join(bin, tool));
  writeFile(join(root, "cli.js"), FAKE_CLI);
  writeFile(join(root, "defaults.json"), JSON.stringify(DEFAULT_CONFIG));
  const folder = (name: string, version = LATEST) => join(root, FOLDERS[kind](name, version));
  const packageRoot = folder(packageName, CURRENT);
  writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version: CURRENT }));
  writeFile(join(packageRoot, "dist", "cli.js"), FAKE_CLI);
  const log = join(root, "log");
  writeFile(log, "");
  const ctx = fakeContext({
    root,
    build: "bundle",
    cliPath: join(packageRoot, "dist", "cli.js"),
    packageRoot,
    version: CURRENT,
    env: {
      HOME: join(root, "home"),
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_ROOT: root,
      FAKE_LOG: log,
      FAKE_CLI: join(root, "cli.js"),
      FAKE_DEFAULTS: join(root, "defaults.json"),
      FAKE_RUNTIME: process.execPath,
      ...env,
    },
  });
  // The calls that change or run a package; the root queries only find folders.
  const calls = () => readFileSync(log, "utf8").split("\n").filter((line) => line !== "" && !/^(npm root|pnpm root|bun pm) /.test(line));
  const update = (options: Partial<UpdateOptions> = {}) => runUpdate(ctx, { ...OPTIONS, ...options }, { latest: LATEST });
  return { ctx, folder, calls, update, oldFolder: packageRoot };
}

function version(folder: string): string | undefined {
  const file = join(folder, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).version : undefined;
}

const CASES: { kind: Kind; commands: string[]; calls: string[] }[] = [
  {
    kind: "npm",
    commands: ["npm uninstall -g oh-my-t3code", `npm install -g oh-my-t3@${LATEST}`],
    calls: ["npm uninstall -g oh-my-t3code", `npm install -g oh-my-t3@${LATEST}`, `cli oh-my-t3@${LATEST} --version`],
  },
  {
    kind: "pnpm",
    commands: ["pnpm remove -g oh-my-t3code", `pnpm add -g oh-my-t3@${LATEST}`],
    calls: ["pnpm remove -g oh-my-t3code", `pnpm add -g oh-my-t3@${LATEST}`, `cli oh-my-t3@${LATEST} --version`],
  },
  {
    kind: "bun",
    commands: [`bun add -g oh-my-t3@${LATEST}`, "bun remove -g oh-my-t3code"],
    calls: [`bun add -g oh-my-t3@${LATEST}`, `cli oh-my-t3@${LATEST} --version`, "bun remove -g oh-my-t3code"],
  },
  {
    kind: "mise",
    commands: [
      `mise use -g npm:oh-my-t3@${LATEST} (writes npm:oh-my-t3@${LATEST} into your global mise config)`,
      "mise unuse -g npm:oh-my-t3code (removes npm:oh-my-t3code from your global mise config)",
    ],
    calls: [
      `mise use -g npm:oh-my-t3@${LATEST}`,
      `mise exec npm:oh-my-t3@${LATEST} -- omt --version`,
      `cli oh-my-t3@${LATEST} --version`,
      "mise unuse -g npm:oh-my-t3code",
    ],
  },
];

for (const { kind, commands, calls } of CASES) {
  test(`${kind}: oh-my-t3code switches to oh-my-t3; dry run and --check show it and change nothing`, async () => {
    const s = fixture(kind, "oh-my-t3code");
    assert.equal(await s.update({ dryRun: true, yes: false }), 0);
    assert.deepEqual(JSON.parse(s.ctx.out()).switch, { from: "oh-my-t3code", to: "oh-my-t3", commands });
    assert.match(s.ctx.err(), /switch: oh-my-t3code -> oh-my-t3 \(oh-my-t3code is deprecated\)/);
    for (const command of commands) assert.ok(s.ctx.err().includes(`run: ${command}\n`), `the dry run must show ${command}`);
    const check = fixture(kind, "oh-my-t3code");
    assert.equal(await check.update({ check: true, yes: false }), 0);
    assert.deepEqual(JSON.parse(check.ctx.out()).switch, { from: "oh-my-t3code", to: "oh-my-t3", commands });
    assert.deepEqual([...s.calls(), ...check.calls()], [], "the dry run and --check must run no manager command");

    const run = fixture(kind, "oh-my-t3code");
    assert.equal(await run.update(), 0, run.ctx.err());
    // A remove-first manager loses the old package before the install; an install-first one keeps it until the
    // new CLI prints its version.
    assert.deepEqual(run.calls().slice(0, calls.length), calls);
    assert.ok(run.calls().slice(calls.length).includes(`cli oh-my-t3@${LATEST} update --skills-only --yes --json`), "the new CLI must sync the skills");
    assert.equal(existsSync(run.oldFolder), false, "the old package must be gone");
    assert.equal(version(run.folder("oh-my-t3")), LATEST);
    const report = JSON.parse(run.ctx.out());
    assert.equal(report.updated, true);
    assert.equal(report.channel.package, "oh-my-t3code");
    assert.deepEqual(report.switch.commands, commands);
  });
}

test("npm: a failed install of oh-my-t3 reinstalls oh-my-t3code", async () => {
  const s = fixture("npm", "oh-my-t3code", { FAKE_FAIL: "oh-my-t3" });
  await assert.rejects(s.update(), /npm install -g oh-my-t3@0\.2\.0 exited 1; omt reinstalled oh-my-t3code with npm install -g oh-my-t3code@0\.1\.0/);
  assert.deepEqual(s.calls(), ["npm uninstall -g oh-my-t3code", `npm install -g oh-my-t3@${LATEST}`, `npm install -g oh-my-t3code@${CURRENT}`]);
  assert.equal(version(s.folder("oh-my-t3code")), CURRENT);
  assert.equal(existsSync(s.folder("oh-my-t3")), false);
});

test("npm: when the restore fails too, the error names the command that restores the old install", async () => {
  const s = fixture("npm", "oh-my-t3code", { FAKE_FAIL: "oh-my-t3 oh-my-t3code" });
  await assert.rejects(s.update(), (error: Error & { hint?: string }) => {
    assert.match(error.message, /npm install -g oh-my-t3code@0\.1\.0 exited 1; omt is not installed now/);
    assert.equal(error.hint, "run npm install -g oh-my-t3code@0.1.0 to restore the old install");
    return true;
  });
});

test("bun: a failed install of oh-my-t3 leaves oh-my-t3code in place and removes nothing", async () => {
  const s = fixture("bun", "oh-my-t3code", { FAKE_FAIL: "oh-my-t3" });
  await assert.rejects(s.update(), /bun add -g oh-my-t3@0\.2\.0 exited 1/);
  assert.deepEqual(s.calls(), [`bun add -g oh-my-t3@${LATEST}`]);
  assert.equal(version(s.oldFolder), CURRENT);
});

test("npm: an oh-my-t3 install updates in place with no switch", async () => {
  const s = fixture("npm", "oh-my-t3");
  assert.equal(await s.update(), 0, s.ctx.err());
  assert.deepEqual(s.calls().slice(0, 2), [`npm install -g oh-my-t3@${LATEST}`, `cli oh-my-t3@${LATEST} --version`]);
  assert.equal(s.calls().some((line) => line.includes("uninstall")), false);
  const report = JSON.parse(s.ctx.out());
  assert.equal(report.switch, null);
  assert.equal(report.command, `npm install -g oh-my-t3@${LATEST}`);
  assert.equal(version(s.folder("oh-my-t3")), LATEST);
});

for (const { manager, lockfile, commands, exec } of [
  { manager: "npm", lockfile: "package-lock.json", commands: "npm uninstall oh-my-t3code, then npm i -D oh-my-t3@0.2.0", exec: "npx omt" },
  { manager: "pnpm", lockfile: "pnpm-lock.yaml", commands: "pnpm add -D oh-my-t3@0.2.0, then pnpm remove oh-my-t3code", exec: "pnpm exec omt" },
]) {
  test(`dev dependency with ${manager}: the hint names the remove and add commands, then the skills sync`, async () => {
    const root = tempDir("omt-switch-dev-");
    const app = join(root, "app");
    writeFile(join(app, "package.json"), JSON.stringify({ devDependencies: { "oh-my-t3code": CURRENT } }));
    writeFile(join(app, lockfile), "");
    const packageRoot = join(app, "node_modules", "oh-my-t3code");
    writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "oh-my-t3code", version: CURRENT }));
    writeFile(join(packageRoot, "dist", "cli.js"), FAKE_CLI);
    const log = join(root, "log");
    writeFile(log, "");
    const ctx = fakeContext({
      root,
      cwd: app,
      build: "bundle",
      cliPath: join(packageRoot, "dist", "cli.js"),
      packageRoot,
      version: CURRENT,
      env: { HOME: join(root, "home"), PATH: "/usr/bin:/bin", FAKE_LOG: log, FAKE_DEFAULTS: join(root, "defaults.json") },
    });
    writeFile(join(root, "defaults.json"), JSON.stringify(DEFAULT_CONFIG));
    assert.equal(await runUpdate(ctx, OPTIONS, { latest: LATEST }), 0, ctx.err());
    const report = JSON.parse(ctx.out());
    assert.equal(report.action, "hint");
    assert.equal(report.hint, `run ${commands} in ${app}, then run ${exec} update --skills-only --project there`);
    assert.deepEqual(report.switch, { from: "oh-my-t3code", to: "oh-my-t3", commands: commands.split(", then ") });
    assert.deepEqual(readFileSync(log, "utf8").split("\n").filter((line) => !line.startsWith("cli ") && line !== ""), [], "omt runs nothing in the project");
    assert.equal(version(packageRoot), CURRENT);
  });
}
