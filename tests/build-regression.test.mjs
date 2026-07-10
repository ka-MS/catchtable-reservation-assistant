import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest uses MV3 and on-demand content injection", async () => {
  const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal("content_scripts" in manifest, false);
  assert.deepEqual(manifest.host_permissions, ["https://app.catchtable.co.kr/*"]);
});

test("content script is an import-free IIFE bundle", async () => {
  const content = await readFile("dist/content/index.js", "utf8");
  assert.doesNotMatch(content, /^\s*import\s/m);
  assert.match(content, /__ctReserveInjected/);
  assert.doesNotMatch(content, /자동결제로 예약하기|예약금 안내|테이블 타입 선택/);
});
