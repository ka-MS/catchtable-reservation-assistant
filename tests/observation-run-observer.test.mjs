// `RunObserver`의 **예외 경계 계약**을 메서드 단위로 고정한다.
//
// 계약(SP-026): 모든 공개 메서드는 예외를 밖으로 내보내지 않는다. 지점별로
// 다르지 않다. 삼킨 횟수는 `observationFailures()`로 노출된다.
//
// SP-025/01에서는 격리가 비대칭이었고 이 파일이 그 비대칭을 고정했다.
// SP-026이 통일하면서 전파를 단언하던 5건을 격리 단언으로 뒤집었다.
//
// `sendSafe`가 thunk를 받는 이유도 여기서 고정한다. options 객체를 인자로
// 받으면 `ctx.serverAt()` 스탬핑이 호출 전에 평가돼 경계 밖으로 샌다.
import assert from "node:assert/strict";
import test from "node:test";
import { RunObserver } from "../dist/content/observation/run-observer.js";

const SCAN_WAKE = {
  kind: "scan_wake", cycle: 1, requestSequence: 7, quality: "EXACT", selectedMinutes: 1140,
  responseCompletedMonoMs: 100, payloadClassifiedMonoMs: 110,
  bridgeReceivedMonoMs: 120, wakeAtMonoMs: 130,
};
const EMPTY_EXIT = { ...SCAN_WAKE, kind: "empty_exit", selectedMinutes: null };
const SAMPLE = { t0: 10, t1: 50, serverDateMs: 1_000, rttMs: 40, lowerMs: 950, upperMs: 1_990, fromCache: false };

function observer({ ctx = {}, deps = {} } = {}) {
  const sent = [];
  const base = { now: () => 0, serverAt: () => 500, state: () => "REFRESHING_SLOTS", monoNow: () => 200 };
  return {
    sent,
    o: new RunObserver(
      { ...base, ...ctx },
      {
        emit: () => undefined,
        trace: (code, severity, message, options) => sent.push({ code, severity, message, options }),
        diagnostics: { breadcrumb: () => undefined, failure: () => "diag-1", forceFlush: async () => undefined },
        capturePreparationContext: () => null,
        ...deps,
      },
      "run-1",
    ),
  };
}

const ISOLATED = [
  ["preparation", (o) => o.preparation("stage_start")],
  ["wakeResult", (o) => o.wakeResult(SCAN_WAKE, null, false, true, 0, null, null)],
  ["emptyExit", (o) => o.emptyExit(EMPTY_EXIT, true, false)],
  ["clockSamples", (o) => o.clockSamples({ reason: "terminal", samples: [SAMPLE] })],
];

const ALSO_ISOLATED = [
  ["availabilityDom", (o) => o.availabilityDom({ cycle: 1, requestSequence: null, correlationId: null,
    quality: "NONE", domMinutes: 1140, domObservedMonoMs: 1, bodyClassification: "none",
    bodySelectedMinutes: null, agreement: null, responseCompletedMonoMs: null,
    payloadClassifiedMonoMs: null, bridgeReceivedMonoMs: null, bridgeToDomMs: null,
    targetResponseToDomMs: null, bodyLeadOverDomMs: null, mutationGenerationAtTargetClick: 0,
    mutationGenerationAtDom: 0, mutationObservedAfterTarget: false, lastMutationMonoMs: null }, "dom_compare")],
  ["toggleCycle", (o) => o.toggleCycle(500, { cycle: 1, phase: "precision", adjacentDate: "2026-07-29",
    adjacentPlannedAt: 1, adjacentClickedAt: 1, targetPlannedAt: 2, targetClickedAt: 2,
    targetSelectedAt: 3, slotScanCount: 1, availableSlotCount: 1, matchedSlotCount: 1,
    result: "SLOT_FOUND", watch: "idle", arrivalAt: null, wakeUsed: false,
    wakeRequestSequence: null, wakeCorrelationQuality: null, wakeFallbackUsed: true })],
  ["slotClicked", (o) => o.slotClicked("info", "클릭", 500, "SLOT_CLICK_DISPATCHED", { clickOk: true })],
  ["runFailed", (o) => o.runFailed("실패", { snapshotRunState: "FAILED" }, new Error("x"))],
];

// ---------------------------------------------------------------------------
// 1. 격리 경계는 스탬핑 계산까지 감싼다
// ---------------------------------------------------------------------------

for (const [name, call] of ISOLATED) {
  test(`${name}(): ctx.serverAt()이 던져도 삼킨다`, () => {
    const { o } = observer({ ctx: { serverAt: () => { throw new Error("serverAt boom"); } } });
    assert.doesNotThrow(() => call(o));
  });

  test(`${name}(): ctx.state()가 던져도 삼킨다`, () => {
    const { o } = observer({ ctx: { state: () => { throw new Error("state boom"); } } });
    assert.doesNotThrow(() => call(o));
  });

  test(`${name}(): trace가 던져도 삼킨다`, () => {
    const { o } = observer({ deps: { trace: () => { throw new Error("trace boom"); } } });
    assert.doesNotThrow(() => call(o));
  });
}

