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
