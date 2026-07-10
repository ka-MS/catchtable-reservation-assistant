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
  IDLE: ["CONFIGURED"],
  CONFIGURED: ["VALIDATING", "STOPPED", "FAILED"],
  VALIDATING: ["SYNCING_CLOCK", "HANDED_OFF", "STOPPED", "FAILED"],
  SYNCING_CLOCK: ["PREPARING_PAGE", "STOPPED", "FAILED"],
  PREPARING_PAGE: ["WAITING_FOR_OPEN", "HANDED_OFF", "STOPPED", "FAILED"],
  WAITING_FOR_OPEN: ["REFRESHING_SLOTS", "STOPPED", "TIMED_OUT", "FAILED"],
  REFRESHING_SLOTS: ["SLOT_DETECTED", "HANDED_OFF", "STOPPED", "TIMED_OUT", "FAILED"],
  SLOT_DETECTED: ["REFRESHING_SLOTS", "SLOT_SELECTED", "DRY_RUN_COMPLETED", "STOPPED", "TIMED_OUT", "FAILED"],
  SLOT_SELECTED: ["ADVANCING_RESERVATION", "HANDED_OFF"],
  ADVANCING_RESERVATION: ["HANDED_OFF", "STOPPED", "FAILED"],
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
    if (this.options.dryRun && to === "SLOT_SELECTED") throw new Error("dry-run은 SLOT_SELECTED에 진입할 수 없습니다.");
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
