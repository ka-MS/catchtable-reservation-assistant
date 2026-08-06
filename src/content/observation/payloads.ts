// 관측 payload 조립 — 순수 함수만 둔다.
//
// SP-025/01에서 `orchestrator.ts`로부터 그대로 옮겼다. 세션 상태에 의존하지
// 않으므로 orchestrator 없이 단위 테스트할 수 있다. 값·키 이름·키 순서는
// 이동 전과 동일해야 하며, `tests/orchestrator-observation.test.mjs`가
// 이를 고정한다.
import type { ReferenceClockEstimate, ReferenceClockSample } from "../../shared/clock.js";
import type { RunEvent } from "../../shared/types.js";
import type { RunExecutionContext, RunState } from "../../shared/types.js";
import type { ReceivedAvailabilityShadowEvent } from "../../shared/availability-shadow.js";
import type { BodyCorrelation, DomCorrelation } from "../availability-correlation.js";
import type { AvailabilityWakeDecision, AvailabilityWakeSignal } from "../availability-dom-wake.js";
import type { PreparationPageContext } from "../preparation-observation.js";
import type { TraceAttributes } from "../../shared/telemetry/types.js";
import type { nextTogglePlan } from "../../shared/toggle-schedule.js";
import type { PostSlotInspection } from "../adapter/post-slot.js";
import type { StageSnapshot } from "../adapter/snapshot.js";

export type TimingMark = { actualAt: number; scheduledAt: number; phase: string };
export type TogglePlan = ReturnType<typeof nextTogglePlan>;

export function postSlotEventData(inspection: PostSlotInspection): NonNullable<RunEvent["data"]> {
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

/** 감지·클릭 시점에 실제로 활성이던 기준시계 스냅샷. */
export function detectionClockData(
  estimate: ReferenceClockEstimate | null,
  wallOffsetMs: number,
): NonNullable<RunEvent["data"]> {
  return {
    clockConfidence: estimate?.confidence ?? "LOW",
    clockUncertaintyMs: Math.round(estimate?.uncertaintyMs ?? 0),
    clockOffsetMs: Math.round(wallOffsetMs),
  };
}

export function referenceClockMetricData(
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

export interface ToggleCycleTrace {
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

export function toggleCycleAttributes(t: ToggleCycleTrace): TraceAttributes {
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

export function targetClickMetricData(targetClickedAt: number, plan: TogglePlan, openAtMs: number): NonNullable<RunEvent["data"]> {
  return {
    timingStage: "target_date_click",
    timingServerAtMs: targetClickedAt,
    openDeltaMs: Math.round(targetClickedAt - openAtMs),
    scheduledServerAtMs: plan.targetClickAtMs,
    scheduleDriftMs: Math.round(targetClickedAt - plan.targetClickAtMs),
    togglePhase: plan.phase,
  };
}

export function slotDetectedEventData(
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

export function slotClickDispatchedEventData(
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

// --- 관측 계층 전용 attribute 빌더 -----------------------------------------
// SP-025/01. `RunObserver`가 인라인으로 들고 있던 리터럴을 순수 함수로
// 승격했다. 스탬핑(serverAt·state)과 예외 경계는 관측 계층이 소유하고,
// 조립은 여기서 한다.

export function preparationAttributes(
  state: RunState,
  phase: string,
  execution: RunExecutionContext | undefined,
  page: PreparationPageContext | null,
  extra: TraceAttributes,
): TraceAttributes {
  return {
    preparationStage: state,
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
    ...extra,
  };
}

export function availabilityBodyAttributes(
  event: ReceivedAvailabilityShadowEvent,
  correlation: BodyCorrelation,
  decision: AvailabilityWakeDecision,
  selectedMinutes: number | null,
  matchesTarget: boolean,
  wakeAtMonoMs: number,
): TraceAttributes {
  return {
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
    selectedMinutes,
    matchesTarget,
    stale: correlation.stale,
    requestSentMonoMs: event.requestSentMonoMs,
    responseCompletedMonoMs: event.responseCompletedMonoMs,
    bodyReadCompletedMonoMs: event.bodyReadCompletedMonoMs,
    payloadClassifiedMonoMs: event.payloadClassifiedMonoMs,
    bridgeReceivedMonoMs: event.bridgeReceivedMonoMs,
    bridgeDelayMs: event.bridgeReceivedMonoMs - event.payloadClassifiedMonoMs,
    wakeAccepted: decision.accepted,
    wakeDiscardReason: decision.discardReason,
    signalKind: decision.signal?.kind ?? null,
    wakeAtMonoMs,
    bodyToWakeMs: wakeAtMonoMs - event.bridgeReceivedMonoMs,
    claimSource: decision.accepted ? "body" : "none",
    claimAgreement: decision.accepted ? true : null,
  };
}

export function domCorrelationAttributes(
  correlation: DomCorrelation,
  phase: "dom_compare" | "dom_compare_late",
): TraceAttributes {
  return {
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
  };
}

export function wakeResultAttributes(
  signal: Extract<AvailabilityWakeSignal, { kind: "scan_wake" }>,
  candidateObservedMonoMs: number | null,
  candidateFound: boolean,
  fallbackUsed: boolean,
  scanCount: number,
  baselineNextScanAtMonoMs: number | null,
  wakeScanAtMonoMs: number | null,
): TraceAttributes {
  return {
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
  };
}

export function emptyExitAttributes(
  signal: Extract<AvailabilityWakeSignal, { kind: "empty_exit" }>,
  targetStillSelected: boolean,
  finalDomCandidateFound: boolean,
  exitAtMonoMs: number,
): TraceAttributes {
  return {
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
    emptyEarlyExitApplied: targetStillSelected && !finalDomCandidateFound,
  };
}

export function clockSampleAttributes(
  sample: ReferenceClockSample,
  index: number,
  total: number,
  freezeReason: "armed" | "terminal",
): TraceAttributes {
  return {
    clockSampleIndex: index + 1,
    clockSampleTotal: total,
    clockSampleFreezeReason: freezeReason,
    clockSampleT0MonoMs: sample.t0,
    clockSampleT1MonoMs: sample.t1,
    clockSampleServerDateMs: sample.serverDateMs,
    clockSampleRttMs: sample.rttMs,
    clockSampleOffsetLowerMs: sample.lowerMs,
    clockSampleOffsetCenterMs: (sample.lowerMs + sample.upperMs) / 2,
    clockSampleOffsetUpperMs: sample.upperMs,
    clockSampleFromCache: sample.fromCache,
  };
}
