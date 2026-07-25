// 실측 출처: docs/analysis/site-behavior.md §12 (CatchPay 예약 완주 실측, 2026-07-24).
// 이 Adapter는 DOM facts와 fresh-fingerprint 원자 action만 소유한다(20-design.md §3.1).
// 정책·timeout·상태 전이·telemetry·secret 수명은 CompletionCoordinator(이후 Task) 몫이다.
//
// 매장 표시명(20-design.md §4.3, site-behavior.md §12.8): 폼 본문 main 밖 top-bar의
// 네이티브 header 안 단일 h1에만 있다(0원·유료 폼 교차 실측). header 내부에는 이 h1과
// 닫기 버튼만 있다. document.title, 본문의 다른 heading, generated class/id/aria-label/
// aria-labelledby는 anchor로 쓰지 않는다 — 두 표본 모두 이런 속성이 없었다.
import { fnvHash, isDisabled, isElementHidden, normalizedText, safeText, visibleAll } from "./dom.js";

export type ReservationFormUnknownCode =
  | "amount_ambiguous"
  | "amount_over_limit"
  | "intent_mismatch"
  | "hold_countdown_unknown"
  | "catchpay_not_ready"
  | "unsupported_required_input"
  | "ambiguous_final_button"
  | "pin_keypad_unsupported";

/** ready 판정의 매장명·날짜·시간·인원 비교값 — 폼 요약 텍스트 형식과 동일해야 한다
 * (예: dateText "08월 10일"). shopDisplayName은 top-bar header > h1 textContent와
 * 정규화 정확 일치해야 한다. */
export interface ReservationFormExpectation {
  shopDisplayName: string;
  dateText: string;
  timeText: string;
  personText: string;
}

/** success 판정의 방문예정 목록 비교값 — 목록 표기 형식과 동일해야 한다(예: "2026.08.10 (월)"). */
export interface ReservationSuccessExpectation {
  shopDisplayName: string;
  listingDateText: string;
  timeText: string;
  personText: string;
}

export interface ReservationFormInspectOptions {
  expectation: ReservationFormExpectation;
  successExpectation: ReservationSuccessExpectation;
  maxPaymentAmountKrw: number;
}

export interface ReservationFormFacts {
  currentAmountKrw: number;
  catchPayChecked: boolean;
  catchPayRegistered: boolean;
  generalPaymentSelected: boolean;
  requiredAgreementCount: number;
  emptyRequiredMultilineCount: number;
  optionalAgreementCount: number;
}

export interface CatchPayPinFacts {
  sameOrigin: boolean;
  sameDocument: boolean;
  iframeCount: number;
  passwordInputCount: number;
  digitCount: number;
}

export interface CompletionFacts {
  path: string;
  matchedMessage: boolean;
  listingMatch: boolean;
}

export type ReservationFormInspection =
  | { kind: "login_required"; fingerprint: string }
  | { kind: "ready"; facts: ReservationFormFacts; fingerprint: string }
  | { kind: "pin"; facts: CatchPayPinFacts; fingerprint: string }
  | { kind: "success"; facts: CompletionFacts; fingerprint: string }
  | { kind: "hold_expired"; fingerprint: string }
  | { kind: "unknown"; code: ReservationFormUnknownCode; fingerprint: string };

const CATCHPAY_ORIGIN = "https://app.catchtable.co.kr";
const SUCCESS_PATH = "/ct/mydining/my/planned";
const FINAL_BUTTON_LABEL = "자동결제로 예약하기";
const COMPLETION_MESSAGE = "자동결제로 예약을 완료했습니다";
const PIN_HEADING = "캐치페이 비밀번호 입력";
const REQUIRED_MARK = "[필수]";
const OPTIONAL_MARK = "[선택]";
const GROUP_LABELS = new Set(["모두 동의합니다", "이용자 약관 전체 동의"]);
const HOLD_EXPIRED_TEXT = "예약 찜 시간이 만료되었습니다";
const HOLD_ACTIVE_PATTERN = /\d+\s*분간\s*예약\s*찜/;

