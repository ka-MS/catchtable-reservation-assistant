import { defaultStopAt, resolveAvailabilityProbeMode } from "../shared/config.js";
import { MonotonicEpochClock } from "../shared/monotonic-clock.js";
import { sanitizeSavedConfigs } from "../shared/saved-configs.js";
import { sanitizeScheduledJobs } from "../shared/scheduled-jobs.js";
import { epochToLocalInput, localInputToEpoch } from "../shared/time.js";
import type { ActiveRun, AvailabilityProbeMode, CommandResponse, EntryMode, PanelCommand, PaymentMethodPolicy, ReservationConfig, RunEvent, RunState, ScheduledJob, ShopSnapshot, TablePreference } from "../shared/types.js";
import { countdownModel } from "./countdown.js";
import { formatEventDetail, formatEventTime } from "./event-format.js";
import { configFromFormValues, configSnapshotFromFormValues, quickPrepConfig, DEFAULT_FORM_VALUES, type FormValues } from "./form-model.js";
import { jobCardModel } from "./job-card.js";
import { jobListModel, miniLogModel } from "./job-list-model.js";
import { SavedConfigsView } from "./saved-configs-view.js";
import type { TraceEvent, TraceLiveBatch, TraceRunRecord } from "../shared/telemetry/types.js";
import { traceCsv, traceCsvFilename } from "./telemetry/trace-csv.js";
import type { DiagnosticSnapshot } from "../shared/diagnostics/types.js";
import { diagnosticBundle, diagnosticBundleFilename } from "./diagnostics/bundle.js";
import { TraceHistoryView } from "./telemetry/trace-view.js";

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
const fetchShopSnapshotButton = byId<HTMLButtonElement>("fetch-shop-snapshot");
const goToShopButton = byId<HTMLButtonElement>("go-to-shop");
const resetFormButton = byId<HTMLButtonElement>("reset-form");
const quickActionStatus = byId<HTMLElement>("quick-action-status");
const priorityInput = byId<HTMLInputElement>("priority-time");
const priorityList = byId<HTMLOListElement>("priority-list");
const TIME_PRESETS = [
  { button: byId<HTMLButtonElement>("time-preset-lunch"), start: "11:00", end: "15:00" },
  { button: byId<HTMLButtonElement>("time-preset-dinner"), start: "17:00", end: "21:00" },
  { button: byId<HTMLButtonElement>("time-preset-all"), start: "11:00", end: "21:00" },
] as const;
const postSlotOptions = byId<HTMLElement>("post-slot-options");
const summaryMain = byId<HTMLElement>("summary-main");
const summarySub = byId<HTMLElement>("summary-sub");
const countdownBanner = byId<HTMLElement>("countdown");
const countdownText = byId<HTMLElement>("countdown-text");
const countdownDetail = byId<HTMLElement>("countdown-detail");
const viewHome = byId<HTMLElement>("view-home");
const viewForm = byId<HTMLElement>("view-form");
const viewRun = byId<HTMLElement>("view-run");
const newJobButton = byId<HTMLButtonElement>("new-job");
const jobList = byId<HTMLOListElement>("job-list");
const doneToggle = byId<HTMLButtonElement>("done-toggle");
const doneList = byId<HTMLOListElement>("done-list");
const formTitle = byId<HTMLElement>("form-title");
const miniLogList = byId<HTMLOListElement>("mini-log-list");
const miniLogMore = byId<HTMLButtonElement>("mini-log-more");
const actionBar = byId<HTMLElement>("action-bar");
const saveJobButton = byId<HTMLButtonElement>("save-job");
const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".view-nav button"));

