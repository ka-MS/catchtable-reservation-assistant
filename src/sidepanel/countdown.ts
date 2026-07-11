export interface CountdownInput {
  nowMs: number;
  openAtMs: number | null;
  offsetMs: number | null;
  /** 오픈 이후 진행 중인 실행 단계 배지. 없으면 null. */
  activeStage: string | null;
}

export interface CountdownModel {
  visible: boolean;
  mode: "countdown" | "stage" | "elapsed";
  text: string;
  detail: string;
  urgent: boolean;
}

const HIDDEN: CountdownModel = { visible: false, mode: "countdown", text: "", detail: "", urgent: false };

function formatDuration(totalMs: number): string {
  const totalSeconds = Math.floor(totalMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}일 ${clock}` : clock;
}

export function countdownModel(input: CountdownInput): CountdownModel {
  if (input.openAtMs === null) return HIDDEN;
  const serverNow = input.nowMs + (input.offsetMs ?? 0);
  const remainingMs = input.openAtMs - serverNow;
  if (remainingMs <= 0 && input.activeStage) {
    return { visible: true, mode: "stage", text: input.activeStage, detail: "", urgent: false };
  }
  const detail = input.offsetMs === null ? "로컬 시계 기준" : "서버 시계 기준";
  if (remainingMs > 0) {
    return {
      visible: true,
      mode: "countdown",
      text: `오픈까지 ${formatDuration(remainingMs)}`,
      detail,
      urgent: remainingMs < 60_000,
    };
  }
  return {
    visible: true,
    mode: "elapsed",
    text: `오픈 경과 +${formatDuration(-remainingMs)}`,
    detail,
    urgent: false,
  };
}
