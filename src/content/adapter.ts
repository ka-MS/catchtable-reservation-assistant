import type { ReservationConfig, TableTypePreference } from "../shared/types.js";

export interface TimeSlot {
  button: HTMLButtonElement;
  minutes: number;
  label: string;
}

export interface TableTypeDialog {
  dialog: Element;
  option: HTMLInputElement;
  nextButton: HTMLButtonElement;
}

export interface DepositNotice {
  dialog: Element;
  confirmButton: HTMLButtonElement;
}

const tableLabels: Record<Exclude<TableTypePreference, "none">, string> = {
  hall: "홀",
  room: "룸",
  bar: "바",
};

export function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function parseKoreanTime(label: string): number | null {
  const match = label.replace(/\s+/g, " ").trim().match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;

  let hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 12 || minute > 59) return null;
  if (match[1] === "오후" && hour !== 12) hour += 12;
  if (match[1] === "오전" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

export function parseTimeInput(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

function visibleButtons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter(isVisible);
}

function dialogWithText(text: string): Element | null {
  return (
    Array.from(document.querySelectorAll('[role="dialog"]')).find(
      (dialog) => isVisible(dialog) && dialog.textContent?.includes(text),
    ) ?? null
  );
}

export function findMatchingSlot(config: ReservationConfig): TimeSlot | null {
  const start = parseTimeInput(config.startTime);
  const end = parseTimeInput(config.endTime);
  if (start === null || end === null || start > end) return null;

  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>("main button[aria-disabled]")).filter(
    (button) =>
      isVisible(button) &&
      button.getAttribute("aria-disabled") === "false" &&
      button.dataset.busy === "false",
  );

  for (const button of candidates) {
    const label = button.textContent?.trim() ?? "";
    const minutes = parseKoreanTime(label);
    if (minutes !== null && minutes >= start && minutes <= end) {
      return { button, minutes, label };
    }
  }
  return null;
}

export function findTableTypeDialog(preference: TableTypePreference): TableTypeDialog | null {
  if (preference === "none") return null;
  const dialog = dialogWithText("테이블 타입 선택");
  if (!dialog) return null;

  const label = tableLabels[preference];
  const option = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find(
    (input) => !input.disabled && input.closest("label")?.textContent?.includes(label),
  );
  const nextButton = visibleButtons(dialog).find((button) => button.textContent?.trim() === "다음");
  return option && nextButton ? { dialog, option, nextButton } : null;
}

export function hasTableTypeDialog(): boolean {
  return dialogWithText("테이블 타입 선택") !== null;
}

export function findDepositNotice(): DepositNotice | null {
  const dialog = dialogWithText("예약금 안내");
  if (!dialog) return null;
  const confirmButton = visibleButtons(dialog).find((button) => button.textContent?.trim() === "확인");
  return confirmButton ? { dialog, confirmButton } : null;
}

export function isUserHandoffScreen(): boolean {
  const finalButton = visibleButtons(document).some(
    (button) => button.textContent?.trim() === "자동결제로 예약하기",
  );
  const agreement = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).some(
    (input) => isVisible(input) && /약관|동의/.test(input.closest("label")?.textContent ?? ""),
  );
  return finalButton || agreement;
}

export function pageMatchesConfig(config: ReservationConfig): boolean {
  const target = new URL(config.targetUrl);
  const current = new URL(location.href);
  return target.origin === current.origin && target.pathname === current.pathname;
}

export function selectionMatchesConfig(config: ReservationConfig): boolean {
  const current = new URL(location.href);
  const compactDate = config.date.match(/^\d{4}-\d{2}-\d{2}$/)
    ? config.date.slice(2).replaceAll("-", "")
    : "";
  const urlDate = current.searchParams.get("date");
  const urlPersonCount = current.searchParams.get("personCount");
  if (urlDate !== null && urlDate !== compactDate) return false;
  if (urlPersonCount !== null && Number(urlPersonCount) !== config.personCount) return false;

  if (urlDate !== null && urlPersonCount !== null) return true;
  const [year, month, day] = config.date.split("-");
  if (!year || !month || !day) return false;
  const expected = `${month}.${day}`;
  return visibleButtons(document).some((button) => {
    const label = button.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return label.includes(expected) && label.includes(`${config.personCount}명`);
  });
}
