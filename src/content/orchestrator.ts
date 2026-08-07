import { resolveAvailabilityProbeMode, validateReservationConfig } from "../shared/config.js";
import { estimateReferenceClock, type ReferenceClockEstimate, type ReferenceClockSample } from "../shared/clock.js";
import { waitUntil, type Clock, type Sleep } from "../shared/scheduler.js";
import { MonotonicEpochClock } from "../shared/monotonic-clock.js";
import { selectPreferredSlot, type SlotCandidate } from "../shared/slot-selection.js";
import {
  type AvailabilityTargetCycleMarker,
  type ReceivedAvailabilityShadowEvent,
} from "../shared/availability-shadow.js";
import { RunStateMachine } from "../shared/state-machine.js";
import { nextTogglePlan } from "../shared/toggle-schedule.js";
import type { SlotRefreshWatchPort } from "./adapter/slot-refresh-watch.js";
import type { SlotDomMutationWatchPort } from "./adapter/slot-dom-mutation-watch.js";
import type { ReferenceClockPort } from "./reference-clock-sampler.js";
import type { OneShotRunAuthorization, ReservationConfig, RunEvent, RunExecutionContext, RunState } from "../shared/types.js";
import type { TraceCode } from "../shared/telemetry/codes.js";
import type { TraceAttributes, TraceSeverity } from "../shared/telemetry/types.js";
import type { CalendarInspection } from "./adapter/calendar.js";
import type { CalendarFacts, EntryFacts, PersonFacts } from "../shared/run-control/facts.js";
import type { PreparationCause } from "../shared/run-control/causes.js";
import { runEntryPreparation } from "./preparation/entry-coordinator.js";
import { runCalendarPreparation } from "./preparation/calendar-coordinator.js";
import { runPersonPreparation } from "./preparation/person-coordinator.js";
import type { PreparationResult } from "./preparation/result.js";
import type { StepReporter, StepRunOptions } from "./preparation/step-runner.js";
import type { PostSlotActionResult, PostSlotInspection } from "./adapter/post-slot.js";
import type { StageSnapshot } from "./adapter/snapshot.js";
import { AvailabilityCorrelationTracker, type DomCorrelation } from "./availability-correlation.js";
import {
  AvailabilityDomWake,
  type AvailabilityWakeSignal,
} from "./availability-dom-wake.js";
import type { PreparationPageContext } from "./preparation-observation.js";
import type {
  CompletionResult,
  ReservationCompletionIntent,
} from "./completion-coordinator.js";
import {
  detectionClockData,
  postSlotEventData,
  referenceClockMetricData,
  slotClickDispatchedEventData,
  slotDetectedEventData,
  stageSnapshotData,
  targetClickMetricData,
} from "./observation/payloads.js";
import { RunObserver, type DiagnosticsPort } from "./observation/run-observer.js";

// `stageSnapshotData`는 `tests/snapshot-data.test.mjs`가 이 모듈에서 직접
// import한다. 테스트 무수정을 유지하기 위해 re-export를 남긴다.
export { stageSnapshotData };

interface CalendarPort {
  inspect(targetDate: string): CalendarInspection;
  inspectPreparation(targetDate: string): CalendarFacts;
  clickMonth(direction: "Next page" | "Previous page"): boolean;
  clickDate(date: string): boolean;
}

interface EntryPort {
  inspect(): EntryFacts;
  openReservation(): boolean;
  dismissPromo?(): boolean;
}

interface PersonPort {
  inspect(personCount: number): PersonFacts;
  select(personCount: number): boolean;
}

interface SlotPort {
  readAvailableSlots(): SlotCandidate[];
  clickSlot(candidate: SlotCandidate): boolean;
}

interface PostSlotPort {
  inspect(): PostSlotInspection;
  advance(inspection: PostSlotInspection, config: ReservationConfig): PostSlotActionResult;
}

interface AvailabilityShadowPort {
  start(expiresAtEpochMs: number, listener: (event: ReceivedAvailabilityShadowEvent) => void): void;
  markTargetCycle?(marker: AvailabilityTargetCycleMarker): void;
  stop(): void;
}

interface CompletionPort {
  run(
    config: ReservationConfig,
    intent: ReservationCompletionIntent,
    signal: AbortSignal,
    takePin: () => string | undefined,
  ): Promise<CompletionResult>;
}

interface Dependencies {
  clock: Clock;
  monotonicClock: Clock;
  /** 런마다 새 포트를 만든다(이전 런의 누적 표본이 새 런에 섞이지 않도록). */
  referenceClock(config: ReservationConfig): ReferenceClockPort;
  entry: EntryPort;
  calendar: CalendarPort;
  person: PersonPort;
  slots: SlotPort;
  postSlot: PostSlotPort;
  sleep: Sleep;
  emit(event: RunEvent): void;
  trace?(code: TraceCode, severity: TraceSeverity, message: string, options?: {
    serverAt?: number | null;
    state?: RunState | null;
    attributes?: TraceAttributes;
    error?: unknown;
  }): void;
  flushTrace?(): Promise<boolean>;
  captureSnapshot?(): StageSnapshot | null;
  capturePreparationContext?(): PreparationPageContext;
  readShopDisplayName?(): string | null;
  completion?: CompletionPort;
  /** attempt 제어 신호(Control Plane) — 준비 완료 후 실행영역 진입을 알린다. */
  attemptPhase?(phase: "EXECUTING"): void;
  diagnostics?: DiagnosticsPort;
  slotWatch?: SlotRefreshWatchPort;
  slotDomMutationWatch?: SlotDomMutationWatchPort;
  availabilityShadow?: AvailabilityShadowPort;
  runId(): string;
}

export interface RunResult {
  runId: string;
  state: RunState;
  /** terminal 전이 사유 원문 — attempt 제어(ATTEMPT_FINISHED)가 그대로 싣는다. */
  message: string;
  /** 준비 단계 handoff에서만 채워진다. */
  preparation?: { cause: PreparationCause; attempts: number };
}

// 실측(site-behavior §8.1): 클릭→XHR 발사 217~379ms + 왕복 ~60ms → 도착은
// 클릭 후 ~450ms 안. 700ms는 유실 판정 타임아웃, 250ms는 응답→렌더(56~182ms) 커버.
const QUIESCE_TIMEOUT_MS = 700;
const ARRIVAL_BURST_MS = 250;
const BODY_WAKE_SCAN_INTERVAL_MS = 10;

// 오픈 타이밍 성능 Tier1(20-design §4): 병리적 불확실성이 감시를 몇 분씩 당기지
// 않도록 하는 안전 상한. 하한은 없음 — config.preOpenLeadMs 자체가 최소 리드타임.
const MAX_ARM_LEAD_MS = 30_000;
const ENTRY_DISCOVERY_TIMEOUT_MS = 5_000;
const PERSON_DISCOVERY_TIMEOUT_MS = 3_000;
const DATE_PREPARATION_TIMEOUT_MS = 10_000;

const TERMINAL = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
]);

type ToggleCycleOutcome =
  | { kind: "terminal"; result: RunResult }
  | { kind: "retry" }
  | { kind: "slot"; candidate: SlotCandidate };

/** initial manual attempt에만 존재하는 일회성 PIN의 disposable wrapper — 사용 후 참조를 폐기한다. */
class OneShotAuthorizationHandle {
  private value: OneShotRunAuthorization | null;

  constructor(authorization?: OneShotRunAuthorization) {
    this.value = authorization ?? null;
  }

