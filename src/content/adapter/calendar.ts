import type { CalendarFacts } from "../../shared/run-control/facts.js";
import { readCalendarCells, readDisplayedCalendarMonth } from "./calendar-dom.js";
import { isDisabled, visibleAll } from "./dom.js";

export interface CalendarInspection {
  targetAvailable: boolean;
  targetSelected: boolean;
  adjacentDate: string | null;
}

export class CalendarAdapter {
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

  private monthControl(label: "Previous page" | "Next page"): HTMLButtonElement | null {
    return visibleAll<HTMLButtonElement>(this.document, `button[aria-label="${label}"]`).at(0) ?? null;
  }

  private readCells() {
    return readCalendarCells(this.document);
  }
}
