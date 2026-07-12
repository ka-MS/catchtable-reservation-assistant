import { isDisabled, normalizedText, visibleAll } from "./dom.js";

export function findActiveDialog(document: Document): HTMLElement | null {
  const candidates = visibleAll<HTMLElement>(document, '[role="dialog"]');
  const rendered = candidates.filter((dialog) => dialog.getClientRects().length > 0);
  return (rendered.length > 0 ? rendered : candidates).at(-1) ?? null;
}

// 실측 2026-07-12 이시즈에 (site-behavior §7.2): 승인제 안내는 role="dialog" 없이
// role="presentation" 바텀시트로 뜬다. 제목 h2가 유일한 안정 앵커다.
export function findRequestSheet(document: Document): HTMLElement | null {
  return visibleAll<HTMLElement>(document, 'div[role="presentation"]')
    .find((sheet) => visibleAll<HTMLElement>(sheet, 'h1, h2, [role="heading"]')
      .some((heading) => normalizedText(heading.textContent).includes("레스토랑 확인이 필요한 예약"))) ?? null;
}

export function findVisiblePresentationSheet(document: Document): HTMLElement | null {
  return visibleAll<HTMLElement>(document, 'div[role="presentation"]')
    .filter((sheet) => visibleAll<HTMLElement>(sheet, 'h1, h2, [role="heading"]').length > 0
      || visibleAll<HTMLButtonElement>(sheet, "button").length > 0)
    .at(-1) ?? null;
}

// 실측 2026-07-12 이시즈에 (site-behavior §7.2): 홍보 인터스티셜은 role 계열 속성이 전혀 없어
// 닫기 버튼 텍스트만 안정 앵커다.
export function findPromoDismissButton(document: Document): HTMLButtonElement | null {
  return visibleAll<HTMLButtonElement>(document, "button")
    .find((button) => normalizedText(button.textContent) === "다음에 볼게요" && !isDisabled(button)) ?? null;
}
