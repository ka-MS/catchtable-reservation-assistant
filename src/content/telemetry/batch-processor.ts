import { CRITICAL_TRACE_CODES } from "../../shared/telemetry/codes.js";
import type { TraceBatch, TraceEvent, TraceRunDescriptor } from "../../shared/telemetry/types.js";

export interface TraceBatchTransport {
  send(batch: TraceBatch): void;
  setAckHandler(handler: (runId: string, lastSeq: number) => void): void;
}

interface TimerPort {
  set(callback: () => void, delayMs: number): number;
  clear(id: number): void;
}

const DEFAULT_TIMER: TimerPort = {
  set: (callback, delayMs) => globalThis.setTimeout(callback, delayMs) as unknown as number,
  clear: (id) => globalThis.clearTimeout(id),
};

export class BatchTraceProcessor {
  private run: TraceRunDescriptor | null = null;
  private queue: TraceEvent[] = [];
  private timerId: number | null = null;
  private inflight = false;
  private droppedCount = 0;
  private waiters = new Set<() => void>();

  constructor(
    private readonly transport: TraceBatchTransport,
    private readonly id: () => string,
    private readonly timer: TimerPort = DEFAULT_TIMER,
    private readonly options = { delayMs: 250, batchSize: 20, traceQueueSize: 512 },
  ) {
    transport.setAckHandler((runId, lastSeq) => this.acknowledge(runId, lastSeq));
  }

  startRun(run: TraceRunDescriptor): void {
    this.run = run;
    this.queue = [];
    this.droppedCount = 0;
    this.inflight = false;
    this.clearTimer();
  }

  record(event: TraceEvent): void {
    if (!this.run || this.run.runId !== event.runId) return;
    if (this.queue.length >= this.options.traceQueueSize) {
      const dropIndex = this.queue.findIndex((item) => !CRITICAL_TRACE_CODES.has(item.code));
      if (dropIndex >= 0) {
        this.queue.splice(dropIndex, 1);
        this.droppedCount += 1;
      }
    }
    if (this.droppedCount > 0) event.attributes.droppedTraceCount = this.droppedCount;
    this.queue.push(event);
    this.schedule(!this.inflight && this.queue.length >= this.options.batchSize ? 0 : this.options.delayMs);
  }

  flush(): void {
    if (this.inflight) return;
    this.clearTimer();
    if (!this.run || this.queue.length === 0) return;
    const events = this.queue.slice(0, this.options.batchSize);
    this.inflight = true;
    this.transport.send({
      type: "TRACE_BATCH",
      batchId: this.id(),
      run: this.run,
      firstSeq: events[0].seq,
      lastSeq: events.at(-1)?.seq ?? events[0].seq,
      events,
    });
    this.schedule(this.options.delayMs);
  }

  /** 반환값 = 발행한 trace가 전부 저장 ACK를 받았는지(durable flush). timeout 후에도
   * 반드시 resolve하며, 미ACK 잔량이 있으면 false — 복구 진행은 결과와 무관하다. */
  async forceFlush(timeoutMs = 500): Promise<boolean> {
    if (this.queue.length === 0) return true;
    this.flush();
    if (this.queue.length === 0) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.waiters.delete(onAck);
        globalThis.clearTimeout(timeout);
        resolve(this.queue.length === 0);
      };
      const onAck = () => {
        if (this.queue.length === 0) finish();
      };
      const timeout = globalThis.setTimeout(finish, timeoutMs);
      this.waiters.add(onAck);
    });
  }

  private acknowledge(runId: string, lastSeq: number): void {
    if (this.run?.runId !== runId) return;
    this.inflight = false;
    this.queue = this.queue.filter((event) => event.seq > lastSeq);
    this.waiters.forEach((waiter) => waiter());
    if (this.queue.length > 0) this.flush();
    else this.clearTimer();
  }

  private schedule(delayMs: number): void {
    if (this.queue.length === 0) return;
    if (this.timerId !== null) {
      if (delayMs !== 0) return;
      this.clearTimer();
    }
    this.timerId = this.timer.set(() => {
      this.timerId = null;
      this.inflight = false;
      this.flush();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timerId === null) return;
    this.timer.clear(this.timerId);
    this.timerId = null;
  }
}
