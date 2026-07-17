import assert from "node:assert/strict";
import test from "node:test";
import { runTerminalEffects } from "../dist/background/terminal-effects.js";
import { applyAttemptOutcome, applyBackgroundTerminal, createLogicalRun } from "../dist/shared/run-control/logical-run.js";

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

function terminalRun(state, message, origin = { kind: "manual" }) {
  const base = createLogicalRun({
    logicalRunId: "lr-1", origin, config: config(), tabId: 7, attemptId: "run-a1", nowMs: 0,
  });
  const out = applyAttemptOutcome(base, "run-a1",
    { kind: "terminal", state, message, finishedAt: 42 }, 50, "run-a2");
  return out.run;
}

function deps() {
  const calls = { badges: [], notifications: [], jobs: [] };
  return {
    calls,
    setBadge: async (color, text) => { calls.badges.push({ color, text }); },
    notify: (id, message) => { calls.notifications.push({ id, message }); },
    finishJob: async (jobId, state, message, finishedAt) => {
      calls.jobs.push({ jobId, state, message, finishedAt });
    },
  };
}

test("HANDED_OFF·DRY_RUN_COMPLETED는 주황 배지와 알림", async () => {
  for (const state of ["HANDED_OFF", "DRY_RUN_COMPLETED"]) {
    const d = deps();
    await runTerminalEffects(terminalRun(state, "인계했습니다."), d);
    assert.deepEqual(d.calls.badges, [{ color: "#ff5a1f", text: "!" }]);
    assert.deepEqual(d.calls.notifications, [{ id: "run-terminal:lr-1", message: "인계했습니다." }]);
  }
});

test("STOPPED는 회색 배지·알림 없음, TIMED_OUT/FAILED는 알림 있음", async () => {
  const stopped = deps();
  await runTerminalEffects(terminalRun("STOPPED", "중지했습니다."), stopped);
  assert.deepEqual(stopped.calls.badges, [{ color: "#4b5563", text: "" }]);
  assert.deepEqual(stopped.calls.notifications, []);
  for (const state of ["TIMED_OUT", "FAILED"]) {
    const d = deps();
    await runTerminalEffects(terminalRun(state, "종료 사유"), d);
    assert.equal(d.calls.notifications.length, 1);
  }
});

test("scheduled origin은 영속된 message·finishedAt으로 finishJob을 호출한다", async () => {
  const d = deps();
  await runTerminalEffects(
    terminalRun("HANDED_OFF", "인계했습니다.", { kind: "scheduled", jobId: "job-9" }), d);
  assert.deepEqual(d.calls.jobs, [{ jobId: "job-9", state: "HANDED_OFF", message: "인계했습니다.", finishedAt: 42 }]);
});

test("이중 실행은 같은 결정적 알림 ID를 재사용한다 (멱등)", async () => {
  const d = deps();
  const run = terminalRun("HANDED_OFF", "인계했습니다.");
  await runTerminalEffects(run, d);
  await runTerminalEffects(run, d);
  assert.deepEqual(d.calls.notifications.map((n) => n.id),
    ["run-terminal:lr-1", "run-terminal:lr-1"]);
});

test("background 종결(decision 없는 attempt)도 영속된 message로 효과를 낸다", async () => {
  const d = deps();
  const run = applyBackgroundTerminal(createLogicalRun({
    logicalRunId: "lr-2", origin: { kind: "scheduled", jobId: "job-1" },
    config: config(), tabId: 7, attemptId: "run-b1", nowMs: 0,
  }), "STOPPED", "실행 탭이 닫혔습니다.", 99);
  await runTerminalEffects(run, d);
  assert.deepEqual(d.calls.jobs, [{ jobId: "job-1", state: "STOPPED", message: "실행 탭이 닫혔습니다.", finishedAt: 99 }]);
  assert.deepEqual(d.calls.notifications, []);
});
