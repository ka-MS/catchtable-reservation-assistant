import assert from "node:assert/strict";
import test from "node:test";
import { formatEventDetail, formatEventMessage, formatEventTime } from "../dist/sidepanel/event-format.js";

test("event timestamps include milliseconds", () => {
  const timestamp = new Date(2026, 6, 10, 13, 0, 0, 123).getTime();
  assert.match(formatEventTime(timestamp), /^\d{2}:\d{2}:\d{2}\.123$/);
});

test("time selection shows server time and signed opening delta", () => {
  const serverAt = new Date(2026, 6, 10, 13, 0, 0, 120).getTime();
  const message = formatEventMessage({
    at: serverAt - 5,
    serverAt,
    runId: "run-1",
    kind: "action",
    message: "오후 7:30 시간 선택을 완료했습니다.",
    data: { openDeltaMs: 120 },
  });

  assert.match(message, /시간 선택을 완료했습니다\./);
  assert.match(message, /서버 \d{2}:\d{2}:\d{2}\.120 \(\+120ms\)/);
});

test("opening delta keeps a negative sign", () => {
  const event = {
    at: 1_000,
    serverAt: 1_000,
    runId: "run-2",
    kind: "action",
    message: "오후 7:30 시간 선택을 완료했습니다.",
    data: { openDeltaMs: -35 },
  };
  assert.match(formatEventMessage(event), /\(-35ms\)/);
});

test("a measured server timestamp can differ from the later event time", () => {
  const arrivalAt = new Date(2026, 6, 11, 13, 0, 1, 250).getTime();
  const message = formatEventMessage({
    at: arrivalAt + 1_500,
    serverAt: arrivalAt + 1_500,
    runId: "run-form",
    kind: "state",
    message: "예약 폼에 도착했습니다.",
    data: { openDeltaMs: 1_250, timingServerAtMs: arrivalAt },
  });

  assert.match(message, /서버 \d{2}:\d{2}:\d{2}\.250 \(\+1250ms\)/);
});

test("date timing detail shows opening delta and schedule drift", () => {
  const serverAt = new Date(2026, 6, 11, 20, 9, 0, 4).getTime();
  const detail = formatEventDetail({
    at: serverAt,
    serverAt,
    runId: "run-date",
    kind: "action",
    message: "목표 날짜를 클릭했습니다.",
    data: {
      timingStage: "slot_detected",
      timingServerAtMs: serverAt,
      openDeltaMs: 4,
      adjacentTimingServerAtMs: serverAt - 44,
      adjacentOpenDeltaMs: -40,
      adjacentScheduleDriftMs: 0,
      targetTimingServerAtMs: serverAt - 4,
      targetOpenDeltaMs: 0,
      targetScheduleDriftMs: 4,
    },
  });

  assert.match(detail, /인접 서버 \d{2}:\d{2}:\d{2}\.960 · 오픈 -40ms · 계획 \+0ms/);
  assert.match(detail, /목표 서버 \d{2}:\d{2}:\d{2}\.000 · 오픈 \+0ms · 계획 \+4ms/);
  assert.match(detail, /감지 서버 \d{2}:\d{2}:\d{2}\.004 · 오픈 \+4ms/);
});

test("unknown post-slot diagnostics are visible in the event message", () => {
  const message = formatEventMessage({
    at: Date.now(),
    serverAt: null,
    runId: "run-unknown",
    kind: "state",
    message: "새로운 예약 단계 화면은 자동 진행하지 않습니다.",
    data: {
      postSlotCertainty: "unknown",
      dialogTitle: "고객 요청 확인",
      dialogButtons: "이전 | 계속",
      dialogRadioCount: 0,
      dialogCheckboxCount: 1,
      dialogQuantityControlCount: 0,
    },
  });

  assert.match(message, /진단: 고객 요청 확인/);
  assert.match(message, /버튼 이전 \| 계속/);
  assert.match(message, /radio 0 · checkbox 1 · quantity 0/);
});
