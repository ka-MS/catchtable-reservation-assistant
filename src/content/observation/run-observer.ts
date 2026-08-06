// 실행 관측(telemetry) 계층 — 스탬핑, 예외 경계, 관측 정책을 소유한다.
//
// SP-025/01. 제어(`RunSession`)에서 관측을 떼어낸다. payload 조립은
// `payloads.ts`의 순수 함수가 맡고, 이 클래스는 그것을 언제 어떤 스탬프와
// 어떤 예외 경계로 내보낼지만 정한다.
//
// ⚠️ 예외 격리는 현재 동작을 그대로 보존한다. 통일하지 않는다.
//
// `trace` 호출은 두 종류다.
//   - `sendSafe(...)` — 예외를 삼킨다. 이동 전 `try/catch`로 감싸여 있던 지점.
//   - `send(...)`     — 예외를 전파한다. 이동 전 감싸여 있지 않던 지점.
//
// 전파 지점에서 exporter가 던지면 실행이 `FAILED`로 종결된다(`emit`은 더
// 나아가 `RunResult` 자체를 막는다). 이 비대칭은 의도된 설계가 아니라
// 누적된 결과이며, 통일 여부는 issue #20에서 판단한다. 이 계층의 목적 중
// 하나는 **어느 관측이 실행을 죽일 수 있는지를 호출부에서 보이게** 하는 것이다.
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

  /** 범용 격리 헬퍼. 대상마다 fallback이 다르므로 값을 받는다. */
  private safeCall<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      return fallback; // 관측은 예약 결과를 바꾸지 않는다.
    }
  }

  /** 예외를 전파한다. 이동 전 감싸여 있지 않던 지점 전용. */
  private send(
    code: TraceCode,
    severity: TraceSeverity,
    message: string,
    options: { serverAt?: number | null; state?: RunState | null; attributes: TraceAttributes; error?: unknown },
  ): void {
    this.deps.trace?.(code, severity, message, options);
  }

  /**
   * 예외를 삼킨다. **thunk를 받는 이유**: 인자로 options 객체를 받으면
   * `ctx.serverAt()`·`ctx.state()`가 호출 전에 평가돼 경계 밖에서 던진다.
   * 이동 전에는 스탬핑 계산까지 `try` 안에 있었으므로 그 범위를 보존한다.
   */
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
    const at = this.ctx.now();
    this.deps.emit({ at, serverAt: this.ctx.serverAt(), runId: this.runId, kind, message, data });
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
   * 전파한다. 호출자(`onAvailabilityBody`)가 자체 `try/catch`로 감싸고 있으며,
   * 그 catch가 뒤따르는 late DOM 비교까지 함께 건너뛰는 것이 현재 동작이다.
   * 여기서 삼키면 그 건너뜀이 사라져 동작이 바뀐다.
   */
  availabilityBody(
    event: ReceivedAvailabilityShadowEvent,
    correlation: BodyCorrelation,
    decision: AvailabilityWakeDecision,
    selectedMinutes: number | null,
    matchesTarget: boolean,
    wakeAtMonoMs: number,
  ): void {
    this.send("AVAILABILITY_SHADOW", event.classification === "UNPARSABLE" ? "warn" : "trace",
      `슬롯 응답 shadow를 ${event.classification}로 분류했습니다.`, {
        serverAt: this.ctx.serverAt(),
        state: this.ctx.state(),
        attributes: availabilityBodyAttributes(
          event, correlation, decision, selectedMinutes, matchesTarget, wakeAtMonoMs),
      });
  }

  /** 전파한다. 두 호출자 모두 자체 `try/catch` 안에서 부른다. */
  availabilityDom(correlation: DomCorrelation, phase: "dom_compare" | "dom_compare_late"): void {
    this.send("AVAILABILITY_SHADOW", "trace", "body와 DOM 슬롯 후보를 비교했습니다.", {
      serverAt: this.ctx.serverAt(),
      state: this.ctx.state(),
      attributes: domCorrelationAttributes(correlation, phase),
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
   * ⚠️ 전파한다. 이 지점의 exporter 예외는 실행을 `FAILED`로 종결시킨다.
   * 이동 전에도 감싸여 있지 않았다(issue #20).
   *
   * `serverAt`·`state`는 호출자가 넘긴 값을 쓴다 — 이동 전에도 컨텍스트가
   * 아니라 명시값(`REFRESHING_SLOTS`)이었다.
   */
  toggleCycle(serverAt: number, trace: ToggleCycleTrace): void {
    const { result } = trace;
    this.send(
      "DATE_TOGGLE_CYCLE",
      result === "NO_SLOT" || result === "SLOT_FOUND" || result === "EMPTY_EARLY_EXIT" ? "trace" : "warn",
      `날짜 토글 #${trace.cycle}: ${result}`,
      { serverAt, state: "REFRESHING_SLOTS", attributes: toggleCycleAttributes(trace) },
    );
  }

  /** ⚠️ 전파한다. 이동 전에도 감싸여 있지 않았다(issue #20). */
  slotClicked(
    severity: TraceSeverity,
    message: string,
    serverAt: number,
    state: RunState,
    attributes: TraceAttributes,
  ): void {
    this.send("SLOT_CLICKED", severity, message, { serverAt, state, attributes });
  }

  /** ⚠️ 전파한다. `execute()`의 catch 안에서 불리며 감싸여 있지 않다(issue #20). */
  runFailed(message: string, attributes: TraceAttributes, error: unknown): void {
    this.send("RUN_FAILED", "error", message, {
      serverAt: this.ctx.serverAt(),
      state: "FAILED",
      attributes,
      error,
    });
  }
}
