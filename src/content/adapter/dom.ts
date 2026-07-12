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
