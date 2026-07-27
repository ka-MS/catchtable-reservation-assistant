import assert from "node:assert/strict";
import test from "node:test";
import {
  epochToLocalInput,
  localInputToEpoch,
  parseKoreanTime,
  parseTimeInput,
} from "../dist/shared/time.js";
import {
  defaultStopAt,
  normalizeReservationConfig,
  resolveAvailabilityProbeMode,
  validateOneShotAuthorization,
  validateReservationConfig,
} from "../dist/shared/config.js";

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
    paymentMethodPolicy: "selected_allowed",
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: 2_600_000,
    entryMode: "auto",
    dryRun: true,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 400,
    reservationCompletionEnabled: false,
    maxPaymentAmountKrw: 0,
    requiredFormDefaultAnswer: "",
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

test("availability probe modes normalize legacy settings without retaining the boolean", () => {
  const missing = normalizeReservationConfig(validConfig());
  const disabled = normalizeReservationConfig({ ...validConfig(), availabilityProbeEnabled: false });
  const enabled = normalizeReservationConfig({ ...validConfig(), availabilityProbeEnabled: true });
  const current = normalizeReservationConfig({
    ...validConfig(),
    availabilityProbeMode: "empty_exit",
    availabilityProbeEnabled: true,
  });

  assert.equal(missing.availabilityProbeMode, "off");
  assert.equal(disabled.availabilityProbeMode, "off");
  assert.equal(enabled.availabilityProbeMode, "observe");
  assert.equal(current.availabilityProbeMode, "empty_exit");
  assert.equal("availabilityProbeEnabled" in missing, false);
  assert.equal("availabilityProbeEnabled" in enabled, false);
  assert.equal(resolveAvailabilityProbeMode(current), "empty_exit");
});

test("legacy config missing completion fields normalizes to off/0/empty", () => {
  const legacy = validConfig();
  delete legacy.reservationCompletionEnabled;
  delete legacy.maxPaymentAmountKrw;
  delete legacy.requiredFormDefaultAnswer;
  const normalized = normalizeReservationConfig(legacy);
  assert.equal(normalized.reservationCompletionEnabled, false);
  assert.equal(normalized.maxPaymentAmountKrw, 0);
  assert.equal(normalized.requiredFormDefaultAnswer, "");
});

test("completion default answer is trimmed", () => {
  const normalized = normalizeReservationConfig({
    ...validConfig(),
    requiredFormDefaultAnswer: "  방문 목적입니다  ",
  });
  assert.equal(normalized.requiredFormDefaultAnswer, "방문 목적입니다");
});

test("completion default answer has no unfounded length cap — normalize only trims and validate only checks the type", () => {
  const longAnswer = "가".repeat(200);
  const normalized = normalizeReservationConfig({ ...validConfig(), requiredFormDefaultAnswer: longAnswer });
  assert.equal(normalized.requiredFormDefaultAnswer, longAnswer);
  assert.deepEqual(validateReservationConfig({ ...validConfig(), requiredFormDefaultAnswer: longAnswer }, 1_000_000), []);
  const nonString = validateReservationConfig({ ...validConfig(), requiredFormDefaultAnswer: 12345 }, 1_000_000);
  assert.ok(nonString.some((error) => error.includes("공통 필수 답변")));
});

test("max payment amount only accepts an integer between 0 and 500,000", () => {
  const base = validConfig();
  assert.deepEqual(validateReservationConfig({ ...base, maxPaymentAmountKrw: 0 }, 1_000_000), []);
  assert.deepEqual(validateReservationConfig({ ...base, maxPaymentAmountKrw: 500_000 }, 1_000_000), []);
  const tooLarge = validateReservationConfig({ ...base, maxPaymentAmountKrw: 500_001 }, 1_000_000);
  assert.ok(tooLarge.some((error) => error.includes("예약금 상한")));
  const negative = validateReservationConfig({ ...base, maxPaymentAmountKrw: -1 }, 1_000_000);
  assert.ok(negative.some((error) => error.includes("예약금 상한")));
  const fractional = validateReservationConfig({ ...base, maxPaymentAmountKrw: 1_000.5 }, 1_000_000);
  assert.ok(fractional.some((error) => error.includes("예약금 상한")));
});

test("reservation completion opt-in must be a boolean", () => {
  const base = validConfig();
  const errors = validateReservationConfig({ ...base, reservationCompletionEnabled: "yes" }, 1_000_000);
  assert.ok(errors.some((error) => error.includes("완주")));
});

// 실제로 존재할 법한 PIN 리터럴을 소스에 남기지 않도록 자릿수를 런타임에 조합한다.
function runtimePinSentinel(digits) {
  return digits.map(String).join("");
}

test("one-shot authorization accepts only a 4-digit PIN and never echoes the value", () => {
  assert.equal(validateOneShotAuthorization(undefined), null);
  assert.equal(validateOneShotAuthorization({ catchPayPin: runtimePinSentinel([3, 0, 8, 1]) }), null);
  const tooShort = validateOneShotAuthorization({ catchPayPin: runtimePinSentinel([1, 2, 3]) });
  const nonDigit = validateOneShotAuthorization({ catchPayPin: "abcd" });
  const empty = validateOneShotAuthorization({ catchPayPin: "" });
  for (const error of [tooShort, nonDigit, empty]) {
    assert.equal(typeof error, "string");
    assert.doesNotMatch(error, /\d{3,}/);
  }
});

test("one-shot authorization treats only undefined as absent — malformed non-undefined shapes reject without throwing", () => {
  // null, 배열, 원시값, catchPayPin이 숫자·누락인 경우 모두 존재하는 것으로 취급해 엄격히 거부한다.
  const malformedShapes = [
    null,
    {},
    { catchPayPin: 3081 }, // 숫자는 문자열 타입 계약 위반이다 — 우연히 4자리 숫자여도 거부한다.
    { catchPayPin: null },
    { catchPayPin: [3, 0, 8, 1] },
    "not-an-object",
    42,
  ];
  for (const shape of malformedShapes) {
    let error;
    assert.doesNotThrow(() => {
      error = validateOneShotAuthorization(shape);
    });
    assert.equal(typeof error, "string");
  }
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
  config.paymentMethodPolicy = "anything";
  config.availabilityProbeMode = "yes";

  const errors = validateReservationConfig(config, 1_000_000);
  assert.ok(errors.length >= 6);
  assert.ok(errors.some((error) => error.includes("URL")));
  assert.ok(errors.some((error) => error.includes("감시 종료")));
  assert.ok(errors.some((error) => error.includes("준비 방식")));
  assert.ok(errors.some((error) => error.includes("결제 방식")));
  assert.ok(errors.some((error) => error.includes("결제 방식 정책")));
  assert.ok(errors.some((error) => error.includes("XHR 응답 모드")));
});
