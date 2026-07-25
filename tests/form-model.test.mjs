import assert from "node:assert/strict";
import test from "node:test";
import {
  configFromFormValues,
  configSnapshotFromFormValues,
  oneShotAuthorizationFromPin,
  quickPrepConfig,
  takeOneShotAuthorization,
  DEFAULT_FORM_VALUES,
} from "../dist/sidepanel/form-model.js";

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
  assert.equal("catchPayPin" in config, false);
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
  assert.equal("catchPayPin" in snapshot, false); // 즐겨찾기/작업 저장 경로에도 PIN이 없다
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
  assert.equal(DEFAULT_FORM_VALUES.reservationCompletionEnabled, false);
  assert.equal(DEFAULT_FORM_VALUES.maxPaymentAmountKrw, "0");
  assert.equal(DEFAULT_FORM_VALUES.requiredFormDefaultAnswer, "");
  assert.equal("catchPayPin" in DEFAULT_FORM_VALUES, false);
});

test("완주 opt-in·상한·공통 답변은 폼 값에서 설정으로 그대로 전달된다", () => {
  const config = configFromFormValues(
    values({
      reservationCompletionEnabled: true,
      maxPaymentAmountKrw: "20000",
      requiredFormDefaultAnswer: " 가족 모임 ",
    }),
    new Date("2026-07-10T12:00").getTime(),
  );
  assert.equal(config.reservationCompletionEnabled, true);
  assert.equal(config.maxPaymentAmountKrw, 20_000);
  assert.equal(config.requiredFormDefaultAnswer, " 가족 모임 ");
});

test("완주 관련 폼 값이 없으면 완주 off·상한 0·빈 답변으로 채워진다", () => {
  const config = configFromFormValues(values(), new Date("2026-07-10T12:00").getTime());
  assert.equal(config.reservationCompletionEnabled, false);
  assert.equal(config.maxPaymentAmountKrw, 0);
  assert.equal(config.requiredFormDefaultAnswer, "");
});

// PIN 리터럴이 소스에 남지 않도록 자릿수를 런타임에 조합한다.
function runtimePinSentinel(digits) {
  return digits.map(String).join("");
}

test("oneShotAuthorizationFromPin은 빈 입력을 undefined로, 값이 있으면 trim된 wrapper로 만든다", () => {
  assert.equal(oneShotAuthorizationFromPin(""), undefined);
  assert.equal(oneShotAuthorizationFromPin("   "), undefined);
  const pin = runtimePinSentinel([5, 2, 0, 9]);
  assert.deepEqual(oneShotAuthorizationFromPin(`  ${pin}  `), { catchPayPin: pin });
});

test("takeOneShotAuthorization은 payload를 만든 직후 입력 객체의 값을 비운다", () => {
  const pin = runtimePinSentinel([4, 4, 7, 7]);
  const pinInput = { value: pin };
  const authorization = takeOneShotAuthorization(pinInput);
  assert.deepEqual(authorization, { catchPayPin: pin });
  assert.equal(pinInput.value, "");
});

test("takeOneShotAuthorization은 빈 입력에도 undefined를 반환하고 값을 비운 채로 둔다", () => {
  const pinInput = { value: "   " };
  const authorization = takeOneShotAuthorization(pinInput);
  assert.equal(authorization, undefined);
  assert.equal(pinInput.value, "");
});
