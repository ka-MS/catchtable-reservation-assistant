import type { Clock } from "./scheduler.js";

export class MonotonicEpochClock implements Clock {
  private epochAnchorMs = 0;
  private monotonicAnchorMs = 0;

  constructor(private readonly monotonicClock: Clock) {}

  anchor(epochNowMs: number): void {
    this.epochAnchorMs = epochNowMs;
    this.monotonicAnchorMs = this.monotonicClock.now();
  }

  now(): number {
    return this.epochAnchorMs + (this.monotonicClock.now() - this.monotonicAnchorMs);
  }
}
