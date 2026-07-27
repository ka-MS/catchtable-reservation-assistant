import type { RunState, StateTransition } from "./types.js";

const TERMINAL = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
]);

const ALLOWED: Record<RunState, RunState[]> = {
  IDLE: ["CONFIGURED", "NAVIGATING"],
  CONFIGURED: ["VALIDATING", "STOPPED", "FAILED"],
  NAVIGATING: ["CONFIGURED", "STOPPED", "FAILED"],
  VALIDATING: ["SYNCING_CLOCK", "HANDED_OFF", "STOPPED", "FAILED"],
  SYNCING_CLOCK: ["ENTERING_RESERVATION", "PREPARING_PAGE", "STOPPED", "FAILED"],
  ENTERING_RESERVATION: ["SELECTING_DATE", "HANDED_OFF", "STOPPED", "TIMED_OUT", "FAILED"],
  SELECTING_DATE: ["SELECTING_PERSON", "HANDED_OFF", "STOPPED", "TIMED_OUT", "FAILED"],
  SELECTING_PERSON: ["PREPARING_PAGE", "HANDED_OFF", "STOPPED", "TIMED_OUT", "FAILED"],
  PREPARING_PAGE: ["WAITING_FOR_OPEN", "HANDED_OFF", "STOPPED", "FAILED"],
  WAITING_FOR_OPEN: ["REFRESHING_SLOTS", "STOPPED", "TIMED_OUT", "FAILED"],
  REFRESHING_SLOTS: ["SLOT_DETECTED", "HANDED_OFF", "STOPPED", "TIMED_OUT", "FAILED"],
  SLOT_DETECTED: ["REFRESHING_SLOTS", "SLOT_CLICK_DISPATCHED", "DRY_RUN_COMPLETED", "STOPPED", "TIMED_OUT", "FAILED"],
  SLOT_CLICK_DISPATCHED: ["SLOT_TRANSITION_CONFIRMED", "HANDED_OFF", "STOPPED", "FAILED"],
  SLOT_TRANSITION_CONFIRMED: ["ADVANCING_RESERVATION", "HANDED_OFF"],
  // Persisted runs may still contain this legacy state, but new runs do not enter it.
  SLOT_SELECTED: ["ADVANCING_RESERVATION", "HANDED_OFF"],
  ADVANCING_RESERVATION: ["COMPLETING_RESERVATION", "HANDED_OFF", "STOPPED", "FAILED"],
  // claim 뒤에는 결제·예약 발생 가능성이 있어 FAILED/STOPPED로 단정하지 않는다(20-design §10~11).
  COMPLETING_RESERVATION: ["COMPLETED", "STOPPED", "TIMED_OUT", "HANDED_OFF", "FAILED"],
  DRY_RUN_COMPLETED: [],
  HANDED_OFF: [],
  COMPLETED: [],
  STOPPED: [],
  TIMED_OUT: [],
  FAILED: [],
};

export class RunStateMachine {
  state: RunState = "IDLE";
  readonly history: StateTransition[] = [];

  constructor(private readonly options: { dryRun: boolean; now: () => number }) {}

  transition(
    to: RunState,
    reason: string,
    options: { error?: string; userStopped?: boolean } = {},
  ): StateTransition {
    if (TERMINAL.has(this.state)) throw new Error(`종료 상태 ${this.state}에서는 전이할 수 없습니다.`);
    if (this.options.dryRun && ["SLOT_CLICK_DISPATCHED", "SLOT_TRANSITION_CONFIRMED", "SLOT_SELECTED"].includes(to)) {
      throw new Error(`dry-run은 ${to}에 진입할 수 없습니다.`);
    }
    if (!ALLOWED[this.state].includes(to)) throw new Error(`허용되지 않는 상태 전이: ${this.state} -> ${to}`);

    const now = this.options.now();
    const previous = this.history.at(-1);
    if (previous) previous.exitedAt = now;
    const transition: StateTransition = {
      from: this.state,
      to,
      enteredAt: now,
      exitedAt: null,
      reason,
      error: options.error,
      userStopped: options.userStopped ?? false,
      dryRun: this.options.dryRun,
    };
    this.history.push(transition);
    this.state = to;
    return transition;
  }
}