const fields = {
  targetUrl: byId<HTMLInputElement>("target-url"),
  openAt: byId<HTMLInputElement>("open-at"),
  reservationDate: byId<HTMLInputElement>("reservation-date"),
  personCount: byId<HTMLInputElement>("person-count"),
  startTime: byId<HTMLInputElement>("start-time"),
  endTime: byId<HTMLInputElement>("end-time"),
  postSlotEnabled: byId<HTMLInputElement>("post-slot-enabled"),
  paymentMethodAutoAdvance: byId<HTMLInputElement>("payment-method-auto-advance"),
  tablePreference: byId<HTMLSelectElement>("table-preference"),
  menuKeyword: byId<HTMLInputElement>("menu-keyword"),
  stopAt: byId<HTMLInputElement>("stop-at"),
  entryMode: byId<HTMLSelectElement>("entry-mode"),
  dryRun: byId<HTMLInputElement>("dry-run"),
  preOpenLeadMs: byId<HTMLInputElement>("pre-open-lead"),
  toggleIntervalMs: byId<HTMLInputElement>("toggle-interval"),
};
const paymentMethodPolicyFieldset = byId<HTMLFieldSetElement>("payment-method-policy-options");
const paymentMethodPolicyOptions = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="payment-method-policy"]'),
);
const availabilityProbeModeOptions = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="availability-probe-mode"]'),
);

function selectedPaymentMethodPolicy(): PaymentMethodPolicy {
  const selected = paymentMethodPolicyOptions.find((option) => option.checked)?.value;
  return selected === "zero_only" ? "zero_only" : "selected_allowed";
}

function selectPaymentMethodPolicy(policy: PaymentMethodPolicy | undefined): void {
  const normalized = policy === "zero_only" ? "zero_only" : "selected_allowed";
  paymentMethodPolicyOptions.forEach((option) => {
    option.checked = option.value === normalized;
  });
}

function selectedAvailabilityProbeMode(): AvailabilityProbeMode {
  const selected = availabilityProbeModeOptions.find((option) => option.checked)?.value;
  if (selected === "observe" || selected === "empty_exit") return selected;
  return "off";
}

function selectAvailabilityProbeMode(values: Pick<FormValues, "availabilityProbeMode" | "availabilityProbeEnabled">): void {
  const mode = resolveAvailabilityProbeMode(values);
  availabilityProbeModeOptions.forEach((option) => {
    option.checked = option.value === mode;
  });
}

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
  SLOT_CLICK_DISPATCHED: "슬롯 클릭을 전달했습니다.",
  SLOT_TRANSITION_CONFIRMED: "후속 예약 화면을 확인했습니다.",
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
  SLOT_CLICK_DISPATCHED: "클릭 전달",
  SLOT_TRANSITION_CONFIRMED: "화면 전환 확인",
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
  "SLOT_CLICK_DISPATCHED",
  "SLOT_TRANSITION_CONFIRMED",
  "SLOT_SELECTED",
  "ADVANCING_RESERVATION",
]);

let priorityTimes: string[] = [];
let importantEventsOnly = false;
let latestActiveRun: ActiveRun | null | undefined;
let logicalRunStatus: string | null = null;
let latestEvents: RunEvent[] = [];
const countdownServerClock = new MonotonicEpochClock({ now: () => performance.now() });
let countdownClockOffsetMs: number | null = null;

type PanelView = "home" | "form" | "run";
let currentView: PanelView = "home";
let editingJobId: string | null = null;
let scheduledJobsState: ScheduledJob[] = [];
let runConfigOpenAtMs: number | null = null;
let wasRunning = false;

function isRunning(): boolean {
  return latestActiveRun !== null && latestActiveRun !== undefined && !TERMINAL.has(latestActiveRun.state);
}

