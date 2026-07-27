import type { RunEvent, RunState } from "../../shared/types.js";
import type {
  DiagnosticElement,
  DiagnosticEnvironment,
  DiagnosticQueryEvidence,
  DiagnosticSnapshot,
  DiagnosticSnapshotKind,
  DiagnosticSurface,
  DiagnosticTrigger,
} from "../../shared/diagnostics/types.js";
import type { TraceError } from "../../shared/telemetry/types.js";
import { readCalendarCells, readDisplayedCalendarMonth } from "../adapter/calendar-dom.js";
import {
  cleanText,
  fnvHash,
  isDisabled,
  isElementHidden,
  isElementVisuallyHidden,
  safeText,
} from "../adapter/dom.js";
import { findActiveDialog, findVisiblePresentationSheet } from "../adapter/dialog.js";

const MAX_ITEMS = 24;
const MAX_SURFACES = 6;
const MAX_FRAGMENT_BYTES = 64 * 1024;
const MAX_FRAGMENT_NODES = 1_200;

const QUERIES = [
  { name: "headings", selector: 'h1, h2, [role="heading"]' },
  { name: "buttons", selector: "button" },
  { name: "radios", selector: '[role="radio"], input[type="radio"]' },
  { name: "checkboxes", selector: '[role="checkbox"], input[type="checkbox"]' },
  { name: "dialogs", selector: '[role="dialog"]' },
  { name: "presentations", selector: 'div[role="presentation"]' },
  { name: "reservationDock", selector: "aside#dock button" },
  { name: "ariaDateCells", selector: '[role="button"][aria-label]' },
  { name: "mobiscrollDateCells", selector: ".mbsc-calendar-table-active .mbsc-calendar-day" },
  { name: "slotButtons", selector: "button[data-busy]" },
] as const;

const ALLOWED_TAGS = new Set([
  "article", "aside", "button", "div", "fieldset", "footer", "form", "h1", "h2", "h3", "header",
  "input", "label", "legend", "li", "main", "nav", "ol", "option", "p", "section", "select", "span",
  "strong", "time", "ul",
]);
const ALLOWED_ATTRIBUTES = new Set([
  "aria-label", "aria-modal", "aria-pressed", "aria-checked", "aria-selected", "aria-disabled", "role", "type",
  "name", "data-date", "data-busy", "disabled", "checked", "selected",
]);

export interface DiagnosticCaptureRequest {
  runId: string;
  kind: DiagnosticSnapshotKind;
  stage: RunState;
  trigger: DiagnosticTrigger;
  reason: string;
  data?: RunEvent["data"];
  error?: unknown;
  previousFingerprint?: string | null;
}

function maskSensitive(value: string): string {
  return value
    .replace(/\d{2,3}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "###")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "###@###")
    .replace(/(?:\d[ -]?){13,19}/g, "###");
}

function cleanDiagnosticText(value: string | null | undefined, max = 160): string {
  return maskSensitive(cleanText(value)).slice(0, max);
}

function rounded(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function elementSummary(element: Element): DiagnosticElement {
  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLocaleLowerCase("en-US");
  const role = safeText(element.getAttribute("role"));
  const ariaLabel = cleanDiagnosticText(element.getAttribute("aria-label"), 120);
  const checked = "checked" in element ? Boolean((element as HTMLInputElement).checked) : null;
  const selected = "selected" in element ? Boolean((element as HTMLOptionElement).selected) : null;
  const selectorHint = ariaLabel
    ? `${tag}${role ? `[role="${role}"]` : ""}[aria-label="${ariaLabel}"]`
    : `${tag}${role ? `[role="${role}"]` : ""}`;
  const attributes: Record<string, string> = {};
  for (const name of ["type", "name", "data-date", "data-busy"]) {
    const value = cleanDiagnosticText(element.getAttribute(name), 120);
    if (value) attributes[name] = value;
  }
  if (tag === "input") {
    const input = element as HTMLInputElement;
    if (input.name === "personCount" && /^\d{1,2}$/.test(input.value)) attributes.value = input.value;
  }
  return {
    tag,
    role,
    text: cleanDiagnosticText(element.textContent, 160),
    ariaLabel,
    ariaPressed: safeText(element.getAttribute("aria-pressed")),
    ariaChecked: safeText(element.getAttribute("aria-checked")),
    ariaSelected: safeText(element.getAttribute("aria-selected")),
    disabled: isDisabled(element),
    checked,
    selected,
    selectorHint,
    attributes,
    rect: {
      x: rounded(rect.x),
      y: rounded(rect.y),
      width: rounded(rect.width),
      height: rounded(rect.height),
    },
  };
}

function structuralOnly(element: DiagnosticElement): DiagnosticElement {
  return {
    ...element,
    text: "",
    ariaLabel: "",
    selectorHint: `${element.tag}${element.role ? `[role="${element.role}"]` : ""}`,
  };
}

function reservationFormPaymentControl(element: DiagnosticElement): DiagnosticElement {
  const structural = structuralOnly(element);
  return {
    ...structural,
    attributes: {
      ...(element.attributes.type === "radio" ? { type: "radio" } : {}),
      ...(element.attributes.name === "payment-type" ? { name: "payment-type" } : {}),
    },
  };
}

function redactReservationFormPaymentControls(surface: DiagnosticSurface): DiagnosticSurface {
  return {
    ...surface,
    controls: surface.controls.map((control) =>
      control.role === "radio" || control.attributes.type === "radio"
        ? reservationFormPaymentControl(control)
        : control),
  };
}

function visibleElements(document: Document, selector: string): Element[] {
  return Array.from(document.querySelectorAll(selector)).filter((element) => !isElementHidden(element));
}

function renderedElements(document: Document, selector: string): Element[] {
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => !isElementVisuallyHidden(element));
}

