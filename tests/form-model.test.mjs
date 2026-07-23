import assert from "node:assert/strict";
import test from "node:test";
import { configFromFormValues, configSnapshotFromFormValues, quickPrepConfig, DEFAULT_FORM_VALUES } from "../dist/sidepanel/form-model.js";

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
    paymentMethodAutoAdvance: true,
    paymentMethodPolicy: "selected_allowed",
    tablePreference: "bar",
    menuKeyword: "디너 오마카세",
    stopAt: "2026-07-10T13:10",
    entryMode: "auto",
    dryRun: true,
    preOpenLeadMs: "3000",
    toggleIntervalMs: "400",
    availabilityProbeMode: "off",
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
  assert.equal(config.paymentMethodAutoAdvance, true);
  assert.equal(config.paymentMethodPolicy, "selected_allowed");
  assert.equal(config.tablePreference, "bar");
  assert.equal(config.menuKeyword, "디너 오마카세");
  assert.equal(config.entryMode, "auto");
  assert.equal(config.availabilityProbeMode, "off");
  assert.equal("availabilityProbeEnabled" in config, false);
  assert.equal("clockSampleCount" in config, false);
});

test("XHR response mode is explicit", () => {
  const config = configFromFormValues(
    values({ availabilityProbeMode: "empty_exit" }),
    new Date("2026-07-10T12:00").getTime(),
  );
  assert.equal(config.availabilityProbeMode, "empty_exit");
});

test("legacy XHR diagnostic drafts migrate to observe mode", () => {
  const config = configFromFormValues(
    values({ availabilityProbeMode: undefined, availabilityProbeEnabled: true }),
    new Date("2026-07-10T12:00").getTime(),
  );
  assert.equal(config.availabilityProbeMode, "observe");
});

test("sidepanel model reports validation errors", () => {
  assert.throws(() => configFromFormValues(values({ stopAt: "2026-07-10T12:59", entryMode: "invalid" }), new Date("2026-07-10T12:00").getTime()), /감시 종료|준비 방식/);
});

test("legacy pagePrepared drafts migrate to an explicit entry mode", () => {
  const config = configFromFormValues(values({ entryMode: undefined, pagePrepared: true }), new Date("2026-07-10T12:00").getTime());
  assert.equal(config.entryMode, "prepared");
});

test("favorite snapshots allow past times but keep structural validation", () => {
  const snapshot = configSnapshotFromFormValues(values());
  assert.equal(snapshot.openAtMs, new Date("2026-07-10T13:00").getTime());
  assert.throws(() => configSnapshotFromFormValues(values({ targetUrl: "https://example.com" })), /URL/);
});

test("quickPrepConfig는 dryRun·entryMode를 강제하고 오픈·종료 시각을 현재 기준으로 재계산한다", () => {
  // 폼의 실제 openAt/stopAt(과거)·dryRun(false)·entryMode(prepared)와 무관하게 안전값으로 덮어써야 한다.
  const nowMs = new Date("2026-07-20T12:00").getTime();
  const config = quickPrepConfig(values({ dryRun: false, entryMode: "prepared" }), nowMs);
  assert.equal(config.dryRun, true);
  assert.equal(config.entryMode, "auto");
  assert.equal(config.openAtMs, nowMs);
  assert.equal(config.stopAtMs, nowMs + 300_000);
  assert.equal(config.reservationDate, "2026-07-30");
  assert.equal(config.personCount, 2);
});

test("DEFAULT_FORM_VALUES는 후속 선택·유료 예약 허용·자동 준비·EMPTY 조기 종료를 기본으로 켜둔다", () => {
  assert.equal(DEFAULT_FORM_VALUES.postSlotEnabled, true);
  assert.equal(DEFAULT_FORM_VALUES.paymentMethodAutoAdvance, true);
  assert.equal(DEFAULT_FORM_VALUES.paymentMethodPolicy, "selected_allowed");
  assert.equal(DEFAULT_FORM_VALUES.entryMode, "auto");
  assert.equal(DEFAULT_FORM_VALUES.availabilityProbeMode, "empty_exit");
  assert.equal(DEFAULT_FORM_VALUES.targetUrl, "");
  assert.equal(DEFAULT_FORM_VALUES.personCount, "2");
  assert.equal(DEFAULT_FORM_VALUES.startTime, "18:00");
  assert.equal(DEFAULT_FORM_VALUES.endTime, "20:00");
  assert.deepEqual(DEFAULT_FORM_VALUES.priorityTimes, []);
  assert.equal(DEFAULT_FORM_VALUES.dryRun, false);
});
