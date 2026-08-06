// 실측 출처: docs/analysis/site-behavior.md §12 (CatchPay 예약 완주 실측, 2026-07-24).
// 이 Adapter는 DOM facts와 fresh-fingerprint 원자 action만 소유한다(20-design.md §3.1).
// 정책·timeout·상태 전이·telemetry·secret 수명은 CompletionCoordinator(이후 Task) 몫이다.
//
// 매장 표시명(20-design.md §4.3, site-behavior.md §12.8): 폼 본문 main 밖 top-bar의
// 네이티브 header 안 단일 h1에만 있다(0원·유료 폼 교차 실측). header 내부에는 이 h1과
// 닫기 버튼만 있다. document.title, 본문의 다른 heading, generated class/id/aria-label/
// aria-labelledby는 anchor로 쓰지 않는다 — 두 표본 모두 이런 속성이 없었다.
import type { TraceAttributes } from "../../shared/telemetry/types.js";
import {
  fnvHash,
  isDisabled,
  isElementHidden,
  isElementVisuallyHidden,
  maskPii,
  normalizedText,
  safeText,
  visibleAll,
} from "./dom.js";

export type ReservationFormUnknownCode =
  | "amount_ambiguous"
  | "amount_over_limit"
  | "intent_mismatch"
  | "hold_countdown_unknown"
  | "catchpay_not_ready"
  | "unsupported_required_input"
  | "ambiguous_final_button"
  | "pin_keypad_unsupported";

/** ready 판정의 매장명·날짜·인원 비교값 — 폼 요약 텍스트 형식과 동일해야 한다
 * (예: dateText "08월 10일"). shopDisplayName은 top-bar header > h1 textContent와
 * 정규화 정확 일치해야 한다.
 *
 * 시각은 비교하지 않는다(01-form-variant-resilience/20-design.md §2): 슬롯은 사용자가
 * 지정한 시각이 아니라 설정 구간 안에서 실행 중 잡힌 결과이고, 사이트가 같은 시각을
 * 12시간제 "오후 6시 30분"과 24시간제 "오후 18:30"로 동시에 렌더한다(site-behavior.md §12.21). */
export interface ReservationFormExpectation {
  shopDisplayName: string;
  dateText: string;
  personText: string;
}

/** success 판정의 방문예정 목록 비교값 — 목록 표기 형식과 동일해야 한다(예: "2026.08.10 (월)").
 * 폼 intent와 같은 이유로 시각은 비교하지 않는다. */
export interface ReservationSuccessExpectation {
  shopDisplayName: string;
  listingDateText: string;
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
  generalPaymentSelected: boolean;
  requiredAgreementCount: number;
  uncheckedRequiredAgreementCount: number;
  emptyRequiredMultilineCount: number;
  optionalAgreementCount: number;
  checkedOptionalAgreementCount: number;
  optionalAgreementFingerprint: string;
}

