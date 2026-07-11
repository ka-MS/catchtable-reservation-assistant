import type {
  ActiveRun,
  CommandResponse,
  ContentCommand,
  PanelCommand,
  ReservationConfig,
  RunEvent,
  RunEventMessage,
  RunState,
} from "../shared/types.js";
import { appendRunEvent, SerialTaskQueue } from "./storage.js";
import { navigateTab, sameRestaurant } from "./navigation.js";

const TERMINAL_STATES = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
]);
const eventWrites = new SerialTaskQueue();
const cancelledPendingRuns = new Set<string>();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

async function ensureContent(tabId: number): Promise<void> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" } satisfies ContentCommand);
    if (response?.ok) return;
  } catch {
    // 수신기가 없는 경우에만 아래 단일 주입 경로를 사용한다.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content/index.js"] });
  const response = await chrome.tabs.sendMessage(tabId, { type: "PING" } satisfies ContentCommand);
  if (!response?.ok) throw new Error("예약 페이지에 실행 코드를 연결할 수 없습니다.");
}

async function startRun(config: ReservationConfig): Promise<CommandResponse> {
  const stored = await chrome.storage.local.get("activeRun") as { activeRun?: ActiveRun | null };
  if (stored.activeRun && !TERMINAL_STATES.has(stored.activeRun.state)) {
    return { ok: false, error: "이미 실행 중인 작업이 있습니다." };
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return { ok: false, error: "실행할 Chrome 탭을 활성화하세요." };
  if (config.entryMode === "prepared" && !sameRestaurant(tab.url, config.targetUrl)) {
    return { ok: false, error: "설정한 식당의 Catchtable 탭을 활성화하세요." };
  }
  const now = Date.now();
  const pendingRunId = `pending-${crypto.randomUUID()}`;
  const needsNavigation = config.entryMode === "auto" && !sameRestaurant(tab.url, config.targetUrl);
  const pendingRun: ActiveRun = {
    runId: pendingRunId,
    tabId: tab.id,
    state: needsNavigation ? "NAVIGATING" : "CONFIGURED",
    startedAt: now,
    updatedAt: now,
  };
  await chrome.storage.local.set({ reservationConfig: config, activeRun: pendingRun, runEvents: [] });
  const assertPending = async (): Promise<void> => {
    const current = await chrome.storage.local.get("activeRun") as { activeRun?: ActiveRun | null };
    if (cancelledPendingRuns.has(pendingRunId)
      || current.activeRun?.runId !== pendingRunId
      || TERMINAL_STATES.has(current.activeRun.state)) {
      throw new Error("페이지 준비 중 실행이 중지됐습니다.");
    }
  };
  try {
    if (needsNavigation) {
      await navigateTab(tab.id, config.targetUrl, {
        get: (tabId) => chrome.tabs.get(tabId),
        update: async (tabId, properties) => (await chrome.tabs.update(tabId, properties)) ?? {},
        onUpdated: chrome.tabs.onUpdated,
      });
    }
    await assertPending();
    await ensureContent(tab.id);
    await assertPending();
    await chrome.storage.local.set({
      activeRun: { ...pendingRun, state: "CONFIGURED", updatedAt: Date.now() },
    });
    await assertPending();
    const response = await chrome.tabs.sendMessage(tab.id, { type: "START", config } satisfies ContentCommand);
    if (response?.ok) return { ok: true };
    throw new Error(response?.error ?? "실행을 시작할 수 없습니다.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "실행을 시작할 수 없습니다.";
    const current = await chrome.storage.local.get("activeRun") as { activeRun?: ActiveRun | null };
    if (current.activeRun?.runId === pendingRunId && !TERMINAL_STATES.has(current.activeRun.state)) {
      await chrome.storage.local.set({
        activeRun: { ...current.activeRun, state: "FAILED", updatedAt: Date.now() },
      });
    }
    return { ok: false, error: message };
  } finally {
    cancelledPendingRuns.delete(pendingRunId);
  }
}

async function stopRun(): Promise<CommandResponse> {
  const { activeRun } = await chrome.storage.local.get("activeRun") as { activeRun?: ActiveRun | null };
  if (!activeRun) return { ok: false, error: "실행 중인 작업이 없습니다." };
  if (activeRun.runId.startsWith("pending-")) {
    cancelledPendingRuns.add(activeRun.runId);
    await chrome.storage.local.set({ activeRun: { ...activeRun, state: "STOPPED", updatedAt: Date.now() } });
    try {
      await chrome.tabs.sendMessage(activeRun.tabId, { type: "STOP" } satisfies ContentCommand);
    } catch {
      // Content Script가 아직 주입되지 않은 이동 단계에서도 Background가 중지를 확정한다.
    }
    return { ok: true };
  }
  try {
    await chrome.tabs.sendMessage(activeRun.tabId, { type: "STOP" } satisfies ContentCommand);
    return { ok: true };
  } catch {
    await chrome.storage.local.set({ activeRun: { ...activeRun, state: "STOPPED", updatedAt: Date.now() } });
    return { ok: true };
  }
}

async function recordEvent(event: RunEvent, tabId: number | undefined): Promise<void> {
  const stored = await chrome.storage.local.get(["runEvents", "activeRun"]);
  const events = Array.isArray(stored.runEvents) ? stored.runEvents as RunEvent[] : [];
  const previous = stored.activeRun as ActiveRun | null | undefined;
  const stateValue = event.data?.state;
  const state = typeof stateValue === "string" ? stateValue as RunState : previous?.state ?? "CONFIGURED";
  const activeRun: ActiveRun = {
    runId: event.runId,
    tabId: tabId ?? previous?.tabId ?? -1,
    state,
    startedAt: previous?.runId === event.runId ? previous.startedAt : event.at,
    updatedAt: event.at,
  };
  await chrome.storage.local.set({
    runEvents: appendRunEvent(events, event, 300),
    activeRun,
  });

  if (event.kind === "state" && TERMINAL_STATES.has(state)) {
    const needsAttention = state === "HANDED_OFF" || state === "DRY_RUN_COMPLETED";
    await chrome.action.setBadgeBackgroundColor({ color: needsAttention ? "#ff5a1f" : "#4b5563" });
    await chrome.action.setBadgeText({ text: needsAttention ? "!" : "" });
    if (needsAttention || state === "TIMED_OUT" || state === "FAILED") {
      // 운영체제 알림 실패는 상태 저장과 Side Panel 표시를 막지 않는다.
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
        title: "Catchtable Reserve",
        message: event.message,
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn("운영체제 알림을 표시하지 못했습니다.", chrome.runtime.lastError.message);
        }
      });
    }
  }
}

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = rawMessage as PanelCommand | RunEventMessage;
  if (message.type === "RUN_EVENT") {
    void eventWrites.enqueue(() => recordEvent(message.event, sender.tab?.id)).catch((error) => {
      console.error("실행 이벤트를 저장하지 못했습니다.", error);
    });
    return;
  }
  if (message.type === "PANEL_START") {
    void startRun(message.config).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행을 시작할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "PANEL_STOP") {
    void stopRun().then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행을 중지할 수 없습니다." });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.local.get("activeRun").then(({ activeRun }) => {
    const run = activeRun as ActiveRun | null | undefined;
    if (run?.tabId === tabId && !TERMINAL_STATES.has(run.state)) {
      return chrome.storage.local.set({ activeRun: { ...run, state: "STOPPED", updatedAt: Date.now() } });
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  void chrome.storage.local.get(["activeRun", "reservationConfig"]).then((stored) => {
    const run = stored.activeRun as ActiveRun | null | undefined;
    const config = stored.reservationConfig as ReservationConfig | undefined;
    if (
      run?.tabId === tabId &&
      config &&
      !TERMINAL_STATES.has(run.state) &&
      !sameRestaurant(changeInfo.url, config.targetUrl)
    ) {
      return chrome.storage.local.set({ activeRun: { ...run, state: "STOPPED", updatedAt: Date.now() } });
    }
  });
});
