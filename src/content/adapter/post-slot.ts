import type { ReservationConfig, TablePreference } from "../../shared/types.js";

export type PostSlotInspection =
  | { kind: "waiting" }
  | { kind: "table_type"; options: string[] }
  | { kind: "menu"; options: string[] }
  | { kind: "deposit" }
  | { kind: "form" }
  | { kind: "unknown"; label: string };

export interface PostSlotActionResult {
  status: "acted" | "blocked";
  message: string;
  completed?: boolean;
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

    const table = this.dialog("테이블 타입 선택");
    if (table) return { kind: "table_type", options: this.optionLabels(table, '[role="radio"][aria-label]') };

    const menu = this.dialog("메뉴 선택");
    if (menu) return { kind: "menu", options: this.optionLabels(menu, '[role="checkbox"][aria-label]') };

    if (this.dialog("예약금 결제 방법 선택")) return { kind: "deposit" };

    const unknown = this.document.querySelector<HTMLElement>('[role="dialog"][aria-label]:not([aria-hidden="true"])');
    if (unknown) return { kind: "unknown", label: unknown.getAttribute("aria-label") ?? "알 수 없는 단계" };
    return { kind: "waiting" };
  }

  advance(inspection: PostSlotInspection, config: PostSlotConfig): PostSlotActionResult {
    switch (inspection.kind) {
      case "table_type":
        return this.advanceTable(config.tablePreference);
      case "menu":
        return this.advanceMenu(config.menuKeyword);
      case "deposit":
        return this.advanceDeposit();
      default:
        return { status: "blocked", message: "진행할 수 있는 후속 선택 단계가 아닙니다." };
    }
  }

  private advanceTable(preference: TablePreference): PostSlotActionResult {
    const dialog = this.dialog("테이블 타입 선택");
    if (!dialog) return { status: "blocked", message: "테이블 타입 화면이 사라졌습니다." };
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
    return this.clickNext(dialog, "테이블 타입 선택을 완료했습니다.");
  }

  private advanceMenu(keyword: string): PostSlotActionResult {
    const dialog = this.dialog("메뉴 선택");
    if (!dialog) return { status: "blocked", message: "메뉴 선택 화면이 사라졌습니다." };
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
    return this.clickNext(dialog, "메뉴 선택을 완료했습니다.");
  }

  private advanceDeposit(): PostSlotActionResult {
    const dialog = this.dialog("예약금 결제 방법 선택");
    if (!dialog) return { status: "blocked", message: "예약금 결제 방법 화면이 사라졌습니다." };
    const depositFree = dialog.querySelector<HTMLInputElement>('input[type="radio"][aria-label="예약금 0원 결제"]');
    if (!depositFree || depositFree.disabled) {
      return { status: "blocked", message: "예약금 0원 결제를 선택할 수 없어 사용자에게 인계합니다." };
    }
    if (!depositFree.checked) {
      depositFree.click();
      return { status: "acted", message: "예약금 0원 결제를 선택했습니다." };
    }
    return this.clickNext(dialog, "예약금 결제 방법을 확인했습니다.");
  }

  private dialog(label: string): HTMLElement | null {
    return this.document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${label}"]:not([aria-hidden="true"])`);
  }

  private optionLabels(dialog: Element, selector: string): string[] {
    return Array.from(dialog.querySelectorAll(selector), (element) => element.getAttribute("aria-label") ?? "")
      .filter(Boolean);
  }

  private enabledChoices(dialog: Element, selector: string): Element[] {
    return Array.from(dialog.querySelectorAll(selector)).filter((element) => !isDisabled(element));
  }

  private clickNext(dialog: Element, message: string): PostSlotActionResult {
    const next = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => normalized(button.textContent) === "다음");
    if (!next || next.disabled) return { status: "blocked", message: "다음 버튼이 활성화되지 않았습니다." };
    next.click();
    return { status: "acted", message, completed: true };
  }
}
