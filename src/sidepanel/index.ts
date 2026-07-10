import type { Command, ReservationConfig, StatusEvent, TableTypePreference } from "../shared/types.js";

const form = document.querySelector<HTMLFormElement>("#reservation-form")!;
const status = document.querySelector<HTMLElement>("#status")!;
const lastAction = document.querySelector<HTMLElement>("#last-action")!;
const retryCount = document.querySelector<HTMLElement>("#retry-count")!;

const fields = {
  targetUrl: document.querySelector<HTMLInputElement>("#target-url")!,
  date: document.querySelector<HTMLInputElement>("#date")!,
  personCount: document.querySelector<HTMLInputElement>("#person-count")!,
  startTime: document.querySelector<HTMLInputElement>("#start-time")!,
  endTime: document.querySelector<HTMLInputElement>("#end-time")!,
  tableType: document.querySelector<HTMLSelectElement>("#table-type")!,
  stopAt: document.querySelector<HTMLInputElement>("#stop-at")!,
};

function readConfig(): ReservationConfig {
  const targetUrl = new URL(fields.targetUrl.value);
  if (targetUrl.origin !== "https://app.catchtable.co.kr" || !targetUrl.pathname.startsWith("/ct/shop/")) {
    throw new Error("캐치테이블 식당 예약 URL을 입력하세요.");
  }
  const personCount = Number(fields.personCount.value);
  if (!Number.isInteger(personCount) || personCount < 1) throw new Error("인원을 확인하세요.");
  if (fields.startTime.value > fields.endTime.value) throw new Error("종료 시간은 시작 시간 이후여야 합니다.");
  return {
    targetUrl: targetUrl.href,
    date: fields.date.value,
    personCount,
    startTime: fields.startTime.value,
    endTime: fields.endTime.value,
    tableTypePreference: fields.tableType.value as TableTypePreference,
    stopAt: fields.stopAt.value ? new Date(fields.stopAt.value).toISOString() : undefined,
  };
}

function showStatus(event: StatusEvent): void {
  status.textContent = event.state;
  lastAction.textContent = event.detail;
  retryCount.textContent = String(event.retryCount);
}

async function send(command: Command): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "PANEL_COMMAND", command });
  if (!response.ok) throw new Error(response.error);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const config = readConfig();
    await send({ type: "START", config });
    status.textContent = "ARMED";
    lastAction.textContent = "현재 탭에 감시 시작을 요청했습니다.";
  } catch (error) {
    status.textContent = "입력 오류";
    lastAction.textContent = error instanceof Error ? error.message : "감시를 시작할 수 없습니다.";
  }
});

document.querySelector<HTMLButtonElement>("#stop")!.addEventListener("click", async () => {
  try {
    await send({ type: "STOP" });
    status.textContent = "STOPPED";
    lastAction.textContent = "감시 중지 요청을 보냈습니다.";
  } catch (error) {
    status.textContent = "오류";
    lastAction.textContent = error instanceof Error ? error.message : "감시를 중지할 수 없습니다.";
  }
});

const stored = await chrome.storage.local.get(["reservationConfig", "lastStatus"]);
if (stored.reservationConfig) {
  const config = stored.reservationConfig as ReservationConfig;
  fields.targetUrl.value = config.targetUrl;
  fields.date.value = config.date;
  fields.personCount.value = String(config.personCount);
  fields.startTime.value = config.startTime;
  fields.endTime.value = config.endTime;
  fields.tableType.value = config.tableTypePreference;
  fields.stopAt.value = config.stopAt ? config.stopAt.slice(0, 16) : "";
}
if (stored.lastStatus) showStatus(stored.lastStatus as StatusEvent);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lastStatus?.newValue) showStatus(changes.lastStatus.newValue as StatusEvent);
});
