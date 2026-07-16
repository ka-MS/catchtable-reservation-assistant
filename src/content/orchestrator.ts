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
import type { ReservationConfig, RunEvent, RunExecutionContext, RunState } from "../shared/types.js";
import type { TraceCode } from "../shared/telemetry/codes.js";
import type { TraceAttributes, TraceSeverity } from "../shared/telemetry/types.js";
import type { CalendarInspection, CalendarPreparationDispatch, CalendarPreparationResult } from "./adapter/calendar.js";
import type { EntryFacts, PersonFacts } from "../shared/run-control/facts.js";
import type { PostSlotActionResult, PostSlotInspection } from "./adapter/post-slot.js";
import type { StageSnapshot } from "./adapter/snapshot.js";
import { AvailabilityCorrelationTracker, type DomCorrelation } from "./availability-correlation.js";
import {
  AvailabilityDomWake,
  type AvailabilityWakeSignal,
} from "./availability-dom-wake.js";
import type { PreparationPageContext } from "./preparation-observation.js";

interface CalendarPort {
  inspect(targetDate: string): CalendarInspection;
  resetPreparation(): void;
  prepareTarget(targetDate: string, beforeDispatch?: (dispatch: CalendarPreparationDispatch) => void): CalendarPreparationResult;
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

interface DiagnosticsPort {
  breadcrumb(stage: RunState, trigger: "state" | "action", reason: string, data?: RunEvent["data"]): void;
  failure(stage: RunState, reason: string, data?: RunEvent["data"], error?: unknown): string | null;
  forceFlush(): Promise<void>;
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
  flushTrace?(): Promise<void>;
  captureSnapshot?(): StageSnapshot | null;
  capturePreparationContext?(): PreparationPageContext;
  diagnostics?: DiagnosticsPort;
  slotWatch?: SlotRefreshWatchPort;
  slotDomMutationWatch?: SlotDomMutationWatchPort;
  availabilityShadow?: AvailabilityShadowPort;
  runId(): string;
}

export interface RunResult {
  runId: string;
  state: RunState;
}

// 실측(site-behavior §8.1): 클릭→XHR 발사 217~379ms + 왕복 ~60ms → 도착은
// 클릭 후 ~450ms 안. 700ms는 유실 판정 타임아웃, 250ms는 응답→렌더(56~182ms) 커버.
const QUIESCE_TIMEOUT_MS = 700;
const ARRIVAL_BURST_MS = 250;
const BODY_WAKE_SCAN_INTERVAL_MS = 10;

// 오픈 타이밍 성능 Tier1(20-design §4): 병리적 불확실성이 감시를 몇 분씩 당기지
// 않도록 하는 안전 상한. 하한은 없음 — config.preOpenLeadMs 자체가 최소 리드타임.
const MAX_ARM_LEAD_MS = 30_000;
const PREPARATION_MAX_DISPATCH_ATTEMPTS = 2;
const PREPARATION_RETRY_DELAY_MS = 1_000;
const ENTRY_DISCOVERY_TIMEOUT_MS = 5_000;
const ENTRY_CONFIRM_TIMEOUT_MS = 2_000;
const PERSON_DISCOVERY_TIMEOUT_MS = 3_000;
const PERSON_CONFIRM_TIMEOUT_MS = 2_000;

const TERMINAL = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
]);

const DIAGNOSTIC_BREADCRUMB_STATES = new Set<RunState>([
  "ENTERING_RESERVATION",
  "SELECTING_DATE",
  "SELECTING_PERSON",
  "PREPARING_PAGE",
  "WAITING_FOR_OPEN",
  "SLOT_CLICK_DISPATCHED",
  "SLOT_TRANSITION_CONFIRMED",
  "ADVANCING_RESERVATION",
]);

function postSlotEventData(inspection: PostSlotInspection): NonNullable<RunEvent["data"]> {
  const diagnostics = inspection.diagnostics;
  if (!diagnostics) return { postSlotStage: inspection.kind };
  return {
    postSlotStage: inspection.kind,
    postSlotCertainty: inspection.certainty,
    postSlotStrategy: inspection.strategy,
    postSlotFingerprint: inspection.fingerprint,
    postSlotEvidence: inspection.evidence.join(" | "),
    dialogUrlKind: diagnostics.urlKind,
    dialogLabel: diagnostics.label,
    dialogTitle: diagnostics.title,
    dialogButtons: diagnostics.buttons.join(" | "),
    dialogDisabledButtonCount: diagnostics.disabledButtonCount,
    dialogRadioCount: diagnostics.radioCount,
    dialogCheckboxCount: diagnostics.checkboxCount,
    dialogQuantityControlCount: diagnostics.quantityControlCount,
    dialogZeroDepositControlCount: diagnostics.zeroDepositControlCount,
  };
}

export function stageSnapshotData(s: StageSnapshot | null): NonNullable<RunEvent["data"]> {
  if (!s) return {};
  return {
    snapshotUrlKind: s.urlKind,
    snapshotHeadings: s.headings.join(" | "),
    snapshotButtons: s.buttons.join(" | "),
    snapshotDisabledButtonCount: s.disabledButtonCount,
    snapshotDialogLabel: s.dialogLabel,
    snapshotDialogTitle: s.dialogTitle,
    snapshotTextSnippet: s.textSnippet,
    snapshotFingerprint: s.fingerprint,
  };
}

type ToggleCycleOutcome =
  | { kind: "terminal"; result: RunResult }
  | { kind: "retry" }
  | { kind: "slot"; candidate: SlotCandidate };

class RunSession {
  readonly controller = new AbortController();
  private readonly runId: string;
  private readonly machine: RunStateMachine;
  private readonly serverClock: MonotonicEpochClock;
  private offsetMs: number | null = null;
  private serverClockReady = false;
  private adjacentTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
  private targetTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
  private toggleCycle = 0;
  private adjacentDate: string | null = null;
  private watchLive = false;
  private lastArrivalAt: number | null = null;
  private referenceClockPort: ReferenceClockPort | null = null;
  private frozenReferenceClockSamples: {
    reason: "armed" | "terminal";
    samples: ReferenceClockSample[];
  } | null = null;
  private latestAppliedEstimate: ReferenceClockEstimate | null = null;
  private readonly runStartMonoMs: number;
  private readonly availabilityCorrelation = new AvailabilityCorrelationTracker();
  private readonly availabilityWake = new AvailabilityDomWake();

  constructor(
    private readonly deps: Dependencies,
    private readonly config: ReservationConfig,
    requestedRunId?: string,
    private readonly executionContext?: RunExecutionContext,
  ) {
    this.runId = requestedRunId ?? deps.runId();
    this.machine = new RunStateMachine({ dryRun: config.dryRun, now: () => deps.clock.now() });
    this.serverClock = new MonotonicEpochClock(deps.monotonicClock);
    // frame 1(monotonic): 기준시계 오차·wall-clock 점프와 무관한 실제 경과.
    this.runStartMonoMs = deps.monotonicClock.now();
  }

  private monoFromRunStartMs(): number {
    return this.deps.monotonicClock.now() - this.runStartMonoMs;
  }

