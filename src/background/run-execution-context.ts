import type { RunExecutionContext } from "../shared/types.js";

interface TabSnapshot {
  id?: number;
  windowId?: number;
  active?: boolean;
}

interface WindowSnapshot {
  focused?: boolean;
}

interface TabsPort {
  get(tabId: number): Promise<TabSnapshot>;
}

interface WindowsPort {
  get(windowId: number): Promise<WindowSnapshot>;
}

export async function captureRunExecutionContext(
  tabId: number,
  tabs: TabsPort,
  windows: WindowsPort,
  now: () => number = () => Date.now(),
): Promise<RunExecutionContext> {
  let tab: TabSnapshot = { id: tabId };
  try {
    tab = await tabs.get(tabId);
  } catch {
    // START 자체는 실행 문맥 진단 실패 때문에 막지 않는다.
  }
  const windowId = typeof tab.windowId === "number" ? tab.windowId : null;
  let windowFocused: boolean | null = null;
  if (windowId !== null) {
    try {
      const window = await windows.get(windowId);
      windowFocused = typeof window.focused === "boolean" ? window.focused : null;
    } catch {
      // 탭 정보만으로도 실행 상관은 가능하다.
    }
  }
  return {
    capturedAt: now(),
    tabId,
    windowId,
    tabActive: tab.active === true,
    windowFocused,
  };
}
