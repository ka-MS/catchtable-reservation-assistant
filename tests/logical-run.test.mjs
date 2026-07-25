import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAttemptOutcome, applyBackgroundTerminal, applyCompletionDispatchClaim, applyPhaseChange,
  applyRecoveryLapse, beginNextAttempt, createLogicalRun, isAcknowledgedCompletionClaim,
  markRecoveryDispatched, markTerminalEffectsCompleted, requestCompletionStop,
} from "../dist/shared/run-control/logical-run.js";

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: 1_000_000, reservationDate: "2026-08-20", personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 }, priorityTimes: [],
    postSlotEnabled: false, paymentMethodAutoAdvance: false, paymentMethodPolicy: "selected_allowed",
    tablePreference: "any", menuKeyword: "", stopAtMs: 2_000_000,
    entryMode: "auto", dryRun: true, preOpenLeadMs: 300, toggleIntervalMs: 400,
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    ...createLogicalRun({
      logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(),
      tabId: 7, attemptId: "run-a1", nowMs: 0,
    }),
    ...overrides,
  };
}

const prepFailed = (overrides = {}) => ({
  kind: "preparation_failed", state: "HANDED_OFF", cause: "DATE_SELECTION_STALLED",
  attempts: 2, message: "목표 날짜 선택 전환을 확인할 수 없습니다.", finishedAt: 10_000, ...overrides,
});

test("생성: PREPARING + attempt 1개 + resetCount 0", () => {
  const r = run();
  assert.equal(r.status, "PREPARING");
  assert.equal(r.currentAttemptId, "run-a1");
  assert.deepEqual(r.attempts.map((a) => a.runId), ["run-a1"]);
  assert.equal(r.resetCount, 0);
});

test("준비 정체 + 여유 시간 → RECOVERING, resetCount 1, nextAttemptId 영속", () => {
  const out = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2");
  assert.equal(out.kind, "ack");
  assert.equal(out.decision, "RESET_PAGE");
  assert.equal(out.run.status, "RECOVERING");
  assert.equal(out.run.resetCount, 1);
  assert.deepEqual(out.run.recovery, { sourceAttemptId: "run-a1", nextAttemptId: "run-a2", action: "RESET_PAGE" });
  const a1 = out.run.attempts.find((a) => a.runId === "run-a1");
  assert.equal(a1.decision, "RESET_PAGE");
  assert.equal(a1.message, "목표 날짜 선택 전환을 확인할 수 없습니다.");
  assert.equal(a1.finishedAt, 10_000);
});

test("종결 원인·예산 소진·오픈 임박·prepared 모드는 HANDOFF → TERMINAL", () => {
  for (const [r, outcome, now] of [
    [run(), prepFailed({ cause: "DATE_UNAVAILABLE" }), 10_000],
    [run({ resetCount: 1 }), prepFailed(), 10_000],
    [run(), prepFailed(), 990_000], // msToOpen 10s < RESET_MIN_LEAD
    [run({ config: config({ entryMode: "prepared" }) }), prepFailed(), 10_000],
  ]) {
    const out = applyAttemptOutcome(r, "run-a1", outcome, now, "run-a2");
    assert.equal(out.decision, "HANDOFF");
    assert.equal(out.run.status, "TERMINAL");
    assert.equal(out.run.recovery, undefined);
  }
});

test("terminal outcome은 decision TERMINAL로 종결한다 (ACK disposition)", () => {
  const out = applyAttemptOutcome(run(), "run-a1",
    { kind: "terminal", state: "DRY_RUN_COMPLETED", message: "dry-run 완료", finishedAt: 5 }, 5, "run-a2");
  assert.deepEqual({ kind: out.kind, decision: out.decision, status: out.run.status },
    { kind: "ack", decision: "TERMINAL", status: "TERMINAL" });
});

test("EXECUTING 진입 후 preparation_failed는 RESET을 금지한다", () => {
  const executing = applyPhaseChange(run(), "run-a1", "EXECUTING").run;
  const out = applyAttemptOutcome(executing, "run-a1", prepFailed(), 10_000, "run-a2");
  assert.equal(out.decision, "HANDOFF");
});

