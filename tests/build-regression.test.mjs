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

test("advanced settings expose only effective timing controls", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="pre-open-lead"[^>]*step="50"/);
  assert.match(html, /오픈 전에 날짜 갱신 루프/);
  assert.match(html, /목표 날짜 재클릭 주기/);
  assert.match(html, /name="availability-probe-mode"/);
  assert.match(html, /value="off"[^>]*checked/);
  assert.match(html, /value="observe"/);
  assert.match(html, /value="empty_exit"/);
  assert.doesNotMatch(html, /id="availability-probe-enabled"/);
  assert.match(html, /실오픈 성능 측정용 실험 기능/);
  assert.doesNotMatch(html, /id="clock-samples"/);
  assert.doesNotMatch(html, /서버 시계 측정 횟수/);
});

test("sidepanel includes history and favorites controls", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="saved-configs"/);
  assert.match(html, /data-saved-list="history"/);
  assert.match(html, /data-saved-list="favorites"/);
  assert.match(html, /data-saved-action="save-favorite"/);
  assert.match(html, /data-saved-action="clear"/);
});

test("sidepanel includes persistent run trace controls", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="trace-run-select"/);
  assert.match(html, /id="trace-run-export"/);
  assert.match(html, /id="trace-run-diagnostic"/);
  assert.match(html, /id="trace-run-delete"/);
  assert.match(html, /id="trace-event-list"/);
});

test("post-slot automation is opt-in in the sidepanel", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="post-slot-enabled" type="checkbox"/);
  assert.doesNotMatch(html, /id="post-slot-enabled"[^>]*checked/);
  assert.match(html, /id="table-preference" disabled/);
  assert.match(html, /id="menu-keyword"[^>]*disabled/);
  assert.match(html, /id="payment-method-auto-advance"[^>]*checked[^>]*disabled/);
  assert.match(html, /name="payment-method-policy"[^>]*value="zero_only"/);
  assert.match(html, /name="payment-method-policy"[^>]*value="selected_allowed"[^>]*checked/);
});

test("dry-run is disabled by default in the sidepanel", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="dry-run" type="checkbox"/);
  assert.doesNotMatch(html, /id="dry-run"[^>]*checked/);
});

test("reservation completion opt-in, cap and shared default answer exist and are off by default", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="reservation-completion-enabled" type="checkbox"/);
  assert.doesNotMatch(html, /id="reservation-completion-enabled"[^>]*checked/);
  assert.match(html, /id="max-payment-amount-krw"[^>]*min="0"[^>]*max="500000"/);
  assert.match(html, /id="required-form-default-answer"/);
});

test("one-shot CatchPay PIN input is a disposable password field separate from the persistent form", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  assert.match(html, /id="catchpay-pin"[^>]*type="password"/);
  assert.match(html, /id="catchpay-pin"[^>]*inputmode="numeric"/);
  assert.match(html, /id="catchpay-pin"[^>]*autocomplete="off"/);
});

test("dist bundles never contain a hardcoded PIN test sentinel", async () => {
  const files = [
    "dist/sidepanel/index.js",
    "dist/sidepanel/form-model.js",
    "dist/background/run-supervisor.js",
    "dist/background/index.js",
    "dist/content/index.js",
    "dist/shared/config.js",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /catchPayPin\s*[:=]\s*["'`]\d{4}["'`]/);
  }
});

test("terminal cleanup disposes the one-shot authorization before the async trace/diagnostic flush", async () => {
  const source = await readFile("dist/content/orchestrator.js", "utf8");
  const disposeIndex = source.indexOf("this.authorizationHandle.dispose();");
  const flushIndex = source.indexOf("await Promise.allSettled([");
  assert.ok(disposeIndex >= 0, "authorizationHandle.dispose() call not found");
  assert.ok(flushIndex >= 0, "terminal Promise.allSettled flush not found");
  assert.ok(disposeIndex < flushIndex, "dispose must run before the terminal async flush starts");
  // 우연한 순서 일치를 배제하기 위해 같은 finally 블록 안(합리적 거리)인지도 확인한다.
  assert.ok(flushIndex - disposeIndex < 800, "dispose and the terminal flush should belong to the same finally block");
});

test("OpenRunOrchestrator.start() discards the raw authorization parameter before awaiting session.execute()", async () => {
  const source = await readFile("dist/content/orchestrator.js", "utf8");
  const sessionIndex = source.indexOf("new RunSession(");
  const resetIndex = source.indexOf("authorization = undefined;");
  const awaitIndex = source.indexOf("return await session.execute();");
  assert.ok(sessionIndex >= 0, "RunSession construction not found");
  assert.ok(resetIndex >= 0, "authorization parameter reset (authorization = undefined;) not found");
  assert.ok(awaitIndex >= 0, "return await session.execute() not found");
  assert.ok(sessionIndex < resetIndex, "authorization must be reset only after constructing the session");
  assert.ok(resetIndex < awaitIndex, "authorization must be reset before awaiting session.execute()");
  // 우연한 순서 일치를 배제하기 위해 같은 start() 메서드 범위(합리적 거리) 안인지도 확인한다.
  assert.ok(awaitIndex - sessionIndex < 800, "session construction, the parameter reset and the await should be in the same start() method");
});