test("emptyExit(): ctx.monoNow()가 던져도 삼킨다", () => {
  const { o } = observer({ ctx: { monoNow: () => { throw new Error("mono boom"); } } });
  assert.doesNotThrow(() => o.emptyExit(EMPTY_EXIT, true, false));
});

test("preparation(): capturePreparationContext가 던져도 trace는 나간다", () => {
  const { o, sent } = observer({
    deps: { capturePreparationContext: () => { throw new Error("page boom"); } },
  });
  o.preparation("stage_start");

  assert.equal(sent.length, 1);
  assert.equal(sent[0].code, "PREPARATION_OBSERVED");
  // 페이지 컨텍스트만 빠지고 나머지는 유지된다
  assert.equal(sent[0].options.attributes.pageUrlKind, undefined);
  assert.equal(sent[0].options.attributes.preparationPhase, "stage_start");
});

test("clockSamples(): 한 표본이 실패해도 나머지는 계속 기록된다", () => {
  let calls = 0;
  const { o, sent } = observer({
    deps: {
      trace: (code, severity, message, options) => {
        calls += 1;
        if (calls === 1) throw new Error("first boom");
        sent.push({ code, severity, message, options });
      },
    },
  });
  o.clockSamples({ reason: "armed", samples: [SAMPLE, SAMPLE, SAMPLE] });

  assert.equal(calls, 3, "표본 3개 모두 시도해야 한다");
  assert.equal(sent.length, 2, "실패한 1건을 제외하고 기록된다");
});

// ---------------------------------------------------------------------------
// 2. SP-026 이전에 전파하던 지점도 이제 격리된다 (issue #20)
// ---------------------------------------------------------------------------

for (const [name, call] of ALSO_ISOLATED) {
  test(`${name}(): trace가 던져도 삼킨다`, () => {
    const { o } = observer({ deps: { trace: () => { throw new Error("trace boom"); } } });
    assert.doesNotThrow(() => call(o));
    assert.equal(o.observationFailures(), 1);
  });
}

test("event(): deps.emit이 던져도 삼킨다", () => {
  const { o } = observer({ deps: { emit: () => { throw new Error("emit boom"); } } });
  assert.doesNotThrow(() => o.event("state", "메시지", { state: "CONFIGURED" }));
  assert.equal(o.observationFailures(), 1);
});

test("event(): emit이 던져도 breadcrumb은 시도된다 (별도 경계)", () => {
  let breadcrumbCalled = false;
  const { o } = observer({
    deps: {
      emit: () => { throw new Error("emit boom"); },
      diagnostics: { breadcrumb: () => { breadcrumbCalled = true; }, failure: () => null, forceFlush: async () => undefined },
    },
  });
  o.event("action", "메시지");

  assert.equal(breadcrumbCalled, true, "emit 실패가 breadcrumb을 막으면 안 된다");
  assert.equal(o.observationFailures(), 1);
});

test("event(): breadcrumb이 던져도 삼킨다", () => {
  const { o } = observer({
    deps: { diagnostics: { breadcrumb: () => { throw new Error("bc boom"); }, failure: () => null, forceFlush: async () => undefined } },
  });
  assert.doesNotThrow(() => o.event("action", "메시지"));
});

// ---------------------------------------------------------------------------
// 2-1. 실패 카운트
// ---------------------------------------------------------------------------

test("observationFailures()는 실패가 없으면 0이다", () => {
  const { o } = observer();
  o.preparation("stage_start");
  o.event("state", "메시지", { state: "CONFIGURED" });
  assert.equal(o.observationFailures(), 0);
});

test("observationFailures()는 여러 경계의 실패를 누적한다", () => {
  const { o } = observer({
    deps: {
      trace: () => { throw new Error("trace boom"); },
      emit: () => { throw new Error("emit boom"); },
    },
  });
  o.preparation("stage_start");            // trace 실패 1
  o.toggleCycle(1, { cycle: 1, phase: "p", adjacentDate: null, adjacentPlannedAt: 0,
    adjacentClickedAt: null, targetPlannedAt: 0, targetClickedAt: null, targetSelectedAt: null,
    slotScanCount: 0, availableSlotCount: 0, matchedSlotCount: 0, result: "NO_SLOT",
    watch: "idle", arrivalAt: null, wakeUsed: false, wakeRequestSequence: null,
    wakeCorrelationQuality: null, wakeFallbackUsed: true });   // trace 실패 2
  o.event("state", "메시지", { state: "CONFIGURED" });          // emit 실패 3

  assert.equal(o.observationFailures(), 3);
});