  takePin(): string | undefined {
    const pin = this.value?.catchPayPin;
    this.value = null;
    return pin;
  }

  dispose(): void {
    this.value = null;
  }
}


/**
 * 예약 흐름이 커널에 끼워 넣는 세 지점(SP-025/02).
 *
 * 커널은 흐름 객체를 알지 않는다. 오픈런 하나만을 위한 구체 계약이며,
 * 커널이 흐름에 넘기는 컨텍스트는 정의하지 않는다 — 그 모양을 지금
 * 정하면 두 번째 흐름에서 다시 뜯게 된다(00-index §03과 04를 나눈 이유).
 */
interface RunFlowHooks {
  /** CONFIGURED 전이 직전. 흐름 소유 관측·감시를 기동한다. */
  start(): void;
  /** 공용 준비가 끝난 뒤의 흐름 본문. */
  steps(): Promise<RunResult | null>;
  /** PIN 폐기 직후. 흐름이 기동한 것을 자기가 원복한다. */
  cleanup(): void;
}

/**
 * 실행 생명주기와 **안전 계약**을 소유한다 — PIN 폐기 순서, terminal 단정
 * 금지, cleanup 순서. 흐름은 이 계약을 다시 구현하지 않고 훅으로 끼운다.
 *
 * 흐름 지식이 없다. 공용 준비(진입·날짜·인원)까지가 커널 몫이고, 그 뒤는
 * `RunFlowHooks.steps()`가 결정한다.
 */
class RunKernel {
  readonly controller = new AbortController();
  readonly serverClock: MonotonicEpochClock;
  readonly observe: RunObserver;
  private readonly runId: string;
  private readonly machine: RunStateMachine;
  private offsetMs: number | null = null;
  serverClockReady = false;
  private terminalReason = "실행이 종료됐습니다.";
  private preparationFailure: { cause: PreparationCause; attempts: number } | null = null;
  referenceClockPort: ReferenceClockPort | null = null;
  private frozenReferenceClockSamples: {
    reason: "armed" | "terminal";
    samples: ReferenceClockSample[];
  } | null = null;
  latestAppliedEstimate: ReferenceClockEstimate | null = null;
  private readonly runStartMonoMs: number;
  private readonly authorizationHandle: OneShotAuthorizationHandle;

  constructor(
    private readonly deps: Dependencies,
    private readonly config: ReservationConfig,
    requestedRunId?: string,
    executionContext?: RunExecutionContext,
    authorization?: OneShotRunAuthorization,
  ) {
    this.runId = requestedRunId ?? deps.runId();
    this.machine = new RunStateMachine({ dryRun: config.dryRun, now: () => deps.clock.now() });
    this.serverClock = new MonotonicEpochClock(deps.monotonicClock);
    // frame 1(monotonic): 기준시계 오차·wall-clock 점프와 무관한 실제 경과.
    this.runStartMonoMs = deps.monotonicClock.now();
    this.authorizationHandle = new OneShotAuthorizationHandle(authorization);
    this.observe = new RunObserver(
      {
        now: () => deps.clock.now(),
        serverAt: () => (this.serverClockReady ? this.serverClock.now() : null),
        state: () => this.machine.state,
        monoNow: () => deps.monotonicClock.now(),
      },
      deps,
      this.runId,
      executionContext,
    );
  }

  /** 일회성 PIN은 커널이 소유한다. 흐름에 핸들 자체를 넘기지 않으므로 흐름은 폐기할 수 없다. */
  takePin(): string | undefined {
    return this.authorizationHandle.takePin();
  }

  monoFromRunStartMs(): number {
    return this.deps.monotonicClock.now() - this.runStartMonoMs;
  }

  mutationSnapshot(): { generation: number; lastMutationMonoMs: number | null } {
    try {
      return this.deps.slotDomMutationWatch?.snapshot()
        ?? { generation: 0, lastMutationMonoMs: null };
    } catch {
      return { generation: 0, lastMutationMonoMs: null };
    }
  }

  transition(
    state: RunState,
    reason: string,
    extra: { error?: string; userStopped?: boolean; data?: RunEvent["data"] } = {},
  ): void {
    this.machine.transition(state, reason, { error: extra.error, userStopped: extra.userStopped });
    if (TERMINAL.has(state)) this.terminalReason = reason;
    // 관측 실패는 실행을 막지 않지만(SP-026) 그 사실은 드러나야 한다.
    // terminal 전이에만 싣는다 — 실패 0이면 attribute를 넣지 않아 기존
    // payload가 그대로다. `finally` 단계(clockSamples)의 실패는 이 시점
    // 이후라 집계되지 않는다(20-design §한계 1).
    const observationFailures = TERMINAL.has(state) ? this.observe.observationFailures() : 0;
    this.observe.event("state", reason, {
      state,
      ...(observationFailures > 0 ? { observationFailureCount: observationFailures } : {}),
      ...extra.data,
    });
    this.observe.stateChanged(state, reason, extra.data);
  }

  finish(): RunResult {
    return {
      runId: this.runId,
      state: this.machine.state,
      message: this.terminalReason,
      ...(this.preparationFailure === null ? {} : { preparation: this.preparationFailure }),
    };
  }

  finishStopped(): RunResult {
    this.transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
    return this.finish();
  }

  diagnosticHandOff(reason: string, extra?: RunEvent["data"]): RunResult {
    const data = this.observe.failureData(reason, extra);
    this.transition("HANDED_OFF", reason, { data });
    return this.finish();
  }

  handOff(reason: string, extra?: RunEvent["data"]): RunResult {
    this.transition("HANDED_OFF", reason, extra ? { data: extra } : {});
    return this.finish();
  }

  timedOut(reason: string): RunResult {
    const data = this.observe.failureData(reason);
    this.transition("TIMED_OUT", reason, { data });
    return this.finish();
  }

  stopOrTimeout(result: "ready" | "timed_out" | "stopped"): RunResult | null {
    if (result === "timed_out") {
      return this.timedOut("감시 종료 시각에 도달했습니다.");
    }
    if (result === "stopped") {
      return this.finishStopped();
    }
    return null;
  }

  /**
   * 생명주기 봉투. 이 메서드가 안전 계약의 소재지다.
   *
   * - `catch`의 `TERMINAL` 가드: 이미 종료된 실행을 FAILED로 덮어쓰지 않는다.
   * - `finally`의 순서: PIN 폐기가 **가장 먼저**, 흐름 cleanup이 그 다음,
   *   비동기 flush가 마지막이다.
   *
   * 흐름은 이 순서를 다시 쓰지 않는다 — 훅 세 개만 제공한다.
   */
  async execute(flow: RunFlowHooks): Promise<RunResult> {
    try {
      flow.start();
      this.transition("CONFIGURED", "예약 설정을 불러왔습니다.");
      return this.validate()
        ?? await this.syncInitialClock()
        ?? await this.prepareEntry()
        ?? await this.prepareDate()
        ?? await this.preparePerson()
        ?? await flow.steps()
        ?? this.finishStopped();
    } catch (error) {
      if (!TERMINAL.has(this.machine.state)) {
        const message = error instanceof Error ? error.message : "알 수 없는 실행 오류";
        const failure = this.observe.failureData(message, undefined, error);
        this.observe.runFailed(message, failure as TraceAttributes, error);
        this.transition("FAILED", message, { error: message, data: failure });
      }
      return this.finish();
    } finally {
      // PIN 참조는 나머지 cleanup(비동기 flush 포함)보다 먼저, 그 안의 예외와 무관하게
      // 즉시 폐기한다 — dispose() 자체는 절대 던지지 않으므로 이 위치가 가장 이르고 안전하다.
      this.authorizationHandle.dispose();
      try {
        flow.cleanup();
      } catch (error) {
        // 훅 경계의 계약(#27): 흐름 원복 실패가 커널의 정리·flush·RunResult를
        // 무너뜨리지 않는다. 삼키되 **숨기지는 않는다** — 이 자리에 도달했다는
        // 것은 흐름이 자원을 원복하지 못했다는 뜻이라 근거가 남아야 한다.
        // 현재 흐름은 내부를 각자 감싸 도달하지 않으나 두 번째 흐름은 그
        // 보장이 없다. 커버리지 0을 근거로 지우면 #27이 재발한다.
        this.observe.event("error", "흐름 정리에 실패했습니다.", {
          error: error instanceof Error ? error.message : "알 수 없는 정리 오류",
        });
      }
      this.stopReferenceClock("terminal"); // waitForOpen 도달 전 조기 종료 시 안전망
      this.traceFrozenReferenceClockSamples();
      await Promise.allSettled([
        this.deps.diagnostics?.forceFlush() ?? Promise.resolve(),
        this.deps.flushTrace?.() ?? Promise.resolve(),
      ]);
    }
  }

