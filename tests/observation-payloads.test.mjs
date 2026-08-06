// SP-025/01 커밋 1: `payloads.ts`의 순수 함수를 직접 고정한다.
//
// `orchestrator-observation.test.mjs`가 실행 경계(emit·trace)에서 payload를
// 고정한다면, 이 파일은 함수 자체를 고정한다. 실행 경로로는 닿기 어려운
// 분기(진단 없는 post-slot, null snapshot, arrival 없는 감지 등)까지 덮는다.
//
// 값뿐 아니라 **키 순서**도 고정한다. `assert.deepEqual`은 키 순서를 보지
// 않으므로, 객체 리터럴이 재구성됐는지 잡으려면 별도 단언이 필요하다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  postSlotEventData,
  referenceClockMetricData,
  slotClickDispatchedEventData,
  slotDetectedEventData,
  stageSnapshotData,
  targetClickMetricData,
  toggleCycleAttributes,
} from "../dist/content/observation/payloads.js";

function pinPayload(actual, expected) {
  assert.deepStrictEqual(actual, expected);
  assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), "키 순서가 바뀌었습니다");
}

// ---------------------------------------------------------------------------
// postSlotEventData
// ---------------------------------------------------------------------------

test("postSlotEventData는 진단이 없으면 단계만 남긴다", () => {
  pinPayload(postSlotEventData({ kind: "waiting" }), { postSlotStage: "waiting" });
});

test("postSlotEventData는 진단이 있으면 dialog 계측을 전량 펼친다", () => {
  pinPayload(postSlotEventData({
    kind: "deposit",
    certainty: "CONFIRMED",
    strategy: "deposit-zero-v2",
    fingerprint: "fp-deposit",
    evidence: ["예약금", "0원"],
    diagnostics: {
      urlKind: "reserve",
      label: "예약금 안내",
      title: "예약금",
      buttons: ["다음", "취소"],
      disabledButtonCount: 1,
      radioCount: 2,
      checkboxCount: 0,
      quantityControlCount: 3,
      zeroDepositControlCount: 1,
    },
  }), {
    postSlotStage: "deposit",
    postSlotCertainty: "CONFIRMED",
    postSlotStrategy: "deposit-zero-v2",
    postSlotFingerprint: "fp-deposit",
    postSlotEvidence: "예약금 | 0원",
    dialogUrlKind: "reserve",
    dialogLabel: "예약금 안내",
    dialogTitle: "예약금",
    dialogButtons: "다음 | 취소",
    dialogDisabledButtonCount: 1,
    dialogRadioCount: 2,
    dialogCheckboxCount: 0,
    dialogQuantityControlCount: 3,
    dialogZeroDepositControlCount: 1,
  });
});

// ---------------------------------------------------------------------------
// stageSnapshotData
// ---------------------------------------------------------------------------

test("stageSnapshotData는 null 스냅샷을 빈 객체로 만든다", () => {
  pinPayload(stageSnapshotData(null), {});
});

test("stageSnapshotData는 배열을 파이프로 접어 넣는다", () => {
  pinPayload(stageSnapshotData({
    urlKind: "reserve",
    headings: ["예약", "안내"],
    buttons: ["확인", "취소"],
    disabledButtonCount: 2,
    dialogLabel: "라벨",
    dialogTitle: "제목",
    textSnippet: "본문 일부",
    fingerprint: "fp-1",
  }), {
    snapshotUrlKind: "reserve",
    snapshotHeadings: "예약 | 안내",
    snapshotButtons: "확인 | 취소",
    snapshotDisabledButtonCount: 2,
    snapshotDialogLabel: "라벨",
    snapshotDialogTitle: "제목",
    snapshotTextSnippet: "본문 일부",
    snapshotFingerprint: "fp-1",
  });
});

// ---------------------------------------------------------------------------
// referenceClockMetricData
// ---------------------------------------------------------------------------

const estimate = {
  offsetLowerMs: -12, offsetCenterMs: 7, offsetUpperMs: 26,
  uncertaintyMs: 19, confidence: "MEDIUM",
  dominantClusterSupport: 4, competingClusterSupport: 1, clusterSeparationMs: 33,
  medianRttMs: 58, p95RttMs: 91, sampleCount: 5, observationSpanMs: 4_200,
  source: "APP_HEAD_HTTP_DATE",
};

test("referenceClockMetricData는 armLead 없이 bootstrap을 만든다", () => {
  pinPayload(referenceClockMetricData(estimate, "bootstrap", 7.4), {
    clockPhase: "bootstrap",
    clockOffsetMs: 7,
    clockOffsetCenterMs: 7,
    clockOffsetLowerMs: -12,
    clockOffsetUpperMs: 26,
    clockUncertaintyMs: 19,
    clockConfidence: "MEDIUM",
    clockDominantSupport: 4,
    clockCompetingSupport: 1,
    clockClusterSeparationMs: 33,
    clockMedianRttMs: 58,
    clockP95RttMs: 91,
    clockSampleCount: 5,
    clockObservationSpanMs: 4_200,
    clockSource: "APP_HEAD_HTTP_DATE",
  });
});

test("referenceClockMetricData는 armLead가 주어지면 마지막에 덧붙인다", () => {
  const data = referenceClockMetricData(estimate, "armed", -3.6, 410);
  assert.equal(data.clockPhase, "armed");
  assert.equal(data.clockArmLeadMs, 410);
  // wall offset은 반올림된다 (-3.6 -> -4)
  assert.equal(data.clockOffsetMs, -4);
  assert.equal(Object.keys(data).at(-1), "clockArmLeadMs");
});