function fp(prefix: string, facts: unknown): string {
  return `${prefix}-${fnvHash(JSON.stringify(facts))}`;
}

function labelTextFor(input: Element): string {
  const label = input.closest("label");
  if (label) return safeText(label.textContent);
  return safeText(input.getAttribute("aria-label"));
}

/** 20-design.md §5.2: "[필수]" 표기는 control 자신의 label뿐 아니라 같은 section에
 * 있어도 된다(예: 매장 유의사항 섹션 머리글 "[필수] 확인해주세요."). control 자신의
 * label에 표기가 없으면 가장 가까운 fieldset/section의 heading 텍스트로 대체한다. */
function effectiveMarkerText(input: Element): string {
  const own = labelTextFor(input);
  if (own.includes(REQUIRED_MARK) || own.includes(OPTIONAL_MARK)) return own;
  const container = input.closest("fieldset, section");
  if (!container) return own;
  // section 머리글 후보는 P/LEGEND/heading만 인정한다 — 다른 control을 감싼 형제
  // <label>은 그 control 자신의 답변일 뿐 section 전체에 적용되는 표기가 아니다.
  const heading = Array.from(container.children).find((child) => {
    if (!/^(P|LEGEND|H1|H2|H3)$/.test(child.tagName)) return false;
    const text = safeText(child.textContent);
    return text.includes(REQUIRED_MARK) || text.includes(OPTIONAL_MARK);
  });
  return heading ? safeText(heading.textContent) : own;
}

function isStruckThrough(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.tagName === "S" || current.tagName === "DEL") return true;
    if (current.getAttribute("aria-hidden") === "true") return true;
  }
  return false;
}

/** "결제금액"/"총 결제 금액" 라벨과 구조적으로 연결된 컨테이너 안에서 취소선이 아닌
 * KRW 값만 모은다(20-design.md §4.1). */
function collectCurrentAmounts(document: Document): number[] {
  const labels = visibleAll<HTMLElement>(document, "p, dt, span, div, h1, h2, h3")
    .filter((el) => {
      const own = safeText(el.textContent);
      return own === "결제금액" || own === "총 결제 금액";
    });
  if (labels.length !== 1) return [];
  // 라벨의 바로 다음 형제 요소만 금액 값의 범위로 삼는다 — 같은 컨테이너의 다른
  // 안내 문구(예: "100원 결제 후 즉시 취소")에 있는 무관한 KRW 언급을 배제하기 위함이다.
  const container = labels[0].nextElementSibling;
  if (!container) return [];
  const walker = document.createTreeWalker(container, 4 /* NodeFilter.SHOW_TEXT */);
  const amounts: number[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || isStruckThrough(parent) || isElementHidden(parent)) continue;
    const text = node.textContent ?? "";
    for (const match of text.matchAll(/([\d,]+)\s*원/g)) {
      const parsed = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(parsed)) amounts.push(parsed);
    }
  }
  return amounts;
}

function findFinalButtons(document: Document): HTMLButtonElement[] {
  return visibleAll<HTMLButtonElement>(document, "button")
    .filter((button) => normalizedText(button.textContent) === normalizedText(FINAL_BUTTON_LABEL));
}

function hasLoginGate(document: Document): boolean {
  const headings = visibleAll<HTMLElement>(document, "h1, h2, h3, [role=heading]");
  if (headings.some((heading) => safeText(heading.textContent) === "회원가입하며 예약하기")) return true;
  return visibleAll<HTMLButtonElement>(document, "button").some((button) => safeText(button.textContent) === "가입하기");
}

function paymentTypeRadios(document: Document): HTMLInputElement[] {
  return visibleAll<HTMLInputElement>(document, 'input[type="radio"][name="payment-type"]');
}

