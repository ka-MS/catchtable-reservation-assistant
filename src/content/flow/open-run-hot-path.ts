import { resolveAvailabilityProbeMode } from "../../shared/config.js";
import { waitUntil } from "../../shared/scheduler.js";
import { MonotonicEpochClock } from "../../shared/monotonic-clock.js";
import { selectPreferredSlot, type SlotCandidate } from "../../shared/slot-selection.js";
import type { ReceivedAvailabilityShadowEvent } from "../../shared/availability-shadow.js";
import { nextTogglePlan } from "../../shared/toggle-schedule.js";
import type { ReservationConfig } from "../../shared/types.js";
import type { PostSlotInspection } from "../adapter/post-slot.js";
import { AvailabilityCorrelationTracker } from "../availability-correlation.js";
import { AvailabilityDomWake, type AvailabilityWakeSignal } from "../availability-dom-wake.js";
import { targetClickMetricData } from "../observation/payloads.js";
import type { RunObserver } from "../observation/run-observer.js";
import type { Dependencies, RunKernel, RunResult } from "../orchestrator.js";

/** 토글 한 사이클의 결과. 핫패스 고유 타입이라 여기서 소유한다. */
export type ToggleCycleOutcome =
  | { kind: "terminal"; result: RunResult }
  | { kind: "retry" }
  | { kind: "slot"; candidate: SlotCandidate };

export type SlotTransitionResult =
  | { kind: "confirmed"; inspection: Exclude<PostSlotInspection, { kind: "waiting" } | { kind: "unknown" }> }
  | { kind: "unknown"; inspection: Extract<PostSlotInspection, { kind: "unknown" }> }
  | { kind: "timed_out"; inspection: PostSlotInspection | null }
  | { kind: "stopped" };

// 핫패스 전용 상수. 값을 바꾸지 않고 소유만 옮겼다(SP-025/03).
const QUIESCE_TIMEOUT_MS = 700;
const ARRIVAL_BURST_MS = 250;
const BODY_WAKE_SCAN_INTERVAL_MS = 10;

type DetectionTiming = { actualAt: number; scheduledAt: number; phase: string } | null;

/**
 * 오픈런 핫패스(SP-025/03) — **날짜 토글로 슬롯을 찾을 때까지**를 소유한다.
 *
 * 25ms·10ms·5ms 간격으로 도는 폴링 구간과 그 구간이 쓰는 상태 전부가 여기
 * 있다. 슬롯을 찾은 뒤의 경로(`advanceFromSlot`·`advancePostSlot`)는
 * 한 번만 실행되고 성격이 달라 `RunSession`에 남는다.
 *
 * shadow 콜백 둘은 이름과 달리 **제어다** — `availabilityWake.offer()`의
 * 반환이 폴링 루프의 wake 신호를 결정하므로 이 클래스가 소유한다.
 *
 * 구현체가 하나뿐인 구체 클래스다. 전략 인터페이스화는 04이며 두 번째
 * 흐름의 실측 근거가 확보되기 전에는 하지 않는다.
 */
export class OpenRunHotPath {
  private toggleCycle = 0;
  private adjacentTiming: DetectionTiming = null;
  private targetTiming: DetectionTiming = null;
  private watchLive = false;
  private lastArrivalAt: number | null = null;
  private adjacentDate: string | null = null;
  private readonly availabilityCorrelation = new AvailabilityCorrelationTracker();
  private readonly availabilityWake = new AvailabilityDomWake();

  constructor(
    private readonly kernel: RunKernel,
    private readonly deps: Dependencies,
    private readonly config: ReservationConfig,
    private readonly controller: AbortController,
    private readonly serverClock: MonotonicEpochClock,
    private readonly observe: RunObserver,
  ) {}

  /**
   * 흐름이 `confirmPageReady`에서 확정한 인접 가용 날짜를 넘긴다.
   *
   * 설계 초안은 생성자 주입이었으나 되돌렸다 — `start()` 훅이
   * `confirmPageReady`보다 **먼저** 돌고, 그 훅이 등록하는 slotWatch 콜백이
   * 이 객체의 `noteArrival()`을 부른다. 생성자 주입으로 두면 핫패스가
   * 늦게 생겨 그 사이 도착 신호가 유실된다(동작 변경).
   */
  armAdjacentDate(date: string): void {
    this.adjacentDate = date;
  }

  /** `advanceFromSlot`이 감지 시각 payload를 만들 때 읽는다. 쓰기는 핫패스만 한다. */
  get detectionTiming(): { adjacent: DetectionTiming; target: DetectionTiming; lastArrivalAt: number | null } {
    return { adjacent: this.adjacentTiming, target: this.targetTiming, lastArrivalAt: this.lastArrivalAt };
  }

  /** 슬롯 감시 콜백이 도착을 알린다(RunSession.start의 slotWatch 등록에서 호출). */
  noteArrival(serverClockReady: boolean): void {
    this.watchLive = true;
    if (serverClockReady) this.lastArrivalAt = this.serverClock.now();
  }

  /** 흐름 cleanup이 부른다. wake 상태를 원복한다. */
  reset(): void {
    this.availabilityWake.reset();
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
  onAvailabilityBody(event: ReceivedAvailabilityShadowEvent): void {
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
  correlateDomCandidate(candidate: SlotCandidate, cycle: number): void {
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

  async runToggleCycle(): Promise<ToggleCycleOutcome> {
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

  async waitForSlotTransition(deadline: number): Promise<SlotTransitionResult> {
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
}
