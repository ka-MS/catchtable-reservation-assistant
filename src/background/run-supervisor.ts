// 논리 실행(LogicalRun)의 process manager. 결정(순수 전이)과 효과(탭·알림·storage)를
// 잇는 유일한 지점이며, 모든 상태 변경은 단일 SerialTaskQueue에서 직렬화된다 —
// "결정 영속 → ACK → 행동" 순서를 코드 구조로 강제한다.
import { resolveAvailabilityProbeMode } from "../shared/config.js";
import {
  applyAttemptOutcome, applyBackgroundTerminal, applyPhaseChange, applyRecoveryLapse,
  beginNextAttempt, createLogicalRun, markRecoveryDispatched, markTerminalEffectsCompleted,
  type LogicalRun,
} from "../shared/run-control/logical-run.js";
import { decide } from "../shared/run-control/policy.js";
import type {
  AttemptControlMessage, AttemptFinishedAck, AttemptOutcome, AttemptPhaseChangedAck, TerminalRunState,
} from "../shared/run-control/protocol.js";
import type {
  ActiveRun, CommandResponse, ContentCommand, ReservationConfig, RunExecutionContext, RunState, ScheduledJob,
} from "../shared/types.js";
import { sameRestaurant, leftReservationFlow } from "./navigation.js";
import type { PageRuntimePort } from "./page-runtime-port.js";
import type { LaunchResult } from "./scheduler.js";
import { SerialTaskQueue } from "./storage.js";

const TERMINAL_STATES = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
]);

export interface SupervisorDependencies {
  storage: {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };
  port: PageRuntimePort;
  effects(run: LogicalRun): Promise<void>;
  trace: {
    startFailure(runId: string, config: ReservationConfig, message: string, error?: unknown, jobId?: string): Promise<void>;
    backgroundTerminal(runId: string, startedAt: number, config: ReservationConfig, state: Extract<TerminalRunState, "STOPPED" | "FAILED" | "TIMED_OUT">, message: string, jobId?: string): Promise<void>;
    recovery(runId: string, config: ReservationConfig, code: "RECOVERY_DECIDED" | "RECOVERY_DISPATCHED", message: string, attributes: Record<string, string | number | boolean | null>, jobId?: string): Promise<void>;
  };
  probe(tabId: number, enabled: boolean): Promise<boolean>;
  captureContext(tabId: number): Promise<RunExecutionContext | undefined>;
  activeTab(): Promise<{ id?: number; url?: string } | undefined>;
  createTab(url: string): Promise<number>;
  validate(config: ReservationConfig, nowMs: number): string[];
  saveHistory(config: ReservationConfig): void;
  newId(): string;
  now(): number;
}

interface StoredState {
  logicalRun?: LogicalRun | null;
  activeRun?: ActiveRun | null;
  reservationConfig?: ReservationConfig;
}

type StartCommand = Extract<ContentCommand, { type: "START" }>;

export class RunSupervisor {
  private readonly queue = new SerialTaskQueue();
  private readonly cancelledPendingRuns = new Set<string>();
  readonly ready: Promise<void>;

  constructor(private readonly deps: SupervisorDependencies) {
    this.ready = this.queue.enqueue(() => this.reconcile()).catch((error) => {
      console.error("logical run 복구에 실패했습니다.", error);
    });
  }

  /** 테스트·진단용 — 현재 예약된 모든 작업이 끝난 뒤 resolve한다. */
  whenIdle(): Promise<void> {
    return this.queue.enqueue(async () => undefined);
  }

  startManual(config: ReservationConfig): Promise<CommandResponse> {
    return this.queue.enqueue(async () => {
      const runId = `run-${this.deps.newId()}`;
      const errors = this.deps.validate(config, this.deps.now());
      if (errors.length > 0) {
        const message = errors.join(" ");
        await this.deps.trace.startFailure(runId, config, message);
        return { ok: false, error: message };
      }
      const busy = await this.busyError();
      if (busy !== null) {
        await this.deps.trace.startFailure(runId, config, busy);
        return { ok: false, error: busy };
      }
      const tab = await this.deps.activeTab();
      if (!tab?.id) {
        const message = "실행할 Chrome 탭을 활성화하세요.";
        await this.deps.trace.startFailure(runId, config, message);
        return { ok: false, error: message };
      }
      if (config.entryMode === "prepared" && !sameRestaurant(tab.url, config.targetUrl)) {
        const message = "설정한 식당의 Catchtable 탭을 활성화하세요.";
        await this.deps.trace.startFailure(runId, config, message);
        return { ok: false, error: message };
      }
      return this.startLogical({ id: tab.id, url: tab.url }, config, { kind: "manual" }, runId);
    });
  }