function setView(view: PanelView): void {
  currentView = view;
  document.body.dataset.view = view;
  viewHome.hidden = view !== "home";
  viewForm.hidden = view !== "form";
  viewRun.hidden = view !== "run";
  actionBar.hidden = view !== "form";
  startButton.hidden = isRunning();
  navButtons.forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.view === view));
  });
  formTitle.textContent = editingJobId === null ? "새 예약 작업" : "작업 편집";
  formError.textContent = "";
  renderCountdown();
}

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
    paymentMethodAutoAdvance: fields.paymentMethodAutoAdvance.checked,
    paymentMethodPolicy: selectedPaymentMethodPolicy(),
    tablePreference: fields.tablePreference.value as TablePreference,
    menuKeyword: fields.menuKeyword.value,
    stopAt: fields.stopAt.value,
    entryMode: fields.entryMode.value as EntryMode,
    dryRun: fields.dryRun.checked,
    preOpenLeadMs: fields.preOpenLeadMs.value,
    toggleIntervalMs: fields.toggleIntervalMs.value,
    availabilityProbeMode: selectedAvailabilityProbeMode(),
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
  fields.paymentMethodAutoAdvance.checked = values.paymentMethodAutoAdvance ?? true;
  selectPaymentMethodPolicy(values.paymentMethodPolicy);
  fields.tablePreference.value = values.tablePreference ?? "any";
  fields.menuKeyword.value = values.menuKeyword ?? "";
  fields.stopAt.value = values.stopAt;
  fields.entryMode.value = values.entryMode ?? (values.pagePrepared === false ? "auto" : "prepared");
  fields.dryRun.checked = values.dryRun;
  fields.preOpenLeadMs.value = values.preOpenLeadMs;
  fields.toggleIntervalMs.value = values.toggleIntervalMs;
  selectAvailabilityProbeMode(values);
  priorityTimes = [...values.priorityTimes];
  syncPostSlotFields();
  renderPriorities();
  renderSummary();
  syncTimePresetButtons();
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
    paymentMethodAutoAdvance: config.paymentMethodAutoAdvance ?? true,
    paymentMethodPolicy: config.paymentMethodPolicy ?? "selected_allowed",
    tablePreference: config.tablePreference ?? "any",
    menuKeyword: config.menuKeyword ?? "",
    stopAt: epochToLocalInput(config.stopAtMs),
    entryMode: config.entryMode ?? ((config as ReservationConfig & { pagePrepared?: boolean }).pagePrepared === false ? "auto" : "prepared"),
    dryRun: config.dryRun,
    preOpenLeadMs: String(config.preOpenLeadMs),
    toggleIntervalMs: String(config.toggleIntervalMs),
    availabilityProbeMode: resolveAvailabilityProbeMode(config),
  };
}

function saveDraft(): void {
  void chrome.storage.local.set({ draftForm: readValues() });
}

function syncPostSlotFields(): void {
  const enabled = fields.postSlotEnabled.checked;
  fields.paymentMethodAutoAdvance.disabled = !enabled;
  paymentMethodPolicyFieldset.hidden = !fields.paymentMethodAutoAdvance.checked;
  paymentMethodPolicyFieldset.disabled = !enabled || !fields.paymentMethodAutoAdvance.checked;
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
  if (
    event.kind === "action"
    || ["SLOT_CLICK_DISPATCHED", "SLOT_TRANSITION_CONFIRMED", "SLOT_SELECTED", "ADVANCING_RESERVATION"].includes(state)
  ) return "action";
  return "neutral";
}

