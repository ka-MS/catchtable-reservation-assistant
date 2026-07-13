import { parseKoreanTime } from "../../shared/time.js";
import type { SlotCandidate } from "../../shared/slot-selection.js";
import { isElementHidden } from "./dom.js";

interface SlotWithButton extends SlotCandidate {
  button: HTMLButtonElement;
}

export class SlotAdapter {
  constructor(private readonly document: Document) {}

  readAvailableSlots(): SlotCandidate[] {
    return this.readSlots().map(({ key, minutes, label }) => ({ key, minutes, label }));
  }

  clickSlot(candidate: SlotCandidate): boolean {
    const current = this.readSlots().find((slot) => slot.key === candidate.key);
    if (!current || !current.button.isConnected || current.button.disabled) return false;
    current.button.click();
    return true;
  }

  private readSlots(): SlotWithButton[] {
    // 실측 2026-07-10: docs/analysis/site-behavior.md §4 슬롯 칩과 캐러셀 복제 필터.
    const unique = new Map<number, SlotWithButton>();
    const buttons = Array.from(this.document.querySelectorAll<HTMLButtonElement>('main button[data-busy]'));
    for (const button of buttons) {
      if (
        button.dataset.busy !== "false" ||
        isElementHidden(button) ||
        button.disabled
      ) {
        continue;
      }
      const label = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const minutes = parseKoreanTime(label);
      if (minutes === null || unique.has(minutes)) continue;
      unique.set(minutes, { key: `slot:${minutes}`, minutes, label, button });
    }
    return [...unique.values()].sort((left, right) => left.minutes - right.minutes);
  }
}