  startScheduled(job: ScheduledJob): Promise<LaunchResult> {
    return this.queue.enqueue(async (): Promise<LaunchResult> => {
      const runId = `run-${this.deps.newId()}`;
      const errors = this.deps.validate(job.config, this.deps.now());
      if (errors.length > 0) {
        const message = errors.join(" ");
        await this.deps.trace.startFailure(runId, job.config, message, undefined, job.id);
        return { ok: false, kind: "failed", error: message };
      }
      const busy = await this.busyError();
      if (busy !== null) {
        await this.deps.trace.startFailure(runId, job.config, busy, undefined, job.id);
        return { ok: false, kind: "busy", error: busy };
      }
      let tabId: number;
      try {
        tabId = await this.deps.createTab(job.config.targetUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "예약 실행 탭을 만들 수 없습니다.";
        await this.deps.trace.startFailure(runId, job.config, message, error, job.id);
        return { ok: false, kind: "failed", error: message };
      }
      // url을 비워 자동 이동을 강제한다 — navigateIfNeeded가 생성 탭 로드 완료까지 기다린다.
      const response = await this.startLogical(
        { id: tabId, url: undefined },
        job.config,
        { kind: "scheduled", jobId: job.id },
        runId,
      );
      if (response.ok) return { ok: true };
      return { ok: false, kind: "failed", error: response.error ?? "실행을 시작할 수 없습니다." };
    });
  }

  stop(): Promise<CommandResponse> {
    return this.queue.enqueue(async () => {
      const state = await this.read();
      const activeRun = state.activeRun ?? null;
      if (!activeRun) return { ok: false, error: "실행 중인 작업이 없습니다." };
      if (activeRun.state === "NAVIGATING" || activeRun.state === "CONFIGURED") {
        this.cancelledPendingRuns.add(activeRun.runId);
        await this.deps.storage.set({ activeRun: { ...activeRun, state: "STOPPED", updatedAt: this.deps.now() } });
        await this.terminateLogical(state, "STOPPED", "페이지 준비 중 사용자가 실행을 중지했습니다.");
        const delivered = await this.deps.port.stopAttempt(activeRun.tabId);
        if (!delivered && state.reservationConfig) {
          // Content Script가 아직 주입되지 않은 이동 단계에서도 Background가 중지를 확정한다.
          await this.deps.trace.backgroundTerminal(
            activeRun.runId,
            activeRun.startedAt,
            state.reservationConfig,
            "STOPPED",
            "페이지 준비 중 사용자가 실행을 중지했습니다.",
            activeRun.scheduledJobId,
          ).catch((error) => console.error("중지 추적을 저장하지 못했습니다.", error));
        }
        return { ok: true };
      }
      const delivered = await this.deps.port.stopAttempt(activeRun.tabId);
      if (!delivered) {
        await this.deps.storage.set({ activeRun: { ...activeRun, state: "STOPPED", updatedAt: this.deps.now() } });
        await this.terminateLogical(state, "STOPPED", "사용자가 실행을 중지했습니다.");
      }
      // 도달했다면 content가 terminal을 확정하고 ATTEMPT_FINISHED로 종결을 보고한다.
      return { ok: true };
    });
  }

  onAttemptFinished(message: Extract<AttemptControlMessage, { type: "ATTEMPT_FINISHED" }>): Promise<AttemptFinishedAck> {
    return this.queue.enqueue(async () => {
      const state = await this.read();
      const run = state.logicalRun ?? null;
      if (!run || run.logicalRunId !== message.logicalRunId) {
        return { ok: false, reason: "unknown_logical_run" } as const;
      }
      const result = await this.processOutcome(run, message.attemptId, message.outcome, message.flush.ok);
      if (result.followUp !== null) {
        const followUp = result.followUp;
        // ACK(반환)가 먼저 나가고, 행동은 다음 queue 턴에서 실행된다.
        void this.queue.enqueue(followUp).catch((error) => {
          console.error("attempt 종결 후속 처리에 실패했습니다.", error);
        });
      }
      return result.ack;
    });
  }

  onPhaseChanged(message: Extract<AttemptControlMessage, { type: "ATTEMPT_PHASE_CHANGED" }>): Promise<AttemptPhaseChangedAck> {
    return this.queue.enqueue(async () => {
      const state = await this.read();
      const run = state.logicalRun ?? null;
      if (!run || run.logicalRunId !== message.logicalRunId) {
        return { ok: false, reason: "unknown_logical_run" } as const;
      }
      const app = applyPhaseChange(run, message.attemptId, message.phase);
      if (app.kind === "reject") return { ok: false, reason: app.reason } as const;
      if (app.kind === "ok") await this.deps.storage.set({ logicalRun: app.run });
      return { ok: true } as const;
    });
  }

  onTabRemoved(tabId: number): Promise<void> {
    return this.queue.enqueue(async () => {
      const state = await this.read();
      const activeRun = state.activeRun ?? null;
      if (activeRun?.tabId === tabId && !TERMINAL_STATES.has(activeRun.state)) {
        await this.deps.storage.set({ activeRun: { ...activeRun, state: "STOPPED", updatedAt: this.deps.now() } });
        if (state.reservationConfig) {
          await this.deps.trace.backgroundTerminal(
            activeRun.runId,
            activeRun.startedAt,
            state.reservationConfig,
            "STOPPED",
            "실행 탭이 닫혔습니다.",
            activeRun.scheduledJobId,
          ).catch((error) => console.error("종결 추적을 저장하지 못했습니다.", error));
        }
      }
      if (state.logicalRun && state.logicalRun.tabId === tabId && state.logicalRun.status !== "TERMINAL") {
        await this.terminateLogical(state, "STOPPED", "실행 탭이 닫혔습니다.");
      }
    });
  }

  onTabUrlChanged(tabId: number, url: string): Promise<void> {
    return this.queue.enqueue(async () => {
      const state = await this.read();
      const activeRun = state.activeRun ?? null;
      const config = state.reservationConfig;
      if (!config || !leftReservationFlow(url, config.targetUrl)) return;
      if (activeRun?.tabId === tabId && !TERMINAL_STATES.has(activeRun.state)) {
        await this.deps.storage.set({ activeRun: { ...activeRun, state: "STOPPED", updatedAt: this.deps.now() } });
        await this.deps.trace.backgroundTerminal(
          activeRun.runId,
          activeRun.startedAt,
          config,
          "STOPPED",
          "실행 탭이 설정한 식당을 벗어났습니다.",
          activeRun.scheduledJobId,
        ).catch((error) => console.error("종결 추적을 저장하지 못했습니다.", error));
      }
      if (state.logicalRun && state.logicalRun.tabId === tabId && state.logicalRun.status !== "TERMINAL") {
        await this.terminateLogical(state, "STOPPED", "실행 탭이 설정한 식당을 벗어났습니다.");
      }
    });
  }

  // --- 내부 (queue 안에서만 호출 — 중첩 enqueue 금지) ---

  private async read(): Promise<StoredState> {
    return await this.deps.storage.get(["logicalRun", "activeRun", "reservationConfig"]) as StoredState;
  }

  private async busyError(): Promise<string | null> {
    const state = await this.read();
    const activeRun = state.activeRun ?? null;
    if (activeRun && !TERMINAL_STATES.has(activeRun.state)) return "이미 실행 중인 작업이 있습니다.";
    return null;
  }

  private async startLogical(
    tab: { id: number; url?: string },
    config: ReservationConfig,
    origin: LogicalRun["origin"],
    runId: string,
  ): Promise<CommandResponse> {
    const now = this.deps.now();
    const needsNavigation = config.entryMode === "auto" && !sameRestaurant(tab.url, config.targetUrl);
    const pendingRun: ActiveRun = {
      runId,
      tabId: tab.id,
      state: needsNavigation ? "NAVIGATING" : "CONFIGURED",
      startedAt: now,
      updatedAt: now,
      ...(origin.kind === "scheduled" ? { scheduledJobId: origin.jobId } : {}),
    };
    await this.deps.storage.set({ reservationConfig: config, activeRun: pendingRun, runEvents: [] });
    this.deps.saveHistory(config);
    const assertPending = async (): Promise<void> => {
      const current = (await this.deps.storage.get("activeRun") as { activeRun?: ActiveRun | null }).activeRun;
      if (this.cancelledPendingRuns.has(runId)
        || current?.runId !== runId
        || TERMINAL_STATES.has(current.state)) {
        throw new Error("페이지 준비 중 실행이 중지됐습니다.");
      }
    };
    try {
      if (config.entryMode === "auto") await this.deps.port.navigateIfNeeded(tab.id, config.targetUrl);
      await assertPending();
      await this.deps.port.inject(tab.id);
      const shadowChannelId = (await this.deps.probe(tab.id, resolveAvailabilityProbeMode(config) !== "off"))
        ? `shadow-${this.deps.newId()}`
        : undefined;
      await assertPending();
      const executionContext = await this.deps.captureContext(tab.id);
      const logicalRun = createLogicalRun({
        logicalRunId: `lr-${this.deps.newId()}`,
        origin,
        config,
        tabId: tab.id,
        attemptId: runId,
        nowMs: this.deps.now(),
      });
      await this.deps.storage.set({
        activeRun: { ...pendingRun, state: "CONFIGURED", updatedAt: this.deps.now() },
        logicalRun,
      });
      await assertPending();
      const response = await this.deps.port.startAttempt(tab.id, this.startCommand(logicalRun, runId, 0, undefined, shadowChannelId, executionContext));
      if (response.ok) return { ok: true };
      throw new Error(response.error ?? "실행을 시작할 수 없습니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "실행을 시작할 수 없습니다.";
      const current = await this.read();
      if (current.activeRun?.runId === runId && !TERMINAL_STATES.has(current.activeRun.state)) {
        await this.deps.storage.set({
          activeRun: { ...current.activeRun, state: "FAILED", updatedAt: this.deps.now() },
        });
      }
      if (current.logicalRun?.currentAttemptId === runId && current.logicalRun.status !== "TERMINAL") {
        // 시작 실패는 논리 실행이 성립하지 않은 것 — 효과(알림) 없이 정리한다(기존 동작 보존).
        await this.deps.storage.set({ logicalRun: null });
      }
      await this.deps.trace.startFailure(runId, config, message, error,
        origin.kind === "scheduled" ? origin.jobId : undefined);
      return { ok: false, error: message };
    } finally {
      this.cancelledPendingRuns.delete(runId);
    }
  }

  private startCommand(
    run: LogicalRun,
    attemptId: string,
    attemptIndex: number,
    resetCause: string | undefined,
    shadowChannelId: string | undefined,
    executionContext: RunExecutionContext | undefined,
  ): StartCommand {
    return {
      type: "START",
      runId: attemptId,
      logicalRunId: run.logicalRunId,
      attemptIndex,
      config: run.config,
      ...(resetCause === undefined ? {} : { resetCause }),
      ...(shadowChannelId === undefined ? {} : { shadowChannelId }),
      ...(executionContext === undefined ? {} : { executionContext }),
      ...(run.origin.kind === "scheduled" ? { scheduledJobId: run.origin.jobId } : {}),
    };
  }

  private async processOutcome(
    run: LogicalRun,
    attemptId: string,
    outcome: AttemptOutcome,
    flushOk: boolean | undefined,
  ): Promise<{ ack: AttemptFinishedAck; followUp: (() => Promise<void>) | null }> {
    const nextAttemptId = `run-${this.deps.newId()}`;
    const nowMs = this.deps.now();
    const app = applyAttemptOutcome(run, attemptId, outcome, nowMs, nextAttemptId, flushOk);
    if (app.kind === "reject") return { ack: { ok: false, reason: app.reason }, followUp: null };
    if (app.kind === "replay") return { ack: { ok: true, decision: app.decision }, followUp: null };
    await this.deps.storage.set({ logicalRun: app.run });
    if (outcome.kind === "preparation_failed") {
      void this.deps.trace.recovery(attemptId, run.config, "RECOVERY_DECIDED",
        `준비 실패 복구 결정: ${app.decision}`, {
          resetCause: outcome.cause,
          recoveryAction: app.decision,
          resetCount: app.run.resetCount,
          msToOpen: run.config.openAtMs - nowMs,
          msToStop: run.config.stopAtMs - nowMs,
        }, run.origin.kind === "scheduled" ? run.origin.jobId : undefined,
      ).catch((error) => console.error("복구 결정 추적을 저장하지 못했습니다.", error));
    }
    const followUp = app.decision === "RESET_PAGE"
      ? () => this.executeRecovery()
      : () => this.completeTerminal();
    return { ack: { ok: true, decision: app.decision }, followUp };
  }

  /** TERMINAL 확정 뒤 효과 실행 + 완료 마커 — 멱등(마커 존재 시 no-op). */
  private async completeTerminal(): Promise<void> {
    const state = await this.read();
    const run = state.logicalRun ?? null;
    if (!run || run.status !== "TERMINAL" || run.terminalEffectsCompletedAt !== undefined) return;
    await this.deps.effects(run);
    await this.deps.storage.set({ logicalRun: markTerminalEffectsCompleted(run, this.deps.now()) });
  }

  private async terminateLogical(
    state: StoredState,
    terminalState: Extract<TerminalRunState, "STOPPED" | "FAILED">,
    message: string,
  ): Promise<void> {
    const run = state.logicalRun ?? null;
    if (!run || run.status === "TERMINAL") return;
    const terminated = applyBackgroundTerminal(run, terminalState, message, this.deps.now());
    await this.deps.storage.set({ logicalRun: terminated });
    await this.deps.effects(terminated);
    await this.deps.storage.set({ logicalRun: markTerminalEffectsCompleted(terminated, this.deps.now()) });
  }

  private async executeRecovery(): Promise<void> {
    const state = await this.read();
    const run = state.logicalRun ?? null;
    if (!run || run.status !== "RECOVERING" || run.recovery === undefined) return;
    const source = run.attempts.find((attempt) => attempt.runId === run.recovery?.sourceAttemptId);
    const cause = source?.cause ?? "DATE_SELECTION_STALLED";
    const nowMs = this.deps.now();
    // intent는 영속된 계획이지 무조건 실행 티켓이 아니다 — 실행 직전 시간 창을 재평가한다.
    // 예산은 결정 시점 기준(resetCount는 이미 증가돼 있으므로 되돌려 평가).
    const action = decide(cause, { resetCount: Math.max(0, run.resetCount - 1) },
      { msToOpen: run.config.openAtMs - nowMs, msToStop: run.config.stopAtMs - nowMs },
      { entryMode: run.config.entryMode });
    if (action.kind !== "RESET_PAGE") {
      const lapsed = applyRecoveryLapse(run, nowMs);
      await this.deps.storage.set({ logicalRun: lapsed });
      await this.deps.effects(lapsed);
      await this.deps.storage.set({ logicalRun: markTerminalEffectsCompleted(lapsed, this.deps.now()) });
      return;
    }
    if (run.recovery.dispatchedAt !== undefined) {
      // SW 사망 후 재개 — next attempt가 이미 실행 중이면 전이 쓰기만 수행한다(멱등).
      const status = await this.deps.port.getAttemptStatus(run.tabId, run.recovery.nextAttemptId);
      if (status?.running) {
        await this.commitNextAttempt(run);
        return;
      }
    }
    const dispatched = markRecoveryDispatched(run, nowMs);
    await this.deps.storage.set({ logicalRun: dispatched });
    const recovery = dispatched.recovery;
    if (recovery === undefined) return;
    try {
      await this.deps.port.forceReenter(dispatched.tabId, dispatched.config.targetUrl);
      await this.deps.port.inject(dispatched.tabId);
      const shadowChannelId = (await this.deps.probe(dispatched.tabId, resolveAvailabilityProbeMode(dispatched.config) !== "off"))
        ? `shadow-${this.deps.newId()}`
        : undefined;
      const executionContext = await this.deps.captureContext(dispatched.tabId);
      const response = await this.deps.port.startAttempt(dispatched.tabId, this.startCommand(
        dispatched, recovery.nextAttemptId, dispatched.attempts.length, cause, shadowChannelId, executionContext));
      if (!response.ok) throw new Error(response.error ?? "재시도 실행을 시작할 수 없습니다.");
      await this.commitNextAttempt(dispatched);
      // source attempt의 닫힌 이벤트 스트림에 기록한다 — next attempt 밑에 쓰면
      // 병행 실행 중인 content의 seq와 충돌해 유실된다(E2E 관측).
      void this.deps.trace.recovery(recovery.sourceAttemptId, dispatched.config, "RECOVERY_DISPATCHED",
        "같은 탭 재진입으로 재시도 attempt를 시작했습니다.", {
          nextAttemptId: recovery.nextAttemptId,
          resetCause: cause,
        }, dispatched.origin.kind === "scheduled" ? dispatched.origin.jobId : undefined,
      ).catch((error) => console.error("복구 실행 추적을 저장하지 못했습니다.", error));
    } catch (error) {
      const message = error instanceof Error ? error.message : "재시도 준비에 실패했습니다.";
      // source attempt의 decision 기록은 재ACK 계약을 위해 보존된다 — 알림 메시지는
      // source의 준비 실패 원문이 나가고, 재시도 실패 상세는 trace로 남긴다.
      const failed = applyBackgroundTerminal(dispatched, "FAILED", `재시도 준비에 실패했습니다: ${message}`, this.deps.now());
      const current = await this.read();
      if (current.activeRun && !TERMINAL_STATES.has(current.activeRun.state)) {
        await this.deps.storage.set({
          activeRun: { ...current.activeRun, state: "FAILED", updatedAt: this.deps.now() },
        });
      }
      await this.deps.storage.set({ logicalRun: failed });
      await this.deps.trace.backgroundTerminal(recovery.nextAttemptId, dispatched.startedAt, dispatched.config,
        "FAILED", `재시도 준비에 실패했습니다: ${message}`,
        dispatched.origin.kind === "scheduled" ? dispatched.origin.jobId : undefined,
      ).catch((traceError) => console.error("재시도 실패 추적을 저장하지 못했습니다.", traceError));
      await this.deps.effects(failed);
      await this.deps.storage.set({ logicalRun: markTerminalEffectsCompleted(failed, this.deps.now()) });
    }
  }

  /** 전이 원자성: attempts 추가·current 교체·PREPARING·recovery 제거 + projection 초기화. */
  private async commitNextAttempt(run: LogicalRun): Promise<void> {
    const nowMs = this.deps.now();
    const next = beginNextAttempt(run, nowMs);
    const activeRun: ActiveRun = {
      runId: next.currentAttemptId,
      tabId: next.tabId,
      state: "CONFIGURED",
      startedAt: nowMs,
      updatedAt: nowMs,
      ...(next.origin.kind === "scheduled" ? { scheduledJobId: next.origin.jobId } : {}),
    };
    await this.deps.storage.set({ logicalRun: next, activeRun, runEvents: [] });
  }

  /** SW 부트스트랩 reconcile — 크래시 지점 표(§B)의 4분기. */
  private async reconcile(): Promise<void> {
    const state = await this.read();
    const run = state.logicalRun ?? null;
    if (!run) return;
    if (run.status === "TERMINAL") {
      if (run.terminalEffectsCompletedAt === undefined) await this.completeTerminal();
      return;
    }
    if (run.status === "RECOVERING") {
      await this.executeRecovery();
      return;
    }
    const status = await this.deps.port.getAttemptStatus(run.tabId, run.currentAttemptId);
    if (status?.running) return;
    if (status?.phase === "FINISHING" && status.pendingOutcome !== undefined) {
      // FINISHING이면 상태 응답이 outcome 수신 경로를 겸한다(C3).
      const result = await this.processOutcome(run, run.currentAttemptId, status.pendingOutcome, undefined);
      if (result.followUp !== null) await result.followUp();
      return;
    }
    const failed = applyBackgroundTerminal(run, "FAILED", "실행 문맥이 유실됐습니다.", this.deps.now());
    await this.deps.storage.set({ logicalRun: failed });
    const current = await this.read();
    if (current.activeRun?.runId === run.currentAttemptId && !TERMINAL_STATES.has(current.activeRun.state)) {
      await this.deps.storage.set({
        activeRun: { ...current.activeRun, state: "FAILED", updatedAt: this.deps.now() },
      });
    }
    await this.deps.effects(failed);
    await this.deps.storage.set({ logicalRun: markTerminalEffectsCompleted(failed, this.deps.now()) });
  }
}
