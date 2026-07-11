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

export function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function normalized(value: string | null | undefined): string {
  return cleanText(value).toLocaleLowerCase("ko-KR");
}

export function isZeroDepositControl(element: Element): boolean {
  const label = normalized(element.getAttribute("aria-label"));
  return label.includes("예약금") && label.includes("0원") && label.includes("결제");
}

export function isElementHidden(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute("hidden")
      || current.hasAttribute("inert")
      || current.getAttribute("aria-hidden") === "true") return true;
    const style = view?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden") return true;
  }
  return false;
}

export function findActiveDialog(document: Document): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .filter((dialog) => !isElementHidden(dialog));
  const rendered = candidates.filter((dialog) => dialog.getClientRects().length > 0);
  return (rendered.length > 0 ? rendered : candidates).at(-1) ?? null;
}

function visibleElements<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((element) => !isElementHidden(element));
}

function urlKind(document: Document): PostSlotDiagnostics["urlKind"] {
  if (document.location.pathname === "/ct/reservation/form") return "reservation_form";
  if (document.location.pathname.startsWith("/ct/shop/")) return "shop";
  return "other";
}

function safeText(value: string | null | undefined): string {
  return cleanText(value).slice(0, 80);
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ps-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createFingerprint(diagnostics: PostSlotDiagnostics, disabledButtons: boolean[]): string {
  return fingerprint(JSON.stringify({
    ...diagnostics,
    disabledButtons,
  }));
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
  const heading = visibleElements<HTMLElement>(dialog, '[role="heading"], h1, h2').at(0);
  const buttons = visibleElements<HTMLButtonElement>(dialog, "button");
  const buttonTexts = buttons.map((button) => safeText(button.textContent)).filter(Boolean);
  const disabledButtons = buttons.map((button) => button.disabled || button.getAttribute("aria-disabled") === "true");
  const zeroDepositControls = visibleElements(
    dialog,
    '[role="radio"][aria-label], input[type="radio"][aria-label]',
  ).filter(isZeroDepositControl);
  const diagnostics: PostSlotDiagnostics = {
    urlKind: urlKind(document),
    label: safeText(dialog.getAttribute("aria-label")),
    title: safeText(heading?.textContent),
    buttons: buttonTexts,
    disabledButtonCount: disabledButtons.filter(Boolean).length,
    radioCount: visibleElements(dialog, '[role="radio"], input[type="radio"]').length,
    checkboxCount: visibleElements(dialog, '[role="checkbox"], input[type="checkbox"]').length,
    quantityControlCount: visibleElements(dialog, 'input[type="number"][aria-label$="수량"]').length,
    zeroDepositControlCount: zeroDepositControls.length,
  };
  const normalizedButtons = buttonTexts.map(normalized);
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
  return visibleElements(dialog, selector).map((element) => safeText(element.getAttribute("aria-label")))
    .filter(Boolean);
}

function exactInspection(dialog: HTMLElement, value: DialogSnapshot): PostSlotInspection | null {
  const label = normalized(value.diagnostics.label);
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
  const title = normalized(value.diagnostics.title);
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

export function inspectPostSlot(document: Document, hasFormNotice: boolean): PostSlotInspection {
  if (document.location.pathname === "/ct/reservation/form") return formInspection(document, hasFormNotice);
  const dialog = findActiveDialog(document);
  if (!dialog) {
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
