export interface ClockMeasurement {
  localNow: number;
  estimatedServerNow: number;
  clockOffset: number;
  measurementLatency: number;
  measuredAt: number;
  serverDateMs: number;
}

export interface ClockEstimate {
  offsetMs: number;
  sampleCount: number;
  spreadMs: number | null;
  fallback: boolean;
  method: "boundary" | "median" | "local";
  precisionMs: number | null;
}

export function createMeasurement(input: {
  requestStartedAt: number;
  responseReceivedAt: number;
  serverDateMs: number;
  measurementLatencyMs?: number;
}): ClockMeasurement {
  const measurementLatency = Math.max(
    0,
    input.measurementLatencyMs ?? input.responseReceivedAt - input.requestStartedAt,
  );
  const estimatedServerNow = input.serverDateMs + 500 + measurementLatency / 2;
  return {
    localNow: input.responseReceivedAt,
    estimatedServerNow,
    clockOffset: estimatedServerNow - input.responseReceivedAt,
    measurementLatency,
    measuredAt: input.responseReceivedAt,
    serverDateMs: input.serverDateMs,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function selectClockEstimate(
  samples: Array<Pick<ClockMeasurement, "clockOffset" | "measurementLatency"> & Partial<Pick<ClockMeasurement, "measuredAt" | "serverDateMs">>>,
): ClockEstimate {
  if (samples.length === 0) {
    return { offsetMs: 0, sampleCount: 0, spreadMs: null, fallback: true, method: "local", precisionMs: null };
  }

  const chronological = samples
    .filter((sample): sample is typeof sample & Required<Pick<ClockMeasurement, "measuredAt" | "serverDateMs">> =>
      sample.measuredAt !== undefined && sample.serverDateMs !== undefined)
    .sort((left, right) => left.measuredAt - right.measuredAt);
  const boundaries = chronological.slice(1).flatMap((current, index) => {
    const previous = chronological[index];
    if (current.serverDateMs <= previous.serverDateMs) return [];
    const previousMidpoint = previous.measuredAt - previous.measurementLatency / 2;
    const currentMidpoint = current.measuredAt - current.measurementLatency / 2;
    const localBoundary = (previousMidpoint + currentMidpoint) / 2;
    const precisionMs = (currentMidpoint - previousMidpoint) / 2
      + Math.max(previous.measurementLatency, current.measurementLatency) / 2;
    return [{ offsetMs: current.serverDateMs - localBoundary, precisionMs }];
  }).sort((left, right) => left.precisionMs - right.precisionMs);
  const boundary = boundaries[0];
  if (boundary) {
    return {
      offsetMs: boundary.offsetMs,
      sampleCount: 2,
      spreadMs: boundary.precisionMs * 2,
      fallback: false,
      method: "boundary",
      precisionMs: boundary.precisionMs,
    };
  }

  const selected = [...samples]
    .sort((left, right) => left.measurementLatency - right.measurementLatency)
    .slice(0, Math.min(3, samples.length));
  const offsets = selected.map((sample) => sample.clockOffset);
  return {
    offsetMs: median(offsets),
    sampleCount: selected.length,
    spreadMs: Math.max(...offsets) - Math.min(...offsets),
    fallback: false,
    method: "median",
    precisionMs: 500 + Math.min(...selected.map((sample) => sample.measurementLatency)) / 2,
  };
}
