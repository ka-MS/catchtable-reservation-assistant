import { estimateReferenceClock, type ReferenceClockEstimate } from "../shared/clock.js";
import { MonotonicEpochClock } from "../shared/monotonic-clock.js";
import { waitUntil, type Clock, type Sleep } from "../shared/scheduler.js";
import { RunStateMachine } from "../shared/state-machine.js";
import { validateWaitingConfig } from "../shared/waiting-config.js";
import type { RunEvent, RunState, WaitingConfig } from "../shared/types.js";
import type { ReferenceClockPort } from "./reference-clock-sampler.js";
import type { WaitingCtaFacts } from "./adapter/waiting.js";
import type { StageSnapshot } from "./adapter/snapshot.js";

interface WaitingCtaPort {
  inspect(): WaitingCtaFacts;
  clickRegister(): boolean;
  clickRefresh(): boolean;
}

/** dock의 disabled 토글을 폴링보다 먼저 감지하기 위한 wake 신호. */
export interface WaitingCtaWakePort {
  start(onMutation: () => void): void;
  stop(): void;
}

interface Dependencies {
  clock: Clock;
  monotonicClock: Clock;
  referenceClock(config: WaitingConfig): ReferenceClockPort;
  cta: WaitingCtaPort;
  wake?: WaitingCtaWakePort;
  sleep: Sleep;
  emit(event: RunEvent): void;
  /** 클릭 직후 화면을 요약해 다음 단계 실측 근거로 남긴다. */
  captureSnapshot?(): StageSnapshot | null;
  runId(): string;
}

export interface WaitingRunResult {
  state: RunState;
  message: string;
}

const MAX_ARM_LEAD_MS = 30_000;
/** 클릭 뒤 다음 화면이 뜨는지 관측하는 창. 자동 진행은 하지 않고 근거만 남긴다. */
const POST_CLICK_OBSERVE_MS = 3_000;
const POST_CLICK_SAMPLE_INTERVAL_MS = 250;

function armLeadMs(config: WaitingConfig, estimate: ReferenceClockEstimate): number {
  return Math.min(MAX_ARM_LEAD_MS, config.preOpenLeadMs + estimate.uncertaintyMs + estimate.p95RttMs);
}

/**
 * 온라인 웨이팅 등록 실행. 예약 오케스트레이터와 공유하는 것은 기준시계·상태 머신·대기
 * 유틸이고, 예약창 진입·날짜·인원·슬롯·완주 단계는 전부 없다.
 *
 * 자동화 경계: 등록 클릭 1회까지만 수행하고 이후 화면은 사용자에게 인계한다.
 * 클릭 후 화면 조작은 실측 근거가 없어 구현하지 않는다.
 */
export class WaitingRunOrchestrator {
  private readonly serverClock: MonotonicEpochClock;
  private machine: RunStateMachine;
  private controller = new AbortController();
  private config: WaitingConfig;
  private runId = "";
  private serverClockReady = false;
  private referenceClockPort: ReferenceClockPort | null = null;

  constructor(private readonly deps: Dependencies) {
    this.serverClock = new MonotonicEpochClock(deps.monotonicClock);
    this.machine = new RunStateMachine({ dryRun: false, now: () => deps.clock.now() });
    this.config = {
      targetUrl: "", openAtMs: 0, stopAtMs: 0, dryRun: true,
      preOpenLeadMs: 0, pollIntervalMs: 25, refreshIntervalMs: 0,
    };
  }

  stop(): void {
    this.controller.abort();
  }

  async start(config: WaitingConfig, runId: string): Promise<WaitingRunResult> {
    this.config = config;
    this.runId = runId;
    this.controller = new AbortController();
    this.machine = new RunStateMachine({ dryRun: config.dryRun, now: () => this.deps.clock.now() });
    try {
      this.transition("CONFIGURED", "온라인 웨이팅 설정을 받았습니다.");
      return await this.validate()
        ?? await this.syncClock()
        ?? await this.waitForOpen()
        ?? await this.watchAndRegister();
    } catch (error) {
      const message = error instanceof Error ? error.message : "온라인 웨이팅 실행 중 오류가 발생했습니다.";
      if (this.machine.state !== "FAILED") this.transition("FAILED", message, { error: message });
      return this.finish();
    } finally {
      this.stopReferenceClock();
      this.deps.wake?.stop();
    }
  }

