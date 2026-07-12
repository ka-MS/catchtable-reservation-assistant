import { cleanText, fnvHash, isDisabled, safeText, visibleAll } from "./dom.js";
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

export function captureStageSnapshot(document: Document): StageSnapshot {
  const dialogEl = findActiveDialog(document) ?? findVisiblePresentationSheet(document);
  const container: ParentNode = dialogEl ?? document.querySelector("main") ?? document.body;
  const headings = visibleAll<HTMLElement>(container, 'h1, h2, [role="heading"]')
    .map((el) => safeText(el.textContent)).filter(Boolean).slice(0, MAX_ITEMS);
  const buttonEls = visibleAll<HTMLButtonElement>(container, "button").slice(0, MAX_ITEMS);
  const buttons = buttonEls.map((b) => safeText(b.textContent)).filter(Boolean);
  const disabledButtons = buttonEls.map(isDisabled);
  const disabledButtonCount = disabledButtons.filter(Boolean).length;
  const kind = urlKind(document);
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
