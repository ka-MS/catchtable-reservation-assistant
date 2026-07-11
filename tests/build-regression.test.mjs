import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest uses MV3 and on-demand content injection", async () => {
  const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal("content_scripts" in manifest, false);
  assert.deepEqual(manifest.host_permissions, ["https://app.catchtable.co.kr/*"]);
  assert.equal(manifest.icons["128"], "assets/icon-128.png");
  assert.equal(manifest.action.default_icon["128"], "assets/icon-128.png");
  const icon = await readFile("dist/assets/icon-128.png");
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("content script is an import-free IIFE bundle", async () => {
  const content = await readFile("dist/content/index.js", "utf8");
  assert.doesNotMatch(content, /^\s*import\s/m);
  assert.match(content, /__ctReserveInjected/);
  assert.doesNotMatch(content, /모두 동의합니다\.|자동결제로 예약하기/);
});

test("sidepanel exposes an explicit entry mode instead of pagePrepared", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="entry-mode"/);
  assert.match(html, /value="auto"/);
  assert.match(html, /value="prepared"/);
  assert.doesNotMatch(html, /id="page-prepared"/);
});

test("advanced settings explain their effect and allow fifty millisecond lead steps", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="pre-open-lead"[^>]*step="50"/);
  assert.match(html, /오픈 전에 날짜 갱신 루프/);
  assert.match(html, /목표 날짜 재클릭 주기/);
  assert.match(html, /서버 시계 측정 횟수/);
});

test("sidepanel includes history and favorites controls", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="saved-configs"/);
  assert.match(html, /data-saved-list="history"/);
  assert.match(html, /data-saved-list="favorites"/);
  assert.match(html, /data-saved-action="save-favorite"/);
  assert.match(html, /data-saved-action="clear"/);
});

test("post-slot automation is opt-in in the sidepanel", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="post-slot-enabled" type="checkbox"/);
  assert.doesNotMatch(html, /id="post-slot-enabled"[^>]*checked/);
  assert.match(html, /id="table-preference" disabled/);
  assert.match(html, /id="menu-keyword"[^>]*disabled/);
});

test("dry-run is disabled by default in the sidepanel", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="dry-run" type="checkbox"/);
  assert.doesNotMatch(html, /id="dry-run"[^>]*checked/);
});
