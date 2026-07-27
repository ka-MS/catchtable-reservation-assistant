export function cleanText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function normalizedText(value: string | null | undefined): string {
  return cleanText(value).toLocaleLowerCase("ko-KR");
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

/** 접근성 격리(aria-hidden/inert)와 무관하게 픽셀에 렌더될 수 있는지 판정한다.
 * PIN credential surface처럼 시각 DOM과 접근성 tree가 어긋난 실측 경계에서만 사용한다. */
export function isElementVisuallyHidden(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (current.hasAttribute("hidden")) return true;
    const style = view?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden") return true;
  }
  return false;
}

export function visibleAll<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((element) => !isElementHidden(element));
}

export function isDisabled(element: Element): boolean {
  return element.getAttribute("aria-disabled") === "true"
    || ("disabled" in element && (element as HTMLButtonElement | HTMLInputElement).disabled);
}

export function safeText(value: string | null | undefined, max = 80): string {
  return cleanText(value).slice(0, max);
}

export function fnvHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
