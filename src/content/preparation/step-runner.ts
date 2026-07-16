import type { Clock, Sleep } from "../../shared/scheduler.js";
import type { FailureVia, PreparationCause, PreparationStage } from "../../shared/run-control/causes.js";
import { classifyStall } from "../../shared/run-control/classifier.js";
import type { TraceAttributes } from "../../shared/telemetry/types.js";

export interface StepSpec<F> {
  stage: PreparationStage;
  inspect(): F;
  /** 관측 조건 변화 감지용 키 — 바뀔 때만 condition_changed를 보고한다. */
  conditionKey(f: F): string;
  conditionAttributes(f: F): TraceAttributes;
  isReady(f: F): boolean;
  /** classifier.ts의 stage별 fatal 분류 함수를 부분 적용해 주입한다 — 분류 정의는 classifier가 소유. */
  fatal(f: F): PreparationCause | null;
  canDispatch(f: F): boolean;
  dispatch(f: F): boolean;
  dispatchAction: string;
  describeDispatch(f: F, attempt: number): string;
  /** 내부 제어 신호(원인 코드 아님) — 토큰 반환 시 즉시 interrupted로 종료하고 coordinator가 해석한다. */
  interrupt?(f: F): PreparationInterrupt | null;
  /** 비어 있지 않은 값으로 바뀌면 다단 진행으로 보고 attempt 예산을 리셋한다. `""`는 판독 불가. */
  progressKey(f: F): string;
  dismissObstacle?(f: F): boolean;
  dismissMessage?: string;
  maxAttempts: number;
  retryDelayMs: number;
  /** 첫 dispatch 기준 확인 한계. 없으면 overall deadline만 적용(달력 계열). */
  confirmTimeoutMs?: number;
}

/** 내부 제어 신호의 closed union — 원인 코드와 분리된 어휘. 새 재순환 신호는 여기에 추가한다. */
export type PreparationInterrupt = "target_cell_missing";

export type StepOutcome =
  | { kind: "ready" }
  | { kind: "failed"; cause: PreparationCause; via: FailureVia; attempts: number }
  | { kind: "interrupted"; token: PreparationInterrupt; attempts: number }
  | { kind: "stopped" }
  | { kind: "timed_out" };

export interface StepReporter {
  stageStart(): void;
  conditionChanged(attributes: TraceAttributes): void;
  dispatchBefore(action: string, attempt: number): void;
  dispatchAfter(action: string, attempt: number, dispatched: boolean): void;
  obstacleDismissed(): void;
  decision(decision: "ready" | "handoff", cause: PreparationCause | null, attempts: number): void;
  action(message: string): void;
}

export interface StepRunOptions {
  clock: Clock;
  sleep: Sleep;
  signal: AbortSignal;
  stopAtMs: number;
  discoveryDeadlineAtMs: number;
  overallDeadlineAtMs: number;
  report: StepReporter;
  pollMs?: number;
}

/** closed union의 exhaustive 처리 보조 — 미처리 variant를 컴파일·런타임 양쪽에서 잡는다. */
export function assertNever(value: never): never {
  throw new Error(`처리되지 않은 variant: ${String(value)}`);
}

export async function runPreparationStep<F>(
  spec: StepSpec<F>,
  options: StepRunOptions,
): Promise<StepOutcome> {
  const pollMs = options.pollMs ?? 50;
  const overallAt = Math.min(options.overallDeadlineAtMs, options.stopAtMs);
  const discoveryAt = Math.min(options.discoveryDeadlineAtMs, overallAt);
  let attempts = 0;
  let nextDispatchAt: number | null = null;
  let confirmDeadlineAt: number | null = null;
  let lastConditionKey = "";
  let lastProgressKey = "";
  options.report.stageStart();

  const fail = (cause: PreparationCause, via: FailureVia): StepOutcome => {
    options.report.decision("handoff", cause, attempts);
    return { kind: "failed", cause, via, attempts };
  };

  while (true) {
    if (options.signal.aborted) return { kind: "stopped" };
    const now = options.clock.now();
    if (now >= options.stopAtMs) return { kind: "timed_out" };

    const facts = spec.inspect();
    const conditionKey = spec.conditionKey(facts);
    if (conditionKey !== lastConditionKey) {
      lastConditionKey = conditionKey;
      options.report.conditionChanged(spec.conditionAttributes(facts));
    }
    if (spec.isReady(facts)) {
      options.report.decision("ready", null, attempts);
      return { kind: "ready" };
    }
    const interrupt = spec.interrupt?.(facts) ?? null;
    if (interrupt !== null) return { kind: "interrupted", token: interrupt, attempts };
    const fatal = spec.fatal(facts);
    if (fatal !== null) return fail(fatal, "fatal");

    const progressKey = spec.progressKey(facts);
    if (progressKey !== "" && lastProgressKey !== "" && progressKey !== lastProgressKey) {
      attempts = 0;
      nextDispatchAt = null;
      confirmDeadlineAt = null;
    }
    if (progressKey !== "") lastProgressKey = progressKey;

    if (attempts > 0 && spec.dismissObstacle?.(facts)) {
      options.report.obstacleDismissed();
      if (spec.dismissMessage) options.report.action(spec.dismissMessage);
      nextDispatchAt = now;
    }

    const canDispatch = spec.canDispatch(facts)
      && attempts < spec.maxAttempts
      && (attempts === 0 || (nextDispatchAt !== null && now >= nextDispatchAt));
    if (canDispatch) {
      const attempt = attempts + 1;
      options.report.dispatchBefore(spec.dispatchAction, attempt);
      const dispatched = spec.dispatch(facts);
      attempts = attempt;
      options.report.dispatchAfter(spec.dispatchAction, attempt, dispatched);
      if (dispatched) options.report.action(spec.describeDispatch(facts, attempt));
      if (spec.confirmTimeoutMs !== undefined) {
        confirmDeadlineAt ??= Math.min(now + spec.confirmTimeoutMs, options.stopAtMs);
      }
      nextDispatchAt = now + spec.retryDelayMs;
    }

    if (attempts === 0 && now >= discoveryAt) {
      return fail(classifyStall(spec.stage, 0), now >= overallAt ? "deadline" : "discovery");
    }
    if (attempts > 0) {
      const exhausted = attempts >= spec.maxAttempts
        && nextDispatchAt !== null && now >= nextDispatchAt;
      const confirmExpired = confirmDeadlineAt !== null && now >= confirmDeadlineAt;
      if (exhausted || confirmExpired) return fail(classifyStall(spec.stage, attempts), "exhausted");
      if (now >= overallAt) return fail(classifyStall(spec.stage, attempts), "deadline");
    }

    if (!(await options.sleep(pollMs, options.signal))) return { kind: "stopped" };
  }
}
