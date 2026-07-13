import assert from "node:assert/strict";
import test from "node:test";
import { createMeasurement, finalClockSyncAt, selectClockEstimate, createReferenceClockSample, estimateReferenceClock } from "../dist/shared/clock.js";

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
    collectedSamples: 0,
  });
});

test("clock estimate reports how many HEAD requests actually returned a sample, separate from how many were used", () => {
  const boundarySamples = [
    createMeasurement({ requestStartedAt: 0, responseReceivedAt: 20, serverDateMs: 1_000 }),
    createMeasurement({ requestStartedAt: 100, responseReceivedAt: 120, serverDateMs: 2_000 }),
  ];
  assert.equal(selectClockEstimate(boundarySamples).collectedSamples, 2);

  const medianSamples = [
    { clockOffset: 100, measurementLatency: 20 },
    { clockOffset: 104, measurementLatency: 25 },
    { clockOffset: 102, measurementLatency: 30 },
    { clockOffset: 900, measurementLatency: 500 },
    { clockOffset: -700, measurementLatency: 600 },
  ];
  // configured for 9 samples but only 5 HEAD requests succeeded.
  assert.equal(selectClockEstimate(medianSamples).collectedSamples, 5);
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

// --- Tier 1: reference-clock interval max-coverage estimator ---
// 각 HEAD 표본은 offset(=서버 − monotonic) 구간 [D − t1, D + 1000 − t0]로 표현된다.
// createReferenceClockSample이 lowerMs/upperMs/rttMs를 이 정의대로 채운다.

test("a reference clock sample encodes the offset interval from the second-aligned Date", () => {
  const sample = createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 });
  assert.equal(sample.rttMs, 40);
  assert.equal(sample.lowerMs, 960);   // D - t1
  assert.equal(sample.upperMs, 2_000); // D + 1000 - t0
  assert.equal(sample.fromCache, false);
});

test("reference clock estimate falls back explicitly when no samples exist", () => {
  const estimate = estimateReferenceClock([]);
  assert.equal(estimate.source, "FALLBACK");
  assert.equal(estimate.confidence, "LOW");
  assert.equal(estimate.sampleCount, 0);
  assert.equal(estimate.dominantClusterSupport, 0);
  assert.equal(estimate.competingClusterSupport, 0);
  assert.equal(estimate.clusterSeparationMs, -1);
});

test("a single clean pool over a wide span yields HIGH confidence bracketing the true offset", () => {
  // 진짜 offset(서버 − mono) = 1500. 표본을 ~4.2s에 걸쳐 위상 분산 → 교집합이 1500을 좁게 감싼다.
  const samples = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 3_000 }),
    createReferenceClockSample({ t0: 2_600, t1: 2_640, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 4_200, t1: 4_240, serverDateMs: 5_000 }),
  ];
  const e = estimateReferenceClock(samples);
  assert.equal(e.source, "APP_HEAD_HTTP_DATE");
  assert.equal(e.confidence, "HIGH");
  assert.equal(e.offsetLowerMs, 1_360);
  assert.equal(e.offsetCenterMs, 1_480);
  assert.equal(e.offsetUpperMs, 1_600);
  assert.equal(e.uncertaintyMs, 120);
  assert.ok(e.offsetLowerMs <= 1_500 && 1_500 <= e.offsetUpperMs, "true offset bracketed");
  assert.equal(e.dominantClusterSupport, 6);
  assert.equal(e.competingClusterSupport, 0);
  assert.equal(e.clusterSeparationMs, -1);
  assert.equal(e.sampleCount, 6);
  assert.equal(e.observationSpanMs, 4_240);
  assert.equal(e.medianRttMs, 40);
});

test("a single clean but narrow-span pool is only MEDIUM confidence", () => {
  const samples = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 300, t1: 340, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 600, t1: 640, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 900, t1: 940, serverDateMs: 2_000 }),
  ];
  const e = estimateReferenceClock(samples);
  assert.equal(e.confidence, "MEDIUM");
  assert.equal(e.offsetLowerMs, 1_360);
  assert.equal(e.offsetCenterMs, 1_530);
  assert.equal(e.offsetUpperMs, 1_700);
  assert.equal(e.uncertaintyMs, 170);
  assert.equal(e.dominantClusterSupport, 4);
  assert.equal(e.competingClusterSupport, 0);
  assert.equal(e.observationSpanMs, 940);
});