  private mutationSnapshot(): { generation: number; lastMutationMonoMs: number | null } {
    try {
      return this.deps.slotDomMutationWatch?.snapshot()
        ?? { generation: 0, lastMutationMonoMs: null };
    } catch {
      return { generation: 0, lastMutationMonoMs: null };
    }
  }

  /** 감지 시점에 실제로 활성이던 기준시계 스냅샷. armed metric은 진입 시점에
   * (종종 표본 1개로) 얼어붙지만, rolling 샘플러가 대기 중 개선하므로 감지·선택
   * 이벤트는 그 순간의 confidence·uncertainty·wall offset을 함께 남긴다. */
  private detectionClockData(): NonNullable<RunEvent["data"]> {
    const estimate = this.latestAppliedEstimate;
    return {
      clockConfidence: estimate?.confidence ?? "LOW",
      clockUncertaintyMs: Math.round(estimate?.uncertaintyMs ?? 0),
      clockOffsetMs: Math.round(this.wallOffsetMs()),
    };
  }

  private emit(kind: RunEvent["kind"], message: string, data?: RunEvent["data"]): void {
    const at = this.deps.clock.now();
    this.deps.emit({ at, serverAt: this.serverClockReady ? this.serverClock.now() : null, runId: this.runId, kind, message, data });
    if (kind === "action") {
      try {
        this.deps.diagnostics?.breadcrumb(this.machine.state, "action", message, data);
      } catch {
        // Diagnostics must not affect reservation control.
      }
    }
  }

  private tracePreparation(
    phase: "stage_start" | "condition_changed" | "dispatch_before" | "dispatch_after" | "decision",
    attributes: TraceAttributes = {},
    severity: TraceSeverity = "trace",
  ): void {
    try {
      let page: PreparationPageContext | null = null;
      try {
        page = this.deps.capturePreparationContext?.() ?? null;
      } catch {
        page = null;
      }
      const execution = this.executionContext;
      this.deps.trace?.("PREPARATION_OBSERVED", severity, `준비 단계 ${phase} 상태를 기록했습니다.`, {
        serverAt: this.serverClockReady ? this.serverClock.now() : null,
        state: this.machine.state,
        attributes: {
          preparationStage: this.machine.state,
          preparationPhase: phase,
          ...(execution ? {
            runContextCapturedAt: execution.capturedAt,
            runTabId: execution.tabId,
            runWindowId: execution.windowId,
            runTabActive: execution.tabActive,
            runWindowFocused: execution.windowFocused,
          } : {}),
          ...(page ? {
            pageVisibilityState: page.visibilityState,
            pageHasFocus: page.hasFocus,
            pageViewportWidth: page.viewportWidth,
            pageViewportHeight: page.viewportHeight,
            pageVisualViewportWidth: page.visualViewportWidth,
            pageVisualViewportHeight: page.visualViewportHeight,
            pageActiveElementTag: page.activeElementTag,
            pageActiveElementRole: page.activeElementRole,
            pageActiveElementId: page.activeElementId,
            pageUrlKind: page.urlKind,
            pageFingerprint: page.fingerprint,
          } : {}),
          ...attributes,
        },
      });
    } catch {
      // 준비 진단은 예약 결과를 바꾸지 않는다.
    }
  }

  private transition(
    state: RunState,
    reason: string,
    extra: { error?: string; userStopped?: boolean; data?: RunEvent["data"] } = {},
  ): void {
    this.machine.transition(state, reason, { error: extra.error, userStopped: extra.userStopped });
    this.emit("state", reason, { state, ...extra.data });
    // REFRESHING_SLOTS and SLOT_DETECTED are the pre-click hot path. Early
    // configuration states also add no useful DOM evidence, so only selected
    // low-frequency reservation stages create breadcrumbs.
    if (DIAGNOSTIC_BREADCRUMB_STATES.has(state)) {
      try {
        this.deps.diagnostics?.breadcrumb(state, "state", reason, extra.data);
      } catch {
        // Diagnostics must not affect reservation control.
      }
    }
  }

  private finish(): RunResult {
    return { runId: this.runId, state: this.machine.state };
  }

  private finishStopped(): RunResult {
    this.transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
    return this.finish();
  }

  private failureData(reason: string, extra?: RunEvent["data"], error?: unknown): RunEvent["data"] {
    let snapshot: StageSnapshot | null = null;
    let diagnosticSnapshotId: string | null = null;
    try {
      snapshot = this.deps.captureSnapshot?.() ?? null;
    } catch {
      snapshot = null;
    }
    try {
      diagnosticSnapshotId = this.deps.diagnostics?.failure(this.machine.state, reason, extra, error) ?? null;
    } catch {
      diagnosticSnapshotId = null;
    }
    return {
      ...stageSnapshotData(snapshot),
      snapshotRunState: this.machine.state,
      ...(diagnosticSnapshotId === null ? {} : { diagnosticSnapshotId }),
      ...extra,
    };
  }

  private diagnosticHandOff(reason: string, extra?: RunEvent["data"]): RunResult {
    const data = this.failureData(reason, extra);
    this.transition("HANDED_OFF", reason, { data });
    return this.finish();
  }

  private handOff(reason: string, extra?: RunEvent["data"]): RunResult {
    this.transition("HANDED_OFF", reason, extra ? { data: extra } : {});
    return this.finish();
  }

  private timedOut(reason: string): RunResult {
    const data = this.failureData(reason);
    this.transition("TIMED_OUT", reason, { data });
    return this.finish();
  }

  private stopOrTimeout(result: "ready" | "timed_out" | "stopped"): RunResult | null {
    if (result === "timed_out") {
      return this.timedOut("감시 종료 시각에 도달했습니다.");
    }
    if (result === "stopped") {
      return this.finishStopped();
    }
    return null;
  }

  async execute(): Promise<RunResult> {
    try {
      try {
        this.deps.availabilityShadow?.start(this.config.stopAtMs + 30_000, (event) => {
          this.observeAvailabilityBody(event);
        });
      } catch {
        // Shadow 관측은 제어 경로와 격리한다.
      }
      this.deps.slotWatch?.start(() => {
        this.watchLive = true;
        if (this.serverClockReady) this.lastArrivalAt = this.serverClock.now();
      });
      this.transition("CONFIGURED", "예약 설정을 불러왔습니다.");
      return this.validate()
        ?? await this.syncInitialClock()
        ?? await this.prepareEntry()
        ?? await this.prepareDate()
        ?? await this.preparePerson()
        ?? this.confirmPageReady()
        ?? await this.waitForOpen()
        ?? await this.searchAndReserve()
        ?? this.finishStopped();
    } catch (error) {
      if (!TERMINAL.has(this.machine.state)) {
        const message = error instanceof Error ? error.message : "알 수 없는 실행 오류";
        const failure = this.failureData(message, undefined, error);
        this.deps.trace?.("RUN_FAILED", "error", message, {
          serverAt: this.serverClockReady ? this.serverClock.now() : null,
          state: "FAILED",
          attributes: failure as TraceAttributes,
          error,
        });
        this.transition("FAILED", message, { error: message, data: failure });
      }
      return this.finish();
    } finally {
      try {
        this.deps.availabilityShadow?.stop();
      } catch {
        // Shadow 원복 실패도 terminal 결과를 바꾸지 않는다.
      }
      this.availabilityWake.reset();
      this.deps.slotWatch?.stop();
      try {
        this.deps.slotDomMutationWatch?.stop();
      } catch {
        // Mutation telemetry cleanup cannot change the terminal result.
      }
      this.stopReferenceClock("terminal"); // waitForOpen 도달 전 조기 종료 시 안전망
      this.traceFrozenReferenceClockSamples();
      await Promise.allSettled([
        this.deps.diagnostics?.forceFlush() ?? Promise.resolve(),
        this.deps.flushTrace?.() ?? Promise.resolve(),
      ]);
    }
  }

