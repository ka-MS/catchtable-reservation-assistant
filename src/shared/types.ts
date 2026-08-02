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
  | "WATCHING_WAITING_CTA"
  | "WAITING_CTA_DISPATCHED"
  | "SLOT_DETECTED"
  | "SLOT_CLICK_DISPATCHED"
  | "SLOT_TRANSITION_CONFIRMED"
  | "SLOT_SELECTED"
  | "ADVANCING_RESERVATION"
  | "COMPLETING_RESERVATION"
  | "DRY_RUN_COMPLETED"
  | "HANDED_OFF"
  | "COMPLETED"
  | "STOPPED"
  | "TIMED_OUT"
  | "FAILED";

export type TablePreference = "any" | "hall" | "bar" | "room";
export type EntryMode = "auto" | "prepared";
export type PaymentMethodPolicy = "zero_only" | "selected_allowed";
export type AvailabilityProbeMode = "off" | "observe" | "empty_exit";

export interface ReservationConfig {
  targetUrl: string;
  openAtMs: number;
  reservationDate: string;
  personCount: number;
  timeRange: { startMinutes: number; endMinutes: number };
  priorityTimes: number[];
  postSlotEnabled: boolean;
  paymentMethodAutoAdvance: boolean;
  paymentMethodPolicy: PaymentMethodPolicy;
  tablePreference: TablePreference;
  menuKeyword: string;
  stopAtMs: number;
  entryMode: EntryMode;
  dryRun: boolean;
  preOpenLeadMs: number;
  toggleIntervalMs: number;
  availabilityProbeMode?: AvailabilityProbeMode;
  /** @deprecated Legacy persisted setting. Normalize before use. */
  availabilityProbeEnabled?: boolean;
  reservationCompletionEnabled: boolean;
  maxPaymentAmountKrw: number;
  requiredFormDefaultAnswer: string;
}

/**
 * 온라인 웨이팅 등록은 예약과 공유하는 설정이 URL·오픈 시각뿐이라 ReservationConfig를
 * 재사용하지 않는다(날짜·시간범위·인원·결제 검증이 전부 무의미하다).
 */
export interface WaitingConfig {
  targetUrl: string;
  openAtMs: number;
  stopAtMs: number;
  /** true면 CTA 활성화를 감지만 하고 클릭하지 않는다. */
  dryRun: boolean;
  preOpenLeadMs: number;
  /** 무장 후 CTA 재검사 주기. MutationObserver wake와 병행한다. */
  pollIntervalMs: number;
  /**
   * 웨이팅 섹션 새로고침 클릭 주기. 0이면 누르지 않고 관측만 한다.
   * CTA 활성화가 서버 응답으로만 반영되는 경우 이 갱신이 없으면 영원히 열리지 않는다.
   */
  refreshIntervalMs: number;
}

/** 초기 수동 attempt의 START에만 존재하는 일회성 secret — ReservationConfig와 별도로 취급한다. */
export interface OneShotRunAuthorization {
  catchPayPin: string;
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

export interface RunExecutionContext {
  capturedAt: number;
  tabId: number;
  windowId: number | null;
  tabActive: boolean;
  windowFocused: boolean | null;
}

export interface ShopSnapshot {
  url: string;
  selectedDate: string | null;
  selectedPersonCount: number | null;
}

export type ContentCommand =
  | { type: "PING" }
  | {
    type: "START";
    runId: string;
    logicalRunId?: string;
    attemptIndex?: number;
    resetCause?: string;
    scheduledJobId?: string;
    shadowChannelId?: string;
    executionContext?: RunExecutionContext;
    config: ReservationConfig;
    /** initial manual attempt에만 존재한다 — recovery·scheduled START에는 넣지 않는다. */
    authorization?: OneShotRunAuthorization;
  }
  | { type: "START_WAITING"; runId: string; config: WaitingConfig }
  | { type: "STOP" }
  | { type: "GET_ATTEMPT_STATUS"; attemptId: string }
  | { type: "READ_SHOP_SNAPSHOT" };

export type PanelCommand =
  | { type: "PANEL_START"; config: ReservationConfig; authorization?: OneShotRunAuthorization }
  | { type: "PANEL_STOP" }
  | { type: "PANEL_START_WAITING"; config: WaitingConfig }
  | { type: "PANEL_STOP_WAITING" }
  | { type: "SAVE_FAVORITE"; config: ReservationConfig }
  | { type: "DELETE_SAVED"; list: SavedConfigList; id: string }
  | { type: "CLEAR_SAVED"; list: SavedConfigList }
  | { type: "SCHEDULE_JOB"; id: string | null; config: ReservationConfig }
  | { type: "DELETE_JOB"; id: string }
  | { type: "LIST_RUN_HISTORY" }
  | { type: "GET_RUN_TRACE"; runId: string; limit?: number }
  | { type: "EXPORT_RUN_TRACE"; runId: string }
  | { type: "EXPORT_RUN_DIAGNOSTIC"; runId: string }
  | { type: "DELETE_RUN_TRACE"; runId: string }
  | { type: "FETCH_SHOP_SNAPSHOT" }
  | { type: "CLEAR_RUN_EVENTS" };

export interface RunEventMessage {
  type: "RUN_EVENT";
  event: RunEvent;
}

export interface CommandResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}
