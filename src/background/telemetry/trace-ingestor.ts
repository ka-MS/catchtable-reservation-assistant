import type { ReservationConfig, RunState } from "../../shared/types.js";
import type { TraceAck, TraceBatch, TraceEvent, TraceRepository, TraceRunDescriptor } from "../../shared/telemetry/types.js";
import { LiveTraceHub } from "./live-trace-hub.js";

const TERMINAL = new Set<RunState>(["DRY_RUN_COMPLETED", "HANDED_OFF", "COMPLETED", "STOPPED", "TIMED_OUT", "FAILED"]);

export class TraceIngestor {
  constructor(
    private readonly repository: TraceRepository,
    private readonly live: LiveTraceHub,
    private readonly extensionVersion: () => string,
  ) {}

  async ingest(batch: TraceBatch, ack: (message: TraceAck) => void): Promise<void> {
    const run = await this.repository.append(batch.run, batch.events, this.extensionVersion());
    this.live.publish({ type: "TRACE_LIVE_BATCH", run, events: batch.events });
    ack({ type: "TRACE_ACK", runId: batch.run.runId, lastSeq: batch.lastSeq });
    if (batch.events.some((event) => event.state !== null && TERMINAL.has(event.state))) {
      await this.repository.prune(20);
    }
  }

  async recordBackgroundFailure(
    runId: string,
    config: ReservationConfig,
    message: string,
    error?: unknown,
    scheduledJobId?: string,
  ): Promise<void> {
    const now = Date.now();
    const descriptor = this.descriptor(runId, now, config, scheduledJobId);
    const event: TraceEvent = {
      schemaVersion: 1,
      runId,
      seq: 1,
      code: "BACKGROUND_FAILURE",
      severity: "error",
      component: "background",
      localAt: now,
      serverAt: null,
      state: "FAILED",
      message: message.slice(0, 1_000),
      attributes: {},
      ...(error instanceof Error ? {
        error: {
          name: error.name.slice(0, 100),
          message: error.message.slice(0, 1_000),
          ...(error.stack ? { stack: error.stack.slice(0, 8_192) } : {}),
        },
      } : {}),
    };
    const run = await this.repository.append(descriptor, [event], this.extensionVersion());
    this.live.publish({ type: "TRACE_LIVE_BATCH", run, events: [event] });
    await this.repository.prune(20);
  }

  async recordBackgroundTerminal(
    runId: string,
    startedAt: number,
    config: ReservationConfig,
    state: Extract<RunState, "STOPPED" | "FAILED" | "TIMED_OUT">,
    message: string,
    scheduledJobId?: string,
  ): Promise<void> {
    const previous = await this.repository.readEvents(runId, 1);
    const seq = (previous.at(-1)?.seq ?? 0) + 1;
    const now = Date.now();
    const event: TraceEvent = {
      schemaVersion: 1,
      runId,
      seq,
      code: state === "FAILED" ? "RUN_FAILED" : "RUN_TERMINATED",
      severity: state === "FAILED" ? "error" : "warn",
      component: "background",
      localAt: now,
      serverAt: null,
      state,
      message,
      attributes: {},
    };
    const run = await this.repository.append(
      this.descriptor(runId, startedAt, config, scheduledJobId),
      [event],
      this.extensionVersion(),
    );
    this.live.publish({ type: "TRACE_LIVE_BATCH", run, events: [event] });
    await this.repository.prune(20);
  }

  private descriptor(
    runId: string,
    startedAt: number,
    config: ReservationConfig,
    scheduledJobId?: string,
  ): TraceRunDescriptor {
    let targetUrl = config.targetUrl;
    try {
      const url = new URL(config.targetUrl);
      url.search = "";
      url.hash = "";
      targetUrl = url.toString();
    } catch {
      // Invalid input remains visible as a failed run without URL decomposition.
    }
    return {
      schemaVersion: 1,
      runId,
      startedAt,
      config: { ...config, targetUrl },
      ...(scheduledJobId === undefined ? {} : { scheduledJobId }),
    };
  }
}