  private validate(): RunResult | null {
    this.transition("VALIDATING", "예약 설정과 실행 조건을 검증합니다.");
    const errors = validateReservationConfig(this.config, this.deps.clock.now());
    if (errors.length > 0) {
      this.transition("FAILED", errors.join(" "), { error: errors.join(" | ") });
      return this.finish();
    }
    return null;
  }

  private async syncInitialClock(): Promise<RunResult | null> {
    this.transition("SYNCING_CLOCK", "캐치테이블 서버 시계를 측정합니다.");
    const port = this.deps.referenceClock(this.config);
    this.referenceClockPort = port;
    const sample = await port.sampleOnce(this.controller.signal);
    if (this.controller.signal.aborted) return this.finishStopped();
    const estimate = sample ? port.ingest(sample) : port.latest ?? estimateReferenceClock([]);
    this.applyReferenceClockEstimate(estimate);
    this.observe.event("metric",
      estimate.source === "FALLBACK" ? "서버 시계 측정 실패로 로컬 시계를 사용합니다." : "서버 시계 보정을 완료했습니다.",
      referenceClockMetricData(estimate, "bootstrap", this.wallOffsetMs()));
    // 대기 시간(prepareEntry~waitForOpen)을 관통해 계속 관측한다 — 부트스트랩은
    // 단일 표본이라 거친 앵커일 뿐이고, armLead 결정 시점까지 confidence가
    // 자연히 개선된다(20-design §3). waitForOpen()이 stop()으로 종료시킨다.
    void port.start((next) => this.applyReferenceClockEstimate(next));
    return null;
  }

  stopReferenceClock(reason: "armed" | "terminal"): void {
    const port = this.referenceClockPort;
    if (!port) return;
    this.referenceClockPort = null;
    try {
      port.stop();
    } catch {
      // 기준시계 진단 정리는 예약 결과를 바꾸지 않는다.
    }
    try {
      this.frozenReferenceClockSamples ??= { reason, samples: port.drainSamples() };
    } catch {
      // 원시 표본 진단 실패는 기존 시계 추정·예약 경로와 격리한다.
    }
  }

  private traceFrozenReferenceClockSamples(): void {
    const frozen = this.frozenReferenceClockSamples;
    this.frozenReferenceClockSamples = null;
    if (!frozen) return;
    this.observe.clockSamples(frozen);
  }

  private applyReferenceClockEstimate(estimate: ReferenceClockEstimate): void {
    // FALLBACK(표본 전무)은 offsetCenterMs=0이라 monotonic+0으로 앵커하면
    // serverClock이 monotonic(작은 값)으로 고정돼 이후 모든 서버시각 계산이
    // 깨진다. 이 경우 "serverClock ≈ 로컬 wall"이 되도록 wall−monotonic을 쓴다.
    const offset = estimate.source === "FALLBACK"
      ? this.deps.clock.now() - this.deps.monotonicClock.now()
      : estimate.offsetCenterMs;
    this.offsetMs = offset;
    // ⚠️ t0/t1이 monotonic epoch이므로 재앵커도 monotonicClock 기준이어야 한다
    // (wall clock인 deps.clock을 쓰면 서로 다른 시간 공간을 더하는 버그가 된다).
    this.serverClock.anchor(this.deps.monotonicClock.now() + offset);
    this.serverClockReady = true;
    this.latestAppliedEstimate = estimate;
  }

  /** 사이드패널 카운트다운·배지가 읽는 wall-clock 델타(server − Date.now()).
   * offsetCenterMs(= server − monotonic, epoch 스케일)를 그대로 노출하면
   * `Date.now() + offset`이 폭주한다(E2E에서 "+20647일"로 관측). */
  wallOffsetMs(): number {
    return this.serverClock.now() - this.deps.clock.now();
  }

  private stepReporter(): StepReporter {
    return {
      stageStart: () => this.observe.preparation("stage_start", { preparationStage: this.machine.state }),
      conditionChanged: (attributes) => this.observe.preparation("condition_changed", attributes),
      dispatchBefore: (action, attempt) => this.observe.preparation("dispatch_before", {
        preparationAction: action,
        preparationAttempt: attempt,
        preparationRecoveryDecision: attempt === 1 ? "initial" : "retry",
      }),
      dispatchAfter: (action, attempt, dispatched) => this.observe.preparation("dispatch_after", {
        preparationAction: action,
        preparationAttempt: attempt,
        preparationDispatched: dispatched,
        preparationRecoveryDecision: attempt === 1 ? "confirm" : "final_confirm",
      }),
      obstacleDismissed: () => this.observe.preparation("dispatch_after", {
        preparationAction: "dismiss_promo",
        preparationDispatched: true,
        preparationRecoveryDecision: "retry",
      }),
      decision: (decision, cause, attempts) => this.observe.preparation("decision", {
        preparationDecision: decision,
        ...(cause === null ? {} : { preparationErrorCode: cause }),
        preparationAttempt: attempts,
      }, decision === "handoff" ? "warn" : "trace"),
      action: (message) => this.observe.event("action", message),
    };
  }

  private resolvePreparation(result: PreparationResult): RunResult | null {
    if (result.kind === "ready") return null;
    if (result.kind === "stopped") return this.finishStopped();
    if (result.kind === "timed_out") return this.timedOut(result.message);
    this.preparationFailure = { cause: result.cause, attempts: result.attempts };
    return this.diagnosticHandOff(result.message, {
      preparationErrorCode: result.cause,
      preparationAttemptCount: result.attempts,
      preparationRecoveryDecision: "handoff",
    });
  }

  private stepOptions(discoveryTimeoutMs: number, overallDeadlineAtMs: number): StepRunOptions {
    return {
      clock: this.serverClock,
      sleep: this.deps.sleep,
      signal: this.controller.signal,
      stopAtMs: this.config.stopAtMs,
      discoveryDeadlineAtMs: Math.min(this.serverClock.now() + discoveryTimeoutMs, this.config.stopAtMs),
      overallDeadlineAtMs,
      report: this.stepReporter(),
    };
  }