export interface CatchPayPinFacts {
  sameOrigin: boolean;
  sameDocument: boolean;
  iframeCount: number;
  passwordInputCount: number;
  digitCount: number;
  innerSubmitEnabled: boolean;
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
  | {
    kind: "unknown";
    code: ReservationFormUnknownCode;
    /** 인계 사유를 진단 번들만으로 특정하기 위한 판정 근거(20-design.md §4). */
    evidence: TraceAttributes;
    fingerprint: string;
  };

type ReservationFormPageInspection = Exclude<
  ReservationFormInspection,
  { kind: "pin" } | { kind: "success" }
>;

const CATCHPAY_ORIGIN = "https://app.catchtable.co.kr";
const SUCCESS_PATH = "/ct/mydining/my/planned";
/** 실측된 두 라벨 `자동결제로 예약하기`(§12.3/12.4/12.6)와 `예약하기`(§12.21)를 한 규칙으로
 * 덮는다. suffix 앵커라 `예약하기 전에…` 류 안내 버튼은 걸리지 않고, 느슨해진 매칭의 대가는
 * 호출부의 "정확히 1개" 조건이 받는다. */
const FINAL_BUTTON_PATTERN = /예약하기$/;
/** 실측된 두 완료 문구를 한 규칙으로 덮는다: `자동결제로 예약을 완료했습니다`(§12.5/§12.16)와
 * `예약을 완료했습니다`(§12.22). 최종 버튼과 같은 suffix 앵커이며, 부모의 후속 안내까지 포함한
 * 텍스트는 suffix가 달라 걸리지 않는다. */
const COMPLETION_MESSAGE_PATTERN = /예약을 완료했습니다$/;
const PIN_HEADING = "캐치페이 비밀번호 입력";
const REQUIRED_MARK = "[필수]";
const OPTIONAL_MARK = "[선택]";
const GROUP_LABELS = new Set(["모두 동의합니다", "모두 동의합니다.", "이용자 약관 전체 동의"]);
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

/** site-behavior.md §12.15: label/aria가 없는 textarea는 가장 가까운
 * 단일-textarea 질문 container의 유일한 direct heading으로만 marker를 보완한다. */
function questionHeadingText(input: Element): string {
  if (input.tagName !== "TEXTAREA") return "";
  for (let container = input.parentElement; container; container = container.parentElement) {
    const textareas = Array.from(container.querySelectorAll("textarea"));
    if (textareas.length !== 1 || textareas[0] !== input) return "";
    const headings = Array.from(container.children)
      .filter((child) => /^H[1-6]$/.test(child.tagName));
    if (headings.length > 0) {
      return headings.length === 1 ? safeText(headings[0].textContent) : "";
    }
  }
  return "";
}

/** 20-design.md §5.2: "[필수]" 표기는 control 자신의 label뿐 아니라 같은 section에
 * 있어도 된다(예: 매장 유의사항 섹션 머리글 "[필수] 확인해주세요."). control 자신의
 * label에 표기가 없으면 가장 가까운 fieldset/section의 heading 텍스트로 대체한다. */
function effectiveMarkerText(input: Element): string {
  const own = labelTextFor(input);
  if (own.includes(REQUIRED_MARK) || own.includes(OPTIONAL_MARK)) return own;
  const questionHeading = questionHeadingText(input);
  if (questionHeading.includes(REQUIRED_MARK) || questionHeading.includes(OPTIONAL_MARK)) {
    return questionHeading;
  }
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

type HiddenPredicate = (element: Element) => boolean;

function availableAll<T extends Element>(
  root: ParentNode,
  selector: string,
  isHidden: HiddenPredicate,
): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((element) => !isHidden(element));
}

function isStruckThrough(element: Element, isHidden: HiddenPredicate = isElementHidden): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.tagName === "S" || current.tagName === "DEL") return true;
    if (isHidden(current)) return true;
    const decoration = current.ownerDocument.defaultView?.getComputedStyle(current).textDecorationLine;
    if (decoration?.includes("line-through")) return true;
  }
  return false;
}

/** "결제금액"/"총 결제 금액" 라벨과 구조적으로 연결된 컨테이너 안에서 취소선이 아닌
 * KRW 값만 모은다(20-design.md §4.1). */
function collectCurrentAmounts(
  document: Document,
  isHidden: HiddenPredicate = isElementHidden,
): number[] {
  const labels = availableAll<HTMLElement>(document, "p, dt, span, div, h1, h2, h3", isHidden)
    .filter((el) => {
      const own = safeText(el.textContent);
      return own === "결제금액" || own === "총 결제 금액";
    });
  if (labels.length === 0) return [];
  const currentByLabel: number[] = [];
  for (const label of labels) {
    // 라벨의 바로 다음 형제 요소만 금액 값의 범위로 삼는다 — 같은 컨테이너의 다른
    // 안내 문구(예: "100원 결제 후 즉시 취소")에 있는 무관한 KRW 언급을 배제하기 위함이다.
    const container = label.nextElementSibling;
    if (!container) return [];
    const candidates = [container, ...Array.from(container.querySelectorAll("*"))];
    const amountPattern = /^([\d,]+)\s*원$/;
    const currentText = (element: Element): string => {
      const walker = document.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
      const parts: string[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (!parent || isStruckThrough(parent, isHidden) || isHidden(parent)) continue;
        parts.push(node.textContent ?? "");
      }
      return safeText(parts.join(""));
    };
    const matchingElements = candidates.filter((element) =>
      !isStruckThrough(element, isHidden) && !isHidden(element) && amountPattern.test(currentText(element)));
    const amountElements = matchingElements.filter((element) =>
      !matchingElements.some((other) => other !== element && element.contains(other)));
    const amounts = amountElements.map((element) =>
      Number(currentText(element).match(amountPattern)![1].replace(/,/g, "")));
    if (amounts.length !== 1 || !Number.isFinite(amounts[0])) return [];
    currentByLabel.push(amounts[0]);
  }
  const unique = [...new Set(currentByLabel)];
  return unique.length === 1 ? unique : [];
}