function summaries(document: Document, selector: string): DiagnosticElement[] {
  return visibleElements(document, selector).slice(0, MAX_ITEMS).map(elementSummary);
}

function queryEvidence(document: Document): DiagnosticQueryEvidence[] {
  return QUERIES.map(({ name, selector }) => {
    const elements = Array.from(document.querySelectorAll(selector));
    return {
      name,
      selector,
      matchCount: elements.length,
      visibleMatchCount: elements.filter((element) => !isElementHidden(element)).length,
    };
  });
}

function hasCatchPayPinSurface(document: Document): boolean {
  if (renderedElements(document, 'h1, h2, h3, [role="heading"]')
    .some((element) => safeText(element.textContent) === "캐치페이 비밀번호 입력")) {
    return true;
  }
  const labels = renderedElements(document, "button")
    .map((button) => safeText(button.textContent));
  const digits = new Set(labels.filter((label) => /^\d$/.test(label)));
  return digits.size >= 4 && labels.includes("전체삭제") && labels.includes("결제하기");
}

function surfaceKind(element: HTMLElement, document: Document): DiagnosticSurface["kind"] {
  if (element.getAttribute("role") === "dialog") return "dialog";
  if (element.getAttribute("role") === "presentation") return "presentation";
  if (element.matches("aside#dock")) return "dock";
  return document.defaultView?.getComputedStyle(element).position === "sticky" ? "sticky" : "fixed";
}

function surfaceCandidates(document: Document, rich: boolean): HTMLElement[] {
  const known = [
    findActiveDialog(document),
    findVisiblePresentationSheet(document),
    document.querySelector<HTMLElement>("aside#dock"),
  ].filter((element): element is HTMLElement => element !== null && !isElementHidden(element));
  if (rich) {
    const positioned = Array.from(document.body?.querySelectorAll<HTMLElement>("*") ?? []).slice(0, 1_000)
      .filter((element) => {
        if (isElementHidden(element)) return false;
        const position = document.defaultView?.getComputedStyle(element).position;
        if (position !== "fixed" && position !== "sticky") return false;
        return element.querySelector("button, input, [role=button], [role=radio], [role=checkbox]") !== null;
      });
    known.push(...positioned);
  }
  return [...new Set(known)].slice(0, MAX_SURFACES);
}

function surfaces(document: Document, rich: boolean): DiagnosticSurface[] {
  return surfaceCandidates(document, rich).map((surface) => ({
    kind: surfaceKind(surface, document),
    label: cleanDiagnosticText(surface.getAttribute("aria-label"), 120),
    title: cleanDiagnosticText(surface.querySelector('h1, h2, [role="heading"]')?.textContent, 120),
    elementCount: surface.querySelectorAll("*").length,
    controls: Array.from(surface.querySelectorAll("button, input, select, [role=button], [role=radio], [role=checkbox]"))
      .filter((element) => !isElementHidden(element)).slice(0, MAX_ITEMS).map(elementSummary),
  }));
}

