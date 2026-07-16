import assert from "node:assert/strict";
import test from "node:test";
import { ReferenceClockSampler } from "../dist/content/reference-clock-sampler.js";
import { createReferenceClockSample } from "../dist/shared/clock.js";

// 위상 분산된 깨끗한 단일 풀 (offset≈1500). estimator HIGH 조건을 만족한다.
const CLEAN_POOL = [
  createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
  createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 2_000 }),
  createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 3_000 }),
  createReferenceClockSample({ t0: 2_600, t1: 2_640, serverDateMs: 4_000 }),
  createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }),
  createReferenceClockSample({ t0: 4_200, t1: 4_240, serverDateMs: 5_000 }),
];

function makeSampler(overrides = {}) {
  return new ReferenceClockSampler({
    targetUrl: "https://app.example/shop/1",
    monotonicClock: { now: () => 0 },
    sleep: async () => true,
    ...overrides,
  });
}

test("ingest recomputes the rolling estimate as samples arrive", () => {
  const sampler = makeSampler();
  assert.equal(sampler.latest, null);
  let last;
  for (const sample of CLEAN_POOL) last = sampler.ingest(sample);
  assert.equal(last.confidence, "HIGH");
  assert.equal(last.offsetCenterMs, 1_480);
  assert.equal(sampler.latest, last);
});

test("ingest caps the rolling buffer at bufferSize, dropping the oldest", () => {
  const sampler = makeSampler({ bufferSize: 3 });
  for (const sample of CLEAN_POOL) sampler.ingest(sample);
  assert.equal(sampler.latest.sampleCount, 3); // only the last 3 remain
});

test("drainSamples returns the bounded ring in order, clears it, and preserves latest", () => {
  const sampler = makeSampler({ bufferSize: 3 });
  for (const sample of CLEAN_POOL) sampler.ingest(sample);
  const latest = sampler.latest;
  assert.deepEqual(sampler.drainSamples(), CLEAN_POOL.slice(-3));
  assert.deepEqual(sampler.drainSamples(), []);
  assert.equal(sampler.latest, latest);
});

test("observationSpanMs reflects the spread of buffered samples", () => {
  const sampler = makeSampler();
  for (const sample of CLEAN_POOL) sampler.ingest(sample);
  assert.equal(sampler.latest.observationSpanMs, 4_240);
});

test("sampleOnce builds a sample from the HEAD Date header and monotonic timing", async () => {
  const times = [1_000, 1_060];
  const dateStr = "Mon, 13 Jul 2026 09:00:00 GMT";
  const sampler = makeSampler({
    monotonicClock: { now: () => times.shift() },
    fetch: async () => new Response(null, { headers: { Date: dateStr } }),
  });
  const sample = await sampler.sampleOnce(new AbortController().signal);
  assert.equal(sample.t0, 1_000);
  assert.equal(sample.t1, 1_060);
  assert.equal(sample.rttMs, 60);
  assert.equal(sample.serverDateMs, Date.parse(dateStr));
  assert.equal(sample.fromCache, false);
});

test("sampleOnce marks a cached response (Age > 0) so the estimator can drop it", async () => {
  const sampler = makeSampler({
    monotonicClock: { now: () => 0 },
    fetch: async () => new Response(null, { headers: { Date: "Mon, 13 Jul 2026 09:00:00 GMT", Age: "3" } }),
  });
  const sample = await sampler.sampleOnce(new AbortController().signal);
  assert.equal(sample.fromCache, true);
});

test("sampleOnce returns null when the Date header is missing or unparseable", async () => {
  const sampler = makeSampler({ fetch: async () => new Response(null, {}) });
  const sample = await sampler.sampleOnce(new AbortController().signal);
  assert.equal(sample, null);
});

test("start emits an estimate per sample and stops emitting after stop()", async () => {
  let fetchCount = 0;
  const sampler = makeSampler({
    monotonicClock: { now: () => fetchCount * 10 },
    fetch: async () => {
      fetchCount += 1;
      return new Response(null, { headers: { Date: "Mon, 13 Jul 2026 09:00:00 GMT" } });
    },
    sleep: async (_ms, signal) => !signal.aborted,
  });
  const emitted = [];
  await sampler.start((estimate) => {
    emitted.push(estimate);
    sampler.stop(); // stop after the first emit
  });
  assert.equal(emitted.length, 1);
  assert.equal(sampler.latest, emitted[0]);
});

test("start() does not reject when stop() aborts a fetch that is still in flight", async () => {
  // A real fetch rejects an aborted request with a DOMException named
  // "AbortError" — NOT a TypeError. If sampleOnce only swallows TypeError,
  // this rethrows out of the start() loop and start()'s fire-and-forget
  // promise (orchestrator calls it with `void`) becomes an unhandled
  // rejection on every run, since stopReferenceClock() always fires while
  // the persistent sampler may have a HEAD request in flight.
  const sampler = makeSampler({
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    }),
    sleep: async () => true,
  });
  const startPromise = sampler.start(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the fetch become "in flight"
  sampler.stop();
  await assert.doesNotReject(startPromise);
});

test("stop before start makes start a no-op-safe loop that exits immediately", async () => {
  const sampler = makeSampler({
    fetch: async () => new Response(null, { headers: { Date: "Mon, 13 Jul 2026 09:00:00 GMT" } }),
    sleep: async () => false, // never loops
  });
  const emitted = [];
  sampler.stop(); // no controller yet — must not throw
  await sampler.start((estimate) => emitted.push(estimate));
  // one sample is taken then the false sleep breaks the loop
  assert.ok(emitted.length <= 1);
});