function catchPayFacts(document: Document): { checked: boolean; registered: boolean; generalSelected: boolean } {
  const radios = paymentTypeRadios(document);
  const catchPay = radios.find((radio) => labelTextFor(radio).includes("캐치페이"));
  const general = radios.find((radio) => labelTextFor(radio).includes("일반결제"));
  const registered = catchPay
    ? (() => {
      let container: Element | null = catchPay.closest("label")?.parentElement ?? null;
      while (container) {
        if (normalizedText(container.textContent).includes(normalizedText("이 카드로 식사 금액이 자동결제 됩니다."))) {
          return true;
        }
        container = container.parentElement;
      }
      return false;
    })()
    : false;
  return {
    checked: catchPay?.checked === true,
    registered,
    generalSelected: general?.checked === true,
  };
}

interface RequiredInputScan {
  requiredAgreementCount: number;
  emptyRequiredMultilineCount: number;
  optionalAgreementCount: number;
  unsupportedRequiredInput: boolean;
  /** fingerprint 전용 — checked 상태 변화도 fingerprint를 무효화하도록 별도 추적한다
   * (공개 facts에는 노출하지 않는다: 요구되는 필드는 requiredAgreementCount뿐이다). */
  uncheckedRequiredCount: number;
  groupChecked: boolean;
}

function scanRequiredInputs(document: Document): RequiredInputScan {
  const checkboxes = visibleAll<HTMLInputElement>(document, 'input[type="checkbox"]')
    .filter((el) => !isDisabled(el));
  let requiredAgreementCount = 0;
  let optionalAgreementCount = 0;
  let uncheckedRequiredCount = 0;
  let groupChecked = false;
  for (const checkbox of checkboxes) {
    if (GROUP_LABELS.has(safeText(checkbox.closest("label")?.textContent))) {
      groupChecked = groupChecked || checkbox.checked;
      continue;
    }
    const text = effectiveMarkerText(checkbox);
    if (text.includes(REQUIRED_MARK)) {
      requiredAgreementCount += 1;
      if (!checkbox.checked) uncheckedRequiredCount += 1;
    } else if (text.includes(OPTIONAL_MARK)) {
      optionalAgreementCount += 1;
    }
  }
  const textareas = visibleAll<HTMLTextAreaElement>(document, "textarea");
  let emptyRequiredMultilineCount = 0;
  for (const textarea of textareas) {
    if (effectiveMarkerText(textarea).includes(REQUIRED_MARK) && textarea.value.trim() === "") {
      emptyRequiredMultilineCount += 1;
    }
  }
  const unsupportedRequiredInput = visibleAll<HTMLElement>(document, 'input[type="text"], input[type="email"], input[type="file"], select')
    .some((el) => effectiveMarkerText(el).includes(REQUIRED_MARK));
  return {
    requiredAgreementCount, emptyRequiredMultilineCount, optionalAgreementCount, unsupportedRequiredInput,
    uncheckedRequiredCount, groupChecked,
  };
}

function readyFacts(document: Document, currentAmountKrw: number): ReservationFormFacts {
  const catchPay = catchPayFacts(document);
  const scan = scanRequiredInputs(document);
  return {
    currentAmountKrw,
    catchPayChecked: catchPay.checked,
    catchPayRegistered: catchPay.registered,
    generalPaymentSelected: catchPay.generalSelected,
    requiredAgreementCount: scan.requiredAgreementCount,
    emptyRequiredMultilineCount: scan.emptyRequiredMultilineCount,
    optionalAgreementCount: scan.optionalAgreementCount,
  };
}

/** 20-design.md §4.3 / site-behavior.md §12.8: 폼 매장명은 유일하고 비어 있지 않은
 * header > h1 textContent에서만 읽는다. 부재·중복·빈 값은 null(불일치로 취급)이고
 * document.title이나 다른 heading으로 fallback하지 않는다. */
