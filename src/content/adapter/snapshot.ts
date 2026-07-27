import {
  cleanText,
  fnvHash,
  isDisabled,
  isElementVisuallyHidden,
  safeText,
  visibleAll,
} from "./dom.js";
import { findActiveDialog, findVisiblePresentationSheet } from "./dialog.js";

export interface StageSnapshot {
  urlKind: "shop" | "reservation_form" | "other";
  headings: string[];
  buttons: string[];
  disabledButtons: boolean[];
  disabledButtonCount: number;
  dialogLabel: string;
  dialogTitle: string;
  textSnippet: string;
  fingerprint: string;
}

const MAX_ITEMS = 8;
const SNIPPET_LEN = 160;
const CATCHPAY_PIN_HEADING = "캐치페이 비밀번호 입력";

function urlKind(document: Document): StageSnapshot["urlKind"] {
  if (document.location.pathname === "/ct/reservation/form") return "reservation_form";
  if (document.location.pathname.startsWith("/ct/shop/")) return "shop";
  return "other";
}

function maskPii(value: string): string {
  return value
    // 전화번호: 하이픈·점·공백·구분자 없음 모두 마스킹.
    .replace(/\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "###")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "###@###");
}

function hasCatchPayPinSurface(document: Document): boolean {
  const rendered = <T extends Element>(selector: string): T[] =>
    Array.from(document.querySelectorAll<T>(selector))
      .filter((element) => !isElementVisuallyHidden(element));
  if (rendered<HTMLElement>('h1, h2, h3, [role="heading"]')
    .some((heading) => safeText(heading.textContent) === CATCHPAY_PIN_HEADING)) {
    return true;
  }
  const labels = rendered<HTMLButtonElement>("button")
    .map((button) => safeText(button.textContent));
  const digits = new Set(labels.filter((label) => /^\d$/.test(label)));
  return digits.size >= 4 && labels.includes("전체삭제") && labels.includes("결제하기");
}

export function captureStageSnapshot(document: Document): StageSnapshot {
  const kind = urlKind(document);
  const pinSurface = hasCatchPayPinSurface(document);
  if (pinSurface) {
    return {
      urlKind: kind,
      headings: [],
      buttons: [],
      disabledButtons: [],
      disabledButtonCount: 0,
      dialogLabel: "credential_surface",
      dialogTitle: "",
      textSnippet: "",
      fingerprint: `ss-${fnvHash(JSON.stringify({ kind, credentialSurface: true }))}`,
    };
  }
  const dialogEl = findActiveDialog(document) ?? findVisiblePresentationSheet(document);
  const container: ParentNode = dialogEl ?? document.querySelector("main") ?? document.body;
  const headings = visibleAll<HTMLElement>(container, 'h1, h2, [role="heading"]')
    .map((el) => safeText(el.textContent)).filter(Boolean).slice(0, MAX_ITEMS);
  const buttonEls = visibleAll<HTMLButtonElement>(container, "button").slice(0, MAX_ITEMS);
  const buttons = buttonEls.map((b) => safeText(b.textContent)).filter(Boolean);
  const disabledButtons = buttonEls.map(isDisabled);
  const disabledButtonCount = disabledButtons.filter(Boolean).length;
  const dialogLabel = dialogEl ? safeText(dialogEl.getAttribute("aria-label")) : "";
  const dialogTitle = dialogEl
    ? safeText(visibleAll<HTMLElement>(dialogEl, 'h1, h2, [role="heading"]').at(0)?.textContent)
    : "";
  const textSnippet = (dialogEl && kind !== "reservation_form")
    ? maskPii(cleanText(dialogEl.textContent)).slice(0, SNIPPET_LEN)
    : "";
  const fingerprint = `ss-${fnvHash(JSON.stringify({
    kind, headings, buttons, disabledButtons, dialogLabel, dialogTitle,
  }).replace(/\d+/g, "#"))}`;
  return {
    urlKind: kind,
    headings,
    buttons,
    disabledButtons,
    disabledButtonCount,
    dialogLabel,
    dialogTitle,
    textSnippet,
    fingerprint,
  };
}