  private async prepareEntry(): Promise<RunResult | null> {
    if (this.config.entryMode !== "auto") return null;
    this.transition("ENTERING_RESERVATION", "예약창 진입 상태를 확인합니다.");
    const result = await runEntryPreparation(this.deps.entry,
      this.stepOptions(ENTRY_DISCOVERY_TIMEOUT_MS, this.config.stopAtMs));
    return this.resolvePreparation(result);
  }

  private async prepareDate(): Promise<RunResult | null> {
    if (this.config.entryMode !== "auto") return null;
    this.transition("SELECTING_DATE", "목표 월과 예약 날짜를 준비합니다.");
    const deadline = Math.min(this.serverClock.now() + DATE_PREPARATION_TIMEOUT_MS, this.config.stopAtMs);
    const result = await runCalendarPreparation(this.deps.calendar, this.config.reservationDate,
      this.stepOptions(DATE_PREPARATION_TIMEOUT_MS, deadline));
    return this.resolvePreparation(result);
  }

  private async preparePerson(): Promise<RunResult | null> {
    if (this.config.entryMode !== "auto") return null;
    this.transition("SELECTING_PERSON", "예약 인원을 준비합니다.");
    const result = await runPersonPreparation(this.deps.person, this.config.personCount,
      this.stepOptions(PERSON_DISCOVERY_TIMEOUT_MS, this.config.stopAtMs));
    return this.resolvePreparation(result);
  }

  markExecuting(): RunResult | null {
    try {
      this.deps.attemptPhase?.("EXECUTING");
    } catch {
      // attempt 제어 신호는 예약 결과를 바꾸지 않는다.
    }
    return null;
  }
}


/**
 * 오픈런 흐름. 안전 계약은 `RunKernel`이 소유하고, 여기에는 오픈런 고유의
 * 판정과 핫패스만 남는다.
 *
 * 03에서 핫패스와 흐름 상태를 여기서 다시 떼어낸다.
 */
class RunSession implements RunFlowHooks {
  private readonly kernel: RunKernel;
  readonly controller: AbortController;
  private readonly serverClock: MonotonicEpochClock;
  private readonly observe: RunObserver;
  private adjacentTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
  private targetTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
  private toggleCycle = 0;
  private adjacentDate: string | null = null;
  private watchLive = false;
  private lastArrivalAt: number | null = null;
  private readonly availabilityCorrelation = new AvailabilityCorrelationTracker();
  private readonly availabilityWake = new AvailabilityDomWake();

  constructor(
    private readonly deps: Dependencies,
    private readonly config: ReservationConfig,
    requestedRunId?: string,
    executionContext?: RunExecutionContext,
    authorization?: OneShotRunAuthorization,
  ) {
    this.kernel = new RunKernel(deps, config, requestedRunId, executionContext, authorization);
    // 커널이 소유한 객체의 별칭이다. 흐름 본문이 같은 인스턴스를 본다.
    this.controller = this.kernel.controller;
    this.serverClock = this.kernel.serverClock;
    this.observe = this.kernel.observe;
  }

  execute(): Promise<RunResult> {
    return this.kernel.execute(this);
  }

  /** 훅 1 — 오픈런이 쓰는 관측·감시를 기동한다. 현재 execute() 진입부와 같은 순서다. */
  start(): void {
    try {
      this.deps.availabilityShadow?.start(this.config.stopAtMs + 30_000, (event) => {
        this.onAvailabilityBody(event);
      });
    } catch {
      // Shadow 관측은 제어 경로와 격리한다.
    }
    this.deps.slotWatch?.start(() => {
      this.watchLive = true;
      if (this.kernel.serverClockReady) this.lastArrivalAt = this.serverClock.now();
    });
  }

  /** 훅 2 — 공용 준비 뒤의 오픈런 본문. */
  async steps(): Promise<RunResult | null> {
    return this.confirmPageReady()
      ?? this.kernel.markExecuting()
      ?? await this.waitForOpen()
      ?? await this.searchAndReserve();
  }

  /**
   * 훅 3 — start()가 켠 것을 원복한다. 순서는 이전 finally 블록과 같다.
   *
   * 던질 수 있는 포트 호출 셋은 각자 감싼다(#27) — 하나가 실패해도 나머지
   * 원복이 이어져야 observer·watch가 남지 않는다. 감싸지 않은
   * `availabilityWake.reset()`은 내부 필드 초기화라 던지지 않는다.
   *
   * 여기서 새 포트 호출을 추가한다면 **반드시 감싼다.** 감싸지 않으면 그
   * 뒤의 원복이 통째로 건너뛰어진다. 커널의 훅 경계 guard는 실행 결과와
   * flush를 지킬 뿐, 이 메서드 내부의 남은 단계를 되살리지는 못한다.
   */
  cleanup(): void {
    try {
      this.deps.availabilityShadow?.stop();
    } catch {
      // Shadow 원복 실패도 terminal 결과를 바꾸지 않는다.
    }
    this.availabilityWake.reset();
    try {
      this.deps.slotWatch?.stop();
    } catch {
      // 감시 원복 실패가 뒤따르는 mutation watch 원복을 막지 않는다(#27).
      // 커널 경계의 가드만으로는 흐름 cleanup 내부가 중간에 끊기는 것을
      // 막지 못해 mutation observer가 남는다.
    }
    try {
      this.deps.slotDomMutationWatch?.stop();
    } catch {
      // Mutation telemetry cleanup cannot change the terminal result.
    }
  }

  /**
   * shadow body 수신 콜백. **이름과 달리 제어다** — `availabilityWake.offer()`의
   * 반환이 핫패스의 wake 신호를 결정한다. 관측은 뒤에 붙는다.
   *
   * `try/catch`의 목적은 **제어 보호**다 — bridge payload는 비신뢰 입력이라
   * 상관관계 계산이 던질 수 있다.
   *
   * 관측은 여기 기대지 않는다. `RunObserver`가 자체 격리하므로(SP-026)
   * body trace가 실패해도 **뒤따르는 late DOM 비교는 계속 실행된다.** 두
   * 관측은 독립이며, 하나가 실패했다고 다른 하나를 버리지 않는다.
   */
  private onAvailabilityBody(event: ReceivedAvailabilityShadowEvent): void {
    try {
      const candidates = event.availableMinutes.map((minutes) => ({
        key: `shadow:${minutes}`,
        minutes,
        label: String(minutes),
      }));
      const selected = selectPreferredSlot(candidates, this.config.timeRange, this.config.priorityTimes);
      const correlation = this.availabilityCorrelation.correlateBody(event, selected?.minutes ?? null);
      const acceptedCorrelation = correlation.quality === "EXACT" || correlation.quality === "STRONG";
      const wakeAtMonoMs = this.deps.monotonicClock.now();
      const wakeDecision = this.availabilityWake.offer({
        cycle: correlation.cycle,
        requestSequence: event.sequence,
        quality: correlation.quality,
        stale: correlation.stale,
        classification: event.classification,
        allowEmptyExit: resolveAvailabilityProbeMode(this.config) === "empty_exit",
        selectedMinutes: selected?.minutes ?? null,
        responseCompletedMonoMs: event.responseCompletedMonoMs,
        payloadClassifiedMonoMs: event.payloadClassifiedMonoMs,
        bridgeReceivedMonoMs: event.bridgeReceivedMonoMs,
        wakeAtMonoMs,
      });
      this.observe.availabilityBody(
        event, correlation, wakeDecision, selected?.minutes ?? null, acceptedCorrelation, wakeAtMonoMs);
      if (correlation.lateDomCorrelation) {
        this.observe.availabilityDom(correlation.lateDomCorrelation, "dom_compare_late");
      }
    } catch {
      // 비신뢰 bridge payload의 후처리는 예약 흐름으로 예외를 전파하지 않는다.
    }
  }

