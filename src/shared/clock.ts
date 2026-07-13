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

// --- Tier 1: 기준시계(ReferenceClock) 구간 최대피복 추정 ---
// 우산 §2 P3: app HEAD Date는 오픈 구간 접근용 관측 기준값이지 예약 서버의 절대
// 진실이 아니다. 그래서 ServerClock이 아니라 ReferenceClock으로 명명한다.

/**
 * HEAD 표본 하나를 offset(=진짜서버 − monotonic epoch) 구간으로 표현한다.
 * 서버가 Date=D를 찍은 monotonic 순간 t_stamp ∈ [t0, t1]이고 그때 진짜 서버시각
 * ∈ [D, D+1000)이므로, offset ∈ [D − t1, D + 1000 − t0). RTT가 작을수록 구간이 좁다.
 */
export interface ReferenceClockSample {
  t0: number;           // monotonic epoch, 요청 직전
  t1: number;           // monotonic epoch, 응답 수신
  serverDateMs: number; // D, 초 정렬된 Date 헤더
  rttMs: number;        // t1 - t0
  lowerMs: number;      // D - t1
  upperMs: number;      // D + 1000 - t0
  fromCache: boolean;   // 캐시 응답은 추정에서 제외
}

export interface ReferenceClockEstimate {
  offsetLowerMs: number;
  offsetCenterMs: number;
  offsetUpperMs: number;
  uncertaintyMs: number;           // armLead가 참조하는 상한 여유 (모호하면 클러스터 간격 이상)
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dominantClusterSupport: number;
  competingClusterSupport: number;
  clusterSeparationMs: number;     // 두 클러스터 중심 거리, 경쟁 없으면 -1
  medianRttMs: number;
  p95RttMs: number;
  sampleCount: number;             // 필터 후 실제 사용 표본 수
  observationSpanMs: number;       // 가장 이른 t0 ~ 가장 늦은 t1
  source: "APP_HEAD_HTTP_DATE" | "FALLBACK";
  updatedAtMonoMs: number;         // 가장 늦은 표본의 t1
}

// RTT 이상치 제외 배수. 설계는 p95×배수를 언급하나 표본이 적으면 p95=최댓값이라
// 정작 이상치를 못 거른다. 그래서 median×배수로 게이팅하고 p95는 텔레메트리로만 보고한다.
const OUTLIER_RTT_MULTIPLIER = 3;
const CLUSTER_DOMINANCE_RATIO = 2;
const HIGH_CONFIDENCE_MIN_SAMPLES = 5;
const HIGH_CONFIDENCE_MIN_SPAN_MS = 3_000;
const MEDIUM_CONFIDENCE_MIN_SAMPLES = 3;

const FALLBACK_ESTIMATE: ReferenceClockEstimate = {
  offsetLowerMs: 0, offsetCenterMs: 0, offsetUpperMs: 0, uncertaintyMs: 0,
  confidence: "LOW", dominantClusterSupport: 0, competingClusterSupport: 0,
  clusterSeparationMs: -1, medianRttMs: 0, p95RttMs: 0, sampleCount: 0,
  observationSpanMs: 0, source: "FALLBACK", updatedAtMonoMs: 0,
};

export function createReferenceClockSample(input: {
  t0: number;
  t1: number;
  serverDateMs: number;
  fromCache?: boolean;
}): ReferenceClockSample {
  return {
    t0: input.t0,
    t1: input.t1,
    serverDateMs: input.serverDateMs,
    rttMs: input.t1 - input.t0,
    lowerMs: input.serverDateMs - input.t1,
    upperMs: input.serverDateMs + 1_000 - input.t0,
    fromCache: input.fromCache ?? false,
  };
}

interface OffsetInterval {
  lowerMs: number;
  upperMs: number;
}

interface Cluster {
  lower: number;
  upper: number;
  center: number;
  support: number;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.ceil(fraction * (sorted.length - 1))];
}

