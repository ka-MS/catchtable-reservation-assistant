// Phase 2에서 배선. Telemetry는 제어에 사용하지 않는다.
// outcome은 TerminalEffects·finishJob이 필요로 하는 전부(메시지·종료 시각)를 싣는다.
import type { RunState } from "../types.js";
import type { PreparationCause } from "./causes.js";

export type TerminalRunState = Extract<RunState,
  "DRY_RUN_COMPLETED" | "HANDED_OFF" | "COMPLETED" | "STOPPED" | "TIMED_OUT" | "FAILED">;
export type AttemptPhase = "PREPARING" | "EXECUTING";

/** 완주 외부/내부 제출 클릭 권한 phase — PIN은 이 채널을 지나가지 않는다(20-design §8). */
export type CompletionDispatchPhase = "outer" | "pin";

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

// content → background. flush: durable flush 결과 동반 — 복구 진행은 결과와 무관, 유실 사실만 기록.
export type AttemptControlMessage =
  | { type: "ATTEMPT_PHASE_CHANGED"; logicalRunId: string; attemptId: string; phase: AttemptPhase }
  | {
    type: "ATTEMPT_FINISHED"; logicalRunId: string; attemptId: string;
    outcome: AttemptOutcome; flush: { ok: boolean };
  }
  | {
    type: "COMPLETION_DISPATCH_CLAIM"; logicalRunId: string; attemptId: string;
    phase: CompletionDispatchPhase; fingerprint: string;
  };

/** sendResponse = ACK. ACK = "결정이 영속 접수됨"(행동 완료 아님).
 * 같은 attempt의 재전송에는 영속된 decision을 그대로 재ACK한다.
 * stale/missing은 침묵이 아니라 {ok:false, reason}으로 응답한다 — content가 재시도 중단을 판단. */
export type AttemptAckFailureReason =
  | "unknown_logical_run" | "stale_attempt" | "outcome_conflict" | "phase_regression";
export type AttemptFinishedAck =
  // TERMINAL = 일반 종결(COMPLETED/STOPPED/FAILED 등) 접수 — 복구 결정이 아니다.
  | { ok: true; decision: "RESET_PAGE" | "HANDOFF" | "TERMINAL" }
  | { ok: false; reason: AttemptAckFailureReason };
export type AttemptPhaseChangedAck =
  | { ok: true }
  | { ok: false; reason: AttemptAckFailureReason };

/** ACK = "클릭 권한이 영속 접수됨"(클릭 성공이 아니다). PIN·secret은 이 채널에 없다.
 * dispatchGranted=true는 이번 호출로 새로 영속된 권한 — content는 이때만 클릭한다.
 * dispatchGranted=false는 같은 phase·fingerprint의 멱등 재ACK(예: ACK 유실 뒤 재전송) —
 * 이미 이전에 권한이 부여됐다는 뜻이므로 content는 다시 클릭하지 않는다. */
export type CompletionDispatchAckFailureReason =
  | "unknown_logical_run" | "stale_attempt" | "fingerprint_mismatch" | "phase_order" | "stop_requested";
export type CompletionDispatchAck =
  | { ok: true; dispatchGranted: boolean }
  | { ok: false; reason: CompletionDispatchAckFailureReason };

// background → content (SW bootstrap reconcile 전용 — PING은 주입 여부만 증명한다)
export interface AttemptStatusRequest { type: "GET_ATTEMPT_STATUS"; attemptId: string; }
// FINISHING = terminal 도달 후 ATTEMPT_FINISHED 전송 중 — reconcile 오판 방지.
export interface AttemptStatusResponse {
  attemptId: string;
  running: boolean;
  phase: AttemptPhase | "FINISHING" | null;
  /** FINISHING이면 상태 응답이 outcome 수신 경로를 겸한다. */
  pendingOutcome?: AttemptOutcome;
}
