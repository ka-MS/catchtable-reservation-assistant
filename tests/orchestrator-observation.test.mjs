// SP-025/01 관측 분리의 baseline 고정 테스트.
//
// 기존 `orchestrator.test.mjs`는 payload 전체를 고정하지 않는다 —
// `attributes` 객체 전량을 비교하는 단언은 `CLOCK_SAMPLE` 하나뿐이고
// 나머지는 단일 필드만 확인한다. 또 `assert.deepEqual`은 키 순서를
// 검증하지 않는다. 관측 계층을 분리하면서 payload가 바뀌지 않았음을
// 기계적으로 증명하려면 그것만으로는 부족하다.
//
// 이 파일은 추출 **이전의** 동작을 고정한다. 추출 후에도 한 줄도
// 수정하지 않고 통과해야 한다.
import assert from "node:assert/strict";
import test from "node:test";
import { OpenRunOrchestrator } from "../dist/content/orchestrator.js";

/** 값과 키 순서를 함께 고정한다. `deepEqual`은 키 순서를 보지 않는다. */
function pinPayload(actual, expected) {
  assert.deepStrictEqual(actual, expected);
  assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), "키 순서가 바뀌었습니다");
}

function fakeReferenceClock() {
  const estimate = {
    offsetLowerMs: 0, offsetCenterMs: 0, offsetUpperMs: 0,
    uncertaintyMs: 0, confidence: "HIGH",
    dominantClusterSupport: 1, competingClusterSupport: 0, clusterSeparationMs: -1,
    medianRttMs: 0, p95RttMs: 0, sampleCount: 1, observationSpanMs: 0,
    source: "APP_HEAD_HTTP_DATE", updatedAtMonoMs: 0,
  };
  const samples = [];
  return {
    get latest() { return estimate; },
    sampleOnce: async () => ({
      t0: 10, t1: 50, serverDateMs: 1_000, rttMs: 40,
      lowerMs: 950, upperMs: 1_990, fromCache: false,
    }),
    ingest: (sample) => { samples.push(sample); return estimate; },
    drainSamples: () => samples.splice(0),
    start: () => new Promise(() => {}),
    stop: () => undefined,
  };
}

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: 1_000,
    reservationDate: "2026-07-30",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [1140],
    postSlotEnabled: true,
    paymentMethodAutoAdvance: true,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: 3_000,
    entryMode: "prepared",
    dryRun: true,
    preOpenLeadMs: 300,
    toggleIntervalMs: 400,
    reservationCompletionEnabled: false,
    maxPaymentAmountKrw: 0,
    requiredFormDefaultAnswer: "",
    ...overrides,
  };
}

/**
 * 관측 관련 dependency만 주입 가능한 최소 하네스.
 * `orchestrator.test.mjs`의 하네스를 건드리지 않기 위해 별도로 둔다.
 */
