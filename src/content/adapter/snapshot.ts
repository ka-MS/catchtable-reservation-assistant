import {
  cleanText,
  fnvHash,
  isDisabled,
  isElementVisuallyHidden,
  maskPii,
  normalizedText,
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
const SUCCESS_PATH = "/ct/mydining/my/planned";

function urlKind(document: Document): StageSnapshot["urlKind"] {
  if (document.location.pathname === "/ct/reservation/form") return "reservation_form";
  if (document.location.pathname.startsWith("/ct/shop/")) return "shop";
  return "other";
}

/** 예약 폼 실패를 스냅샷만으로 읽기 위한 화이트리스트 텍스트(20-design.md §4.5).
 * 폼 본문 전체를 담지 않고 예약 요약 후보와 금액 라벨만 모은다. */
function reservationFormSnippet(document: Document): string {
  const summaries = visibleAll<HTMLElement>(document, "p, div, span")
    .filter((element) => {
      const text = normalizedText(element.textContent);
      return /\d{1,2}월\s*\d{1,2}일/.test(text) && /오전|오후/.test(text) && /\d+\s*명/.test(text);
    });
  const innermost = summaries.filter((element) =>
    !summaries.some((other) => other !== element && element.contains(other)));
  const amounts = visibleAll<HTMLElement>(document, "p, dt, span, div")
    .filter((element) => {
      const own = safeText(element.textContent);
      return own === "결제금액" || own === "총 결제 금액";
    })
    .map((element) => `${safeText(element.textContent)}=${safeText(element.nextElementSibling?.textContent)}`);
  return maskPii([...innermost.map((element) => safeText(element.textContent)), ...amounts].join(" | "));
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
  // 예약 폼과 성공 화면의 제목 h1·최종 CTA는 top-bar/fixed bar에 있어 main 밖이다. main으로
  // 범위를 좁히면 실패 스냅샷이 "제목 없음"으로 남는다(20-design.md §4.5).
  const wholeDocument = kind === "reservation_form" || document.location.pathname === SUCCESS_PATH;
  const container: ParentNode = dialogEl
    ?? (wholeDocument ? document : document.querySelector("main") ?? document.body);
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
  const textSnippet = kind === "reservation_form"
    ? reservationFormSnippet(document).slice(0, SNIPPET_LEN)
    : dialogEl
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
