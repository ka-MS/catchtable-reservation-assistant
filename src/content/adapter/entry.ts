import type { EntryFacts } from "../../shared/run-control/facts.js";
import { readCalendarCells } from "./calendar-dom.js";
import { isDisabled, isElementHidden, normalizedText, visibleAll } from "./dom.js";
import { findPromoDismissButton } from "./dialog.js";

export class EntryAdapter {
  constructor(private readonly document: Document) {}

  inspect(): EntryFacts {
    const reservationOpen = readCalendarCells(this.document).length > 0;
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
    return visibleAll<HTMLButtonElement>(dock, "button");
  }
}