function findFinalButtons(document: Document): HTMLButtonElement[] {
  return visibleAll<HTMLButtonElement>(document, "button")
    .filter((button) => FINAL_BUTTON_PATTERN.test(normalizedText(button.textContent)));
}

function hasLoginGate(document: Document): boolean {
  const headings = visibleAll<HTMLElement>(document, "h1, h2, h3, [role=heading]");
  if (headings.some((heading) => safeText(heading.textContent) === "회원가입하며 예약하기")) return true;
  return visibleAll<HTMLButtonElement>(document, "button").some((button) => safeText(button.textContent) === "가입하기");
}

function paymentTypeRadios(
  document: Document,
  isHidden: HiddenPredicate = isElementHidden,
): HTMLInputElement[] {
  return availableAll<HTMLInputElement>(document, 'input[type="radio"][name="payment-type"]', isHidden);
}

function paymentLabelText(radio: HTMLInputElement): string {
  const labels: string[] = [];
  for (let current = radio.parentElement; current && current.tagName !== "SECTION"; current = current.parentElement) {
    if (current.tagName === "LABEL") labels.push(safeText(current.textContent));
  }
  return labels.sort((a, b) => b.length - a.length)[0] ?? labelTextFor(radio);
}

function catchPayFacts(
  document: Document,
  isHidden: HiddenPredicate = isElementHidden,
): { checked: boolean; generalSelected: boolean } {
  const radios = paymentTypeRadios(document, isHidden);
  const explicitCatchPay = radios.filter((radio) => paymentLabelText(radio).includes("캐치페이"));
  const generalCandidates = radios.filter((radio) => paymentLabelText(radio).includes("일반결제"));
  const general = generalCandidates.length === 1 ? generalCandidates[0] : undefined;
  const catchPay = explicitCatchPay.length === 1 && general && explicitCatchPay[0] !== general
    ? explicitCatchPay[0]
    : radios.length === 2 && general
      ? radios.find((radio) => radio !== general)
      : undefined;
  return {
    checked: catchPay?.checked === true,
    generalSelected: general?.checked === true
      || (catchPay !== undefined && radios.some((radio) => radio !== catchPay && radio.checked)),
  };
}

interface RequiredInputScan {
  requiredAgreementCount: number;
  emptyRequiredMultilineCount: number;
  optionalAgreementCount: number;
  checkedOptionalAgreementCount: number;
  optionalAgreementFingerprint: string;
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
  let checkedOptionalAgreementCount = 0;
  const optionalAgreementStates: Array<[string, boolean]> = [];
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
      if (checkbox.checked) checkedOptionalAgreementCount += 1;
      optionalAgreementStates.push([safeText(checkbox.closest("label")?.textContent), checkbox.checked]);
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
    requiredAgreementCount, emptyRequiredMultilineCount, optionalAgreementCount, checkedOptionalAgreementCount,
    optionalAgreementFingerprint: fnvHash(JSON.stringify(optionalAgreementStates)),
    unsupportedRequiredInput,
    uncheckedRequiredCount, groupChecked,
  };
}

function readyFacts(document: Document, currentAmountKrw: number): ReservationFormFacts {
  const catchPay = catchPayFacts(document);
  const scan = scanRequiredInputs(document);
  return {
    currentAmountKrw,
    catchPayChecked: catchPay.checked,
    generalPaymentSelected: catchPay.generalSelected,
    requiredAgreementCount: scan.requiredAgreementCount,
    uncheckedRequiredAgreementCount: scan.uncheckedRequiredCount,
    emptyRequiredMultilineCount: scan.emptyRequiredMultilineCount,
    optionalAgreementCount: scan.optionalAgreementCount,
    checkedOptionalAgreementCount: scan.checkedOptionalAgreementCount,
    optionalAgreementFingerprint: scan.optionalAgreementFingerprint,
  };
}

