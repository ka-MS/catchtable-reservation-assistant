import type { ReservationConfig, RunEvent, RunState } from "../../shared/types.js";
import type { TraceCode } from "../../shared/telemetry/codes.js";
import type { TraceAttributes, TraceError, TraceEvent, TraceRunDescriptor, TraceSeverity } from "../../shared/telemetry/types.js";
import { BatchTraceProcessor } from "./batch-processor.js";

const TERMINAL = new Set<RunState>(["DRY_RUN_COMPLETED", "HANDED_OFF", "COMPLETED", "STOPPED", "TIMED_OUT", "FAILED"]);

function cleanConfig(config: ReservationConfig): ReservationConfig {
  let targetUrl = config.targetUrl;
  try {
    const url = new URL(config.targetUrl);
    url.search = "";
    url.hash = "";
    targetUrl = url.toString();
  } catch {
    // Validation reports malformed URLs before a run begins.
  }
  return { ...config, targetUrl };
}

function cleanAttributes(input: TraceAttributes): TraceAttributes {
  const output: TraceAttributes = {};
  Object.entries(input).slice(0, 64).forEach(([key, value]) => {
    if (value === null || typeof value === "number" || typeof value === "boolean") output[key] = value;
    else if (typeof value === "string") output[key] = value.slice(0, 500);
  });
  return output;
}

function cleanError(error: unknown): TraceError | undefined {
  if (!(error instanceof Error)) return undefined;
  return {
    name: error.name.slice(0, 100),
    message: error.message.slice(0, 1_000),
    ...(error.stack ? { stack: error.stack.slice(0, 8_192) } : {}),
  };
}

export class TraceLogger {
  private run: TraceRunDescriptor | null = null;
  private seq = 0;

  constructor(private readonly processor: BatchTraceProcessor, private readonly now: () => number) {}

  start(
    runId: string,
    config: ReservationConfig,
    scheduledJobId?: string,
    attempt?: { logicalRunId: string; attemptIndex: number; resetCause?: string },
  ): void {
    this.seq = 0;
    this.run = {
      schemaVersion: 1,
      runId,
      startedAt: this.now(),
      config: cleanConfig(config),
      ...(scheduledJobId === undefined ? {} : { scheduledJobId }),
    };
    this.processor.startRun(this.run);
    this.record("RUN_STARTED", "info", "실행 추적을 시작했습니다.", {
      attributes: attempt === undefined ? {} : {
        logicalRunId: attempt.logicalRunId,
        attemptIndex: attempt.attemptIndex,
        ...(attempt.resetCause === undefined ? {} : { resetCause: attempt.resetCause }),
      },
    });
  }

  record(
    code: TraceCode,
    severity: TraceSeverity,
    message: string,
    options: {
      serverAt?: number | null;
      state?: RunState | null;
      attributes?: TraceAttributes;
      error?: unknown;
    } = {},
  ): void {
    if (!this.run) return;
    const traceError = cleanError(options.error);
    const event: TraceEvent = {
      schemaVersion: 1,
      runId: this.run.runId,
      seq: ++this.seq,
      code,
      severity,
      component: "content",
      localAt: this.now(),
      serverAt: options.serverAt ?? null,
      state: options.state ?? null,
      message: message.slice(0, 1_000),
      attributes: cleanAttributes(options.attributes ?? {}),
      ...(traceError ? { error: traceError } : {}),
    };
    this.processor.record(event);
  }

  recordRunEvent(event: RunEvent): void {
    const state = typeof event.data?.state === "string" ? event.data.state as RunState : null;
    let code: TraceCode = event.kind === "action" ? "ACTION_PERFORMED" : event.kind === "metric" ? "METRIC_RECORDED" : "STATE_CHANGED";
    if (event.kind === "metric" && typeof event.data?.clockPhase === "string") code = "CLOCK_SYNCED";
    if (event.kind === "action" && typeof event.data?.postSlotStage === "string") code = "POST_SLOT_ACTION";
    if (event.kind === "detect") code = "SLOT_DETECTED";
    if (state === "FAILED" || event.kind === "error") code = "RUN_FAILED";
    else if (state && TERMINAL.has(state)) code = "RUN_TERMINATED";
    const severity: TraceSeverity = code === "RUN_FAILED" ? "error"
      : state === "TIMED_OUT" || state === "STOPPED" ? "warn"
        : code === "SLOT_DETECTED" ? "info" : "trace";
    this.record(code, severity, event.message, {
      serverAt: event.serverAt,
      state,
      attributes: { eventKind: event.kind, ...(event.data ?? {}) },
    });
  }

  forceFlush(): Promise<boolean> {
    return this.processor.forceFlush();
  }
}
