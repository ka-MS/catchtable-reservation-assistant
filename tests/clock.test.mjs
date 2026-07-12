import assert from "node:assert/strict";
import test from "node:test";
import { createMeasurement, finalClockSyncAt, selectClockEstimate } from "../dist/shared/clock.js";

test("final clock sync is fixed at five seconds before opening for normal lead times", () => {
  assert.equal(finalClockSyncAt(100_000, 0), 95_000);
  assert.equal(finalClockSyncAt(100_000, 200), 95_000);
  assert.equal(finalClockSyncAt(100_000, 3_000), 95_000);
});

test("final clock sync moves earlier instead of delaying a long pre-open lead", () => {
  assert.equal(finalClockSyncAt(100_000, 4_000), 94_000);
  assert.equal(finalClockSyncAt(100_000, 10_000), 88_000);
});

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

test("consensus rejects a cross-pool boundary and falls back to the median", () => {
  // 2026-07-12 실런 초기 보정 재현: 샘플 1~4는 같은 서버 초(d0), 샘플 5만
  // 다른 풀에 맞아 Date가 2초 점프. 가짜 경계(s4→s5)는 전체 샘플을 설명하지
  // 못하므로 기각되고 median으로 내려가야 한다.
  const samples = [
    createMeasurement({ requestStartedAt: 40, responseReceivedAt: 100, serverDateMs: 10_000 }),
    createMeasurement({ requestStartedAt: 240, responseReceivedAt: 300, serverDateMs: 10_000 }),
    createMeasurement({ requestStartedAt: 440, responseReceivedAt: 500, serverDateMs: 10_000 }),
    createMeasurement({ requestStartedAt: 640, responseReceivedAt: 700, serverDateMs: 10_000 }),
    createMeasurement({ requestStartedAt: 780, responseReceivedAt: 900, serverDateMs: 12_000 }),
  ];
  const result = selectClockEstimate(samples);
  assert.equal(result.method, "median");
  assert.equal(result.offsetMs, 10_230);
});

test("consensus keeps a genuine boundary that every sample supports", () => {
  const samples = [
    createMeasurement({ requestStartedAt: 40, responseReceivedAt: 100, serverDateMs: 10_000 }),
    createMeasurement({ requestStartedAt: 240, responseReceivedAt: 300, serverDateMs: 11_000 }),
    createMeasurement({ requestStartedAt: 440, responseReceivedAt: 500, serverDateMs: 11_000 }),
    createMeasurement({ requestStartedAt: 640, responseReceivedAt: 700, serverDateMs: 11_000 }),
    createMeasurement({ requestStartedAt: 840, responseReceivedAt: 900, serverDateMs: 11_000 }),
  ];
  const result = selectClockEstimate(samples);
  assert.equal(result.method, "boundary");
  assert.equal(result.offsetMs, 10_830);
});

test("a disguised one-tick cross-pool boundary loses the tie to the tighter genuine boundary", () => {
  // 풀 전환이 마침 +1초로 보이면 d1000으로 위장한 가짜 경계가 생긴다.
  // floor 투표는 1초 미만 편차를 완전히 분리하지 못해 동표(4:4)가 날 수 있고,
  // 그때는 midpoint 간격이 좁은(정밀한) 경계가 이겨야 한다.
  const samples = [
    createMeasurement({ requestStartedAt: 40, responseReceivedAt: 100, serverDateMs: 10_000 }),
    createMeasurement({ requestStartedAt: 190, responseReceivedAt: 250, serverDateMs: 11_000 }),
    createMeasurement({ requestStartedAt: 440, responseReceivedAt: 500, serverDateMs: 11_000 }),
    createMeasurement({ requestStartedAt: 640, responseReceivedAt: 700, serverDateMs: 11_000 }),
    createMeasurement({ requestStartedAt: 840, responseReceivedAt: 900, serverDateMs: 12_000 }),
  ];
  const result = selectClockEstimate(samples);
  assert.equal(result.method, "boundary");
  assert.equal(result.offsetMs, 10_855);
});

test("clock estimate falls back explicitly when no samples exist", () => {
  assert.deepEqual(selectClockEstimate([]), {
    offsetMs: 0,
    sampleCount: 0,
    spreadMs: null,
    fallback: true,
    method: "local",
    precisionMs: null,
    sampleDetail: null,
  });
});

test("boundary estimate carries per-sample offset, latency, and Date-tick deltas", () => {
  const samples = [
    createMeasurement({ requestStartedAt: 0, responseReceivedAt: 20, serverDateMs: 1_000 }),
    createMeasurement({ requestStartedAt: 100, responseReceivedAt: 120, serverDateMs: 2_000 }),
    createMeasurement({ requestStartedAt: 200, responseReceivedAt: 220, serverDateMs: 2_000 }),
  ];
  const result = selectClockEstimate(samples);
  assert.equal(result.method, "boundary");
  assert.equal(result.sampleDetail, "o1490 l20 d0 | o2390 l20 d1000 | o2290 l20 d1000");
});

test("median estimate keeps every sample in the detail, including discarded outliers", () => {
  const samples = [
    { clockOffset: 100, measurementLatency: 20 },
    { clockOffset: 104.4, measurementLatency: 25 },
    { clockOffset: 102, measurementLatency: 30 },
    { clockOffset: 900, measurementLatency: 500 },
    { clockOffset: -700, measurementLatency: 600 },
  ];
  const result = selectClockEstimate(samples);
  assert.equal(result.method, "median");
  assert.equal(result.sampleDetail, "o100 l20 | o104 l25 | o102 l30 | o900 l500 | o-700 l600");
});
