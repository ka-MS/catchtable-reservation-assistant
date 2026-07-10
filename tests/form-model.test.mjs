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
    stopAt: "2026-07-10T13:10",
    pagePrepared: true,
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
});

test("sidepanel model reports validation errors", () => {
  assert.throws(() => configFromFormValues(values({ stopAt: "2026-07-10T12:59", pagePrepared: false }), new Date("2026-07-10T12:00").getTime()), /감시 종료|페이지 준비/);
});
