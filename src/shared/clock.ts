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
  sampleDetail: string | null;
  /** HEAD 요청이 실제로 성공해 값을 반환한 횟수(설정된 clockSampleCount와 별개). */
  collectedSamples: number;
}

const FINAL_SYNC_LEAD_MS = 5_000;
const FINAL_SYNC_BUDGET_MS = 2_000;

export function finalClockSyncAt(openAtMs: number, preOpenLeadMs: number): number {
  return Math.min(
    openAtMs - FINAL_SYNC_LEAD_MS,
    openAtMs - preOpenLeadMs - FINAL_SYNC_BUDGET_MS,
  );
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

// 진단용 샘플 요약: o=샘플별 오프셋, l=측정 지연, d=첫 샘플 대비 Date 헤더 틱 차이.
// 백엔드 시계 편차(샘플 간 오프셋 불일치)와 고지연 샘플을 실런 로그에서 판별하기 위한 것.
function formatSampleDetail(
  samples: Array<Pick<ClockMeasurement, "clockOffset" | "measurementLatency"> & Partial<Pick<ClockMeasurement, "serverDateMs">>>,
): string | null {
  if (samples.length === 0) return null;
  const baseDateMs = samples.find((sample) => sample.serverDateMs !== undefined)?.serverDateMs;
  return samples.map((sample) => {
    const parts = [`o${Math.round(sample.clockOffset)}`, `l${Math.round(sample.measurementLatency)}`];
    if (sample.serverDateMs !== undefined && baseDateMs !== undefined) {
      parts.push(`d${sample.serverDateMs - baseDateMs}`);
    }
    return parts.join(" ");
  }).join(" | ");
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
    return { offsetMs: 0, sampleCount: 0, spreadMs: null, fallback: true, method: "local", precisionMs: null, sampleDetail: null, collectedSamples: 0 };
  }
  const sampleDetail = formatSampleDetail(samples);
  const collectedSamples = samples.length;

  const chronological = samples
    .filter((sample): sample is typeof sample & Required<Pick<ClockMeasurement, "measuredAt" | "serverDateMs">> =>
      sample.measuredAt !== undefined && sample.serverDateMs !== undefined)
    .sort((left, right) => left.measuredAt - right.measuredAt);
  // 응답 서버 풀 간 시계가 1초 이상 어긋난다(site-behavior §8 실측). 교차 풀
  // 샘플 쌍은 가짜 초 경계를 만들므로: (1) 인접 샘플 간격이 1초 미만인 이상
  // 진짜 틱은 정확히 +1000이어야 하고, (2) 경계 오프셋은 전체 샘플의 Date
  // 헤더를 과반 이상 재예측해야 채택한다. 동표는 정밀한 경계가 이긴다.
  const boundaries = chronological.slice(1).flatMap((current, index) => {
    const previous = chronological[index];
    if (current.serverDateMs - previous.serverDateMs !== 1_000) return [];
    const previousMidpoint = previous.measuredAt - previous.measurementLatency / 2;
    const currentMidpoint = current.measuredAt - current.measurementLatency / 2;
    const localBoundary = (previousMidpoint + currentMidpoint) / 2;
    const precisionMs = (currentMidpoint - previousMidpoint) / 2
      + Math.max(previous.measurementLatency, current.measurementLatency) / 2;
    const offsetMs = current.serverDateMs - localBoundary;
    const supporters = chronological.filter((sample) => {
      const midpoint = sample.measuredAt - sample.measurementLatency / 2;
      return Math.floor((midpoint + offsetMs) / 1_000) * 1_000 === sample.serverDateMs;
    }).length;
    return [{ offsetMs, precisionMs, supporters }];
  }).sort((left, right) => right.supporters - left.supporters || left.precisionMs - right.precisionMs);
  const boundary = boundaries[0];
  const majority = Math.floor(chronological.length / 2) + 1;
  if (boundary && boundary.supporters >= majority) {
    return {
      offsetMs: boundary.offsetMs,
      sampleCount: boundary.supporters,
      spreadMs: boundary.precisionMs * 2,
      fallback: false,
      method: "boundary",
      precisionMs: boundary.precisionMs,
      sampleDetail,
      collectedSamples,
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
    sampleDetail,
    collectedSamples,
  };
}