  private observeAvailabilityBody(event: ReceivedAvailabilityShadowEvent): void {
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
      this.deps.trace?.("AVAILABILITY_SHADOW", event.classification === "UNPARSABLE" ? "warn" : "trace",
        `슬롯 응답 shadow를 ${event.classification}로 분류했습니다.`, {
          serverAt: this.serverClockReady ? this.serverClock.now() : null,
          state: this.machine.state,
          attributes: {
            phase: "body",
            cycle: correlation.cycle,
            requestSequence: event.sequence,
            sequence: event.sequence,
            correlationId: correlation.correlationId,
            correlationQuality: correlation.quality,
            requestDate: event.requestDate,
            personCount: event.personCount,
            classification: event.classification,
            responseStatus: event.responseStatus,
            availableCount: event.availableMinutes.length,
            availableMinutes: event.availableMinutes.join(","),
            selectedMinutes: selected?.minutes ?? null,
            matchesTarget: acceptedCorrelation,
            stale: correlation.stale,
            requestSentMonoMs: event.requestSentMonoMs,
            responseCompletedMonoMs: event.responseCompletedMonoMs,
            bodyReadCompletedMonoMs: event.bodyReadCompletedMonoMs,
            payloadClassifiedMonoMs: event.payloadClassifiedMonoMs,
            bridgeReceivedMonoMs: event.bridgeReceivedMonoMs,
            bridgeDelayMs: event.bridgeReceivedMonoMs - event.payloadClassifiedMonoMs,
            wakeAccepted: wakeDecision.accepted,
            wakeDiscardReason: wakeDecision.discardReason,
            signalKind: wakeDecision.signal?.kind ?? null,
            wakeAtMonoMs,
            bodyToWakeMs: wakeAtMonoMs - event.bridgeReceivedMonoMs,
            claimSource: wakeDecision.accepted ? "body" : "none",
            claimAgreement: wakeDecision.accepted ? true : null,
          },
        });
      if (correlation.lateDomCorrelation) {
        this.traceAvailabilityDomCorrelation(correlation.lateDomCorrelation, "dom_compare_late");
      }
    } catch {
      // 비신뢰 bridge payload의 후처리는 예약 흐름으로 예외를 전파하지 않는다.
    }
  }

  private observeAvailabilityDom(candidate: SlotCandidate, cycle: number): void {
    try {
      const observedMonoMs = this.deps.monotonicClock.now();
      const mutation = this.mutationSnapshot();
      const correlation = this.availabilityCorrelation.correlateDom(
        cycle,
        candidate.minutes,
        observedMonoMs,
        mutation,
      );
      this.traceAvailabilityDomCorrelation(correlation, "dom_compare");
    } catch {
      // Shadow 비교는 기존 DOM 후보 반환을 막지 않는다.
    }
  }

  private traceAvailabilityDomCorrelation(
    correlation: DomCorrelation,
    phase: "dom_compare" | "dom_compare_late",
  ): void {
    this.deps.trace?.("AVAILABILITY_SHADOW", "trace", "body와 DOM 슬롯 후보를 비교했습니다.", {
        serverAt: this.serverClockReady ? this.serverClock.now() : null,
        state: this.machine.state,
        attributes: {
          phase,
          cycle: correlation.cycle,
          requestSequence: correlation.requestSequence,
          correlationId: correlation.correlationId,
          correlationQuality: correlation.quality,
          domMinutes: correlation.domMinutes,
          domObservedMonoMs: correlation.domObservedMonoMs,
          bodySequence: correlation.requestSequence,
          bodyClassification: correlation.bodyClassification,
          bodySelectedMinutes: correlation.bodySelectedMinutes,
          agreement: correlation.agreement,
          responseCompletedMonoMs: correlation.responseCompletedMonoMs,
          payloadClassifiedMonoMs: correlation.payloadClassifiedMonoMs,
          bridgeReceivedMonoMs: correlation.bridgeReceivedMonoMs,
          bridgeToDomMs: correlation.bridgeToDomMs,
          targetResponseToDomMs: correlation.targetResponseToDomMs,
          bodyLeadOverDomMs: correlation.bodyLeadOverDomMs,
          mutationGenerationAtTargetClick: correlation.mutationGenerationAtTargetClick,
          mutationGenerationAtDom: correlation.mutationGenerationAtDom,
          mutationObservedAfterTarget: correlation.mutationObservedAfterTarget,
          lastMutationMonoMs: correlation.lastMutationMonoMs,
          claimSource: correlation.requestSequence === null ? "dom" : "body",
        },
      });
  }

  private traceAvailabilityWakeResult(
    signal: Extract<AvailabilityWakeSignal, { kind: "scan_wake" }>,
    candidateObservedMonoMs: number | null,
    candidateFound: boolean,
    fallbackUsed: boolean,
    scanCount: number,
    baselineNextScanAtMonoMs: number | null,
    wakeScanAtMonoMs: number | null,
  ): void {
    try {
      this.deps.trace?.("AVAILABILITY_SHADOW", "trace", "body wake-up 이후 DOM 후보를 확인했습니다.", {
        serverAt: this.serverClockReady ? this.serverClock.now() : null,
        state: this.machine.state,
        attributes: {
          phase: "wake_result",
          wakeReason: "verified_target_body",
          cycle: signal.cycle,
          requestSequence: signal.requestSequence,
          correlationQuality: signal.quality,
          selectedMinutes: signal.selectedMinutes,
          responseCompletedMonoMs: signal.responseCompletedMonoMs,
          payloadClassifiedMonoMs: signal.payloadClassifiedMonoMs,
          bridgeReceivedMonoMs: signal.bridgeReceivedMonoMs,
          wakeAtMonoMs: signal.wakeAtMonoMs,
          domCandidateMonoMs: candidateObservedMonoMs,
          bodyToWakeMs: signal.wakeAtMonoMs - signal.bridgeReceivedMonoMs,
          wakeToDomMs: candidateObservedMonoMs === null ? null : candidateObservedMonoMs - signal.wakeAtMonoMs,
          responseToDomMs: candidateObservedMonoMs === null
            ? null
            : candidateObservedMonoMs - signal.responseCompletedMonoMs,
          wakeCandidateFound: candidateFound,
          wakeFallbackUsed: fallbackUsed,
          wakeScanCount: scanCount,
          baselineNextScanAtMonoMs,
          wakeScanAtMonoMs,
          wakeAdvanceMs: baselineNextScanAtMonoMs === null || wakeScanAtMonoMs === null
            ? null
            : Math.max(0, baselineNextScanAtMonoMs - wakeScanAtMonoMs),
        },
      });
    } catch {
      // Wake-up diagnostics cannot change the reservation result.
    }
  }

  private traceAvailabilityEmptyExit(
    signal: Extract<AvailabilityWakeSignal, { kind: "empty_exit" }>,
    targetStillSelected: boolean,
    finalDomCandidateFound: boolean,
  ): void {
    try {
      const exitAtMonoMs = this.deps.monotonicClock.now();
      const emptyEarlyExitApplied = targetStillSelected && !finalDomCandidateFound;
      const message = finalDomCandidateFound
        ? "EXACT EMPTY 응답 직후 슬롯 DOM 후보를 확인해 조기 종료하지 않았습니다."
        : targetStillSelected
          ? "EXACT EMPTY 응답으로 현재 날짜 토글 cycle을 종료했습니다."
          : "EXACT EMPTY 응답을 받았지만 목표 날짜 선택이 풀려 조기 종료하지 않았습니다.";
      this.deps.trace?.("AVAILABILITY_SHADOW", "trace", message, {
        serverAt: this.serverClockReady ? this.serverClock.now() : null,
        state: this.machine.state,
        attributes: {
          phase: "empty_early_exit",
          signalKind: signal.kind,
          cycle: signal.cycle,
          requestSequence: signal.requestSequence,
          correlationQuality: signal.quality,
          responseCompletedMonoMs: signal.responseCompletedMonoMs,
          payloadClassifiedMonoMs: signal.payloadClassifiedMonoMs,
          bridgeReceivedMonoMs: signal.bridgeReceivedMonoMs,
          wakeAtMonoMs: signal.wakeAtMonoMs,
          exitAtMonoMs,
          bodyToExitMs: exitAtMonoMs - signal.bridgeReceivedMonoMs,
          targetStillSelected,
          finalDomCandidateFound,
          emptyEarlyExitApplied,
        },
      });
    } catch {
      // EMPTY diagnostics cannot change the reservation result.
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
    this.emit("metric",
      estimate.source === "FALLBACK" ? "서버 시계 측정 실패로 로컬 시계를 사용합니다." : "서버 시계 보정을 완료했습니다.",
      referenceClockMetricData(estimate, "bootstrap", this.wallOffsetMs()));
    // 대기 시간(prepareEntry~waitForOpen)을 관통해 계속 관측한다 — 부트스트랩은
    // 단일 표본이라 거친 앵커일 뿐이고, armLead 결정 시점까지 confidence가
    // 자연히 개선된다(20-design §3). waitForOpen()이 stop()으로 종료시킨다.
    void port.start((next) => this.applyReferenceClockEstimate(next));
    return null;
  }

  private stopReferenceClock(reason: "armed" | "terminal"): void {
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
    if (!frozen || frozen.samples.length === 0) return;
    const total = frozen.samples.length;
    frozen.samples.forEach((sample, index) => {
      try {
        this.deps.trace?.("CLOCK_SAMPLE", "trace", `기준시계 원시 표본 ${index + 1}/${total}을 기록했습니다.`, {
          serverAt: this.serverClockReady ? this.serverClock.now() : null,
          // Raw 진단 event가 terminal prune를 반복 트리거하지 않도록 run state는 싣지 않는다.
          state: null,
          attributes: {
            clockSampleIndex: index + 1,
            clockSampleTotal: total,
            clockSampleFreezeReason: frozen.reason,
            clockSampleT0MonoMs: sample.t0,
            clockSampleT1MonoMs: sample.t1,
            clockSampleServerDateMs: sample.serverDateMs,
            clockSampleRttMs: sample.rttMs,
            clockSampleOffsetLowerMs: sample.lowerMs,
            clockSampleOffsetCenterMs: (sample.lowerMs + sample.upperMs) / 2,
            clockSampleOffsetUpperMs: sample.upperMs,
            clockSampleFromCache: sample.fromCache,
          },
        });
      } catch {
        // Trace exporter 오류는 예약 결과를 바꾸지 않는다.
      }
    });
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
  private wallOffsetMs(): number {
    return this.serverClock.now() - this.deps.clock.now();
  }

  private async prepareEntry(): Promise<RunResult | null> {
    if (this.config.entryMode !== "auto") return null;
    const config = this.config;
    const controller = this.controller;
    const serverClock = this.serverClock;
    this.transition("ENTERING_RESERVATION", "예약창 진입 상태를 확인합니다.");
    this.tracePreparation("stage_start", { preparationTarget: "reservation_calendar" });
    const entryDiscoveryDeadline = Math.min(serverClock.now() + ENTRY_DISCOVERY_TIMEOUT_MS, config.stopAtMs);
    let entryAttempts = 0;
    let nextEntryDispatchAt: number | null = null;
    let entryConfirmationDeadline: number | null = null;
    let lastCondition = "";
    while (true) {
      if (controller.signal.aborted) return this.finishStopped();
      if (serverClock.now() >= config.stopAtMs) {
        return this.timedOut("예약 페이지 준비 중 감시 종료 시각에 도달했습니다.");
      }
      const entry = this.deps.entry.inspect();
      const condition = `${entry.reservationOpen}:${entry.ctaAvailable}:${entry.waitingOnly}`;
      if (condition !== lastCondition) {
        lastCondition = condition;
        this.tracePreparation("condition_changed", {
          reservationOpen: entry.reservationOpen,
          reservationCtaAvailable: entry.ctaAvailable,
          waitingOnly: entry.waitingOnly,
        });
      }
      if (entry.reservationOpen) {
        this.tracePreparation("decision", { preparationDecision: "ready" });
        break;
      }
      if (entry.waitingOnly) {
        this.tracePreparation("decision", { preparationDecision: "handoff", preparationErrorCode: "WAITING_ONLY" }, "warn");
        return this.diagnosticHandOff("이 식당은 현장 웨이팅만 가능해 예약창을 열 수 없습니다.", {
          preparationErrorCode: "WAITING_ONLY",
          preparationAttemptCount: entryAttempts,
          preparationRecoveryDecision: "handoff",
        });
      }
      const currentAt = serverClock.now();
      const dismissed = entryAttempts > 0 && (this.deps.entry.dismissPromo?.() ?? false);
      if (dismissed) {
        this.tracePreparation("dispatch_after", {
          preparationAction: "dismiss_promo",
          preparationAttempt: entryAttempts,
          preparationDispatched: true,
          preparationRecoveryDecision: "retry",
        });
        this.emit("action", "매장 홍보 안내 창을 닫았습니다.");
        nextEntryDispatchAt = currentAt;
      }
      const canDispatch = entry.ctaAvailable
        && entryAttempts < PREPARATION_MAX_DISPATCH_ATTEMPTS
        && (entryAttempts === 0 || (nextEntryDispatchAt !== null && currentAt >= nextEntryDispatchAt));
      if (canDispatch) {
        const attempt = entryAttempts + 1;
        this.tracePreparation("dispatch_before", {
          preparationAction: "open_reservation",
          preparationAttempt: attempt,
          preparationRecoveryDecision: attempt === 1 ? "initial" : "retry",
        });
        const entryDispatched = this.deps.entry.openReservation();
        entryAttempts = attempt;
        this.tracePreparation("dispatch_after", {
          preparationAction: "open_reservation",
          preparationAttempt: attempt,
          preparationDispatched: entryDispatched,
          preparationRecoveryDecision: attempt === 1 ? "confirm" : "final_confirm",
        });
        if (entryDispatched) {
          this.emit("action", attempt === 1
            ? "예약하기 버튼을 클릭했습니다."
            : "예약하기 버튼 클릭을 재시도했습니다.");
        }
        entryConfirmationDeadline ??= Math.min(currentAt + ENTRY_CONFIRM_TIMEOUT_MS, config.stopAtMs);
        nextEntryDispatchAt = currentAt + PREPARATION_RETRY_DELAY_MS;
      }
      if (entryAttempts === 0 && currentAt >= entryDiscoveryDeadline) {
        this.tracePreparation("decision", {
          preparationDecision: "handoff",
          preparationErrorCode: "ENTRY_CTA_MISSING",
          preparationAttempt: 0,
        }, "warn");
        return this.diagnosticHandOff("식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.", {
          preparationErrorCode: "ENTRY_CTA_MISSING",
          preparationAttemptCount: 0,
          preparationRecoveryDecision: "handoff",
        });
      }
      if (entryAttempts > 0 && entryConfirmationDeadline !== null && currentAt >= entryConfirmationDeadline) {
        this.tracePreparation("decision", {
          preparationDecision: "handoff",
          preparationErrorCode: "ENTRY_TRANSITION_STALLED",
          preparationAttempt: entryAttempts,
        }, "warn");
        return this.diagnosticHandOff("예약하기 클릭 후 달력 화면을 확인할 수 없습니다.", {
          preparationErrorCode: "ENTRY_TRANSITION_STALLED",
          preparationAttemptCount: entryAttempts,
          preparationRecoveryDecision: "handoff",
        });
      }
      if (!(await this.deps.sleep(50, controller.signal))) return this.finishStopped();
    }
    return null;
  }

  private async prepareDate(): Promise<RunResult | null> {
    if (this.config.entryMode !== "auto") return null;
    const config = this.config;
    const controller = this.controller;
    const serverClock = this.serverClock;
    this.transition("SELECTING_DATE", "목표 월과 예약 날짜를 준비합니다.");
    this.deps.calendar.resetPreparation();
    this.tracePreparation("stage_start", { preparationTarget: config.reservationDate });
    const dateDeadline = Math.min(serverClock.now() + 10_000, config.stopAtMs);
    let lastCondition = "";
    let lastDateAttempt = 0;
    while (true) {
      if (controller.signal.aborted) return this.finishStopped();
      if (serverClock.now() >= config.stopAtMs) {
        return this.timedOut("예약 날짜 준비 중 감시 종료 시각에 도달했습니다.");
      }
      const dispatches: CalendarPreparationDispatch[] = [];
      const preparation = this.deps.calendar.prepareTarget(config.reservationDate, (nextDispatch) => {
        dispatches.push(nextDispatch);
        if (nextDispatch.kind === "date") lastDateAttempt = nextDispatch.attempt;
        this.tracePreparation("dispatch_before", {
          preparationAction: nextDispatch.kind === "date" ? "select_date" : "change_month",
          preparationTarget: nextDispatch.target,
          preparationAttempt: nextDispatch.attempt,
          preparationRecoveryDecision: nextDispatch.attempt === 1 ? "initial" : "retry",
        });
      });
      const condition = `${preparation.status}:${preparation.message}`;
      if (condition !== lastCondition) {
        lastCondition = condition;
        this.tracePreparation("condition_changed", {
          preparationStatus: preparation.status,
          preparationTarget: config.reservationDate,
        });
      }
      const dispatch = dispatches.at(-1);
      if (dispatch && preparation.status === "acted") {
        this.tracePreparation("dispatch_after", {
          preparationAction: dispatch.kind === "date" ? "select_date" : "change_month",
          preparationTarget: dispatch.target,
          preparationAttempt: dispatch.attempt,
          preparationDispatched: true,
          preparationRecoveryDecision: dispatch.attempt === 1 ? "confirm" : "final_confirm",
        });
      }
      if (preparation.status === "ready") {
        this.tracePreparation("decision", { preparationDecision: "ready", preparationTarget: config.reservationDate });
        break;
      }
      if (preparation.status === "blocked") {
        const errorCode = preparation.errorCode ?? "DATE_PREPARATION_BLOCKED";
        this.tracePreparation("decision", {
          preparationDecision: "handoff",
          preparationErrorCode: errorCode,
          preparationTarget: config.reservationDate,
          preparationAttempt: lastDateAttempt,
        }, "warn");
        return this.diagnosticHandOff(preparation.message, {
          preparationErrorCode: errorCode,
          preparationAttemptCount: lastDateAttempt,
          preparationRecoveryDecision: "handoff",
        });
      }
      if (preparation.status === "acted") this.emit("action", preparation.message);
      if (serverClock.now() >= dateDeadline) {
        this.tracePreparation("decision", {
          preparationDecision: "handoff",
          preparationErrorCode: "DATE_SELECTION_STALLED",
          preparationTarget: config.reservationDate,
        }, "warn");
        return this.diagnosticHandOff("목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.", {
          preparationErrorCode: "DATE_SELECTION_STALLED",
          preparationAttemptCount: lastDateAttempt,
          preparationRecoveryDecision: "handoff",
        });
      }
      if (!(await this.deps.sleep(50, controller.signal))) return this.finishStopped();
    }
    return null;
  }

  private async preparePerson(): Promise<RunResult | null> {
    if (this.config.entryMode !== "auto") return null;
    const config = this.config;
    const controller = this.controller;
    const serverClock = this.serverClock;
    this.transition("SELECTING_PERSON", "예약 인원을 준비합니다.");
    this.tracePreparation("stage_start", { preparationTargetPersonCount: config.personCount });
    const personDiscoveryDeadline = Math.min(serverClock.now() + PERSON_DISCOVERY_TIMEOUT_MS, config.stopAtMs);
    let personAttempts = 0;
    let nextPersonDispatchAt: number | null = null;
    let personConfirmationDeadline: number | null = null;
    let lastCondition = "";
    while (true) {
      if (controller.signal.aborted) return this.finishStopped();
      if (serverClock.now() >= config.stopAtMs) {
        return this.timedOut("예약 인원 준비 중 감시 종료 시각에 도달했습니다.");
      }
      const person = this.deps.person.inspect(config.personCount);
      const condition = `${person.ready}:${person.targetAvailable}:${person.targetSelected}`;
      if (condition !== lastCondition) {
        lastCondition = condition;
        this.tracePreparation("condition_changed", {
          personControlReady: person.ready,
          targetPersonAvailable: person.targetAvailable,
          targetPersonSelected: person.targetSelected,
          preparationTargetPersonCount: config.personCount,
        });
      }
      if (person.targetSelected) {
        this.tracePreparation("decision", { preparationDecision: "ready", preparationTargetPersonCount: config.personCount });
        break;
      }
      if (person.ready && !person.targetAvailable) {
        this.tracePreparation("decision", {
          preparationDecision: "handoff",
          preparationErrorCode: "PERSON_UNAVAILABLE",
          preparationTargetPersonCount: config.personCount,
        }, "warn");
        return this.diagnosticHandOff(`이 식당에서 ${config.personCount}명을 선택할 수 없습니다.`, {
          preparationErrorCode: "PERSON_UNAVAILABLE",
          preparationAttemptCount: personAttempts,
          preparationRecoveryDecision: "handoff",
        });
      }
      const currentAt = serverClock.now();
      const canDispatch = person.targetAvailable
        && personAttempts < PREPARATION_MAX_DISPATCH_ATTEMPTS
        && (personAttempts === 0 || (nextPersonDispatchAt !== null && currentAt >= nextPersonDispatchAt));
      if (canDispatch) {
        const attempt = personAttempts + 1;
        this.tracePreparation("dispatch_before", {
          preparationAction: "select_person",
          preparationAttempt: attempt,
          preparationTargetPersonCount: config.personCount,
          preparationRecoveryDecision: attempt === 1 ? "initial" : "retry",
        });
        const dispatched = this.deps.person.select(config.personCount);
        personAttempts = attempt;
        this.tracePreparation("dispatch_after", {
          preparationAction: "select_person",
          preparationAttempt: attempt,
          preparationTargetPersonCount: config.personCount,
          preparationDispatched: dispatched,
          preparationRecoveryDecision: attempt === 1 ? "confirm" : "final_confirm",
        });
        if (dispatched) {
          this.emit("action", attempt === 1
            ? `${config.personCount}명으로 설정했습니다.`
            : `${config.personCount}명 선택을 재시도했습니다.`);
        }
        personConfirmationDeadline ??= Math.min(currentAt + PERSON_CONFIRM_TIMEOUT_MS, config.stopAtMs);
        nextPersonDispatchAt = currentAt + PREPARATION_RETRY_DELAY_MS;
      }
      if (personAttempts === 0 && currentAt >= personDiscoveryDeadline) {
        this.tracePreparation("decision", {
          preparationDecision: "handoff",
          preparationErrorCode: "PERSON_SELECTION_STALLED",
          preparationAttempt: 0,
          preparationTargetPersonCount: config.personCount,
        }, "warn");
        return this.diagnosticHandOff("예약 인원 선택 상태를 제한 시간 안에 확인할 수 없습니다.", {
          preparationErrorCode: "PERSON_SELECTION_STALLED",
          preparationAttemptCount: 0,
          preparationRecoveryDecision: "handoff",
        });
      }
      if (personAttempts > 0 && personConfirmationDeadline !== null && currentAt >= personConfirmationDeadline) {
        this.tracePreparation("decision", {
          preparationDecision: "handoff",
          preparationErrorCode: "PERSON_SELECTION_STALLED",
          preparationAttempt: personAttempts,
          preparationTargetPersonCount: config.personCount,
        }, "warn");
        return this.diagnosticHandOff("예약 인원 선택 상태를 제한 시간 안에 확인할 수 없습니다.", {
          preparationErrorCode: "PERSON_SELECTION_STALLED",
          preparationAttemptCount: personAttempts,
          preparationRecoveryDecision: "handoff",
        });
      }
      if (!(await this.deps.sleep(50, controller.signal))) return this.finishStopped();
    }
    return null;
  }

  private confirmPageReady(): RunResult | null {
    this.transition("PREPARING_PAGE", "예약 모달과 목표 날짜를 확인합니다.");
    const setup = this.deps.calendar.inspect(this.config.reservationDate);
    if (!setup.targetAvailable || !setup.targetSelected || setup.adjacentDate === null) {
      return this.diagnosticHandOff("목표 날짜 선택 또는 인접 가용 날짜를 확인할 수 없습니다. 페이지를 준비한 뒤 새로 시작하세요.");
    }
    this.adjacentDate = setup.adjacentDate;
    return null;
  }

  private async waitForOpen(): Promise<RunResult | null> {
    const config = this.config;
    const controller = this.controller;
    const serverClock = this.serverClock;
    this.transition("WAITING_FOR_OPEN", "예약 오픈 직전까지 대기합니다.");
    const estimate = this.referenceClockPort?.latest ?? this.latestAppliedEstimate ?? estimateReferenceClock([]);
    const armLeadMs = computeArmLeadMs(config.preOpenLeadMs, estimate);
    this.emit("metric", "예약 오픈 직전 진입 시점을 결정했습니다.",
      referenceClockMetricData(estimate, "armed", this.wallOffsetMs(), armLeadMs));
    const waitResult = await waitUntil(config.openAtMs - armLeadMs, {
      clock: serverClock,
      stopAtMs: config.stopAtMs,
      signal: controller.signal,
      sleep: this.deps.sleep,
    });
    // 정밀 토글 그리드 진입 전 앵커를 동결한다 — 계속 갱신되게 두면 클릭 그리드
    // 계산 도중 앵커가 흔들릴 수 있다(20-design §3).
    this.stopReferenceClock(waitResult === "ready" ? "armed" : "terminal");
    const waitingExit = this.stopOrTimeout(waitResult);
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
    this.transition("REFRESHING_SLOTS", "날짜 토글로 예약 슬롯을 갱신합니다.");
    while (!this.controller.signal.aborted) {
      if (serverClock.now() >= config.stopAtMs) {
        return this.timedOut("감시 종료 시각에 도달했습니다.");
      }
      const cycle = await this.runToggleCycle();
      if (cycle.kind === "terminal") return cycle.result;
      if (cycle.kind === "retry") continue;
      const advanced = await this.advanceFromSlot(cycle.candidate);
      if (advanced) return advanced;
    }
    return this.finishStopped();
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
    const traceCycle = (result: string) => this.deps.trace?.(
      "DATE_TOGGLE_CYCLE",
      result === "NO_SLOT" || result === "SLOT_FOUND" || result === "EMPTY_EARLY_EXIT" ? "trace" : "warn",
      `날짜 토글 #${cycle}: ${result}`,
      {
        serverAt: serverClock.now(),
        state: "REFRESHING_SLOTS",
        attributes: toggleCycleAttributes({
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
        }),
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
    const adjacentWaitExit = this.stopOrTimeout(adjacentWait);
    if (adjacentWaitExit) return { kind: "terminal", result: adjacentWaitExit };

    const currentSetup = this.deps.calendar.inspect(config.reservationDate);
    const adjacentDate = currentSetup.adjacentDate;
    adjacentDateValue = adjacentDate;
    if (!currentSetup.targetAvailable || adjacentDate === null) {
      traceCycle("SETUP_INVALID");
      return { kind: "terminal", result: this.diagnosticHandOff("달력 상태가 바뀌어 안전하게 슬롯을 갱신할 수 없습니다.") };
    }
    if (!this.deps.calendar.clickDate(adjacentDate)) {
      traceCycle("ADJACENT_CLICK_FAILED");
      return { kind: "terminal", result: this.diagnosticHandOff("인접 날짜를 선택할 수 없습니다.") };
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
    const targetWaitExit = this.stopOrTimeout(targetWait);
    if (targetWaitExit) return { kind: "terminal", result: targetWaitExit };
    const targetClickMonoMs = this.deps.monotonicClock.now();
    const mutationAtTargetClick = this.mutationSnapshot();
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
      return { kind: "terminal", result: this.diagnosticHandOff("목표 날짜를 다시 선택할 수 없습니다.") };
    }
    targetClickedAt = serverClock.now();
    this.targetTiming = {
      actualAt: targetClickedAt,
      scheduledAt: plan.targetClickAtMs,
      phase: plan.phase,
    };
    if (plan.targetClickAtMs === config.openAtMs) {
      this.emit("metric", "예약 오픈 정각에 목표 날짜를 클릭했습니다.", targetClickMetricData(targetClickedAt, plan, config.openAtMs));
    }

    if (!(await this.deps.sleep(20, controller.signal))) {
      traceCycle("STOPPED_AFTER_TARGET");
      return { kind: "terminal", result: this.finishStopped() };
    }
    if (serverClock.now() >= config.stopAtMs) {
      traceCycle("TIMED_OUT_AFTER_TARGET");
      return { kind: "terminal", result: this.timedOut("감시 종료 시각에 도달했습니다.") };
    }
    const selectionDeadline = Math.min(plan.targetClickAtMs + 60, config.stopAtMs);
    let targetSelected = this.deps.calendar.inspect(config.reservationDate).targetSelected;
    while (!targetSelected && serverClock.now() < selectionDeadline) {
      if (!(await this.deps.sleep(Math.min(10, selectionDeadline - serverClock.now()), controller.signal))) {
        traceCycle("STOPPED_DURING_SELECTION");
        return { kind: "terminal", result: this.finishStopped() };
      }
      targetSelected = this.deps.calendar.inspect(config.reservationDate).targetSelected;
    }
    if (serverClock.now() >= config.stopAtMs) {
      traceCycle("TIMED_OUT_DURING_SELECTION");
      return { kind: "terminal", result: this.timedOut("감시 종료 시각에 도달했습니다.") };
    }
    if (!targetSelected) {
      traceCycle("SELECTION_UNCONFIRMED");
      return { kind: "terminal", result: this.diagnosticHandOff("목표 날짜 선택 상태를 확인할 수 없습니다.") };
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
        this.traceAvailabilityEmptyExit(emptySignal, false, false);
        wakeSignal = null;
        return { applied: false, candidate: null };
      }
      const finalCandidate = inspectSlots();
      this.traceAvailabilityEmptyExit(emptySignal, true, finalCandidate !== null);
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
      this.traceAvailabilityWakeResult(
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
    this.observeAvailabilityDom(candidate, cycle);
    traceCycle("SLOT_FOUND");
    this.availabilityWake.endCycle(cycle);
    return { kind: "slot", candidate };
  }

  private async advanceFromSlot(candidate: SlotCandidate): Promise<RunResult | null> {
    const config = this.config;
    const serverClock = this.serverClock;
    const slotDetectedAt = serverClock.now();
    const clockData = this.detectionClockData();
    this.transition("SLOT_DETECTED", `${candidate.label} 슬롯을 감지했습니다.`, {
      data: slotDetectedEventData(
        slotDetectedAt, this.adjacentTiming, this.targetTiming, config.openAtMs,
        this.lastArrivalAt, this.monoFromRunStartMs(), clockData,
      ),
    });
    this.emit("detect", "예약 조건과 일치하는 슬롯을 찾았습니다.", { slotMinutes: candidate.minutes, slotLabel: candidate.label });
    if (config.dryRun) {
      this.transition("DRY_RUN_COMPLETED", "dry-run이므로 슬롯을 클릭하지 않았습니다.");
      return this.finish();
    }
    if (serverClock.now() >= config.stopAtMs) {
      return this.timedOut("클릭 직전 감시 종료 시각에 도달했습니다.");
    }
    if (!this.deps.slots.clickSlot(candidate)) {
      this.deps.trace?.("SLOT_CLICKED", "warn", `${candidate.label} 슬롯 클릭에 실패했습니다.`, {
        serverAt: serverClock.now(),
        state: "SLOT_DETECTED",
        attributes: {
          slotMinutes: candidate.minutes,
          slotLabel: candidate.label,
          clickOk: false,
          slotTransitionOutcome: "contention_before_dispatch",
        },
      });
      this.transition("REFRESHING_SLOTS", "슬롯이 dispatch 전에 사라져 날짜 토글을 재개합니다.", {
        data: {
          slotMinutes: candidate.minutes,
          slotLabel: candidate.label,
          slotTransitionOutcome: "contention_before_dispatch",
        },
      });
      return null;
    }
    const slotClickDispatchedAt = serverClock.now();
    this.deps.trace?.("SLOT_CLICKED", "info", `${candidate.label} 슬롯을 클릭했습니다.`, {
      serverAt: slotClickDispatchedAt,
      state: "SLOT_CLICK_DISPATCHED",
      attributes: {
        slotMinutes: candidate.minutes,
        slotLabel: candidate.label,
        clickOk: true,
        slotTransitionOutcome: "dispatched",
      },
    });
    this.transition("SLOT_CLICK_DISPATCHED", `${candidate.label} 슬롯 클릭을 전달했습니다.`, {
      data: {
        ...slotClickDispatchedEventData(
          slotClickDispatchedAt, config.openAtMs, this.lastArrivalAt,
          this.monoFromRunStartMs(), clockData,
        ),
        slotMinutes: candidate.minutes,
        slotLabel: candidate.label,
        slotTransitionOutcome: "dispatched",
      },
    });

    const postSlotDeadline = serverClock.now() + 5_000;
    const slotTransition = await this.waitForSlotTransition(postSlotDeadline);
    if (slotTransition.kind === "stopped") return this.finishStopped();
    if (slotTransition.kind === "unknown") {
      return this.diagnosticHandOff(`${slotTransition.inspection.label} 화면은 자동 진행하지 않습니다.`, {
        ...postSlotEventData(slotTransition.inspection),
        slotTransitionOutcome: "unknown",
      });
    }
    if (slotTransition.kind === "timed_out") {
      return this.diagnosticHandOff("슬롯 클릭 후 후속 예약 화면을 5초 안에 확인하지 못했습니다.", {
        ...(slotTransition.inspection === null ? {} : postSlotEventData(slotTransition.inspection)),
        slotTransitionOutcome: "timed_out",
      });
    }

    const confirmationData = {
      ...postSlotEventData(slotTransition.inspection),
      slotTransitionOutcome: "confirmed",
    };
    this.transition(
      "SLOT_TRANSITION_CONFIRMED",
      "후속 예약 화면 도착을 확인했습니다. 좌석 확보 여부는 최종 예약 전까지 확정할 수 없습니다.",
      { data: confirmationData },
    );
    if (!config.postSlotEnabled) {
      return this.handOff(
        "후속 예약 화면을 확인했습니다. 후속 자동 진행이 꺼져 있어 사용자에게 인계합니다.",
        confirmationData,
      );
    }
    this.transition("ADVANCING_RESERVATION", "예약 폼까지 선택적 중간 단계를 진행합니다.");
    return this.advancePostSlot(slotTransition.inspection, postSlotDeadline);
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
        return this.handOff("예약 폼에 도착했습니다. 약관 확인과 최종 예약은 직접 진행하세요.", {
          ...postSlotEventData(inspection),
          openDeltaMs: Math.round(formSeenAtMs - config.openAtMs),
          timingServerAtMs: formSeenAtMs,
        });
      }
      if (inspection.kind === "unknown") {
        return this.diagnosticHandOff(`${inspection.label} 화면은 자동 진행하지 않습니다.`, postSlotEventData(inspection));
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
      this.emit("action", action.message, actionData);
      if (action.status === "blocked") {
        return this.diagnosticHandOff(action.message, postSlotEventData(inspection));
      }
      if (!(await this.deps.sleep(30, controller.signal))) break;
    }
    if (controller.signal.aborted) {
      return this.finishStopped();
    }
    return this.diagnosticHandOff(
      "후속 예약 화면을 5초 안에 확인하지 못했습니다.",
      lastInspection === null ? undefined : postSlotEventData(lastInspection),
    );
  }
}

type TimingMark = { actualAt: number; scheduledAt: number; phase: string };
type TogglePlan = ReturnType<typeof nextTogglePlan>;
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

function referenceClockMetricData(
  estimate: ReferenceClockEstimate,
  phase: "bootstrap" | "armed",
  wallOffsetMs: number,
  armLeadMs?: number,
): NonNullable<RunEvent["data"]> {
  return {
    clockPhase: phase,
    // clockOffsetMs: 사이드패널 카운트다운·오프셋 배지·실행 로그 줄 렌더러가
    // 읽는 하위호환 필드명(worklog 08). 반드시 wall-clock 델타(server − Date.now())
    // 여야 한다 — offsetCenterMs(server − monotonic, epoch 스케일)를 넣으면
    // 카운트다운 `Date.now() + offset`이 폭주한다.
    clockOffsetMs: Math.round(wallOffsetMs),
    clockOffsetCenterMs: estimate.offsetCenterMs,
    clockOffsetLowerMs: estimate.offsetLowerMs,
    clockOffsetUpperMs: estimate.offsetUpperMs,
    clockUncertaintyMs: estimate.uncertaintyMs,
    clockConfidence: estimate.confidence,
    clockDominantSupport: estimate.dominantClusterSupport,
    clockCompetingSupport: estimate.competingClusterSupport,
    clockClusterSeparationMs: estimate.clusterSeparationMs,
    clockMedianRttMs: estimate.medianRttMs,
    clockP95RttMs: estimate.p95RttMs,
    clockSampleCount: estimate.sampleCount,
    clockObservationSpanMs: estimate.observationSpanMs,
    clockSource: estimate.source,
    ...(armLeadMs !== undefined ? { clockArmLeadMs: armLeadMs } : {}),
  };
}

interface ToggleCycleTrace {
  cycle: number;
  phase: string;
  adjacentDate: string | null;
  adjacentPlannedAt: number;
  adjacentClickedAt: number | null;
  targetPlannedAt: number;
  targetClickedAt: number | null;
  targetSelectedAt: number | null;
  slotScanCount: number;
  availableSlotCount: number;
  matchedSlotCount: number;
  result: string;
  watch: string;
  arrivalAt: number | null;
  wakeUsed: boolean;
  wakeRequestSequence: number | null;
  wakeCorrelationQuality: string | null;
  wakeFallbackUsed: boolean;
}

function toggleCycleAttributes(t: ToggleCycleTrace): TraceAttributes {
  return {
    cycle: t.cycle,
    phase: t.phase,
    adjacentDate: t.adjacentDate,
    adjacentPlannedAt: t.adjacentPlannedAt,
    adjacentClickedAt: t.adjacentClickedAt,
    adjacentClickOk: t.adjacentClickedAt !== null,
    targetPlannedAt: t.targetPlannedAt,
    targetClickedAt: t.targetClickedAt,
    targetClickOk: t.targetClickedAt !== null,
    targetSelectedAt: t.targetSelectedAt,
    slotScanCount: t.slotScanCount,
    availableSlotCount: t.availableSlotCount,
    matchedSlotCount: t.matchedSlotCount,
    result: t.result,
    watch: t.watch,
    arrivalAt: t.arrivalAt,
    wakeUsed: t.wakeUsed,
    wakeRequestSequence: t.wakeRequestSequence,
    wakeCorrelationQuality: t.wakeCorrelationQuality,
    wakeFallbackUsed: t.wakeFallbackUsed,
  };
}

function targetClickMetricData(targetClickedAt: number, plan: TogglePlan, openAtMs: number): NonNullable<RunEvent["data"]> {
  return {
    timingStage: "target_date_click",
    timingServerAtMs: targetClickedAt,
    openDeltaMs: Math.round(targetClickedAt - openAtMs),
    scheduledServerAtMs: plan.targetClickAtMs,
    scheduleDriftMs: Math.round(targetClickedAt - plan.targetClickAtMs),
    togglePhase: plan.phase,
  };
}

function slotDetectedEventData(
  slotDetectedAt: number,
  adjacent: TimingMark | null,
  target: TimingMark | null,
  openAtMs: number,
  arrivalAt: number | null,
  monoFromRunStartMs: number,
  clockData: NonNullable<RunEvent["data"]>,
): NonNullable<RunEvent["data"]> {
  return {
    timingStage: "slot_detected",
    timingServerAtMs: slotDetectedAt,
    openDeltaMs: Math.round(slotDetectedAt - openAtMs),
    ...(arrivalAt !== null ? {
      xhrArrivalServerAtMs: arrivalAt,
      arrivalToDetectMs: Math.round(slotDetectedAt - arrivalAt),
    } : {}),
    ...(adjacent ? {
      adjacentTimingServerAtMs: adjacent.actualAt,
      adjacentOpenDeltaMs: Math.round(adjacent.actualAt - openAtMs),
      adjacentScheduledServerAtMs: adjacent.scheduledAt,
      adjacentScheduleDriftMs: Math.round(adjacent.actualAt - adjacent.scheduledAt),
      adjacentTogglePhase: adjacent.phase,
    } : {}),
    ...(target ? {
      targetTimingServerAtMs: target.actualAt,
      targetOpenDeltaMs: Math.round(target.actualAt - openAtMs),
      targetScheduledServerAtMs: target.scheduledAt,
      targetScheduleDriftMs: Math.round(target.actualAt - target.scheduledAt),
      targetTogglePhase: target.phase,
    } : {}),
    // frame 1(monotonic run-elapsed) + 감지 시점 기준시계 스냅샷(clockData:
    // confidence/uncertainty/wall offset). openDeltaMs(frame 2 델타) 자체는 이미
    // reference-clock 기반이라 별도 필드로 중복하지 않는다.
    monoFromRunStartMs: Math.round(monoFromRunStartMs),
    ...clockData,
  };
}

function slotClickDispatchedEventData(
  slotClickDispatchedAt: number,
  openAtMs: number,
  arrivalAt: number | null,
  monoFromRunStartMs: number,
  clockData: NonNullable<RunEvent["data"]>,
): NonNullable<RunEvent["data"]> {
  return {
    timingStage: "slot_click_dispatched",
    timingServerAtMs: slotClickDispatchedAt,
    openDeltaMs: Math.round(slotClickDispatchedAt - openAtMs),
    ...(arrivalAt !== null ? { arrivalToClickMs: Math.round(slotClickDispatchedAt - arrivalAt) } : {}),
    monoFromRunStartMs: Math.round(monoFromRunStartMs),
    ...clockData,
  };
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
  ): Promise<RunResult> {
    if (this.activeController) throw new Error("이미 실행 중입니다.");
    const session = new RunSession(this.dependencies, config, requestedRunId, executionContext);
    this.activeController = session.controller;
    try {
      return await session.execute();
    } finally {
      this.activeController = null;
    }
  }
}
