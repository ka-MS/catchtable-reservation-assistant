export interface TogglePlan {
  adjacentClickAtMs: number;
  targetClickAtMs: number;
  cycleMs: number;
  phase: "warmup" | "precision" | "followup" | "long_tail";
}

const SWITCH_LEAD_MS = 40;
const PRECISION_START_MS = 600;
const PRECISION_END_MS = 2_000;
const LONG_TAIL_START_MS = 30_000;

export function nextTogglePlan(nowMs: number, openAtMs: number, configuredIntervalMs: number): TogglePlan {
  const relative = nowMs - openAtMs;
  let cycleMs: number;
  let phase: TogglePlan["phase"];
  let targetClickAtMs: number;

  if (relative < -PRECISION_START_MS) {
    phase = "warmup";
    cycleMs = Math.min(configuredIntervalMs, 400);
    targetClickAtMs = nowMs + cycleMs;
  } else if (relative <= PRECISION_END_MS) {
    phase = "precision";
    cycleMs = Math.min(configuredIntervalMs, 150);
    const minimumTarget = nowMs + SWITCH_LEAD_MS;
    const phaseIndex = Math.ceil((minimumTarget - openAtMs) / cycleMs);
    targetClickAtMs = openAtMs + phaseIndex * cycleMs;
  } else if (relative <= LONG_TAIL_START_MS) {
    phase = "followup";
    cycleMs = Math.max(configuredIntervalMs, 250);
    targetClickAtMs = nowMs + cycleMs;
  } else {
    phase = "long_tail";
    cycleMs = 2_000;
    targetClickAtMs = nowMs + cycleMs;
  }

  return {
    adjacentClickAtMs: targetClickAtMs - SWITCH_LEAD_MS,
    targetClickAtMs,
    cycleMs,
    phase,
  };
}
