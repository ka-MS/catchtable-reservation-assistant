import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAttemptOutcome, applyBackgroundTerminal, applyPhaseChange, applyRecoveryLapse,
  beginNextAttempt, createLogicalRun, markRecoveryDispatched, markTerminalEffectsCompleted,
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