test("재전송 조회 순서: 결정된 attempt 재전송은 replay, payload 불일치는 outcome_conflict, 미결정 비current는 stale", () => {
  const decided = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2").run;
  const replay = applyAttemptOutcome(decided, "run-a1", prepFailed(), 11_000, "run-a3");
  assert.deepEqual({ kind: replay.kind, decision: replay.decision }, { kind: "replay", decision: "RESET_PAGE" });
  assert.equal(decided.resetCount, 1); // replay는 새 run을 만들지 않는다(이중 증가 없음)
  const conflict = applyAttemptOutcome(decided, "run-a1", prepFailed({ message: "다른 메시지" }), 11_000, "run-a3");
  assert.deepEqual(conflict, { kind: "reject", reason: "outcome_conflict" });
  const next = beginNextAttempt(decided, 12_000);
  const stale = applyAttemptOutcome(next, "run-zzz", prepFailed(), 13_000, "run-a9");
  assert.deepEqual(stale, { kind: "reject", reason: "stale_attempt" });
});

test("phase 단조: PREPARING→EXECUTING ok, 중복 재ACK, 역행 거부", () => {
  const r = run();
  const ok = applyPhaseChange(r, "run-a1", "EXECUTING");
  assert.deepEqual({ kind: ok.kind, status: ok.run.status }, { kind: "ok", status: "EXECUTING" });
  assert.equal(applyPhaseChange(ok.run, "run-a1", "EXECUTING").kind, "replay");
  assert.equal(applyPhaseChange(r, "run-a1", "PREPARING").kind, "replay");
  assert.deepEqual(applyPhaseChange(ok.run, "run-a1", "PREPARING"), { kind: "reject", reason: "phase_regression" });
  assert.deepEqual(applyPhaseChange(r, "run-x", "EXECUTING"), { kind: "reject", reason: "stale_attempt" });
});

test("beginNextAttempt은 단일 전이로 attempts 추가·current 교체·PREPARING·recovery 제거를 수행한다", () => {
  const recovering = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2").run;
  const dispatched = markRecoveryDispatched(recovering, 10_500);
  assert.equal(dispatched.recovery.dispatchedAt, 10_500);
  const next = beginNextAttempt(dispatched, 11_000);
  assert.deepEqual({
    status: next.status, current: next.currentAttemptId,
    ids: next.attempts.map((a) => a.runId), recovery: next.recovery,
  }, { status: "PREPARING", current: "run-a2", ids: ["run-a1", "run-a2"], recovery: undefined });
});

test("recovery lapse는 TERMINAL로 전환하고 recovery를 제거한다", () => {
  const recovering = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2").run;
  const lapsed = applyRecoveryLapse(recovering, 995_000);
  assert.deepEqual({ status: lapsed.status, recovery: lapsed.recovery },
    { status: "TERMINAL", recovery: undefined });
});

test("background terminal은 종결 기록을 남기되 decision은 찍지 않는다(재ACK할 content 메시지가 없다)", () => {
  const r = applyBackgroundTerminal(run(), "STOPPED", "실행 탭이 닫혔습니다.", 20_000);
  const a1 = r.attempts.find((a) => a.runId === "run-a1");
  assert.deepEqual({ status: r.status, state: a1.finalState, decision: a1.decision, message: a1.message },
    { status: "TERMINAL", state: "STOPPED", decision: undefined, message: "실행 탭이 닫혔습니다." });
});

test("이미 TERMINAL인 run에 도착한 늦은 outcome은 재decide 없이 TERMINAL로 기록한다", () => {
  const stopped = applyBackgroundTerminal(run(), "STOPPED", "실행 탭이 닫혔습니다.", 20_000);
  const out = applyAttemptOutcome(stopped, "run-a1", prepFailed(), 21_000, "run-a2");
  assert.equal(out.decision, "TERMINAL");
  assert.equal(out.run.status, "TERMINAL");
  assert.equal(out.run.resetCount, 0);
});

test("markTerminalEffectsCompleted는 완료 시각을 남긴다", () => {
  const done = markTerminalEffectsCompleted(
    applyBackgroundTerminal(run(), "STOPPED", "중지", 1), 2);
  assert.equal(done.terminalEffectsCompletedAt, 2);
});

