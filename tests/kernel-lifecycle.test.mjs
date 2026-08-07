import assert from "node:assert/strict";
import test from "node:test";
import { OpenRunOrchestrator } from "../dist/content/orchestrator.js";

// SP-025/02 특성화(characterization) 테스트.
//
// 이 단계의 위험은 payload가 아니라 **순서**다. 커널·흐름 경계를 그으면
// startup·cleanup이 훅 뒤로 숨는데, 기존 스위트는 그 순서를 고정하지
// 않는다(`slotWatchCalls`는 횟수만 센다). 추출 **전에** 현재 순서를
// 못 박아 두고, 추출 후 같은 배열이 나오는지로 동작 무변경을 증명한다.
//
// 기대값은 손으로 적지 않고 추출 전 실행에서 덤프해 붙여넣었다
// (20-design §성공 기준 8).

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
 * 생명주기 호출을 하나의 시간순 배열로 모으는 harness.
 * 각 포트는 호출 시점에 `log`에 자기 이름을 남긴다.
 */
function lifecycleHarness({
  onSlotWatchStop = null,
  completionRun = null,
  captureTakePin = null,
} = {}) {
  const log = [];
  let now = 0;
  let monotonicNow = 0;
  let cycles = 0;

  const referenceEstimate = {
    offsetLowerMs: 0, offsetCenterMs: 0, offsetUpperMs: 0,
    uncertaintyMs: 0, confidence: "HIGH",
    dominantClusterSupport: 1, competingClusterSupport: 0, clusterSeparationMs: -1,
    medianRttMs: 0, p95RttMs: 0, sampleCount: 1, observationSpanMs: 0,
    source: "APP_HEAD_HTTP_DATE", updatedAtMonoMs: 0,
  };
  const referencePort = {
    get latest() { return referenceEstimate; },
    sampleOnce: async () => ({ t0: 10, t1: 50, serverDateMs: 1_000, rttMs: 40, lowerMs: 950, upperMs: 1_990, fromCache: false }),
    ingest: () => referenceEstimate,
    drainSamples: () => [],
    start: () => new Promise(() => {}),
    stop: () => { log.push("referenceClock.stop"); },
  };

  const dateClickTimes = [];
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    monotonicClock: { now: () => monotonicNow },
    referenceClock: () => referencePort,
    calendar: {
      inspect: () => {
        const lastTargetClick = dateClickTimes.findLast((e) => e.date === "2026-07-30");
        return {
          targetAvailable: true,
          targetSelected: lastTargetClick === undefined || now >= lastTargetClick.at,
          adjacentDate: "2026-07-29",
        };
      },
      inspectPreparation: () => ({ displayedMonth: "2026-07", target: { available: true, selected: true }, monthNavigation: null }),
      clickMonth: () => true,
      clickDate: (date) => {
        dateClickTimes.push({ date, at: now });
        if (date === "2026-07-30") cycles += 1;
        return true;
      },
    },
    entry: { inspect: () => ({ reservationOpen: true, ctaAvailable: true, waitingOnly: false }), openReservation: () => true },
    person: { inspect: () => ({ ready: true, targetAvailable: true, targetSelected: true }), select: () => true },
    slots: {
      readAvailableSlots: () => (cycles >= 1 ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : []),
      clickSlot: () => true,
    },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
    availabilityShadow: {
      start: () => { log.push("shadow.start"); },
      markTargetCycle: () => undefined,
      stop: () => { log.push("shadow.stop"); },
    },
    slotWatch: {
      start: () => { log.push("slotWatch.start"); },
      stop: () => {
        log.push("slotWatch.stop");
        onSlotWatchStop?.();
      },
    },
    slotDomMutationWatch: {
      start: () => { log.push("mutationWatch.start"); },
      stop: () => { log.push("mutationWatch.stop"); },
      snapshot: () => ({ generation: 0, lastMutationMonoMs: null }),
    },
    sleep: async (ms, signal) => {
      if (signal.aborted) return false;
      now += ms;
      monotonicNow += ms;
      return true;
    },
    emit: () => undefined,
    trace: () => undefined,
    flushTrace: async () => { log.push("flushTrace"); },
    captureSnapshot: () => ({
      urlKind: "shop", headings: [], buttons: ["확인"], disabledButtons: [false],
      disabledButtonCount: 0, dialogLabel: "", dialogTitle: "", textSnippet: "", fingerprint: "ss-test",
    }),
    capturePreparationContext: () => ({
      visibilityState: "visible", hasFocus: true, viewportWidth: 1280, viewportHeight: 720,
      visualViewportWidth: 1280, visualViewportHeight: 720,
      activeElementTag: "button", activeElementRole: null, activeElementId: "reserve",
      urlKind: "shop", fingerprint: "ss-preparation",
    }),
    readShopDisplayName: () => "케아",
    diagnostics: {
      breadcrumb: () => undefined,
      failure: () => "ds-test",
      forceFlush: async () => { log.push("diagnostics.forceFlush"); },
    },
    ...(completionRun
      ? {
        completion: {
          run: async (cfg, intent, signal, takePin) => {
            log.push("completion.run");
            captureTakePin?.(takePin);
            return completionRun();
          },
        },
      }
      : {}),
    runId: () => "run-1",
  });

  return { orchestrator, log };
}

