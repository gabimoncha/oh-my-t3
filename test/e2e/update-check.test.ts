import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "bun:test";
import { userConfigPath } from "../../src/paths.ts";
import { writeFile } from "../helpers.ts";
import { releaseRegistry, run, tools } from "./registry.ts";

const LONG = 300_000;

test("U7 check: doctor reports B and agent commands send no request", async () => {
  const tool = tools();
  const reg = await releaseRegistry("u7-check-", tool, { next: true });
  const cli = join(reg.root, "release", "npm", "oh-my-t3code", "dist", "cli.js");
  const envFor = (name: string) => {
    const env = reg.env(name, tool.nodePath);
    writeFile(userConfigPath(env, env.HOME!), '{ "update": "check" }\n');
    return env;
  };
  const doctor = await run(tool.node, [cli, "doctor"], reg.root, envFor("doctor"));
  assert.ok(doctor.includes(`INFO  update`));
  assert.ok(doctor.includes(`omt ${reg.nextVersion} is out; run omt update`));
  assert.deepEqual(reg.requests, ["/-/package/oh-my-t3/dist-tags"]);

  for (const args of [["roles"], ["brief", "qa", "--task", "Check the update behavior."]]) {
    const before = reg.requests.length;
    const output = await run(tool.node, [cli, ...args], reg.root, envFor(args[0]!));
    assert.ok(output.length > 0);
    assert.equal(reg.requests.length, before, `${args[0]} must send no request with an empty daily cache`);
  }
  const input = join(reg.root, "hook-input.json");
  writeFile(input, JSON.stringify({ prompt: "ultrawork check the update behavior" }));
  const before = reg.requests.length;
  const hook = await run("/bin/sh", ["-c", 'exec "$1" "$2" hook user-prompt-submit < "$3"', "hook", tool.node, cli, input], reg.root, envFor("hook"));
  assert.equal(JSON.parse(hook).hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.equal(reg.requests.length, before, "the hook must send no request with an empty daily cache");
}, LONG);

test("U7 default: install and doctor send no request without the update key", async () => {
  const tool = tools();
  const reg = await releaseRegistry("u7-offline-", tool, { next: true });
  const cli = join(reg.root, "release", "npm", "oh-my-t3code", "dist", "cli.js");
  for (const args of [["install", "--yes"], ["doctor"]]) {
    const env = reg.env(args[0]!, tool.nodePath);
    writeFile(userConfigPath(env, env.HOME!), "{}\n");
    const output = await run(tool.node, [cli, ...args], reg.root, env);
    assert.ok(output.length > 0);
    assert.deepEqual(reg.requests, [], `${args[0]} must stay offline by default`);
  }
}, LONG);
