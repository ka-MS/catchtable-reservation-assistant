import assert from "node:assert/strict";
import test from "node:test";
import { stageSnapshotData } from "../dist/content/orchestrator.js";

const snap = {
  urlKind: "shop", headings: ["레스토랑"], buttons: ["확인", "취소"], disabledButtons: [false, true],
  disabledButtonCount: 1, dialogLabel: "", dialogTitle: "", textSnippet: "추가 확인이 필요합니다", fingerprint: "ss-12345678",
};

test("flattens a snapshot into event data", () => {
  const d = stageSnapshotData(snap);
  assert.equal(d.snapshotUrlKind, "shop");
  assert.equal(d.snapshotButtons, "확인 | 취소");
  assert.equal(d.snapshotHeadings, "레스토랑");
  assert.equal(d.snapshotDisabledButtonCount, 1);
  assert.equal(d.snapshotTextSnippet, "추가 확인이 필요합니다");
  assert.equal(d.snapshotFingerprint, "ss-12345678");
});

test("returns empty object for null snapshot", () => {
  assert.deepEqual(stageSnapshotData(null), {});
});
