import { cleanText, isElementHidden } from "./dom.js";
import { findActiveDialog, findRequestSheet } from "./post-slot-inspection.js";

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

function safeText(value: string | null | undefined): string {
  return cleanText(value).slice(0, 80);
}

function maskPii(value: string): string {
  return value
    .replace(/\d{2,3}-\d{3,4}-\d{4}/g, "###-####-####")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "###@###");
}

function visible<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((el) => !isElementHidden(el));
}

function hash(value: string): string {
  // 동적 숫자를 지워 구조 동일 화면이 같은 fingerprint를 받게 한다.
  const normalized = value.replace(/\d+/g, "#");
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `ss-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function captureStageSnapshot(document: Document): StageSnapshot {
  const dialogEl = findActiveDialog(document) ?? findRequestSheet(document);
  const container: ParentNode = dialogEl ?? document.querySelector("main") ?? document.body;
  const headings = visible<HTMLElement>(container, 'h1, h2, [role="heading"]')
    .map((el) => safeText(el.textContent)).filter(Boolean).slice(0, MAX_ITEMS);
  const buttonEls = visible<HTMLButtonElement>(container, "button").slice(0, MAX_ITEMS);
  const buttons = buttonEls.map((b) => safeText(b.textContent)).filter(Boolean);
  const disabledButtons = buttonEls.map((b) => b.disabled || b.getAttribute("aria-disabled") === "true");
  const disabledButtonCount = disabledButtons.filter(Boolean).length;
  const kind = urlKind(document);
  const dialogLabel = dialogEl ? safeText(dialogEl.getAttribute("aria-label")) : "";
  const dialogTitle = dialogEl
    ? safeText(visible<HTMLElement>(dialogEl, 'h1, h2, [role="heading"]').at(0)?.textContent)
    : "";
  const textSnippet = (dialogEl && kind !== "reservation_form")
    ? maskPii(cleanText(dialogEl.textContent)).slice(0, SNIPPET_LEN)
    : "";
  const fingerprint = hash(JSON.stringify({
    kind, headings, buttons, disabledButtons, dialogLabel, dialogTitle,
  }));
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
