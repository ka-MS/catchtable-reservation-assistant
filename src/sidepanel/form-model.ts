import { resolveAvailabilityProbeMode, validateReservationConfig } from "../shared/config.js";
import { localInputToEpoch, parseTimeInput } from "../shared/time.js";
import type {
  AvailabilityProbeMode, EntryMode, OneShotRunAuthorization, PaymentMethodPolicy, ReservationConfig, TablePreference,
} from "../shared/types.js";

export interface FormValues {
  targetUrl: string;
  openAt: string;
  reservationDate: string;
  personCount: string;
  startTime: string;
  endTime: string;
  priorityTimes: string[];
  postSlotEnabled: boolean;
  paymentMethodAutoAdvance: boolean;
  paymentMethodPolicy?: PaymentMethodPolicy;
  tablePreference: TablePreference;
  menuKeyword: string;
  stopAt: string;
  entryMode?: EntryMode;
  pagePrepared?: boolean;
  dryRun: boolean;
  preOpenLeadMs: string;
  toggleIntervalMs: string;
  availabilityProbeMode?: AvailabilityProbeMode;
  availabilityProbeEnabled?: boolean;
  reservationCompletionEnabled?: boolean;
  maxPaymentAmountKrw?: string;
  requiredFormDefaultAnswer?: string;
}

export const DEFAULT_FORM_VALUES: FormValues = {
  targetUrl: "",
  openAt: "",
  reservationDate: "",
  personCount: "2",
  startTime: "18:00",
  endTime: "20:00",
  priorityTimes: [],
  postSlotEnabled: true,
  paymentMethodAutoAdvance: true,
  paymentMethodPolicy: "selected_allowed",
  tablePreference: "any",
  menuKeyword: "",
  stopAt: "",
  entryMode: "auto",
  dryRun: false,
  preOpenLeadMs: "3000",
  toggleIntervalMs: "150",
  availabilityProbeMode: "empty_exit",
  reservationCompletionEnabled: false,
  maxPaymentAmountKrw: "0",
  requiredFormDefaultAnswer: "",
};

function parseConfig(values: FormValues): ReservationConfig {
  const startMinutes = parseTimeInput(values.startTime);
  const endMinutes = parseTimeInput(values.endTime);
  const priorityTimes = values.priorityTimes.map(parseTimeInput);
  if (startMinutes === null || endMinutes === null || priorityTimes.some((value) => value === null)) {
    throw new Error("희망 시간과 우선순위를 확인하세요.");
  }
  const config: ReservationConfig = {
    targetUrl: values.targetUrl.trim(),
    openAtMs: localInputToEpoch(values.openAt),
    reservationDate: values.reservationDate,
    personCount: Number(values.personCount),
    timeRange: { startMinutes, endMinutes },
    priorityTimes: priorityTimes as number[],
    postSlotEnabled: values.postSlotEnabled,
    paymentMethodAutoAdvance: values.paymentMethodAutoAdvance,
    paymentMethodPolicy: values.paymentMethodPolicy ?? "selected_allowed",
    tablePreference: values.tablePreference,
    menuKeyword: values.menuKeyword.trim(),
    stopAtMs: localInputToEpoch(values.stopAt),
    entryMode: values.entryMode ?? (values.pagePrepared === false ? "auto" : "prepared"),
    dryRun: values.dryRun,
    preOpenLeadMs: Number(values.preOpenLeadMs),
    toggleIntervalMs: Number(values.toggleIntervalMs),
    availabilityProbeMode: resolveAvailabilityProbeMode(values),
    reservationCompletionEnabled: values.reservationCompletionEnabled ?? false,
    maxPaymentAmountKrw: Number(values.maxPaymentAmountKrw ?? "0"),
    requiredFormDefaultAnswer: values.requiredFormDefaultAnswer ?? "",
  };
  return config;
}

/** Side Panel의 영속 폼 model과 분리된 일회성 PIN 입력값을 wrapper로 만든다 — 빈 입력은 undefined다. */
export function oneShotAuthorizationFromPin(pin: string): OneShotRunAuthorization | undefined {
  const trimmed = pin.trim();
  return trimmed === "" ? undefined : { catchPayPin: trimmed };
}

/**
 * PIN input에서 authorization을 읽어 payload를 만든 직후 입력을 비운다.
 * DOM 없이도 테스트 가능하도록 `{ value: string }` 구조만 요구한다.
 */
export function takeOneShotAuthorization(pinInput: { value: string }): OneShotRunAuthorization | undefined {
  const authorization = oneShotAuthorizationFromPin(pinInput.value);
  pinInput.value = "";
  return authorization;
}

export function configSnapshotFromFormValues(values: FormValues): ReservationConfig {
  const config = parseConfig(values);
  const errors = validateReservationConfig(config, Number.NEGATIVE_INFINITY);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return config;
}

export function configFromFormValues(values: FormValues, nowMs: number): ReservationConfig {
  const config = configSnapshotFromFormValues(values);
  const errors = validateReservationConfig(config, nowMs);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return config;
}

/** 자동으로 재계산된 값 — 정상 경로는 수 초 내 종료되며, 이 값은 자동 정지 실패 시의 안전망 상한일 뿐이다. */
const QUICK_PREP_WINDOW_MS = 300_000;

/** "식당으로 이동하기" 전용 — 폼의 실제 dryRun·entryMode·오픈/종료 시각과 무관하게
 * 준비단계(URL 이동·예약창 오픈·날짜·인원)만 안전하게 확인하는 설정으로 덮어쓴다.
 * dryRun을 강제하는 이유: orchestrator의 dryRun 체크가 clickSlot() 호출보다 먼저 걸리는
 * 유일한 실클릭 방지 지점이라, 이 강제가 실수 클릭을 구조적으로 차단한다. */
export function quickPrepConfig(values: FormValues, nowMs: number): ReservationConfig {
  const config = configSnapshotFromFormValues(values);
  return { ...config, entryMode: "auto", dryRun: true, openAtMs: nowMs, stopAtMs: nowMs + QUICK_PREP_WINDOW_MS };
}
