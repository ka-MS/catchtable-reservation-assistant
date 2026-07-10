export interface ClockMeasurement {
  localNow: number;
  estimatedServerNow: number;
  clockOffset: number;
  measurementLatency: number;
  measuredAt: number;
}

export interface ClockEstimate {
  offsetMs: number;
  sampleCount: number;
  spreadMs: number | null;
  fallback: boolean;
}

export function createMeasurement(input: {
  requestStartedAt: number;
  responseReceivedAt: number;
  serverDateMs: number;
}): ClockMeasurement {
  const measurementLatency = Math.max(0, input.responseReceivedAt - input.requestStartedAt);
  const estimatedServerNow = input.serverDateMs + 500 + measurementLatency / 2;
  return {
    localNow: input.responseReceivedAt,
    estimatedServerNow,
    clockOffset: estimatedServerNow - input.responseReceivedAt,
    measurementLatency,
    measuredAt: input.responseReceivedAt,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function selectClockEstimate(
  samples: Array<Pick<ClockMeasurement, "clockOffset" | "measurementLatency">>,
): ClockEstimate {
  if (samples.length === 0) return { offsetMs: 0, sampleCount: 0, spreadMs: null, fallback: true };
  const selected = [...samples]
    .sort((left, right) => left.measurementLatency - right.measurementLatency)
    .slice(0, Math.min(3, samples.length));
  const offsets = selected.map((sample) => sample.clockOffset);
  return {
    offsetMs: median(offsets),
    sampleCount: selected.length,
    spreadMs: Math.max(...offsets) - Math.min(...offsets),
    fallback: false,
  };
}
