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

// ---------------------------------------------------------------------------
// 관측 계층 attribute 빌더 (SP-025/01 리뷰 반영으로 RunObserver에서 승격)
// ---------------------------------------------------------------------------

import {
  availabilityBodyAttributes,
  clockSampleAttributes,
  domCorrelationAttributes,
  emptyExitAttributes,
  preparationAttributes,
  wakeResultAttributes,
} from "../dist/content/observation/payloads.js";

test("preparationAttributes는 execution·page가 없으면 생략한다", () => {
  pinPayload(preparationAttributes("SELECTING_DATE", "decision", undefined, null, { preparationDecision: "ready" }), {
    preparationStage: "SELECTING_DATE",
    preparationPhase: "decision",
    preparationDecision: "ready",
  });
});

test("preparationAttributes는 execution·page를 순서대로 펼치고 extra를 마지막에 둔다", () => {
  const data = preparationAttributes(
    "ENTERING_RESERVATION", "stage_start",
    { capturedAt: 10, tabId: 3, windowId: 5, tabActive: true, windowFocused: false },
    { visibilityState: "visible", hasFocus: true, viewportWidth: 1280, viewportHeight: 720,
      visualViewportWidth: 1280, visualViewportHeight: 700, activeElementTag: "button",
      activeElementRole: null, activeElementId: "reserve", urlKind: "shop", fingerprint: "fp" },
    { waitingOnly: false },
  );
  assert.deepStrictEqual(Object.keys(data).slice(0, 4),
    ["preparationStage", "preparationPhase", "runContextCapturedAt", "runTabId"]);
  assert.equal(Object.keys(data).at(-1), "waitingOnly");
  assert.equal(data.pageActiveElementRole, null);
});

const SHADOW_EVENT = {
  sequence: 7, requestDate: "260903", personCount: 2, classification: "POPULATED",
  responseStatus: 200, availableMinutes: [1140, 1170],
  requestSentMonoMs: 100, responseCompletedMonoMs: 150,
  bodyReadCompletedMonoMs: 160, payloadClassifiedMonoMs: 170, bridgeReceivedMonoMs: 180,
};

test("availabilityBodyAttributes는 wake 수락 시 claim 필드를 채운다", () => {
  const data = availabilityBodyAttributes(
    SHADOW_EVENT,
    { cycle: 2, correlationId: "cycle:2:request:7", quality: "EXACT", stale: false },
    { accepted: true, discardReason: null, signal: { kind: "scan_wake" } },
    1140, true, 190,
  );
  assert.equal(data.phase, "body");
  assert.equal(data.availableMinutes, "1140,1170");
  assert.equal(data.availableCount, 2);
  assert.equal(data.bridgeDelayMs, 10);
  assert.equal(data.bodyToWakeMs, 10);
  assert.equal(data.claimSource, "body");
  assert.equal(data.claimAgreement, true);
  assert.equal(data.signalKind, "scan_wake");
});

test("availabilityBodyAttributes는 wake 거절 시 claim을 none/null로 둔다", () => {
  const data = availabilityBodyAttributes(
    SHADOW_EVENT,
    { cycle: null, correlationId: null, quality: "NONE", stale: true },
    { accepted: false, discardReason: "stale", signal: null },
    null, false, 190,
  );
  assert.equal(data.claimSource, "none");
  assert.equal(data.claimAgreement, null);
  assert.equal(data.signalKind, null);
  assert.equal(data.wakeDiscardReason, "stale");
});

const DOM_CORR = {
  cycle: 3, requestSequence: null, correlationId: null, quality: "NONE",
  domMinutes: 1140, domObservedMonoMs: 900, bodyClassification: "none", bodySelectedMinutes: null,
  agreement: null, responseCompletedMonoMs: null, payloadClassifiedMonoMs: null,
  bridgeReceivedMonoMs: null, bridgeToDomMs: null, targetResponseToDomMs: null,
  bodyLeadOverDomMs: null, mutationGenerationAtTargetClick: 0, mutationGenerationAtDom: 1,
  mutationObservedAfterTarget: true, lastMutationMonoMs: 880,
};

test("domCorrelationAttributes는 body가 없으면 claimSource를 dom으로 둔다", () => {
  const data = domCorrelationAttributes(DOM_CORR, "dom_compare");
  assert.equal(data.phase, "dom_compare");
  assert.equal(data.claimSource, "dom");
  assert.equal(data.bodySequence, null);
  assert.equal(Object.keys(data).length, 22);
});

test("domCorrelationAttributes는 body가 있으면 claimSource를 body로 둔다", () => {
  assert.equal(domCorrelationAttributes({ ...DOM_CORR, requestSequence: 9 }, "dom_compare_late").claimSource, "body");
});

const WAKE = {
  kind: "scan_wake", cycle: 1, requestSequence: 7, quality: "EXACT", selectedMinutes: 1140,
  responseCompletedMonoMs: 100, payloadClassifiedMonoMs: 110, bridgeReceivedMonoMs: 120, wakeAtMonoMs: 130,
};

test("wakeResultAttributes는 후보가 없으면 파생 시간을 null로 둔다", () => {
  const data = wakeResultAttributes(WAKE, null, false, true, 3, null, null);
  assert.equal(data.wakeToDomMs, null);
  assert.equal(data.responseToDomMs, null);
  assert.equal(data.wakeAdvanceMs, null);
  assert.equal(data.bodyToWakeMs, 10);
});

test("wakeResultAttributes는 전진분을 0 이상으로 clamp한다", () => {
  assert.equal(wakeResultAttributes(WAKE, 200, true, false, 3, 150, 180).wakeAdvanceMs, 0);
  assert.equal(wakeResultAttributes(WAKE, 200, true, false, 3, 190, 180).wakeAdvanceMs, 10);
  assert.equal(wakeResultAttributes(WAKE, 200, true, false, 3, 190, 180).wakeToDomMs, 70);
});

test("emptyExitAttributes는 목표 선택과 후보 유무로 적용 여부를 파생한다", () => {
  const base = { ...WAKE, kind: "empty_exit" };
  assert.equal(emptyExitAttributes(base, true, false, 300).emptyEarlyExitApplied, true);
  assert.equal(emptyExitAttributes(base, true, true, 300).emptyEarlyExitApplied, false);
  assert.equal(emptyExitAttributes(base, false, false, 300).emptyEarlyExitApplied, false);
  assert.equal(emptyExitAttributes(base, true, false, 300).bodyToExitMs, 180);
});

test("clockSampleAttributes는 인덱스를 1부터 매기고 중앙값을 파생한다", () => {
  pinPayload(clockSampleAttributes(
    { t0: 10, t1: 50, serverDateMs: 1_000, rttMs: 40, lowerMs: 950, upperMs: 1_990, fromCache: true },
    0, 2, "armed",
  ), {
    clockSampleIndex: 1,
    clockSampleTotal: 2,
    clockSampleFreezeReason: "armed",
    clockSampleT0MonoMs: 10,
    clockSampleT1MonoMs: 50,
    clockSampleServerDateMs: 1_000,
    clockSampleRttMs: 40,
    clockSampleOffsetLowerMs: 950,
    clockSampleOffsetCenterMs: 1_470,
    clockSampleOffsetUpperMs: 1_990,
    clockSampleFromCache: true,
  });
});
