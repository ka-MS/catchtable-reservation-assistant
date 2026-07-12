import { validateReservationConfig } from "../shared/config.js";
import { finalClockSyncAt, type ClockEstimate } from "../shared/clock.js";
import { waitUntil, type Clock, type Sleep } from "../shared/scheduler.js";
import { MonotonicEpochClock } from "../shared/monotonic-clock.js";
import { selectPreferredSlot, type SlotCandidate } from "../shared/slot-selection.js";
import { RunStateMachine } from "../shared/state-machine.js";
import { nextTogglePlan } from "../shared/toggle-schedule.js";
import type { ReservationConfig, RunEvent, RunState } from "../shared/types.js";
import type { TraceCode } from "../shared/telemetry/codes.js";
import type { TraceAttributes, TraceSeverity } from "../shared/telemetry/types.js";
import type { CalendarInspection, CalendarPreparationResult } from "./adapter/calendar.js";
import type { EntryInspection } from "./adapter/entry.js";
import type { PersonInspection } from "./adapter/person.js";
import type { PostSlotActionResult, PostSlotInspection } from "./adapter/post-slot.js";

interface CalendarPort {
  inspect(targetDate: string): CalendarInspection;
  prepareTarget(targetDate: string): CalendarPreparationResult;
  clickDate(date: string): boolean;
}

interface EntryPort {
  inspect(): EntryInspection;
  openReservation(): boolean;
  dismissPromo?(): boolean;
}

interface PersonPort {
  inspect(personCount: number): PersonInspection;
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

interface Dependencies {
  clock: Clock;
  monotonicClock: Clock;
  syncClock(config: ReservationConfig, signal: AbortSignal): Promise<ClockEstimate>;
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
  runId(): string;
}

export interface RunResult {
  runId: string;
  state: RunState;
}

const TERMINAL = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
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

export class OpenRunOrchestrator {
  private activeController: AbortController | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  stop(): void {
    this.activeController?.abort();
  }

