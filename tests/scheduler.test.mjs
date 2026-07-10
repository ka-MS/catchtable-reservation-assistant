import assert from "node:assert/strict";
import test from "node:test";
import { waitUntil } from "../dist/shared/scheduler.js";

test("scheduler waits against an injected clock", async () => {
  let now = 0;
  const result = await waitUntil(500, {
    clock: { now: () => now },
    stopAtMs: 1_000,
    signal: new AbortController().signal,
    sleep: async (ms) => {
      now += ms;
      return true;
    },
    tickMs: 100,
  });
  assert.equal(result, "ready");
  assert.equal(now, 500);
});

test("scheduler stops at deadline and reacts to abort", async () => {
  let now = 1_000;
  assert.equal(await waitUntil(2_000, {
    clock: { now: () => now },
    stopAtMs: 1_000,
    signal: new AbortController().signal,
    sleep: async () => true,
  }), "timed_out");

  const controller = new AbortController();
  controller.abort();
  assert.equal(await waitUntil(2_000, {
    clock: { now: () => now },
    stopAtMs: 3_000,
    signal: controller.signal,
    sleep: async () => true,
  }), "stopped");
});