// 오프셋 축을 스윕해 가장 많은 구간이 겹치는 영역을 찾는다. 피복수가 같으면 서로
// 구간 중심이 가까운(같은 풀로 합의하는) 쪽을 고른다 — 서로 다른 풀의 구간
// 가장자리가 스치는 유령 겹침을 배제하기 위함.
function findMaxCoverageCluster(intervals: OffsetInterval[]): Cluster | null {
  if (intervals.length === 0) return null;
  const candidatePoints = [...new Set(intervals.map((iv) => iv.lowerMs))];
  let best: Cluster | null = null;
  let bestSpread = Number.POSITIVE_INFINITY;
  for (const point of candidatePoints) {
    const covering = intervals.filter((iv) => iv.lowerMs <= point && point < iv.upperMs);
    const lower = Math.max(...covering.map((iv) => iv.lowerMs));
    const upper = Math.min(...covering.map((iv) => iv.upperMs));
    const center = (lower + upper) / 2;
    const centers = covering.map((iv) => (iv.lowerMs + iv.upperMs) / 2);
    const spread = Math.max(...centers) - Math.min(...centers);
    const better = best === null
      || covering.length > best.support
      || (covering.length === best.support && spread < bestSpread)
      || (covering.length === best.support && spread === bestSpread && center < best.center);
    if (better) {
      best = { lower, upper, center, support: covering.length };
      bestSpread = spread;
    }
  }
  return best;
}

export function estimateReferenceClock(samples: ReferenceClockSample[]): ReferenceClockEstimate {
  const usable = samples.filter((sample) => !sample.fromCache);
  if (usable.length === 0) return { ...FALLBACK_ESTIMATE };

  const rttMedian = median(usable.map((sample) => sample.rttMs));
  const rttThreshold = rttMedian * OUTLIER_RTT_MULTIPLIER;
  const kept = usable.filter((sample) => sample.rttMs <= rttThreshold);
  if (kept.length === 0) return { ...FALLBACK_ESTIMATE };

  const dominant = findMaxCoverageCluster(kept);
  if (dominant === null) return { ...FALLBACK_ESTIMATE };
  const remaining = kept.filter((iv) => iv.upperMs <= dominant.lower || iv.lowerMs >= dominant.upper);
  const competing = findMaxCoverageCluster(remaining);

  const sortedRtts = kept.map((sample) => sample.rttMs).sort((left, right) => left - right);
  const observationSpanMs = Math.max(...kept.map((s) => s.t1)) - Math.min(...kept.map((s) => s.t0));
  const clusterSeparationMs = competing ? Math.abs(dominant.center - competing.center) : -1;

  let offsetLowerMs = dominant.lower;
  let offsetUpperMs = dominant.upper;
  let uncertaintyMs = (dominant.upper - dominant.lower) / 2;
  let confidence: ReferenceClockEstimate["confidence"];

  if (competing === null) {
    if (kept.length >= HIGH_CONFIDENCE_MIN_SAMPLES && observationSpanMs >= HIGH_CONFIDENCE_MIN_SPAN_MS) {
      confidence = "HIGH";
    } else if (kept.length >= MEDIUM_CONFIDENCE_MIN_SAMPLES) {
      confidence = "MEDIUM";
    } else {
      confidence = "LOW";
    }
  } else if (dominant.support >= CLUSTER_DOMINANCE_RATIO * competing.support && kept.length >= MEDIUM_CONFIDENCE_MIN_SAMPLES) {
    // 소수 경쟁 클러스터가 있어도 다수가 압도하면 신뢰(단 HIGH는 아님). 구간은 다수 그대로.
    confidence = "MEDIUM";
  } else {
    // 모호: 어느 풀이 진짜인지 자신할 수 없다. 두 클러스터를 아우르고 불확실성이
    // 최소한 클러스터 간격을 덮게 넓혀, armLead가 어느 쪽이든 놓치지 않게 한다.
    confidence = "LOW";
    offsetLowerMs = Math.min(dominant.lower, competing.lower);
    offsetUpperMs = Math.max(dominant.upper, competing.upper);
    uncertaintyMs = Math.max((offsetUpperMs - offsetLowerMs) / 2, clusterSeparationMs);
  }

  return {
    offsetLowerMs,
    offsetCenterMs: dominant.center,
    offsetUpperMs,
    uncertaintyMs,
    confidence,
    dominantClusterSupport: dominant.support,
    competingClusterSupport: competing?.support ?? 0,
    clusterSeparationMs,
    medianRttMs: rttMedian,
    p95RttMs: percentile(sortedRtts, 0.95),
    sampleCount: kept.length,
    observationSpanMs,
    source: "APP_HEAD_HTTP_DATE",
    updatedAtMonoMs: Math.max(...kept.map((s) => s.t1)),
  };
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
