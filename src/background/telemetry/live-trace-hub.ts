import type { TraceLiveBatch } from "../../shared/telemetry/types.js";

export class LiveTraceHub {
  private readonly ports = new Set<chrome.runtime.Port>();

  add(port: chrome.runtime.Port): void {
    this.ports.add(port);
    port.onDisconnect.addListener(() => this.ports.delete(port));
  }

  publish(batch: TraceLiveBatch): void {
    this.ports.forEach((port) => {
      try {
        port.postMessage(batch);
      } catch {
        this.ports.delete(port);
      }
    });
  }
}
