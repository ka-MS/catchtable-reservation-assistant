interface NavigationTab {
  id?: number;
  status?: string;
  url?: string;
}

interface NavigationTabs {
  get(tabId: number): Promise<NavigationTab>;
  update(tabId: number, updateProperties: { url: string }): Promise<NavigationTab>;
  onUpdated: {
    addListener(listener: (tabId: number, changeInfo: { status?: string; url?: string }, tab: NavigationTab) => void): void;
    removeListener(listener: (tabId: number, changeInfo: { status?: string; url?: string }, tab: NavigationTab) => void): void;
  };
}

export function isShopUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://app.catchtable.co.kr" && /^\/ct\/shop\/[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function sameRestaurant(tabUrl: string | undefined, targetUrl: string): boolean {
  if (!tabUrl) return false;
  try {
    const tab = new URL(tabUrl);
    const target = new URL(targetUrl);
    const path = (value: string) => value.length > 1 ? value.replace(/\/$/, "") : value;
    return tab.origin === target.origin && path(tab.pathname) === path(target.pathname);
  } catch {
    return false;
  }
}

// 실런 관측 2026-07-12: 후속 진행이 성공하면 탭이 /ct/shop/ 에서 /ct/reservation/form 으로
// 이동한다. 이는 정상 목적지이므로 "식당 이탈" 가드에서 제외해야 한다.
export function leftReservationFlow(tabUrl: string | undefined, targetUrl: string): boolean {
  if (sameRestaurant(tabUrl, targetUrl)) return false;
  try {
    const tab = new URL(tabUrl ?? "");
    const target = new URL(targetUrl);
    if (tab.origin === target.origin && tab.pathname.startsWith("/ct/reservation/")) return false;
  } catch {
    return true;
  }
  return true;
}

export async function navigateTab(
  tabId: number,
  targetUrl: string,
  tabs: NavigationTabs,
  timeoutMs = 15_000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolveLoaded: () => void = () => undefined;
  let rejectLoaded: (error: Error) => void = () => undefined;
  const loaded = new Promise<void>((resolve, reject) => {
    resolveLoaded = resolve;
    rejectLoaded = reject;
  });
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (error) rejectLoaded(error);
    else resolveLoaded();
  };
  const listener = (updatedTabId: number, changeInfo: { status?: string }, tab: NavigationTab) => {
    if (updatedTabId === tabId && changeInfo.status === "complete" && sameRestaurant(tab.url, targetUrl)) finish();
  };
  tabs.onUpdated.addListener(listener);
  timer = setTimeout(() => finish(new Error("설정한 식당 페이지 로드 시간이 초과됐습니다.")), timeoutMs);
  try {
    const updated = await tabs.update(tabId, { url: targetUrl });
    if (updated.status === "complete" && sameRestaurant(updated.url, targetUrl)) finish();
    await loaded;
    const current = await tabs.get(tabId);
    if (!sameRestaurant(current.url, targetUrl)) throw new Error("설정한 식당 페이지로 이동하지 못했습니다.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    tabs.onUpdated.removeListener(listener);
  }
}