function harness({
  calendarBroken = false,
  throwOn = {},
  configOverrides = {},
} = {}) {
  let now = 0;
  let monotonicNow = 0;
  let cycles = 0;
  const events = [];
  const traces = [];
  const calls = [];

  const boom = (name) => { throw new Error(`${name} boom`); };

  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    monotonicClock: { now: () => monotonicNow },
    referenceClock: () => fakeReferenceClock(),
    calendar: {
      inspect: () => (calendarBroken
        ? { targetAvailable: false, targetSelected: false, adjacentDate: null }
        : { targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
      inspectPreparation: () => ({
        displayedMonth: "2026-07",
        target: { available: true, selected: true },
        monthNavigation: null,
      }),
      clickMonth: () => true,
      clickDate: (date) => { if (date === "2026-07-30") cycles += 1; return true; },
    },
    entry: {
      inspect: () => ({ reservationOpen: true, ctaAvailable: true, waitingOnly: false }),
      openReservation: () => true,
    },
    person: {
      inspect: () => ({ ready: true, targetAvailable: true, targetSelected: true }),
      select: () => true,
    },
    slots: {
      readAvailableSlots: () => (cycles >= 1
        ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }]
        : []),
      clickSlot: () => true,
    },
    postSlot: {
      inspect: () => ({ kind: "form" }),
      advance: () => ({ status: "blocked", message: "미사용" }),
    },
    slotWatch: { start: () => undefined, stop: () => undefined },
    sleep: async (ms, signal) => {
      if (signal.aborted) return false;
      now += ms;
      monotonicNow += ms;
      return true;
    },
    emit: (event) => {
      if (throwOn.emit) boom("emit");
      events.push(event);
    },
    trace: (code, severity, message, options) => {
      if (throwOn.trace === true || throwOn.trace === code) boom("trace");
      traces.push({ code, severity, message, options });
    },
    flushTrace: async () => undefined,
    diagnostics: {
      breadcrumb: () => {
        calls.push("breadcrumb");
        if (throwOn.breadcrumb) boom("breadcrumb");
      },
      failure: () => {
        calls.push("failure");
        if (throwOn.failure) boom("failure");
        return "diag-1";
      },
      forceFlush: async () => undefined,
    },
    captureSnapshot: () => {
      calls.push("captureSnapshot");
      if (throwOn.captureSnapshot) boom("captureSnapshot");
      return {
        urlKind: "shop", headings: [], buttons: ["확인"], disabledButtons: [false],
        disabledButtonCount: 0, dialogLabel: "", dialogTitle: "",
        textSnippet: "", fingerprint: "ss-test",
      };
    },
    capturePreparationContext: () => {
      calls.push("capturePreparationContext");
      if (throwOn.capturePreparationContext) boom("capturePreparationContext");
      return {
        visibilityState: "visible", hasFocus: true,
        viewportWidth: 1280, viewportHeight: 720,
        visualViewportWidth: 1280, visualViewportHeight: 720,
        activeElementTag: "button", activeElementRole: null, activeElementId: "reserve",
        urlKind: "shop", fingerprint: "ss-preparation",
      };
    },
    readShopDisplayName: () => "케아",
    runId: () => "run-1",
  });

  return {
    events,
    traces,
    calls,
    run: () => orchestrator.start(config(configOverrides)),
  };
}

const eventData = (events, state) => events.find((e) => e.data?.state === state)?.data;
const metricData = (events, phase) => events.find((e) => e.data?.clockPhase === phase)?.data;
const traceAttrs = (traces, code) => traces.find((t) => t.code === code)?.options?.attributes;

// ---------------------------------------------------------------------------
// 1. payload 전량 고정 (golden)
// ---------------------------------------------------------------------------

test("기준시계 metric payload가 bootstrap·armed 양쪽에서 고정된다", async () => {
  const h = harness();
  await h.run();

  const common = {
    clockOffsetMs: 0,
    clockOffsetCenterMs: 0,
    clockOffsetLowerMs: 0,
    clockOffsetUpperMs: 0,
    clockUncertaintyMs: 0,
    clockConfidence: "HIGH",
    clockDominantSupport: 1,
    clockCompetingSupport: 0,
    clockClusterSeparationMs: -1,
    clockMedianRttMs: 0,
    clockP95RttMs: 0,
    clockSampleCount: 1,
    clockObservationSpanMs: 0,
    clockSource: "APP_HEAD_HTTP_DATE",
  };
  pinPayload(metricData(h.events, "bootstrap"), { clockPhase: "bootstrap", ...common });
  pinPayload(metricData(h.events, "armed"), { clockPhase: "armed", ...common, clockArmLeadMs: 300 });
});

test("SLOT_DETECTED 이벤트 payload가 전량 고정된다", async () => {
  const h = harness();
  await h.run();

  pinPayload(eventData(h.events, "SLOT_DETECTED"), {
    state: "SLOT_DETECTED",
    timingStage: "slot_detected",
    timingServerAtMs: 870,
    openDeltaMs: -130,
    adjacentTimingServerAtMs: 810,
    adjacentOpenDeltaMs: -190,
    adjacentScheduledServerAtMs: 810,
    adjacentScheduleDriftMs: 0,
    adjacentTogglePhase: "precision",
    targetTimingServerAtMs: 850,
    targetOpenDeltaMs: -150,
    targetScheduledServerAtMs: 850,
    targetScheduleDriftMs: 0,
    targetTogglePhase: "precision",
    monoFromRunStartMs: 870,
    clockConfidence: "HIGH",
    clockUncertaintyMs: 0,
    clockOffsetMs: 0,
  });
});

