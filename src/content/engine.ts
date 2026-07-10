import {
  findDepositNotice,
  findMatchingSlot,
  findTableTypeDialog,
  hasTableTypeDialog,
  isUserHandoffScreen,
  pageMatchesConfig,
  selectionMatchesConfig,
} from "./adapter.js";
import type { AutomationState, ReservationConfig, StatusEvent } from "../shared/types.js";

const VERIFY_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 250;

export class ReservationEngine {
  private config: ReservationConfig | null = null;
  private state: AutomationState = "IDLE";
  private retryCount = 0;
  private observer: MutationObserver | null = null;
  private evaluationQueued = false;
  private verifyTimer: number | null = null;
  private retryTimer: number | null = null;
  private clickedNodes = new WeakSet<HTMLElement>();

  start(config: ReservationConfig): void {
    this.stop(false);
    this.config = config;
    this.transition("ARMED", "감시 조건을 확인했습니다.");
    this.observer = new MutationObserver(() => this.scheduleEvaluation());
    this.observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-disabled", "data-busy", "aria-hidden", "disabled"],
    });
    this.transition("WATCHING", "예약 가능 시간을 감시 중입니다.");
    this.scheduleEvaluation();
  }

  stop(report = true): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.verifyTimer !== null) window.clearTimeout(this.verifyTimer);
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.verifyTimer = null;
    this.retryTimer = null;
    this.evaluationQueued = false;
    if (report && this.state !== "IDLE") this.transition("STOPPED", "사용자가 감시를 중지했습니다.");
  }

  private scheduleEvaluation(): void {
    if (this.evaluationQueued || this.state === "STOPPED" || this.state === "PAUSED_USER") return;
    this.evaluationQueued = true;
    queueMicrotask(() => {
      this.evaluationQueued = false;
      this.evaluate();
    });
  }

  private evaluate(): void {
    const config = this.config;
    if (!config || this.state === "STOPPED" || this.state === "PAUSED_USER") return;
    if (this.isExpired(config)) {
      this.stop(false);
      this.transition("STOPPED", "재시도 종료 시각에 도달했습니다.");
      return;
    }
    if (!pageMatchesConfig(config)) {
      this.pause("현재 탭이 설정한 식당 페이지와 일치하지 않습니다.");
      return;
    }
    if (!selectionMatchesConfig(config)) {
      this.pause("현재 페이지의 날짜 또는 인원이 설정과 일치하지 않습니다.");
      return;
    }

    if (this.state === "VERIFYING_NEXT") {
      this.evaluateNextStep(config);
      return;
    }
    if (this.state !== "WATCHING" && this.state !== "RETRYING") return;

    const candidate = findMatchingSlot(config);
    if (!candidate) return;
    if (this.clickedNodes.has(candidate.button)) return;
    if (!candidate.button.isConnected || candidate.button.disabled || candidate.button.getAttribute("aria-disabled") !== "false") {
      return;
    }

    this.clickedNodes.add(candidate.button);
    const startedAt = performance.now();
    this.transition("VERIFYING_NEXT", `${candidate.label} 슬롯을 선택했습니다.`);
    candidate.button.click();
    const elapsed = performance.now() - startedAt;
    this.report({
      type: "STATUS",
      state: "VERIFYING_NEXT",
      detail: `슬롯 클릭 호출 완료 (${elapsed.toFixed(2)}ms)`,
      at: Date.now(),
      retryCount: this.retryCount,
    });
    this.waitForNextStep();
  }

  private evaluateNextStep(config: ReservationConfig): void {
    if (isUserHandoffScreen()) {
      this.pause("최종 약관 또는 결제 확인이 필요합니다.");
      return;
    }

    if (hasTableTypeDialog()) {
      if (config.tableTypePreference === "none") {
        this.pause("테이블 타입 선택이 필요합니다.");
        return;
      }
      const tableType = findTableTypeDialog(config.tableTypePreference);
      if (!tableType) {
        this.pause("설정한 테이블 타입을 선택할 수 없습니다.");
        return;
      }
      if (!this.clickedNodes.has(tableType.nextButton)) {
        tableType.option.click();
        if (tableType.nextButton.disabled || tableType.nextButton.getAttribute("aria-disabled") === "true") {
          return;
        }
        this.clickedNodes.add(tableType.nextButton);
        tableType.nextButton.click();
        this.transition("VERIFYING_NEXT", "설정한 테이블 타입을 선택했습니다.");
      }
      return;
    }

    const deposit = findDepositNotice();
    if (deposit && !this.clickedNodes.has(deposit.confirmButton)) {
      this.clickedNodes.add(deposit.confirmButton);
      deposit.confirmButton.click();
      this.transition("VERIFYING_NEXT", "예약금 안내를 확인하고 다음 단계로 이동했습니다.");
    }
  }

  private waitForNextStep(): void {
    if (this.verifyTimer !== null) window.clearTimeout(this.verifyTimer);
    this.verifyTimer = window.setTimeout(() => {
      if (this.state !== "VERIFYING_NEXT") return;
      this.retryCount += 1;
      this.transition("RETRYING", "다음 예약 단계를 확인하지 못해 재감시합니다.");
      this.retryTimer = window.setTimeout(() => {
        if (this.state === "RETRYING") {
          this.transition("WATCHING", "예약 가능 시간을 다시 감시 중입니다.");
          this.scheduleEvaluation();
        }
      }, RETRY_DELAY_MS);
    }, VERIFY_TIMEOUT_MS);
  }

  private isExpired(config: ReservationConfig): boolean {
    return config.stopAt !== undefined && Number.isFinite(Date.parse(config.stopAt)) && Date.now() >= Date.parse(config.stopAt);
  }

  private pause(detail: string): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.verifyTimer !== null) window.clearTimeout(this.verifyTimer);
    this.transition("PAUSED_USER", detail);
  }

  private transition(state: AutomationState, detail: string): void {
    this.state = state;
    this.report({ type: "STATUS", state, detail, at: Date.now(), retryCount: this.retryCount });
  }

  private report(event: StatusEvent): void {
    chrome.runtime.sendMessage(event).catch(() => undefined);
  }
}
