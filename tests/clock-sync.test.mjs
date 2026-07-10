import assert from "node:assert/strict";
import test from "node:test";
import { syncServerClock } from "../dist/content/clock-sync.js";

test("clock sync performs bounded HEAD samples", async () => {
  let now = 10_000;
  let requests = 0;
  const result = await syncServerClock("https://app.catchtable.co.kr/ct/shop/kea", 5, {
    clock: { now: () => now },
    signal: new AbortController().signal,
    fetch: async (_url, init) => {
      requests += 1;
      assert.equal(init.method, "HEAD");
      now += 20;
      return new Response(null, { headers: { Date: new Date(11_000 + requests * 20).toUTCString() } });
    },
    sleep: async () => true,
  });
  assert.equal(requests, 5);
  assert.equal(result.fallback, false);
  assert.equal(result.sampleCount, 3);
});

test("clock sync falls back when Date headers are unavailable", async () => {
  const result = await syncServerClock("https://app.catchtable.co.kr/ct/shop/kea", 3, {
    clock: { now: () => 1_000 },
    signal: new AbortController().signal,
    fetch: async () => new Response(null),
    sleep: async () => true,
  });
  assert.equal(result.fallback, true);
  assert.equal(result.offsetMs, 0);
});

test("default nine samples span enough time to observe a Date boundary", async () => {
  let now = 400;
  const result = await syncServerClock("https://app.catchtable.co.kr/ct/shop/kea", 9, {
    clock: { now: () => now },
    signal: new AbortController().signal,
    fetch: async () => {
      now += 10;
      const serverNow = now + 1_500;
      return new Response(null, { headers: { Date: new Date(Math.floor(serverNow / 1_000) * 1_000).toUTCString() } });
    },
    sleep: async (ms) => {
      now += ms;
      return true;
    },
  });
  assert.equal(result.method, "boundary");
  assert.ok(result.precisionMs <= 100);
});
