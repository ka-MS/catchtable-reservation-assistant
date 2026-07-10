import { validateReservationConfig } from "../shared/config.js";
import type { ClockEstimate } from "../shared/clock.js";
import { waitUntil, type Clock, type Sleep } from "../shared/scheduler.js";
import { selectPreferredSlot, type SlotCandidate } from "../shared/slot-selection.js";
import { RunStateMachine } from "../shared/state-machine.js";
import type { ReservationConfig, RunEvent, RunState } from "../shared/types.js";
import type { CalendarInspection } from "./adapter/calendar.js";

interface CalendarPort {
  inspect(targetDate: string): CalendarInspection;
  clickDate(date: string): boolean;
}

interface SlotPort {
  readAvailableSlots(): SlotCandidate[];
  clickSlot(candidate: SlotCandidate): boolean;
}

interface Dependencies {
  clock: Clock;
  syncClock(config: ReservationConfig, signal: AbortSignal): Promise<ClockEstimate>;
  calendar: CalendarPort;
  slots: SlotPort;
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
      });

      transition("PREPARING_PAGE", "예약 모달과 목표 날짜를 확인합니다.");
      const setup = this.dependencies.calendar.inspect(config.reservationDate);
      if (!setup.targetAvailable || !setup.targetSelected || setup.adjacentDate === null) {
        transition("HANDED_OFF", "목표 날짜 선택 또는 인접 가용 날짜를 확인할 수 없습니다. 페이지를 준비한 뒤 새로 시작하세요.");
        return finish();
      }

      const serverClock: Clock = { now: () => this.dependencies.clock.now() + (offsetMs ?? 0) };
      transition("WAITING_FOR_OPEN", "예약 오픈 직전까지 대기합니다.");
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

        const switchDelay = Math.min(50, config.toggleIntervalMs);
        if (!(await this.dependencies.sleep(switchDelay, controller.signal))) {
          transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true });
          return finish();
        }
        if (serverClock.now() >= config.stopAtMs) {
          transition("TIMED_OUT", "감시 종료 시각에 도달했습니다.");
          return finish();
        }
        if (!this.dependencies.calendar.clickDate(config.reservationDate)) {
          transition("HANDED_OFF", "목표 날짜를 다시 선택할 수 없습니다.");
          return finish();
        }

        const detectUntil = Math.min(serverClock.now() + Math.max(0, config.toggleIntervalMs - switchDelay), config.stopAtMs);
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
        transition("HANDED_OFF", "슬롯 선택 이후 단계는 사용자가 직접 진행하세요.");
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
