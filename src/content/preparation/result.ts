import type { FailureVia, PreparationCause } from "../../shared/run-control/causes.js";
import type { StepOutcome } from "./step-runner.js";

export type PreparationResult =
  | { kind: "ready" }
  | { kind: "failed"; cause: PreparationCause; via: FailureVia; attempts: number; message: string }
  | { kind: "stopped" }
  | { kind: "timed_out"; message: string };

export function toPreparationResult(
  outcome: StepOutcome,
  messageFor: (cause: PreparationCause, via: FailureVia) => string,
  timeoutMessage: string,
): PreparationResult {
  if (outcome.kind === "ready") return { kind: "ready" };
  if (outcome.kind === "stopped") return { kind: "stopped" };
  if (outcome.kind === "timed_out") return { kind: "timed_out", message: timeoutMessage };
  if (outcome.kind === "interrupted") {
    // interrupt는 해당 coordinator가 소비해야 하는 내부 신호다 — 여기 도달은 프로그래밍 오류.
    throw new Error(`처리되지 않은 준비 interrupt: ${outcome.token}`);
  }
  return { ...outcome, message: messageFor(outcome.cause, outcome.via) };
}
