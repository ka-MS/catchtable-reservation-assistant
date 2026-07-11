import { createMeasurement, selectClockEstimate, type ClockEstimate } from "../shared/clock.js";
import type { Clock, Sleep } from "../shared/scheduler.js";

export async function syncServerClock(
  targetUrl: string,
  sampleCount: number,
  dependencies: {
    clock: Clock;
    monotonicClock: Clock;
    signal: AbortSignal;
    fetch?: typeof fetch;
    sleep: Sleep;
  },
): Promise<ClockEstimate> {
  const fetcher = dependencies.fetch ?? fetch;
  const samples = [];
  for (let index = 0; index < sampleCount && !dependencies.signal.aborted; index += 1) {
    const requestStartedAt = dependencies.clock.now();
    const requestStartedMonotonic = dependencies.monotonicClock.now();
    try {
      const response = await fetcher(targetUrl, {
        method: "HEAD",
        cache: "no-store",
        credentials: "include",
        signal: dependencies.signal,
      });
      const responseReceivedMonotonic = dependencies.monotonicClock.now();
      const responseReceivedAt = dependencies.clock.now();
      const serverDateMs = Date.parse(response.headers.get("Date") ?? "");
      if (Number.isFinite(serverDateMs)) {
        samples.push(createMeasurement({
          requestStartedAt,
          responseReceivedAt,
          serverDateMs,
          measurementLatencyMs: responseReceivedMonotonic - requestStartedMonotonic,
        }));
      }
    } catch (error) {
      if (dependencies.signal.aborted) break;
      if (error instanceof TypeError) {
        // A failed sample is ignored; the bounded sample set decides fallback.
      } else {
        throw error;
      }
    }
    if (index + 1 < sampleCount && !(await dependencies.sleep(125, dependencies.signal))) break;
  }
  return selectClockEstimate(samples);
}
