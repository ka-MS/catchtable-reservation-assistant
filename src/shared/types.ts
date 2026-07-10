export type RunState =
  | "IDLE"
  | "CONFIGURED"
  | "VALIDATING"
  | "SYNCING_CLOCK"
  | "PREPARING_PAGE"
  | "WAITING_FOR_OPEN"
  | "REFRESHING_SLOTS"
  | "SLOT_DETECTED"
  | "SLOT_SELECTED"
  | "DRY_RUN_COMPLETED"
  | "HANDED_OFF"
  | "COMPLETED"
  | "STOPPED"
  | "TIMED_OUT"
  | "FAILED";

export interface ReservationConfig {
  targetUrl: string;
  openAtMs: number;
  reservationDate: string;
  personCount: number;
  timeRange: { startMinutes: number; endMinutes: number };
  priorityTimes: number[];
  stopAtMs: number;
  pagePrepared: boolean;
  dryRun: boolean;
  preOpenLeadMs: number;
  toggleIntervalMs: number;
  clockSampleCount: number;
}

export interface StateTransition {
  from: RunState;
  to: RunState;
  enteredAt: number;
  exitedAt: number | null;
  reason: string;
  error?: string;
  userStopped: boolean;
  dryRun: boolean;
}

export interface RunEvent {
  at: number;
  serverAt: number | null;
  runId: string;
  kind: "state" | "action" | "detect" | "error" | "metric";
  message: string;
  data?: Record<string, string | number | boolean>;
}

export interface ActiveRun {
  runId: string;
  tabId: number;
  state: RunState;
  startedAt: number;
  updatedAt: number;
}

export type ContentCommand =
  | { type: "PING" }
  | { type: "START"; config: ReservationConfig }
  | { type: "STOP" };

export type PanelCommand =
  | { type: "PANEL_START"; config: ReservationConfig }
  | { type: "PANEL_STOP" };

export interface RunEventMessage {
  type: "RUN_EVENT";
  event: RunEvent;
}

export interface CommandResponse {
  ok: boolean;
  error?: string;
}