  async start(config: ReservationConfig, requestedRunId?: string): Promise<RunResult> {
    if (this.activeController) throw new Error("이미 실행 중입니다.");
    const controller = new AbortController();
    this.activeController = controller;
    const runId = requestedRunId ?? this.dependencies.runId();
    const machine = new RunStateMachine({ dryRun: config.dryRun, now: () => this.dependencies.clock.now() });
    let offsetMs: number | null = null;
    const serverClock = new MonotonicEpochClock(this.dependencies.monotonicClock);
    let serverClockReady = false;
    let adjacentTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
    let targetTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
    let toggleCycle = 0;

    const emit = (kind: RunEvent["kind"], message: string, data?: RunEvent["data"]) => {
      const at = this.dependencies.clock.now();
      this.dependencies.emit({ at, serverAt: serverClockReady ? serverClock.now() : null, runId, kind, message, data });
    };
    const transition = (
      state: RunState,
      reason: string,
      extra: { error?: string; userStopped?: boolean; data?: RunEvent["data"] } = {},
    ) => {
      machine.transition(state, reason, { error: extra.error, userStopped: extra.userStopped });
      emit("state", reason, { state, ...extra.data });
    };
    const finish = (): RunResult => ({ runId, state: machine.state });
    const stopOrTimeout = (result: "ready" | "timed_out" | "stopped"): RunResult | null => {
      if (result === "timed_out") {
        transition("TIMED_OUT", "감시 종료 시각에 도달했습니다.");
        return finish();
      }
      if (result === "stopped") {
        transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
        return finish();
      }
      return null;
    };

    try {
      transition("CONFIGURED", "예약 설정을 불러왔습니다.");
      transition("VALIDATING", "예약 설정과 실행 조건을 검증합니다.");
      const errors = validateReservationConfig(config, this.dependencies.clock.now());
      if (errors.length > 0) {
        transition("FAILED", errors.join(" "), { error: errors.join(" | ") });
        return finish();
      }

      transition("SYNCING_CLOCK", "캐치테이블 서버 시계를 측정합니다.");
      const estimate = await this.dependencies.syncClock(config, controller.signal);
      if (controller.signal.aborted) {
        transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
        return finish();
      }
      offsetMs = estimate.offsetMs;
      serverClock.anchor(this.dependencies.clock.now() + offsetMs);
      serverClockReady = true;
      emit("metric", estimate.fallback ? "서버 시계 측정 실패로 로컬 시계를 사용합니다." : "서버 시계 보정을 완료했습니다.", {
        clockOffsetMs: estimate.offsetMs,
        clockSamples: estimate.sampleCount,
        clockSpreadMs: estimate.spreadMs ?? -1,
        clockFallback: estimate.fallback,
        clockMethod: estimate.method,
        clockPrecisionMs: estimate.precisionMs ?? -1,
        clockPhase: "initial",
      });

      if (config.entryMode === "auto") {
        transition("ENTERING_RESERVATION", "예약창 진입 상태를 확인합니다.");
        const entryDeadline = Math.min(serverClock.now() + 5_000, config.stopAtMs);
        let entryClicked = false;
        while (true) {
          if (controller.signal.aborted) {
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
          if (serverClock.now() >= config.stopAtMs) {
            transition("TIMED_OUT", "예약 페이지 준비 중 감시 종료 시각에 도달했습니다.");
            return finish();
          }
          const entry = this.dependencies.entry.inspect();
          if (entry.reservationOpen) break;
          if (entry.waitingOnly) {
            transition("HANDED_OFF", "이 식당은 현장 웨이팅만 가능해 예약창을 열 수 없습니다.");
            return finish();
          }
          if (!entryClicked && entry.ctaAvailable && this.dependencies.entry.openReservation()) {
            entryClicked = true;
            emit("action", "예약하기 버튼을 클릭했습니다.");
          } else if (this.dependencies.entry.dismissPromo?.()) {
            // 홍보 인터스티셜이 예약하기 클릭을 삼키므로 닫은 뒤 다시 클릭한다.
            entryClicked = false;
            emit("action", "매장 홍보 안내 창을 닫았습니다.");
          }
          if (serverClock.now() >= entryDeadline) {
            transition("HANDED_OFF", entryClicked
              ? "예약하기 클릭 후 달력 화면을 확인할 수 없습니다."
              : "식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.");
            return finish();
          }
          if (!(await this.dependencies.sleep(50, controller.signal))) {
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
        }

        transition("SELECTING_DATE", "목표 월과 예약 날짜를 준비합니다.");
        const dateDeadline = Math.min(serverClock.now() + 10_000, config.stopAtMs);
        while (true) {
          if (controller.signal.aborted) {
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
          if (serverClock.now() >= config.stopAtMs) {
            transition("TIMED_OUT", "예약 날짜 준비 중 감시 종료 시각에 도달했습니다.");
            return finish();
          }
          const preparation = this.dependencies.calendar.prepareTarget(config.reservationDate);
          if (preparation.status === "ready") break;
          if (preparation.status === "blocked") {
            transition("HANDED_OFF", preparation.message);
            return finish();
          }
          if (preparation.status === "acted") emit("action", preparation.message);
          if (serverClock.now() >= dateDeadline) {
            transition("HANDED_OFF", "목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.");
            return finish();
          }
          if (!(await this.dependencies.sleep(50, controller.signal))) {
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
        }

        transition("SELECTING_PERSON", "예약 인원을 준비합니다.");
        const personDeadline = Math.min(serverClock.now() + 3_000, config.stopAtMs);
        let personClicked = false;
        while (true) {
          if (controller.signal.aborted) {
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
          if (serverClock.now() >= config.stopAtMs) {
            transition("TIMED_OUT", "예약 인원 준비 중 감시 종료 시각에 도달했습니다.");
            return finish();
          }
          const person = this.dependencies.person.inspect(config.personCount);
          if (person.targetSelected) break;
          if (person.ready && !person.targetAvailable) {
            transition("HANDED_OFF", `이 식당에서 ${config.personCount}명을 선택할 수 없습니다.`);
            return finish();
          }
          if (!personClicked && person.targetAvailable && this.dependencies.person.select(config.personCount)) {
            personClicked = true;
            emit("action", `${config.personCount}명으로 설정했습니다.`);
          }
          if (serverClock.now() >= personDeadline) {
            transition("HANDED_OFF", "예약 인원 선택 상태를 제한 시간 안에 확인할 수 없습니다.");
            return finish();
          }
          if (!(await this.dependencies.sleep(50, controller.signal))) {
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
        }
      }

      transition("PREPARING_PAGE", "예약 모달과 목표 날짜를 확인합니다.");
      const setup = this.dependencies.calendar.inspect(config.reservationDate);
      if (!setup.targetAvailable || !setup.targetSelected || setup.adjacentDate === null) {
        transition("HANDED_OFF", "목표 날짜 선택 또는 인접 가용 날짜를 확인할 수 없습니다. 페이지를 준비한 뒤 새로 시작하세요.");
        return finish();
      }

      transition("WAITING_FOR_OPEN", "예약 오픈 직전까지 대기합니다.");
      const finalSyncAt = finalClockSyncAt(config.openAtMs, config.preOpenLeadMs);
      if (serverClock.now() < finalSyncAt) {
        const finalSyncWait = await waitUntil(finalSyncAt, {
          clock: serverClock,
          stopAtMs: config.stopAtMs,
          signal: controller.signal,
          sleep: this.dependencies.sleep,
        });
        const finalSyncExit = stopOrTimeout(finalSyncWait);
        if (finalSyncExit) return finalSyncExit;
        const finalEstimate = await this.dependencies.syncClock(config, controller.signal);
        if (controller.signal.aborted) {
          transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
          return finish();
        }
        if (!finalEstimate.fallback) {
          offsetMs = finalEstimate.offsetMs;
          serverClock.anchor(this.dependencies.clock.now() + offsetMs);
        }
        emit("metric", finalEstimate.fallback ? "오픈 직전 시계 재측정에 실패해 기존 기준을 유지합니다." : "오픈 직전 서버 시계를 다시 보정했습니다.", {
          clockOffsetMs: offsetMs ?? 0,
          clockSamples: finalEstimate.sampleCount,
          clockSpreadMs: finalEstimate.spreadMs ?? -1,
          clockFallback: finalEstimate.fallback,
          clockMethod: finalEstimate.method,
          clockPrecisionMs: finalEstimate.precisionMs ?? -1,
          clockPhase: "final",
        });
      }
      const waitResult = await waitUntil(config.openAtMs - config.preOpenLeadMs, {
        clock: serverClock,
        stopAtMs: config.stopAtMs,
        signal: controller.signal,
        sleep: this.dependencies.sleep,
      });
      const waitingExit = stopOrTimeout(waitResult);
      if (waitingExit) return waitingExit;

      transition("REFRESHING_SLOTS", "날짜 토글로 예약 슬롯을 갱신합니다.");
      while (!controller.signal.aborted) {
        if (serverClock.now() >= config.stopAtMs) {
          transition("TIMED_OUT", "감시 종료 시각에 도달했습니다.");
          return finish();
        }

        const plan = nextTogglePlan(serverClock.now(), config.openAtMs, config.toggleIntervalMs);
        const cycle = ++toggleCycle;
        let adjacentClickedAt: number | null = null;
        let targetClickedAt: number | null = null;
        let targetSelectedAt: number | null = null;
        let slotScanCount = 0;
        let availableSlotCount = 0;
        let matchedSlotCount = 0;
        let adjacentDateValue: string | null = setup.adjacentDate;
        const traceCycle = (result: string) => this.dependencies.trace?.(
          "DATE_TOGGLE_CYCLE",
          result === "NO_SLOT" || result === "SLOT_FOUND" ? "trace" : "warn",
          `날짜 토글 #${cycle}: ${result}`,
          {
            serverAt: serverClock.now(),
            state: "REFRESHING_SLOTS",
            attributes: {
              cycle,
              phase: plan.phase,
              adjacentDate: adjacentDateValue,
              adjacentPlannedAt: plan.adjacentClickAtMs,
              adjacentClickedAt,
              adjacentClickOk: adjacentClickedAt !== null,
              targetPlannedAt: plan.targetClickAtMs,
              targetClickedAt,
              targetClickOk: targetClickedAt !== null,
              targetSelectedAt,
              slotScanCount,
              availableSlotCount,
              matchedSlotCount,
              result,
            },
          },
        );
        const adjacentWait = await waitUntil(plan.adjacentClickAtMs, {
          clock: serverClock,
          stopAtMs: config.stopAtMs,
          signal: controller.signal,
          sleep: this.dependencies.sleep,
          tickMs: 10,
        });
        if (adjacentWait !== "ready") traceCycle(adjacentWait === "stopped" ? "STOPPED_BEFORE_ADJACENT" : "TIMED_OUT_BEFORE_ADJACENT");
        const adjacentWaitExit = stopOrTimeout(adjacentWait);
        if (adjacentWaitExit) return adjacentWaitExit;

        const currentSetup = this.dependencies.calendar.inspect(config.reservationDate);
        const adjacentDate = currentSetup.adjacentDate;
        adjacentDateValue = adjacentDate;
        if (!currentSetup.targetAvailable || adjacentDate === null) {
          traceCycle("SETUP_INVALID");
          transition("HANDED_OFF", "달력 상태가 바뀌어 안전하게 슬롯을 갱신할 수 없습니다.");
          return finish();
        }
        if (!this.dependencies.calendar.clickDate(adjacentDate)) {
          traceCycle("ADJACENT_CLICK_FAILED");
          transition("HANDED_OFF", "인접 날짜를 선택할 수 없습니다.");
          return finish();
        }
        adjacentClickedAt = serverClock.now();
        adjacentTiming = {
          actualAt: adjacentClickedAt,
          scheduledAt: plan.adjacentClickAtMs,
          phase: plan.phase,
        };
        const targetWait = await waitUntil(plan.targetClickAtMs, {
          clock: serverClock,
          stopAtMs: config.stopAtMs,
          signal: controller.signal,
          sleep: this.dependencies.sleep,
          tickMs: 5,
        });
        if (targetWait !== "ready") traceCycle(targetWait === "stopped" ? "STOPPED_BEFORE_TARGET" : "TIMED_OUT_BEFORE_TARGET");
        const targetWaitExit = stopOrTimeout(targetWait);
        if (targetWaitExit) return targetWaitExit;
        if (!this.dependencies.calendar.clickDate(config.reservationDate)) {
          traceCycle("TARGET_CLICK_FAILED");
          transition("HANDED_OFF", "목표 날짜를 다시 선택할 수 없습니다.");
          return finish();
        }
        targetClickedAt = serverClock.now();
        targetTiming = {
          actualAt: targetClickedAt,
          scheduledAt: plan.targetClickAtMs,
          phase: plan.phase,
        };
        if (plan.targetClickAtMs === config.openAtMs) {
          emit("metric", "예약 오픈 정각에 목표 날짜를 클릭했습니다.", {
            timingStage: "target_date_click",
            timingServerAtMs: targetClickedAt,
            openDeltaMs: Math.round(targetClickedAt - config.openAtMs),
            scheduledServerAtMs: plan.targetClickAtMs,
            scheduleDriftMs: Math.round(targetClickedAt - plan.targetClickAtMs),
            togglePhase: plan.phase,
          });
        }

        if (!(await this.dependencies.sleep(20, controller.signal))) {
          traceCycle("STOPPED_AFTER_TARGET");
          transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
          return finish();
        }
        if (serverClock.now() >= config.stopAtMs) {
          traceCycle("TIMED_OUT_AFTER_TARGET");
          transition("TIMED_OUT", "감시 종료 시각에 도달했습니다.");
          return finish();
        }
        const selectionDeadline = Math.min(plan.targetClickAtMs + 60, config.stopAtMs);
        while (
          !this.dependencies.calendar.inspect(config.reservationDate).targetSelected
          && serverClock.now() < selectionDeadline
        ) {
          if (!(await this.dependencies.sleep(Math.min(10, selectionDeadline - serverClock.now()), controller.signal))) {
            traceCycle("STOPPED_DURING_SELECTION");
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
        }
        if (!this.dependencies.calendar.inspect(config.reservationDate).targetSelected) {
          traceCycle("SELECTION_UNCONFIRMED");
          transition("HANDED_OFF", "목표 날짜 선택 상태를 확인할 수 없습니다.");
          return finish();
        }
        targetSelectedAt = serverClock.now();

        const nextPlan = nextTogglePlan(serverClock.now(), config.openAtMs, config.toggleIntervalMs);
        const detectUntil = Math.min(
          nextPlan.adjacentClickAtMs,
          config.stopAtMs,
        );
        let candidate: SlotCandidate | null = null;
        const inspectSlots = () => {
          const slots = this.dependencies.slots.readAvailableSlots();
          slotScanCount += 1;
          availableSlotCount = slots.length;
          matchedSlotCount = slots.filter((slot) => (
            slot.minutes >= config.timeRange.startMinutes && slot.minutes <= config.timeRange.endMinutes
          )).length;
          return selectPreferredSlot(slots, config.timeRange, config.priorityTimes);
        };
        while (!controller.signal.aborted && serverClock.now() < detectUntil) {
          candidate = inspectSlots();
          if (candidate) break;
          const delay = Math.min(25, detectUntil - serverClock.now());
          if (delay <= 0 || !(await this.dependencies.sleep(delay, controller.signal))) break;
        }
        candidate ??= inspectSlots();
        if (!candidate) {
          traceCycle("NO_SLOT");
          continue;
        }
        traceCycle("SLOT_FOUND");

        const slotDetectedAt = serverClock.now();
        transition("SLOT_DETECTED", `${candidate.label} 슬롯을 감지했습니다.`, {
          data: {
            timingStage: "slot_detected",
            timingServerAtMs: slotDetectedAt,
            openDeltaMs: Math.round(slotDetectedAt - config.openAtMs),
            ...(adjacentTiming ? {
              adjacentTimingServerAtMs: adjacentTiming.actualAt,
              adjacentOpenDeltaMs: Math.round(adjacentTiming.actualAt - config.openAtMs),
              adjacentScheduledServerAtMs: adjacentTiming.scheduledAt,
              adjacentScheduleDriftMs: Math.round(adjacentTiming.actualAt - adjacentTiming.scheduledAt),
              adjacentTogglePhase: adjacentTiming.phase,
            } : {}),
            ...(targetTiming ? {
              targetTimingServerAtMs: targetTiming.actualAt,
              targetOpenDeltaMs: Math.round(targetTiming.actualAt - config.openAtMs),
              targetScheduledServerAtMs: targetTiming.scheduledAt,
              targetScheduleDriftMs: Math.round(targetTiming.actualAt - targetTiming.scheduledAt),
              targetTogglePhase: targetTiming.phase,
            } : {}),
          },
        });
        emit("detect", "예약 조건과 일치하는 슬롯을 찾았습니다.", { slotMinutes: candidate.minutes, slotLabel: candidate.label });
        if (config.dryRun) {
          transition("DRY_RUN_COMPLETED", "dry-run이므로 슬롯을 클릭하지 않았습니다.");
          return finish();
        }
        if (serverClock.now() >= config.stopAtMs) {
          transition("TIMED_OUT", "클릭 직전 감시 종료 시각에 도달했습니다.");
          return finish();
        }
        if (!this.dependencies.slots.clickSlot(candidate)) {
          this.dependencies.trace?.("SLOT_CLICKED", "warn", `${candidate.label} 슬롯 클릭에 실패했습니다.`, {
            serverAt: serverClock.now(),
            state: "SLOT_DETECTED",
            attributes: { slotMinutes: candidate.minutes, slotLabel: candidate.label, clickOk: false },
          });
          transition("REFRESHING_SLOTS", "슬롯이 사라져 날짜 토글을 재개합니다.");
          continue;
        }
        const slotSelectedAt = serverClock.now();
        this.dependencies.trace?.("SLOT_CLICKED", "info", `${candidate.label} 슬롯을 클릭했습니다.`, {
          serverAt: slotSelectedAt,
          state: "SLOT_SELECTED",
          attributes: { slotMinutes: candidate.minutes, slotLabel: candidate.label, clickOk: true },
        });
        transition("SLOT_SELECTED", `${candidate.label} 시간 선택을 완료했습니다.`, {
          data: {
            timingStage: "slot_selected",
            timingServerAtMs: slotSelectedAt,
            openDeltaMs: Math.round(slotSelectedAt - config.openAtMs),
          },
        });
        if (!config.postSlotEnabled) {
          transition("HANDED_OFF", "후속 선택 자동 진행이 꺼져 있어 슬롯 선택까지만 완료했습니다.");
          return finish();
        }
        transition("ADVANCING_RESERVATION", "예약 폼까지 선택적 중간 단계를 진행합니다.");
        let postSlotDeadline = serverClock.now() + 5_000;
        // 홍보 안내 창은 폼 도착 뒤 비결정적으로 늦게 렌더되므로 잠시 머물며 닫을 기회를 준다.
        const formNoticeGraceMs = 1_500;
        let formSeenAtMs: number | null = null;
        let formNoticeDismissed = false;
        let lastInspection: PostSlotInspection | null = null;
        while (!controller.signal.aborted && serverClock.now() < postSlotDeadline) {
          const inspection = this.dependencies.postSlot.inspect();
          lastInspection = inspection;
          if (inspection.kind === "form") {
            if (formSeenAtMs === null) {
              formSeenAtMs = serverClock.now();
              postSlotDeadline = Math.max(postSlotDeadline, formSeenAtMs + formNoticeGraceMs);
            }
            if (!formNoticeDismissed && serverClock.now() - formSeenAtMs < formNoticeGraceMs) {
              if (!(await this.dependencies.sleep(20, controller.signal))) break;
              continue;
            }
            transition("HANDED_OFF", "예약 폼에 도착했습니다. 약관 확인과 최종 예약은 직접 진행하세요.", {
              data: {
                ...postSlotEventData(inspection),
                openDeltaMs: Math.round(formSeenAtMs - config.openAtMs),
                timingServerAtMs: formSeenAtMs,
              },
            });
            return finish();
          }
          if (inspection.kind === "unknown") {
            transition("HANDED_OFF", `${inspection.label} 화면은 자동 진행하지 않습니다.`, {
              data: postSlotEventData(inspection),
            });
            return finish();
          }
          if (inspection.kind === "waiting") {
            if (!(await this.dependencies.sleep(20, controller.signal))) break;
            continue;
          }

          const action = this.dependencies.postSlot.advance(inspection, config);
          if (action.status === "waiting") {
            if (!(await this.dependencies.sleep(20, controller.signal))) break;
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
          emit("action", action.message, actionData);
          if (action.status === "blocked") {
            transition("HANDED_OFF", action.message);
            return finish();
          }
          if (!(await this.dependencies.sleep(30, controller.signal))) break;
        }
        if (controller.signal.aborted) {
          transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
          return finish();
        }
        transition("HANDED_OFF", "후속 예약 화면을 5초 안에 확인하지 못했습니다.", lastInspection === null ? {} : {
          data: postSlotEventData(lastInspection),
        });
        return finish();
      }

      transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
      return finish();
    } catch (error) {
      if (!TERMINAL.has(machine.state)) {
        const message = error instanceof Error ? error.message : "알 수 없는 실행 오류";
        this.dependencies.trace?.("RUN_FAILED", "error", message, {
          serverAt: serverClockReady ? serverClock.now() : null,
          state: "FAILED",
          error,
        });
        transition("FAILED", message, { error: message });
      }
      return finish();
    } finally {
      await this.dependencies.flushTrace?.().catch(() => undefined);
      this.activeController = null;
    }
  }
}
