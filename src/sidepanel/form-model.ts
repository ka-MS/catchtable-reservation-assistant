import { validateReservationConfig } from "../shared/config.js";
import { localInputToEpoch, parseTimeInput } from "../shared/time.js";
import type { ReservationConfig } from "../shared/types.js";

export interface FormValues {
  targetUrl: string;
  openAt: string;
  reservationDate: string;
  personCount: string;
  startTime: string;
  endTime: string;
  priorityTimes: string[];
  stopAt: string;
  pagePrepared: boolean;
  dryRun: boolean;
  preOpenLeadMs: string;
  toggleIntervalMs: string;
  clockSampleCount: string;
}

export function configFromFormValues(values: FormValues, nowMs: number): ReservationConfig {
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
    stopAtMs: localInputToEpoch(values.stopAt),
    pagePrepared: values.pagePrepared,
    dryRun: values.dryRun,
    preOpenLeadMs: Number(values.preOpenLeadMs),
    toggleIntervalMs: Number(values.toggleIntervalMs),
    clockSampleCount: Number(values.clockSampleCount),
  };
  const errors = validateReservationConfig(config, nowMs);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return config;
}
