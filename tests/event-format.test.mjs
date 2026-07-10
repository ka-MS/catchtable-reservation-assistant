import assert from "node:assert/strict";
import test from "node:test";
import { formatEventMessage, formatEventTime } from "../dist/sidepanel/event-format.js";

test("event timestamps include milliseconds", () => {
  const timestamp = new Date(2026, 6, 10, 13, 0, 0, 123).getTime();
  assert.match(formatEventTime(timestamp), /^\d{2}:\d{2}:\d{2}\.123$/);
});

test("menu completion shows server time and signed opening delta", () => {
  const serverAt = new Date(2026, 6, 10, 13, 0, 0, 120).getTime();
  const message = formatEventMessage({
    at: serverAt - 5,
    serverAt,
    runId: "run-1",
    kind: "action",
    message: "메뉴 선택을 완료했습니다.",
    data: { openDeltaMs: 120 },
  });

  assert.match(message, /메뉴 선택을 완료했습니다\./);
  assert.match(message, /서버 \d{2}:\d{2}:\d{2}\.120 \(\+120ms\)/);
});

test("opening delta keeps a negative sign", () => {
  const event = {
    at: 1_000,
    serverAt: 1_000,
    runId: "run-2",
    kind: "action",
    message: "메뉴 선택을 완료했습니다.",
    data: { openDeltaMs: -35 },
  };
  assert.match(formatEventMessage(event), /\(-35ms\)/);
});