test("DATE_TOGGLE_CYCLE trace attributes가 전량 고정된다", async () => {
  const h = harness();
  await h.run();

  pinPayload(traceAttrs(h.traces, "DATE_TOGGLE_CYCLE"), {
    cycle: 1,
    phase: "precision",
    adjacentDate: "2026-07-29",
    adjacentPlannedAt: 810,
    adjacentClickedAt: 810,
    adjacentClickOk: true,
    targetPlannedAt: 850,
    targetClickedAt: 850,
    targetClickOk: true,
    targetSelectedAt: 870,
    slotScanCount: 1,
    availableSlotCount: 1,
    matchedSlotCount: 1,
    result: "SLOT_FOUND",
    watch: "idle",
    arrivalAt: null,
    wakeUsed: false,
    wakeRequestSequence: null,
    wakeCorrelationQuality: null,
    wakeFallbackUsed: true,
  });
});

test("AVAILABILITY_SHADOW dom_compare attributes가 전량 고정된다", async () => {
  const h = harness();
  await h.run();

  pinPayload(traceAttrs(h.traces, "AVAILABILITY_SHADOW"), {
    phase: "dom_compare",
    cycle: 1,
    requestSequence: null,
    correlationId: null,
    correlationQuality: "NONE",
    domMinutes: 1140,
    domObservedMonoMs: 870,
    bodySequence: null,
    bodyClassification: "none",
    bodySelectedMinutes: null,
    agreement: null,
    responseCompletedMonoMs: null,
    payloadClassifiedMonoMs: null,
    bridgeReceivedMonoMs: null,
    bridgeToDomMs: null,
    targetResponseToDomMs: null,
    bodyLeadOverDomMs: null,
    mutationGenerationAtTargetClick: 0,
    mutationGenerationAtDom: 0,
    mutationObservedAfterTarget: false,
    lastMutationMonoMs: null,
    claimSource: "dom",
  });
});

test("CLOCK_SAMPLE attributes가 전량 고정된다", async () => {
  const h = harness();
  await h.run();

  pinPayload(traceAttrs(h.traces, "CLOCK_SAMPLE"), {
    clockSampleIndex: 1,
    clockSampleTotal: 1,
    clockSampleFreezeReason: "armed",
    clockSampleT0MonoMs: 10,
    clockSampleT1MonoMs: 50,
    clockSampleServerDateMs: 1_000,
    clockSampleRttMs: 40,
    clockSampleOffsetLowerMs: 950,
    clockSampleOffsetCenterMs: 1_470,
    clockSampleOffsetUpperMs: 1_990,
    clockSampleFromCache: false,
  });
});

test("handoff 실패 payload(snapshot 병합)가 전량 고정된다", async () => {
  const h = harness({ calendarBroken: true });
  const result = await h.run();

  assert.equal(result.state, "HANDED_OFF");
  pinPayload(eventData(h.events, "HANDED_OFF"), {
    state: "HANDED_OFF",
    snapshotUrlKind: "shop",
    snapshotHeadings: "",
    snapshotButtons: "확인",
    snapshotDisabledButtonCount: 0,
    snapshotDialogLabel: "",
    snapshotDialogTitle: "",
    snapshotTextSnippet: "",
    snapshotFingerprint: "ss-test",
    snapshotRunState: "PREPARING_PAGE",
    diagnosticSnapshotId: "diag-1",
  });
});

test("준비 단계 관측 payload가 전량 고정된다", async () => {
  const h = harness({ configOverrides: { entryMode: "auto" } });
  await h.run();

  const first = h.traces.find((t) => t.code === "PREPARATION_OBSERVED");
  pinPayload(first.options.attributes, {
    preparationStage: "ENTERING_RESERVATION",
    preparationPhase: "stage_start",
    pageVisibilityState: "visible",
    pageHasFocus: true,
    pageViewportWidth: 1280,
    pageViewportHeight: 720,
    pageVisualViewportWidth: 1280,
    pageVisualViewportHeight: 720,
    pageActiveElementTag: "button",
    pageActiveElementRole: null,
    pageActiveElementId: "reserve",
    pageUrlKind: "shop",
    pageFingerprint: "ss-preparation",
  });
});

// ---------------------------------------------------------------------------
// 2. 관측 실패 격리 — 던져도 실행 결과가 바뀌지 않는다
// ---------------------------------------------------------------------------

for (const target of ["breadcrumb", "failure", "captureSnapshot", "capturePreparationContext"]) {
  test(`${target}가 던져도 terminal 결과가 바뀌지 않는다`, async () => {
    const base = await harness({ configOverrides: { entryMode: "auto" } }).run();
    const h = harness({ configOverrides: { entryMode: "auto" }, throwOn: { [target]: true } });
    const result = await h.run();

    assert.equal(result.state, base.state);
    assert.equal(result.message, base.message);
  });
}

