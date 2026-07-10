import { validateReservationConfig } from "../shared/config.js";
import type { ClockEstimate } from "../shared/clock.js";
import { waitUntil, type Clock, type Sleep } from "../shared/scheduler.js";
import { selectPreferredSlot, type SlotCandidate } from "../shared/slot-selection.js";
import { RunStateMachine } from "../shared/state-machine.js";
import { nextTogglePlan } from "../shared/toggle-schedule.js";
import type { ReservationConfig, RunEvent, RunState } from "../shared/types.js";
import type { CalendarInspection } from "./adapter/calendar.js";
import type { PostSlotActionResult, PostSlotInspection } from "./adapter/post-slot.js";

interface CalendarPort {
  inspect(targetDate: string): CalendarInspection;
  clickDate(date: string): boolean;
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
  syncClock(config: ReservationConfig, signal: AbortSignal): Promise<ClockEstimate>;
  calendar: CalendarPort;
  slots: SlotPort;
  postSlot: PostSlotPort;
  sleep: Sleep;
  emit(event: RunEvent): void;
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

export class OpenRunOrchestrator {
  private activeController: AbortController | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  stop(): void {
    this.activeController?.abort();
  }

  async start(config: ReservationConfig): Promise<RunResult> {
    if (this.activeController) throw new Error("이미 실행 중입니다.");
    const controller = new AbortController();
    this.activeController = controller;
    const runId = this.dependencies.runId();
    const machine = new RunStateMachine({ dryRun: config.dryRun, now: () => this.dependencies.clock.now() });
    let offsetMs: number | null = null;

    const emit = (kind: RunEvent["kind"], message: string, data?: RunEvent["data"]) => {
      const at = this.dependencies.clock.now();
      this.dependencies.emit({ at, serverAt: offsetMs === null ? null : at + offsetMs, runId, kind, message, data });
    };
    const transition = (state: RunState, reason: string, extra: { error?: string; userStopped?: boolean } = {}) => {
      machine.transition(state, reason, extra);
      emit("state", reason, { state });
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
      emit("metric", estimate.fallback ? "서버 시계 측정 실패로 로컬 시계를 사용합니다." : "서버 시계 보정을 완료했습니다.", {
        clockOffsetMs: estimate.offsetMs,
        clockSamples: estimate.sampleCount,
        clockSpreadMs: estimate.spreadMs ?? -1,
        clockFallback: estimate.fallback,
        clockMethod: estimate.method,
        clockPrecisionMs: estimate.precisionMs ?? -1,
        clockPhase: "initial",
      });

      transition("PREPARING_PAGE", "예약 모달과 목표 날짜를 확인합니다.");
      const setup = this.dependencies.calendar.inspect(config.reservationDate);
      if (!setup.targetAvailable || !setup.targetSelected || setup.adjacentDate === null) {
        transition("HANDED_OFF", "목표 날짜 선택 또는 인접 가용 날짜를 확인할 수 없습니다. 페이지를 준비한 뒤 새로 시작하세요.");
        return finish();
      }

      const serverClock: Clock = { now: () => this.dependencies.clock.now() + (offsetMs ?? 0) };
      transition("WAITING_FOR_OPEN", "예약 오픈 직전까지 대기합니다.");
      const finalSyncAt = config.openAtMs - config.preOpenLeadMs - 2_000;
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
        if (!finalEstimate.fallback) offsetMs = finalEstimate.offsetMs;
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
        const adjacentWait = await waitUntil(plan.adjacentClickAtMs, {
          clock: serverClock,
          stopAtMs: config.stopAtMs,
          signal: controller.signal,
          sleep: this.dependencies.sleep,
          tickMs: 10,
        });
        const adjacentWaitExit = stopOrTimeout(adjacentWait);
        if (adjacentWaitExit) return adjacentWaitExit;

        const currentSetup = this.dependencies.calendar.inspect(config.reservationDate);
        const adjacentDate = currentSetup.adjacentDate;
        if (!currentSetup.targetAvailable || adjacentDate === null) {
          transition("HANDED_OFF", "달력 상태가 바뀌어 안전하게 슬롯을 갱신할 수 없습니다.");
          return finish();
        }
        if (!this.dependencies.calendar.clickDate(adjacentDate)) {
          transition("HANDED_OFF", "인접 날짜를 선택할 수 없습니다.");
          return finish();
        }
        const targetWait = await waitUntil(plan.targetClickAtMs, {
          clock: serverClock,
          stopAtMs: config.stopAtMs,
          signal: controller.signal,
          sleep: this.dependencies.sleep,
          tickMs: 5,
        });
        const targetWaitExit = stopOrTimeout(targetWait);
        if (targetWaitExit) return targetWaitExit;
        if (!this.dependencies.calendar.clickDate(config.reservationDate)) {
          transition("HANDED_OFF", "목표 날짜를 다시 선택할 수 없습니다.");
          return finish();
        }
        const targetClickedAt = serverClock.now();
        if (plan.targetClickAtMs === config.openAtMs) {
          emit("metric", "예약 오픈 정각에 목표 날짜를 클릭했습니다.", {
            targetClickAtMs: targetClickedAt,
            targetScheduleDriftMs: targetClickedAt - plan.targetClickAtMs,
          });
        }

        if (!(await this.dependencies.sleep(20, controller.signal))) {
          transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
          return finish();
        }
        if (serverClock.now() >= config.stopAtMs) {
          transition("TIMED_OUT", "감시 종료 시각에 도달했습니다.");
          return finish();
        }
        const selectionDeadline = Math.min(plan.targetClickAtMs + 60, config.stopAtMs);
        while (
          !this.dependencies.calendar.inspect(config.reservationDate).targetSelected
          && serverClock.now() < selectionDeadline
        ) {
          if (!(await this.dependencies.sleep(Math.min(10, selectionDeadline - serverClock.now()), controller.signal))) {
            transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
            return finish();
          }
        }
        if (!this.dependencies.calendar.inspect(config.reservationDate).targetSelected) {
          transition("HANDED_OFF", "목표 날짜 선택 상태를 확인할 수 없습니다.");
          return finish();
        }

        const nextPlan = nextTogglePlan(serverClock.now(), config.openAtMs, config.toggleIntervalMs);
        const detectUntil = Math.min(
          nextPlan.adjacentClickAtMs,
          config.stopAtMs,
        );
        let candidate: SlotCandidate | null = null;
        while (!controller.signal.aborted && serverClock.now() < detectUntil) {
          candidate = selectPreferredSlot(
            this.dependencies.slots.readAvailableSlots(),
            config.timeRange,
            config.priorityTimes,
          );
          if (candidate) break;
          const delay = Math.min(25, detectUntil - serverClock.now());
          if (delay <= 0 || !(await this.dependencies.sleep(delay, controller.signal))) break;
        }
        candidate ??= selectPreferredSlot(
          this.dependencies.slots.readAvailableSlots(),
          config.timeRange,
          config.priorityTimes,
        );
        if (!candidate) continue;

        transition("SLOT_DETECTED", `${candidate.label} 슬롯을 감지했습니다.`);
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
          transition("REFRESHING_SLOTS", "슬롯이 사라져 날짜 토글을 재개합니다.");
          continue;
        }
        transition("SLOT_SELECTED", `${candidate.label} 슬롯을 한 번 클릭했습니다.`);
        if (!config.postSlotEnabled) {
          transition("HANDED_OFF", "후속 선택 자동 진행이 꺼져 있어 슬롯 선택까지만 완료했습니다.");
          return finish();
        }
        transition("ADVANCING_RESERVATION", "예약 폼까지 선택적 중간 단계를 진행합니다.");
        const postSlotDeadline = serverClock.now() + 5_000;
        while (!controller.signal.aborted && serverClock.now() < postSlotDeadline) {
          const inspection = this.dependencies.postSlot.inspect();
          if (inspection.kind === "form") {
            transition("HANDED_OFF", "예약 폼에 도착했습니다. 약관 확인과 최종 예약은 직접 진행하세요.");
            return finish();
          }
          if (inspection.kind === "unknown") {
            transition("HANDED_OFF", `${inspection.label} 화면은 자동 진행하지 않습니다.`);
            return finish();
          }
          if (inspection.kind === "waiting") {
            if (!(await this.dependencies.sleep(20, controller.signal))) break;
            continue;
          }

          const action = this.dependencies.postSlot.advance(inspection, config);
          const actionData: NonNullable<RunEvent["data"]> = {
            postSlotStage: inspection.kind,
            postSlotStatus: action.status,
          };
          if (inspection.kind === "menu" && action.completed) {
            actionData.openDeltaMs = Math.round(serverClock.now() - config.openAtMs);
          }
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
        transition("HANDED_OFF", "후속 예약 화면을 5초 안에 확인하지 못했습니다.");
        return finish();
      }

      transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
      return finish();
    } catch (error) {
      if (!TERMINAL.has(machine.state)) {
        const message = error instanceof Error ? error.message : "알 수 없는 실행 오류";
        transition("FAILED", message, { error: message });
      }
      return finish();
    } finally {
      this.activeController = null;
    }
  }
}
