import { captureStageSnapshot } from "./adapter/snapshot.js";

export interface PreparationPageContext {
  visibilityState: string;
  hasFocus: boolean;
  viewportWidth: number;
  viewportHeight: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  activeElementTag: string | null;
  activeElementRole: string | null;
  activeElementId: string | null;
  urlKind: "shop" | "reservation_form" | "other";
  fingerprint: string;
}

function cleanIdentifier(value: string | null): string | null {
  const clean = value?.trim().slice(0, 120) ?? "";
  return clean || null;
}

export function capturePreparationPageContext(document: Document): PreparationPageContext {
  const view = document.defaultView;
  const active = document.activeElement?.nodeType === 1 ? document.activeElement as Element : null;
  const snapshot = captureStageSnapshot(document);
  return {
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    viewportWidth: view?.innerWidth ?? 0,
    viewportHeight: view?.innerHeight ?? 0,
    visualViewportWidth: view?.visualViewport?.width ?? null,
    visualViewportHeight: view?.visualViewport?.height ?? null,
    activeElementTag: active?.tagName.toLocaleLowerCase("en-US") ?? null,
    activeElementRole: cleanIdentifier(active?.getAttribute("role") ?? null),
    activeElementId: cleanIdentifier(active?.id ?? null),
    urlKind: snapshot.urlKind,
    fingerprint: snapshot.fingerprint,
  };
}
