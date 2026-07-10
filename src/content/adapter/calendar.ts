export interface CalendarInspection {
  targetAvailable: boolean;
  targetSelected: boolean;
  adjacentDate: string | null;
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

  private readCells(): DateCell[] {
    // 실측 2026-07-10: docs/analysis/site-behavior.md §3 날짜 셀.
    return Array.from(this.document.querySelectorAll<HTMLElement>('div[role="button"][aria-label]')).flatMap((element) => {
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
