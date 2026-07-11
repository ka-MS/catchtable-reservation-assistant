import { defaultStopAt, validateReservationConfig } from "../shared/config.js";
import { localInputToEpoch, parseTimeInput } from "../shared/time.js";
import type { EntryMode, ReservationConfig, TablePreference } from "../shared/types.js";

export interface FormValues {
  targetUrl: string;
  openAt: string;
  reservationDate: string;
  personCount: string;
  startTime: string;
  endTime: string;
  priorityTimes: string[];
  postSlotEnabled: boolean;
  tablePreference: TablePreference;
  menuKeyword: string;
  stopAt: string;
  entryMode?: EntryMode;
  pagePrepared?: boolean;
  dryRun: boolean;
  preOpenLeadMs: string;
  toggleIntervalMs: string;
  clockSampleCount: string;
}

/** 감시 종료 시각이 오픈+10분 기본값과 다르면 사용자가 직접 정한 값으로 취급한다. */
export function stopAtIsCustom(values: Pick<FormValues, "openAt" | "stopAt">): boolean {
  if (!values.openAt || !values.stopAt) return false;
  try {
    return localInputToEpoch(values.stopAt) !== defaultStopAt(localInputToEpoch(values.openAt));
  } catch {
    return false;
  }
}

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
    tablePreference: values.tablePreference,
    menuKeyword: values.menuKeyword.trim(),
    stopAtMs: localInputToEpoch(values.stopAt),
    entryMode: values.entryMode ?? (values.pagePrepared === false ? "auto" : "prepared"),
    dryRun: values.dryRun,
    preOpenLeadMs: Number(values.preOpenLeadMs),
    toggleIntervalMs: Number(values.toggleIntervalMs),
    clockSampleCount: Number(values.clockSampleCount),
  };
  return config;
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
