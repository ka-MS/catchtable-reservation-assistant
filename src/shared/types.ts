export type TableTypePreference = "none" | "hall" | "room" | "bar";

export type AutomationState =
  | "IDLE"
  | "ARMED"
  | "WATCHING"
  | "VERIFYING_NEXT"
  | "RETRYING"
  | "PAUSED_USER"
  | "STOPPED";

export interface ReservationConfig {
  targetUrl: string;
  date: string;
  personCount: number;
  startTime: string;
  endTime: string;
  tableTypePreference: TableTypePreference;
  stopAt?: string;
}

export interface StatusEvent {
  type: "STATUS";
  state: AutomationState;
  detail: string;
  at: number;
  retryCount: number;
}

export type Command =
  | { type: "START"; config: ReservationConfig }
  | { type: "STOP" };
