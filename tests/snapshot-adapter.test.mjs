import assert from "node:assert/strict";
import test from "node:test";
import { loadFixture } from "./fixture-helper.mjs";
import { captureStageSnapshot } from "../dist/content/adapter/snapshot.js";

test("captures an unknown dialog with empty label via text snippet, masking phone", async () => {
  const dom = await loadFixture("snapshot-unknown-dialog.html");
  const s = captureStageSnapshot(dom.window.document);
  assert.equal(s.urlKind, "shop");
  assert.equal(s.dialogLabel, "");
  assert.equal(s.dialogTitle, "");
  assert.match(s.textSnippet, /추가 확인이 필요합니다/);
  assert.doesNotMatch(s.textSnippet, /010-1234-5678/);
  assert.deepEqual(s.buttons, ["확인", "취소"]);
  assert.deepEqual(s.disabledButtons, [false, true]);
  assert.equal(s.disabledButtonCount, 1);
  assert.ok(s.fingerprint.startsWith("ss-"));
});

test("captures an unknown presentation sheet (not just the known request sheet)", async () => {
  const dom = await loadFixture("snapshot-presentation-sheet.html");
  const s = captureStageSnapshot(dom.window.document);
  assert.equal(s.dialogTitle, "알 수 없는 안내 시트");
  assert.match(s.textSnippet, /별도 승인 절차/);
  assert.doesNotMatch(s.textSnippet, /9876/);   // 점 구분 전화번호도 마스킹
  assert.deepEqual(s.buttons, ["신청"]);
});

test("masks phone numbers regardless of separator", async () => {
  const dom = await loadFixture("snapshot-unknown-dialog.html");
  const doc = dom.window.document;
  const p = doc.querySelector('[role="dialog"] p');
  for (const phone of ["01012345678", "010 1234 5678", "010.1234.5678"]) {
    p.textContent = `연락처 ${phone} 입니다.`;
    const s = captureStageSnapshot(doc);
    assert.doesNotMatch(s.textSnippet, /\d{4}/, `masked: ${phone}`);
  }
});

test("main fallback collects structure only, no snippet", async () => {
  const dom = await loadFixture("snapshot-no-dialog.html");
  const s = captureStageSnapshot(dom.window.document);
  assert.deepEqual(s.headings, ["예약 가능한 시간"]);
  assert.equal(s.textSnippet, "");
  assert.equal(s.dialogLabel, "");
});

test("caps headings and buttons at eight", async () => {
  const dom = await loadFixture("snapshot-no-dialog.html");
  const doc = dom.window.document;
  const main = doc.querySelector("main");
  for (let i = 0; i < 12; i += 1) {
    const b = doc.createElement("button");
    b.textContent = `b${i}`;
    main.append(b);
  }
  const s = captureStageSnapshot(doc);
  assert.equal(s.buttons.length, 8);
});

test("fingerprint ignores text snippet changes", async () => {
  const dom = await loadFixture("snapshot-unknown-dialog.html");
  const doc = dom.window.document;
  const first = captureStageSnapshot(doc).fingerprint;
  doc.querySelector('[role="dialog"] p').textContent = "완전히 다른 안내 문구입니다.";
  const second = captureStageSnapshot(doc).fingerprint;
  assert.equal(first, second);
});

test("fingerprint normalizes dynamic numbers", async () => {
  const dom = await loadFixture("snapshot-unknown-dialog.html");
  const doc = dom.window.document;
  const button = doc.querySelector('[role="dialog"] button');
  button.textContent = "50,000원 확인";
  const first = captureStageSnapshot(doc).fingerprint;
  button.textContent = "70,000원 확인";
  const second = captureStageSnapshot(doc).fingerprint;
  assert.equal(first, second);
});

test("CatchPay PIN surface compact snapshot은 keypad 순서와 입력 상태를 수집하지 않는다", async () => {
  const dom = await loadFixture("catchpay-pin.html");
  const doc = dom.window.document;
  const first = captureStageSnapshot(doc);
  const dialog = doc.querySelector('[role="dialog"]');
  const digitButtons = [...dialog.querySelectorAll("button")]
    .filter((button) => /^\d$/.test(button.textContent?.trim() ?? ""));
  digitButtons.reverse().forEach((button) => dialog.append(button));
  dialog.querySelector("h2").textContent = "보안 인증";
  dialog.removeAttribute("role");
  const second = captureStageSnapshot(doc);

  for (const snapshot of [first, second]) {
    assert.deepEqual(snapshot.headings, []);
    assert.deepEqual(snapshot.buttons, []);
    assert.deepEqual(snapshot.disabledButtons, []);
    assert.equal(snapshot.disabledButtonCount, 0);
    assert.equal(snapshot.dialogLabel, "credential_surface");
    assert.equal(snapshot.dialogTitle, "");
    assert.equal(snapshot.textSnippet, "");
  }
  assert.equal(first.fingerprint, second.fingerprint);
});