function executingRun(overrides = {}) {
  return { ...applyPhaseChange(run(), "run-a1", "EXECUTING").run, ...overrides };
}

const FINGERPRINT_A = "fp-shop-slug-2026-08-20-1140-2-20000-form1";
const FINGERPRINT_B = "fp-shop-slug-2026-08-20-1140-2-0-form2";

test("outer claim은 active EXECUTING attempt에서 한 번만 영속되고 claim에는 PIN이 없다", () => {
  const app = applyCompletionDispatchClaim(executingRun(), "run-a1", "outer", FINGERPRINT_A, 100);
  assert.equal(app.kind, "ack");
  assert.deepEqual(app.run.completionDispatch, { fingerprint: FINGERPRINT_A, outerClaimedAt: 100 });
  assert.equal(JSON.stringify(app.run.completionDispatch).toLowerCase().includes("pin"), false);
});

test("같은 phase·fingerprint 재전송은 멱등 replay이고 새 dispatch 권한을 만들지 않는다", () => {
  const claimed = applyCompletionDispatchClaim(executingRun(), "run-a1", "outer", FINGERPRINT_A, 100).run;
  const replay = applyCompletionDispatchClaim(claimed, "run-a1", "outer", FINGERPRINT_A, 200);
  assert.deepEqual(replay, { kind: "replay" });
  // 재전송이 outerClaimedAt을 다시 찍지 않는다(새 권한 없음).
  assert.equal(claimed.completionDispatch.outerClaimedAt, 100);
});

test("다른 fingerprint의 outer 재요청은 거절한다", () => {
  const claimed = applyCompletionDispatchClaim(executingRun(), "run-a1", "outer", FINGERPRINT_A, 100).run;
  const conflict = applyCompletionDispatchClaim(claimed, "run-a1", "outer", FINGERPRINT_B, 200);
  assert.deepEqual(conflict, { kind: "reject", reason: "fingerprint_mismatch" });
});

test("stale attempt(비current)의 claim 요청은 거절한다", () => {
  const stale = applyCompletionDispatchClaim(executingRun(), "run-zzz", "outer", FINGERPRINT_A, 100);
  assert.deepEqual(stale, { kind: "reject", reason: "stale_attempt" });
});

test("EXECUTING이 아닌 attempt의 claim 요청은 거절한다", () => {
  const preparing = applyCompletionDispatchClaim(run(), "run-a1", "outer", FINGERPRINT_A, 100);
  assert.deepEqual(preparing, { kind: "reject", reason: "stale_attempt" });
});

test("pin-before-outer는 거절한다", () => {
  const beforeOuter = applyCompletionDispatchClaim(executingRun(), "run-a1", "pin", FINGERPRINT_A, 100);
  assert.deepEqual(beforeOuter, { kind: "reject", reason: "phase_order" });
});

test("outer claim 뒤 pin claim은 같은 fingerprint에서만 영속되고 다른 fingerprint는 거절한다", () => {
  const claimed = applyCompletionDispatchClaim(executingRun(), "run-a1", "outer", FINGERPRINT_A, 100).run;
  const mismatched = applyCompletionDispatchClaim(claimed, "run-a1", "pin", FINGERPRINT_B, 200);
  assert.deepEqual(mismatched, { kind: "reject", reason: "fingerprint_mismatch" });
  const pinApp = applyCompletionDispatchClaim(claimed, "run-a1", "pin", FINGERPRINT_A, 200);
  assert.equal(pinApp.kind, "ack");
  assert.deepEqual(pinApp.run.completionDispatch,
    { fingerprint: FINGERPRINT_A, outerClaimedAt: 100, pinClaimedAt: 200 });
  const pinReplay = applyCompletionDispatchClaim(pinApp.run, "run-a1", "pin", FINGERPRINT_A, 300);
  assert.deepEqual(pinReplay, { kind: "replay" });
});

test("pin claim 뒤 outer 재요청은 phase 역행으로 거절한다", () => {
  const claimed = applyCompletionDispatchClaim(executingRun(), "run-a1", "outer", FINGERPRINT_A, 100).run;
  const pinned = applyCompletionDispatchClaim(claimed, "run-a1", "pin", FINGERPRINT_A, 200).run;
  const regressed = applyCompletionDispatchClaim(pinned, "run-a1", "outer", FINGERPRINT_A, 300);
  assert.deepEqual(regressed, { kind: "reject", reason: "phase_order" });
});

