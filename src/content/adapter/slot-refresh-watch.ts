export interface SlotRefreshWatchPort {
  start(onArrival: () => void): void;
  stop(): void;
}

type ResourceEntryLike = { name: string };
type ObserverLike = { observe(options: { type: string; buffered: boolean }): void; disconnect(): void };
type ObserverFactory = (callback: (entries: ResourceEntryLike[]) => void) => ObserverLike;

// 실측(site-behavior §8.1): 슬롯 목록은 ct-api 호스트의 이 경로로만 온다.
// URL에 날짜가 없어 도착 신호는 날짜 불문 — 검증은 감지 스캔이 담당한다.
const SLOT_REFRESH_PATH_SUFFIX = "/dining/time-slots";

export function isSlotRefreshEntry(name: string, origin: string): boolean {
  try {
    return new URL(name, origin).pathname.endsWith(SLOT_REFRESH_PATH_SUFFIX);
  } catch {
    return false;
  }
}

export class SlotRefreshWatch implements SlotRefreshWatchPort {
  private observer: ObserverLike | null = null;

  constructor(private readonly createObserver: ObserverFactory, private readonly origin: string) {}

  start(onArrival: () => void): void {
    if (this.observer) return;
    const observer = this.createObserver((entries) => {
      for (const entry of entries) {
        if (isSlotRefreshEntry(entry.name, this.origin)) onArrival();
      }
    });
    observer.observe({ type: "resource", buffered: false });
    this.observer = observer;
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

export function createSlotRefreshWatch(): SlotRefreshWatchPort {
  return new SlotRefreshWatch(
    (callback) => new PerformanceObserver((list) => callback(list.getEntries() as unknown as ResourceEntryLike[])),
    location.origin,
  );
}
