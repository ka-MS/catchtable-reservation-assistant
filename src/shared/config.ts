import type { ReservationConfig } from "./types.js";

const TEN_MINUTES_MS = 10 * 60 * 1_000;

export function defaultStopAt(openAtMs: number): number {
  return openAtMs + TEN_MINUTES_MS;
}

function isValidDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function isMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 24 * 60;
}

export function validateReservationConfig(config: ReservationConfig, nowMs: number): string[] {
  const errors: string[] = [];
  try {
    const url = new URL(config.targetUrl);
    if (url.origin !== "https://app.catchtable.co.kr" || !/^\/ct\/shop\/[^/]+\/?$/.test(url.pathname)) {
      errors.push("캐치테이블 식당 URL을 입력하세요.");
    }
  } catch {
    errors.push("캐치테이블 식당 URL을 입력하세요.");
  }

  if (!Number.isFinite(config.openAtMs)) errors.push("예약 오픈 일시를 입력하세요.");
  if (!Number.isFinite(config.stopAtMs) || config.stopAtMs <= config.openAtMs) {
    errors.push("감시 종료 시각은 예약 오픈 시각보다 늦어야 합니다.");
  }
  if (config.stopAtMs <= nowMs) errors.push("감시 종료 시각이 이미 지났습니다.");
  if (!isValidDate(config.reservationDate)) errors.push("예약 날짜를 확인하세요.");
  if (!Number.isInteger(config.personCount) || config.personCount < 1 || config.personCount > 20) {
    errors.push("예약 인원은 1명에서 20명 사이여야 합니다.");
  }

  const { startMinutes, endMinutes } = config.timeRange;
  if (!isMinute(startMinutes) || !isMinute(endMinutes) || startMinutes > endMinutes) {
    errors.push("희망 시간 범위를 확인하세요.");
  }
  const priorities = new Set(config.priorityTimes);
  if (priorities.size !== config.priorityTimes.length) errors.push("시간 우선순위에 중복이 있습니다.");
  if (config.priorityTimes.some((value) => !isMinute(value) || value < startMinutes || value > endMinutes)) {
    errors.push("시간 우선순위는 희망 범위 안에 있어야 합니다.");
  }
  if (typeof config.postSlotEnabled !== "boolean") {
    errors.push("후속 선택 자동 진행 설정을 확인하세요.");
  }
  if (!["any", "hall", "bar", "room"].includes(config.tablePreference)) {
    errors.push("테이블 타입 설정을 확인하세요.");
  }
  if (typeof config.menuKeyword !== "string" || config.menuKeyword.trim().length > 80) {
    errors.push("메뉴명 키워드는 80자 이하여야 합니다.");
  }

  if (!(["auto", "prepared"] as const).includes(config.entryMode)) {
    errors.push("예약 페이지 준비 방식을 확인하세요.");
  }
  if (!Number.isInteger(config.preOpenLeadMs)
    || config.preOpenLeadMs < 0
    || config.preOpenLeadMs > 10_000
    || config.preOpenLeadMs % 50 !== 0) {
    errors.push("사전 토글 시작값은 0~10000ms 범위의 50ms 단위여야 합니다.");
  }
  if (!Number.isInteger(config.toggleIntervalMs) || config.toggleIntervalMs < 100 || config.toggleIntervalMs > 5_000) {
    errors.push("날짜 토글 간격은 100~5000ms여야 합니다.");
  }
  return errors;
}
