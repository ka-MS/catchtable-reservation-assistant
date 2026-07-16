import type { CalendarFacts } from "../../shared/run-control/facts.js";
import { readCalendarCells, readDisplayedCalendarMonth } from "./calendar-dom.js";
import { isDisabled, visibleAll } from "./dom.js";

export interface CalendarInspection {
  targetAvailable: boolean;
  targetSelected: boolean;
  adjacentDate: string | null;
}

export interface CalendarPreparationResult {
  status: "ready" | "acted" | "waiting" | "blocked";
  message: string;
  errorCode?: "DATE_SELECTION_STALLED";
}

export interface CalendarPreparationDispatch {
  kind: "month" | "date";
  target: string;
  attempt: number;
}

const MONTH_TRANSITION_RETRY_DELAY_MS = 750;
const MONTH_TRANSITION_MAX_ATTEMPTS = 3;
const DATE_SELECTION_RETRY_DELAY_MS = 1_000;
const DATE_SELECTION_MAX_ATTEMPTS = 2;

export class CalendarAdapter {
  private preparingTarget: string | null = null;
  private pendingMonth: string | null = null;
  private pendingMonthRequestedAt: number | null = null;
  private pendingMonthAttempts = 0;
  private pendingDate: string | null = null;
  private pendingDateRequestedAt: number | null = null;
  private pendingDateAttempts = 0;

