import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { captureDiagnosticSnapshot } from "../dist/content/diagnostics/dom-snapshot.js";

function documentFor(html) {
  return new JSDOM(html, { url: "https://app.catchtable.co.kr/ct/shop/kea?token=secret#section", pretendToBeVisual: true }).window.document;
}

test("failure snapshot captures structure and emits a sanitized fragment", () => {
  const document = documentFor(`
    <main><h1>케아</h1></main>
    <div role="dialog" aria-label="날짜 선택">
      <h2>2026년 9월</h2>
      <p>연락처 010-1234-5678 test@example.com 4111 1111 1111 1111</p>
      <input type="text" value="민감값" oninput="steal()">
      <button aria-label="Next page">다음</button>
      <button data-busy="false">오후 6:00</button>
      <script>secret()</script>
    </div>
  `);
  const snapshot = captureDiagnosticSnapshot(document, {
    runId: "run-1",
    kind: "failure",
    stage: "SELECTING_DATE",
    trigger: "failure",
    reason: "목표 날짜를 찾을 수 없습니다.",
  }, () => "ss-1", () => 123);

  assert.equal(snapshot.snapshotId, "ss-1");
  assert.equal(snapshot.adapter, "CalendarAdapter");
  assert.equal(snapshot.environment.url, "https://app.catchtable.co.kr/ct/shop/kea");
  assert.equal(snapshot.surfaces[0].kind, "dialog");
  assert.equal(snapshot.queries.find((query) => query.name === "slotButtons").matchCount, 1);
  assert.equal(snapshot.slots.availableCount, 1);
  assert.ok(snapshot.fragmentHtml);
  assert.doesNotMatch(snapshot.fragmentHtml, /010-1234-5678|test@example\.com|4111 1111 1111 1111|민감값|oninput|script/i);
  assert.match(snapshot.fragmentHtml, /data-diagnostic-fragment="SELECTING_DATE"/);
});

test("breadcrumb snapshot remains structural and does not serialize HTML", () => {
  const document = documentFor(`<main><h1>예약</h1><button>예약하기</button></main>`);
  const snapshot = captureDiagnosticSnapshot(document, {
    runId: "run-2",
    kind: "breadcrumb",
    stage: "ENTERING_RESERVATION",
    trigger: "state",
    reason: "예약창 진입",
  }, () => "ss-2", () => 124);

  assert.equal(snapshot.fragmentHtml, undefined);
  assert.equal(snapshot.strategy, "dock-reservation-cta-v1");
  assert.equal(snapshot.buttons[0].text, "예약하기");
});

test("reservation form failures omit HTML fragments", () => {
  const document = new JSDOM(`<main><input value="사용자 입력"></main>`, {
    url: "https://app.catchtable.co.kr/ct/reservation/form?token=secret",
  }).window.document;
  const snapshot = captureDiagnosticSnapshot(document, {
    runId: "run-3",
    kind: "failure",
    stage: "ADVANCING_RESERVATION",
    trigger: "failure",
    reason: "폼 판별 실패",
  }, () => "ss-3", () => 125);

  assert.equal(snapshot.environment.urlKind, "reservation_form");
  assert.equal(snapshot.fragmentHtml, undefined);
});

test("failure fragments remain valid and bounded under large DOM input", () => {
  const rows = Array.from({ length: 2_000 }, (_, index) => `<p>행 ${index} ${"상세내용".repeat(20)}</p>`).join("");
  const document = documentFor(`<div role="dialog"><h2>대형 화면</h2>${rows}<button>확인</button></div>`);
  const snapshot = captureDiagnosticSnapshot(document, {
    runId: "run-large",
    kind: "failure",
    stage: "ADVANCING_RESERVATION",
    trigger: "failure",
    reason: "large",
  }, () => "ss-large", () => 126);
  const bytes = new TextEncoder().encode(snapshot.fragmentHtml ?? "");

  assert.ok(bytes.byteLength <= 64 * 1024);
  assert.match(snapshot.fragmentHtml ?? "", /<\/html>$/);
  assert.match(snapshot.fragmentHtml ?? "", /data-truncated="true"/);
});