  private async validate(): Promise<WaitingRunResult | null> {
    this.transition("VALIDATING", "웨이팅 설정과 매장 화면을 검증합니다.");
    const errors = validateWaitingConfig(this.config, this.deps.clock.now());
    if (errors.length > 0) {
      const message = errors.join(" ");
      this.transition("FAILED", message, { error: message });
      return this.finish();
    }
    const facts = this.deps.cta.inspect();
    this.emit("detect", `웨이팅 CTA를 관측했습니다: ${facts.label || "없음"}`, ctaData(facts));
    if (facts.onsiteOnly) {
      this.transition("HANDED_OFF", "이 식당은 현장 웨이팅만 받아 온라인 웨이팅 등록 대상이 아닙니다.");
      return this.finish();
    }
    if (!facts.present) {
      this.transition("HANDED_OFF", "매장 페이지 하단에서 온라인 웨이팅 버튼을 찾을 수 없습니다. 페이지를 준비한 뒤 다시 시작하세요.");
      return this.finish();
    }
    return null;
  }

  private async syncClock(): Promise<WaitingRunResult | null> {
    this.transition("SYNCING_CLOCK", "캐치테이블 서버 시계를 측정합니다.");
    const port = this.deps.referenceClock(this.config);
    this.referenceClockPort = port;
    const sample = await port.sampleOnce(this.controller.signal);
    if (this.controller.signal.aborted) return this.stopped();
    const estimate = sample ? port.ingest(sample) : port.latest ?? estimateReferenceClock([]);
    this.applyEstimate(estimate);
    this.emit("metric",
      estimate.source === "FALLBACK" ? "서버 시계 측정 실패로 로컬 시계를 사용합니다." : "서버 시계 보정을 완료했습니다.",
      clockData(estimate, this.wallOffsetMs()));
    void port.start((next) => this.applyEstimate(next));
    return null;
  }

  private async waitForOpen(): Promise<WaitingRunResult | null> {
    this.transition("WAITING_FOR_OPEN", "웨이팅 오픈 직전까지 대기합니다.");
    const estimate = this.referenceClockPort?.latest ?? estimateReferenceClock([]);
    const lead = armLeadMs(this.config, estimate);
    this.emit("metric", "웨이팅 CTA 감시 진입 시점을 결정했습니다.", {
      ...clockData(estimate, this.wallOffsetMs()),
      armLeadMs: Math.round(lead),
    });
    const result = await waitUntil(this.config.openAtMs - lead, {
      clock: this.serverClock,
      stopAtMs: this.config.stopAtMs,
      signal: this.controller.signal,
      sleep: this.deps.sleep,
      tickMs: 100,
    });
    // 감시 그리드 진입 전 앵커를 동결한다 — 재앵커가 감시 중 시각 기준을 흔들지 않게 한다.
    this.stopReferenceClock();
    if (result === "stopped") return this.stopped();
    if (result === "timed_out") return this.timedOut("감시 종료 시각에 도달했습니다.");
    return null;
  }