  /**
   * DOM 후보를 body 응답과 대조한다. 상관관계 계산은 제어 자료 구조를
   * 갱신하고, 그 결과를 관측이 기록한다.
   *
   * `try/catch`는 제어 보호가 목적이다 — 대조 실패가 이미 확정된 DOM 후보
   * 반환을 막아서는 안 된다. 관측 실패도 함께 삼켜진다.
   */
  private correlateDomCandidate(candidate: SlotCandidate, cycle: number): void {
    try {
      const observedMonoMs = this.deps.monotonicClock.now();
      const mutation = this.kernel.mutationSnapshot();
      const correlation = this.availabilityCorrelation.correlateDom(
        cycle,
        candidate.minutes,
        observedMonoMs,
        mutation,
      );
      this.observe.availabilityDom(correlation, "dom_compare");
    } catch {
      // Shadow 비교는 기존 DOM 후보 반환을 막지 않는다.
    }
  }

  private confirmPageReady(): RunResult | null {
    this.kernel.transition("PREPARING_PAGE", "예약 모달과 목표 날짜를 확인합니다.");
    const setup = this.deps.calendar.inspect(this.config.reservationDate);
    if (!setup.targetAvailable || !setup.targetSelected || setup.adjacentDate === null) {
      return this.kernel.diagnosticHandOff("목표 날짜 선택 또는 인접 가용 날짜를 확인할 수 없습니다. 페이지를 준비한 뒤 새로 시작하세요.");
    }
    this.adjacentDate = setup.adjacentDate;
    return null;
  }

  private async waitForOpen(): Promise<RunResult | null> {
    const config = this.config;
    const controller = this.controller;
    const serverClock = this.serverClock;
    this.kernel.transition("WAITING_FOR_OPEN", "예약 오픈 직전까지 대기합니다.");
    const estimate = this.kernel.referenceClockPort?.latest ?? this.kernel.latestAppliedEstimate ?? estimateReferenceClock([]);
    const armLeadMs = computeArmLeadMs(config.preOpenLeadMs, estimate);
    this.observe.event("metric", "예약 오픈 직전 진입 시점을 결정했습니다.",
      referenceClockMetricData(estimate, "armed", this.kernel.wallOffsetMs(), armLeadMs));
    const waitResult = await waitUntil(config.openAtMs - armLeadMs, {
      clock: serverClock,
      stopAtMs: config.stopAtMs,
      signal: controller.signal,
      sleep: this.deps.sleep,
    });
    // 정밀 토글 그리드 진입 전 앵커를 동결한다 — 계속 갱신되게 두면 클릭 그리드
    // 계산 도중 앵커가 흔들릴 수 있다(20-design §3).
    this.kernel.stopReferenceClock(waitResult === "ready" ? "armed" : "terminal");
    const waitingExit = this.kernel.stopOrTimeout(waitResult);
    if (waitingExit) return waitingExit;
    return null;
  }

  private async searchAndReserve(): Promise<RunResult | null> {
    const config = this.config;
    const serverClock = this.serverClock;
    try {
      this.deps.slotDomMutationWatch?.start();
    } catch {
      // Mutation telemetry is independent of reservation control.
    }
    this.kernel.transition("REFRESHING_SLOTS", "날짜 토글로 예약 슬롯을 갱신합니다.");
    while (!this.controller.signal.aborted) {
      if (serverClock.now() >= config.stopAtMs) {
        return this.kernel.timedOut("감시 종료 시각에 도달했습니다.");
      }
      const cycle = await this.runToggleCycle();
      if (cycle.kind === "terminal") return cycle.result;
      if (cycle.kind === "retry") continue;
      const advanced = await this.advanceFromSlot(cycle.candidate);
      if (advanced) return advanced;
    }
    return this.kernel.finishStopped();
  }

