import { isElementHidden, normalizedText } from "./dom.js";

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
