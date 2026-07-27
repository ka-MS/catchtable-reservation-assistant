// LogicalRun 순수 전이. chrome/DOM 무접근 — supervisor가 storage 쓰기와 효과 실행을 소유한다.
import type { ReservationConfig } from "../types.js";
import type { PreparationCause } from "./causes.js";
import { decide } from "./policy.js";
import type {
  AttemptAckFailureReason, AttemptOutcome, AttemptPhase, CompletionDispatchAckFailureReason,
  CompletionDispatchPhase, TerminalRunState,
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

/**
 * 외부/PIN 내부 제출 클릭 권한의 acknowledged durable 기록 — PIN·자유입력·카드 정보를
 * 갖지 않는다(20-design §8). fingerprint는 target slug/날짜/실제 선택 시간/인원/현재
 * 금액/폼 fingerprint hash로만 구성된 문자열이다. outer claim이 ACK되기 전에는 이
 * variant가 존재하지 않는다 — fingerprint·outerClaimedAt은 필수다.
 */
export interface CompletionDispatchClaim {
  fingerprint: string;
  outerClaimedAt: number;
  pinClaimedAt?: number;
  stopRequestedAt?: number;
}

/**
 * outer claim보다 stop이 먼저 직렬화되면(pre-claim stop) fingerprint·outerClaimedAt
 * 없는 순수 stop-marker만 영속된다 — CompletionDispatchClaim과 별개 variant다.
 * acknowledged claim 판정("outerClaimedAt" in state)은 이 variant를 절대 포함하지 않는다.
 */
export type CompletionDispatchState =
  | { stopRequestedAt: number }
  | CompletionDispatchClaim;

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
  /** 완주 외부/내부 제출 클릭 권한 durable claim — Task 2(20-design §8). */
  completionDispatch?: CompletionDispatchState;
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

export type CompletionDispatchApplication =
  | { kind: "ack"; run: LogicalRun }
  | { kind: "replay" }
  | { kind: "reject"; reason: Exclude<CompletionDispatchAckFailureReason, "unknown_logical_run"> };

/** acknowledged claim variant 판정 — outer claim이 실제로 ACK된 뒤에만 참이다.
 * `completionDispatch`는 chrome.storage.local에서 그대로 역직렬화되므로 손상되거나
 * malformed된 값(빈 fingerprint, NaN·문자열 outerClaimedAt 등)을 acknowledged로
 * 오판하지 않도록 값의 형태까지 엄격히 검증한다 — 이 판정은 stop/reconcile/navigation의
 * "이미 결제가 진행됐을 수 있다"는 안전 경계를 gating하므로 존재 여부만으로는 부족하다. */
export function isAcknowledgedCompletionClaim(
  state: CompletionDispatchState | undefined,
): state is CompletionDispatchClaim {
  if (state === undefined || typeof state !== "object" || state === null) return false;
  const candidate = state as { fingerprint?: unknown; outerClaimedAt?: unknown };
  return typeof candidate.fingerprint === "string"
    && candidate.fingerprint.length > 0
    && typeof candidate.outerClaimedAt === "number"
    && Number.isFinite(candidate.outerClaimedAt);
}

/** stop 요청을 completionDispatch에 멱등 영속한다. outer claim이 아직 ACK되지 않았다면
 * fingerprint 없는 stop-marker variant만 남기고, 이미 acknowledged claim이 있다면
 * fingerprint·outerClaimedAt·pinClaimedAt은 그대로 두고 stopRequestedAt만 추가한다. */
export function requestCompletionStop(run: LogicalRun, nowMs: number): LogicalRun {
  const existing = run.completionDispatch;
  if (existing?.stopRequestedAt !== undefined) return run;
  if (isAcknowledgedCompletionClaim(existing)) {
    return { ...run, completionDispatch: { ...existing, stopRequestedAt: nowMs } };
  }
  return { ...run, completionDispatch: { stopRequestedAt: nowMs } };
}

/** 완주 외부/PIN 내부 제출 클릭 권한 claim(20-design §8) — 처리 순서: active EXECUTING
 * attempt 확인 → stop 선행 확인 → phase 순서·fingerprint 확인 → 영속. PIN은 인자로도
 * 받지 않는다. */
export function applyCompletionDispatchClaim(
  run: LogicalRun,
  attemptId: string,
  phase: CompletionDispatchPhase,
  fingerprint: string,
  nowMs: number,
): CompletionDispatchApplication {
  if (attemptId !== run.currentAttemptId || run.status !== "EXECUTING") {
    return { kind: "reject", reason: "stale_attempt" };
  }
  const existing = run.completionDispatch;
  if (existing?.stopRequestedAt !== undefined) {
    return { kind: "reject", reason: "stop_requested" };
  }
  // stop-marker variant는 항상 stopRequestedAt을 갖고 위에서 이미 처리됐으므로,
  // 여기 도달한 existing은 undefined이거나 acknowledged CompletionDispatchClaim뿐이다.
  const claim = isAcknowledgedCompletionClaim(existing) ? existing : undefined;
  if (phase === "pin") {
    if (claim === undefined) return { kind: "reject", reason: "phase_order" };
    if (claim.fingerprint !== fingerprint) return { kind: "reject", reason: "fingerprint_mismatch" };
    if (claim.pinClaimedAt !== undefined) return { kind: "replay" };
    return {
      kind: "ack",
      run: { ...run, completionDispatch: { ...claim, pinClaimedAt: nowMs } },
    };
  }
  // phase === "outer"
  if (claim?.pinClaimedAt !== undefined) return { kind: "reject", reason: "phase_order" };
  if (claim?.outerClaimedAt !== undefined) {
    return claim.fingerprint === fingerprint
      ? { kind: "replay" }
      : { kind: "reject", reason: "fingerprint_mismatch" };
  }
  return {
    kind: "ack",
    run: { ...run, completionDispatch: { fingerprint, outerClaimedAt: nowMs } },
  };
}