  private async runToggleCycle(): Promise<ToggleCycleOutcome> {
    const config = this.config;
    const controller = this.controller;
    const serverClock = this.serverClock;
    const plan = nextTogglePlan(serverClock.now(), config.openAtMs, config.toggleIntervalMs);
    const cycle = ++this.toggleCycle;
    let adjacentClickedAt: number | null = null;
    let targetClickedAt: number | null = null;
    let targetSelectedAt: number | null = null;
    let slotScanCount = 0;
    let availableSlotCount = 0;
    let matchedSlotCount = 0;
    let wakeSignal: AvailabilityWakeSignal | null = null;
    let wakeCandidateObservedMonoMs: number | null = null;
    let wakeScanCount = 0;
    let wakeFallbackUsed = true;
    // RT-11 counterfactual: wake가 없었다면 다음 scan이 언제 실행됐을지.
    // (90-redteam-review F2) baseline − wakeScanAt = wakeAdvanceMs.
    let wakeBaselineNextScanAtMonoMs: number | null = null;
    let wakeScanAtMonoMs: number | null = null;
    let adjacentDateValue: string | null = this.adjacentDate;
    const traceCycle = (result: string) => this.observe.toggleCycle(
      serverClock.now(),
      {
        cycle,
          phase: plan.phase,
          adjacentDate: adjacentDateValue,
          adjacentPlannedAt: plan.adjacentClickAtMs,
          adjacentClickedAt,
          targetPlannedAt: plan.targetClickAtMs,
          targetClickedAt,
          targetSelectedAt,
          slotScanCount,
          availableSlotCount,
          matchedSlotCount,
          result,
          watch: this.watchLive ? "live" : "idle",
          arrivalAt: this.lastArrivalAt,
          wakeUsed: wakeSignal !== null,
          wakeRequestSequence: wakeSignal?.requestSequence ?? null,
          wakeCorrelationQuality: wakeSignal?.quality ?? null,
        wakeFallbackUsed,
      },
    );
    const adjacentWait = await waitUntil(plan.adjacentClickAtMs, {
      clock: serverClock,
      stopAtMs: config.stopAtMs,
      signal: controller.signal,
      sleep: this.deps.sleep,
      tickMs: 10,
    });
    if (adjacentWait !== "ready") traceCycle(adjacentWait === "stopped" ? "STOPPED_BEFORE_ADJACENT" : "TIMED_OUT_BEFORE_ADJACENT");
    const adjacentWaitExit = this.kernel.stopOrTimeout(adjacentWait);
    if (adjacentWaitExit) return { kind: "terminal", result: adjacentWaitExit };

    const currentSetup = this.deps.calendar.inspect(config.reservationDate);
    const adjacentDate = currentSetup.adjacentDate;
    adjacentDateValue = adjacentDate;
    if (!currentSetup.targetAvailable || adjacentDate === null) {
      traceCycle("SETUP_INVALID");
      return { kind: "terminal", result: this.kernel.diagnosticHandOff("달력 상태가 바뀌어 안전하게 슬롯을 갱신할 수 없습니다.") };
    }
    if (!this.deps.calendar.clickDate(adjacentDate)) {
      traceCycle("ADJACENT_CLICK_FAILED");
      return { kind: "terminal", result: this.kernel.diagnosticHandOff("인접 날짜를 선택할 수 없습니다.") };
    }
    adjacentClickedAt = serverClock.now();
    this.adjacentTiming = {
      actualAt: adjacentClickedAt,
      scheduledAt: plan.adjacentClickAtMs,
      phase: plan.phase,
    };
    const targetWait = await waitUntil(plan.targetClickAtMs, {
      clock: serverClock,
      stopAtMs: config.stopAtMs,
      signal: controller.signal,
      sleep: this.deps.sleep,
      tickMs: 5,
    });
    if (targetWait !== "ready") traceCycle(targetWait === "stopped" ? "STOPPED_BEFORE_TARGET" : "TIMED_OUT_BEFORE_TARGET");
    const targetWaitExit = this.kernel.stopOrTimeout(targetWait);
    if (targetWaitExit) return { kind: "terminal", result: targetWaitExit };
    const targetClickMonoMs = this.deps.monotonicClock.now();
    const mutationAtTargetClick = this.kernel.mutationSnapshot();
    this.availabilityCorrelation.registerCycle({
      cycle,
      targetDate: config.reservationDate,
      personCount: config.personCount,
      targetClickMonoMs,
      mutationGenerationAtTargetClick: mutationAtTargetClick.generation,
    });
    this.availabilityWake.beginCycle(cycle);
    try {
      this.deps.availabilityShadow?.markTargetCycle?.({
        cycle,
        targetDate: config.reservationDate,
        personCount: config.personCount,
        targetClickMonoMs,
      });
    } catch {
      // Correlation marker failure must not delay or block the target click.
    }
    if (!this.deps.calendar.clickDate(config.reservationDate)) {
      traceCycle("TARGET_CLICK_FAILED");
      return { kind: "terminal", result: this.kernel.diagnosticHandOff("목표 날짜를 다시 선택할 수 없습니다.") };
    }
    targetClickedAt = serverClock.now();
    this.targetTiming = {
      actualAt: targetClickedAt,
      scheduledAt: plan.targetClickAtMs,
      phase: plan.phase,
    };
    if (plan.targetClickAtMs === config.openAtMs) {
      this.observe.event("metric", "예약 오픈 정각에 목표 날짜를 클릭했습니다.", targetClickMetricData(targetClickedAt, plan, config.openAtMs));
    }

    if (!(await this.deps.sleep(20, controller.signal))) {
      traceCycle("STOPPED_AFTER_TARGET");
      return { kind: "terminal", result: this.kernel.finishStopped() };
    }
    if (serverClock.now() >= config.stopAtMs) {
      traceCycle("TIMED_OUT_AFTER_TARGET");
      return { kind: "terminal", result: this.kernel.timedOut("감시 종료 시각에 도달했습니다.") };
    }
    const selectionDeadline = Math.min(plan.targetClickAtMs + 60, config.stopAtMs);
    let targetSelected = this.deps.calendar.inspect(config.reservationDate).targetSelected;
    while (!targetSelected && serverClock.now() < selectionDeadline) {
      if (!(await this.deps.sleep(Math.min(10, selectionDeadline - serverClock.now()), controller.signal))) {
        traceCycle("STOPPED_DURING_SELECTION");
        return { kind: "terminal", result: this.kernel.finishStopped() };
      }
      targetSelected = this.deps.calendar.inspect(config.reservationDate).targetSelected;
    }
    if (serverClock.now() >= config.stopAtMs) {
      traceCycle("TIMED_OUT_DURING_SELECTION");
      return { kind: "terminal", result: this.kernel.timedOut("감시 종료 시각에 도달했습니다.") };
    }
    if (!targetSelected) {
      traceCycle("SELECTION_UNCONFIRMED");
      return { kind: "terminal", result: this.kernel.diagnosticHandOff("목표 날짜 선택 상태를 확인할 수 없습니다.") };
    }
    targetSelectedAt = serverClock.now();

    const nextPlan = nextTogglePlan(serverClock.now(), config.openAtMs, config.toggleIntervalMs);
    const gridDetectUntil = Math.min(
      nextPlan.adjacentClickAtMs,
      config.stopAtMs,
    );
    // watch가 살아 있으면: 도착 전엔 클릭+700ms까지 콰이어스(후속 토글이 비행 중
    // 응답의 렌더를 밟는 것을 방지 — worklog 12 실오픈 +1303ms의 원인), 도착
    // 후엔 도착+250ms까지 렌더 스캔 버스트. 신호가 없던 실행은 현행 그리드 그대로.
    const quiesceUntil = Math.min(targetClickedAt + QUIESCE_TIMEOUT_MS, config.stopAtMs);
    const detectDeadline = () => {
      if (!this.watchLive) return gridDetectUntil;
      const arrival = this.lastArrivalAt;
      if (arrival !== null && arrival >= targetClickedAt) {
        return Math.min(arrival + ARRIVAL_BURST_MS, config.stopAtMs);
      }
      return quiesceUntil;
    };
    const remainingDetectionMs = () => {
      const serverRemaining = detectDeadline() - serverClock.now();
      const bodyRemaining = wakeSignal === null
        ? 0
        : wakeSignal.bridgeReceivedMonoMs + ARRIVAL_BURST_MS - this.deps.monotonicClock.now();
      return Math.min(
        config.stopAtMs - serverClock.now(),
        Math.max(serverRemaining, bodyRemaining),
      );
    };
    let candidate: SlotCandidate | null = null;
    const inspectSlots = () => {
      const observedMonoMs = this.deps.monotonicClock.now();
      const slots = this.deps.slots.readAvailableSlots();
      slotScanCount += 1;
      if (wakeSignal !== null) wakeScanCount += 1;
      availableSlotCount = slots.length;
      matchedSlotCount = slots.filter((slot) => (
        slot.minutes >= config.timeRange.startMinutes && slot.minutes <= config.timeRange.endMinutes
      )).length;
      const selected = selectPreferredSlot(slots, config.timeRange, config.priorityTimes);
      if (selected && wakeSignal !== null) wakeCandidateObservedMonoMs = observedMonoMs;
      return selected;
    };
    const applyPendingEmptyExit = (): { applied: boolean; candidate: SlotCandidate | null } => {
      if (wakeSignal?.kind !== "empty_exit") return { applied: false, candidate: null };
      const emptySignal = wakeSignal;
      const targetStillSelected = this.deps.calendar.inspect(config.reservationDate).targetSelected;
      if (!targetStillSelected) {
        this.observe.emptyExit(emptySignal, false, false);
        wakeSignal = null;
        return { applied: false, candidate: null };
      }
      const finalCandidate = inspectSlots();
      this.observe.emptyExit(emptySignal, true, finalCandidate !== null);
      wakeSignal = null;
      if (finalCandidate === null) {
        wakeFallbackUsed = false;
        return { applied: true, candidate: null };
      }
      return { applied: false, candidate: finalCandidate };
    };
    wakeSignal = this.availabilityWake.consume(cycle);
    if (wakeSignal !== null) {
      // 첫 scan 전에 이미 도착한 wake는 scan 시점을 앞당기지 않는다(전진분 0).
      wakeScanAtMonoMs = this.deps.monotonicClock.now();
      wakeBaselineNextScanAtMonoMs = wakeScanAtMonoMs;
    }
    // 관측 계약(SP-025/01): 이 루프의 **매 반복 경로**에는 관측 호출을 넣지
    // 않는다. 25ms·10ms 간격으로 도는 슬롯 감지 구간이다. 종료가 확정된
    // 직후의 1회 관측(applyPendingEmptyExit 내부, EMPTY_EARLY_EXIT)은
    // 허용된다 — 실행 즉시 break 하거나 return 하므로 반복 비용에 누적되지
    // 않는다.
    while (!controller.signal.aborted && remainingDetectionMs() > 0) {
      candidate = inspectSlots();
      if (candidate) break;
      const emptyExit = applyPendingEmptyExit();
      if (emptyExit.candidate) {
        candidate = emptyExit.candidate;
        break;
      }
      if (emptyExit.applied) {
        traceCycle("EMPTY_EARLY_EXIT");
        this.availabilityWake.endCycle(cycle);
        return { kind: "retry" };
      }
      const inBodyBurst = wakeSignal?.kind === "scan_wake"
        && this.deps.monotonicClock.now() < wakeSignal.bridgeReceivedMonoMs + ARRIVAL_BURST_MS;
      const delay = Math.min(
        inBodyBurst ? BODY_WAKE_SCAN_INTERVAL_MS : 25,
        remainingDetectionMs(),
      );
      if (delay <= 0) break;
      try {
        const waitStartMonoMs = this.deps.monotonicClock.now();
        const waited = await this.availabilityWake.wait(cycle, delay, this.deps.sleep, controller.signal);
        if (waited.kind === "stopped") break;
        if (waited.kind === "wake") {
          wakeSignal = waited.signal;
          wakeScanAtMonoMs = this.deps.monotonicClock.now();
          wakeBaselineNextScanAtMonoMs = waitStartMonoMs + delay;
        }
      } catch {
        if (!(await this.deps.sleep(delay, controller.signal))) break;
      }
    }
    if (candidate === null) {
      candidate = inspectSlots();
      if (candidate === null) {
        const emptyExit = applyPendingEmptyExit();
        candidate = emptyExit.candidate;
        if (emptyExit.applied) {
          traceCycle("EMPTY_EARLY_EXIT");
          this.availabilityWake.endCycle(cycle);
          return { kind: "retry" };
        }
      }
    }
    if (wakeSignal?.kind === "scan_wake") {
      wakeFallbackUsed = candidate === null
        || wakeCandidateObservedMonoMs === null
        || wakeCandidateObservedMonoMs > wakeSignal.bridgeReceivedMonoMs + ARRIVAL_BURST_MS;
      this.observe.wakeResult(
        wakeSignal,
        wakeCandidateObservedMonoMs,
        candidate !== null,
        wakeFallbackUsed,
        wakeScanCount,
        wakeBaselineNextScanAtMonoMs,
        wakeScanAtMonoMs,
      );
    }
    if (!candidate) {
      traceCycle("NO_SLOT");
      this.availabilityWake.endCycle(cycle);
      return { kind: "retry" };
    }
    this.correlateDomCandidate(candidate, cycle);
    traceCycle("SLOT_FOUND");
    this.availabilityWake.endCycle(cycle);
    return { kind: "slot", candidate };
  }

