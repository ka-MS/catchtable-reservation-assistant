import type { ReservationConfig, RunState } from "../types.js";
import type { TraceCode } from "./codes.js";

export type TraceSeverity = "trace" | "info" | "warn" | "error";
export type TraceAttributes = Record<string, string | number | boolean | null>;

export interface TraceError {
  name: string;
  message: string;
  stack?: string;
}

export interface TraceEvent {
  schemaVersion: 1;
  runId: string;
  seq: number;
  code: TraceCode;
  severity: TraceSeverity;
  component: "content" | "background";
  localAt: number;
  serverAt: number | null;
  state: RunState | null;
  message: string;
  attributes: TraceAttributes;
  error?: TraceError;
}

export interface TraceRunDescriptor {
  schemaVersion: 1;
  runId: string;
  startedAt: number;
  config: ReservationConfig;
  scheduledJobId?: string;
}

export interface TraceRunRecord extends TraceRunDescriptor {
  finishedAt: number | null;
  finalState: RunState | null;
  eventCount: number;
  droppedCount: number;
  extensionVersion: string;
}

export interface TraceBatch {
  type: "TRACE_BATCH";
  batchId: string;
  run: TraceRunDescriptor;
  firstSeq: number;
  lastSeq: number;
  events: TraceEvent[];
}

export interface TraceAck {
  type: "TRACE_ACK";
  runId: string;
  lastSeq: number;
}

export interface TraceLiveBatch {
  type: "TRACE_LIVE_BATCH";
  run: TraceRunRecord;
  events: TraceEvent[];
}

export interface TraceExportResult {
  ok: boolean;
  error?: string;
}

export interface TraceExporter {
  export(batch: TraceEvent[]): Promise<TraceExportResult>;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface TraceRepository {
  append(run: TraceRunDescriptor, events: TraceEvent[], extensionVersion: string): Promise<TraceRunRecord>;
  listRuns(limit: number): Promise<TraceRunRecord[]>;
  readEvents(runId: string, limit: number): Promise<TraceEvent[]>;
  deleteRun(runId: string): Promise<void>;
  prune(limit: number): Promise<void>;
}
