import assert from "node:assert/strict";
import test from "node:test";
import { runPreparationStep } from "../dist/content/preparation/step-runner.js";

function harness(startMs = 0) {
  let now = startMs;
  return {
    clock: { now: () => now },
    sleep: (ms) => { now += ms; return Promise.resolve(true); },
    nowMs: () => now,
  };
}

const silentReporter = {
  stageStart() {}, conditionChanged() {}, dispatchBefore() {}, dispatchAfter() {},
  obstacleDismissed() {}, decision() {}, action() {},
};

function spec(overrides) {
  return {
    stage: "entry",
    inspect: () => ({}),
    conditionKey: () => "steady",
    conditionAttributes: () => ({}),
    isReady: () => false,
    fatal: () => null,
    canDispatch: () => true,
    dispatch: () => true,
    dispatchAction: "open_reservation",
    describeDispatch: (_f, attempt) => `dispatch ${attempt}`,
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
    ...overrides,
  };
}

function options(h, overrides) {
  return {
    clock: h.clock, sleep: h.sleep, signal: new AbortController().signal,
    stopAtMs: 600_000, discoveryDeadlineAtMs: 5_000, overallDeadlineAtMs: 600_000,
    report: silentReporter, ...overrides,
  };
}

test("ready 사실 관측 시 즉시 종료한다", async () => {
  const h = harness();
  assert.deepEqual(await runPreparationStep(spec({ isReady: () => true }), options(h)), { kind: "ready" });
});

test("dispatch 없이 discovery deadline 도달 → stage의 discovery stall cause", async () => {
  const h = harness();
  const outcome = await runPreparationStep(spec({ canDispatch: () => false }), options(h));
  assert.deepEqual(
    { kind: outcome.kind, cause: outcome.cause, via: outcome.via, attempts: outcome.attempts },
    { kind: "failed", cause: "ENTRY_CTA_MISSING", via: "discovery", attempts: 0 },
  );
});

test("예산 2회 소진 후 retryDelay 경과 → confirm stall cause", async () => {
  const h = harness();
  let dispatched = 0;
  const outcome = await runPreparationStep(
    spec({ dispatch: () => { dispatched += 1; return true; } }), options(h));
  assert.equal(dispatched, 2);
  assert.deepEqual(
    { cause: outcome.cause, via: outcome.via, attempts: outcome.attempts },
    { cause: "ENTRY_TRANSITION_STALLED", via: "exhausted", attempts: 2 });
  assert.ok(h.nowMs() >= 2_000);
});

test("fatal 분류 함수가 원인을 반환하면 즉시 실패한다", async () => {
  const h = harness();
  const outcome = await runPreparationStep(spec({ fatal: () => "WAITING_ONLY" }), options(h));
  assert.deepEqual({ cause: outcome.cause, via: outcome.via }, { cause: "WAITING_ONLY", via: "fatal" });
});

test("progressKey 변경은 attempt 예산을 리셋한다(다단 월 이동)", async () => {
  const h = harness();
  let month = "2026-07";
  let clicks = 0;
  const outcome = await runPreparationStep(spec({
    stage: "month",
    isReady: () => month === "2026-09",
    progressKey: () => month,
    dispatch: () => {
      clicks += 1;
      if (clicks % 2 === 0) month = month === "2026-07" ? "2026-08" : "2026-09";
      return true;
    },
    maxAttempts: 3, retryDelayMs: 750, confirmTimeoutMs: undefined,
  }), options(h, { discoveryDeadlineAtMs: 600_000 }));
  assert.equal(outcome.kind, "ready");
  assert.equal(clicks, 4);
});

test("빈 progressKey는 리셋하지 않는다(월 전환 중 판독 불가)", async () => {
  const h = harness();
  let polls = 0;
  const outcome = await runPreparationStep(spec({
    stage: "month",
    progressKey: () => { polls += 1; return polls % 2 === 0 ? "" : "2026-07"; },
    maxAttempts: 3, retryDelayMs: 750, confirmTimeoutMs: undefined,
  }), options(h, { discoveryDeadlineAtMs: 600_000 }));
  assert.deepEqual({ via: outcome.via, attempts: outcome.attempts }, { via: "exhausted", attempts: 3 });
});

test("overall deadline 도달 → deadline via", async () => {
  const h = harness();
  const outcome = await runPreparationStep(
    spec({ stage: "date", canDispatch: () => false }),
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: 3_000 }));
  assert.deepEqual({ cause: outcome.cause, via: outcome.via },
    { cause: "DATE_SELECTION_STALLED", via: "deadline" });
});

test("obstacle 해제 후 즉시 재dispatch를 허용한다(홍보 인터스티셜)", async () => {
  const h = harness();
  let dismissed = false;
  let dispatches = 0;
  const outcome = await runPreparationStep(spec({
    isReady: () => dispatches >= 2 && dismissed,
    dispatch: () => { dispatches += 1; return true; },
    dismissObstacle: () => { if (dispatches === 0 || dismissed) return false; dismissed = true; return true; },
    dismissMessage: "매장 홍보 안내 창을 닫았습니다.",
  }), options(h));
  assert.equal(outcome.kind, "ready");
  assert.equal(dispatches, 2);
});

test("interrupt 토큰은 원인 없이 내부 신호로 종료한다", async () => {
  const outcome = await runPreparationStep(
    spec({ interrupt: () => "target_cell_missing" }), options(harness()));
  assert.deepEqual(outcome, { kind: "interrupted", token: "target_cell_missing", attempts: 0 });
});

test("stopAt 도달 → timed_out, abort → stopped", async () => {
  const out1 = await runPreparationStep(spec({ canDispatch: () => false }),
    options(harness(), { stopAtMs: 200 }));
  assert.equal(out1.kind, "timed_out");
  const controller = new AbortController();
  controller.abort();
  const out2 = await runPreparationStep(spec({}), options(harness(), { signal: controller.signal }));
  assert.equal(out2.kind, "stopped");
});