function isImportantEvent(event: RunEvent): boolean {
  return eventTone(event) !== "neutral";
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

function countdownOpenAtMs(): number | null {
  if (currentView === "form") {
    return fields.openAt.value ? localInputToEpoch(fields.openAt.value) : null;
  }
  if (currentView === "run") return runConfigOpenAtMs;
  const nextJob = scheduledJobsState.find((job) => job.status === "scheduled");
  return nextJob ? nextJob.config.openAtMs : null;
}

function renderCountdown(): void {
  const openAt = countdownOpenAtMs();
  const offsetEvent = [...latestEvents].reverse().find((event) => typeof event.data?.clockOffsetMs === "number");
  const offsetMs = offsetEvent ? Number(offsetEvent.data?.clockOffsetMs) : null;
  if (offsetMs === null) {
    countdownClockOffsetMs = null;
  } else if (offsetMs !== countdownClockOffsetMs) {
    countdownServerClock.anchor(Date.now() + offsetMs);
    countdownClockOffsetMs = offsetMs;
  }
  const state = latestActiveRun?.state;
  const model = countdownModel({
    nowMs: offsetMs === null ? Date.now() : countdownServerClock.now(),
    openAtMs: openAt !== null && Number.isFinite(openAt) ? openAt : null,
    serverBased: offsetMs !== null,
    activeStage: state && POST_OPEN_STAGES.has(state) ? STATE_BADGE[state] : null,
  });
  countdownBanner.hidden = !model.visible;
  countdownBanner.dataset.mode = model.mode;
  countdownBanner.dataset.urgent = String(model.urgent);
  countdownText.textContent = model.text;
  countdownDetail.textContent = model.detail;
}

function renderJobCard(job: ScheduledJob): HTMLLIElement {
    const model = jobCardModel(job, Date.now());
    const item = document.createElement("li");
    item.className = "job-card";
    const header = document.createElement("div");
    header.className = "job-card-header";
    const title = document.createElement("span");
    title.className = "job-card-title";
    title.textContent = model.title;
    const status = document.createElement("span");
    status.className = "job-status";
    status.dataset.tone = model.statusTone;
    status.textContent = model.statusLabel;
    header.append(title, status);
    const meta = document.createElement("div");
    meta.className = "job-card-meta";
    const summary = document.createElement("span");
    summary.textContent = model.summary;
    const openAt = document.createElement("span");
    openAt.textContent = model.openAtText;
    const createdAt = document.createElement("span");
    createdAt.className = "job-card-created";
    createdAt.textContent = model.createdAtText;
    meta.append(summary, openAt, createdAt);
    const detail = document.createElement("span");
    detail.className = "job-card-detail";
    if (model.statusTone === "scheduled") detail.classList.add("job-card-countdown");
    detail.textContent = model.detail;
    const actions = document.createElement("div");
    actions.className = "job-card-actions";
    if (model.showLog) {
      const logButton = document.createElement("button");
      logButton.type = "button";
      logButton.textContent = "로그 보기";
      logButton.addEventListener("click", () => setView("run"));
      actions.append(logButton);
    }
    if (model.canEdit) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "편집";
      editButton.addEventListener("click", () => {
        editingJobId = job.id;
        applyValues(valuesFromConfig(job.config));
        saveDraft();
        setView("form");
      });
      actions.append(editButton);
    }
    if (model.canDelete) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "삭제";
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`${model.title} 예약 작업을 삭제할까요?`)) return;
        const response = await send({ type: "DELETE_JOB", id: job.id });
        if (!response.ok) formError.textContent = response.error ?? "예약 작업을 삭제할 수 없습니다.";
      });
      actions.append(deleteButton);
    }
    item.append(header, meta, detail, actions);
    return item;
}

function renderJobs(): void {
  const model = jobListModel(scheduledJobsState);
  jobList.replaceChildren();
  if (model.active.length === 0) {
    const empty = document.createElement("li");
    empty.className = "job-empty";
    empty.textContent = "등록된 예약 작업이 없습니다.";
    jobList.append(empty);
  } else {
    model.active.forEach((job) => jobList.append(renderJobCard(job)));
  }
  doneToggle.hidden = model.done.length === 0;
  doneToggle.textContent = `${model.doneLabel} ${doneList.hidden ? "보기 ▾" : "접기 ▴"}`;
  doneList.replaceChildren();
  if (model.done.length === 0) {
    doneList.hidden = true;
  } else {
    model.done.forEach((job) => doneList.append(renderJobCard(job)));
  }
}

function renderMiniLog(): void {
  const model = miniLogModel(latestEvents);
  miniLogList.replaceChildren();
  if (model.emptyText !== null) {
    const empty = document.createElement("li");
    empty.textContent = model.emptyText;
    miniLogList.append(empty);
    return;
  }
  model.entries.forEach((event) => {
    const item = document.createElement("li");
    const time = document.createElement("span");
    time.className = "mini-log-time";
    time.textContent = formatEventTime(event.at);
    const message = document.createElement("span");
    message.textContent = event.message;
    item.append(time, message);
    miniLogList.append(item);
  });
}

