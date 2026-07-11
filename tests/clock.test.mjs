import assert from "node:assert/strict";
import test from "node:test";
import { createMeasurement, selectClockEstimate } from "../dist/shared/clock.js";

test("clock measurement compensates HTTP Date resolution and half RTT", () => {
  const measurement = createMeasurement({ requestStartedAt: 1_000, responseReceivedAt: 1_100, serverDateMs: 2_000 });
  assert.equal(measurement.measurementLatency, 100);
  assert.equal(measurement.estimatedServerNow, 2_550);
  assert.equal(measurement.clockOffset, 1_450);
  assert.equal(measurement.measuredAt, 1_100);
  assert.equal(measurement.serverDateMs, 2_000);
});

test("clock measurement accepts monotonic RTT when the wall clock jumps", () => {
  const measurement = createMeasurement({
    requestStartedAt: 1_000,
    responseReceivedAt: 6_100,
    serverDateMs: 7_000,
    measurementLatencyMs: 100,
  });
  assert.equal(measurement.measurementLatency, 100);
  assert.equal(measurement.estimatedServerNow, 7_550);
});

test("clock estimate uses the median of the lowest-latency samples", () => {
  const samples = [
    { clockOffset: 100, measurementLatency: 20 },
    { clockOffset: 104, measurementLatency: 25 },
    { clockOffset: 102, measurementLatency: 30 },
    { clockOffset: 900, measurementLatency: 500 },
    { clockOffset: -700, measurementLatency: 600 },
  ];
  const result = selectClockEstimate(samples);
  assert.equal(result.offsetMs, 102);
  assert.equal(result.sampleCount, 3);
  assert.equal(result.spreadMs, 4);
  assert.equal(result.method, "median");
});

test("clock estimate locks to an observed HTTP Date second boundary", () => {
  const samples = [
    createMeasurement({ requestStartedAt: 0, responseReceivedAt: 20, serverDateMs: 1_000 }),
    createMeasurement({ requestStartedAt: 100, responseReceivedAt: 120, serverDateMs: 2_000 }),
    createMeasurement({ requestStartedAt: 200, responseReceivedAt: 220, serverDateMs: 2_000 }),
  ];
  const result = selectClockEstimate(samples);
  assert.equal(result.method, "boundary");
  assert.equal(result.offsetMs, 1_940);
  assert.equal(result.precisionMs, 60);
});

test("clock estimate falls back explicitly when no samples exist", () => {
  assert.deepEqual(selectClockEstimate([]), {
    offsetMs: 0,
    sampleCount: 0,
    spreadMs: null,
    fallback: true,
    method: "local",
    precisionMs: null,
  });
});