  constructor(
    private readonly document: Document,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  resetPreparation(): void {
    this.preparingTarget = null;
    this.pendingMonth = null;
    this.pendingMonthRequestedAt = null;
    this.pendingMonthAttempts = 0;
    this.pendingDate = null;
    this.pendingDateRequestedAt = null;
    this.pendingDateAttempts = 0;
  }

  inspect(targetDate: string): CalendarInspection {
    const cells = this.readCells();
    const target = cells.find((cell) => cell.date === targetDate);
    if (!target) return { targetAvailable: false, targetSelected: false, adjacentDate: null };
    const adjacent = cells
      .filter((cell) => cell.available && cell.date !== targetDate)
      .sort((left, right) => Math.abs(left.epochDay - target.epochDay) - Math.abs(right.epochDay - target.epochDay))[0];
    return {
      targetAvailable: target.available,
      targetSelected: target.selected,
      adjacentDate: adjacent?.date ?? null,
    };
  }

  clickDate(date: string): boolean {
    const cell = this.readCells().find((candidate) => candidate.date === date && candidate.available);
    if (!cell || !cell.element.isConnected) return false;
    cell.element.click();
    return true;
  }

  inspectPreparation(targetDate: string): CalendarFacts {
    const cells = this.readCells();
    const target = cells.find((cell) => cell.date === targetDate) ?? null;
    const displayedMonth = readDisplayedCalendarMonth(this.document);
    let monthNavigation: CalendarFacts["monthNavigation"] = null;
    const targetMonth = targetDate.slice(0, 7);
    if (target === null && displayedMonth !== null && displayedMonth !== targetMonth) {
      const direction = displayedMonth < targetMonth ? "Next page" as const : "Previous page" as const;
      const control = this.monthControl(direction);
      monthNavigation = { direction, available: control !== null && !isDisabled(control) };
    }
    return {
      displayedMonth,
      target: target === null ? null : { available: target.available, selected: target.selected },
      monthNavigation,
    };
  }

  clickMonth(direction: "Previous page" | "Next page"): boolean {
    const control = this.monthControl(direction);
    if (!control || isDisabled(control) || !control.isConnected) return false;
    control.click();
    return true;
  }

  prepareTarget(
    targetDate: string,
    beforeDispatch?: (dispatch: CalendarPreparationDispatch) => void,
  ): CalendarPreparationResult {
    if (this.preparingTarget !== targetDate) {
      this.resetPreparation();
      this.preparingTarget = targetDate;
    }
    const displayedMonth = readDisplayedCalendarMonth(this.document);
    if (this.pendingMonth !== null) {
      if (displayedMonth === null || displayedMonth === this.pendingMonth) {
        const requestedAt = this.pendingMonthRequestedAt;
        if (requestedAt === null) {
          return { status: "blocked", message: "달력 월 전환 상태가 올바르지 않습니다." };
        }
        const elapsed = this.monotonicNow() - requestedAt;
        if (elapsed < MONTH_TRANSITION_RETRY_DELAY_MS) {
          return { status: "waiting", message: "달력 월 전환을 기다립니다." };
        }
        if (this.pendingMonthAttempts >= MONTH_TRANSITION_MAX_ATTEMPTS) {
          return { status: "blocked", message: "달력 월 전환을 확인할 수 없습니다." };
        }
        this.pendingMonth = null;
        this.pendingMonthRequestedAt = null;
      } else {
        this.pendingMonth = null;
        this.pendingMonthRequestedAt = null;
        this.pendingMonthAttempts = 0;
      }
    }

    const target = this.readCells().find((cell) => cell.date === targetDate);
    if (target) {
      if (!target.available) return { status: "blocked", message: "목표 날짜를 선택할 수 없습니다." };
      if (target.selected) {
        this.pendingDate = null;
        this.pendingDateRequestedAt = null;
        this.pendingDateAttempts = 0;
        return { status: "ready", message: "목표 날짜가 준비됐습니다." };
      }
      if (this.pendingDate === targetDate) {
        const requestedAt = this.pendingDateRequestedAt;
        if (requestedAt === null) {
          return { status: "blocked", message: "목표 날짜 선택 상태가 올바르지 않습니다." };
        }
        if (this.monotonicNow() - requestedAt < DATE_SELECTION_RETRY_DELAY_MS) {
          return { status: "waiting", message: "목표 날짜 선택 상태를 기다립니다." };
        }
        if (this.pendingDateAttempts >= DATE_SELECTION_MAX_ATTEMPTS) {
          return {
            status: "blocked",
            message: "목표 날짜 선택 전환을 확인할 수 없습니다.",
            errorCode: "DATE_SELECTION_STALLED",
          };
        }
        this.pendingDate = null;
        this.pendingDateRequestedAt = null;
      }
      const attempt = this.pendingDateAttempts + 1;
      beforeDispatch?.({ kind: "date", target: targetDate, attempt });
      target.element.click();
      this.pendingDate = targetDate;
      this.pendingDateRequestedAt = this.monotonicNow();
      this.pendingDateAttempts = attempt;
      return {
        status: "acted",
        message: attempt === 1
          ? `${targetDate} 날짜를 선택했습니다.`
          : `${targetDate} 날짜 선택을 재시도했습니다.`,
      };
    }

    this.pendingDate = null;
    this.pendingDateRequestedAt = null;
    this.pendingDateAttempts = 0;
    const targetMonth = targetDate.slice(0, 7);
    if (!displayedMonth) return { status: "waiting", message: "달력의 현재 월을 확인합니다." };
    if (displayedMonth === targetMonth) {
      return { status: "blocked", message: "목표 날짜가 현재 달력에 없습니다." };
    }
    const direction = displayedMonth < targetMonth ? "Next page" : "Previous page";
    const control = this.monthControl(direction);
    if (!control || isDisabled(control)) {
      return { status: "blocked", message: "목표 월로 이동할 수 없습니다." };
    }
    beforeDispatch?.({ kind: "month", target: targetMonth, attempt: this.pendingMonthAttempts + 1 });
    control.click();
    this.pendingMonth = displayedMonth;
    this.pendingMonthRequestedAt = this.monotonicNow();
    this.pendingMonthAttempts += 1;
    return {
      status: "acted",
      message: this.pendingMonthAttempts === 1
        ? `${targetMonth} 달력으로 이동합니다.`
        : `${targetMonth} 달력 이동을 재시도합니다.`,
    };
  }

  private monthControl(label: "Previous page" | "Next page"): HTMLButtonElement | null {
    return visibleAll<HTMLButtonElement>(this.document, `button[aria-label="${label}"]`).at(0) ?? null;
  }

  private readCells() {
    return readCalendarCells(this.document);
  }
}
