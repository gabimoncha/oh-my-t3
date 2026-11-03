import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { childEnv, spawnOmt, tempDir, writeFile } from "../helpers.ts";

test("end to end: pick and switch a custom profile, then use its limits for the plan", () => {
  const root = tempDir("omt-profile-");
  const project = join(root, "project");
  const env = childEnv(root);
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(env.HOME!, { recursive: true });
  const configPath = join(project, ".omt3", "config.jsonc");
  const config = {
    profile: "prototype",
    limits: { maxParallel: 2 },
    profiles: {
      hackathon: {
        description: "Demo day.", extends: "prototype",
        workflow: { build: { oracle: "always" } },
        limits: { maxParallel: 8 },
        roles: { execute: { fast: true } },
        models: { "claude-opus-5-5": { fast: true } },
      },
    },
  };
  writeFile(configPath, JSON.stringify(config));
  const run = (args: string[]) => spawnOmt(args, { root, cwd: project, env });
  const ok = (...args: string[]) => {
    const result = run(args);
    assert.equal(result.code, 0, `${args.join(" ")}\n${result.stderr}`);
    assert.equal(result.stderr, "");
    return result.stdout;
  };
  const list = ok("profile", "list");
  for (const name of ["normal", "prototype", "hackathon"]) assert.match(list, new RegExp(`^${name}\\s+`, "m"));
  assert.deepEqual(JSON.parse(ok("profile", "list", "--json")).map((profile: { name: string }) => profile.name), ["normal", "prototype", "hackathon"]);
  const prototype = JSON.parse(ok("profile", "show", "prototype", "--json"));
  assert.equal(prototype.profile, "prototype");
  assert.equal(prototype.source, "argument");
  assert.equal(prototype.workflow.build.failureProofs, "off");
  assert.equal(prototype.limits.maxReviewRounds, 2);
  assert.equal(prototype.roles.execute.fast, undefined);
  assert.equal(prototype.models["gpt-6.1-sol"].fast, true);
  const custom = JSON.parse(ok("profile", "show", "hackathon", "--json"));
  assert.equal(custom.workflow.build.oracle, "always");
  assert.equal(custom.workflow.build.failureProofs, "off");
  assert.equal(custom.workflow.build.qa, "planned");
  assert.equal(custom.limits.maxReviewRounds, 2);
  assert.equal(custom.roles.execute.fast, true);
  assert.equal(custom.models["claude-opus-5-5"].fast, true);
  assert.equal(JSON.parse(ok("profile", "show", "--json")).source, "config");
  assert.match(ok("plan", "new", "demo", "--profile", "prototype"), /demo\.md\n$/);
  const path = join(project, ".omt3", "plans", "demo.md");
  assert.match(readFileSync(path, "utf8"), /^<!-- omt-plan .* profile=prototype -->$/m);
  assert.match(ok("plan", "profile", "demo", "hackathon"), /^set profile=hackathon for demo\n$/);
  const selected = JSON.parse(ok("profile", "show", "--plan", "demo", "--json"));
  assert.deepEqual(selected, { ...custom, source: "plan" });
  assert.equal(JSON.parse(ok("profile", "show", "normal", "--plan", "demo", "--json")).source, "argument");
  assert.equal(JSON.parse(ok("profile", "show", "--profile", "normal", "--plan", "demo", "--json")).profile, "normal");
  assert.match(ok("plan", "status", "demo"), /^profile: hackathon$/m);
  assert.equal(JSON.parse(ok("plan", "status", "demo", "--json")).profile, "hackathon");
  assert.match(ok("ledger", "stats", "--plan", "demo"), /^profile: hackathon$/m);
  assert.deepEqual(JSON.parse(ok("ledger", "stats", "--plan", "demo", "--json")).limits, { maxParallel: 8 });
  ok("ledger", "add", "--plan", "demo", "--unit", "U1", "--role", "execute", "--status", "dispatched", "--task-id", "t1");
  assert.equal(JSON.parse(ok("ledger", "stats", "--plan", "demo", "--json")).canDispatch, true);
  ok("plan", "limit", "demo", "1");
  const stats = JSON.parse(ok("ledger", "stats", "--plan", "demo", "--json"));
  assert.deepEqual(stats.limits, { maxParallel: 1 });
  assert.equal(stats.canDispatch, false);
  ok("plan", "limit", "demo", "12");
  assert.equal(JSON.parse(ok("ledger", "stats", "--plan", "demo", "--json")).limits.maxParallel, 8);
  ok("plan", "profile", "demo", "normal");
  assert.match(ok("plan", "status", "demo"), /^profile: normal$/m);
  assert.match(ok("ledger", "stats", "--plan", "demo"), /^profile: normal$/m);
  ok("plan", "profile", "demo", "none");
  assert.doesNotMatch(readFileSync(path, "utf8"), / profile=/);
  assert.match(readFileSync(path, "utf8"), / max-parallel=12\b/);
  assert.match(ok("plan", "status", "demo"), /^profile: prototype$/m);
  assert.match(ok("ledger", "stats", "--plan", "demo"), /^profile: prototype$/m);
  assert.deepEqual(JSON.parse(ok("ledger", "stats", "--json")).limits, { maxParallel: 2 });
  config.profile = "hackathon";
  writeFileSync(configPath, JSON.stringify(config));
  assert.deepEqual(JSON.parse(ok("ledger", "stats", "--json")).limits, { maxParallel: 8 });
});