function readShopDisplayNameFromHeader(document: Document): string | null {
  const candidates = Array.from(document.querySelectorAll("header > h1"));
  if (candidates.length !== 1) return null;
  const text = safeText(candidates[0].textContent);
  return text === "" ? null : text;
}

function shopNameMatches(document: Document, expectation: ReservationFormExpectation): boolean {
  const shopDisplayName = readShopDisplayNameFromHeader(document);
  return shopDisplayName !== null && normalizedText(shopDisplayName) === normalizedText(expectation.shopDisplayName);
}

function dateTimePersonMatches(document: Document, expectation: ReservationFormExpectation): boolean {
  const candidates = visibleAll<HTMLElement>(document, "p, div, span");
  return candidates.some((el) => {
    const text = normalizedText(el.textContent);
    return text.includes(normalizedText(expectation.dateText))
      && text.includes(normalizedText(expectation.timeText))
      && text.includes(normalizedText(expectation.personText));
  });
}

function intentMatches(document: Document, expectation: ReservationFormExpectation): boolean {
  return shopNameMatches(document, expectation) && dateTimePersonMatches(document, expectation);
}

function holdState(document: Document): "active" | "expired" | "unknown" {
  const bodyText = normalizedText(document.body?.textContent);
  if (bodyText.includes(normalizedText(HOLD_EXPIRED_TEXT))) return "expired";
  if (HOLD_ACTIVE_PATTERN.test(document.body?.textContent ?? "")) return "active";
  return "unknown";
}

// ---- PIN ----

function findPinDialog(document: Document): HTMLElement | null {
  const headings = visibleAll<HTMLElement>(document, "h1, h2, h3, [role=heading]");
  const heading = headings.find((el) => safeText(el.textContent) === PIN_HEADING);
  if (!heading) return null;
  return heading.closest('[role="dialog"]') ?? heading.parentElement;
}

function pinDigitButtons(scope: Element): HTMLButtonElement[] {
  return visibleAll<HTMLButtonElement>(scope, "button")
    .filter((button) => /^\d$/.test(normalizedText(button.textContent)));
}

function pinInnerSubmitButton(scope: Element): HTMLButtonElement | null {
  return visibleAll<HTMLButtonElement>(scope, "button")
    .find((button) => safeText(button.textContent) === "결제하기") ?? null;
}

function pinKeypadValid(document: Document, dialog: HTMLElement): boolean {
  const iframeCount = document.querySelectorAll("iframe").length;
  const passwordInputCount = document.querySelectorAll('input[type="password"]').length;
  if (iframeCount > 0 || passwordInputCount > 0) return false;
  const digitButtons = pinDigitButtons(dialog);
  if (digitButtons.length !== 10) return false;
  const digits = new Set(digitButtons.map((button) => normalizedText(button.textContent)));
  return digits.size === 10;
}

// ---- success ----

function findHeadingText(document: Document): string | null {
  const heading = visibleAll<HTMLElement>(document, "h1, h2, h3, [role=heading]").at(0);
  return heading ? safeText(heading.textContent) : null;
}

function listingMatches(document: Document, expectation: ReservationSuccessExpectation): boolean {
  const items = visibleAll<HTMLElement>(document, "li");
  return items.some((item) => {
    const text = normalizedText(item.textContent);
    return text.includes(normalizedText(expectation.shopDisplayName))
      && text.includes(normalizedText(expectation.listingDateText))
      && text.includes(normalizedText(expectation.timeText))
      && text.includes(normalizedText(expectation.personText));
  });
}

export class ReservationFormAdapter {
  constructor(private readonly document: Document) {}

