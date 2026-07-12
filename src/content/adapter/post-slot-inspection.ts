import { fnvHash, normalizedText, safeText, visibleAll } from "./dom.js";
import { findActiveDialog, findPromoDismissButton, findRequestSheet } from "./dialog.js";

export { findActiveDialog, findPromoDismissButton, findRequestSheet } from "./dialog.js";

export type PostSlotCertainty = "exact" | "supported" | "unknown";

export interface PostSlotDiagnostics {
  urlKind: "shop" | "reservation_form" | "other";
  label: string;
  title: string;
  buttons: string[];
  disabledButtonCount: number;
  radioCount: number;
  checkboxCount: number;
  quantityControlCount: number;
  zeroDepositControlCount: number;
}

interface InspectionMeta {
  certainty: PostSlotCertainty;
  strategy: string;
  evidence: string[];
  fingerprint: string;
  diagnostics: PostSlotDiagnostics;
}

export type PostSlotInspection = (
  | { kind: "waiting" }
  | { kind: "table_type"; options: string[] }
  | { kind: "menu"; options: string[] }
  | { kind: "extras" }
  | { kind: "deposit_notice" }
  | { kind: "deposit" }
  | { kind: "request_notice" }
  | { kind: "promo_interstitial" }
  | { kind: "form" }
  | { kind: "form_notice" }
  | { kind: "unknown"; label: string }
) & InspectionMeta;

interface DialogSnapshot {
  diagnostics: PostSlotDiagnostics;
  fingerprint: string;
  hasNext: boolean;
  hasConfirm: boolean;
}

export { normalizedText as normalized } from "./dom.js";

export function isZeroDepositControl(element: Element): boolean {
  const label = normalizedText(element.getAttribute("aria-label"));
  return label.includes("예약금") && label.includes("0원") && label.includes("결제");
}

function urlKind(document: Document): PostSlotDiagnostics["urlKind"] {
  if (document.location.pathname === "/ct/reservation/form") return "reservation_form";
  if (document.location.pathname.startsWith("/ct/shop/")) return "shop";
  return "other";
}

function createFingerprint(diagnostics: PostSlotDiagnostics, disabledButtons: boolean[]): string {
  return `ps-${fnvHash(JSON.stringify({
    ...diagnostics,
    disabledButtons,
  }))}`;
}

function emptyDiagnostics(document: Document): PostSlotDiagnostics {
  return {
    urlKind: urlKind(document),
    label: "",
    title: "",
    buttons: [],
    disabledButtonCount: 0,
    radioCount: 0,
    checkboxCount: 0,
    quantityControlCount: 0,
    zeroDepositControlCount: 0,
  };
}

function snapshot(document: Document, dialog: HTMLElement): DialogSnapshot {
  const heading = visibleAll<HTMLElement>(dialog, '[role="heading"], h1, h2').at(0);
  const buttons = visibleAll<HTMLButtonElement>(dialog, "button");
  const buttonTexts = buttons.map((button) => safeText(button.textContent)).filter(Boolean);
  const disabledButtons = buttons.map((button) => button.disabled || button.getAttribute("aria-disabled") === "true");
  const zeroDepositControls = visibleAll(
    dialog,
    '[role="radio"][aria-label], input[type="radio"][aria-label]',
  ).filter(isZeroDepositControl);
  const diagnostics: PostSlotDiagnostics = {
    urlKind: urlKind(document),
    label: safeText(dialog.getAttribute("aria-label")),
    title: safeText(heading?.textContent),
    buttons: buttonTexts,
    disabledButtonCount: disabledButtons.filter(Boolean).length,
    radioCount: visibleAll(dialog, '[role="radio"], input[type="radio"]').length,
    checkboxCount: visibleAll(dialog, '[role="checkbox"], input[type="checkbox"]').length,
    quantityControlCount: visibleAll(dialog, 'input[type="number"][aria-label$="수량"]').length,
    zeroDepositControlCount: zeroDepositControls.length,
  };
  const normalizedButtons = buttonTexts.map(normalizedText);
  return {
    diagnostics,
    fingerprint: createFingerprint(diagnostics, disabledButtons),
    hasNext: normalizedButtons.includes("다음"),
    hasConfirm: normalizedButtons.includes("확인"),
  };
}

function meta(
  snapshotValue: DialogSnapshot,
  certainty: PostSlotCertainty,
  strategy: string,
  evidence: string[],
): InspectionMeta {
  return {
    certainty,
    strategy,
    evidence,
    fingerprint: snapshotValue.fingerprint,
    diagnostics: snapshotValue.diagnostics,
  };
}

function optionLabels(dialog: Element, selector: string): string[] {
  return visibleAll(dialog, selector).map((element) => safeText(element.getAttribute("aria-label")))
    .filter(Boolean);
}

