// 관측 payload 조립 — 순수 함수만 둔다.
//
// SP-025/01에서 `orchestrator.ts`로부터 그대로 옮겼다. 세션 상태에 의존하지
// 않으므로 orchestrator 없이 단위 테스트할 수 있다. 값·키 이름·키 순서는
// 이동 전과 동일해야 하며, `tests/orchestrator-observation.test.mjs`가
// 이를 고정한다.
import type { ReferenceClockEstimate } from "../../shared/clock.js";
import type { RunEvent } from "../../shared/types.js";
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