function renderRuntime(activeRun: ActiveRun | null | undefined, events: RunEvent[]): void {
  latestActiveRun = activeRun;
  latestEvents = events;
  renderCountdown();
  const state = activeRun?.state ?? "IDLE";
  stateBadge.textContent = STATE_BADGE[state];
  stateBadge.dataset.state = state;
  statusDetail.textContent = logicalRunStatus === "RECOVERING"
    ? `${STATE_LABEL[state]} · 재시도 중 — 같은 탭에서 페이지를 다시 준비합니다.`
    : STATE_LABEL[state];
  const running = activeRun !== null && activeRun !== undefined && !TERMINAL.has(state);
  fieldset.disabled = running;
  startButton.hidden = running;
  stopButton.disabled = !running;
  resetFormButton.disabled = running;
  renderMiniLog();
  if (running && !wasRunning && !watchingPrepTest) setView("run");
  wasRunning = running;

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
    const detailText = formatEventDetail(event);
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

async function readTraceEvents(runId: string): Promise<TraceEvent[]> {
  // RT-15 raw clock events(max 64)는 화면에서 숨기므로 운영 로그 100건을 보존할 여유를 둔다.
  const response = await send({ type: "GET_RUN_TRACE", runId, limit: 200 });
  if (!response.ok) throw new Error(response.error ?? "실행 로그를 읽을 수 없습니다.");
  return Array.isArray(response.data) ? response.data as TraceEvent[] : [];
}

async function exportTraceEvents(runId: string): Promise<TraceEvent[]> {
  const response = await send({ type: "EXPORT_RUN_TRACE", runId });
  if (!response.ok) throw new Error(response.error ?? "실행 로그를 내보낼 수 없습니다.");
  return Array.isArray(response.data) ? response.data as TraceEvent[] : [];
}

async function exportRunDiagnostic(runId: string): Promise<{ events: TraceEvent[]; snapshots: DiagnosticSnapshot[] }> {
  const response = await send({ type: "EXPORT_RUN_DIAGNOSTIC", runId });
  if (!response.ok) throw new Error(response.error ?? "실행 진단을 내보낼 수 없습니다.");
  const data = response.data as { events?: unknown; snapshots?: unknown } | undefined;
  if (!Array.isArray(data?.events) || !Array.isArray(data?.snapshots)) {
    throw new Error("실행 진단 응답이 올바르지 않습니다.");
  }
  return { events: data.events as TraceEvent[], snapshots: data.snapshots as DiagnosticSnapshot[] };
}

function downloadTraceCsv(run: TraceRunRecord, events: TraceEvent[]): void {
  const url = URL.createObjectURL(new Blob([traceCsv(run, events)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = traceCsvFilename(run);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadDiagnosticBundle(run: TraceRunRecord, events: TraceEvent[], snapshots: DiagnosticSnapshot[]): void {
  const bytes = diagnosticBundle(run, events, snapshots);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = diagnosticBundleFilename(run.runId);
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const traceView = new TraceHistoryView(document, {
  select: (runId) => {
    void readTraceEvents(runId).then((events) => traceView.renderEvents(events)).catch((error) => {
      formError.textContent = error instanceof Error ? error.message : "실행 로그를 읽을 수 없습니다.";
    });
  },
  download: (run) => {
    void exportTraceEvents(run.runId).then((events) => downloadTraceCsv(run, events)).catch((error) => {
      formError.textContent = error instanceof Error ? error.message : "실행 로그를 내보낼 수 없습니다.";
    });
  },
  diagnostic: (run) => {
    void exportRunDiagnostic(run.runId).then(({ events, snapshots }) => {
      downloadDiagnosticBundle(run, events, snapshots);
    }).catch((error) => {
      formError.textContent = error instanceof Error ? error.message : "실행 진단을 내보낼 수 없습니다.";
    });
  },
  remove: (runId) => {
    if (!window.confirm("선택한 실행 이력과 상세 로그를 삭제할까요?")) return;
    void send({ type: "DELETE_RUN_TRACE", runId }).then((response) => {
      if (!response.ok) throw new Error(response.error ?? "실행 이력을 삭제할 수 없습니다.");
      return refreshTraceHistory();
    }).catch((error) => {
      formError.textContent = error instanceof Error ? error.message : "실행 이력을 삭제할 수 없습니다.";
    });
  },
});

async function refreshTraceHistory(preferredRunId?: string): Promise<void> {
  const response = await send({ type: "LIST_RUN_HISTORY" });
  if (!response.ok) throw new Error(response.error ?? "실행 이력을 읽을 수 없습니다.");
  const runs = Array.isArray(response.data) ? response.data as TraceRunRecord[] : [];
  traceView.renderRuns(runs, preferredRunId);
  const selected = traceView.selectedRunId();
  traceView.renderEvents(selected ? await readTraceEvents(selected) : []);
}

function connectLiveTrace(): void {
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: "trace-live" });
  } catch {
    globalThis.setTimeout(connectLiveTrace, 500);
    return;
  }
  port.onMessage.addListener((message: TraceLiveBatch) => {
    if (message?.type === "TRACE_LIVE_BATCH") traceView.appendLive(message);
  });
  port.onDisconnect.addListener(() => globalThis.setTimeout(connectLiveTrace, 500));
}

connectLiveTrace();

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
    applyValues(valuesFromConfig(config));
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

newJobButton.addEventListener("click", () => {
  editingJobId = null;
  setView("form");
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view === "home" || view === "form" || view === "run") setView(view);
  });
});

