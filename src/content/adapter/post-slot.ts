import type { ReservationConfig, TablePreference } from "../../shared/types.js";
import {
  inspectPostSlot,
  isZeroDepositControl,
  type PostSlotInspection,
} from "./post-slot-inspection.js";
import {
  findActiveDialog,
  findPaymentMethodNotice,
  findPaymentMethodNoticeButton,
  findPromoDismissButton,
  findRequestSheet,
  findSeatingMenuSheet,
} from "./dialog.js";
import { isDisabled, normalizedText, safeText, visibleAll } from "./dom.js";

export type { PostSlotCertainty, PostSlotDiagnostics, PostSlotInspection } from "./post-slot-inspection.js";

export interface PostSlotActionResult {
  status: "acted" | "waiting" | "blocked";
  message: string;
}

type PostSlotConfig = Pick<
  ReservationConfig,
  "tablePreference" | "menuKeyword" | "personCount" | "paymentMethodAutoAdvance"
>;

const TABLE_LABEL: Record<Exclude<TablePreference, "any">, string> = {
  hall: "홀",
  bar: "바",
  room: "룸",
};

function isChecked(element: Element): boolean {
  if ("checked" in element) return (element as HTMLInputElement).checked;
  return element.getAttribute("aria-checked") === "true";
}

export class PostSlotAdapter {
  private readonly progressedSeatingMenu = new WeakSet<Element>();

  constructor(private readonly document: Document) {}

  inspect(): PostSlotInspection {
    return inspectPostSlot(this.document, this.formNoticeButton() !== null);
  }

  advance(inspection: PostSlotInspection, config: PostSlotConfig): PostSlotActionResult {
    const current = this.inspect();
    if (current.kind !== inspection.kind || current.fingerprint !== inspection.fingerprint) {
      return { status: "waiting", message: "후속 화면이 변경되어 다시 확인합니다." };
    }
    const dialog = findActiveDialog(this.document);
    switch (inspection.kind) {
      case "table_type":
        return dialog
          ? this.advanceTable(dialog, config.tablePreference)
          : { status: "waiting", message: "다음 후속 화면을 기다립니다." };
      case "menu":
        return dialog
          ? this.advanceMenu(dialog, config.menuKeyword, config.personCount)
          : { status: "waiting", message: "다음 후속 화면을 기다립니다." };
      case "seating_menu": {
        const sheet = findSeatingMenuSheet(this.document);
        return sheet
          ? this.advanceSeatingMenu(sheet, config.tablePreference, config.menuKeyword)
          : { status: "waiting", message: "다음 후속 화면을 기다립니다." };
      }
      case "extras":
        return dialog ? this.advanceExtras(dialog) : { status: "waiting", message: "다음 후속 화면을 기다립니다." };
      case "deposit_notice":
        return dialog
          ? this.advanceDepositNotice(dialog)
          : { status: "waiting", message: "다음 후속 화면을 기다립니다." };
      case "deposit":
        if (config.paymentMethodAutoAdvance === false) {
          return { status: "blocked", message: "결제 방식 자동 진행이 꺼져 있어 사용자에게 인계합니다." };
        }
        return dialog ? this.advanceDeposit(dialog) : { status: "waiting", message: "다음 후속 화면을 기다립니다." };
      case "payment_method_notice": {
        if (config.paymentMethodAutoAdvance === false) {
          return { status: "blocked", message: "결제 방식 자동 진행이 꺼져 있어 사용자에게 인계합니다." };
        }
        const notice = findPaymentMethodNotice(this.document);
        const reserveButton = findPaymentMethodNoticeButton(this.document);
        if (!notice || !reserveButton) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
        reserveButton.click();
        return { status: "acted", message: "선택한 결제 방식으로 예약 폼에 진행했습니다." };
      }
      case "request_notice":
        return this.advanceRequestNotice();
      case "promo_interstitial":
        return this.advancePromoInterstitial();
      case "form_notice":
        return this.advanceFormNotice();
      default:
        return { status: "blocked", message: "진행할 수 있는 후속 선택 단계가 아닙니다." };
    }
  }

  private advanceTable(dialog: HTMLElement, preference: TablePreference): PostSlotActionResult {
    const choices = this.enabledChoices(dialog, '[role="radio"][aria-label]');
    if (choices.length === 0) return { status: "waiting", message: "테이블 타입 화면 전환을 기다립니다." };
    const expected = preference === "any" ? null : TABLE_LABEL[preference];
    const target = expected === null
      ? choices.find(isChecked) ?? choices[0]
      : choices.find((choice) => normalizedText(choice.getAttribute("aria-label")).includes(normalizedText(expected)));
    if (!target) return { status: "blocked", message: "설정한 테이블 타입을 선택할 수 없습니다." };
    if (!isChecked(target)) {
      (target as HTMLElement).click();
      return { status: "acted", message: `${target.getAttribute("aria-label") ?? "테이블"} 타입을 선택했습니다.` };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "테이블 타입 선택을 완료했습니다.");
  }

