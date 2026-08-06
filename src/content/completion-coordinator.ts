import type { CompletionDispatchPhase } from "../shared/run-control/protocol.js";
import type { TraceAttributes } from "../shared/telemetry/types.js";
import type { ReservationConfig } from "../shared/types.js";
import { fnvHash } from "./adapter/dom.js";
import {
  ReservationFormAdapter,
  type ReservationFormInspectOptions,
  type ReservationFormInspection,
} from "./adapter/reservation-form.js";

export interface ReservationCompletionIntent {
  shopSlug: string;
  shopDisplayName: string;
  reservationDate: string;
  selectedMinutes: number;
  personCount: number;
}

export type CompletionResult =
  | { kind: "completed"; message: string }
  /** evidence는 폼 판정으로 인계된 경우의 근거다. 다른 인계 경로는 남길 근거가 없어 생략한다. */
  | { kind: "handed_off"; message: string; claimed: boolean; evidence?: TraceAttributes }
  | { kind: "stopped"; message: string }
  | { kind: "timed_out"; message: string };

interface CompletionDependencies {
  adapter: ReservationFormAdapter;
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<boolean>;
  claim(phase: CompletionDispatchPhase, fingerprint: string): Promise<boolean>;
  telemetry?(phase: CompletionTelemetryPhase, attributes: TraceAttributes): void;
}

export type CompletionTelemetryPhase =
  | "form_ready"
  | "payment_authorization"
  | "outer_claim"
  | "outer_dispatch"
  | "pin_surface"
  | "pin_claim"
  | "pin_dispatch"
  | "success_observed";

const RESULT_TIMEOUT_MS = 15_000;
const PIN_APPEARANCE_TIMEOUT_MS = 15_000;
const PIN_POLL_MS = 100;
const AGREEMENT_SETTLE_MS = 250;
const PIN_DIGIT_SETTLE_MS = 100;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function options(intent: ReservationCompletionIntent, maxPaymentAmountKrw: number): ReservationFormInspectOptions {
  const [year, month, day] = intent.reservationDate.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return {
    expectation: {
      shopDisplayName: intent.shopDisplayName,
      dateText: `${String(month).padStart(2, "0")}월 ${String(day).padStart(2, "0")}일`,
      personText: `${intent.personCount}명`,
    },
    successExpectation: {
      shopDisplayName: intent.shopDisplayName,
      listingDateText: `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")} (${weekday})`,
      personText: `${intent.personCount}명`,
    },
    maxPaymentAmountKrw,
  };
}

function dispatchFingerprint(
  intent: ReservationCompletionIntent,
  amount: number,
  formFingerprint: string,
): string {
  return fnvHash(JSON.stringify({
    shopSlug: intent.shopSlug,
    reservationDate: intent.reservationDate,
    selectedMinutes: intent.selectedMinutes,
    personCount: intent.personCount,
    amount,
    formFingerprint,
  }));
}

function successful(
  inspection: ReservationFormInspection,
): inspection is Extract<ReservationFormInspection, { kind: "success" }> {
  return inspection.kind === "success"
    && inspection.facts.path === "/ct/mydining/my/planned"
    && inspection.facts.matchedMessage
    && inspection.facts.listingMatch;
}

export class CompletionCoordinator {
  constructor(private readonly deps: CompletionDependencies) {}

  private telemetry(phase: CompletionTelemetryPhase, attributes: TraceAttributes): void {
    try {
      this.deps.telemetry?.(phase, attributes);
    } catch {
      // Completion telemetry must not affect reservation control.
    }
  }

