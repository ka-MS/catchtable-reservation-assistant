import { classifyPersonFatal } from "../../shared/run-control/classifier.js";
import type { PersonFacts } from "../../shared/run-control/facts.js";
import { runPreparationStep, type StepRunOptions } from "./step-runner.js";
import { toPreparationResult, type PreparationResult } from "./result.js";

export interface PersonStagePort {
  inspect(personCount: number): PersonFacts;
  select(personCount: number): boolean;
}

export const PERSON_TIMEOUT_MESSAGE = "예약 인원 준비 중 감시 종료 시각에 도달했습니다.";

export async function runPersonPreparation(
  port: PersonStagePort,
  personCount: number,
  options: StepRunOptions,
): Promise<PreparationResult> {
  const outcome = await runPreparationStep<PersonFacts>({
    stage: "person",
    inspect: () => port.inspect(personCount),
    conditionKey: (f) => `${f.ready}:${f.targetAvailable}:${f.targetSelected}`,
    conditionAttributes: (f) => ({
      personControlReady: f.ready,
      targetPersonAvailable: f.targetAvailable,
      targetPersonSelected: f.targetSelected,
      preparationTargetPersonCount: personCount,
    }),
    isReady: (f) => f.targetSelected,
    fatal: classifyPersonFatal,
    canDispatch: (f) => f.targetAvailable,
    dispatch: () => port.select(personCount),
    dispatchAction: "select_person",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${personCount}명으로 설정했습니다.`
      : `${personCount}명 선택을 재시도했습니다.`),
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
  }, options);
  return toPreparationResult(outcome,
    (cause) => (cause === "PERSON_UNAVAILABLE"
      ? `이 식당에서 ${personCount}명을 선택할 수 없습니다.`
      : "예약 인원 선택 상태를 제한 시간 안에 확인할 수 없습니다."),
    PERSON_TIMEOUT_MESSAGE);
}