// ---------------------------------------------------------------------------
// toggleCycleAttributes
// ---------------------------------------------------------------------------

test("toggleCycleAttributes는 클릭 성공 여부를 시각 유무로 파생한다", () => {
  pinPayload(toggleCycleAttributes({
    cycle: 3,
    phase: "precision",
    adjacentDate: "2026-07-29",
    adjacentPlannedAt: 810,
    adjacentClickedAt: null,
    targetPlannedAt: 850,
    targetClickedAt: 851,
    targetSelectedAt: null,
    slotScanCount: 4,
    availableSlotCount: 2,
    matchedSlotCount: 1,
    result: "NO_SLOT",
    watch: "live",
    arrivalAt: 860,
    wakeUsed: true,
    wakeRequestSequence: 7,
    wakeCorrelationQuality: "EXACT",
    wakeFallbackUsed: false,
  }), {
    cycle: 3,
    phase: "precision",
    adjacentDate: "2026-07-29",
    adjacentPlannedAt: 810,
    adjacentClickedAt: null,
    adjacentClickOk: false,
    targetPlannedAt: 850,
    targetClickedAt: 851,
    targetClickOk: true,
    targetSelectedAt: null,
    slotScanCount: 4,
    availableSlotCount: 2,
    matchedSlotCount: 1,
    result: "NO_SLOT",
    watch: "live",
    arrivalAt: 860,
    wakeUsed: true,
    wakeRequestSequence: 7,
    wakeCorrelationQuality: "EXACT",
    wakeFallbackUsed: false,
  });
});

// ---------------------------------------------------------------------------
// targetClickMetricData
// ---------------------------------------------------------------------------

test("targetClickMetricData는 오픈 델타와 스케줄 드리프트를 함께 남긴다", () => {
  pinPayload(targetClickMetricData(1_007, { targetClickAtMs: 1_000, phase: "precision" }, 1_000), {
    timingStage: "target_date_click",
    timingServerAtMs: 1_007,
    openDeltaMs: 7,
    scheduledServerAtMs: 1_000,
    scheduleDriftMs: 7,
    togglePhase: "precision",
  });
});

// ---------------------------------------------------------------------------
// slotDetectedEventData
// ---------------------------------------------------------------------------

const clockData = { clockConfidence: "HIGH", clockUncertaintyMs: 0, clockOffsetMs: 0 };

test("slotDetectedEventData는 arrival·adjacent·target이 모두 없으면 생략한다", () => {
  pinPayload(slotDetectedEventData(1_200, null, null, 1_000, null, 340.6, clockData), {
    timingStage: "slot_detected",
    timingServerAtMs: 1_200,
    openDeltaMs: 200,
    monoFromRunStartMs: 341,
    clockConfidence: "HIGH",
    clockUncertaintyMs: 0,
    clockOffsetMs: 0,
  });
});

test("slotDetectedEventData는 arrival·adjacent·target이 있으면 전량 펼친다", () => {
  pinPayload(slotDetectedEventData(
    1_200,
    { actualAt: 950, scheduledAt: 940, phase: "coarse" },
    { actualAt: 1_010, scheduledAt: 1_000, phase: "precision" },
    1_000,
    1_150,
    341,
    clockData,
  ), {
    timingStage: "slot_detected",
    timingServerAtMs: 1_200,
    openDeltaMs: 200,
    xhrArrivalServerAtMs: 1_150,
    arrivalToDetectMs: 50,
    adjacentTimingServerAtMs: 950,
    adjacentOpenDeltaMs: -50,
    adjacentScheduledServerAtMs: 940,
    adjacentScheduleDriftMs: 10,
    adjacentTogglePhase: "coarse",
    targetTimingServerAtMs: 1_010,
    targetOpenDeltaMs: 10,
    targetScheduledServerAtMs: 1_000,
    targetScheduleDriftMs: 10,
    targetTogglePhase: "precision",
    monoFromRunStartMs: 341,
    clockConfidence: "HIGH",
    clockUncertaintyMs: 0,
    clockOffsetMs: 0,
  });
});

// ---------------------------------------------------------------------------
// slotClickDispatchedEventData
// ---------------------------------------------------------------------------

test("slotClickDispatchedEventData는 arrival이 없으면 생략한다", () => {
  pinPayload(slotClickDispatchedEventData(1_260, 1_000, null, 400, clockData), {
    timingStage: "slot_click_dispatched",
    timingServerAtMs: 1_260,
    openDeltaMs: 260,
    monoFromRunStartMs: 400,
    clockConfidence: "HIGH",
    clockUncertaintyMs: 0,
    clockOffsetMs: 0,
  });
});

test("slotClickDispatchedEventData는 arrival이 있으면 클릭까지의 간격을 남긴다", () => {
  pinPayload(slotClickDispatchedEventData(1_260, 1_000, 1_150, 400, clockData), {
    timingStage: "slot_click_dispatched",
    timingServerAtMs: 1_260,
    openDeltaMs: 260,
    arrivalToClickMs: 110,
    monoFromRunStartMs: 400,
    clockConfidence: "HIGH",
    clockUncertaintyMs: 0,
    clockOffsetMs: 0,
  });
});