  async run(
    config: ReservationConfig,
    intent: ReservationCompletionIntent,
    signal: AbortSignal,
    takePin: () => string | undefined,
  ): Promise<CompletionResult> {
    if (this.deps.now() >= config.stopAtMs) {
      return { kind: "timed_out", message: "최종 제출 전에 감시 종료 시각에 도달했습니다." };
    }
    const inspectOptions = options(intent, config.maxPaymentAmountKrw);
    const baseline = this.deps.adapter.inspect(inspectOptions);
    if (baseline.kind !== "ready") {
      const reason = baseline.kind === "unknown" ? baseline.code : baseline.kind;
      return {
        kind: "handed_off",
        message: `예약 폼의 로그인·예약 내용·CatchPay·금액을 안전하게 확인하지 못했습니다. (${reason})`,
        claimed: false,
        evidence: baseline.kind === "unknown"
          ? baseline.evidence
          : { formInspectionKind: baseline.kind },
      };
    }
    this.telemetry("form_ready", {
      currentAmountKrw: baseline.facts.currentAmountKrw,
      catchPaySelected: baseline.facts.catchPayChecked,
      generalPaymentSelected: baseline.facts.generalPaymentSelected,
      requiredAgreementCount: baseline.facts.requiredAgreementCount,
      uncheckedRequiredAgreementCount: baseline.facts.uncheckedRequiredAgreementCount,
      emptyRequiredMultilineCount: baseline.facts.emptyRequiredMultilineCount,
      optionalAgreementCount: baseline.facts.optionalAgreementCount,
    });
    if (baseline.facts.currentAmountKrw === 0) {
      // 0원 실행에는 PIN이 필요하지 않으므로 폼 판정 즉시 one-shot handle을 비운다.
      void takePin();
    }
    const optionalBaseline = baseline.facts.optionalAgreementFingerprint;

    for (let guard = 0; guard < 32; guard += 1) {
      if (signal.aborted) return { kind: "stopped", message: "최종 제출 전에 실행이 중지됐습니다." };
      if (this.deps.now() >= config.stopAtMs) {
        return { kind: "timed_out", message: "최종 제출 전에 감시 종료 시각에 도달했습니다." };
      }
      const inspection = this.deps.adapter.inspect(inspectOptions);
      if (inspection.kind !== "ready" || inspection.facts.optionalAgreementFingerprint !== optionalBaseline) {
        return {
          kind: "handed_off",
          message: "필수 입력 처리 중 예약 폼이 변경돼 제출하지 않습니다.",
          claimed: false,
          evidence: inspection.kind === "unknown"
            ? inspection.evidence
            : { formInspectionKind: inspection.kind, formOptionalAgreementChanged: inspection.kind === "ready" },
        };
      }
      if (inspection.facts.emptyRequiredMultilineCount > 0) {
        if (!this.deps.adapter.fillRequiredMultiline(inspection.fingerprint, config.requiredFormDefaultAnswer)) {
          return { kind: "handed_off", message: "필수 입력을 안전하게 채울 수 없어 제출하지 않습니다.", claimed: false };
        }
        continue;
      }
      if (inspection.facts.uncheckedRequiredAgreementCount > 0) {
        const uncheckedBefore = inspection.facts.uncheckedRequiredAgreementCount;
        if (!this.deps.adapter.agreeRequired(inspection.fingerprint)) {
          return { kind: "handed_off", message: "필수 약관만 안전하게 동의할 수 없어 제출하지 않습니다.", claimed: false };
        }
        if (!(await this.deps.sleep(AGREEMENT_SETTLE_MS, signal))) {
          return { kind: "stopped", message: "필수 약관 확인 중 실행이 중지됐습니다." };
        }
        const settled = this.deps.adapter.inspect(inspectOptions);
        if (settled.kind !== "ready"
          || settled.facts.optionalAgreementFingerprint !== optionalBaseline
          || settled.facts.uncheckedRequiredAgreementCount >= uncheckedBefore) {
          return { kind: "handed_off", message: "필수 약관 동의 반영을 확인할 수 없어 재클릭하지 않습니다.", claimed: false };
        }
        continue;
      }

      let pin = inspection.facts.currentAmountKrw > 0 ? takePin() : undefined;
      if (inspection.facts.currentAmountKrw > 0) {
        this.telemetry("payment_authorization", { paymentPinProvided: pin !== undefined });
      }
      if (inspection.facts.currentAmountKrw > 0 && pin === undefined) {
        return { kind: "handed_off", message: "유료 CatchPay 예약에는 이번 수동 실행의 일회성 PIN이 필요합니다.", claimed: false };
      }
      if (this.deps.now() >= config.stopAtMs) {
        pin = undefined;
        return { kind: "timed_out", message: "최종 제출 전에 감시 종료 시각에 도달했습니다." };
      }
      const outerFingerprint = dispatchFingerprint(intent, inspection.facts.currentAmountKrw, inspection.fingerprint);
      const outerClaimed = await this.deps.claim("outer", outerFingerprint);
      this.telemetry("outer_claim", { claimGranted: outerClaimed });
      if (!outerClaimed) {
        return { kind: "handed_off", message: "최종 제출 클릭 권한을 얻지 못해 제출하지 않습니다.", claimed: false };
      }
      try {
        const outerDispatched = this.deps.adapter.submitOuter(inspection.fingerprint);
        this.telemetry("outer_dispatch", { dispatched: outerDispatched });
        if (!outerDispatched) {
          return { kind: "handed_off", message: "클릭 권한 부여 뒤 폼이 변경돼 결과를 확인할 수 없습니다. 자동 재제출하지 않습니다.", claimed: true };
        }
        if (inspection.facts.currentAmountKrw === 0) {
          return await this.observeSuccess(inspectOptions, signal);
        }
        return await this.completePin(
          inspectOptions,
          outerFingerprint,
          inspection.facts.currentAmountKrw,
          pin!,
          signal,
        );
      } catch {
        return {
          kind: "handed_off",
          message: "최종 제출 클릭 권한 부여 뒤 오류가 발생해 결과를 확인할 수 없습니다. 자동 재제출하지 않습니다.",
          claimed: true,
        };
      } finally {
        pin = undefined;
      }
    }
    return { kind: "handed_off", message: "필수 입력 반복 상한에 도달해 제출하지 않습니다.", claimed: false };
  }

