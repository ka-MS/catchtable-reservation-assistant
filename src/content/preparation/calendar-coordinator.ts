import { classifyDateFatal, classifyMonthFatal, classifyStall } from "../../shared/run-control/classifier.js";
import type { FailureVia, PreparationCause } from "../../shared/run-control/causes.js";
import type { CalendarFacts } from "../../shared/run-control/facts.js";
import { assertNever, runPreparationStep, type StepRunOptions, type StepSpec } from "./step-runner.js";
import { toPreparationResult, type PreparationResult } from "./result.js";

export interface CalendarStagePort {
  inspectPreparation(targetDate: string): CalendarFacts;
  clickMonth(direction: "Next page" | "Previous page"): boolean;
  clickDate(date: string): boolean;
}

const DEADLINE_MESSAGE = "목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.";
export const CALENDAR_TIMEOUT_MESSAGE = "예약 날짜 준비 중 감시 종료 시각에 도달했습니다.";

function messageFor(cause: PreparationCause, via: FailureVia): string {
  if (via === "deadline") return DEADLINE_MESSAGE;
  return ({
    DATE_NOT_IN_CALENDAR: "목표 날짜가 현재 달력에 없습니다.",
    DATE_UNAVAILABLE: "목표 날짜를 선택할 수 없습니다.",
    MONTH_NAVIGATION_UNAVAILABLE: "목표 월로 이동할 수 없습니다.",
    MONTH_TRANSITION_STALLED: "달력 월 전환을 확인할 수 없습니다.",
    DATE_SELECTION_STALLED: "목표 날짜 선택 전환을 확인할 수 없습니다.",
  } as Partial<Record<PreparationCause, string>>)[cause] ?? DEADLINE_MESSAGE;
}

function monthSpec(port: CalendarStagePort, targetDate: string): StepSpec<CalendarFacts> {
  const targetMonth = targetDate.slice(0, 7);
  return {
    stage: "month",
    inspect: () => port.inspectPreparation(targetDate),
    conditionKey: (f) => `${f.displayedMonth}:${f.target !== null}:${f.monthNavigation?.available ?? "none"}`,
    conditionAttributes: (f) => ({
      displayedMonth: f.displayedMonth,
      targetVisible: f.target !== null,
      preparationTarget: targetDate,
    }),
    isReady: (f) => f.target !== null,
    fatal: (f) => classifyMonthFatal(f, targetMonth),
    canDispatch: (f) => f.monthNavigation?.available === true,
    dispatch: (f) => (f.monthNavigation ? port.clickMonth(f.monthNavigation.direction) : false),
    dispatchAction: "change_month",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${targetMonth} 달력으로 이동합니다.`
      : `${targetMonth} 달력 이동을 재시도합니다.`),
    progressKey: (f) => f.displayedMonth ?? "",
    maxAttempts: 3,
    retryDelayMs: 750,
    confirmTimeoutMs: undefined,
  };
}

function dateSpec(port: CalendarStagePort, targetDate: string): StepSpec<CalendarFacts> {
  return {
    stage: "date",
    inspect: () => port.inspectPreparation(targetDate),
    conditionKey: (f) => `${f.target?.available}:${f.target?.selected}`,
    conditionAttributes: (f) => ({
      targetAvailable: f.target?.available ?? null,
      targetSelected: f.target?.selected ?? null,
      preparationTarget: targetDate,
    }),
    isReady: (f) => f.target?.selected === true,
    fatal: classifyDateFatal,
    /** 셀 소실은 원인 코드가 아니라 내부 재순환 신호다 — coordinator가 월 단계부터 다시 돈다. */
    interrupt: (f) => (f.target === null ? "target_cell_missing" : null),
    canDispatch: (f) => f.target?.available === true,
    dispatch: () => port.clickDate(targetDate),
    dispatchAction: "select_date",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${targetDate} 날짜를 선택했습니다.`
      : `${targetDate} 날짜 선택을 재시도했습니다.`),
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: undefined,
  };
}

/** 월 이동 → 날짜 선택 순서를 소유한다. 날짜 준비 중 셀이 소실되면(달력이 다른
 * 월로 바뀜) interrupt 토큰을 받아 남은 deadline 안에서 월 단계부터 재순환한다 —
 * 현행 prepareTarget의 month↔date 오가는 동작 보존. 원인 코드는 제어에 쓰지 않는다. */
export async function runCalendarPreparation(
  port: CalendarStagePort,
  targetDate: string,
  options: StepRunOptions,
): Promise<PreparationResult> {
  while (true) {
    const monthOutcome = await runPreparationStep(monthSpec(port, targetDate), options);
    if (monthOutcome.kind !== "ready") {
      return toPreparationResult(monthOutcome, messageFor, CALENDAR_TIMEOUT_MESSAGE);
    }
    const dateOutcome = await runPreparationStep(dateSpec(port, targetDate), options);
    if (dateOutcome.kind === "interrupted") {
      switch (dateOutcome.token) {
        case "target_cell_missing": {
          if (options.clock.now() < Math.min(options.overallDeadlineAtMs, options.stopAtMs)) continue;
          const cause = classifyStall("date", dateOutcome.attempts);
          return {
            kind: "failed",
            cause,
            via: "deadline",
            attempts: dateOutcome.attempts,
            message: messageFor(cause, "deadline"),
          };
        }
        default:
          return assertNever(dateOutcome.token);
      }
    }
    return toPreparationResult(dateOutcome, messageFor, CALENDAR_TIMEOUT_MESSAGE);
  }
}
