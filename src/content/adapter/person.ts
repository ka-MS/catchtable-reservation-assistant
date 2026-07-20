import type { PersonFacts } from "../../shared/run-control/facts.js";
import { isDisabled, visibleAll } from "./dom.js";

export class PersonAdapter {
  constructor(private readonly document: Document) {}

  inspect(personCount: number): PersonFacts {
    const choices = this.choices();
    const target = choices.get(String(personCount));
    return {
      ready: choices.size > 0,
      targetAvailable: target !== undefined && !isDisabled(target),
      targetSelected: target?.checked === true,
    };
  }

  readSelectedCount(): number | null {
    for (const [value, input] of this.choices()) {
      if (input.checked) return Number(value);
    }
    return null;
  }

  select(personCount: number): boolean {
    const target = this.choices().get(String(personCount));
    if (!target || isDisabled(target) || !target.isConnected) return false;
    if (!target.checked) target.click();
    return true;
  }

  private choices(): Map<string, HTMLInputElement> {
    const choices = new Map<string, HTMLInputElement>();
    for (const input of visibleAll<HTMLInputElement>(this.document, 'input[type="radio"][name="personCount"]')) {
      if (choices.has(input.value)) continue;
      choices.set(input.value, input);
    }
    return choices;
  }
}
