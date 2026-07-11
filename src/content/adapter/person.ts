import { isElementHidden } from "./dom.js";

export interface PersonInspection {
  ready: boolean;
  targetAvailable: boolean;
  targetSelected: boolean;
}

export class PersonAdapter {
  constructor(private readonly document: Document) {}

  inspect(personCount: number): PersonInspection {
    const choices = this.choices();
    const target = choices.get(String(personCount));
    return {
      ready: choices.size > 0,
      targetAvailable: target !== undefined && !target.disabled && target.getAttribute("aria-disabled") !== "true",
      targetSelected: target?.checked === true,
    };
  }

  select(personCount: number): boolean {
    const target = this.choices().get(String(personCount));
    if (!target || target.disabled || target.getAttribute("aria-disabled") === "true" || !target.isConnected) return false;
    if (!target.checked) target.click();
    return true;
  }

  private choices(): Map<string, HTMLInputElement> {
    const choices = new Map<string, HTMLInputElement>();
    for (const input of Array.from(this.document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="personCount"]'))) {
      if (isElementHidden(input) || choices.has(input.value)) continue;
      choices.set(input.value, input);
    }
    return choices;
  }
}