  private advanceMenu(dialog: HTMLElement, keyword: string, personCount: number): PostSlotActionResult {
    const hasVisibleChoices = visibleAll(dialog, '[role="checkbox"][aria-label]').length > 0;
    if (hasVisibleChoices) return this.advanceMenuChoices(dialog, keyword);
    return this.advanceMenuCounts(dialog, keyword, personCount);
  }

  private advanceMenuChoices(dialog: HTMLElement, keyword: string): PostSlotActionResult {
    const choices = this.enabledChoices(dialog, '[role="checkbox"][aria-label]');
    if (choices.length === 0) return { status: "waiting", message: "메뉴 화면 전환을 기다립니다." };
    const query = normalizedText(keyword);
    const target = query
      ? choices.find((choice) => normalizedText(choice.getAttribute("aria-label")).includes(query))
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
    const inputs = visibleAll<HTMLInputElement>(dialog, 'input[type="number"][aria-label]')
      .filter((input) => (input.getAttribute("aria-label") ?? "").endsWith("수량"));
    if (inputs.length === 0) return { status: "waiting", message: "메뉴 화면 전환을 기다립니다." };
    const buttons = visibleAll<HTMLButtonElement>(dialog, "button[aria-label]");
    const entries = inputs.map((input) => {
      const name = (input.getAttribute("aria-label") ?? "").replace(/\s*수량$/, "");
      return {
        name,
        value: Number.parseInt(input.value, 10) || 0,
        plus: buttons.find((button) => button.getAttribute("aria-label") === `${name} 수량 추가`),
        minus: buttons.find((button) => button.getAttribute("aria-label") === `${name} 수량 감소`),
      };
    });
    const query = normalizedText(keyword);
    const target = query ? entries.find((entry) => normalizedText(entry.name).includes(query)) : entries[0];
    if (!target) return { status: "blocked", message: "설정한 메뉴를 선택할 수 없습니다." };

    const other = entries.find((entry) => entry !== target && entry.value > 0);
    if (other) {
      if (!other.minus || isDisabled(other.minus)) return { status: "blocked", message: `${other.name} 수량을 줄일 수 없습니다.` };
      other.minus.click();
      return { status: "acted", message: `${other.name} 수량을 줄였습니다.` };
    }
    if (target.value > personCount) {
      if (!target.minus || isDisabled(target.minus)) return { status: "blocked", message: `${target.name} 수량을 줄일 수 없습니다.` };
      target.minus.click();
      return { status: "acted", message: `${target.name} 수량을 ${target.value - 1}개로 줄였습니다.` };
    }
    if (target.value < personCount) {
      if (!target.plus || isDisabled(target.plus)) {
        return { status: "blocked", message: "메뉴 수량을 예약 인원수만큼 설정할 수 없습니다." };
      }
      target.plus.click();
      return { status: "acted", message: `${target.name} 수량을 ${target.value + 1}개로 설정했습니다.` };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "메뉴 수량 선택을 완료했습니다.");
  }

  private advanceExtras(dialog: HTMLElement): PostSlotActionResult {
    return this.clickProgress(dialog, ["다음"], "추가 상품을 선택하지 않고 진행했습니다.");
  }

  private advanceSeatingMenu(
    sheet: HTMLElement,
    preference: TablePreference,
    keyword: string,
  ): PostSlotActionResult {
    const choices = this.enabledChoices(sheet, '[role="checkbox"][aria-label]');
    const entries = choices.map((choice) => ({
      choice,
      heading: this.seatingMenuHeading(choice, sheet),
      menu: safeText(choice.getAttribute("aria-label")),
    }));
    const menuQuery = normalizedText(keyword);
    const seatingLabels: Record<Exclude<TablePreference, "any">, string[]> = {
      hall: ["홀", "테이블"],
      bar: ["바", "카운터"],
      room: ["룸"],
    };
    const matching = entries.filter((entry) => {
      const menuMatches = !menuQuery || normalizedText(`${entry.heading} ${entry.menu}`).includes(menuQuery);
      const seatingMatches = preference === "any"
        || seatingLabels[preference].some((label) => normalizedText(entry.heading).includes(normalizedText(label)));
      return menuMatches && seatingMatches;
    });
    const target = matching.find((entry) => isChecked(entry.choice)) ?? matching[0];
    if (!target) return { status: "blocked", message: "설정한 좌석과 메뉴 조합을 선택할 수 없습니다." };

    const selectedOther = entries.find((entry) => entry !== target && isChecked(entry.choice));
    if (selectedOther) {
      (selectedOther.choice as HTMLElement).click();
      return { status: "acted", message: "기존 좌석·메뉴 선택을 해제했습니다." };
    }
    if (!isChecked(target.choice)) {
      (target.choice as HTMLElement).click();
      return { status: "acted", message: `${target.heading || target.menu}를 선택했습니다.` };
    }
    const progress = visibleAll<HTMLButtonElement>(sheet, "button")
      .find((button) => ["다음", "확인"].includes(normalizedText(button.textContent)) && !isDisabled(button));
    if (!progress) return { status: "waiting", message: "좌석·메뉴 진행 버튼 활성화를 기다립니다." };
    if (this.progressedSeatingMenu.has(progress)) {
      return { status: "waiting", message: "좌석·메뉴 화면 전환을 기다립니다." };
    }
    this.progressedSeatingMenu.add(progress);
    progress.click();
    return { status: "acted", message: "좌석·메뉴 선택을 완료했습니다." };
  }

