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

function choiceCardHeading(choice: Element, sheet: Element): string {
  let container = choice.parentElement;
  while (container && container !== sheet) {
    const choices = visibleAll(container, '[role="checkbox"][aria-label]');
    const heading = visibleAll<HTMLElement>(container, 'h1, h2, h3, [role="heading"]').at(0);
    if (choices.length === 1 && heading) return normalizedText(heading.textContent);
    container = container.parentElement;
  }
  return "";
}

export function findSeatingMenuSheet(document: Document): HTMLElement | null {
  return visibleAll<HTMLElement>(document, 'div[role="presentation"]')
    .filter((sheet) => {
      const text = normalizedText(sheet.textContent);
      const choices = visibleAll(sheet, '[role="checkbox"][aria-label]');
      const headings = choices.map((choice) => choiceCardHeading(choice, sheet));
      const hasProgress = visibleAll<HTMLButtonElement>(sheet, "button")
        .some((button) => ["다음", "확인"].includes(normalizedText(button.textContent)));
      const hasSeatingHeading = headings.some((heading) => ["홀", "테이블", "바", "카운터", "룸"]
        .some((label) => heading.includes(label)));
      const hasRequiredMenuNotice = text.includes("필수") && text.includes("메인 메뉴");
      const hasSelectedSummary = choices.some((choice) => choice.getAttribute("aria-checked") === "true")
        && text.includes("총 결제 금액");
      return choices.length > 0 && headings.every(Boolean) && hasSeatingHeading
        && hasProgress && (hasRequiredMenuNotice || hasSelectedSummary);
    })
    .at(-1) ?? null;
}

// 실측 2026-07-12 이시즈에 (site-behavior §7.2): 홍보 인터스티셜은 role 계열 속성이 전혀 없어
// 닫기 버튼 텍스트만 안정 앵커다.
export function findPromoDismissButton(document: Document): HTMLButtonElement | null {
  return visibleAll<HTMLButtonElement>(document, "button")
    .find((button) => normalizedText(button.textContent) === "다음에 볼게요" && !isDisabled(button)) ?? null;
}

export function findPaymentMethodNoticeButton(document: Document): HTMLButtonElement | null {
  return visibleAll<HTMLButtonElement>(document, "button")
    .find((button) => normalizedText(button.textContent).endsWith("이 방식으로 예약") && !isDisabled(button)) ?? null;
}

export function findPaymentMethodNotice(document: Document): HTMLElement | null {
  const reserveButton = findPaymentMethodNoticeButton(document);
  if (!reserveButton) return null;

  let container = reserveButton.parentElement;
  while (container && container !== document.body) {
    const text = normalizedText(container.textContent);
    if (text.includes("예약금 0원") && text.includes("자동결제")) return container;
    container = container.parentElement;
  }
  return null;
}
