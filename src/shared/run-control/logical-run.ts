// LogicalRun 순수 전이. chrome/DOM 무접근 — supervisor가 storage 쓰기와 효과 실행을 소유한다.
import type { ReservationConfig } from "../types.js";
import type { PreparationCause } from "./causes.js";
import { decide } from "./policy.js";
import type {
  AttemptAckFailureReason, AttemptOutcome, AttemptPhase, TerminalRunState,
} from "./protocol.js";

export type LogicalRunStatus = "PREPARING" | "EXECUTING" | "RECOVERING" | "TERMINAL";
export type AttemptDecision = "RESET_PAGE" | "HANDOFF" | "TERMINAL";

export interface AttemptRecord {
  runId: string;            // = attemptId
  startedAt: number;
  finalState?: TerminalRunState;
  cause?: PreparationCause;
  /** TerminalEffects 재개용 — ACK 후 SW가 죽어도 알림을 복원한다. */
  message?: string;
  finishedAt?: number;
  /** 멱등 재ACK의 근거. */
  decision?: AttemptDecision;
  decidedAt?: number;
  /** durable flush 결과 — 유실 사실 기록(제어에 사용하지 않음). */
  flushOk?: boolean;
}

export interface LogicalRun {
  logicalRunId: string;
  origin: { kind: "manual" } | { kind: "scheduled"; jobId: string };
  config: ReservationConfig;
  tabId: number;
  status: LogicalRunStatus;
  startedAt: number;
  updatedAt: number;
  resetCount: number;
  currentAttemptId: string;
  attempts: AttemptRecord[];
  /** RESET 결정 후 실행 전 SW 사망을 복구하는 영속 intent. nextAttemptId는 결정 시점에 생성한다. */
  recovery?: { sourceAttemptId: string; nextAttemptId: string; action: "RESET_PAGE"; dispatchedAt?: number };
  /** TerminalEffects(알림·배지·job 종료) 완료 마커 — 없으면 reconcile이 재개한다. */
  terminalEffectsCompletedAt?: number;
}

export type OutcomeApplication =
  | { kind: "ack"; run: LogicalRun; decision: AttemptDecision }
  | { kind: "replay"; decision: AttemptDecision }
  | { kind: "reject"; reason: AttemptAckFailureReason };

export type PhaseApplication =
  | { kind: "ok"; run: LogicalRun }
  | { kind: "replay" }
  | { kind: "reject"; reason: AttemptAckFailureReason };

export function createLogicalRun(input: {
  logicalRunId: string;
  origin: LogicalRun["origin"];
  config: ReservationConfig;
  tabId: number;
  attemptId: string;
  nowMs: number;
}): LogicalRun {
  return {
    logicalRunId: input.logicalRunId,
    origin: input.origin,
    config: input.config,
    tabId: input.tabId,
    status: "PREPARING",
    startedAt: input.nowMs,
    updatedAt: input.nowMs,
    resetCount: 0,
    currentAttemptId: input.attemptId,
    attempts: [{ runId: input.attemptId, startedAt: input.nowMs }],
  };
}

function finishedRecord(
  record: AttemptRecord,
  outcome: AttemptOutcome,
  decision: AttemptDecision,
  nowMs: number,
  flushOk?: boolean,
): AttemptRecord {
  return {
    ...record,
    finalState: outcome.state,
    ...(outcome.kind === "preparation_failed" ? { cause: outcome.cause } : {}),
    message: outcome.message,
    finishedAt: outcome.finishedAt,
    decision,
    decidedAt: nowMs,
    ...(flushOk === undefined ? {} : { flushOk }),
  };
}

function sameOutcome(record: AttemptRecord, outcome: AttemptOutcome): boolean {
  return record.finalState === outcome.state && record.message === outcome.message;
}

