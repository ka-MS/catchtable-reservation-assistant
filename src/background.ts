import type { Command, StatusEvent } from "./shared/types.js";

type PanelCommand = { type: "PANEL_COMMAND"; command: Command };
type ContentReady = { type: "CONTENT_READY" };

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onMessage.addListener((message: PanelCommand | StatusEvent | ContentReady, sender, sendResponse) => {
  if (message.type === "STATUS") {
    void chrome.storage.local.set({ lastStatus: message, monitoredTabId: sender.tab?.id });
    return;
  }

  if (message.type === "CONTENT_READY") {
    const tabId = sender.tab?.id;
    void chrome.storage.local.get(["monitoringEnabled", "monitoredTabId", "reservationConfig"]).then(async (stored) => {
      if (
        stored.monitoringEnabled === true &&
        tabId !== undefined &&
        tabId === stored.monitoredTabId &&
        stored.reservationConfig
      ) {
        chrome.tabs.sendMessage(tabId, { type: "START", config: stored.reservationConfig });
      }
    });
    return;
  }

  if (message.type !== "PANEL_COMMAND") return;
  const command = message.command;
  void chrome.storage.local.get("monitoredTabId").then(async ({ monitoredTabId }) => {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = command.type === "STOP" && typeof monitoredTabId === "number"
      ? await chrome.tabs.get(monitoredTabId).catch(() => undefined)
      : activeTab;
    if (!tab?.id || (command.type === "START" && !tab.url?.startsWith("https://app.catchtable.co.kr/"))) {
      sendResponse({ ok: false, error: "캐치테이블 예약 탭을 활성화하세요." });
      return;
    }
    if (command.type === "START") {
      await chrome.storage.local.set({
        reservationConfig: command.config,
        monitoredTabId: tab.id,
        monitoringEnabled: true,
      });
    } else {
      await chrome.storage.local.set({ monitoringEnabled: false });
    }
    try {
      await chrome.tabs.sendMessage(tab.id, command);
      sendResponse({ ok: true });
    } catch {
      if (command.type !== "START") {
        sendResponse({ ok: false, error: "감시 탭과 통신할 수 없습니다." });
        return;
      }
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/index.js"] });
        await chrome.tabs.sendMessage(tab.id, command);
        sendResponse({ ok: true });
      } catch {
        await chrome.storage.local.set({ monitoringEnabled: false });
        sendResponse({ ok: false, error: "예약 페이지에 감시 코드를 연결할 수 없습니다." });
      }
    }
  });
  return true;
});
