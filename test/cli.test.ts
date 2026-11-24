import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import assert from "node:assert/strict";
import { main } from "../src/main.ts";
import { PACKAGE_ROOT, fakeContext, spawnOmt, tempDir } from "./helpers.ts";

const COMMAND_NAMES = [
  "install",
  "uninstall",
  "doctor",
  "init",
  "config",
  "roles",
  "route",
  "brief",
  "plan",
  "profile",
];

// These commands are gone; an old skill that still calls one gets the unknown-command usage error.
const RETIRED_COMMANDS = ["ledger", "lock", "hook", "migrate"];

test("the retired ledger, lock, hook, and migrate commands are unknown and exit 2", async () => {
  for (const name of RETIRED_COMMANDS) {
    const ctx = fakeContext({ root: tempDir() });
    assert.equal(await main([name], ctx), 2, name);
    assert.match(ctx.err(), new RegExp(`unknown command "${name}"`), name);
  }
});

function runCli(args: string[]) {
  const root = tempDir();
  return spawnOmt(args, { root });
}

test("--help lists every command and exits 0", () => {
  const result = runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage: omt <command>/);
  for (const name of COMMAND_NAMES) {
    assert.match(result.stdout, new RegExp(`^  ${name} `, "m"));
  }
});

test("help and help config match --help and config -h", () => {
  const cases: [string[], string[]][] = [
    [["help"], ["--help"]],
    [["help", "config"], ["config", "-h"]],
  ];
  for (const [alias, flags] of cases) {
    const expected = runCli(flags);
    const actual = runCli(alias);
    assert.equal(expected.code, 0);
    assert.equal(actual.code, 0);
    assert.equal(actual.stdout, expected.stdout);
    assert.equal(actual.stderr, expected.stderr);
  }
});

test("no command prints the command list", () => {
  const result = runCli([]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Commands:/);
});

test("--version prints the package.json version", () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };
  const result = runCli(["--version"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${pkg.version}\n`);
});

test("an unknown command is a usage error with exit 2", () => {
  const result = runCli(["nope"]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^omt: unknown command "nope"\nhint: /);
});

test("help with an unknown command is a usage error with exit 2", () => {
  const result = runCli(["help", "nope"]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `omt: unknown command "nope"\nhint: run "omt --help" to see the commands\n`);
});

test("an unknown global option is a usage error with exit 2", () => {
  const result = runCli(["--nope"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^omt: unknown option "--nope"/);
});

test("install --help prints the install usage and exits 0", () => {
  const result = runCli(["install", "--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Usage: omt install /);
  assert.match(result.stdout, /--dry-run/);
});

test("every command accepts -h", async () => {
  for (const name of COMMAND_NAMES) {
    const ctx = fakeContext({ root: tempDir() });
    assert.equal(await main([name, "-h"], ctx), 0, name);
    assert.match(ctx.out(), new RegExp(`^Usage: omt ${name}`), name);
  }
});

test("an OmtError prints omt: <message> and returns its exit code", async () => {
  const ctx = fakeContext({ root: tempDir() });
  const code = await main(["nope"], ctx);
  assert.equal(code, 2);
  assert.equal(ctx.err(), `omt: unknown command "nope"\nhint: run "omt --help" to see the commands\n`);
});

test("an unexpected error prints omt: unexpected error and returns 1", async () => {
  const ctx = fakeContext({
    root: tempDir(),
    stdout: () => {
      throw new Error("boom");
    },
  });
  assert.equal(await main(["--version"], ctx), 1);
  assert.equal(ctx.err(), "omt: unexpected error: boom\n");
});
