import { isDisabled, visibleAll } from "./dom.js";

export interface CalendarInspection {
  targetAvailable: boolean;
  targetSelected: boolean;
  adjacentDate: string | null;
}

export interface CalendarPreparationResult {
  status: "ready" | "acted" | "waiting" | "blocked";
  message: string;
}

interface DateCell {
  date: string;
  epochDay: number;
  element: HTMLElement;
  available: boolean;
  selected: boolean;
}

function parseAriaDate(label: string): { date: string; epochDay: number } | null {
  const match = label.match(/,\s*(\d{1,2})월\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const epochDay = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochDay);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: `${year}-${pad(month)}-${pad(day)}`, epochDay };
}

export class CalendarAdapter {
  private preparingTarget: string | null = null;
  private pendingMonth: string | null = null;
  private pendingDate: string | null = null;

  constructor(private readonly document: Document) {}

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

  prepareTarget(targetDate: string): CalendarPreparationResult {
    if (this.preparingTarget !== targetDate) {
      this.preparingTarget = targetDate;
      this.pendingMonth = null;
      this.pendingDate = null;
    }
    const displayedMonth = this.readDisplayedMonth();
    if (this.pendingMonth !== null) {
      if (displayedMonth === this.pendingMonth) {
        return { status: "waiting", message: "달력 월 전환을 기다립니다." };
      }
      this.pendingMonth = null;
    }

    const target = this.readCells().find((cell) => cell.date === targetDate);
    if (target) {
      if (!target.available) return { status: "blocked", message: "목표 날짜를 선택할 수 없습니다." };
      if (target.selected) {
        this.pendingDate = null;
        return { status: "ready", message: "목표 날짜가 준비됐습니다." };
      }
      if (this.pendingDate === targetDate) {
        return { status: "waiting", message: "목표 날짜 선택 상태를 기다립니다." };
      }
      target.element.click();
      this.pendingDate = targetDate;
      return { status: "acted", message: `${targetDate} 날짜를 선택했습니다.` };
    }

    this.pendingDate = null;
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
    control.click();
    this.pendingMonth = displayedMonth;
    return { status: "acted", message: `${targetMonth} 달력으로 이동합니다.` };
  }

  private readDisplayedMonth(): string | null {
    for (const button of visibleAll<HTMLButtonElement>(this.document, "button")) {
      const text = (button.textContent ?? "").replace(/\s+/g, "");
      const match = text.match(/^(\d{4})년(\d{1,2})월$/);
      if (match) return `${match[1]}-${match[2].padStart(2, "0")}`;
    }
    return null;
  }

  private monthControl(label: "Previous page" | "Next page"): HTMLButtonElement | null {
    return visibleAll<HTMLButtonElement>(this.document, `button[aria-label="${label}"]`).at(0) ?? null;
  }

  private readCells(): DateCell[] {
    // 실측 2026-07-10: docs/analysis/site-behavior.md §3 날짜 셀.
    return visibleAll<HTMLElement>(this.document, 'div[role="button"][aria-label]').flatMap((element) => {
      const parsed = parseAriaDate(element.getAttribute("aria-label") ?? "");
      if (!parsed) return [];
      return [{
        ...parsed,
        element,
        available: element.getAttribute("aria-disabled") !== "true",
        selected: element.getAttribute("aria-pressed") === "true",
      }];
    });
  }
}