test("실행 생명주기의 startup·cleanup 호출 순서가 고정돼 있다", async () => {
  const h = lifecycleHarness();
  const result = await h.orchestrator.start(config());

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepStrictEqual(h.log, [
    "shadow.start",
    "slotWatch.start",
    // 기준시계는 arm 시점(waitForOpen)에 멈춘다. mutationWatch를 켜는
    // searchAndReserve보다 앞이다.
    "referenceClock.stop",
    "mutationWatch.start",
    "shadow.stop",
    "slotWatch.stop",
    "mutationWatch.stop",
    "diagnostics.forceFlush",
    "flushTrace",
  ]);
});

test("PIN은 흐름 cleanup보다 먼저 폐기된다", async () => {
  let captured = null;
  const pinAtCleanup = [];
  const h = lifecycleHarness({
    completionRun: () => ({ kind: "completed", message: "성공 근거 확인" }),
    captureTakePin: (takePin) => { captured = takePin; },
    // cleanup 한가운데에서 PIN을 다시 꺼내 본다. 폐기가 cleanup보다
    // 먼저 일어났다면 undefined여야 한다.
    onSlotWatchStop: () => { pinAtCleanup.push(captured?.()); },
  });

  const result = await h.orchestrator.start(
    config({ dryRun: false, reservationCompletionEnabled: true, maxPaymentAmountKrw: 500_000 }),
    undefined,
    undefined,
    { catchPayPin: "1234" },
  );

  assert.equal(result.state, "COMPLETED");
  assert.ok(h.log.includes("completion.run"), "completion 경로에 도달해야 한다");
  assert.deepStrictEqual(pinAtCleanup, [undefined]);
});

// #27: cleanup 도중 포트가 던져도 나머지 원복과 flush가 끝나고 RunResult가
// 돌아온다. 이전에는 `finally`가 그 자리에서 중단돼 flush가 실행되지 않고
// 예외가 `start()` 밖으로 나갔다(사이드패널이 결과 대신 예외를 봄).
//
// 이 테스트가 증명하는 것은 **흐름 cleanup 내부의 복원력**이다.
// `RunKernel.execute()`의 `try { flow.cleanup(); }` 가드는 이 경로로
// 도달하지 않는다 — 그 가드를 제거해도 이 테스트는 통과한다. 가드는 훅
// 경계의 계약이며 두 번째 흐름을 위한 것이라, 현재 흐름만으로는 기계적으로
// 증명할 수 없다. 근거는 워크로그에 남겼다.
test("흐름 cleanup이 던져도 커널 정리와 flush는 끝나고 RunResult가 돌아온다", async () => {
  const h = lifecycleHarness({
    onSlotWatchStop: () => { throw new Error("cleanup 실패"); },
  });

  const result = await h.orchestrator.start(config());

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepStrictEqual(h.log, [
    "shadow.start",
    "slotWatch.start",
    "referenceClock.stop",
    "mutationWatch.start",
    "shadow.stop",
    "slotWatch.stop",
    // slotWatch.stop이 던졌지만 흐름 cleanup의 나머지도, 커널의 flush도 끝난다.
    "mutationWatch.stop",
    "diagnostics.forceFlush",
    "flushTrace",
  ]);
});
