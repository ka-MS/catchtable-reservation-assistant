import assert from "node:assert/strict";
import test from "node:test";
import { decide, RESET_MIN_LEAD_MS } from "../dist/shared/run-control/policy.js";

const openFar = { msToOpen: 120_000, msToStop: 600_000 };
const auto = { entryMode: "auto" };

test("정체 원인 + 예산 있음 + 오픈 여유 → RESET_PAGE", () => {
  assert.deepEqual(
    decide("DATE_SELECTION_STALLED", { resetCount: 0 }, openFar, auto),
    { kind: "RESET_PAGE", cause: "DATE_SELECTION_STALLED" },
  );
});

test("종결 원인은 항상 HANDOFF", () => {
  for (const cause of ["WAITING_ONLY", "PERSON_UNAVAILABLE", "DATE_UNAVAILABLE", "DATE_NOT_IN_CALENDAR", "MONTH_NAVIGATION_UNAVAILABLE"]) {
    assert.equal(decide(cause, { resetCount: 0 }, openFar, auto).kind, "HANDOFF");
  }
});

test("reset 예산 소진 / 오픈 임박 / stopAt 임박 / prepared 모드 → HANDOFF", () => {
  assert.equal(decide("ENTRY_TRANSITION_STALLED", { resetCount: 1 }, openFar, auto).kind, "HANDOFF");
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, { msToOpen: RESET_MIN_LEAD_MS, msToStop: 600_000 }, auto).kind, "HANDOFF");
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, { msToOpen: 120_000, msToStop: RESET_MIN_LEAD_MS }, auto).kind, "HANDOFF");
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, openFar, { entryMode: "prepared" }).kind, "HANDOFF");
});