/** 20-design.md §4.3 / site-behavior.md §12.8/§12.12: 폼 매장명은 유일하고 비어 있지 않은
 * header h1 textContent에서만 읽는다. 부재·중복·빈 값은 null(불일치로 취급)이고
 * document.title이나 다른 heading으로 fallback하지 않는다. */
function readShopDisplayNameFromHeader(
  document: Document,
  isHidden?: HiddenPredicate,
): string | null {
  const candidates = Array.from(document.querySelectorAll("header h1"))
    .filter((element) => isHidden === undefined || !isHidden(element));
  if (candidates.length !== 1) return null;
  const text = safeText(candidates[0].textContent);
  return text === "" ? null : text;
}

function shopNameMatches(
  document: Document,
  expectation: ReservationFormExpectation,
  isHidden?: HiddenPredicate,
): boolean {
  const shopDisplayName = readShopDisplayNameFromHeader(document, isHidden);
  return shopDisplayName !== null && normalizedText(shopDisplayName) === normalizedText(expectation.shopDisplayName);
}

function reservationSummaryElements(
  document: Document,
  isHidden: HiddenPredicate = isElementHidden,
): HTMLElement[] {
  const candidates = availableAll<HTMLElement>(document, "p, div, span", isHidden)
    .filter((element) => {
      const text = normalizedText(element.textContent);
      return /\d{1,2}월\s*\d{1,2}일/.test(text) && /오전|오후/.test(text) && /\d+\s*명/.test(text);
    });
  return candidates.filter((element) =>
    !candidates.some((other) => other !== element && element.contains(other)));
}

/** 요약 후보 중 날짜와 인원이 모두 일치하는 것이 하나라도 있는지. 시각은 비교하지 않는다. */
function datePersonMatches(
  document: Document,
  expectation: ReservationFormExpectation,
  isHidden: HiddenPredicate = isElementHidden,
): boolean {
  return reservationSummaryElements(document, isHidden).some((el) => {
    const text = normalizedText(el.textContent);
    return text.includes(normalizedText(expectation.dateText))
      && text.includes(normalizedText(expectation.personText));
  });
}

function intentMatches(
  document: Document,
  expectation: ReservationFormExpectation,
  isHidden: HiddenPredicate = isElementHidden,
): boolean {
  return shopNameMatches(document, expectation, isHidden)
    && datePersonMatches(document, expectation, isHidden);
}

/** intent 판정을 항목별로 분해한 근거. 어느 비교가 깨졌는지 진단 번들에서 바로 읽기 위한 것이다. */
function intentEvidence(
  document: Document,
  expectation: ReservationFormExpectation,
): TraceAttributes {
  const summaries = reservationSummaryElements(document)
    .map((el) => normalizedText(el.textContent));
  const dateMatch = summaries.some((text) => text.includes(normalizedText(expectation.dateText)));
  const personMatch = summaries.some((text) => text.includes(normalizedText(expectation.personText)));
  return {
    formShopDisplayName: readShopDisplayNameFromHeader(document) ?? "",
    formExpectedShopDisplayName: expectation.shopDisplayName,
    formShopNameMatch: shopNameMatches(document, expectation),
    formDateMatch: dateMatch,
    formPersonMatch: personMatch,
    formExpectedDateText: expectation.dateText,
    formExpectedPersonText: expectation.personText,
    // 요약 블록에는 방문자 관련 문구가 붙을 수 있어 마스킹 후 기록한다(20-design.md §4.3).
    formSummaryTexts: maskPii(summaries.join(" | ")),
  };
}

/** action 직전 stale intent를 검출하기 위한 실제 DOM 값. expectation 일치 boolean만
 * fingerprint하면 일치했던 날짜·시간·인원이 나중에 바뀌어도 true가 유지될 수 있다. */