function sanitizedUrl(document: Document): string {
  try {
    const url = new URL(document.location.href);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function urlKind(document: Document): DiagnosticEnvironment["urlKind"] {
  if (document.location.pathname === "/ct/reservation/form") return "reservation_form";
  if (document.location.pathname.startsWith("/ct/shop/")) return "shop";
  return "other";
}

function environment(document: Document): DiagnosticEnvironment {
  const view = document.defaultView;
  return {
    url: sanitizedUrl(document),
    urlKind: urlKind(document),
    title: cleanDiagnosticText(document.title, 160),
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    viewportWidth: view?.innerWidth ?? 0,
    viewportHeight: view?.innerHeight ?? 0,
    visualViewportWidth: view?.visualViewport?.width ?? null,
    visualViewportHeight: view?.visualViewport?.height ?? null,
    devicePixelRatio: view?.devicePixelRatio ?? 1,
    scrollX: view?.scrollX ?? 0,
    scrollY: view?.scrollY ?? 0,
    activeElement: document.activeElement?.nodeType === 1 ? elementSummary(document.activeElement as Element) : null,
  };
}

function strategyFor(stage: RunState, data?: RunEvent["data"]): { adapter: string; strategy: string | null; confidence: number | null; evidence: string[] } {
  if (stage === "ENTERING_RESERVATION") return { adapter: "EntryAdapter", strategy: "dock-reservation-cta-v1", confidence: null, evidence: [] };
  if (["SELECTING_DATE", "PREPARING_PAGE"].includes(stage)) {
    return { adapter: "CalendarAdapter", strategy: "calendar-dom-v2", confidence: null, evidence: [] };
  }
  if (stage === "WAITING_FOR_OPEN") return { adapter: "OpenRunOrchestrator", strategy: "server-clock-wait-v1", confidence: null, evidence: [] };
  if (stage === "REFRESHING_SLOTS") return { adapter: "CalendarAdapter+SlotAdapter", strategy: "date-toggle-dom-scan-v1", confidence: null, evidence: [] };
  if (stage === "SELECTING_PERSON") return { adapter: "PersonAdapter", strategy: "person-radio-v1", confidence: null, evidence: [] };
  if (["SLOT_DETECTED", "SLOT_CLICK_DISPATCHED"].includes(stage)) {
    return { adapter: "SlotAdapter", strategy: "data-busy-slot-v1", confidence: null, evidence: [] };
  }
  if (["SLOT_TRANSITION_CONFIRMED", "ADVANCING_RESERVATION"].includes(stage)) {
    const certainty = data?.postSlotCertainty;
    return {
      adapter: "PostSlotAdapter",
      strategy: typeof data?.postSlotStrategy === "string" ? data.postSlotStrategy : null,
      confidence: certainty === "exact" ? 1 : certainty === "supported" ? 0.75 : certainty === "unknown" ? 0 : null,
      evidence: typeof data?.postSlotEvidence === "string" ? data.postSlotEvidence.split(" | ").filter(Boolean).slice(0, 16) : [],
    };
  }
  if (stage === "COMPLETING_RESERVATION") {
    return { adapter: "ReservationFormAdapter", strategy: "catchpay-reservation-form-v1", confidence: null, evidence: [] };
  }
  return { adapter: "OpenRunOrchestrator", strategy: null, confidence: null, evidence: [] };
}

function cleanError(error: unknown): TraceError | undefined {
  if (!(error instanceof Error)) return undefined;
  return {
    name: error.name.slice(0, 100),
    message: maskSensitive(error.message).slice(0, 1_000),
    ...(error.stack ? { stack: maskSensitive(error.stack).slice(0, 8_192) } : {}),
  };
}

function appendSanitized(source: Node, target: HTMLElement, state: { count: number; truncated: boolean }): void {
  if (state.count >= MAX_FRAGMENT_NODES) {
    state.truncated = true;
    return;
  }
  const document = target.ownerDocument;
  if (source.nodeType === source.TEXT_NODE) {
    const text = cleanDiagnosticText(source.textContent, 1_000);
    if (text) target.append(document.createTextNode(text));
    return;
  }
  if (source.nodeType !== 1) return;
  const sourceElement = source as Element;
  const tag = sourceElement.tagName.toLocaleLowerCase("en-US");
  if (!ALLOWED_TAGS.has(tag)) return;
  state.count += 1;
  const clone = document.createElement(tag);
  for (const attribute of Array.from(sourceElement.attributes)) {
    if (!ALLOWED_ATTRIBUTES.has(attribute.name)) continue;
    clone.setAttribute(attribute.name, cleanDiagnosticText(attribute.value, 160));
  }
  target.append(clone);
  for (const child of Array.from(sourceElement.childNodes)) appendSanitized(child, clone, state);
}

function fragment(document: Document, stage: RunState): string | undefined {
  if (urlKind(document) === "reservation_form") return undefined;
  const roots = surfaceCandidates(document, true);
  if (roots.length === 0) {
    const stageRoot = stage === "ENTERING_RESERVATION"
      ? document.querySelector<HTMLElement>("aside#dock")
      : document.querySelector<HTMLElement>("main");
    if (stageRoot) roots.push(stageRoot);
  }
  if (roots.length === 0) return undefined;
  const output = document.implementation.createHTMLDocument("diagnostic");
  const wrapper = output.createElement("section");
  wrapper.setAttribute("data-diagnostic-fragment", stage);
  output.body.append(wrapper);
  const state = { count: 0, truncated: false };
  for (const root of roots) appendSanitized(root, wrapper, state);
  if (state.truncated) wrapper.setAttribute("data-truncated", "true");
  let html = `<!doctype html>\n${output.documentElement.outerHTML}`;
  while (new TextEncoder().encode(html).byteLength > MAX_FRAGMENT_BYTES) {
    let removable: Element | null = wrapper.lastElementChild;
    if (!removable) return undefined;
    while (removable.lastElementChild) removable = removable.lastElementChild;
    removable.remove();
    wrapper.setAttribute("data-truncated", "true");
    html = `<!doctype html>\n${output.documentElement.outerHTML}`;
  }
  return html;
}

export function captureDiagnosticSnapshot(
  document: Document,
  request: DiagnosticCaptureRequest,
  id: () => string = () => crypto.randomUUID(),
  now: () => number = () => Date.now(),
): DiagnosticSnapshot {
  const pinSurface = hasCatchPayPinSurface(document);
  const reservationForm = urlKind(document) === "reservation_form";
  const headings = pinSurface ? [] : summaries(document, 'h1, h2, [role="heading"]');
  const buttons = pinSurface ? [] : summaries(document, "button");
  const radios = pinSurface
    ? []
    : summaries(document, '[role="radio"], input[type="radio"]')
      .map((radio) => reservationForm ? reservationFormPaymentControl(radio) : radio);
  const checkboxes = pinSurface ? [] : summaries(document, '[role="checkbox"], input[type="checkbox"]');
  const calendarCells = readCalendarCells(document);
  const slotElements = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-busy]"));
  const availableSlots = slotElements.filter((element) => element.dataset.busy === "false" && !element.disabled && !isElementHidden(element));
  const rich = request.kind === "failure";
  const diagnosticSurfaces: DiagnosticSurface[] = pinSurface ? [{
    kind: "dialog",
    label: "credential_surface",
    title: "",
    elementCount: 0,
    controls: [],
  }] : surfaces(document, rich)
    .map((surface) => reservationForm ? redactReservationFormPaymentControls(surface) : surface);
  const queryData = pinSurface ? [] : queryEvidence(document);
  const decision = strategyFor(request.stage, request.data);
  const fingerprint = `ds-${fnvHash(JSON.stringify({
    stage: request.stage,
    headings: headings.map((item) => [item.tag, item.role, item.text.replace(/\d+/g, "#")]),
    buttons: buttons.map((item) => [item.role, item.text.replace(/\d+/g, "#"), item.disabled]),
    queries: queryData.map((item) => [item.name, item.visibleMatchCount]),
    surfaces: diagnosticSurfaces.map((item) => [item.kind, item.label, item.title]),
  }))}`;
  const traceError = cleanError(request.error);
  const html = rich && !pinSurface ? fragment(document, request.stage) : undefined;
  const diagnosticEnvironment = environment(document);
  if (pinSurface) diagnosticEnvironment.activeElement = null;
  else if (reservationForm && diagnosticEnvironment.activeElement) {
    diagnosticEnvironment.activeElement = structuralOnly(diagnosticEnvironment.activeElement);
  }
  return {
    schemaVersion: 1,
    snapshotId: id(),
    runId: request.runId,
    capturedAt: now(),
    kind: request.kind,
    stage: request.stage,
    adapter: decision.adapter,
    trigger: request.trigger,
    reason: cleanDiagnosticText(request.reason, 1_000),
    strategy: decision.strategy,
    confidence: decision.confidence,
    evidence: decision.evidence,
    queries: queryData,
    environment: diagnosticEnvironment,
    headings,
    buttons,
    radios,
    checkboxes,
    surfaces: diagnosticSurfaces,
    calendar: {
      displayedMonth: readDisplayedCalendarMonth(document),
      dateCellCount: pinSurface ? 0 : calendarCells.length,
      availableDates: pinSurface ? [] : calendarCells.filter((cell) => cell.available).map((cell) => cell.date).slice(0, 42),
      selectedDates: pinSurface ? [] : calendarCells.filter((cell) => cell.selected).map((cell) => cell.date).slice(0, 4),
    },
    slots: {
      candidateCount: pinSurface ? 0 : slotElements.length,
      availableCount: pinSurface ? 0 : availableSlots.length,
      labels: pinSurface ? [] : availableSlots.map((element) => cleanDiagnosticText(element.textContent, 80)).filter(Boolean).slice(0, MAX_ITEMS),
    },
    fingerprint,
    previousFingerprint: request.previousFingerprint ?? null,
    ...(html === undefined ? {} : { fragmentHtml: html }),
    ...(traceError === undefined ? {} : { error: traceError }),
  };
}