test("stop-before-outer는 outer claim을 거절한다", () => {
  const stopped = requestCompletionStop(executingRun(), 50);
  assert.equal(stopped.completionDispatch.stopRequestedAt, 50);
  assert.equal(stopped.completionDispatch.fingerprint, undefined);
  const rejected = applyCompletionDispatchClaim(stopped, "run-a1", "outer", FINGERPRINT_A, 100);
  assert.deepEqual(rejected, { kind: "reject", reason: "stop_requested" });
});

test("stop-after-outer는 stop marker를 영속하고 pin claim을 거절한다", () => {
  const claimed = applyCompletionDispatchClaim(executingRun(), "run-a1", "outer", FINGERPRINT_A, 100).run;
  const stopped = requestCompletionStop(claimed, 150);
  assert.deepEqual(stopped.completionDispatch,
    { fingerprint: FINGERPRINT_A, outerClaimedAt: 100, stopRequestedAt: 150 });
  const pinRejected = applyCompletionDispatchClaim(stopped, "run-a1", "pin", FINGERPRINT_A, 200);
  assert.deepEqual(pinRejected, { kind: "reject", reason: "stop_requested" });
});

test("pin claim ACK 뒤 stop은 이미 허용된 dispatch를 취소 완료로 오판하지 않는다", () => {
  const claimed = applyCompletionDispatchClaim(executingRun(), "run-a1", "outer", FINGERPRINT_A, 100).run;
  const pinned = applyCompletionDispatchClaim(claimed, "run-a1", "pin", FINGERPRINT_A, 200).run;
  const stopped = requestCompletionStop(pinned, 250);
  // 이미 허용된 pin dispatch 권한은 그대로 남는다 — stop이 되돌리거나 지우지 않는다.
  assert.equal(stopped.completionDispatch.pinClaimedAt, 200);
  assert.equal(stopped.completionDispatch.outerClaimedAt, 100);
  assert.equal(stopped.status, "EXECUTING"); // stop이 임의로 run을 종결 상태로 바꾸지 않는다
  assert.equal(stopped.completionDispatch.stopRequestedAt, 250);
});

test("requestCompletionStop은 멱등이다 — 이미 기록된 stopRequestedAt을 덮어쓰지 않는다", () => {
  const stoppedOnce = requestCompletionStop(executingRun(), 50);
  const stoppedTwice = requestCompletionStop(stoppedOnce, 999);
  assert.equal(stoppedTwice.completionDispatch.stopRequestedAt, 50);
});

test("isAcknowledgedCompletionClaim은 malformed persisted 객체를 엄격히 거부한다", () => {
  assert.equal(isAcknowledgedCompletionClaim(undefined), false);
  assert.equal(isAcknowledgedCompletionClaim({ stopRequestedAt: 10 }), false); // pre-claim variant
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: FINGERPRINT_A, outerClaimedAt: 10 }), true);
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: FINGERPRINT_A, outerClaimedAt: 10, pinClaimedAt: 20 }), true);
  // non-empty string이 아닌 fingerprint는 acknowledged로 인정하지 않는다.
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: "", outerClaimedAt: 10 }), false);
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: 12345, outerClaimedAt: 10 }), false);
  assert.equal(isAcknowledgedCompletionClaim({ outerClaimedAt: 10 }), false);
  // finite number가 아닌 outerClaimedAt은 acknowledged로 인정하지 않는다.
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: FINGERPRINT_A, outerClaimedAt: Number.NaN }), false);
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: FINGERPRINT_A, outerClaimedAt: Number.POSITIVE_INFINITY }), false);
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: FINGERPRINT_A, outerClaimedAt: "10" }), false);
  assert.equal(isAcknowledgedCompletionClaim({ fingerprint: FINGERPRINT_A }), false);
  assert.equal(isAcknowledgedCompletionClaim(null), false);
  assert.equal(isAcknowledgedCompletionClaim("not-an-object"), false);
});