function reservationIntentShape(document: Document): {
  shopDisplayName: string | null;
  summaryTexts: string[];
} {
  const summaryTexts = reservationSummaryElements(document)
    .map((el) => normalizedText(el.textContent))
    .filter(Boolean);
  return {
    shopDisplayName: readShopDisplayNameFromHeader(document),
    summaryTexts: [...new Set(summaryTexts)].sort(),
  };
}

function holdState(document: Document): "active" | "expired" | "unknown" {
  const bodyText = normalizedText(document.body?.textContent);
  if (bodyText.includes(normalizedText(HOLD_EXPIRED_TEXT))) return "expired";
  if (HOLD_ACTIVE_PATTERN.test(document.body?.textContent ?? "")) return "active";
  return "unknown";
}

// ---- PIN ----

function findPinSurface(document: Document): HTMLElement | null {
  const headings = availableAll<HTMLElement>(
    document,
    "h1, h2, h3, [role=heading]",
    isElementVisuallyHidden,
  );
  const matches = headings.filter((el) => safeText(el.textContent) === PIN_HEADING);
  if (matches.length === 0) return null;
  // live PIN overlay는 상단·본문 heading을 중복 렌더하지만 dialog role을
  // 노출하지 않는다. 문서 전체에서 keypad control 집합의 유일성을 검증한다.
  return document.body;
}

function pinDigitButtons(scope: Element): HTMLButtonElement[] {
  return availableAll<HTMLButtonElement>(scope, "button", isElementVisuallyHidden)
    .filter((button) => /^\d$/.test(normalizedText(button.textContent)));
}

function pinInnerSubmitButton(scope: Element): HTMLButtonElement | null {
  const matches = availableAll<HTMLButtonElement>(scope, "button", isElementVisuallyHidden)
    .filter((button) => safeText(button.textContent) === "결제하기");
  return matches.length === 1 ? matches[0] : null;
}

function pinKeypadValid(document: Document, dialog: HTMLElement): boolean {
  if (document.location.origin !== CATCHPAY_ORIGIN || document.location.pathname !== "/ct/reservation/form") return false;
  const iframeCount = document.querySelectorAll("iframe").length;
  const passwordInputCount = document.querySelectorAll('input[type="password"]').length;
  if (iframeCount > 0 || passwordInputCount > 0) return false;
  const digitButtons = pinDigitButtons(dialog);
  if (digitButtons.length !== 10) return false;
  const digits = new Set(digitButtons.map((button) => normalizedText(button.textContent)));
  const clearButtons = availableAll<HTMLButtonElement>(dialog, "button", isElementVisuallyHidden)
    .filter((button) => safeText(button.textContent) === "전체삭제");
  return digits.size === 10 && clearButtons.length === 1 && pinInnerSubmitButton(dialog) !== null;
}

// ---- success ----

/** 완료 문구는 가장 작은 visible element 기준으로 판정한다(§12.16) — 부모의 후속 안내까지
 * 삼키지 않기 위함이다. */
function hasCompletionMessage(document: Document): boolean {
  const matches = visibleAll<HTMLElement>(
    document,
    "div, p, span, strong, h1, h2, h3, h4, h5, h6, [role=heading]",
  ).filter((element) => COMPLETION_MESSAGE_PATTERN.test(normalizedText(element.textContent)));
  return matches.some((element) =>
    !matches.some((other) => other !== element && element.contains(other)));
}