test("captureSnapshot·diagnostics.failure가 던져도 handoff 경로가 유지된다", async () => {
  for (const target of ["captureSnapshot", "failure"]) {
    const h = harness({ calendarBroken: true, throwOn: { [target]: true } });
    const result = await h.run();
    assert.equal(result.state, "HANDED_OFF", `${target} 실패가 terminal을 바꿨습니다`);
  }
});

// ---------------------------------------------------------------------------
// 3. 비격리 보존 — 현재 전파하는 지점은 계속 전파해야 한다
//    (관측 분리 과정에서 실수로 삼키게 되는 회귀를 막는다)
//    격리 통일 여부는 별도 판단 대상이다: issue #20
// ---------------------------------------------------------------------------

test("deps.emit이 던지면 예외가 start() 밖으로 전파된다", async () => {
  // execute()의 catch가 FAILED 전이를 시도하는데 그 전이가 다시 emit을
  // 부르며 또 던진다. 결과적으로 RunResult가 반환되지 않는다.
  const h = harness({ throwOn: { emit: true } });
  await assert.rejects(() => h.run(), /emit boom/);
});

test("격리되지 않은 trace 지점(DATE_TOGGLE_CYCLE)이 던지면 실행이 FAILED로 죽는다", async () => {
  // 전파된 예외를 execute()의 catch가 받아 FAILED로 종결한다.
  // reject는 아니지만 관측 실패가 예약 실행을 끝낸다는 사실은 같다.
  const h = harness({ throwOn: { trace: "DATE_TOGGLE_CYCLE" } });
  const result = await h.run();

  assert.equal(result.state, "FAILED");
  assert.equal(result.message, "trace boom");
});

test("격리되지 않은 trace 지점(SLOT_CLICKED)이 던지면 실행이 FAILED로 죽는다", async () => {
  const h = harness({
    configOverrides: { dryRun: false },
    throwOn: { trace: "SLOT_CLICKED" },
  });
  const result = await h.run();

  assert.equal(result.state, "FAILED");
  assert.equal(result.message, "trace boom");
});

test("모든 trace가 던지면 FAILED 전이의 RUN_FAILED도 던져 start()가 reject된다", async () => {
  const h = harness({ throwOn: { trace: true } });
  await assert.rejects(() => h.run(), /trace boom/);
});

test("격리된 trace 지점(AVAILABILITY_SHADOW)이 던져도 실행은 계속된다", async () => {
  const h = harness({ throwOn: { trace: "AVAILABILITY_SHADOW" } });
  const result = await h.run();

  assert.equal(result.state, "DRY_RUN_COMPLETED");
});

test("격리된 trace 지점(CLOCK_SAMPLE)이 던져도 terminal 결과가 바뀌지 않는다", async () => {
  const h = harness({ throwOn: { trace: "CLOCK_SAMPLE" } });
  const result = await h.run();

  assert.equal(result.state, "DRY_RUN_COMPLETED");
});

// ---------------------------------------------------------------------------
// 4. 호출 순서와 상호 독립성
// ---------------------------------------------------------------------------

test("failureData는 captureSnapshot 다음에 diagnostics.failure를 호출한다", async () => {
  const h = harness({ calendarBroken: true });
  await h.run();

  const order = h.calls.filter((c) => c === "captureSnapshot" || c === "failure");
  assert.deepStrictEqual(order, ["captureSnapshot", "failure"]);
});

test("captureSnapshot이 던져도 diagnostics.failure는 독립적으로 호출된다", async () => {
  const h = harness({ calendarBroken: true, throwOn: { captureSnapshot: true } });
  await h.run();

  assert.ok(h.calls.includes("failure"), "snapshot 실패가 failure 호출을 막았습니다");
  const order = h.calls.filter((c) => c === "captureSnapshot" || c === "failure");
  assert.deepStrictEqual(order, ["captureSnapshot", "failure"]);
});

test("captureSnapshot이 던지면 snapshot 필드 없이 진단 id만 payload에 남는다", async () => {
  const h = harness({ calendarBroken: true, throwOn: { captureSnapshot: true } });
  await h.run();

  pinPayload(eventData(h.events, "HANDED_OFF"), {
    state: "HANDED_OFF",
    snapshotRunState: "PREPARING_PAGE",
    diagnosticSnapshotId: "diag-1",
  });
});
