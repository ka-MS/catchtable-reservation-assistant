import { cleanText, isElementHidden, visibleAll } from "./dom.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface CalendarDateCell {
  date: string;
  epochDay: number;
  element: HTMLElement;
  available: boolean;
  selected: boolean;
}

function dateValue(year: number, month: number, day: number): { date: string; epochDay: number } | null {
  const epochDay = Date.UTC(year, month - 1, day);
  const parsed = new Date(epochDay);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: `${year}-${pad(month)}-${pad(day)}`, epochDay };
}

function parseAriaDate(label: string): { date: string; epochDay: number } | null {
  const match = label.match(/,\s*(\d{1,2})월\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;
  return dateValue(Number(match[3]), Number(match[1]), Number(match[2]));
}

function readAriaCells(document: Document): CalendarDateCell[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="button"][aria-label]')).flatMap((element) => {
    if (isElementHidden(element)) return [];
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

export function readDisplayedCalendarMonth(document: Document): string | null {
  const months = visibleAll<HTMLButtonElement>(document, "button").flatMap((button) => {
    const text = cleanText(button.textContent).replace(/\s+/g, "");
    const match = text.match(/^(\d{4})년(\d{1,2})월$/);
    return match ? [`${match[1]}-${match[2].padStart(2, "0")}`] : [];
  });
  return months.length === 1 ? months[0] : null;
}

function readMobiscrollCells(document: Document): CalendarDateCell[] {
  const displayedMonth = readDisplayedCalendarMonth(document);
  if (!displayedMonth) return [];
  const [year, month] = displayedMonth.split("-").map(Number);
  const firstOfMonth = Date.UTC(year, month - 1, 1);
  const activeTables = Array.from(document.querySelectorAll<HTMLElement>(".mbsc-calendar-table-active"))
    .filter((table) => !isElementHidden(table));
  if (activeTables.length !== 1) return [];

  const rows = Array.from(activeTables[0].children)
    .filter((element): element is HTMLElement => element instanceof document.defaultView!.HTMLElement
      && element.classList.contains("mbsc-calendar-row"));
  if (rows.length !== 6) return [];
  const elements = rows.flatMap((row) => {
    const cells = Array.from(row.children)
      .filter((element): element is HTMLElement => element instanceof document.defaultView!.HTMLElement
        && element.classList.contains("mbsc-calendar-cell")
        && element.classList.contains("mbsc-calendar-day"));
    return cells.length === 7 ? cells : [];
  });
  if (elements.length !== 42) return [];

  const gridStart = firstOfMonth - new Date(firstOfMonth).getUTCDay() * DAY_MS;
  const cells: CalendarDateCell[] = [];
  for (const [index, element] of elements.entries()) {
    const epochDay = gridStart + index * DAY_MS;
    const value = new Date(epochDay);
    const dayMatch = cleanText(element.textContent).match(/^(\d{1,2})/);
    const isOuter = value.getUTCMonth() !== month - 1;
    if (!dayMatch
      || Number(dayMatch[1]) !== value.getUTCDate()
      || element.classList.contains("mbsc-calendar-day-outer") !== isOuter) return [];
    const parsed = dateValue(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
    if (!parsed) return [];
    cells.push({
      ...parsed,
      element,
      available: !element.classList.contains("mbsc-disabled")
        && element.getAttribute("aria-disabled") !== "true",
      selected: element.classList.contains("mbsc-selected")
        || element.getAttribute("aria-pressed") === "true",
    });
  }
  return cells;
}

export function readCalendarCells(document: Document): CalendarDateCell[] {
  const ariaCells = readAriaCells(document);
  return ariaCells.length > 0 ? ariaCells : readMobiscrollCells(document);
}
