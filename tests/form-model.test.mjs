import assert from "node:assert/strict";
import test from "node:test";
import { configFromFormValues } from "../dist/sidepanel/form-model.js";

function values(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAt: "2026-07-10T13:00",
    reservationDate: "2026-07-30",
    personCount: "2",
    startTime: "18:00",
    endTime: "20:00",
    priorityTimes: ["19:00", "18:30"],
    postSlotEnabled: true,
    tablePreference: "bar",
    menuKeyword: "디너 오마카세",
    stopAt: "2026-07-10T13:10",
    entryMode: "auto",
    dryRun: true,
    preOpenLeadMs: "3000",
    toggleIntervalMs: "400",
    clockSampleCount: "5",
    ...overrides,
  };
}

test("sidepanel values produce an epoch-based configuration", () => {
  const config = configFromFormValues(values(), new Date("2026-07-10T12:00").getTime());
  assert.equal(config.stopAtMs - config.openAtMs, 600_000);
  assert.deepEqual(config.timeRange, { startMinutes: 1080, endMinutes: 1200 });
  assert.deepEqual(config.priorityTimes, [1140, 1110]);
  assert.equal(config.postSlotEnabled, true);
  assert.equal(config.tablePreference, "bar");
  assert.equal(config.menuKeyword, "디너 오마카세");
  assert.equal(config.entryMode, "auto");
});

test("sidepanel model reports validation errors", () => {
  assert.throws(() => configFromFormValues(values({ stopAt: "2026-07-10T12:59", entryMode: "invalid" }), new Date("2026-07-10T12:00").getTime()), /감시 종료|준비 방식/);
});

test("legacy pagePrepared drafts migrate to an explicit entry mode", () => {
  const config = configFromFormValues(values({ entryMode: undefined, pagePrepared: true }), new Date("2026-07-10T12:00").getTime());
  assert.equal(config.entryMode, "prepared");
});
