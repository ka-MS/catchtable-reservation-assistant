import type { WaitingConfig } from "./types.js";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;

export const DEFAULT_WAITING_PRE_OPEN_LEAD_MS = 3_000;
/** dock CTA는 disabled 속성 토글만으로 열리므로 MutationObserver가 주 신호고 폴링은 보험이다. */
export const DEFAULT_WAITING_POLL_INTERVAL_MS = 25;
/** 사용자가 손으로 누르는 속도(초당 1~2회)와 비슷한 수준. 서버 갱신 요청이므로 과하게 낮추지 않는다. */
export const DEFAULT_WAITING_REFRESH_INTERVAL_MS = 500;

export function defaultWaitingStopAt(openAtMs: number): number {
  return openAtMs + FIVE_MINUTES_MS;
}

export function isWaitingShopUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://app.catchtable.co.kr" && /^\/ct\/shop\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function validateWaitingConfig(config: WaitingConfig, nowMs: number): string[] {
  const errors: string[] = [];
  if (!isWaitingShopUrl(config.targetUrl)) errors.push("캐치테이블 식당 URL을 입력하세요.");
  if (!Number.isFinite(config.openAtMs)) errors.push("웨이팅 오픈 일시를 입력하세요.");
  if (!Number.isFinite(config.stopAtMs) || config.stopAtMs <= config.openAtMs) {
    errors.push("감시 종료 시각은 웨이팅 오픈 시각보다 늦어야 합니다.");
  }
  if (config.stopAtMs <= nowMs) errors.push("감시 종료 시각이 이미 지났습니다.");
  if (typeof config.dryRun !== "boolean") errors.push("등록 클릭 설정을 확인하세요.");
  if (!Number.isInteger(config.preOpenLeadMs) || config.preOpenLeadMs < 0 || config.preOpenLeadMs > 10_000) {
    errors.push("사전 감시 시작값은 0~10000ms여야 합니다.");
  }
  if (!Number.isInteger(config.pollIntervalMs) || config.pollIntervalMs < 10 || config.pollIntervalMs > 1_000) {
    errors.push("CTA 재검사 주기는 10~1000ms여야 합니다.");
  }
  // 0은 "새로고침 누르지 않음"이다. 그 외에는 서버 갱신 요청이므로 하한을 200ms로 둔다.
  if (!Number.isInteger(config.refreshIntervalMs)
    || config.refreshIntervalMs < 0
    || (config.refreshIntervalMs > 0 && config.refreshIntervalMs < 200)
    || config.refreshIntervalMs > 5_000) {
    errors.push("새로고침 주기는 0(사용 안 함) 또는 200~5000ms여야 합니다.");
  }
  return errors;
}
