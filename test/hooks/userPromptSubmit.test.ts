import { test } from "bun:test";
import assert from "node:assert/strict";
import { run } from "../../src/commands/hook.ts";
import { detectUltrawork, runUserPromptSubmitHook, ultraworkContext } from "../../src/hooks/userPromptSubmit.ts";
import { fakeContext, omtExit, spawnOmt, tempDir } from "../helpers.ts";

const MATCHES: string[] = [
  "start ulw add rate limiting",
  "Start ultrawork: fix the login",
  "please start ulw on this",
  "START ULTRAWORK",
  "start\tulw add a flag",
  "start  ulw add a flag",
  "Start ulw.",
  "do it (start ulw)",
  "fix it, start ulw!",
  "line one\nstart ulw",
  "`code` then start ulw",
  "\"quoted\" start ulw",
  "no start ulw here, but start ultrawork this",
  "know start ulw",
  "cannot\nstart ulw",
  "not now. start ulw",
  "do not touch the build script, start ulw",
  "start ulw, don't forget tests",
  "no problem, start ulw add a flag",
  "not one two three start ulw",
  "no\u00a0start ulw",
  "start ulw explain this <task-notification> tag",
];

const MISSES: string[] = [
  "add a flag",
  "what does ulw do?",
  "ulw add rate limiting",
  "please ultrawork this",
  "how does ultrawork pick its reviewers?",
  "starting ulw",
  "restart ulw",
  "start\nulw",
  "startulw",
  "start ulwx",
  "start ultraworking",
  "start ulw-mode",
  "start ulw/x",
  "start $ulw",
  "start /ulw",
  "pre-start ulw",
  "```\nstart ulw\n```",
  "~~~sh\nstart ultrawork\n~~~\nplain text",
  "run `start ulw` later",
  "run ``start ulw`` later",
  "the phrase \"start ulw\" starts a run",
  "the phrase “start ulw” starts a run",
  "> start ulw\nquoted line only",
  "  > start ultrawork",
  "<!-- omt-brief v1 role=execute round=1 depth=1/1 -->\nstart ulw",
  "text before <!-- omt-brief v1 --> start ultrawork",
  "Act as the implementation sub-agent. start ulw",
  "/omt-ulw add a flag",
  "$omt-ulw add a flag",
  "do not start ultrawork",
  "don't start ulw",
  "don’t start ulw this",
  "dont start ulw",
  "never start ulw",
  "NOT START ULTRAWORK",
  "not one two start ulw",
  "<task-notification>\n<task-id>w43cdy93b</task-id>\n<status>completed</status>\n<result>The hook armed on 'start ulw add a flag'. Then start ulw ran.</result>\n</task-notification>",
  "\n<task-notification><result>start ulw</result></task-notification>",
  "Delegated task node:delegated-task:abc (plan-review) [completed]:\nVERDICT: APPROVE\nThen start ulw step 7.",
];

test("detectUltrawork matches the phrase start ulw or start ultrawork", () => {
  for (const prompt of MATCHES) assert.equal(detectUltrawork(prompt), true, JSON.stringify(prompt));
});

test("detectUltrawork ignores the bare words, code, quotes, blockquotes, word parts, negations, child briefs, task notifications, and delegated-task wakes", () => {
  for (const prompt of MISSES) assert.equal(detectUltrawork(prompt), false, JSON.stringify(prompt));
});

test("detectUltrawork checks a 200,000-character negated prompt in under 1,000 ms", () => {
  const prompt = "no start ulw ".repeat(Math.ceil(200_000 / 13));
  assert.ok(prompt.length >= 200_000);
  const started = performance.now();
  assert.equal(detectUltrawork(prompt), false);
  assert.ok(performance.now() - started < 1000);
});

test("an unclosed fence hides the rest of the prompt", () => {
  assert.equal(detectUltrawork("ok\n```\nstart ulw"), false);
  assert.equal(detectUltrawork("```\nx\n```\nstart ulw"), true);
});

test("ultraworkContext gives the build contract: omt-ulw steps in order, the main thread builds, one review and one QA child, done with evidence", () => {
  const text = ultraworkContext();
  assert.ok(text.length <= 1000);
  assert.match(text, /ultrawork is on/);
  assert.match(text, /Load the omt-ulw skill before anything else and follow its steps in order, from step 0\./);
  assert.doesNotMatch(text, /banner/);
  assert.match(text, /You explore, ask question batches, plan, and build in this thread\./);
  assert.match(text, /One review child and one QA child check the work\./);
  assert.match(text, /report done only after the checks ran and passed, and quote their output/);
  assert.doesNotMatch(text, /full loop|edit no code|Children make every product edit/);
});

test("the hook prints one JSON line on a match", async () => {
  const ctx = fakeContext({ root: tempDir(), stdin: JSON.stringify({ prompt: "start ulw add a flag", session_id: "s" }) });
  assert.equal(await runUserPromptSubmitHook(ctx), 0);
  const out = ctx.out();
  assert.ok(out.endsWith("\n"));
  assert.equal(out.trimEnd().split("\n").length, 1);
  assert.deepEqual(JSON.parse(out), {
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ultraworkContext() },
  });
  assert.equal(ctx.err(), "");
});

test("the hook prints nothing and exits 0 on no match, empty input, or bad input", async () => {
  const root = tempDir();
  for (const stdin of ["", "  \n", "not json", "null", "[]", "42", "{}", '{"prompt":3}', '{"prompt":"add a flag"}', '{"prompt":"ulw add a flag"}']) {
    const ctx = fakeContext({ root, stdin });
    assert.equal(await runUserPromptSubmitHook(ctx), 0, stdin);
    assert.equal(ctx.out(), "", stdin);
  }
  const failing = fakeContext({
    root,
    readStdin: async () => {
      throw new Error("stdin closed");
    },
  });
  assert.equal(await runUserPromptSubmitHook(failing), 0);
  assert.equal(failing.out(), "");
});

test("hook rejects a missing or unknown hook name with exit code 2", async () => {
  const root = tempDir();
  for (const argv of [[], ["pre-tool-use"], ["--bogus"]]) {
    const ctx = fakeContext({ root, argv });
    await assert.rejects(run(ctx), omtExit(2));
  }
});

test("hook user-prompt-submit ignores extra arguments and exits 0", async () => {
  const root = tempDir();
  for (const argv of [["user-prompt-submit", "--bogus"], ["user-prompt-submit", "extra", "-x"]]) {
    const ctx = fakeContext({ root, argv, stdin: JSON.stringify({ prompt: "start ulw fix it" }) });
    assert.equal(await run(ctx), 0, argv.join(" "));
    assert.match(ctx.out(), /omt-ulw/);
  }
});

test("omt hook user-prompt-submit works as a child process", () => {
  const root = tempDir();
  const spawn = (input: string) => spawnOmt(["hook", "user-prompt-submit"], { root, input });
  const hit = spawn('{"prompt":"start ulw add a flag"}');
  assert.equal(spawn('{"prompt":"what does ulw do?"}').stdout, "");
  assert.equal(hit.code, 0);
  assert.equal(JSON.parse(hit.stdout).hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const miss = spawn("not json");
  assert.equal(miss.code, 0);
  assert.equal(miss.stdout, "");
  assert.equal(miss.stderr, "");
});
