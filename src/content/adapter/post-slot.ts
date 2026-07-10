import type { ReservationConfig, TablePreference } from "../../shared/types.js";

export type PostSlotInspection =
  | { kind: "waiting" }
  | { kind: "table_type"; options: string[] }
  | { kind: "menu"; options: string[] }
  | { kind: "extras" }
  | { kind: "deposit" }
  | { kind: "form" }
  | { kind: "unknown"; label: string };

export interface PostSlotActionResult {
  status: "acted" | "waiting" | "blocked";
  message: string;
}

type PostSlotConfig = Pick<ReservationConfig, "tablePreference" | "menuKeyword">;

const TABLE_LABEL: Record<Exclude<TablePreference, "any">, string> = {
  hall: "홀",
  bar: "바",
  room: "룸",
};

function normalized(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR") ?? "";
}

function isDisabled(element: Element): boolean {
  return element.getAttribute("aria-disabled") === "true"
    || ("disabled" in element && (element as HTMLButtonElement | HTMLInputElement).disabled);
}

function isChecked(element: Element): boolean {
  if ("checked" in element) return (element as HTMLInputElement).checked;
  return element.getAttribute("aria-checked") === "true";
}

export class PostSlotAdapter {
  constructor(private readonly document: Document) {}

  inspect(): PostSlotInspection {
    if (this.document.location.pathname === "/ct/reservation/form") return { kind: "form" };
    const active = this.activeDialog();
    if (!active) return { kind: "waiting" };
    const label = active.getAttribute("aria-label") ?? "알 수 없는 단계";
    if (label === "테이블 타입 선택") {
      return { kind: "table_type", options: this.optionLabels(active, '[role="radio"][aria-label]') };
    }
    if (label === "메뉴 선택") {
      return { kind: "menu", options: this.optionLabels(active, '[role="checkbox"][aria-label]') };
    }
    if (label === "추가 상품") return { kind: "extras" };
    if (label === "예약금 결제 방법 선택") return { kind: "deposit" };
    return { kind: "unknown", label };
  }

  advance(inspection: PostSlotInspection, config: PostSlotConfig): PostSlotActionResult {
    switch (inspection.kind) {
      case "table_type":
        return this.advanceTable(config.tablePreference);
      case "menu":
        return this.advanceMenu(config.menuKeyword);
      case "extras":
        return this.advanceExtras();
      case "deposit":
        return this.advanceDeposit();
      default:
        return { status: "blocked", message: "진행할 수 있는 후속 선택 단계가 아닙니다." };
    }
  }

  private advanceTable(preference: TablePreference): PostSlotActionResult {
    const dialog = this.dialog("테이블 타입 선택");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    const choices = this.enabledChoices(dialog, '[role="radio"][aria-label]');
    const expected = preference === "any" ? null : TABLE_LABEL[preference];
    const target = expected === null
      ? choices.find(isChecked) ?? choices[0]
      : choices.find((choice) => normalized(choice.getAttribute("aria-label")).includes(normalized(expected)));
    if (!target) return { status: "blocked", message: "설정한 테이블 타입을 선택할 수 없습니다." };
    if (!isChecked(target)) {
      (target as HTMLElement).click();
      return { status: "acted", message: `${target.getAttribute("aria-label") ?? "테이블"} 타입을 선택했습니다.` };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "테이블 타입 선택을 완료했습니다.");
  }

  private advanceMenu(keyword: string): PostSlotActionResult {
    const dialog = this.dialog("메뉴 선택");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    const choices = this.enabledChoices(dialog, '[role="checkbox"][aria-label]');
    const query = normalized(keyword);
    const target = query
      ? choices.find((choice) => normalized(choice.getAttribute("aria-label")).includes(query))
      : choices.find(isChecked) ?? choices[0];
    if (!target) return { status: "blocked", message: "설정한 메뉴를 선택할 수 없습니다." };

    const selectedOther = choices.find((choice) => choice !== target && isChecked(choice));
    if (selectedOther) {
      (selectedOther as HTMLElement).click();
      return { status: "acted", message: "기존 메뉴 선택을 해제했습니다." };
    }
    if (!isChecked(target)) {
      (target as HTMLElement).click();
      return { status: "acted", message: `${target.getAttribute("aria-label") ?? "메뉴"}를 선택했습니다.` };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "메뉴 선택을 완료했습니다.");
  }

  private advanceExtras(): PostSlotActionResult {
    const dialog = this.dialog("추가 상품");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    return this.clickProgress(dialog, ["다음"], "추가 상품을 선택하지 않고 진행했습니다.");
  }

  private advanceDeposit(): PostSlotActionResult {
    const dialog = this.dialog("예약금 결제 방법 선택");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    const depositFree = dialog.querySelector<HTMLInputElement>('input[type="radio"][aria-label="예약금 0원 결제"]');
    if (!depositFree || depositFree.disabled) {
      return { status: "blocked", message: "예약금 0원 결제를 선택할 수 없어 사용자에게 인계합니다." };
    }
    if (!depositFree.checked) {
      depositFree.click();
      return { status: "acted", message: "예약금 0원 결제를 선택했습니다." };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "예약금 결제 방법을 확인했습니다.");
  }

  private dialog(label: string): HTMLElement | null {
    const active = this.activeDialog();
    return active?.getAttribute("aria-label") === label ? active : null;
  }

  private activeDialog(): HTMLElement | null {
    const candidates = Array.from(this.document.querySelectorAll<HTMLElement>('[role="dialog"][aria-label]'))
      .filter((dialog) => {
        if (dialog.closest('[hidden], [aria-hidden="true"]')) return false;
        const style = this.document.defaultView?.getComputedStyle(dialog);
        return style?.display !== "none" && style?.visibility !== "hidden";
      });
    const rendered = candidates.filter((dialog) => dialog.getClientRects().length > 0);
    return (rendered.length > 0 ? rendered : candidates).at(-1) ?? null;
  }

  private optionLabels(dialog: Element, selector: string): string[] {
    return Array.from(dialog.querySelectorAll(selector), (element) => element.getAttribute("aria-label") ?? "")
      .filter(Boolean);
  }

  private enabledChoices(dialog: Element, selector: string): Element[] {
    return Array.from(dialog.querySelectorAll(selector)).filter((element) => !isDisabled(element));
  }

  private clickProgress(dialog: Element, labels: string[], message: string): PostSlotActionResult {
    const expected = labels.map(normalized);
    const progress = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => expected.includes(normalized(button.textContent)));
    if (!progress) return { status: "blocked", message: `${labels.join("/")} 버튼을 찾을 수 없습니다.` };
    if (progress.disabled) return { status: "waiting", message: `${normalized(progress.textContent)} 버튼 활성화를 기다립니다.` };
    progress.click();
    return { status: "acted", message };
  }
}
