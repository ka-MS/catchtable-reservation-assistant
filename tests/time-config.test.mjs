import assert from "node:assert/strict";
import test from "node:test";
import {
  epochToLocalInput,
  localInputToEpoch,
  parseKoreanTime,
  parseTimeInput,
} from "../dist/shared/time.js";
import { defaultStopAt, validateReservationConfig } from "../dist/shared/config.js";

test("Korean slot labels are parsed strictly", () => {
  assert.equal(parseKoreanTime("오전 12:00"), 0);
  assert.equal(parseKoreanTime("오전 9:05"), 545);
  assert.equal(parseKoreanTime("오후 12:00"), 720);
  assert.equal(parseKoreanTime("오후 7:30"), 1170);
  assert.equal(parseKoreanTime("19:30"), null);
  assert.equal(parseKoreanTime("오후 13:00"), null);
});

test("time inputs and local datetime values round trip", () => {
  assert.equal(parseTimeInput("19:30"), 1170);
  assert.equal(parseTimeInput("24:00"), null);
  const local = "2026-07-10T13:00";
  assert.equal(epochToLocalInput(localInputToEpoch(local)), local);
});

test("monitoring defaults to ten minutes after opening", () => {
  assert.equal(defaultStopAt(1_000), 601_000);
});

function validConfig() {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: 2_000_000,
    reservationDate: "2026-07-30",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [1140, 1110],
    postSlotEnabled: false,
    paymentMethodAutoAdvance: true,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: 2_600_000,
    entryMode: "auto",
    dryRun: true,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 400,
  };
}

test("valid open-run configuration is accepted", () => {
  const legacy = { ...validConfig(), clockSampleCount: 5 };
  const current = validConfig();
  assert.deepEqual(validateReservationConfig(legacy, 1_000_000), []);
  assert.deepEqual(validateReservationConfig(current, 1_000_000), []);
  assert.deepEqual(validateReservationConfig({ ...validConfig(), preOpenLeadMs: 50 }, 1_000_000), []);
  assert.ok(validateReservationConfig({ ...validConfig(), preOpenLeadMs: 125 }, 1_000_000)
    .some((error) => error.includes("50ms")));
});

test("invalid time relationships and unsafe settings are rejected", () => {
  const config = validConfig();
  config.targetUrl = "https://example.com/ct/shop/kea";
  config.stopAtMs = config.openAtMs - 1;
  config.timeRange = { startMinutes: 1200, endMinutes: 1080 };
  config.priorityTimes = [1140, 1140, 900];
  config.entryMode = "invalid";
  config.toggleIntervalMs = 50;
  config.tablePreference = "window";
  config.postSlotEnabled = "yes";
  config.paymentMethodAutoAdvance = "yes";

  const errors = validateReservationConfig(config, 1_000_000);
  assert.ok(errors.length >= 6);
  assert.ok(errors.some((error) => error.includes("URL")));
  assert.ok(errors.some((error) => error.includes("감시 종료")));
  assert.ok(errors.some((error) => error.includes("준비 방식")));
  assert.ok(errors.some((error) => error.includes("결제 방식")));
});