  private async advanceFromSlot(candidate: SlotCandidate): Promise<RunResult | null> {
    const config = this.config;
    const serverClock = this.serverClock;
    const slotDetectedAt = serverClock.now();
    const clockData = detectionClockData(this.kernel.latestAppliedEstimate, this.kernel.wallOffsetMs());
    const shopDisplayName = config.reservationCompletionEnabled
      ? this.deps.readShopDisplayName?.() ?? null
      : null;
    this.kernel.transition("SLOT_DETECTED", `${candidate.label} 슬롯을 감지했습니다.`, {
      data: slotDetectedEventData(
        slotDetectedAt, this.adjacentTiming, this.targetTiming, config.openAtMs,
        this.lastArrivalAt, this.kernel.monoFromRunStartMs(), clockData,
      ),
    });
    this.observe.event("detect", "예약 조건과 일치하는 슬롯을 찾았습니다.", { slotMinutes: candidate.minutes, slotLabel: candidate.label });
    if (config.dryRun) {
      this.kernel.transition("DRY_RUN_COMPLETED", "dry-run이므로 슬롯을 클릭하지 않았습니다.");
      return this.kernel.finish();
    }
    if (serverClock.now() >= config.stopAtMs) {
      return this.kernel.timedOut("클릭 직전 감시 종료 시각에 도달했습니다.");
    }
    if (!this.deps.slots.clickSlot(candidate)) {
      this.observe.slotClicked("warn", `${candidate.label} 슬롯 클릭에 실패했습니다.`,
        serverClock.now(), "SLOT_DETECTED", {
          slotMinutes: candidate.minutes,
          slotLabel: candidate.label,
          clickOk: false,
          slotTransitionOutcome: "contention_before_dispatch",
        });
      this.kernel.transition("REFRESHING_SLOTS", "슬롯이 dispatch 전에 사라져 날짜 토글을 재개합니다.", {
        data: {
          slotMinutes: candidate.minutes,
          slotLabel: candidate.label,
          slotTransitionOutcome: "contention_before_dispatch",
        },
      });
      return null;
    }
    const slotClickDispatchedAt = serverClock.now();
    this.observe.slotClicked("info", `${candidate.label} 슬롯을 클릭했습니다.`,
      slotClickDispatchedAt, "SLOT_CLICK_DISPATCHED", {
        slotMinutes: candidate.minutes,
        slotLabel: candidate.label,
        clickOk: true,
        slotTransitionOutcome: "dispatched",
      });
    this.kernel.transition("SLOT_CLICK_DISPATCHED", `${candidate.label} 슬롯 클릭을 전달했습니다.`, {
      data: {
        ...slotClickDispatchedEventData(
          slotClickDispatchedAt, config.openAtMs, this.lastArrivalAt,
          this.kernel.monoFromRunStartMs(), clockData,
        ),
        slotMinutes: candidate.minutes,
        slotLabel: candidate.label,
        slotTransitionOutcome: "dispatched",
      },
    });

    const postSlotDeadline = serverClock.now() + 5_000;
    const slotTransition = await this.waitForSlotTransition(postSlotDeadline);
    if (slotTransition.kind === "stopped") return this.kernel.finishStopped();
    if (slotTransition.kind === "unknown") {
      return this.kernel.diagnosticHandOff(`${slotTransition.inspection.label} 화면은 자동 진행하지 않습니다.`, {
        ...postSlotEventData(slotTransition.inspection),
        slotTransitionOutcome: "unknown",
      });
    }
    if (slotTransition.kind === "timed_out") {
      return this.kernel.diagnosticHandOff("슬롯 클릭 후 후속 예약 화면을 5초 안에 확인하지 못했습니다.", {
        ...(slotTransition.inspection === null ? {} : postSlotEventData(slotTransition.inspection)),
        slotTransitionOutcome: "timed_out",
      });
    }

    const confirmationData = {
      ...postSlotEventData(slotTransition.inspection),
      slotTransitionOutcome: "confirmed",
    };
    this.kernel.transition(
      "SLOT_TRANSITION_CONFIRMED",
      "후속 예약 화면 도착을 확인했습니다. 좌석 확보 여부는 최종 예약 전까지 확정할 수 없습니다.",
      { data: confirmationData },
    );
    if (!config.postSlotEnabled) {
      return this.kernel.handOff(
        "후속 예약 화면을 확인했습니다. 후속 자동 진행이 꺼져 있어 사용자에게 인계합니다.",
        confirmationData,
      );
    }
    this.kernel.transition("ADVANCING_RESERVATION", "예약 폼까지 선택적 중간 단계를 진행합니다.");
    return this.advancePostSlot(slotTransition.inspection, postSlotDeadline, candidate, shopDisplayName);
  }

