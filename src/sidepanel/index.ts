import { defaultStopAt } from "../shared/config.js";
import { epochToLocalInput, localInputToEpoch } from "../shared/time.js";
import type { ActiveRun, CommandResponse, PanelCommand, ReservationConfig, RunEvent, RunState, TablePreference } from "../shared/types.js";
import { formatEventMessage, formatEventTime } from "./event-format.js";
import { configFromFormValues, type FormValues } from "./form-model.js";

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
const clockOffset = byId<HTMLElement>("clock-offset");
const stopButton = byId<HTMLButtonElement>("stop");
const priorityInput = byId<HTMLInputElement>("priority-time");
const priorityList = byId<HTMLOListElement>("priority-list");
const postSlotOptions = byId<HTMLElement>("post-slot-options");

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
  pagePrepared: byId<HTMLInputElement>("page-prepared"),
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
  VALIDATING: "설정과 페이지를 검증 중입니다.",
  SYNCING_CLOCK: "서버 시계를 측정 중입니다.",
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

let priorityTimes: string[] = [];
let stopAtDirty = false;

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
    pagePrepared: fields.pagePrepared.checked,
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
  fields.pagePrepared.checked = values.pagePrepared;
  fields.dryRun.checked = values.dryRun;
  fields.preOpenLeadMs.value = values.preOpenLeadMs;
  fields.toggleIntervalMs.value = values.toggleIntervalMs;
  fields.clockSampleCount.value = values.clockSampleCount;
  priorityTimes = [...values.priorityTimes];
  syncPostSlotFields();
  renderPriorities();
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
    pagePrepared: config.pagePrepared,
    dryRun: config.dryRun,
    preOpenLeadMs: String(config.preOpenLeadMs),
    toggleIntervalMs: String(config.toggleIntervalMs),
    clockSampleCount: String(config.clockSampleCount),
  };
}

function saveDraft(): void {
  void chrome.storage.local.set({ draftForm: readValues(), draftStopAtDirty: stopAtDirty });
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

function renderRuntime(activeRun: ActiveRun | null | undefined, events: RunEvent[]): void {
  const state = activeRun?.state ?? "IDLE";
  stateBadge.textContent = state;
  stateBadge.dataset.state = state;
  statusDetail.textContent = STATE_LABEL[state];
  const running = activeRun !== null && activeRun !== undefined && !TERMINAL.has(state);
  fieldset.disabled = running;
  stopButton.disabled = !running;

  const metric = [...events].reverse().find((event) => typeof event.data?.clockOffsetMs === "number");
  clockOffset.textContent = metric ? `시계 ${Number(metric.data?.clockOffsetMs).toFixed(0)}ms` : "시계 -";
  eventList.replaceChildren();
  const recent = events.slice(-50).reverse();
  if (recent.length === 0) {
    const empty = document.createElement("li");
    empty.className = "event-empty";
    empty.textContent = "실행 기록 없음";
    eventList.append(empty);
    return;
  }
  recent.forEach((event) => {
    const item = document.createElement("li");
    const time = document.createElement("span");
    time.className = "event-time";
    time.textContent = formatEventTime(event.at);
    const message = document.createElement("span");
    message.textContent = formatEventMessage(event);
    item.append(time, message);
    eventList.append(item);
  });
}

async function send(command: PanelCommand): Promise<CommandResponse> {
  return chrome.runtime.sendMessage(command) as Promise<CommandResponse>;
}

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
});
fields.stopAt.addEventListener("input", () => {
  stopAtDirty = true;
  saveDraft();
});
fields.postSlotEnabled.addEventListener("change", () => {
  syncPostSlotFields();
  saveDraft();
});
form.addEventListener("input", (event) => {
  if (event.target !== fields.stopAt && event.target !== fields.openAt) saveDraft();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";
  try {
    const config = configFromFormValues(readValues(), Date.now());
    const response = await send({ type: "PANEL_START", config });
    if (!response.ok) throw new Error(response.error ?? "실행을 시작할 수 없습니다.");
    stateBadge.textContent = "CONFIGURED";
    stateBadge.dataset.state = "CONFIGURED";
    statusDetail.textContent = "현재 탭에 실행을 요청했습니다.";
    fieldset.disabled = true;
    stopButton.disabled = false;
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : "입력값을 확인하세요.";
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
});

void chrome.storage.local.get(["reservationConfig", "activeRun", "runEvents", "draftForm", "draftStopAtDirty"]).then((stored) => {
  const draft = stored.draftForm as FormValues | undefined;
  const config = stored.reservationConfig as ReservationConfig | undefined;
  if (draft) {
    applyValues(draft);
    stopAtDirty = stored.draftStopAtDirty === true;
  } else if (config) {
    applyValues(valuesFromConfig(config));
    stopAtDirty = true;
  }
  syncPostSlotFields();
  renderRuntime(stored.activeRun as ActiveRun | null | undefined, (stored.runEvents as RunEvent[] | undefined) ?? []);
});
