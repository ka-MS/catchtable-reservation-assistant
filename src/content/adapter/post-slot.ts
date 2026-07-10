import type { ReservationConfig, TablePreference } from "../../shared/types.js";

export type PostSlotInspection =
  | { kind: "waiting" }
  | { kind: "table_type"; options: string[] }
  | { kind: "menu"; options: string[] }
  | { kind: "extras" }
  | { kind: "deposit_notice" }
  | { kind: "deposit" }
  | { kind: "form" }
  | { kind: "form_notice" }
  | { kind: "unknown"; label: string };

export interface PostSlotActionResult {
  status: "acted" | "waiting" | "blocked";
  message: string;
}

type PostSlotConfig = Pick<ReservationConfig, "tablePreference" | "menuKeyword" | "personCount">;

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
    if (this.document.location.pathname === "/ct/reservation/form") {
      return this.formNoticeButton() ? { kind: "form_notice" } : { kind: "form" };
    }
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
    if (label === "예약금 안내") return { kind: "deposit_notice" };
    if (label === "예약금 결제 방법 선택") return { kind: "deposit" };
    return { kind: "unknown", label };
  }

  advance(inspection: PostSlotInspection, config: PostSlotConfig): PostSlotActionResult {
    switch (inspection.kind) {
      case "table_type":
        return this.advanceTable(config.tablePreference);
      case "menu":
        return this.advanceMenu(config.menuKeyword, config.personCount);
      case "extras":
        return this.advanceExtras();
      case "deposit_notice":
        return this.advanceDepositNotice();
      case "deposit":
        return this.advanceDeposit();
      case "form_notice":
        return this.advanceFormNotice();
      default:
        return { status: "blocked", message: "진행할 수 있는 후속 선택 단계가 아닙니다." };
    }
  }

  private advanceTable(preference: TablePreference): PostSlotActionResult {
    const dialog = this.dialog("테이블 타입 선택");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    const choices = this.enabledChoices(dialog, '[role="radio"][aria-label]');
    if (choices.length === 0) return { status: "waiting", message: "테이블 타입 화면 전환을 기다립니다." };
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

  private advanceMenu(keyword: string, personCount: number): PostSlotActionResult {
    const dialog = this.dialog("메뉴 선택");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    if (dialog.querySelector('[role="checkbox"][aria-label]')) return this.advanceMenuChoices(dialog, keyword);
    return this.advanceMenuCounts(dialog, keyword, personCount);
  }

  private advanceMenuChoices(dialog: HTMLElement, keyword: string): PostSlotActionResult {
    const choices = this.enabledChoices(dialog, '[role="checkbox"][aria-label]');
    if (choices.length === 0) return { status: "waiting", message: "메뉴 화면 전환을 기다립니다." };
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

  // 수량형 메뉴는 진행 버튼이 항상 활성이지만 총수량이 예약 인원수와 같아야만 클릭이 접수된다.
  private advanceMenuCounts(dialog: HTMLElement, keyword: string, personCount: number): PostSlotActionResult {
    const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="number"][aria-label]'))
      .filter((input) => (input.getAttribute("aria-label") ?? "").endsWith("수량"));
    if (inputs.length === 0) return { status: "waiting", message: "메뉴 화면 전환을 기다립니다." };
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button[aria-label]"));
    const entries = inputs.map((input) => {
      const name = (input.getAttribute("aria-label") ?? "").replace(/\s*수량$/, "");
      return {
        name,
        value: Number.parseInt(input.value, 10) || 0,
        plus: buttons.find((button) => button.getAttribute("aria-label") === `${name} 수량 추가`),
        minus: buttons.find((button) => button.getAttribute("aria-label") === `${name} 수량 감소`),
      };
    });
    const query = normalized(keyword);
    const target = query ? entries.find((entry) => normalized(entry.name).includes(query)) : entries[0];
    if (!target) return { status: "blocked", message: "설정한 메뉴를 선택할 수 없습니다." };

    const other = entries.find((entry) => entry !== target && entry.value > 0);
    if (other) {
      if (!other.minus || other.minus.disabled) return { status: "blocked", message: `${other.name} 수량을 줄일 수 없습니다.` };
      other.minus.click();
      return { status: "acted", message: `${other.name} 수량을 줄였습니다.` };
    }
    if (target.value > personCount) {
      if (!target.minus || target.minus.disabled) return { status: "blocked", message: `${target.name} 수량을 줄일 수 없습니다.` };
      target.minus.click();
      return { status: "acted", message: `${target.name} 수량을 ${target.value - 1}개로 줄였습니다.` };
    }
    if (target.value < personCount) {
      if (!target.plus || target.plus.disabled) {
        return { status: "blocked", message: "메뉴 수량을 예약 인원수만큼 설정할 수 없습니다." };
      }
      target.plus.click();
      return { status: "acted", message: `${target.name} 수량을 ${target.value + 1}개로 설정했습니다.` };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "메뉴 수량 선택을 완료했습니다.");
  }

  private advanceExtras(): PostSlotActionResult {
    const dialog = this.dialog("추가 상품");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    return this.clickProgress(dialog, ["다음"], "추가 상품을 선택하지 않고 진행했습니다.");
  }

  private advanceDepositNotice(): PostSlotActionResult {
    const dialog = this.dialog("예약금 안내");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    return this.clickProgress(dialog, ["확인"], "예약금 안내를 확인했습니다.");
  }

  private advanceDeposit(): PostSlotActionResult {
    const dialog = this.dialog("예약금 결제 방법 선택");
    if (!dialog) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    const depositFree = dialog.querySelector<HTMLInputElement>('input[type="radio"][aria-label="예약금 0원 결제"]');
    if (!depositFree) {
      return { status: "blocked", message: "예약금 0원 결제를 선택할 수 없어 사용자에게 인계합니다." };
    }
    if (depositFree.disabled) return { status: "waiting", message: "예약금 결제 방법 화면 전환을 기다립니다." };
    if (!depositFree.checked) {
      depositFree.click();
      return { status: "acted", message: "예약금 0원 결제를 선택했습니다." };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "예약금 결제 방법을 확인했습니다.");
  }

  // 예약 폼 위 홍보 안내는 화면 증거만 있으므로 확인했어요 버튼 텍스트로만 판정한다.
  private formNoticeButton(): HTMLButtonElement | null {
    return Array.from(this.document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => normalized(button.textContent) === "확인했어요" && !button.disabled) ?? null;
  }

  private advanceFormNotice(): PostSlotActionResult {
    const notice = this.formNoticeButton();
    if (!notice) return { status: "waiting", message: "예약 폼 안내 확인을 기다립니다." };
    notice.click();
    return { status: "acted", message: "예약 폼 안내 창을 닫았습니다." };
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
