import type { AttemptStatusResponse } from "../shared/run-control/protocol.js";
import type { CommandResponse, ContentCommand } from "../shared/types.js";
import { navigateTab, sameRestaurant } from "./navigation.js";

interface PortTabs {
  get(tabId: number): Promise<{ id?: number; status?: string; url?: string }>;
  update(tabId: number, properties: { url: string }): Promise<{ status?: string; url?: string }>;
  reload(tabId: number): Promise<void>;
  onUpdated: {
    addListener(listener: (tabId: number, changeInfo: { status?: string; url?: string }, tab: { id?: number; status?: string; url?: string }) => void): void;
    removeListener(listener: (tabId: number, changeInfo: { status?: string; url?: string }, tab: { id?: number; status?: string; url?: string }) => void): void;
  };
}

export interface PageRuntimePort {
  navigateIfNeeded(tabId: number, targetUrl: string): Promise<void>;
  /** 같은 URL이어도 반드시 문서를 다시 로드한다 — RESET_PAGE의 실행 계약. */
  forceReenter(tabId: number, targetUrl: string): Promise<void>;
  inject(tabId: number): Promise<void>;
  ping(tabId: number): Promise<boolean>;
  startAttempt(tabId: number, command: Extract<ContentCommand, { type: "START" }>): Promise<CommandResponse>;
  stopAttempt(tabId: number): Promise<boolean>;
  getAttemptStatus(tabId: number, attemptId: string): Promise<AttemptStatusResponse | null>;
}

export function createPageRuntimePort(deps: {
  tabs: PortTabs;
  executeScript(tabId: number): Promise<void>;
  sendMessage(tabId: number, command: ContentCommand): Promise<unknown>;
}): PageRuntimePort {
  const waitForLoad = (tabId: number, targetUrl: string) => navigateTab(tabId, targetUrl, {
    get: (id) => deps.tabs.get(id),
    update: (id, properties) => deps.tabs.update(id, properties),
    onUpdated: deps.tabs.onUpdated,
  });
  const waitForReload = (tabId: number, targetUrl: string) => new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deps.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const listener = (updatedTabId: number, changeInfo: { status?: string }, tab: { url?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete" && sameRestaurant(tab.url, targetUrl)) finish();
    };
    const timer = setTimeout(() => finish(new Error("설정한 식당 페이지 로드 시간이 초과됐습니다.")), 15_000);
    deps.tabs.onUpdated.addListener(listener);
    void deps.tabs.reload(tabId).catch((error) => {
      finish(error instanceof Error ? error : new Error("페이지를 다시 로드하지 못했습니다."));
    });
  });
  const ping = async (tabId: number): Promise<boolean> => {
    try {
      const response = await deps.sendMessage(tabId, { type: "PING" }) as { ok?: boolean } | undefined;
      return response?.ok === true;
    } catch {
      return false;
    }
  };
  return {
    async navigateIfNeeded(tabId, targetUrl) {
      const current = await deps.tabs.get(tabId);
      if (sameRestaurant(current.url, targetUrl)) return;
      await waitForLoad(tabId, targetUrl);
    },
    async forceReenter(tabId, targetUrl) {
      const current = await deps.tabs.get(tabId);
      if (sameRestaurant(current.url, targetUrl)) {
        // navigateTab은 같은 URL 업데이트에서 load 이벤트를 보장하지 않는다 — reload로 강제한다.
        await waitForReload(tabId, targetUrl);
        return;
      }
      await waitForLoad(tabId, targetUrl);
    },
    async inject(tabId) {
      if (await ping(tabId)) return;
      await deps.executeScript(tabId);
      if (!(await ping(tabId))) throw new Error("예약 페이지에 실행 코드를 연결할 수 없습니다.");
    },
    ping,
    async startAttempt(tabId, command) {
      const response = await deps.sendMessage(tabId, command) as CommandResponse | undefined;
      if (response?.ok) return { ok: true };
      return { ok: false, error: response?.error ?? "실행을 시작할 수 없습니다." };
    },
    async stopAttempt(tabId) {
      try {
        await deps.sendMessage(tabId, { type: "STOP" });
        return true;
      } catch {
        return false;
      }
    },
    async getAttemptStatus(tabId, attemptId) {
      try {
        const response = await deps.sendMessage(tabId, { type: "GET_ATTEMPT_STATUS", attemptId });
        return (response ?? null) as AttemptStatusResponse | null;
      } catch {
        return null;
      }
    },
  };
}
