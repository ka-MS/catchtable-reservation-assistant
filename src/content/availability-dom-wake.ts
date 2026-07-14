import type { Sleep } from "../shared/scheduler.js";
import type { CorrelationQuality } from "./availability-correlation.js";

export type AvailabilityWakeDiscardReason =
  | "untrusted_quality"
  | "stale_sequence"
  | "inactive_cycle"
  | "duplicate_sequence"
  | "no_matching_slot"
  | "malformed_signal";

export interface AvailabilityWakeOffer {
  cycle: number | null;
  requestSequence: number;
  quality: CorrelationQuality;
  stale: boolean;
  selectedMinutes: number | null;
  responseCompletedMonoMs: number;
  payloadClassifiedMonoMs: number;
  bridgeReceivedMonoMs: number;
  wakeAtMonoMs: number;
}

export interface AvailabilityWakeSignal {
  cycle: number;
  requestSequence: number;
  quality: "EXACT" | "STRONG";
  selectedMinutes: number;
  responseCompletedMonoMs: number;
  payloadClassifiedMonoMs: number;
  bridgeReceivedMonoMs: number;
  wakeAtMonoMs: number;
}

export interface AvailabilityWakeDecision {
  accepted: boolean;
  discardReason: AvailabilityWakeDiscardReason | null;
  signal: AvailabilityWakeSignal | null;
}

export type AvailabilityWakeWaitResult =
  | { kind: "wake"; signal: AvailabilityWakeSignal }
  | { kind: "elapsed" }
  | { kind: "stopped" };

interface Waiter {
  cycle: number;
  token: object;
  resolve(): void;
}

function finiteMonotonic(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function malformed(input: AvailabilityWakeOffer): boolean {
  return input.cycle !== null && (!Number.isInteger(input.cycle) || input.cycle < 1)
    || !Number.isInteger(input.requestSequence)
    || input.requestSequence < 1
    || input.selectedMinutes !== null
      && (!Number.isInteger(input.selectedMinutes) || input.selectedMinutes < 0 || input.selectedMinutes >= 1_440)
    || !finiteMonotonic(input.responseCompletedMonoMs)
    || !finiteMonotonic(input.payloadClassifiedMonoMs)
    || !finiteMonotonic(input.bridgeReceivedMonoMs)
    || !finiteMonotonic(input.wakeAtMonoMs)
    || input.responseCompletedMonoMs > input.payloadClassifiedMonoMs
    || input.payloadClassifiedMonoMs > input.bridgeReceivedMonoMs
    || input.bridgeReceivedMonoMs > input.wakeAtMonoMs;
}

export class AvailabilityDomWake {
  private activeCycle: number | null = null;
  private lastSequence = 0;
  private pending: AvailabilityWakeSignal | null = null;
  private waiter: Waiter | null = null;

  beginCycle(cycle: number): void {
    this.releaseWaiter();
    this.activeCycle = cycle;
    this.lastSequence = 0;
    this.pending = null;
  }

  endCycle(cycle: number): void {
    if (this.activeCycle !== cycle) return;
    this.releaseWaiter();
    this.activeCycle = null;
    this.lastSequence = 0;
    this.pending = null;
  }

  reset(): void {
    this.releaseWaiter();
    this.activeCycle = null;
    this.lastSequence = 0;
    this.pending = null;
  }

  offer(input: AvailabilityWakeOffer): AvailabilityWakeDecision {
    const reject = (discardReason: AvailabilityWakeDiscardReason): AvailabilityWakeDecision => ({
      accepted: false,
      discardReason,
      signal: null,
    });

    if (malformed(input)) return reject("malformed_signal");
    if (input.quality !== "EXACT" && input.quality !== "STRONG") return reject("untrusted_quality");
    if (input.stale) return reject("stale_sequence");
    if (input.cycle === null || input.cycle !== this.activeCycle) return reject("inactive_cycle");
    if (input.selectedMinutes === null) return reject("no_matching_slot");
    if (input.requestSequence <= this.lastSequence) return reject("duplicate_sequence");

    const signal: AvailabilityWakeSignal = {
      cycle: input.cycle,
      requestSequence: input.requestSequence,
      quality: input.quality,
      selectedMinutes: input.selectedMinutes,
      responseCompletedMonoMs: input.responseCompletedMonoMs,
      payloadClassifiedMonoMs: input.payloadClassifiedMonoMs,
      bridgeReceivedMonoMs: input.bridgeReceivedMonoMs,
      wakeAtMonoMs: input.wakeAtMonoMs,
    };
    this.lastSequence = input.requestSequence;
    this.pending = signal;
    if (this.waiter?.cycle === input.cycle) this.waiter.resolve();
    return { accepted: true, discardReason: null, signal };
  }

  consume(cycle: number): AvailabilityWakeSignal | null {
    if (this.activeCycle !== cycle || this.pending?.cycle !== cycle) return null;
    const signal = this.pending;
    this.pending = null;
    return signal;
  }

  async wait(cycle: number, delayMs: number, sleep: Sleep, signal: AbortSignal): Promise<AvailabilityWakeWaitResult> {
    if (signal.aborted) return { kind: "stopped" };
    const pending = this.consume(cycle);
    if (pending) return { kind: "wake", signal: pending };
    if (this.activeCycle !== cycle) return { kind: "elapsed" };

    const token = {};
    const wake = new Promise<void>((resolve) => {
      this.waiter = { cycle, token, resolve };
    });
    const elapsed = sleep(Math.max(0, delayMs), signal).then((completed) => (
      completed ? "elapsed" as const : "stopped" as const
    ));
    const result = await Promise.race([wake.then(() => "wake" as const), elapsed]);
    if (this.waiter?.token === token) this.waiter = null;
    if (signal.aborted || result === "stopped") return { kind: "stopped" };

    const received = this.consume(cycle);
    return received ? { kind: "wake", signal: received } : { kind: "elapsed" };
  }

  private releaseWaiter(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.resolve();
  }
}