  private async completePin(
    inspectOptions: ReservationFormInspectOptions,
    outerFingerprint: string,
    expectedAmountKrw: number,
    pin: string,
    signal: AbortSignal,
  ): Promise<CompletionResult> {
    const deadline = this.deps.now() + PIN_APPEARANCE_TIMEOUT_MS;
    while (!signal.aborted && this.deps.now() < deadline) {
      const inspection = this.deps.adapter.inspect(inspectOptions);
      if (inspection.kind === "pin") {
        this.telemetry("pin_surface", {
          sameOrigin: inspection.facts.sameOrigin,
          sameDocument: inspection.facts.sameDocument,
          iframeCount: inspection.facts.iframeCount,
          passwordInputCount: inspection.facts.passwordInputCount,
          keypadButtonCount: inspection.facts.digitCount,
          innerSubmitEnabled: inspection.facts.innerSubmitEnabled,
        });
        if (!this.formStillMatches(inspectOptions, expectedAmountKrw)) {
          return { kind: "handed_off", message: "PIN 화면 아래 예약 내용 또는 결제금액이 변경돼 자동 입력하지 않습니다.", claimed: true };
        }
        let secret: string | undefined = pin;
        pin = "";
        try {
          for (const digit of secret) {
            const current = this.deps.adapter.inspect(inspectOptions);
            if (current.kind !== "pin" || !this.formStillMatches(inspectOptions, expectedAmountKrw)) {
              return { kind: "handed_off", message: "CatchPay PIN 입력 중 결제 화면이 변경돼 자동 입력을 중단합니다.", claimed: true };
            }
            if (!this.deps.adapter.enterPinDigit(current.fingerprint, digit)) {
              return { kind: "handed_off", message: "CatchPay PIN 키패드가 변경돼 자동 입력을 중단합니다.", claimed: true };
            }
            if (!(await this.deps.sleep(PIN_DIGIT_SETTLE_MS, signal))) {
              return { kind: "handed_off", message: "CatchPay PIN 입력 중 중지 요청을 받아 자동 제출하지 않습니다.", claimed: true };
            }
            if (this.deps.now() >= deadline) {
              return { kind: "handed_off", message: "CatchPay PIN 입력 중 결과 관측 시간이 만료돼 자동 제출하지 않습니다.", claimed: true };
            }
          }
        } finally {
          secret = undefined;
        }
        const fresh = this.deps.adapter.inspect(inspectOptions);
        if (fresh.kind !== "pin" || !fresh.facts.innerSubmitEnabled) {
          return { kind: "handed_off", message: "PIN 입력 뒤 결제 화면을 확인할 수 없어 자동 제출하지 않습니다.", claimed: true };
        }
        if (!this.formStillMatches(inspectOptions, expectedAmountKrw)) {
          return { kind: "handed_off", message: "PIN 입력 뒤 예약 내용 또는 결제금액이 변경돼 자동 제출하지 않습니다.", claimed: true };
        }
        const pinClaimed = await this.deps.claim("pin", outerFingerprint);
        this.telemetry("pin_claim", { claimGranted: pinClaimed });
        if (!pinClaimed) {
          return { kind: "handed_off", message: "PIN 결제 클릭 권한을 얻지 못해 자동 제출하지 않습니다.", claimed: true };
        }
        const afterClaim = this.deps.adapter.inspect(inspectOptions);
        if (afterClaim.kind !== "pin") {
          return { kind: "handed_off", message: "PIN 결제 클릭 권한 부여 뒤 PIN 화면이 사라졌습니다. 자동 재제출하지 않습니다.", claimed: true };
        }
        if (afterClaim.fingerprint !== fresh.fingerprint) {
          return { kind: "handed_off", message: "PIN 결제 클릭 권한 부여 중 화면이 변경됐습니다. 자동 재제출하지 않습니다.", claimed: true };
        }
        if (!this.formStillMatches(inspectOptions, expectedAmountKrw)) {
          return { kind: "handed_off", message: "PIN 결제 클릭 권한 부여 중 예약 내용 또는 결제금액이 변경됐습니다. 자동 재제출하지 않습니다.", claimed: true };
        }
        const pinDispatched = this.deps.adapter.submitInner(afterClaim.fingerprint);
        this.telemetry("pin_dispatch", { dispatched: pinDispatched });
        if (!pinDispatched) {
          return { kind: "handed_off", message: "PIN 결제 클릭 권한 부여 뒤 화면이 변경됐습니다. 자동 재제출하지 않습니다.", claimed: true };
        }
        return this.observeSuccess(inspectOptions, signal);
      }
      if (successful(inspection)) return this.completed(inspection);
      if (inspection.kind === "unknown" && inspection.code === "pin_keypad_unsupported") {
        pin = "";
        return {
          kind: "handed_off",
          message: "CatchPay PIN 키패드 구조를 안전하게 확인할 수 없어 자동 입력하지 않습니다.",
          claimed: true,
        };
      }
      if (!(await this.deps.sleep(PIN_POLL_MS, signal))) break;
    }
    return signal.aborted
      ? { kind: "handed_off", message: "결제 제출 뒤 중지 요청을 받아 결과를 확정할 수 없습니다.", claimed: true }
      : { kind: "handed_off", message: "결제 제출 뒤 성공 결과를 확인하지 못했습니다. 자동 재제출하지 않습니다.", claimed: true };
  }

