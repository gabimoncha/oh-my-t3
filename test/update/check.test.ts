import { test } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fetchLatest, dailyCheck } from "../../src/update/check.ts";
import { updateStatePath } from "../../src/paths.ts";
import { fakeContext, tempDir, writeFile } from "../helpers.ts";

const captured = readFileSync(new URL("../fixtures/npm-dist-tags-oh-my-t3code.json", import.meta.url), "utf8");
const endpoint = "https://registry.npmjs.org/-/package/oh-my-t3/dist-tags";

test("fetchLatest: captured registry response", async () => {
  const request = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit) => {
    assert.equal(url, endpoint);
    assert.deepEqual(opts?.headers, { accept: "application/json" });
    assert.equal(opts?.credentials, "omit");
    assert.ok(opts?.signal instanceof AbortSignal);
    return new Response(captured);
  }) as unknown as typeof fetch;
  assert.deepEqual(await fetchLatest({ env: {}, fetch: request, timeoutMs: 100 }), { ok: true, version: "0.2.0" });
});

test("fetchLatest: malformed version", async () => {
  const request = (async () => new Response('{"latest":"0.2.0-beta.1"}')) as unknown as typeof fetch;
  assert.deepEqual(await fetchLatest({ env: {}, fetch: request, timeoutMs: 100 }), { ok: false, error: `${endpoint} returned no x.y.z latest version` });
});

test("fetchLatest: timeout aborts the request", async () => {
  const request = ((_url: Parameters<typeof fetch>[0], opts?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = opts?.signal;
    assert.ok(signal instanceof AbortSignal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })) as unknown as typeof fetch;
  assert.deepEqual(await fetchLatest({ env: {}, fetch: request, timeoutMs: 10 }), { ok: false, error: `${endpoint} did not answer in 10 ms` });
});

test("fetchLatest: HTTP error", async () => {
  const request = (async () => new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchLatest({ env: {}, fetch: request, timeoutMs: 100 }), { ok: false, error: `${endpoint} returned HTTP 503` });
});

for (const hours of [23, 24, 25]) {
  test(`dailyCheck: cache at ${hours} hours`, async () => {
    const root = tempDir();
    const ctx = fakeContext({ root, now: () => new Date("2026-10-25T12:00:00.000Z") });
    const checkedAt = new Date(ctx.now().getTime() - hours * 3600000).toISOString();
    const path = updateStatePath(ctx.env, ctx.homedir);
    writeFile(path, JSON.stringify({ checkedAt, latest: "0.1.0" }));
    let calls = 0;
    const request = (async () => { calls += 1; return new Response(captured); }) as unknown as typeof fetch;
    const result = await dailyCheck(ctx, { mode: "check", fetch: request });
    assert.ok(result);
    assert.equal(calls, hours < 24 ? 0 : 1);
    assert.equal(result.cached, hours < 24);
    assert.equal(result.latest, hours < 24 ? "0.1.0" : "0.2.0");
    assert.equal(result.outdated, hours >= 24);
    assert.equal(result.checkedAt, hours < 24 ? checkedAt : ctx.now().toISOString());
    assert.equal(JSON.parse(readFileSync(path, "utf8")).latest, result.latest);
  });
}

for (const mode of [undefined, "off"] as const) {
  test(`dailyCheck: no request with mode ${String(mode)}`, async () => {
    const root = tempDir();
    const ctx = fakeContext({ root });
    let calls = 0;
    const request = (async () => { calls += 1; return new Response(captured); }) as unknown as typeof fetch;
    assert.equal(await dailyCheck(ctx, { mode, fetch: request }), undefined);
    assert.equal(calls, 0);
    assert.equal(existsSync(updateStatePath(ctx.env, ctx.homedir)), false);
  });
}