  private seatingMenuHeading(choice: Element, sheet: Element): string {
    let container = choice.parentElement;
    while (container && container !== sheet) {
      const choices = visibleAll(container, '[role="checkbox"][aria-label]');
      const heading = visibleAll<HTMLElement>(container, 'h1, h2, h3, [role="heading"]').at(0);
      if (choices.length === 1 && heading) return safeText(heading.textContent);
      container = container.parentElement;
    }
    return "";
  }

  private advanceDepositNotice(dialog: HTMLElement): PostSlotActionResult {
    const choices = visibleAll(dialog,
      '[role="radio"], input[type="radio"], [role="checkbox"], input[type="checkbox"], input[type="number"]',
    );
    if (choices.length > 0) {
      return { status: "blocked", message: "예약금 안내에 선택 항목이 있어 사용자에게 인계합니다." };
    }
    return this.clickProgress(dialog, ["확인", "다음"], "예약금 안내를 확인했습니다.");
  }

  private advanceDeposit(dialog: HTMLElement): PostSlotActionResult {
    const visibleMethods = visibleAll<HTMLInputElement>(dialog,
      '[role="radio"], input[type="radio"]',
    );
    const transitionFree = visibleMethods.find(isZeroDepositControl);
    if (transitionFree && isDisabled(transitionFree)) {
      return { status: "waiting", message: "예약금 결제 방법 화면 전환을 기다립니다." };
    }
    const methods = visibleMethods.filter((method) => !isDisabled(method));
    const depositFree = methods.find(isZeroDepositControl);
    const selected = methods.find(isChecked);
    const target = depositFree ?? selected;
    if (!target) return { status: "blocked", message: "선택된 결제 방식이 없어 사용자에게 인계합니다." };
    if (!isChecked(target)) {
      (target as HTMLElement).click();
      return { status: "acted", message: "예약금 0원 결제를 선택했습니다." };
    }
    return this.clickProgress(dialog, ["다음", "확인"], "예약금 결제 방법을 확인했습니다.");
  }

  // 승인제 안내의 예약 신청은 즉시 신청 제출이 아니므로 자동 진행한다 (사용자 확인 2026-07-12).
  // 다시 보지 않기 checkbox는 건드리지 않는다.
  private advanceRequestNotice(): PostSlotActionResult {
    const sheet = findRequestSheet(this.document);
    if (!sheet) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    return this.clickProgress(sheet, ["예약 신청"], "승인제 예약 안내에서 예약 신청으로 진행했습니다.");
  }

  private advancePromoInterstitial(): PostSlotActionResult {
    const dismiss = findPromoDismissButton(this.document);
    if (!dismiss) return { status: "waiting", message: "다음 후속 화면을 기다립니다." };
    dismiss.click();
    return { status: "acted", message: "매장 홍보 안내 창을 닫았습니다." };
  }

  // 예약 폼 위 홍보 안내는 화면 증거만 있으므로 확인했어요 버튼 텍스트로만 판정한다.
  private formNoticeButton(): HTMLButtonElement | null {
    return visibleAll<HTMLButtonElement>(this.document, "button")
      .find((button) => normalizedText(button.textContent) === "확인했어요"
        && !isDisabled(button)) ?? null;
  }

  private advanceFormNotice(): PostSlotActionResult {
    const notice = this.formNoticeButton();
    if (!notice) return { status: "waiting", message: "예약 폼 안내 확인을 기다립니다." };
    notice.click();
    return { status: "acted", message: "예약 폼 안내 창을 닫았습니다." };
  }

  private enabledChoices(dialog: Element, selector: string): Element[] {
    return visibleAll(dialog, selector).filter((element) => !isDisabled(element));
  }

  private clickProgress(dialog: Element, labels: string[], message: string): PostSlotActionResult {
    const expected = labels.map(normalizedText);
    const progress = visibleAll<HTMLButtonElement>(dialog, "button")
      .find((button) => expected.includes(normalizedText(button.textContent)));
    if (!progress) return { status: "blocked", message: `${labels.join("/")} 버튼을 찾을 수 없습니다.` };
    if (isDisabled(progress)) return { status: "waiting", message: `${normalizedText(progress.textContent)} 버튼 활성화를 기다립니다.` };
    progress.click();
    return { status: "acted", message };
  }
}
