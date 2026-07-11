import { defaultStopAt } from "../shared/config.js";
import { sanitizeSavedConfigs } from "../shared/saved-configs.js";
import { epochToLocalInput, localInputToEpoch } from "../shared/time.js";
import type { ActiveRun, CommandResponse, EntryMode, PanelCommand, ReservationConfig, RunEvent, RunState, TablePreference } from "../shared/types.js";
import { countdownModel } from "./countdown.js";
import { formatEventTime } from "./event-format.js";
import { configFromFormValues, configSnapshotFromFormValues, stopAtIsCustom, type FormValues } from "./form-model.js";
import { SavedConfigsView } from "./saved-configs-view.js";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`필수 UI 요소가 없습니다: ${id}`);
  return element as T;
}

const form = byId<HTMLFormElement>("reservation-form");
const fieldset = byId<HTMLFieldSetElement>("config-fields");
const stateBadge = byId<HTMLElement>("state");
const statusDetail = byId<HTMLElement>("status-detail");
const formError = byId<HTMLElement>("form-error");
const eventList = byId<HTMLOListElement>("event-list");
const eventCount = byId<HTMLElement>("event-count");
const eventFilter = byId<HTMLButtonElement>("event-filter");
const clockOffset = byId<HTMLElement>("clock-offset");
const startButton = byId<HTMLButtonElement>("start");
const stopButton = byId<HTMLButtonElement>("stop");
const priorityInput = byId<HTMLInputElement>("priority-time");
const priorityList = byId<HTMLOListElement>("priority-list");
const postSlotOptions = byId<HTMLElement>("post-slot-options");
const summaryMain = byId<HTMLElement>("summary-main");
const summarySub = byId<HTMLElement>("summary-sub");
const countdownBanner = byId<HTMLElement>("countdown");
const countdownText = byId<HTMLElement>("countdown-text");
const countdownDetail = byId<HTMLElement>("countdown-detail");

const fields = {
  targetUrl: byId<HTMLInputElement>("target-url"),
  openAt: byId<HTMLInputElement>("open-at"),
  reservationDate: byId<HTMLInputElement>("reservation-date"),
  personCount: byId<HTMLInputElement>("person-count"),
  startTime: byId<HTMLInputElement>("start-time"),
  endTime: byId<HTMLInputElement>("end-time"),
  postSlotEnabled: byId<HTMLInputElement>("post-slot-enabled"),
  tablePreference: byId<HTMLSelectElement>("table-preference"),
  menuKeyword: byId<HTMLInputElement>("menu-keyword"),
  stopAt: byId<HTMLInputElement>("stop-at"),
  entryMode: byId<HTMLSelectElement>("entry-mode"),
  dryRun: byId<HTMLInputElement>("dry-run"),
  preOpenLeadMs: byId<HTMLInputElement>("pre-open-lead"),
  toggleIntervalMs: byId<HTMLInputElement>("toggle-interval"),
  clockSampleCount: byId<HTMLInputElement>("clock-samples"),
};

const TERMINAL = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
]);

const STATE_LABEL: Record<RunState, string> = {
  IDLE: "설정 대기 중",
  CONFIGURED: "설정을 저장했습니다.",
  NAVIGATING: "설정한 식당으로 이동 중입니다.",
  VALIDATING: "설정과 페이지를 검증 중입니다.",
  SYNCING_CLOCK: "서버 시계를 측정 중입니다.",
  ENTERING_RESERVATION: "예약창을 여는 중입니다.",
  SELECTING_DATE: "예약 날짜를 준비 중입니다.",
  SELECTING_PERSON: "예약 인원을 준비 중입니다.",
  PREPARING_PAGE: "예약 페이지를 확인 중입니다.",
  WAITING_FOR_OPEN: "예약 오픈 시각을 기다리는 중입니다.",
  REFRESHING_SLOTS: "예약 슬롯을 갱신 중입니다.",
  SLOT_DETECTED: "조건에 맞는 슬롯을 감지했습니다.",
  SLOT_SELECTED: "슬롯을 선택했습니다.",
  ADVANCING_RESERVATION: "예약 폼으로 이동 중입니다.",
  DRY_RUN_COMPLETED: "Dry-run 감지를 완료했습니다.",
  HANDED_OFF: "사용자 조작으로 인계했습니다.",
  COMPLETED: "완료했습니다.",
  STOPPED: "사용자가 중지했습니다.",
  TIMED_OUT: "감시 종료 시각에 도달했습니다.",
  FAILED: "실행에 실패했습니다.",
};