  private async waitForSlotTransition(deadline: number): Promise<SlotTransitionResult> {
    const controller = this.controller;
    const serverClock = this.serverClock;
    let lastInspection: PostSlotInspection | null = null;
    while (!controller.signal.aborted && serverClock.now() < deadline) {
      const inspection = this.deps.postSlot.inspect();
      lastInspection = inspection;
      if (inspection.kind === "unknown") return { kind: "unknown", inspection };
      if (inspection.kind !== "waiting") return { kind: "confirmed", inspection };
      if (!(await this.deps.sleep(Math.min(20, deadline - serverClock.now()), controller.signal))) break;
    }
    return controller.signal.aborted
      ? { kind: "stopped" }
      : { kind: "timed_out", inspection: lastInspection };
  }

  private async advancePostSlot(
    initialInspection: PostSlotInspection,
    initialDeadline: number,
    candidate: SlotCandidate,
    shopDisplayName: string | null,
  ): Promise<RunResult> {
    const config = this.config;
    const controller = this.controller;
    const serverClock = this.serverClock;
    let postSlotDeadline = initialDeadline;
    // 홍보 안내 창은 폼 도착 뒤 비결정적으로 늦게 렌더되므로 잠시 머물며 닫을 기회를 준다.
    const formNoticeGraceMs = 1_500;
    let formSeenAtMs: number | null = null;
    let formNoticeDismissed = false;
    let lastInspection: PostSlotInspection | null = null;
    let pendingInspection: PostSlotInspection | null = initialInspection;
    while (!controller.signal.aborted && serverClock.now() < postSlotDeadline) {
      const inspection = pendingInspection ?? this.deps.postSlot.inspect();
      pendingInspection = null;
      lastInspection = inspection;
      if (inspection.kind === "form") {
        if (formSeenAtMs === null) {
          formSeenAtMs = serverClock.now();
          postSlotDeadline = Math.max(postSlotDeadline, formSeenAtMs + formNoticeGraceMs);
        }
        if (!formNoticeDismissed && serverClock.now() - formSeenAtMs < formNoticeGraceMs) {
          if (!(await this.deps.sleep(20, controller.signal))) break;
          continue;
        }
        const formData = {
          ...postSlotEventData(inspection),
          openDeltaMs: Math.round(formSeenAtMs - config.openAtMs),
          timingServerAtMs: formSeenAtMs,
        };
        if (!config.reservationCompletionEnabled) {
          return this.kernel.handOff("예약 폼에 도착했습니다. 약관 확인과 최종 예약은 직접 진행하세요.", formData);
        }
        if (!this.deps.completion || !shopDisplayName) {
          return this.kernel.diagnosticHandOff("예약 매장 표시명을 확정할 수 없어 최종 제출하지 않습니다.", formData);
        }
        if (serverClock.now() >= config.stopAtMs) {
          return this.kernel.timedOut("최종 제출 전에 감시 종료 시각에 도달했습니다.");
        }
        let shopSlug = "";
        try {
          const segments = new URL(config.targetUrl).pathname.split("/").filter(Boolean);
          shopSlug = segments.at(-1) ?? "";
        } catch {
          shopSlug = "";
        }
        if (!shopSlug) return this.kernel.diagnosticHandOff("예약 매장 식별자를 확정할 수 없어 최종 제출하지 않습니다.", formData);
        this.kernel.transition("COMPLETING_RESERVATION", "예약 내용과 CatchPay를 최종 검증하고 예약 완주를 진행합니다.", {
          data: { ...formData, completionEnabled: true },
        });
        const completion = await this.deps.completion.run(config, {
          shopSlug,
          shopDisplayName,
          reservationDate: config.reservationDate,
          selectedMinutes: candidate.minutes,
          personCount: config.personCount,
        }, controller.signal, () => this.kernel.takePin());
        if (completion.kind === "completed") {
          this.kernel.transition("COMPLETED", completion.message);
          return this.kernel.finish();
        } else if (completion.kind === "stopped") {
          this.kernel.transition("STOPPED", completion.message, { userStopped: true });
          return this.kernel.finish();
        } else if (completion.kind === "timed_out") {
          return this.kernel.timedOut(completion.message);
        } else {
          return this.kernel.diagnosticHandOff(completion.message, {
            completionClaimed: completion.claimed,
            ...completion.evidence,
          });
        }
      }
      if (inspection.kind === "unknown") {
        return this.kernel.diagnosticHandOff(`${inspection.label} 화면은 자동 진행하지 않습니다.`, postSlotEventData(inspection));
      }
      if (inspection.kind === "waiting") {
        if (!(await this.deps.sleep(20, controller.signal))) break;
        continue;
      }

      const action = this.deps.postSlot.advance(inspection, config);
      if (action.status === "waiting") {
        if (!(await this.deps.sleep(20, controller.signal))) break;
        continue;
      }
      if (inspection.kind === "form_notice") {
        if (formSeenAtMs === null) {
          formSeenAtMs = serverClock.now();
          postSlotDeadline = Math.max(postSlotDeadline, formSeenAtMs + formNoticeGraceMs);
        }
        if (action.status === "acted") formNoticeDismissed = true;
      }
      const actionData: NonNullable<RunEvent["data"]> = {
        ...postSlotEventData(inspection),
        postSlotStatus: action.status,
      };
      this.observe.event("action", action.message, actionData);
      if (action.status === "blocked") {
        return this.kernel.diagnosticHandOff(action.message, postSlotEventData(inspection));
      }
      if (!(await this.deps.sleep(30, controller.signal))) break;
    }
    if (controller.signal.aborted) {
      return this.kernel.finishStopped();
    }
    return this.kernel.diagnosticHandOff(
      "후속 예약 화면을 5초 안에 확인하지 못했습니다.",
      lastInspection === null ? undefined : postSlotEventData(lastInspection),
    );
  }
}

type SlotTransitionResult =
  | { kind: "confirmed"; inspection: Exclude<PostSlotInspection, { kind: "waiting" } | { kind: "unknown" }> }
  | { kind: "unknown"; inspection: Extract<PostSlotInspection, { kind: "unknown" }> }
  | { kind: "timed_out"; inspection: PostSlotInspection | null }
  | { kind: "stopped" };

// armLead 하한은 두지 않는다 — config.preOpenLeadMs 자체가 사용자가 설정한
// 최소 리드타임이다(20-design §4, 하한 clamp는 toy-scale 테스트와 충돌해 제거).
function computeArmLeadMs(preOpenLeadMs: number, estimate: ReferenceClockEstimate): number {
  return Math.min(MAX_ARM_LEAD_MS, preOpenLeadMs + estimate.uncertaintyMs + estimate.p95RttMs);
}

export class OpenRunOrchestrator {
  private activeController: AbortController | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  stop(): void {
    this.activeController?.abort();
  }

  async start(
    config: ReservationConfig,
    requestedRunId?: string,
    executionContext?: RunExecutionContext,
    authorization?: OneShotRunAuthorization,
  ): Promise<RunResult> {
    if (this.activeController) throw new Error("이미 실행 중입니다.");
    const session = new RunSession(this.dependencies, config, requestedRunId, executionContext, authorization);
    // RunSession(handle)에 전달한 직후 이 async frame의 raw 참조를 폐기한다 —
    // await session.execute() 동안 suspended frame에 secret이 남지 않게 한다.
    authorization = undefined;
    this.activeController = session.controller;
    try {
      return await session.execute();
    } finally {
      this.activeController = null;
    }
  }
}
