import type { CalendarFacts, EntryFacts, PersonFacts } from "./facts.js";
import type { PreparationCause, PreparationStage } from "./causes.js";

export function classifyEntryFatal(f: EntryFacts): PreparationCause | null {
  return f.waitingOnly ? "WAITING_ONLY" : null;
}

export function classifyMonthFatal(f: CalendarFacts, targetMonth: string): PreparationCause | null {
  if (f.target !== null || f.displayedMonth === null) return null;
  if (f.displayedMonth === targetMonth) return "DATE_NOT_IN_CALENDAR";
  if (f.monthNavigation === null || !f.monthNavigation.available) return "MONTH_NAVIGATION_UNAVAILABLE";
  return null;
}

/** 셀 소실(target null)은 원인이 아니다 — coordinator가 interrupt 토큰으로 월 단계를 재순환한다.
 * DATE_NOT_IN_CALENDAR는 월 단계의 최종 판정(classifyMonthFatal)에서만 나온다. */
export function classifyDateFatal(f: CalendarFacts): PreparationCause | null {
  if (f.target !== null && !f.target.available) return "DATE_UNAVAILABLE";
  return null;
}

export function classifyPersonFatal(f: PersonFacts): PreparationCause | null {
  return f.ready && !f.targetAvailable ? "PERSON_UNAVAILABLE" : null;
}

const STALL: Record<PreparationStage, { discovery: PreparationCause; confirm: PreparationCause }> = {
  entry: { discovery: "ENTRY_CTA_MISSING", confirm: "ENTRY_TRANSITION_STALLED" },
  month: { discovery: "MONTH_TRANSITION_STALLED", confirm: "MONTH_TRANSITION_STALLED" },
  date: { discovery: "DATE_SELECTION_STALLED", confirm: "DATE_SELECTION_STALLED" },
  person: { discovery: "PERSON_SELECTION_STALLED", confirm: "PERSON_SELECTION_STALLED" },
};

export function classifyStall(stage: PreparationStage, attempts: number): PreparationCause {
  return attempts === 0 ? STALL[stage].discovery : STALL[stage].confirm;
}