  inspect(options: ReservationFormInspectOptions): ReservationFormInspection {
    const { document } = this;
    if (document.location.pathname === SUCCESS_PATH) {
      const facts: CompletionFacts = {
        path: document.location.pathname,
        matchedMessage: findHeadingText(document) === COMPLETION_MESSAGE,
        listingMatch: listingMatches(document, options.successExpectation),
      };
      return { kind: "success", facts, fingerprint: fp("rf-success", facts) };
    }

    const pinDialog = findPinDialog(document);
    if (pinDialog) {
      if (!pinKeypadValid(document, pinDialog)) {
        const shape = {
          iframeCount: document.querySelectorAll("iframe").length,
          passwordInputCount: document.querySelectorAll('input[type="password"]').length,
          digits: pinDigitButtons(pinDialog).map((button) => normalizedText(button.textContent)).sort(),
        };
        return { kind: "unknown", code: "pin_keypad_unsupported", fingerprint: fp("rf-pin-invalid", shape) };
      }
      const facts: CatchPayPinFacts = {
        sameOrigin: document.location.origin === CATCHPAY_ORIGIN,
        sameDocument: true,
        iframeCount: 0,
        passwordInputCount: 0,
        digitCount: 10,
      };
      const innerButton = pinInnerSubmitButton(pinDialog);
      const shape = { facts, innerEnabled: innerButton ? !isDisabled(innerButton) : false };
      return { kind: "pin", facts, fingerprint: fp("rf-pin", shape) };
    }

    if (hasLoginGate(document)) {
      return { kind: "login_required", fingerprint: fp("rf-login", { url: document.location.pathname }) };
    }

    const hold = holdState(document);
    if (hold === "expired") {
      return { kind: "hold_expired", fingerprint: fp("rf-hold-expired", { url: document.location.pathname }) };
    }
    if (hold === "unknown") {
      return { kind: "unknown", code: "hold_countdown_unknown", fingerprint: fp("rf-hold-unknown", { url: document.location.pathname }) };
    }

    const amounts = collectCurrentAmounts(document);
    const scan = scanRequiredInputs(document);
    const catchPay = catchPayFacts(document);
    const finalButtons = findFinalButtons(document);
    const shape = {
      amounts,
      scan,
      catchPay,
      finalButtonCount: finalButtons.length,
      intentMatch: intentMatches(document, options.expectation),
    };
    const fingerprint = fp("rf-ready", shape);

    if (amounts.length !== 1) return { kind: "unknown", code: "amount_ambiguous", fingerprint };
    const currentAmountKrw = amounts[0];
    if (currentAmountKrw < 0 || currentAmountKrw > options.maxPaymentAmountKrw) {
      return { kind: "unknown", code: "amount_over_limit", fingerprint };
    }
    if (!intentMatches(document, options.expectation)) {
      return { kind: "unknown", code: "intent_mismatch", fingerprint };
    }
    if (!catchPay.checked || !catchPay.registered || catchPay.generalSelected) {
      return { kind: "unknown", code: "catchpay_not_ready", fingerprint };
    }
    if (scan.unsupportedRequiredInput) {
      return { kind: "unknown", code: "unsupported_required_input", fingerprint };
    }
    if (finalButtons.length !== 1) {
      return { kind: "unknown", code: "ambiguous_final_button", fingerprint };
    }
    return { kind: "ready", facts: readyFacts(document, currentAmountKrw), fingerprint };
  }

  /** 빈 supported 필수 multiline 하나를 공통 답변으로 채운다(원자 action). */
  fillRequiredMultiline(fingerprint: string, defaultAnswer: string): boolean {
    if (defaultAnswer.trim() === "") return false;
    if (!this.freshReadyFingerprint(fingerprint)) return false;
    const target = visibleAll<HTMLTextAreaElement>(this.document, "textarea")
      .find((el) => effectiveMarkerText(el).includes(REQUIRED_MARK) && el.value.trim() === "");
    if (!target) return false;
    target.value = defaultAnswer;
    target.dispatchEvent(new this.document.defaultView!.Event("input", { bubbles: true }));
    return true;
  }

