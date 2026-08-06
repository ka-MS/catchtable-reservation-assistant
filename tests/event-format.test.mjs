import assert from "node:assert/strict";
import test from "node:test";
import { formatEventDetail, formatEventMessage, formatEventTime } from "../dist/sidepanel/event-format.js";

test("event timestamps include milliseconds", () => {
  const timestamp = new Date(2026, 6, 10, 13, 0, 0, 123).getTime();
  assert.match(formatEventTime(timestamp), /^\d{2}:\d{2}:\d{2}\.123$/);
});

test("slot click dispatch shows server time and signed opening delta", () => {
  const serverAt = new Date(2026, 6, 10, 13, 0, 0, 120).getTime();
  const message = formatEventMessage({
    at: serverAt - 5,
    serverAt,
    runId: "run-1",
    kind: "action",
    message: "오후 7:30 슬롯 클릭을 전달했습니다.",
    data: { openDeltaMs: 120 },
  });

  assert.match(message, /슬롯 클릭을 전달했습니다\./);
  assert.match(message, /서버 \d{2}:\d{2}:\d{2}\.120 \(\+120ms\)/);
});

test("opening delta keeps a negative sign", () => {
  const event = {
    at: 1_000,
    serverAt: 1_000,
    runId: "run-2",
    kind: "action",
    message: "오후 7:30 슬롯 클릭을 전달했습니다.",
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

test("renders a stage snapshot line", () => {
  const line = formatEventDetail({
    at: 0, serverAt: null, runId: "r", kind: "state", message: "인계",
    data: { state: "HANDED_OFF", snapshotFingerprint: "ss-1", snapshotDialogTitle: "",
      snapshotButtons: "확인 | 취소", snapshotTextSnippet: "추가 확인이 필요합니다 어쩌구 저쩌구" },
  });
  assert.match(line, /스냅샷/);
  assert.match(line, /확인 \| 취소/);
  assert.match(line, /추가 확인이 필요합니다/);
});

test("dialog가 없는 예약 폼 스냅샷은 heading을 제목으로 쓰고 폼 판정을 분해해 보여준다", () => {
  const line = formatEventDetail({
    at: 0, serverAt: null, runId: "r", kind: "state", message: "인계",
    data: {
      state: "HANDED_OFF", snapshotFingerprint: "ss-1", snapshotDialogTitle: "", snapshotDialogLabel: "",
      snapshotHeadings: "스시 호시카이", snapshotButtons: "닫기 | 예약하기",
      snapshotTextSnippet: "09월 08일(화) · 오후 18:30 · 2명",
      formUnknownCode: "intent_mismatch",
      formShopNameMatch: true, formDateMatch: false, formPersonMatch: true,
      formFinalButtonCount: 1, formAmounts: "0",
    },
  });
  assert.doesNotMatch(line, /제목 없음/);
  assert.match(line, /스냅샷: 스시 호시카이/);
  assert.match(line, /폼 판정\(intent_mismatch\)/);
  assert.match(line, /매장 일치 · 날짜 불일치 · 인원 일치/);
  assert.match(line, /최종버튼 1개/);
});
