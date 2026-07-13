import assert from "node:assert/strict";
import test from "node:test";
import { createReferenceClockSample, estimateReferenceClock } from "../dist/shared/clock.js";

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

test("hysteresis: a HIGH prior blocks a ~1000ms jump when a skew burst only narrowly leads", () => {
  const cleanPool = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 3_000 }),
    createReferenceClockSample({ t0: 2_600, t1: 2_640, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 4_200, t1: 4_240, serverDateMs: 5_000 }),
  ];
  const previous = estimateReferenceClock(cleanPool);
  assert.equal(previous.confidence, "HIGH");
  assert.equal(previous.offsetCenterMs, 1_480);

  // 스큐 3 + 진짜 2. 스큐가 근소하게 앞서 max-coverage dominant지만, 직전이 HIGH이고
  // 지지 차가 근소(3 < 2×2)하므로 이전 클러스터(진짜, ~1480 근처)를 유지한다.
  const skewBurst = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }),
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 3_000 }),
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 4_000 }),
  ];
  assert.equal(estimateReferenceClock(skewBurst).offsetCenterMs, 2_630); // 이력 없으면 스큐로 점프
  const held = estimateReferenceClock(skewBurst, previous);
  assert.equal(held.offsetCenterMs, 1_280);   // 점프 안 함 — 이전 풀 유지
  assert.equal(held.confidence, "LOW");
  assert.equal(held.dominantClusterSupport, 2);
  assert.equal(held.competingClusterSupport, 3);
  assert.equal(held.clusterSeparationMs, 1_350);
  assert.equal(held.uncertaintyMs, 1_350);
});

test("hysteresis: strong majority evidence overrides a HIGH prior and updates normally", () => {
  const previous = { offsetCenterMs: 1_480, confidence: "HIGH" };
  // 스큐 5 + 진짜 1. 다수(5) ≥ 2×소수(1)이므로 강한 증거 — 이전 HIGH여도 정상 갱신(점프).
  const strongSkew = [
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 2_000 }),
    createReferenceClockSample({ t0: 800, t1: 840, serverDateMs: 3_000 }),
    createReferenceClockSample({ t0: 1_700, t1: 1_740, serverDateMs: 4_000 }),
    createReferenceClockSample({ t0: 2_600, t1: 2_640, serverDateMs: 5_000 }),
    createReferenceClockSample({ t0: 3_400, t1: 3_440, serverDateMs: 5_000 }),
    createReferenceClockSample({ t0: 0, t1: 40, serverDateMs: 1_000 }), // lone true
  ];
  const updated = estimateReferenceClock(strongSkew, previous);
  assert.equal(updated.offsetCenterMs, 2_480);   // 점프함 (강한 증거)
  assert.equal(updated.confidence, "MEDIUM");
  assert.equal(updated.dominantClusterSupport, 5);
  assert.equal(updated.competingClusterSupport, 1);
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