  private formStillMatches(
    inspectOptions: ReservationFormInspectOptions,
    expectedAmountKrw: number,
  ): boolean {
    return this.deps.adapter.paymentContextMatchesBelowPin(inspectOptions, expectedAmountKrw);
  }

  private async observeSuccess(
    inspectOptions: ReservationFormInspectOptions,
    signal: AbortSignal,
  ): Promise<CompletionResult> {
    const deadline = this.deps.now() + RESULT_TIMEOUT_MS;
    while (!signal.aborted && this.deps.now() < deadline) {
      const inspection = this.deps.adapter.inspect(inspectOptions);
      if (successful(inspection)) {
        return this.completed(inspection);
      }
      if (!(await this.deps.sleep(50, signal))) break;
    }
    return signal.aborted
      ? { kind: "handed_off", message: "최종 제출 뒤 중지 요청을 받아 결과를 확정할 수 없습니다.", claimed: true }
      : { kind: "handed_off", message: "최종 제출 뒤 성공 결과를 확인하지 못했습니다. 자동 재제출하지 않습니다.", claimed: true };
  }

  private completed(inspection: Extract<ReservationFormInspection, { kind: "success" }>): CompletionResult {
    this.telemetry("success_observed", {
      successPathMatched: inspection.facts.path === "/ct/mydining/my/planned",
      successMessageMatched: inspection.facts.matchedMessage,
      successListingMatched: inspection.facts.listingMatch,
    });
    return { kind: "completed", message: "예약 성공 화면과 방문예정 일치를 확인했습니다." };
  }
}