/** FINISHED ingress 전부. 재전송 조회 순서: attempt 기록 → payload 검증 → stale. */
export function applyAttemptOutcome(
  run: LogicalRun,
  attemptId: string,
  outcome: AttemptOutcome,
  nowMs: number,
  nextAttemptId: string,
  flushOk?: boolean,
): OutcomeApplication {
  const record = run.attempts.find((attempt) => attempt.runId === attemptId);
  if (record?.decision !== undefined) {
    return sameOutcome(record, outcome)
      ? { kind: "replay", decision: record.decision }
      : { kind: "reject", reason: "outcome_conflict" };
  }
  if (attemptId !== run.currentAttemptId || record === undefined) {
    return { kind: "reject", reason: "stale_attempt" };
  }
  const withRecord = (
    decision: AttemptDecision,
    status: LogicalRunStatus,
    extra: Partial<LogicalRun> = {},
  ): LogicalRun => ({
    ...run,
    ...extra,
    status,
    updatedAt: nowMs,
    attempts: run.attempts.map((attempt) => (attempt.runId === attemptId
      ? finishedRecord(attempt, outcome, decision, nowMs, flushOk)
      : attempt)),
  });
  // 이미 background가 종결한 run(탭 닫힘 등)에 늦게 도착한 outcome — 재decide 없이 접수만.
  if (run.status === "TERMINAL" || outcome.kind === "terminal") {
    return { kind: "ack", run: withRecord("TERMINAL", "TERMINAL"), decision: "TERMINAL" };
  }
  // EXECUTING 진입 후에는 어떤 RESET도 금지 — 구조상 도달하지 않지만 가드한다.
  const action = run.status === "PREPARING"
    ? decide(outcome.cause, { resetCount: run.resetCount },
      { msToOpen: run.config.openAtMs - nowMs, msToStop: run.config.stopAtMs - nowMs },
      { entryMode: run.config.entryMode })
    : { kind: "HANDOFF" as const, cause: outcome.cause };
  if (action.kind === "RESET_PAGE") {
    return {
      kind: "ack",
      decision: "RESET_PAGE",
      run: withRecord("RESET_PAGE", "RECOVERING", {
        resetCount: run.resetCount + 1,
        recovery: { sourceAttemptId: attemptId, nextAttemptId, action: "RESET_PAGE" },
      }),
    };
  }
  return { kind: "ack", run: withRecord("HANDOFF", "TERMINAL"), decision: "HANDOFF" };
}

/** phase 단조: PREPARING → EXECUTING만 전진. 중복은 재ACK, 역행은 거부. */
export function applyPhaseChange(run: LogicalRun, attemptId: string, phase: AttemptPhase): PhaseApplication {
  const record = run.attempts.find((attempt) => attempt.runId === attemptId);
  if (attemptId !== run.currentAttemptId || record === undefined || record.decision !== undefined
    || run.status === "TERMINAL" || run.status === "RECOVERING") {
    return { kind: "reject", reason: "stale_attempt" };
  }
  if (run.status === phase) return { kind: "replay" };
  if (run.status === "EXECUTING" && phase === "PREPARING") {
    return { kind: "reject", reason: "phase_regression" };
  }
  // 순수 모듈은 Date.now()를 부르지 않는다 — updatedAt은 관측 편의 필드라 여기서는 유지한다.
  return { kind: "ok", run: { ...run, status: "EXECUTING" } };
}

/** 전이 원자성: attempts 추가·currentAttemptId 교체·PREPARING·recovery 제거를 한 값으로. */
export function beginNextAttempt(run: LogicalRun, nowMs: number): LogicalRun {
  if (run.recovery === undefined) throw new Error("recovery intent 없이 다음 attempt를 시작할 수 없습니다.");
  return {
    ...run,
    status: "PREPARING",
    updatedAt: nowMs,
    currentAttemptId: run.recovery.nextAttemptId,
    attempts: [...run.attempts, { runId: run.recovery.nextAttemptId, startedAt: nowMs }],
    recovery: undefined,
  };
}

export function markRecoveryDispatched(run: LogicalRun, nowMs: number): LogicalRun {
  if (run.recovery === undefined) throw new Error("recovery intent가 없습니다.");
  return { ...run, updatedAt: nowMs, recovery: { ...run.recovery, dispatchedAt: nowMs } };
}

/** RESET intent 시효: 실행 직전 재평가에서 창이 지났으면 terminal로 확정한다. */
export function applyRecoveryLapse(run: LogicalRun, nowMs: number): LogicalRun {
  return { ...run, status: "TERMINAL", updatedAt: nowMs, recovery: undefined };
}

/** stop·탭 닫힘·식당 이탈 등 background 종결 ingress.
 * decision은 찍지 않는다 — 재ACK할 content 메시지가 없고, 늦게 도착한 content
 * outcome은 status TERMINAL 분기에서 decision TERMINAL로 접수돼야 한다. */
export function applyBackgroundTerminal(
  run: LogicalRun,
  state: TerminalRunState,
  message: string,
  nowMs: number,
): LogicalRun {
  return {
    ...run,
    status: "TERMINAL",
    updatedAt: nowMs,
    recovery: undefined,
    attempts: run.attempts.map((attempt) => (attempt.runId === run.currentAttemptId && attempt.decision === undefined
      ? { ...attempt, finalState: state, message, finishedAt: nowMs }
      : attempt)),
  };
}

export function markTerminalEffectsCompleted(run: LogicalRun, nowMs: number): LogicalRun {
  return { ...run, updatedAt: nowMs, terminalEffectsCompletedAt: nowMs };
}
