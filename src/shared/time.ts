const KOREAN_TIME = /^(오전|오후)\s*(\d{1,2}):(\d{2})$/;
const INPUT_TIME = /^(\d{2}):(\d{2})$/;

export function parseKoreanTime(value: string): number | null {
  const match = value.trim().match(KOREAN_TIME);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (match[1] === "오전" && hour === 12) hour = 0;
  if (match[1] === "오후" && hour !== 12) hour += 12;
  return hour * 60 + minute;
}

export function parseTimeInput(value: string): number | null {
  const match = value.match(INPUT_TIME);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function localInputToEpoch(value: string): number {
  const epoch = new Date(value).getTime();
  if (!Number.isFinite(epoch)) throw new Error("올바른 날짜와 시간을 입력하세요.");
  return epoch;
}

export function epochToLocalInput(epochMs: number): string {
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
