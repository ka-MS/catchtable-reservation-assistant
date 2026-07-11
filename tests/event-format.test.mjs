import assert from "node:assert/strict";
import test from "node:test";
import { formatEventMessage, formatEventTime } from "../dist/sidepanel/event-format.js";

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