const STATE_BADGE: Record<RunState, string> = {
  IDLE: "준비 필요",
  CONFIGURED: "시작 중",
  NAVIGATING: "식당 이동",
  VALIDATING: "검증 중",
  SYNCING_CLOCK: "시계 동기화",
  ENTERING_RESERVATION: "예약창 진입",
  SELECTING_DATE: "날짜 준비",
  SELECTING_PERSON: "인원 준비",
  PREPARING_PAGE: "페이지 준비",
  WAITING_FOR_OPEN: "오픈 대기",
  REFRESHING_SLOTS: "슬롯 탐색",
  SLOT_DETECTED: "슬롯 감지",
  SLOT_SELECTED: "슬롯 선택",
  ADVANCING_RESERVATION: "예약 진행",
  DRY_RUN_COMPLETED: "점검 완료",
  HANDED_OFF: "사용자 인계",
  COMPLETED: "완료",
  STOPPED: "중지됨",
  TIMED_OUT: "시간 초과",
  FAILED: "실패",
};

const POST_OPEN_STAGES = new Set<RunState>([
  "REFRESHING_SLOTS",
  "SLOT_DETECTED",
  "SLOT_SELECTED",
  "ADVANCING_RESERVATION",
]);

let priorityTimes: string[] = [];
let stopAtDirty = false;
let importantEventsOnly = false;
let latestActiveRun: ActiveRun | null | undefined;
let latestEvents: RunEvent[] = [];

