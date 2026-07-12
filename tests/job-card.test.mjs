import assert from "node:assert/strict";
import test from "node:test";
import { jobCardModel } from "../dist/sidepanel/job-card.js";

const OPEN = Date.UTC(2026, 7, 1, 1, 0, 0); // 로컬 포맷 검증은 상대 시간만 사용

function job(overrides = {}) {
  return {
    id: "job-1",
    createdAt: 1,
    updatedAt: 1,
    status: "scheduled",
    config: {
      targetUrl: "https://app.catchtable.co.kr/ct/shop/sushi-koji",
      openAtMs: OPEN,
      reservationDate: "2026-08-15",
      personCount: 2,
      timeRange: { startMinutes: 1080, endMinutes: 1200 },
      priorityTimes: [],
      postSlotEnabled: false,
      tablePreference: "any",
      menuKeyword: "",
      stopAtMs: OPEN + 600_000,
      entryMode: "auto",
      dryRun: false,
      preOpenLeadMs: 3_000,
      toggleIntervalMs: 150,
      clockSampleCount: 9,
    },
    result: null,
    ...overrides,
  };
}

test("scheduled job shows shop slug, summary, and remaining time", () => {
  const model = jobCardModel(job(), OPEN - 90_061_000); // 1일 1시간 1분 1초 전
  assert.equal(model.title, "sushi-koji");
  assert.equal(model.summary, "8월 15일 · 2명 · 18:00–20:00");
  assert.equal(model.statusLabel, "예정");
  assert.equal(model.statusTone, "scheduled");
  assert.equal(model.detail, "오픈까지 1일 1시간");
  assert.equal(model.canEdit, true);
  assert.equal(model.canDelete, true);
  assert.equal(model.showLog, false);
  assert.match(model.createdAtText, /^등록 \d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
});

test("imminent job shows minutes", () => {
  assert.equal(jobCardModel(job(), OPEN - 300_000).detail, "오픈까지 5분");
  assert.equal(jobCardModel(job(), OPEN - 30_000).detail, "곧 오픈");
});

test("running job exposes the log action and blocks edits", () => {
  const model = jobCardModel(job({ status: "running" }), OPEN);
  assert.equal(model.statusLabel, "실행 중");
  assert.equal(model.statusTone, "running");
  assert.equal(model.canEdit, false);
  assert.equal(model.canDelete, false);
  assert.equal(model.showLog, true);
});

test("finished job maps result state to label and tone", () => {
  const handedOff = jobCardModel(job({
    status: "finished",
    result: { state: "HANDED_OFF", message: "예약 폼에 도착했습니다.", finishedAt: OPEN + 1_000 },
  }), OPEN + 2_000);
  assert.equal(handedOff.statusLabel, "완료");
  assert.equal(handedOff.statusTone, "success");
  assert.equal(handedOff.detail, "예약 폼에 도착했습니다.");
  const failed = jobCardModel(job({
    status: "finished",
    result: { state: "FAILED", message: "탭 생성 실패", finishedAt: OPEN + 1_000 },
  }), OPEN + 2_000);
  assert.equal(failed.statusLabel, "실패");
  assert.equal(failed.statusTone, "error");
});

test("missed job explains the miss", () => {
  const model = jobCardModel(job({ status: "missed" }), OPEN + 2_000);
  assert.equal(model.statusLabel, "놓침");
  assert.equal(model.statusTone, "missed");
  assert.equal(model.detail, "실행 시각을 놓쳤습니다.");
});