function listingMatches(document: Document, expectation: ReservationSuccessExpectation): boolean {
  const items = visibleAll<HTMLElement>(document, "li");
  return items.some((item) => {
    const text = normalizedText(item.textContent);
    return text.includes(normalizedText(expectation.shopDisplayName))
      && text.includes(normalizedText(expectation.listingDateText))
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
        matchedMessage: hasCompletionMessage(document),
        listingMatch: listingMatches(document, options.successExpectation),
      };
      return { kind: "success", facts, fingerprint: fp("rf-success", facts) };
    }

    const pinDialog = findPinSurface(document);
    if (pinDialog) {
      if (!pinKeypadValid(document, pinDialog)) {
        const shape = {
          iframeCount: document.querySelectorAll("iframe").length,
          passwordInputCount: document.querySelectorAll('input[type="password"]').length,
          digits: pinDigitButtons(pinDialog).map((button) => normalizedText(button.textContent)).sort(),
        };
        return {
          kind: "unknown",
          code: "pin_keypad_unsupported",
          // PIN 화면의 텍스트·입력값은 담지 않는다 — 구조 카운트만 기록한다.
          evidence: {
            formInspectionKind: "unknown",
            formUnknownCode: "pin_keypad_unsupported",
            pinIframeCount: shape.iframeCount,
            pinPasswordInputCount: shape.passwordInputCount,
            pinDigitButtonCount: shape.digits.length,
          },
          fingerprint: fp("rf-pin-invalid", shape),
        };
      }
      const innerButton = pinInnerSubmitButton(pinDialog);
      const facts: CatchPayPinFacts = {
        sameOrigin: document.location.origin === CATCHPAY_ORIGIN,
        sameDocument: true,
        iframeCount: 0,
        passwordInputCount: 0,
        digitCount: 10,
        innerSubmitEnabled: innerButton ? !isDisabled(innerButton) : false,
      };
      const shape = { facts, innerEnabled: innerButton ? !isDisabled(innerButton) : false };
      return { kind: "pin", facts, fingerprint: fp("rf-pin", shape) };
    }

    return this.inspectReservationForm(options);
  }

  /** PIN modal이 바깥 form을 접근성 tree에서 감춰도 stable 결제 context만 다시 검증한다. */
  paymentContextMatchesBelowPin(
    options: ReservationFormInspectOptions,
    expectedAmountKrw: number,
  ): boolean {
    const pinDialog = findPinSurface(this.document);
    if (!pinDialog || !pinKeypadValid(this.document, pinDialog)) return false;
    const amounts = collectCurrentAmounts(this.document, isElementVisuallyHidden);
    if (amounts.length !== 1 || amounts[0] !== expectedAmountKrw) return false;
    if (!intentMatches(this.document, options.expectation, isElementVisuallyHidden)) return false;
    const catchPay = catchPayFacts(this.document, isElementVisuallyHidden);
    return catchPay.checked && !catchPay.generalSelected;
  }

  private inspectReservationForm(options: ReservationFormInspectOptions): ReservationFormPageInspection {
    const { document } = this;
    if (hasLoginGate(document)) {
      return { kind: "login_required", fingerprint: fp("rf-login", { url: document.location.pathname }) };
    }

    const hold = holdState(document);
    if (hold === "expired") {
      return { kind: "hold_expired", fingerprint: fp("rf-hold-expired", { url: document.location.pathname }) };
    }
    if (hold === "unknown") {
      // 금액·약관·결제수단은 아직 읽지 않았다. 이 시점에 실제로 아는 값만 담는다.
      return {
        kind: "unknown",
        code: "hold_countdown_unknown",
        evidence: {
          formInspectionKind: "unknown",
          formUnknownCode: "hold_countdown_unknown",
          formHoldState: hold,
        },
        fingerprint: fp("rf-hold-unknown", { url: document.location.pathname }),
      };
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
      intent: reservationIntentShape(document),
      intentMatch: intentMatches(document, options.expectation),
    };
    const fingerprint = fp("rf-ready", shape);
    const unknown = (code: ReservationFormUnknownCode): ReservationFormPageInspection => ({
      kind: "unknown",
      code,
      evidence: {
        formInspectionKind: "unknown",
        formUnknownCode: code,
        formHoldState: hold,
        ...intentEvidence(document, options.expectation),
        // 결제 수단 행에는 등록 카드 라벨이 렌더되므로 텍스트는 담지 않는다(20-design.md §4.3).
        formCatchPayChecked: catchPay.checked,
        formGeneralPaymentSelected: catchPay.generalSelected,
        formPaymentRadioCount: paymentTypeRadios(document).length,
        formAmounts: amounts.join(","),
        formAmountLimit: options.maxPaymentAmountKrw,
        formButtonTexts: maskPii(visibleAll<HTMLButtonElement>(document, "button")
          .map((button) => safeText(button.textContent))
          .filter(Boolean)
          .join(" | ")),
        formFinalButtonCount: finalButtons.length,
        formRequiredAgreementCount: scan.requiredAgreementCount,
        formUncheckedRequiredAgreementCount: scan.uncheckedRequiredCount,
        formEmptyRequiredMultilineCount: scan.emptyRequiredMultilineCount,
        formOptionalAgreementCount: scan.optionalAgreementCount,
        formUnsupportedRequiredInput: scan.unsupportedRequiredInput,
      },
      fingerprint,
    });

    if (amounts.length !== 1) return unknown("amount_ambiguous");
    const currentAmountKrw = amounts[0];
    if (currentAmountKrw < 0 || currentAmountKrw > options.maxPaymentAmountKrw) {
      return unknown("amount_over_limit");
    }
    if (!intentMatches(document, options.expectation)) {
      return unknown("intent_mismatch");
    }
    if (!catchPay.checked || catchPay.generalSelected) {
      return unknown("catchpay_not_ready");
    }
    if (scan.unsupportedRequiredInput) {
      return unknown("unsupported_required_input");
    }
    if (finalButtons.length !== 1) {
      return unknown("ambiguous_final_button");
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
    const setter = Object.getOwnPropertyDescriptor(
      this.document.defaultView!.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (!setter) return false;
    setter.call(target, defaultAnswer);
    target.dispatchEvent(new this.document.defaultView!.InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: defaultAnswer,
    }));
    target.dispatchEvent(new this.document.defaultView!.Event("change", { bubbles: true }));
    return target.value === defaultAnswer;
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
      if (individualRequired.checked) return true;
    }
    const group = checkboxes.find((checkbox) => GROUP_LABELS.has(safeText(checkbox.closest("label")?.textContent)) && !checkbox.checked);
    if (!group) return false;
    if (!this.isSafeGroup(group)) return false;
    const members = this.groupMembers(group);
    if (individualRequired && (!members || !members.includes(individualRequired))) return false;
    group.click();
    // React가 group/member checked를 비동기로 반영할 수 있다(실측 76.6ms).
    // Coordinator가 bounded settle 뒤 전체 facts와 optional baseline을 재검증한다.
    return true;
  }

  private groupMembers(group: HTMLInputElement): HTMLInputElement[] | null {
    let container = group.parentElement;
    while (container) {
      const visibleCheckboxes = visibleAll<HTMLInputElement>(container, 'input[type="checkbox"]');
      if (visibleCheckboxes.length > 1) {
        return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
          .filter((el) => el !== group && !isDisabled(el));
      }
      container = container.parentElement;
    }
    return null;
  }

  private isSafeGroup(group: HTMLInputElement): boolean {
    const members = this.groupMembers(group);
    if (!members || members.length === 0) return false;
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
    const dialog = findPinSurface(this.document);
    if (!dialog || !this.freshPinFingerprint(dialog, fingerprint)) return false;
    const target = pinDigitButtons(dialog).find((button) => normalizedText(button.textContent) === digit);
    if (!target) return false;
    target.click();
    return true;
  }

  submitInner(fingerprint: string): boolean {
    const dialog = findPinSurface(this.document);
    if (!dialog || !this.freshPinFingerprint(dialog, fingerprint)) return false;
    const innerButton = pinInnerSubmitButton(dialog);
    if (!innerButton || isDisabled(innerButton)) return false;
    innerButton.click();
    return true;
  }

  private freshPinFingerprint(dialog: HTMLElement, fingerprint: string): boolean {
    if (!pinKeypadValid(this.document, dialog)) return false;
    const innerButton = pinInnerSubmitButton(dialog);
    const facts: CatchPayPinFacts = {
      sameOrigin: this.document.location.origin === CATCHPAY_ORIGIN,
      sameDocument: true,
      iframeCount: 0,
      passwordInputCount: 0,
      digitCount: 10,
      innerSubmitEnabled: innerButton ? !isDisabled(innerButton) : false,
    };
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
      intent: reservationIntentShape(this.document),
      intentMatch: true,
    };
    return fp("rf-ready", shape) === fingerprint;
  }
}