function formatDate(value: string): string {
  if (!value) return "";
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function renderSummary(): void {
  const date = formatDate(fields.reservationDate.value);
  const people = fields.personCount.value ? `${fields.personCount.value}명` : "";
  const range = fields.startTime.value && fields.endTime.value ? `${fields.startTime.value}–${fields.endTime.value}` : "";
  const parts = [date, people, range].filter(Boolean);
  summaryMain.textContent = parts.length > 0 ? parts.join(" · ") : "예약 정보를 입력해 주세요.";
  const mode = fields.dryRun.checked ? "안전 점검" : "실제 실행";
  const postSlot = fields.postSlotEnabled.checked ? "후속 선택 진행" : "후속 선택 안 함";
  const entry = fields.entryMode.value === "auto" ? "자동 페이지 준비" : "현재 페이지 사용";
  summarySub.textContent = `${mode} · ${entry} · ${postSlot}`;
}

function readValues(): FormValues {
  return {
    targetUrl: fields.targetUrl.value,
    openAt: fields.openAt.value,
    reservationDate: fields.reservationDate.value,
    personCount: fields.personCount.value,
    startTime: fields.startTime.value,
    endTime: fields.endTime.value,
    priorityTimes: [...priorityTimes],
    postSlotEnabled: fields.postSlotEnabled.checked,
    tablePreference: fields.tablePreference.value as TablePreference,
    menuKeyword: fields.menuKeyword.value,
    stopAt: fields.stopAt.value,
    entryMode: fields.entryMode.value as EntryMode,
    dryRun: fields.dryRun.checked,
    preOpenLeadMs: fields.preOpenLeadMs.value,
    toggleIntervalMs: fields.toggleIntervalMs.value,
    clockSampleCount: fields.clockSampleCount.value,
  };
}

function applyValues(values: FormValues): void {
  fields.targetUrl.value = values.targetUrl;
  fields.openAt.value = values.openAt;
  fields.reservationDate.value = values.reservationDate;
  fields.personCount.value = values.personCount;
  fields.startTime.value = values.startTime;
  fields.endTime.value = values.endTime;
  fields.postSlotEnabled.checked = values.postSlotEnabled ?? false;
  fields.tablePreference.value = values.tablePreference ?? "any";
  fields.menuKeyword.value = values.menuKeyword ?? "";
  fields.stopAt.value = values.stopAt;
  fields.entryMode.value = values.entryMode ?? (values.pagePrepared === false ? "auto" : "prepared");
  fields.dryRun.checked = values.dryRun;
  fields.preOpenLeadMs.value = values.preOpenLeadMs;
  fields.toggleIntervalMs.value = values.toggleIntervalMs;
  fields.clockSampleCount.value = values.clockSampleCount;
  priorityTimes = [...values.priorityTimes];
  syncPostSlotFields();
  renderPriorities();
  renderSummary();
}

function minutesToInput(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function valuesFromConfig(config: ReservationConfig): FormValues {
  return {
    targetUrl: config.targetUrl,
    openAt: epochToLocalInput(config.openAtMs),
    reservationDate: config.reservationDate,
    personCount: String(config.personCount),
    startTime: minutesToInput(config.timeRange.startMinutes),
    endTime: minutesToInput(config.timeRange.endMinutes),
    priorityTimes: config.priorityTimes.map(minutesToInput),
    postSlotEnabled: config.postSlotEnabled ?? false,
    tablePreference: config.tablePreference ?? "any",
    menuKeyword: config.menuKeyword ?? "",
    stopAt: epochToLocalInput(config.stopAtMs),
    entryMode: config.entryMode ?? ((config as ReservationConfig & { pagePrepared?: boolean }).pagePrepared === false ? "auto" : "prepared"),
    dryRun: config.dryRun,
    preOpenLeadMs: String(config.preOpenLeadMs),
    toggleIntervalMs: String(config.toggleIntervalMs),
    clockSampleCount: String(config.clockSampleCount),
  };
}

function saveDraft(): void {
  void chrome.storage.local.set({ draftForm: readValues() });
}

function syncPostSlotFields(): void {
  const enabled = fields.postSlotEnabled.checked;
  fields.tablePreference.disabled = !enabled;
  fields.menuKeyword.disabled = !enabled;
  postSlotOptions.dataset.enabled = String(enabled);
}

function renderPriorities(): void {
  priorityList.replaceChildren();
  priorityTimes.forEach((time, index) => {
    const item = document.createElement("li");
    item.className = "priority-item";
    const rank = document.createElement("span");
    rank.className = "priority-rank";
    rank.textContent = `${index + 1}`;
    const value = document.createElement("strong");
    value.textContent = time;
    item.append(rank, value);

    const actions = [
      { label: "위로 이동", symbol: "↑", move: -1 },
      { label: "아래로 이동", symbol: "↓", move: 1 },
      { label: "삭제", symbol: "×", move: 0 },
    ];
    actions.forEach(({ label, symbol, move }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", `${time} ${label}`);
      button.textContent = symbol;
      button.addEventListener("click", () => {
        if (move === 0) {
          priorityTimes.splice(index, 1);
        } else {
          const target = index + move;
          if (target < 0 || target >= priorityTimes.length) return;
          [priorityTimes[index], priorityTimes[target]] = [priorityTimes[target], priorityTimes[index]];
        }
        renderPriorities();
        saveDraft();
      });
      item.append(button);
    });
    priorityList.append(item);
  });
}

function eventTone(event: RunEvent): "neutral" | "info" | "action" | "success" | "error" {
  const state = typeof event.data?.state === "string" ? event.data.state : "";
  if (event.kind === "error" || state === "FAILED" || state === "TIMED_OUT") return "error";
  if (["HANDED_OFF", "COMPLETED", "DRY_RUN_COMPLETED"].includes(state)) return "success";
  if (event.kind === "detect" || state === "SLOT_DETECTED") return "info";
  if (event.kind === "action" || state === "SLOT_SELECTED" || state === "ADVANCING_RESERVATION") return "action";
  return "neutral";
}

function isImportantEvent(event: RunEvent): boolean {
  return eventTone(event) !== "neutral";
}

function eventDetail(event: RunEvent): string {
  const details: string[] = [];
  const timingServerAt = typeof event.data?.timingServerAtMs === "number" ? event.data.timingServerAtMs : event.serverAt;
  const delta = event.data?.openDeltaMs;
  if (timingServerAt !== null && typeof delta === "number") {
    const rounded = Math.round(delta);
    details.push(`서버 ${formatEventTime(timingServerAt)} · 오픈 ${rounded >= 0 ? "+" : ""}${rounded}ms`);
  }
  if (typeof event.data?.clockOffsetMs === "number") {
    details.push(`오프셋 ${Number(event.data.clockOffsetMs).toFixed(0)}ms`);
  }
  return details.join(" · ");
}

function groupEvents(events: RunEvent[]): Array<{ event: RunEvent; count: number }> {
  const groups: Array<{ event: RunEvent; count: number }> = [];
  events.forEach((event) => {
    const previous = groups.at(-1);
    if (previous && previous.event.kind === event.kind && previous.event.message === event.message) {
      previous.count += 1;
      return;
    }
    groups.push({ event, count: 1 });
  });
  return groups;
}

function renderCountdown(): void {
  const openAt = fields.openAt.value ? localInputToEpoch(fields.openAt.value) : null;
  const offsetEvent = [...latestEvents].reverse().find((event) => typeof event.data?.clockOffsetMs === "number");
  const state = latestActiveRun?.state;
  const model = countdownModel({
    nowMs: Date.now(),
    openAtMs: openAt !== null && Number.isFinite(openAt) ? openAt : null,
    offsetMs: offsetEvent ? Number(offsetEvent.data?.clockOffsetMs) : null,
    activeStage: state && POST_OPEN_STAGES.has(state) ? STATE_BADGE[state] : null,
  });
  countdownBanner.hidden = !model.visible;
  countdownBanner.dataset.mode = model.mode;
  countdownBanner.dataset.urgent = String(model.urgent);
  countdownText.textContent = model.text;
  countdownDetail.textContent = model.detail;
}

function renderRuntime(activeRun: ActiveRun | null | undefined, events: RunEvent[]): void {
  latestActiveRun = activeRun;
  latestEvents = events;
  renderCountdown();
  const state = activeRun?.state ?? "IDLE";
  stateBadge.textContent = STATE_BADGE[state];
  stateBadge.dataset.state = state;
  statusDetail.textContent = STATE_LABEL[state];
  const running = activeRun !== null && activeRun !== undefined && !TERMINAL.has(state);
  fieldset.disabled = running;
  startButton.hidden = running;
  stopButton.disabled = !running;

  const metric = [...events].reverse().find((event) => typeof event.data?.clockOffsetMs === "number");
  clockOffset.textContent = metric ? `시계 ${Number(metric.data?.clockOffsetMs).toFixed(0)}ms` : "시계 -";
  eventList.replaceChildren();
  const recent = events.slice(-50).reverse();
  const visible = importantEventsOnly ? recent.filter(isImportantEvent) : recent;
  const grouped = groupEvents(visible);
  eventCount.textContent = importantEventsOnly ? `중요 ${visible.length}개 · 전체 ${recent.length}개` : `${recent.length}개`;
  eventFilter.setAttribute("aria-pressed", String(importantEventsOnly));
  if (grouped.length === 0) {
    const empty = document.createElement("li");
    empty.className = "event-empty";
    empty.textContent = recent.length === 0 ? "아직 실행 기록이 없습니다." : "표시할 중요 이벤트가 없습니다.";
    eventList.append(empty);
    return;
  }
  grouped.forEach(({ event, count }) => {
    const item = document.createElement("li");
    item.className = "event-item";
    item.dataset.tone = eventTone(event);
    const dot = document.createElement("span");
    dot.className = "event-dot";
    dot.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.className = "event-content";
    const header = document.createElement("div");
    header.className = "event-header";
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatEventTime(event.at);
    const repeat = document.createElement("span");
    repeat.className = "event-repeat";
    repeat.textContent = count > 1 ? `${count}회` : "";
    const message = document.createElement("span");
    message.className = "event-message";
    message.textContent = event.message;
    header.append(time, repeat);
    content.append(header, message);
    const detailText = eventDetail(event);
    if (detailText) {
      const detail = document.createElement("span");
      detail.className = "event-detail";
      detail.textContent = detailText;
      content.append(detail);
    }
    item.append(dot, content);
    eventList.append(item);
  });
}

eventFilter.addEventListener("click", () => {
  importantEventsOnly = !importantEventsOnly;
  renderRuntime(latestActiveRun, latestEvents);
});

async function send(command: PanelCommand): Promise<CommandResponse> {
  return chrome.runtime.sendMessage(command) as Promise<CommandResponse>;
}

async function sendSavedCommand(command: PanelCommand): Promise<void> {
  formError.textContent = "";
  try {
    const response = await send(command);
    if (!response.ok) throw new Error(response.error ?? "저장 설정을 변경할 수 없습니다.");
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : "저장 설정을 변경할 수 없습니다.";
  }
}

const savedConfigsView = new SavedConfigsView(document, {
  load: (config) => {
    const values = valuesFromConfig(config);
    applyValues(values);
    stopAtDirty = stopAtIsCustom(values);
    formError.textContent = "";
    saveDraft();
  },
  saveFavorite: () => {
    try {
      const config = configSnapshotFromFormValues(readValues());
      void sendSavedCommand({ type: "SAVE_FAVORITE", config });
    } catch (error) {
      formError.textContent = error instanceof Error ? error.message : "즐겨찾기에 저장할 설정을 확인하세요.";
    }
  },
  remove: (list, id) => {
    void sendSavedCommand({ type: "DELETE_SAVED", list, id });
  },
  clear: (list) => {
    if (!window.confirm(list === "history" ? "히스토리를 모두 삭제할까요?" : "즐겨찾기를 모두 삭제할까요?")) return;
    void sendSavedCommand({ type: "CLEAR_SAVED", list });
  },
});

byId<HTMLButtonElement>("add-priority").addEventListener("click", () => {
  const value = priorityInput.value;
  if (!value || priorityTimes.includes(value)) return;
  priorityTimes.push(value);
  priorityInput.value = "";
  renderPriorities();
  saveDraft();
});

fields.openAt.addEventListener("change", () => {
  if (!stopAtDirty && fields.openAt.value) {
    fields.stopAt.value = epochToLocalInput(defaultStopAt(localInputToEpoch(fields.openAt.value)));
  }
  saveDraft();
  renderCountdown();
});
setInterval(renderCountdown, 500);
fields.stopAt.addEventListener("input", () => {
  stopAtDirty = true;
  saveDraft();
});
fields.postSlotEnabled.addEventListener("change", () => {
  syncPostSlotFields();
  saveDraft();
});
form.addEventListener("input", (event) => {
  renderSummary();
  if (event.target !== fields.stopAt && event.target !== fields.openAt) saveDraft();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";
  startButton.disabled = true;
  try {
    const config = configFromFormValues(readValues(), Date.now());
    const response = await send({ type: "PANEL_START", config });
    if (!response.ok) throw new Error(response.error ?? "실행을 시작할 수 없습니다.");
    stateBadge.textContent = STATE_BADGE.CONFIGURED;
    stateBadge.dataset.state = "CONFIGURED";
    statusDetail.textContent = "현재 탭에 실행을 요청했습니다.";
    fieldset.disabled = true;
    startButton.hidden = true;
    stopButton.disabled = false;
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : "입력값을 확인하세요.";
  } finally {
    startButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  const response = await send({ type: "PANEL_STOP" });
  if (!response.ok) formError.textContent = response.error ?? "실행을 중지할 수 없습니다.";
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.activeRun || changes.runEvents) {
    void chrome.storage.local.get(["activeRun", "runEvents"]).then((stored) => {
      renderRuntime(stored.activeRun as ActiveRun | null | undefined, (stored.runEvents as RunEvent[] | undefined) ?? []);
    });
  }
  if (changes.configHistory || changes.configFavorites) {
    void chrome.storage.local.get(["configHistory", "configFavorites"]).then((stored) => {
      savedConfigsView.render(
        sanitizeSavedConfigs(stored.configHistory),
        sanitizeSavedConfigs(stored.configFavorites),
      );
    });
  }
});

void chrome.storage.local.get([
  "reservationConfig",
  "activeRun",
  "runEvents",
  "draftForm",
  "configHistory",
  "configFavorites",
]).then((stored) => {
  const draft = stored.draftForm as FormValues | undefined;
  const config = stored.reservationConfig as ReservationConfig | undefined;
  if (draft) {
    applyValues(draft);
    stopAtDirty = stopAtIsCustom(draft);
  } else if (config) {
    const values = valuesFromConfig(config);
    applyValues(values);
    stopAtDirty = stopAtIsCustom(values);
  }
  syncPostSlotFields();
  renderRuntime(stored.activeRun as ActiveRun | null | undefined, (stored.runEvents as RunEvent[] | undefined) ?? []);
  savedConfigsView.render(
    sanitizeSavedConfigs(stored.configHistory),
    sanitizeSavedConfigs(stored.configFavorites),
  );
});
