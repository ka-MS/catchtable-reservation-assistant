export type RunState =
  | "IDLE"
  | "CONFIGURED"
  | "NAVIGATING"
  | "VALIDATING"
  | "SYNCING_CLOCK"
  | "ENTERING_RESERVATION"
  | "SELECTING_DATE"
  | "SELECTING_PERSON"
  | "PREPARING_PAGE"
  | "WAITING_FOR_OPEN"
  | "REFRESHING_SLOTS"
  | "SLOT_DETECTED"
  | "SLOT_SELECTED"
  | "ADVANCING_RESERVATION"
  | "DRY_RUN_COMPLETED"
  | "HANDED_OFF"
  | "COMPLETED"
  | "STOPPED"
  | "TIMED_OUT"
  | "FAILED";

export type TablePreference = "any" | "hall" | "bar" | "room";
export type EntryMode = "auto" | "prepared";

export interface ReservationConfig {
  targetUrl: string;
  openAtMs: number;
  reservationDate: string;
  personCount: number;
  timeRange: { startMinutes: number; endMinutes: number };
  priorityTimes: number[];
  postSlotEnabled: boolean;
  tablePreference: TablePreference;
  menuKeyword: string;
  stopAtMs: number;
  entryMode: EntryMode;
  dryRun: boolean;
  preOpenLeadMs: number;
  toggleIntervalMs: number;
  clockSampleCount: number;
}

export type SavedConfigList = "history" | "favorites";

export interface SavedConfig {
  id: string;
  savedAt: number;
  fingerprint: string;
  config: ReservationConfig;
}

export type ScheduledJobStatus = "scheduled" | "running" | "finished" | "missed";

export interface ScheduledJobResult {
  state: RunState;
  message: string;
  finishedAt: number;
}

export interface ScheduledJob {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: ScheduledJobStatus;
  config: ReservationConfig;
  result: ScheduledJobResult | null;
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
  scheduledJobId?: string;
}

export type ContentCommand =
  | { type: "PING" }
  | { type: "START"; runId: string; scheduledJobId?: string; shadowChannelId?: string; config: ReservationConfig }
  | { type: "STOP" };

export type PanelCommand =
  | { type: "PANEL_START"; config: ReservationConfig }
  | { type: "PANEL_STOP" }
  | { type: "SAVE_FAVORITE"; config: ReservationConfig }
  | { type: "DELETE_SAVED"; list: SavedConfigList; id: string }
  | { type: "CLEAR_SAVED"; list: SavedConfigList }
  | { type: "SCHEDULE_JOB"; id: string | null; config: ReservationConfig }
  | { type: "DELETE_JOB"; id: string }
  | { type: "LIST_RUN_HISTORY" }
  | { type: "GET_RUN_TRACE"; runId: string; limit?: number }
  | { type: "DELETE_RUN_TRACE"; runId: string };

export interface RunEventMessage {
  type: "RUN_EVENT";
  event: RunEvent;
}

export interface CommandResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}
