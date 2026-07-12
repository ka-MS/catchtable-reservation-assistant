import { isElementHidden, normalizedText } from "./dom.js";
import { findPromoDismissButton } from "./post-slot-inspection.js";

export interface EntryInspection {
  reservationOpen: boolean;
  ctaAvailable: boolean;
  waitingOnly: boolean;
}

function isDisabled(element: HTMLButtonElement): boolean {
  return element.disabled || element.getAttribute("aria-disabled") === "true";
}

export class EntryAdapter {
  constructor(private readonly document: Document) {}

  inspect(): EntryInspection {
    const reservationOpen = Array.from(this.document.querySelectorAll<HTMLElement>('div[role="button"][aria-label]'))
      .some((element) => !isElementHidden(element) && /,\s*\d{1,2}월\s+\d{1,2},\s*\d{4}$/.test(element.getAttribute("aria-label") ?? ""));
    const buttons = this.dockButtons();
    return {
      reservationOpen,
      ctaAvailable: buttons.some((button) => normalizedText(button.textContent) === "예약하기" && !isDisabled(button)),
      waitingOnly: buttons.some((button) => normalizedText(button.textContent).includes("현장 웨이팅만 가능")),
    };
  }

  // 실측 2026-07-12 이시즈에 (site-behavior §7.2): 홍보 인터스티셜이 예약하기 클릭을 삼키면
  // 달력이 열리지 않으므로 닫은 뒤 예약하기를 다시 클릭해야 한다.
  dismissPromo(): boolean {
    const dismiss = findPromoDismissButton(this.document);
    if (!dismiss) return false;
    dismiss.click();
    return true;
  }

  openReservation(): boolean {
    const target = this.dockButtons()
      .find((button) => normalizedText(button.textContent) === "예약하기" && !isDisabled(button));
    if (!target || !target.isConnected) return false;
    target.click();
    return true;
  }

  private dockButtons(): HTMLButtonElement[] {
    const dock = this.document.querySelector("aside#dock");
    if (!dock || isElementHidden(dock)) return [];
    return Array.from(dock.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => !isElementHidden(button));
  }
}