test("a 60% skew pool does not confidently win: LOW confidence with uncertainty spanning the separation", () => {
  // 3 표본이 스큐 풀(offset≈2500), 2 표본이 진짜 풀(offset≈1500). 다수(3)가 오염돼도
  // 지지 차가 근소(3 < 2×2)하므로 자신 있게 고르지 않는다.
  const samples = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),     // true
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }), // true
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 2_000 }),     // skew
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 3_000 }),  // skew
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 4_000 }), // skew
  ];
  const e = estimateReferenceClock(samples);
  assert.equal(e.confidence, "LOW");
  assert.equal(e.dominantClusterSupport, 3);
  assert.equal(e.competingClusterSupport, 2);
  assert.equal(e.clusterSeparationMs, 1_350);
  assert.equal(e.offsetCenterMs, 2_630);
  assert.equal(e.offsetLowerMs, 960);
  assert.equal(e.offsetUpperMs, 3_000);
  assert.equal(e.uncertaintyMs, 1_350);
  assert.ok(e.uncertaintyMs >= e.clusterSeparationMs, "uncertainty covers separation");
  assert.equal(e.sampleCount, 5);
});

test("a 50:50 split stays LOW and rejects the phantom cross-pool overlap", () => {
  // 2 true + 2 skew. 진짜 클러스터끼리는 offset이 근접하지만 true 하나와 skew 하나의
  // 구간 가장자리가 스치는 유령 겹침이 생길 수 있다. center-spread 타이브레이크가 이를 거른다.
  const samples = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),     // true  A
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }), // true  B
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 2_000 }),     // skew  C
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 3_000 }),  // skew  D
  ];
  const e = estimateReferenceClock(samples);
  assert.equal(e.confidence, "LOW");
  assert.equal(e.dominantClusterSupport, 2);
  assert.equal(e.competingClusterSupport, 2);
  assert.equal(e.clusterSeparationMs, 1_300);
  assert.equal(e.offsetCenterMs, 2_580);
  assert.equal(e.offsetLowerMs, 960);
  assert.equal(e.offsetUpperMs, 3_000);
  assert.equal(e.uncertaintyMs, 1_300);
  assert.ok(e.uncertaintyMs >= e.clusterSeparationMs, "uncertainty covers separation");
});

test("an extreme-RTT sample is rejected as an outlier and creates no phantom cluster", () => {
  // 깨끗한 6표본 + rtt 5000ms의 심한 이상치(offset도 크게 어긋남). 이상치가 살아남으면
  // 별도 클러스터를 만들지만, median×3 필터가 제거하므로 결과는 clean-pool과 동일해야 한다.
  const samples = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 3_000 }),
    createReferenceClockSample({ t0: 2_600, t1: 2_640, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 4_200, t1: 4_240, serverDateMs: 5_000 }),
    createReferenceClockSample({ t0: 5_000, t1: 10_000, serverDateMs: 12_000 }), // outlier
  ];
  const e = estimateReferenceClock(samples);
  assert.equal(e.sampleCount, 6);
  assert.equal(e.dominantClusterSupport, 6);
  assert.equal(e.competingClusterSupport, 0);
  assert.equal(e.offsetCenterMs, 1_480);
});

test("a lone skew sample against a strong majority stays trustworthy (MEDIUM, dominant bounds kept)", () => {
  // clean 6 + 스큐 1(offset≈2500, 자기 클러스터). dominant(6) ≥ 2×competing(1)이므로
  // 소수 스큐 하나가 confidence를 LOW로 끌어내리지 못한다. 구간은 dominant 그대로.
  const samples = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 3_000 }),
    createReferenceClockSample({ t0: 2_600, t1: 2_640, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 4_200, t1: 4_240, serverDateMs: 5_000 }),
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 2_000 }), // lone skew
  ];
  const e = estimateReferenceClock(samples);
  assert.equal(e.confidence, "MEDIUM");
  assert.equal(e.dominantClusterSupport, 6);
  assert.equal(e.competingClusterSupport, 1);
  assert.equal(e.clusterSeparationMs, 1_000);
  assert.equal(e.offsetCenterMs, 1_480);
  assert.equal(e.offsetLowerMs, 1_360);
  assert.equal(e.offsetUpperMs, 1_600);
  assert.equal(e.uncertaintyMs, 120);
  assert.equal(e.sampleCount, 7);
});

test("cached samples are excluded from the estimate", () => {
  const samples = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 3_000 }),
    createReferenceClockSample({ t0: 2_600, t1: 2_640, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 4_200, t1: 4_240, serverDateMs: 5_000 }),
    createReferenceClockSample({ t0: 100, t1: 140, serverDateMs: 900_000, fromCache: true }),
  ];
  const e = estimateReferenceClock(samples);
  assert.equal(e.sampleCount, 6);
  assert.equal(e.offsetCenterMs, 1_480);
});