test("profile CLI rejects unknown selections and broken chains and prints role merge issues", () => {
  const root = tempDir("omt-profile-errors-");
  const project = join(root, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  const configPath = join(project, ".omt3", "config.jsonc");
  writeFile(configPath, JSON.stringify({ profiles: { custom: { description: "Custom." } } }));
  const run = (...args: string[]) => spawnOmt(args, { root, cwd: project });
  assert.equal(run("plan", "new", "demo").code, 0);
  const path = join(project, ".omt3", "plans", "demo.md");
  const original = readFileSync(path, "utf8");
  for (const args of [
    ["profile", "show", "missing"], ["profile", "show", "--profile", "missing"],
    ["plan", "new", "other", "--profile", "missing"], ["plan", "profile", "demo", "missing"],
    ["plan", "profile", "demo", "x -->"],
  ]) {
    const result = run(...args);
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.stderr, /unknown profile/);
    assert.match(result.stderr, /known profiles: normal, prototype, custom/);
    assert.equal(readFileSync(path, "utf8"), original);
  }
  writeFileSync(path, original.replace(" -->", " profile=missing -->"));
  for (const args of [["profile", "show", "--plan", "demo"], ["plan", "status", "demo"], ["ledger", "stats", "--plan", "demo"]]) {
    const result = run(...args);
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.stderr, /known profiles: normal, prototype, custom/);
  }
  writeFileSync(configPath, JSON.stringify({ profiles: { custom: { description: "Custom.", extends: "custom" } } }));
  const broken = run("profile", "show", "custom");
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /profile cycle: custom -> custom/);
  writeFileSync(path, original.replace(" -->", " profile=custom -->"));
  writeFileSync(configPath, JSON.stringify({ profiles: { custom: { description: "Custom.", roles: { brandnew: { fast: true } } } } }));
  for (const args of [["profile", "show", "custom"], ["plan", "status", "demo"], ["ledger", "stats", "--plan", "demo"]]) {
    const result = run(...args);
    assert.equal(result.code, 0, args.join(" "));
    assert.match(result.stderr, /error \S+config\.jsonc profiles\.custom\.roles\.brandnew: a new role needs description, access, and chain/);
    assert.equal(result.stderr.match(/roles\.brandnew/g)?.length, 1);
  }
});

test("profile CLI resolves a retired pr-review selection to normal with a warning", () => {
  const root = tempDir("omt-profile-retired-");
  const project = join(root, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  const configPath = join(project, ".omt3", "config.jsonc");
  writeFile(configPath, JSON.stringify({ profile: "pr-review", profiles: { "pr-review": { description: "Old." } } }));
  const run = (...args: string[]) => spawnOmt(args, { root, cwd: project });
  const retired = /warning --profile: profile "pr-review" is no longer used; normal runs the PR steps\n/;
  const loaded = run("profile", "show", "--json");
  assert.equal(loaded.code, 0, loaded.stderr);
  assert.equal(JSON.parse(loaded.stdout).profile, "normal");
  assert.match(loaded.stderr, /warning \S+config\.jsonc profile: profile "pr-review" is no longer used; normal runs the PR steps\n/);
  assert.match(loaded.stderr, /warning \S+config\.jsonc profiles\.pr-review: profiles\.pr-review is no longer used; remove it\n/);
  writeFile(configPath, "{}");
  for (const args of [["profile", "show", "pr-review", "--json"], ["profile", "show", "--profile", "pr-review", "--json"]]) {
    const result = run(...args);
    assert.equal(result.code, 0, `${args.join(" ")}\n${result.stderr}`);
    assert.equal(result.stderr.match(retired)?.length, 1);
    const shown = JSON.parse(result.stdout);
    assert.equal(shown.profile, "normal");
    assert.equal(shown.workflow.review.ci, "off");
  }
  const created = run("plan", "new", "demo", "--profile", "pr-review");
  assert.equal(created.code, 0, created.stderr);
  assert.match(created.stderr, retired);
  const path = join(project, ".omt3", "plans", "demo.md");
  assert.match(readFileSync(path, "utf8"), /^<!-- omt-plan .* profile=normal -->$/m);
  const switched = run("plan", "profile", "demo", "pr-review");
  assert.equal(switched.code, 0, switched.stderr);
  assert.equal(switched.stdout, "set profile=normal for demo\n");
  writeFileSync(path, readFileSync(path, "utf8").replace(" profile=normal", " profile=pr-review"));
  const status = run("plan", "status", "demo");
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /^profile: normal$/m);
  assert.match(status.stderr, /warning plan header: profile "pr-review" is no longer used; normal runs the PR steps\n/);
});
