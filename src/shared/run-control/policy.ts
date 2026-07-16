import type { EntryMode } from "../types.js";
import type { PreparationCause } from "./causes.js";

export type RecoveryAction =
  | { kind: "RESET_PAGE"; cause: PreparationCause }
  | { kind: "HANDOFF"; cause: PreparationCause };

export interface RecoveryBudget { resetCount: number; }
export interface RecoveryTimeView { msToOpen: number; msToStop: number; }

/** RESET(탭 이동+재주입+재준비)은 5~15초짜리 행동 — 이 여유가 없으면 시도 자체가 오픈런을 죽인다. */
export const RESET_MIN_LEAD_MS = 45_000;

/** 재시도·리셋으로 해소될 수 없는, 페이지 사실이 확정한 원인. */
const TERMINAL_CAUSES = new Set<PreparationCause>([
  "WAITING_ONLY",
  "PERSON_UNAVAILABLE",
  "DATE_UNAVAILABLE",
  "DATE_NOT_IN_CALENDAR",
  "MONTH_NAVIGATION_UNAVAILABLE",
]);

export function decide(
  cause: PreparationCause,
  budget: RecoveryBudget,
  time: RecoveryTimeView,
  mode: { entryMode: EntryMode },
): RecoveryAction {
  if (TERMINAL_CAUSES.has(cause)) return { kind: "HANDOFF", cause };
  if (mode.entryMode !== "auto") return { kind: "HANDOFF", cause };
  if (budget.resetCount > 0) return { kind: "HANDOFF", cause };
  if (time.msToOpen <= RESET_MIN_LEAD_MS) return { kind: "HANDOFF", cause };
  if (time.msToStop <= RESET_MIN_LEAD_MS) return { kind: "HANDOFF", cause };
  return { kind: "RESET_PAGE", cause };
}
