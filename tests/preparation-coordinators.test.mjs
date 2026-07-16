import assert from "node:assert/strict";
import test from "node:test";
import { runEntryPreparation } from "../dist/content/preparation/entry-coordinator.js";
import { runCalendarPreparation } from "../dist/content/preparation/calendar-coordinator.js";
import { runPersonPreparation } from "../dist/content/preparation/person-coordinator.js";

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
function options(h, overrides) {
  return {
    clock: h.clock, sleep: h.sleep, signal: new AbortController().signal,
    stopAtMs: 600_000, discoveryDeadlineAtMs: 5_000, overallDeadlineAtMs: 600_000,
    report: silentReporter, ...overrides,
  };
}

test("entry: waitingOnly는 현행 메시지로 실패한다", async () => {
  const result = await runEntryPreparation({
    inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }),
    openReservation: () => true,
  }, options(harness()));
  assert.equal(result.kind, "failed");
  assert.equal(result.cause, "WAITING_ONLY");
  assert.equal(result.message, "이 식당은 현장 웨이팅만 가능해 예약창을 열 수 없습니다.");
});

test("entry: CTA 미발견은 discovery 메시지, 클릭 후 정체는 transition 메시지", async () => {
  const missing = await runEntryPreparation({
    inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: false }),
    openReservation: () => true,
  }, options(harness()));
  assert.equal(missing.message, "식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.");
  const stalled = await runEntryPreparation({
    inspect: () => ({ reservationOpen: false, ctaAvailable: true, waitingOnly: false }),
    openReservation: () => true,
  }, options(harness()));
  assert.equal(stalled.message, "예약하기 클릭 후 달력 화면을 확인할 수 없습니다.");
  assert.equal(stalled.attempts, 2);
});

test("calendar: 월 이동 후 날짜 선택까지 완주한다", async () => {
  let month = "2026-07";
  let selected = false;
  const port = {
    inspectPreparation: () => (month === "2026-08"
      ? { displayedMonth: month, target: { available: true, selected }, monthNavigation: null }
      : { displayedMonth: month, target: null, monthNavigation: { direction: "Next page", available: true } }),
    clickMonth: () => { month = "2026-08"; return true; },
    clickDate: () => { selected = true; return true; },
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.deepEqual(result, { kind: "ready" });
});

test("calendar: 날짜 준비 중 셀 소실 시 월 이동부터 재순환한다", async () => {
  let phase = 0; // 0: 목표월+셀, 1: 다른월(셀 소실), 2: 복귀+선택됨
  const port = {
    inspectPreparation: () => {
      if (phase === 0) { phase = 1; return { displayedMonth: "2026-08", target: { available: true, selected: false }, monthNavigation: null }; }
      if (phase === 1) { phase = 2; return { displayedMonth: "2026-07", target: null, monthNavigation: { direction: "Next page", available: true } }; }
      return { displayedMonth: "2026-08", target: { available: true, selected: true }, monthNavigation: null };
    },
    clickMonth: () => true,
    clickDate: () => true,
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.deepEqual(result, { kind: "ready" });
});

test("calendar: 날짜 dispatch 2회 소진은 현행 전환 실패 메시지", async () => {
  const port = {
    inspectPreparation: () => ({ displayedMonth: "2026-08", target: { available: true, selected: false }, monthNavigation: null }),
    clickMonth: () => true,
    clickDate: () => true,
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.equal(result.cause, "DATE_SELECTION_STALLED");
  assert.equal(result.message, "목표 날짜 선택 전환을 확인할 수 없습니다.");
});

test("calendar: deadline 초과는 현행 제한 시간 메시지", async () => {
  const port = {
    inspectPreparation: () => ({ displayedMonth: null, target: null, monthNavigation: null }),
    clickMonth: () => true,
    clickDate: () => true,
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.equal(result.message, "목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.");
});

test("person: 불가 인원은 personCount가 포함된 현행 메시지", async () => {
  const result = await runPersonPreparation({
    inspect: () => ({ ready: true, targetAvailable: false, targetSelected: false }),
    select: () => true,
  }, 4, options(harness()));
  assert.equal(result.cause, "PERSON_UNAVAILABLE");
  assert.equal(result.message, "이 식당에서 4명을 선택할 수 없습니다.");
});
