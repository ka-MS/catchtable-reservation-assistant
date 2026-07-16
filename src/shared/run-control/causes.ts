export type PreparationStage = "entry" | "month" | "date" | "person";

export type PreparationCause =
  | "ENTRY_CTA_MISSING"
  | "ENTRY_TRANSITION_STALLED"
  | "WAITING_ONLY"
  | "MONTH_NAVIGATION_UNAVAILABLE"
  | "MONTH_TRANSITION_STALLED"
  | "DATE_NOT_IN_CALENDAR"
  | "DATE_UNAVAILABLE"
  | "DATE_SELECTION_STALLED"
  | "PERSON_UNAVAILABLE"
  | "PERSON_SELECTION_STALLED";

/** 실패 경로 구분 — 같은 원인이라도 사용자 메시지가 다른 경우가 있다(달력 계열). */
export type FailureVia = "fatal" | "discovery" | "exhausted" | "deadline";