doneToggle.addEventListener("click", () => {
  doneList.hidden = !doneList.hidden;
  renderJobs();
});

miniLogMore.addEventListener("click", () => {
  setView("run");
});

saveJobButton.addEventListener("click", async () => {
  formError.textContent = "";
  saveJobButton.disabled = true;
  try {
    const config = configFromFormValues(readValues(), Date.now());
    const response = await send({ type: "SCHEDULE_JOB", id: editingJobId, config });
    if (!response.ok) throw new Error(response.error ?? "예약 작업을 저장할 수 없습니다.");
    editingJobId = null;
    setView("home");
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : "입력값을 확인하세요.";
  } finally {
    saveJobButton.disabled = false;
  }
});

function syncTimePresetButtons(): void {
  const start = fields.startTime.value;
  const end = fields.endTime.value;
  for (const preset of TIME_PRESETS) {
    preset.button.setAttribute("aria-pressed", String(start === preset.start && end === preset.end));
  }
}

function applyTimeRangePreset(start: string, end: string): void {
  fields.startTime.value = start;
  fields.endTime.value = end;
  renderSummary();
  saveDraft();
  syncTimePresetButtons();
}

for (const preset of TIME_PRESETS) {
  preset.button.addEventListener("click", () => applyTimeRangePreset(preset.start, preset.end));
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
  if (fields.openAt.value) {
    fields.stopAt.value = epochToLocalInput(defaultStopAt(localInputToEpoch(fields.openAt.value)));
  }
  saveDraft();
  renderCountdown();
});
setInterval(renderCountdown, 500);
setInterval(renderJobs, 30_000);
fields.stopAt.addEventListener("input", () => {
  saveDraft();
});
fields.postSlotEnabled.addEventListener("change", () => {
  syncPostSlotFields();
  saveDraft();
});
fields.paymentMethodAutoAdvance.addEventListener("change", syncPostSlotFields);
form.addEventListener("input", (event) => {
  renderSummary();
  if (event.target === fields.startTime || event.target === fields.endTime) syncTimePresetButtons();
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
    setView("run");
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

const QUICK_STATUS_VISIBLE_MS = 4_000;
let quickStatusHideTimer: ReturnType<typeof setTimeout> | undefined;

function setQuickStatus(message: string, tone?: "success" | "error"): void {
  quickActionStatus.textContent = message;
  quickActionStatus.hidden = false;
  if (tone) quickActionStatus.dataset.tone = tone;
  else delete quickActionStatus.dataset.tone;
  clearTimeout(quickStatusHideTimer);
  quickStatusHideTimer = setTimeout(() => {
    quickActionStatus.hidden = true;
  }, QUICK_STATUS_VISIBLE_MS);
}

fetchShopSnapshotButton.addEventListener("click", async () => {
  const response = await send({ type: "FETCH_SHOP_SNAPSHOT" });
  if (!response.ok) {
    setQuickStatus(response.error ?? "현재 탭 정보를 가져올 수 없습니다.", "error");
    return;
  }
  const snapshot = response.data as ShopSnapshot;
  fields.targetUrl.value = snapshot.url;
  const filled = ["URL"];
  if (snapshot.selectedDate) {
    fields.reservationDate.value = snapshot.selectedDate;
    filled.push("날짜");
  }
  if (snapshot.selectedPersonCount !== null) {
    fields.personCount.value = String(snapshot.selectedPersonCount);
    filled.push("인원");
  }
  renderSummary();
  saveDraft();
  setQuickStatus(`${filled.join("·")}을(를) 가져왔습니다.`, "success");
});

const PREP_STOP_STATES = new Set<RunState>(["PREPARING_PAGE", "HANDED_OFF", "TIMED_OUT", "FAILED", "STOPPED"]);
let watchingPrepTest = false;

goToShopButton.addEventListener("click", async () => {
  goToShopButton.disabled = true;
  setQuickStatus("예약창 진입을 확인하는 중…");
  // storage에 activeRun이 먼저 쓰이고 그 변경 이벤트가 PANEL_START 응답보다 먼저
  // 도착할 수 있다 — renderRuntime의 뷰 전환 가드가 걸리려면 응답을 기다리지 않고
  // 요청 직전에 켜야 한다.
  watchingPrepTest = true;
  const config = quickPrepConfig(readValues(), Date.now());
  const response = await send({ type: "PANEL_START", config });
  if (!response.ok) {
    watchingPrepTest = false;
    setQuickStatus(response.error ?? "실행을 시작할 수 없습니다.", "error");
    goToShopButton.disabled = false;
  }
});

resetFormButton.addEventListener("click", async () => {
  if (!window.confirm("예약 설정을 기본값으로 초기화하고 실행 기록을 지울까요?")) return;
  formError.textContent = "";
  editingJobId = null;
  formTitle.textContent = "새 예약 작업";
  applyValues(DEFAULT_FORM_VALUES);
  saveDraft();
  const response = await send({ type: "CLEAR_RUN_EVENTS" });
  if (!response.ok) formError.textContent = response.error ?? "실행 기록을 지울 수 없습니다.";
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.activeRun || changes.runEvents || changes.logicalRun) {
    void chrome.storage.local.get(["activeRun", "runEvents", "logicalRun"]).then((stored) => {
      logicalRunStatus = (stored.logicalRun as { status?: string } | null | undefined)?.status ?? null;
      renderRuntime(stored.activeRun as ActiveRun | null | undefined, (stored.runEvents as RunEvent[] | undefined) ?? []);
      if (watchingPrepTest) {
        const last = latestEvents.at(-1);
        const state = last?.data?.state;
        if (typeof state === "string" && PREP_STOP_STATES.has(state as RunState)) {
          watchingPrepTest = false;
          void send({ type: "PANEL_STOP" });
          setQuickStatus(last!.message, state === "PREPARING_PAGE" ? "success" : "error");
          goToShopButton.disabled = false;
        }
      }
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
  if (changes.scheduledJobs) {
    scheduledJobsState = sanitizeScheduledJobs(changes.scheduledJobs.newValue);
    renderJobs();
    renderCountdown();
  }
  if (changes.reservationConfig) {
    const next = changes.reservationConfig.newValue as ReservationConfig | undefined;
    runConfigOpenAtMs = next ? next.openAtMs : null;
  }
});

void chrome.storage.local.get([
  "reservationConfig",
  "activeRun",
  "runEvents",
  "logicalRun",
  "draftForm",
  "configHistory",
  "configFavorites",
  "scheduledJobs",
]).then((stored) => {
  logicalRunStatus = (stored.logicalRun as { status?: string } | null | undefined)?.status ?? null;
  const draft = stored.draftForm as FormValues | undefined;
  const config = stored.reservationConfig as ReservationConfig | undefined;
  if (draft) {
    applyValues(draft);
  } else if (config) {
    applyValues(valuesFromConfig(config));
  }
  syncPostSlotFields();
  scheduledJobsState = sanitizeScheduledJobs(stored.scheduledJobs);
  runConfigOpenAtMs = config ? config.openAtMs : null;
  renderJobs();
  setView("home");
  renderRuntime(stored.activeRun as ActiveRun | null | undefined, (stored.runEvents as RunEvent[] | undefined) ?? []);
  savedConfigsView.render(
    sanitizeSavedConfigs(stored.configHistory),
    sanitizeSavedConfigs(stored.configFavorites),
  );
  void refreshTraceHistory((stored.activeRun as ActiveRun | null | undefined)?.runId).catch((error) => {
    formError.textContent = error instanceof Error ? error.message : "실행 이력을 읽을 수 없습니다.";
  });
});
