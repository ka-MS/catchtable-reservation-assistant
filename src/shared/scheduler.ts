export interface Clock {
  now(): number;
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<boolean>;

export const abortableSleep: Sleep = (ms, signal) => new Promise((resolve) => {
  if (signal.aborted) {
    resolve(false);
    return;
  }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve(true);
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    resolve(false);
  };
  signal.addEventListener("abort", onAbort, { once: true });
});

export async function waitUntil(
  targetMs: number,
  options: {
    clock: Clock;
    stopAtMs: number;
    signal: AbortSignal;
    sleep: Sleep;
    tickMs?: number;
  },
): Promise<"ready" | "timed_out" | "stopped"> {
  const tickMs = options.tickMs ?? 100;
  while (true) {
    if (options.signal.aborted) return "stopped";
    const now = options.clock.now();
    if (now >= options.stopAtMs) return "timed_out";
    if (now >= targetMs) return "ready";
    const delay = Math.min(tickMs, targetMs - now, options.stopAtMs - now);
    if (!(await options.sleep(delay, options.signal))) return "stopped";
  }
}
