import type { TraceEvent, TraceLiveBatch, TraceRunRecord } from "../../shared/telemetry/types.js";

interface TraceViewActions {
  select(runId: string): void;
  remove(runId: string): void;
}

function byId<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`필수 trace UI 요소가 없습니다: ${id}`);
  return element as T;
}

function runLabel(run: TraceRunRecord): string {
  let shop = "식당";
  try {
    shop = new URL(run.config.targetUrl).pathname.split("/").filter(Boolean).at(-1) ?? shop;
  } catch {
    // Invalid URLs are rejected before execution.
  }
  const time = new Date(run.startedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${shop} · ${run.config.reservationDate} · ${run.finalState ?? "실행 중"} · ${time}`;
}

function eventDetail(event: TraceEvent): string {
  if (event.code === "DATE_TOGGLE_CYCLE") {
    const cycle = event.attributes.cycle;
    const result = event.attributes.result;
    const adjacent = event.attributes.adjacentClickedAt;
    const target = event.attributes.targetClickedAt;
    const scans = event.attributes.slotScanCount;
    return `#${cycle} · ${result} · 인접 ${adjacent ?? "-"} · 목표 ${target ?? "-"} · 탐색 ${scans ?? 0}회`;
  }
  if (event.code === "CLOCK_SYNCED") {
    const phase = event.attributes.clockPhase ?? "-";
    const offset = event.attributes.clockOffsetMs;
    const precision = event.attributes.clockPrecisionMs;
    const offsetText = typeof offset === "number" ? `${Math.round(offset)}ms` : "-";
    const precisionText = typeof precision === "number" ? `±${Math.round(precision)}ms` : "±-";
    const base = `${phase} · 오프셋 ${offsetText} · ${event.attributes.clockMethod ?? "-"} ${precisionText}`;
    const sampleDetail = event.attributes.clockSampleDetail;
    return typeof sampleDetail === "string" && sampleDetail !== "" ? `${base} · 샘플 ${sampleDetail}` : base;
  }
  if (typeof event.attributes.snapshotFingerprint === "string") {
    const stage = event.attributes.snapshotRunState ?? "-";
    const title = event.attributes.snapshotDialogTitle || event.attributes.snapshotDialogLabel || "제목 없음";
    const buttons = event.attributes.snapshotButtons || "없음";
    const snippet = typeof event.attributes.snapshotTextSnippet === "string" && event.attributes.snapshotTextSnippet
      ? ` · "${String(event.attributes.snapshotTextSnippet).slice(0, 60)}"`
      : "";
    return `${stage} · 스냅샷 ${title} · 버튼 ${buttons}${snippet} · ${event.attributes.snapshotFingerprint}`;
  }
  return Object.entries(event.attributes)
    .filter(([key]) => !["eventKind", "state"].includes(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");
}

function eventItem(document: Document, event: TraceEvent): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "event-item trace-event-item";
  item.dataset.tone = event.severity === "error" ? "error" : event.severity === "warn" ? "action" : "neutral";
  const dot = document.createElement("span");
  dot.className = "event-dot";
  dot.setAttribute("aria-hidden", "true");
  const content = document.createElement("div");
  content.className = "event-content";
  const header = document.createElement("div");
  header.className = "event-header";
  const time = document.createElement("span");
  time.className = "event-time";
  const date = new Date(event.localAt);
  time.textContent = `${date.toLocaleTimeString("ko-KR", { hour12: false })}.${String(date.getMilliseconds()).padStart(3, "0")}`;
  const code = document.createElement("span");
  code.className = "trace-code";
  code.textContent = event.code;
  header.append(time, code);
  const message = document.createElement("span");
  message.className = "event-message";
  message.textContent = event.message;
  content.append(header, message);
  const detailValue = eventDetail(event);
  if (detailValue) {
    const detail = document.createElement("span");
    detail.className = "event-detail";
    detail.textContent = detailValue;
    content.append(detail);
  }
  item.append(dot, content);
  return item;
}

export class TraceHistoryView {
  private readonly select: HTMLSelectElement;
  private readonly remove: HTMLButtonElement;
  private readonly list: HTMLOListElement;
  private readonly count: HTMLElement;
  private runs: TraceRunRecord[] = [];

  constructor(private readonly document: Document, actions: TraceViewActions) {
    this.select = byId(document, "trace-run-select");
    this.remove = byId(document, "trace-run-delete");
    this.list = byId(document, "trace-event-list");
    this.count = byId(document, "trace-event-count");
    this.select.addEventListener("change", () => {
      this.syncDeleteState();
      if (this.select.value) actions.select(this.select.value);
    });
    this.remove.addEventListener("click", () => {
      if (this.select.value) actions.remove(this.select.value);
    });
  }

  selectedRunId(): string | null {
    return this.select.value || null;
  }

  renderRuns(runs: TraceRunRecord[], preferredRunId?: string): void {
    const selected = preferredRunId ?? this.selectedRunId() ?? runs[0]?.runId ?? "";
    this.runs = runs;
    const fragment = this.document.createDocumentFragment();
    runs.forEach((run) => {
      const option = this.document.createElement("option");
      option.value = run.runId;
      option.textContent = runLabel(run);
      fragment.append(option);
    });
    this.select.replaceChildren(fragment);
    this.select.value = runs.some((run) => run.runId === selected) ? selected : runs[0]?.runId ?? "";
    this.select.disabled = runs.length === 0;
    this.syncDeleteState();
  }

  upsertRun(run: TraceRunRecord): void {
    this.renderRuns([run, ...this.runs.filter((item) => item.runId !== run.runId)].slice(0, 20));
  }

  renderEvents(events: TraceEvent[]): void {
    const visible = events.slice(-100).reverse();
    const fragment = this.document.createDocumentFragment();
    visible.forEach((event) => fragment.append(eventItem(this.document, event)));
    this.list.replaceChildren(fragment);
    this.count.textContent = `${visible.length}개`;
    if (visible.length === 0) {
      const empty = this.document.createElement("li");
      empty.className = "event-empty";
      empty.textContent = "저장된 상세 로그가 없습니다.";
      this.list.append(empty);
    }
  }

  appendLive(batch: TraceLiveBatch): void {
    const previousSelection = this.selectedRunId();
    this.upsertRun(batch.run);
    const followLiveRun = batch.run.finishedAt === null;
    if (!followLiveRun && previousSelection !== null && previousSelection !== batch.run.runId) return;
    if (previousSelection !== null && previousSelection !== batch.run.runId) this.list.replaceChildren();
    this.select.value = batch.run.runId;
    this.syncDeleteState();
    if (this.list.querySelector(".event-empty")) this.list.replaceChildren();
    const fragment = this.document.createDocumentFragment();
    [...batch.events].reverse().forEach((event) => fragment.append(eventItem(this.document, event)));
    this.list.prepend(fragment);
    while (this.list.children.length > 100) this.list.lastElementChild?.remove();
    this.count.textContent = `${this.list.children.length}개`;
  }

  private syncDeleteState(): void {
    const selected = this.runs.find((run) => run.runId === this.select.value);
    this.remove.disabled = !selected || selected.finishedAt === null;
  }
}
