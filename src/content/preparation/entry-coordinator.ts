import { classifyEntryFatal } from "../../shared/run-control/classifier.js";
import type { PreparationCause } from "../../shared/run-control/causes.js";
import type { EntryFacts } from "../../shared/run-control/facts.js";
import { runPreparationStep, type StepRunOptions } from "./step-runner.js";
import { toPreparationResult, type PreparationResult } from "./result.js";

export interface EntryStagePort {
  inspect(): EntryFacts;
  openReservation(): boolean;
  dismissPromo?(): boolean;
}

const MESSAGES: Partial<Record<PreparationCause, string>> = {
  WAITING_ONLY: "이 식당은 현장 웨이팅만 가능해 예약창을 열 수 없습니다.",
  ENTRY_CTA_MISSING: "식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.",
  ENTRY_TRANSITION_STALLED: "예약하기 클릭 후 달력 화면을 확인할 수 없습니다.",
};

export const ENTRY_TIMEOUT_MESSAGE = "예약 페이지 준비 중 감시 종료 시각에 도달했습니다.";

export async function runEntryPreparation(
  port: EntryStagePort,
  options: StepRunOptions,
): Promise<PreparationResult> {
  const outcome = await runPreparationStep<EntryFacts>({
    stage: "entry",
    inspect: () => port.inspect(),
    conditionKey: (f) => `${f.reservationOpen}:${f.ctaAvailable}:${f.waitingOnly}`,
    conditionAttributes: (f) => ({
      reservationOpen: f.reservationOpen,
      reservationCtaAvailable: f.ctaAvailable,
      waitingOnly: f.waitingOnly,
    }),
    isReady: (f) => f.reservationOpen,
    fatal: classifyEntryFatal,
    canDispatch: (f) => f.ctaAvailable,
    dispatch: () => port.openReservation(),
    dispatchAction: "open_reservation",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? "예약하기 버튼을 클릭했습니다."
      : "예약하기 버튼 클릭을 재시도했습니다."),
    dismissObstacle: () => port.dismissPromo?.() ?? false,
    dismissMessage: "매장 홍보 안내 창을 닫았습니다.",
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
  }, options);
  return toPreparationResult(outcome,
    (cause) => MESSAGES[cause] ?? "예약창 진입을 확인할 수 없습니다.",
    ENTRY_TIMEOUT_MESSAGE);
}
