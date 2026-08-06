// 실행 관측(telemetry) 계층 — 스탬핑, 예외 경계, 관측 정책을 소유한다.
//
// SP-025/01. 제어(`RunSession`)에서 관측을 떼어낸다. payload 조립은
// `payloads.ts`의 순수 함수가 맡고, 이 클래스는 그것을 언제 어떤 스탬프와
// 어떤 예외 경계로 내보낼지만 정한다.
//
// **계약: 관측은 예약 실행을 중단시키지 않는다. 대신 실패를 셈해 드러낸다.**
//
// 이 클래스의 모든 공개 메서드는 예외를 밖으로 내보내지 않는다. 지점별로
// 다르지 않다(SP-026). 삼킨 횟수는 `observationFailures()`로 노출되고
// terminal 상태 전이 event에 `observationFailureCount`로 실린다.
//
// 이전에는 격리가 비대칭이었다 — `trace` 10곳 중 6곳만 감싸여 있어 나머지
// 에서 exporter가 던지면 실행이 `FAILED`로 죽었고, `emit`은 `RunResult`
// 자체를 막았다. 의도된 설계가 아니라 누적된 결과였다(issue #20).
import type { ReferenceClockSample } from "../../shared/clock.js";
import type { RunEvent, RunExecutionContext, RunState } from "../../shared/types.js";
import type { TraceCode } from "../../shared/telemetry/codes.js";
import type { TraceAttributes, TraceSeverity } from "../../shared/telemetry/types.js";
import type { ReceivedAvailabilityShadowEvent } from "../../shared/availability-shadow.js";
import type { BodyCorrelation, DomCorrelation } from "../availability-correlation.js";
import type { AvailabilityWakeDecision, AvailabilityWakeSignal } from "../availability-dom-wake.js";
import type { PreparationPageContext } from "../preparation-observation.js";
import type { StageSnapshot } from "../adapter/snapshot.js";
import {
  availabilityBodyAttributes,
  clockSampleAttributes,
  domCorrelationAttributes,
  emptyExitAttributes,
  preparationAttributes,
  stageSnapshotData,
  toggleCycleAttributes,
  wakeResultAttributes,
  type ToggleCycleTrace,
} from "./payloads.js";

/** 관측이 세션에서 읽는 것 — 이 셋이 전부다. */
export interface ObservationContext {
  /** wall clock — `RunEvent.at`. */
  now(): number;
  /** 기준시계가 준비되기 전에는 `null`. */
  serverAt(): number | null;
  state(): RunState;
  monoNow(): number;
}

type TraceFn = (
  code: TraceCode,
  severity: TraceSeverity,
  message: string,
  options?: {
    serverAt?: number | null;
    state?: RunState | null;
    attributes?: TraceAttributes;
    error?: unknown;
  },
) => void;

export interface DiagnosticsPort {
  breadcrumb(stage: RunState, trigger: "state" | "action", reason: string, data?: RunEvent["data"]): void;
  failure(stage: RunState, reason: string, data?: RunEvent["data"], error?: unknown): string | null;
  forceFlush(): Promise<void>;
}

export interface ObservationDeps {
  emit(event: RunEvent): void;
  trace?: TraceFn;
  diagnostics?: DiagnosticsPort;
  captureSnapshot?(): StageSnapshot | null;
  capturePreparationContext?(): PreparationPageContext;
}

// REFRESHING_SLOTS와 SLOT_DETECTED는 클릭 직전 핫패스다. 초기 설정 상태도
// 쓸 만한 DOM 근거를 더하지 않으므로, 저빈도 예약 단계만 breadcrumb을 만든다.
const DIAGNOSTIC_BREADCRUMB_STATES = new Set<RunState>([
  "ENTERING_RESERVATION",
  "SELECTING_DATE",
  "SELECTING_PERSON",
  "PREPARING_PAGE",
  "WAITING_FOR_OPEN",
  "SLOT_CLICK_DISPATCHED",
  "SLOT_TRANSITION_CONFIRMED",
  "ADVANCING_RESERVATION",
  "COMPLETING_RESERVATION",
]);

