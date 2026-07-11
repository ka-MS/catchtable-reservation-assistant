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
  assert.doesNotMatch(content, /모두 동의합니다\.|자동결제로 예약하기|예약하기/);
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
