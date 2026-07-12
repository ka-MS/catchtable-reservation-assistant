import type { TraceAck, TraceBatch } from "../../shared/telemetry/types.js";
import type { TraceBatchTransport } from "./batch-processor.js";

export class PortTraceTransport implements TraceBatchTransport {
  private port: chrome.runtime.Port | null = null;
  private ackHandler: (runId: string, lastSeq: number) => void = () => undefined;

  setAckHandler(handler: (runId: string, lastSeq: number) => void): void {
    this.ackHandler = handler;
  }

  send(batch: TraceBatch): void {
    try {
      this.connect().postMessage(batch);
    } catch {
      this.port = null;
    }
  }

  private connect(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: "trace-ingest" });
    port.onMessage.addListener((message: TraceAck) => {
      if (message?.type === "TRACE_ACK") this.ackHandler(message.runId, message.lastSeq);
    });
    port.onDisconnect.addListener(() => {
      if (this.port === port) this.port = null;
    });
    this.port = port;
    return port;
  }
}
