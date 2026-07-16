// Phase 2에서 배선. Telemetry는 제어에 사용하지 않는다.
// outcome은 TerminalEffects·finishJob이 필요로 하는 전부(메시지·종료 시각)를 싣는다.
import type { RunState } from "../types.js";
import type { PreparationCause } from "./causes.js";

export type TerminalRunState = Extract<RunState,
  "DRY_RUN_COMPLETED" | "HANDED_OFF" | "COMPLETED" | "STOPPED" | "TIMED_OUT" | "FAILED">;
export type AttemptPhase = "PREPARING" | "EXECUTING";

export type AttemptOutcome =
  | {
    kind: "preparation_failed";
    state: "HANDED_OFF";
    cause: PreparationCause;
    attempts: number;
    message: string;
    finishedAt: number;
  }
  | { kind: "terminal"; state: TerminalRunState; message: string; finishedAt: number };

// content → background
export type AttemptControlMessage =
  | { type: "ATTEMPT_PHASE_CHANGED"; logicalRunId: string; attemptId: string; phase: AttemptPhase }
  | { type: "ATTEMPT_FINISHED"; logicalRunId: string; attemptId: string; outcome: AttemptOutcome };

/** sendResponse = ACK. ACK = "결정이 영속 접수됨"(행동 완료 아님).
 * 같은 attempt의 재전송에는 영속된 decision을 그대로 재ACK한다.
 * stale/missing은 침묵이 아니라 {ok:false, reason}으로 응답한다 — content가 재시도 중단을 판단. */
export type AttemptAckFailureReason = "unknown_logical_run" | "stale_attempt";
export type AttemptFinishedAck =
  | { ok: true; decision: "RESET_PAGE" | "HANDOFF" }
  | { ok: false; reason: AttemptAckFailureReason };
export type AttemptPhaseChangedAck =
  | { ok: true }
  | { ok: false; reason: AttemptAckFailureReason };

// background → content (SW bootstrap reconcile 전용 — PING은 주입 여부만 증명한다)
export interface AttemptStatusRequest { type: "GET_ATTEMPT_STATUS"; attemptId: string; }
export interface AttemptStatusResponse { attemptId: string; running: boolean; phase: AttemptPhase | null; }
