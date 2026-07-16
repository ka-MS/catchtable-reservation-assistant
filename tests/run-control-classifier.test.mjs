import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDateFatal, classifyEntryFatal, classifyMonthFatal, classifyPersonFatal, classifyStall,
} from "../dist/shared/run-control/classifier.js";

test("entry: waitingOnly만 fatal", () => {
  assert.equal(classifyEntryFatal({ reservationOpen: false, ctaAvailable: true, waitingOnly: true }), "WAITING_ONLY");
  assert.equal(classifyEntryFatal({ reservationOpen: false, ctaAvailable: false, waitingOnly: false }), null);
});

test("month: 같은 월인데 셀 없음 / 이동 수단 없음이 fatal", () => {
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-08", target: null, monthNavigation: null }, "2026-08"), "DATE_NOT_IN_CALENDAR");
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-07", target: null, monthNavigation: null }, "2026-08"), "MONTH_NAVIGATION_UNAVAILABLE");
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-07", target: null, monthNavigation: { direction: "Next page", available: false } }, "2026-08"), "MONTH_NAVIGATION_UNAVAILABLE");
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-07", target: null, monthNavigation: { direction: "Next page", available: true } }, "2026-08"), null);
  assert.equal(classifyMonthFatal({ displayedMonth: null, target: null, monthNavigation: null }, "2026-08"), null); // 판독 불가는 대기
});

test("date: unavailable만 fatal — 셀 소실은 원인이 아니라 coordinator의 interrupt 재순환이다", () => {
  assert.equal(classifyDateFatal({ displayedMonth: "2026-08", target: { available: false, selected: false }, monthNavigation: null }), "DATE_UNAVAILABLE");
  assert.equal(classifyDateFatal({ displayedMonth: "2026-07", target: null, monthNavigation: null }), null);
  assert.equal(classifyDateFatal({ displayedMonth: "2026-08", target: { available: true, selected: false }, monthNavigation: null }), null);
});

test("person: ready인데 target 불가만 fatal", () => {
  assert.equal(classifyPersonFatal({ ready: true, targetAvailable: false, targetSelected: false }), "PERSON_UNAVAILABLE");
  assert.equal(classifyPersonFatal({ ready: false, targetAvailable: false, targetSelected: false }), null);
});

test("정체 원인은 stage×attempts로 결정된다", () => {
  assert.equal(classifyStall("entry", 0), "ENTRY_CTA_MISSING");
  assert.equal(classifyStall("entry", 2), "ENTRY_TRANSITION_STALLED");
  assert.equal(classifyStall("month", 3), "MONTH_TRANSITION_STALLED");
  assert.equal(classifyStall("date", 0), "DATE_SELECTION_STALLED");
  assert.equal(classifyStall("person", 1), "PERSON_SELECTION_STALLED");
});