test("clockSamples()의 표본별 실패가 각각 집계된다", () => {
  const { o } = observer({ deps: { trace: () => { throw new Error("trace boom"); } } });
  o.clockSamples({ reason: "armed", samples: [SAMPLE, SAMPLE, SAMPLE] });

  assert.equal(o.observationFailures(), 3);
});

// ---------------------------------------------------------------------------
// 3. 스탬핑 계약
// ---------------------------------------------------------------------------

test("clockSamples()는 state를 null로 싣는다 (terminal prune 반복 방지)", () => {
  const { o, sent } = observer();
  o.clockSamples({ reason: "armed", samples: [SAMPLE] });

  assert.equal(sent[0].options.state, null);
  assert.equal(sent[0].options.serverAt, 500);
});

test("toggleCycle()은 호출자가 넘긴 serverAt과 고정 state를 쓴다", () => {
  const { o, sent } = observer({ ctx: { serverAt: () => 999, state: () => "SLOT_DETECTED" } });
  o.toggleCycle(777, { cycle: 1, phase: "precision", adjacentDate: null, adjacentPlannedAt: 1,
    adjacentClickedAt: null, targetPlannedAt: 2, targetClickedAt: null, targetSelectedAt: null,
    slotScanCount: 0, availableSlotCount: 0, matchedSlotCount: 0, result: "NO_SLOT",
    watch: "idle", arrivalAt: null, wakeUsed: false, wakeRequestSequence: null,
    wakeCorrelationQuality: null, wakeFallbackUsed: true });

  assert.equal(sent[0].options.serverAt, 777, "컨텍스트가 아니라 인자를 써야 한다");
  assert.equal(sent[0].options.state, "REFRESHING_SLOTS", "고정 상태여야 한다");
});

test("stateChanged()는 breadcrumb 대상 상태에서만 스냅샷을 만든다", () => {
  const stages = [];
  const deps = { diagnostics: { breadcrumb: (stage) => stages.push(stage), failure: () => null, forceFlush: async () => undefined } };
  const { o } = observer({ deps });

  o.stateChanged("PREPARING_PAGE", "이유");        // 대상
  o.stateChanged("REFRESHING_SLOTS", "이유");      // 비대상 (핫패스)
  o.stateChanged("SLOT_DETECTED", "이유");         // 비대상 (핫패스)
  o.stateChanged("ADVANCING_RESERVATION", "이유"); // 대상

  assert.deepStrictEqual(stages, ["PREPARING_PAGE", "ADVANCING_RESERVATION"]);
});

// ---------------------------------------------------------------------------
// 4. failureData — 관측이 제어에 값을 주는 유일한 지점
// ---------------------------------------------------------------------------

test("failureData()는 snapshot 실패 후에도 diagnostics.failure를 부른다", () => {
  const order = [];
  const { o } = observer({
    deps: {
      captureSnapshot: () => { order.push("snapshot"); throw new Error("snap boom"); },
      diagnostics: { breadcrumb: () => undefined, failure: () => { order.push("failure"); return "diag-9"; }, forceFlush: async () => undefined },
    },
  });
  const data = o.failureData("이유");

  assert.deepStrictEqual(order, ["snapshot", "failure"]);
  assert.deepStrictEqual(data, { snapshotRunState: "REFRESHING_SLOTS", diagnosticSnapshotId: "diag-9" });
});

test("failureData()는 ctx.state()가 던져도 삼키고 extra만 돌려준다", () => {
  // handoff·timeout·execute() catch에서 불리므로 여기서 던지면 terminal
  // 처리 자체가 깨진다. 상태 조회까지 경계 안이어야 한다.
  const { o } = observer({ ctx: { state: () => { throw new Error("state boom"); } } });

  assert.deepStrictEqual(o.failureData("이유", { extra: 1 }), { extra: 1 });
  assert.equal(o.observationFailures(), 1);
});

test("failureData()는 captureSnapshot이 던져도 상태·진단 id를 유지한다", () => {
  const { o } = observer({ deps: { captureSnapshot: () => { throw new Error("snap boom"); } } });

  assert.deepStrictEqual(o.failureData("이유"), {
    snapshotRunState: "REFRESHING_SLOTS",
    diagnosticSnapshotId: "diag-1",
  });
});

test("failureData()는 diagnostics.failure 실패 시 id를 생략한다", () => {
  const { o } = observer({
    deps: {
      captureSnapshot: () => null,
      diagnostics: { breadcrumb: () => undefined, failure: () => { throw new Error("f boom"); }, forceFlush: async () => undefined },
    },
  });

  assert.deepStrictEqual(o.failureData("이유", { extra: 1 }), { snapshotRunState: "REFRESHING_SLOTS", extra: 1 });
});
