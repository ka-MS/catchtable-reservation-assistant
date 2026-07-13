import {
  createReferenceClockSample,
  estimateReferenceClock,
  type ReferenceClockEstimate,
  type ReferenceClockSample,
} from "../shared/clock.js";
import type { Clock, Sleep } from "../shared/scheduler.js";

export interface ReferenceClockSamplerOptions {
  targetUrl: string;
  monotonicClock: Clock;
  sleep: Sleep;
  fetch?: typeof fetch;
  /** 표본 주기. 배경 탭 스로틀(~1s) 위에서 살도록 기본 1.75s. */
  periodMs?: number;
  /** 링버퍼 상한. */
  bufferSize?: number;
}

const DEFAULT_PERIOD_MS = 1_750;
const DEFAULT_BUFFER_SIZE = 64;

/**
 * 대기 시간(WAITING_FOR_OPEN) 동안 저빈도로 app HEAD 표본을 모아 매번 기준시계
 * estimate를 재계산하는 rolling 샘플러. 버스트(좁은 시간 창)와 달리 시간 분산
 * 표본이라 일시적 스큐 몰림에 덜 취약하다(우산 §1.3, Tier1 10-analysis).
 */
export class ReferenceClockSampler {
  private readonly samples: ReferenceClockSample[] = [];
  private estimate: ReferenceClockEstimate | null = null;
  private controller: AbortController | null = null;
  private readonly periodMs: number;
  private readonly bufferSize: number;

  constructor(private readonly options: ReferenceClockSamplerOptions) {
    this.periodMs = options.periodMs ?? DEFAULT_PERIOD_MS;
    this.bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
  }

  get latest(): ReferenceClockEstimate | null {
    return this.estimate;
  }

  /** 표본을 버퍼에 넣고(상한 초과 시 오래된 것부터 제거) estimate를 갱신·반환한다. */
  ingest(sample: ReferenceClockSample): ReferenceClockEstimate {
    this.samples.push(sample);
    if (this.samples.length > this.bufferSize) this.samples.shift();
    this.estimate = estimateReferenceClock(this.samples, this.estimate ?? undefined);
    return this.estimate;
  }

  /** HEAD 한 번으로 표본을 만든다. Date 없거나 파싱 불가면 null. */
  async sampleOnce(signal: AbortSignal): Promise<ReferenceClockSample | null> {
    const fetcher = this.options.fetch ?? fetch;
    const t0 = this.options.monotonicClock.now();
    let response: Response;
    try {
      response = await fetcher(this.options.targetUrl, {
        method: "HEAD",
        cache: "no-store",
        credentials: "include",
        signal,
      });
    } catch (error) {
      if (error instanceof TypeError) return null; // 네트워크 실패 표본은 무시
      throw error;
    }
    const t1 = this.options.monotonicClock.now();
    const serverDateMs = Date.parse(response.headers.get("Date") ?? "");
    if (!Number.isFinite(serverDateMs)) return null;
    const ageHeader = response.headers.get("Age");
    const fromCache = ageHeader !== null && Number(ageHeader) > 0;
    return createReferenceClockSample({ t0, t1, serverDateMs, fromCache });
  }

  /** 주기적으로 표본을 모으며 갱신된 estimate를 콜백으로 방출한다. stop() 시 종료. */
  async start(onEstimate: (estimate: ReferenceClockEstimate) => void): Promise<void> {
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    while (!controller.signal.aborted) {
      const sample = await this.sampleOnce(controller.signal);
      if (controller.signal.aborted) break;
      if (sample) onEstimate(this.ingest(sample));
      if (!(await this.options.sleep(this.periodMs, controller.signal))) break;
    }
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