  /**
   * 무장 구간. 세 가지를 한 루프에서 돌린다.
   *  1. refreshIntervalMs마다 웨이팅 섹션 새로고침 클릭 — CTA 활성화가 서버 응답으로만
   *     반영되는 경우 이 갱신 없이는 버튼이 열리는 것을 볼 수 없다.
   *  2. pollIntervalMs 폴링으로 CTA 재검사.
   *  3. MutationObserver wake로 disabled 해제를 폴링보다 먼저 잡기.
   * 어느 신호로 깨어나도 검사·클릭 경로는 하나다.
   */
  private async watchAndRegister(): Promise<WaitingRunResult> {
    this.transition("WATCHING_WAITING_CTA", this.config.refreshIntervalMs > 0
      ? "새로고침을 반복하며 웨이팅 등록 버튼 활성화를 감시합니다."
      : "웨이팅 등록 버튼 활성화를 감시합니다.");
    const armedAtMonoMs = this.deps.monotonicClock.now();
    let woken = false;
    this.deps.wake?.start(() => {
      woken = true;
    });
    let checks = 0;
    let refreshClicks = 0;
    let refreshFailures = 0;
    let nextRefreshAtMonoMs = this.config.refreshIntervalMs > 0 ? armedAtMonoMs : Number.POSITIVE_INFINITY;
    let refreshMissingReported = false;
    let lastLabel = "";
    while (!this.controller.signal.aborted) {
      if (this.serverClock.now() >= this.config.stopAtMs) {
        return this.timedOut(
          `감시 종료 시각에 도달했습니다. CTA가 활성화되지 않았습니다(검사 ${checks}회, 새로고침 ${refreshClicks}회).`);
      }
      checks += 1;
      const facts = this.deps.cta.inspect();
      if (facts.label !== lastLabel) {
        lastLabel = facts.label;
        this.emit("detect", `웨이팅 CTA 문구가 바뀌었습니다: ${facts.label || "없음"}`, {
          ...ctaData(facts),
          ctaCheckCount: checks,
          ctaRefreshClickCount: refreshClicks,
          ctaWatchElapsedMs: Math.round(this.deps.monotonicClock.now() - armedAtMonoMs),
        });
      }
      // CTA 확인을 새로고침보다 먼저 한다 — 이미 열렸다면 갱신 요청 없이 즉시 클릭한다.
      if (facts.registerable) {
        return await this.register(facts, checks, armedAtMonoMs, woken, refreshClicks);
      }
      if (!facts.refreshAvailable && !refreshMissingReported && this.config.refreshIntervalMs > 0) {
        refreshMissingReported = true;
        this.emit("error", "웨이팅 섹션 새로고침 컨트롤을 찾을 수 없어 관측만 계속합니다.", ctaData(facts));
      }
      const nowMonoMs = this.deps.monotonicClock.now();
      if (nowMonoMs >= nextRefreshAtMonoMs) {
        nextRefreshAtMonoMs = nowMonoMs + this.config.refreshIntervalMs;
        if (this.deps.cta.clickRefresh()) {
          refreshClicks += 1;
        } else {
          refreshFailures += 1;
        }
        if (refreshClicks === 1 || refreshFailures === 1) {
          this.emit("action", refreshClicks === 1
            ? "웨이팅 새로고침을 시작했습니다."
            : "웨이팅 새로고침 클릭을 전달하지 못했습니다.", {
            ctaRefreshClickCount: refreshClicks,
            ctaRefreshFailureCount: refreshFailures,
            ctaRefreshIntervalMs: this.config.refreshIntervalMs,
          });
        }
      }
      const mutated = woken;
      woken = false;
      // wake가 왔으면 최소 지연으로 즉시 재검사한다. 0ms라도 반드시 await해서 이벤트
      // 루프를 넘겨야 한다 — 동기 루프는 페이지가 DOM을 갱신할 틈 자체를 막는다.
      const pollDelayMs = mutated ? 0 : this.config.pollIntervalMs;
      // 다음 새로고침 시각을 넘겨서 자지 않게 한다.
      const untilRefreshMs = Math.max(0, nextRefreshAtMonoMs - this.deps.monotonicClock.now());
      const delayMs = Math.min(pollDelayMs, untilRefreshMs);
      if (!(await this.deps.sleep(delayMs, this.controller.signal))) return this.stopped();
    }
    return this.stopped();
  }

  private async register(
    facts: WaitingCtaFacts,
    checks: number,
    armedAtMonoMs: number,
    woken: boolean,
    refreshClicks: number,
  ): Promise<WaitingRunResult> {
    const detectedAtMonoMs = this.deps.monotonicClock.now();
    const detectionData = {
      ...ctaData(facts),
      ctaCheckCount: checks,
      ctaRefreshClickCount: refreshClicks,
      ctaWatchElapsedMs: Math.round(detectedAtMonoMs - armedAtMonoMs),
      ctaDetectedByWake: woken,
      ctaDetectedServerLagMs: Math.round(this.serverClock.now() - this.config.openAtMs),
    };
    this.deps.wake?.stop();
    if (this.config.dryRun) {
      this.emit("detect", "웨이팅 등록 버튼 활성화를 감지했습니다(dry-run으로 클릭하지 않았습니다).", detectionData);
      this.transition("DRY_RUN_COMPLETED", "웨이팅 등록 버튼 활성화까지 확인했습니다. 등록 클릭은 하지 않았습니다.");
      return this.finish();
    }
    const clicked = this.deps.cta.clickRegister();
    const clickedAtMonoMs = this.deps.monotonicClock.now();
    if (!clicked) {
      this.emit("error", "웨이팅 등록 버튼 클릭을 전달하지 못했습니다.", detectionData);
      this.transition("HANDED_OFF", "웨이팅 등록 버튼을 클릭하지 못했습니다. 화면에서 직접 진행하세요.");
      return this.finish();
    }
    this.transition("WAITING_CTA_DISPATCHED", "웨이팅 등록 버튼을 클릭했습니다.", {
      ...detectionData,
      ctaClickLatencyMs: Math.round(clickedAtMonoMs - detectedAtMonoMs),
    });
    await this.observeAfterClick();
    this.transition("HANDED_OFF", "웨이팅 등록을 눌렀습니다. 이후 화면은 직접 확인하고 완료하세요.");
    return this.finish();
  }