  /** 개별 필수 control을 우선 클릭하고, 안전이 증명된 group만 대체로 사용한다. */
  agreeRequired(fingerprint: string): boolean {
    if (!this.freshReadyFingerprint(fingerprint)) return false;
    const checkboxes = visibleAll<HTMLInputElement>(this.document, 'input[type="checkbox"]')
      .filter((el) => !isDisabled(el));
    const individualRequired = checkboxes.find((checkbox) => {
      const text = effectiveMarkerText(checkbox);
      return !GROUP_LABELS.has(safeText(checkbox.closest("label")?.textContent))
        && text.includes(REQUIRED_MARK)
        && !checkbox.checked;
    });
    if (individualRequired) {
      individualRequired.click();
      return true;
    }
    const group = checkboxes.find((checkbox) => GROUP_LABELS.has(safeText(checkbox.closest("label")?.textContent)) && !checkbox.checked);
    if (!group) return false;
    if (!this.isSafeGroup(group)) return false;
    group.click();
    return true;
  }

  private isSafeGroup(group: HTMLInputElement): boolean {
    const container = group.closest("fieldset") ?? group.closest("section") ?? group.parentElement;
    if (!container) return false;
    const members = visibleAll<HTMLInputElement>(container, 'input[type="checkbox"]')
      .filter((el) => el !== group);
    if (members.length === 0) return false;
    const anyOptional = members.some((member) => effectiveMarkerText(member).includes(OPTIONAL_MARK));
    const allRequired = members.every((member) => effectiveMarkerText(member).includes(REQUIRED_MARK));
    return allRequired && !anyOptional;
  }

  submitOuter(fingerprint: string): boolean {
    if (!this.freshReadyFingerprint(fingerprint)) return false;
    const buttons = findFinalButtons(this.document);
    if (buttons.length !== 1) return false;
    buttons[0].click();
    return true;
  }

  enterPinDigit(fingerprint: string, digit: string): boolean {
    const dialog = findPinDialog(this.document);
    if (!dialog || !this.freshPinFingerprint(dialog, fingerprint)) return false;
    const target = pinDigitButtons(dialog).find((button) => normalizedText(button.textContent) === digit);
    if (!target) return false;
    target.click();
    return true;
  }

  submitInner(fingerprint: string): boolean {
    const dialog = findPinDialog(this.document);
    if (!dialog || !this.freshPinFingerprint(dialog, fingerprint)) return false;
    const innerButton = pinInnerSubmitButton(dialog);
    if (!innerButton || isDisabled(innerButton)) return false;
    innerButton.click();
    return true;
  }

  private freshPinFingerprint(dialog: HTMLElement, fingerprint: string): boolean {
    if (!pinKeypadValid(this.document, dialog)) return false;
    const facts: CatchPayPinFacts = {
      sameOrigin: this.document.location.origin === CATCHPAY_ORIGIN,
      sameDocument: true,
      iframeCount: 0,
      passwordInputCount: 0,
      digitCount: 10,
    };
    const innerButton = pinInnerSubmitButton(dialog);
    const shape = { facts, innerEnabled: innerButton ? !isDisabled(innerButton) : false };
    return fp("rf-pin", shape) === fingerprint;
  }

  private freshReadyFingerprint(fingerprint: string): boolean {
    const amounts = collectCurrentAmounts(this.document);
    const scan = scanRequiredInputs(this.document);
    const catchPay = catchPayFacts(this.document);
    const finalButtons = findFinalButtons(this.document);
    const shape = {
      amounts,
      scan,
      catchPay,
      finalButtonCount: finalButtons.length,
      intentMatch: true,
    };
    // action 메서드는 expectation을 받지 않으므로 intentMatch는 fingerprint 계산에서
    // 항상 상수로 고정한다 — inspect()가 만든 fingerprint와 재현 가능하게 맞추려면
    // 호출자가 반드시 direct하게 같은 shape을 구성해야 하므로, 대신 inspect() 쪽
    // fingerprint 계산에서도 intentMatch가 매 호출 동일하면 값이 같다.
    return fp("rf-ready", shape) === fingerprint;
  }
}