export type PreparationPhase =
  | "stage_start" | "condition_changed" | "dispatch_before" | "dispatch_after" | "decision";

export interface FrozenClockSamples {
  reason: "armed" | "terminal";
  samples: ReferenceClockSample[];
}

export class RunObserver {
  constructor(
    private readonly ctx: ObservationContext,
    private readonly deps: ObservationDeps,
    private readonly runId: string,
    private readonly executionContext?: RunExecutionContext,
  ) {}

  /** 삼킨 관측 실패 횟수. 원인·지점은 남기지 않는다(20-design §한계 3). */
  private failureCount = 0;

  /** terminal 전이가 읽어 `observationFailureCount`로 싣는다. */
  observationFailures(): number {
    return this.failureCount;
  }

  /**
   * 유일한 격리 지점. 대상마다 fallback이 다르므로 값을 받는다.
   *
   * ⚠️ **thunk를 받는 이유**: 인자로 조립된 값을 받으면 `ctx.serverAt()` 같은
   * 스탬핑이 호출 전에 평가돼 경계 밖에서 던진다. payload 조립까지 전부
   * 이 안에서 일어나야 한다.
   */
  private safeCall<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      this.failureCount += 1;
      return fallback; // 관측은 예약 결과를 바꾸지 않는다.
    }
  }

  /** 원시 전송. 반드시 `sendSafe` 안에서만 호출한다. */
  private send(
    code: TraceCode,
    severity: TraceSeverity,
    message: string,
    options: { serverAt?: number | null; state?: RunState | null; attributes: TraceAttributes; error?: unknown },
  ): void {
    this.deps.trace?.(code, severity, message, options);
  }

  /** 스탬핑·payload 조립·전송을 하나의 경계 안에서 수행한다. */
  private sendSafe(build: () => void): void {
    this.safeCall(build, undefined);
  }

  // --- Run event와 breadcrumb ----------------------------------------------

  /**
   * ⚠️ `deps.emit`은 격리하지 않는다. 이동 전에도 감싸여 있지 않았고,
   * 던지면 `RunResult` 자체가 반환되지 않는다(issue #20). run event는
   * Side Panel 표시와 telemetry의 필수 경로다.
   *
   * 뒤따르는 breadcrumb만 격리된다 — 이동 전 구조와 같다.
   */
  event(kind: RunEvent["kind"], message: string, data?: RunEvent["data"]): void {
    // emit과 breadcrumb은 **별도 경계**다. 저장 경로가 다르므로 emit이
    // 실패해도 breadcrumb은 시도되어야 한다.
    this.safeCall(() => {
      const at = this.ctx.now();
      this.deps.emit({ at, serverAt: this.ctx.serverAt(), runId: this.runId, kind, message, data });
    }, undefined);
    if (kind === "action") {
      this.safeCall(
        () => this.deps.diagnostics?.breadcrumb(this.ctx.state(), "action", message, data),
        undefined,
      );
    }
  }

  /** 상태 전이 breadcrumb. 어느 상태가 대상인지는 관측 정책이다. */
  stateChanged(state: RunState, reason: string, data?: RunEvent["data"]): void {
    if (!DIAGNOSTIC_BREADCRUMB_STATES.has(state)) return;
    this.safeCall(() => this.deps.diagnostics?.breadcrumb(state, "state", reason, data), undefined);
  }

  /**
   * 관측이 제어에 **값을 주는 유일한 지점**이다. 명령이 아니라 질의라
   * 관측 계층에 둔다. 제어는 이 반환값을 terminal 전이 payload에 싣는다.
   *
   * snapshot 캡처와 `diagnostics.failure`는 **서로 독립**이다. 이동 전에도
   * 별도 try 블록이었고, snapshot이 실패해도 failure는 실행된다.
   */
  failureData(reason: string, extra?: RunEvent["data"], error?: unknown): RunEvent["data"] {
    const snapshot = this.safeCall<StageSnapshot | null>(() => this.deps.captureSnapshot?.() ?? null, null);
    const state = this.ctx.state();
    const diagnosticSnapshotId = this.safeCall<string | null>(
      () => this.deps.diagnostics?.failure(state, reason, extra, error) ?? null,
      null,
    );
    return {
      ...stageSnapshotData(snapshot),
      snapshotRunState: state,
      ...(diagnosticSnapshotId === null ? {} : { diagnosticSnapshotId }),
      ...extra,
    };
  }

  // --- 준비 단계 -----------------------------------------------------------

  /** 격리됨. 페이지 컨텍스트 캡처 실패는 별도로 흡수하고 trace는 계속 나간다. */
  preparation(phase: PreparationPhase, attributes: TraceAttributes = {}, severity: TraceSeverity = "trace"): void {
    this.sendSafe(() => {
      const page = this.safeCall<PreparationPageContext | null>(
        () => this.deps.capturePreparationContext?.() ?? null,
        null,
      );
      const state = this.ctx.state();
      this.send("PREPARATION_OBSERVED", severity, `준비 단계 ${phase} 상태를 기록했습니다.`, {
        serverAt: this.ctx.serverAt(),
        state,
        attributes: preparationAttributes(state, phase, this.executionContext, page, attributes),
      });
    });
  }

  // --- Availability shadow -------------------------------------------------

  /**
   * 격리됨. 호출자(`onAvailabilityBody`)의 `try/catch`는 비신뢰 bridge
   * payload로부터 **제어**를 보호하는 것이 목적이며 그대로 둔다.
   *
   * 이전에는 이 trace 실패가 호출자 catch에 걸려 **뒤따르는 late DOM 비교까지
   * 건너뛰게** 만들었다. 이제 두 관측은 독립이다(SP-026).
   */
  availabilityBody(
    event: ReceivedAvailabilityShadowEvent,
    correlation: BodyCorrelation,
    decision: AvailabilityWakeDecision,
    selectedMinutes: number | null,
    matchesTarget: boolean,
    wakeAtMonoMs: number,
  ): void {
    this.sendSafe(() => {
      this.send("AVAILABILITY_SHADOW", event.classification === "UNPARSABLE" ? "warn" : "trace",
        `슬롯 응답 shadow를 ${event.classification}로 분류했습니다.`, {
          serverAt: this.ctx.serverAt(),
          state: this.ctx.state(),
          attributes: availabilityBodyAttributes(
            event, correlation, decision, selectedMinutes, matchesTarget, wakeAtMonoMs),
        });
    });
  }

  /** 격리됨. 호출자의 `try/catch`는 제어 보호용이며 그대로 둔다. */
  availabilityDom(correlation: DomCorrelation, phase: "dom_compare" | "dom_compare_late"): void {
    this.sendSafe(() => {
      this.send("AVAILABILITY_SHADOW", "trace", "body와 DOM 슬롯 후보를 비교했습니다.", {
        serverAt: this.ctx.serverAt(),
        state: this.ctx.state(),
        attributes: domCorrelationAttributes(correlation, phase),
      });
    });
  }

  /** 격리됨. */
  wakeResult(
    signal: Extract<AvailabilityWakeSignal, { kind: "scan_wake" }>,
    candidateObservedMonoMs: number | null,
    candidateFound: boolean,
    fallbackUsed: boolean,
    scanCount: number,
    baselineNextScanAtMonoMs: number | null,
    wakeScanAtMonoMs: number | null,
  ): void {
    this.sendSafe(() => {
      this.send("AVAILABILITY_SHADOW", "trace", "body wake-up 이후 DOM 후보를 확인했습니다.", {
        serverAt: this.ctx.serverAt(),
        state: this.ctx.state(),
        attributes: wakeResultAttributes(signal, candidateObservedMonoMs, candidateFound,
          fallbackUsed, scanCount, baselineNextScanAtMonoMs, wakeScanAtMonoMs),
      });
    });
  }

  /**
   * 격리됨. 스캔 루프 안에서 호출되지만 조건부이고 사이클당 최대 1회이며,
   * 호출 직후 루프를 벗어난다. **매 반복 경로에는 관측이 없어야 한다.**
   */
  emptyExit(
    signal: Extract<AvailabilityWakeSignal, { kind: "empty_exit" }>,
    targetStillSelected: boolean,
    finalDomCandidateFound: boolean,
  ): void {
    this.sendSafe(() => {
      const exitAtMonoMs = this.ctx.monoNow();
      const message = finalDomCandidateFound
        ? "EXACT EMPTY 응답 직후 슬롯 DOM 후보를 확인해 조기 종료하지 않았습니다."
        : targetStillSelected
          ? "EXACT EMPTY 응답으로 현재 날짜 토글 cycle을 종료했습니다."
          : "EXACT EMPTY 응답을 받았지만 목표 날짜 선택이 풀려 조기 종료하지 않았습니다.";
      this.send("AVAILABILITY_SHADOW", "trace", message, {
        serverAt: this.ctx.serverAt(),
        state: this.ctx.state(),
        attributes: emptyExitAttributes(signal, targetStillSelected, finalDomCandidateFound, exitAtMonoMs),
      });
    });
  }

  // --- 기준시계 원시 표본 ---------------------------------------------------

  /** 표본마다 개별 격리. 하나가 실패해도 나머지는 계속 기록된다. */
  clockSamples(frozen: FrozenClockSamples): void {
    if (frozen.samples.length === 0) return;
    const total = frozen.samples.length;
    frozen.samples.forEach((sample, index) => {
      this.sendSafe(() => {
        this.send("CLOCK_SAMPLE", "trace", `기준시계 원시 표본 ${index + 1}/${total}을 기록했습니다.`, {
          serverAt: this.ctx.serverAt(),
          // Raw 진단 event가 terminal prune를 반복 트리거하지 않도록 run state는 싣지 않는다.
          state: null,
          attributes: clockSampleAttributes(sample, index, total, frozen.reason),
        });
      });
    });
  }

  // --- 핫패스 ---------------------------------------------------------------

  /**
   * 격리됨. 이전에는 이 지점의 exporter 예외가 실행을 `FAILED`로 종결시켰다.
   *
   * `serverAt`·`state`는 호출자가 넘긴 값을 쓴다 — 이동 전에도 컨텍스트가
   * 아니라 명시값(`REFRESHING_SLOTS`)이었다.
   */
  toggleCycle(serverAt: number, trace: ToggleCycleTrace): void {
    this.sendSafe(() => {
      const { result } = trace;
      this.send(
        "DATE_TOGGLE_CYCLE",
        result === "NO_SLOT" || result === "SLOT_FOUND" || result === "EMPTY_EARLY_EXIT" ? "trace" : "warn",
        `날짜 토글 #${trace.cycle}: ${result}`,
        { serverAt, state: "REFRESHING_SLOTS", attributes: toggleCycleAttributes(trace) },
      );
    });
  }

  /** 격리됨. 이전에는 전파해 실행을 `FAILED`로 종결시켰다. */
  slotClicked(
    severity: TraceSeverity,
    message: string,
    serverAt: number,
    state: RunState,
    attributes: TraceAttributes,
  ): void {
    this.sendSafe(() => {
      this.send("SLOT_CLICKED", severity, message, { serverAt, state, attributes });
    });
  }

  /** 격리됨. `execute()`의 catch 안에서 불리므로 던지면 `start()`가 reject된다. */
  runFailed(message: string, attributes: TraceAttributes, error: unknown): void {
    this.sendSafe(() => {
      this.send("RUN_FAILED", "error", message, {
        serverAt: this.ctx.serverAt(),
        state: "FAILED",
        attributes,
        error,
      });
    });
  }
}