function exactInspection(dialog: HTMLElement, value: DialogSnapshot): PostSlotInspection | null {
  const label = normalizedText(value.diagnostics.label);
  const exact = meta(value, "exact", "aria-label-v1", ["exact aria-label"]);
  if (label === "테이블 타입 선택") {
    return { kind: "table_type", options: optionLabels(dialog, '[role="radio"][aria-label]'), ...exact };
  }
  if (label === "메뉴 선택") {
    return { kind: "menu", options: optionLabels(dialog, '[role="checkbox"][aria-label]'), ...exact };
  }
  if (label === "추가 상품") return { kind: "extras", ...exact };
  if (label === "예약금 안내") return { kind: "deposit_notice", ...exact };
  if (label === "예약금 결제 방법 선택") return { kind: "deposit", ...exact };
  return null;
}

function supportedInspection(dialog: HTMLElement, value: DialogSnapshot): PostSlotInspection | null {
  const title = normalizedText(value.diagnostics.title);
  const progress = value.hasNext || value.hasConfirm;
  if (title.includes("테이블") && title.includes("선택") && value.diagnostics.radioCount > 0 && progress) {
    return {
      kind: "table_type",
      options: optionLabels(dialog, '[role="radio"][aria-label]'),
      ...meta(value, "supported", "table-title-structure-v1", ["table title", "radio controls", "progress button"]),
    };
  }
  if (title.includes("메뉴") && title.includes("선택")
    && (value.diagnostics.checkboxCount > 0 || value.diagnostics.quantityControlCount > 0) && progress) {
    return {
      kind: "menu",
      options: optionLabels(dialog, '[role="checkbox"][aria-label]'),
      ...meta(value, "supported", "menu-title-structure-v1", ["menu title", "selection controls", "progress button"]),
    };
  }
  if (title.includes("추가 상품") && value.hasNext) {
    return { kind: "extras", ...meta(value, "supported", "extras-title-structure-v1", ["extras title", "next button"]) };
  }
  if (title.includes("예약금 안내") && value.hasConfirm && value.diagnostics.zeroDepositControlCount === 0) {
    return {
      kind: "deposit_notice",
      ...meta(value, "supported", "deposit-notice-title-structure-v1", ["deposit notice title", "confirm button"]),
    };
  }
  if (title.includes("예약금") && title.includes("결제") && value.diagnostics.radioCount > 0 && progress) {
    return {
      kind: "deposit",
      ...meta(value, "supported", "deposit-method-title-structure-v1", ["deposit method title", "radio controls", "progress button"]),
    };
  }
  return null;
}

function formInspection(document: Document, notice: boolean): PostSlotInspection {
  const diagnostics = emptyDiagnostics(document);
  diagnostics.buttons = notice ? ["확인했어요"] : [];
  const value: DialogSnapshot = {
    diagnostics,
    fingerprint: createFingerprint(diagnostics, notice ? [false] : []),
    hasNext: false,
    hasConfirm: false,
  };
  return notice
    ? { kind: "form_notice", ...meta(value, "exact", "form-notice-button-v1", ["reservation form URL", "dismiss button"]) }
    : { kind: "form", ...meta(value, "exact", "reservation-form-url-v1", ["reservation form URL"]) };
}

function promoInspection(document: Document): PostSlotInspection {
  const diagnostics = emptyDiagnostics(document);
  diagnostics.buttons = ["다음에 볼게요"];
  const value: DialogSnapshot = {
    diagnostics,
    fingerprint: createFingerprint(diagnostics, [false]),
    hasNext: false,
    hasConfirm: false,
  };
  return {
    kind: "promo_interstitial",
    ...meta(value, "supported", "promo-interstitial-v1", ["promo dismiss button"]),
  };
}

export function inspectPostSlot(document: Document, hasFormNotice: boolean): PostSlotInspection {
  if (document.location.pathname === "/ct/reservation/form") return formInspection(document, hasFormNotice);
  const dialog = findActiveDialog(document);
  if (!dialog) {
    const requestSheet = findRequestSheet(document);
    if (requestSheet) {
      const value = snapshot(document, requestSheet);
      return {
        kind: "request_notice",
        ...meta(value, "supported", "request-sheet-v1", ["presentation drawer", "request heading", "apply button"]),
      };
    }
    if (findPromoDismissButton(document)) return promoInspection(document);
    const diagnostics = emptyDiagnostics(document);
    const value: DialogSnapshot = {
      diagnostics,
      fingerprint: createFingerprint(diagnostics, []),
      hasNext: false,
      hasConfirm: false,
    };
    return { kind: "waiting", ...meta(value, "unknown", "no-active-dialog-v1", ["no active dialog"]) };
  }
  const value = snapshot(document, dialog);
  const known = exactInspection(dialog, value) ?? supportedInspection(dialog, value);
  if (known) return known;
  const label = value.diagnostics.label || value.diagnostics.title || "알 수 없는 단계";
  return {
    kind: "unknown",
    label,
    ...meta(value, "unknown", "unknown-dialog-v1", ["unsupported dialog structure"]),
  };
}