  /** 클릭 후 화면 요약을 남긴다 — 자동 진행 없이 다음 단계 실측 근거만 모은다. */
  private async observeAfterClick(): Promise<void> {
    if (!this.deps.captureSnapshot) return;
    const deadlineMonoMs = this.deps.monotonicClock.now() + POST_CLICK_OBSERVE_MS;
    let lastFingerprint = "";
    while (this.deps.monotonicClock.now() < deadlineMonoMs && !this.controller.signal.aborted) {
      const snapshot = this.deps.captureSnapshot();
      if (snapshot && snapshot.fingerprint !== lastFingerprint) {
        lastFingerprint = snapshot.fingerprint;
        this.emit("detect", "웨이팅 등록 클릭 후 화면을 관측했습니다.", {
          postClickFingerprint: snapshot.fingerprint,
          postClickDialogLabel: snapshot.dialogLabel,
          postClickDialogTitle: snapshot.dialogTitle,
          postClickHeadings: snapshot.headings.join(" | "),
          postClickButtons: snapshot.buttons.join(" | "),
          postClickDisabledButtonCount: snapshot.disabledButtonCount,
          postClickTextSnippet: snapshot.textSnippet,
        });
      }
      if (!(await this.deps.sleep(POST_CLICK_SAMPLE_INTERVAL_MS, this.controller.signal))) return;
    }
  }

  private applyEstimate(estimate: ReferenceClockEstimate): void {
    // FALLBACK(표본 전무)은 offsetCenterMs=0이라 그대로 앵커하면 serverClock이 monotonic
    // 스케일로 고정된다. 이때는 "serverClock ≈ 로컬 wall"이 되게 wall−monotonic을 쓴다.
    const offset = estimate.source === "FALLBACK"
      ? this.deps.clock.now() - this.deps.monotonicClock.now()
      : estimate.offsetCenterMs;
    this.serverClock.anchor(this.deps.monotonicClock.now() + offset);
    this.serverClockReady = true;
  }

  private wallOffsetMs(): number {
    return this.serverClock.now() - this.deps.clock.now();
  }

  private stopReferenceClock(): void {
    const port = this.referenceClockPort;
    if (!port) return;
    this.referenceClockPort = null;
    try {
      port.stop();
    } catch {
      // 기준시계 정리 실패는 등록 결과를 바꾸지 않는다.
    }
  }

  private transition(to: RunState, reason: string, data?: RunEvent["data"]): void {
    this.machine.transition(to, reason);
    this.emit("state", reason, { ...data, state: to });
  }

  private emit(kind: RunEvent["kind"], message: string, data?: RunEvent["data"]): void {
    this.deps.emit({
      at: this.deps.clock.now(),
      serverAt: this.serverClockReady ? this.serverClock.now() : null,
      runId: this.runId,
      kind,
      message,
      ...(data === undefined ? {} : { data }),
    });
  }

  private stopped(): WaitingRunResult {
    if (this.machine.state !== "STOPPED") {
      this.machine.transition("STOPPED", "사용자가 중지했습니다.", { userStopped: true });
      this.emit("state", "사용자가 중지했습니다.", { state: "STOPPED" });
    }
    return this.finish();
  }

  private timedOut(message: string): WaitingRunResult {
    this.transition("TIMED_OUT", message);
    return this.finish();
  }

  private finish(): WaitingRunResult {
    const last = this.machine.history.at(-1);
    return { state: this.machine.state, message: last?.reason ?? "" };
  }
}

function ctaData(facts: WaitingCtaFacts): NonNullable<RunEvent["data"]> {
  return {
    ctaPresent: facts.present,
    ctaLabel: facts.label,
    ctaRegisterable: facts.registerable,
    ctaOnsiteOnly: facts.onsiteOnly,
    ctaRefreshAvailable: facts.refreshAvailable,
  };
}

function clockData(estimate: ReferenceClockEstimate, wallOffsetMs: number): NonNullable<RunEvent["data"]> {
  return {
    // clockOffsetMs는 사이드패널 카운트다운·오프셋 배지가 읽는 wall-clock 델타여야 한다.
    clockOffsetMs: Math.round(wallOffsetMs),
    clockUncertaintyMs: estimate.uncertaintyMs,
    clockConfidence: estimate.confidence,
    clockMedianRttMs: estimate.medianRttMs,
    clockP95RttMs: estimate.p95RttMs,
    clockSampleCount: estimate.sampleCount,
    clockSource: estimate.source,
  };
}

export function createWaitingCtaWake(document: Document): WaitingCtaWakePort {
  let observer: MutationObserver | null = null;
  return {
    start(onMutation) {
      if (observer) return;
      observer = new MutationObserver(onMutation);
      // dock 노드가 SPA 리렌더로 교체될 수 있어 body를 관측한다. attributeFilter로 좁혀
      // 무관한 속성 변경까지 wake로 번지지 않게 한다 — disabled 해제가 우리가 찾는 신호다.
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-disabled"],
      });
    },
    stop() {
      observer?.disconnect();
      observer = null;
    },
  };
}
