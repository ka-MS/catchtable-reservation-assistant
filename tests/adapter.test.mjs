import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  findDepositNotice,
  findMatchingSlot,
  findTableTypeDialog,
  hasTableTypeDialog,
  isUserHandoffScreen,
  parseKoreanTime,
  selectionMatchesConfig,
} from "../dist/content/adapter.js";
import { ReservationEngine } from "../dist/content/engine.js";

function installDom(html, url = "https://app.catchtable.co.kr/ct/shop/kea") {
  const dom = new JSDOM(html, { url });
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.window = dom.window;
  globalThis.MutationObserver = dom.window.MutationObserver;
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
  return dom;
}

const config = {
  targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
  date: "2026-07-30",
  personCount: 2,
  startTime: "12:00",
  endTime: "13:30",
  tableTypePreference: "hall",
};

test("Korean time labels are converted to minutes", () => {
  assert.equal(parseKoreanTime("오후 12:00"), 720);
  assert.equal(parseKoreanTime("오후 1:30"), 810);
  assert.equal(parseKoreanTime("오전 12:15"), 15);
});

test("only visible, available matching slots are selected", () => {
  installDom(`
    <button>07.30 (목) · 2명</button>
    <main>
      <button aria-disabled="false" data-busy="false">오후 12:00</button>
      <button aria-disabled="true" data-busy="false">오후 12:30</button>
      <button aria-disabled="false" data-busy="true">오후 1:00</button>
    </main>`);
  assert.equal(findMatchingSlot(config)?.label, "오후 12:00");
  assert.equal(selectionMatchesConfig(config), true);
});

test("Catchtable URL date and person count must match the configuration", () => {
  installDom(
    "<main></main>",
    "https://app.catchtable.co.kr/ct/shop/kea?date=260730&personCount=2",
  );
  assert.equal(selectionMatchesConfig(config), true);
  globalThis.location = new URL("https://app.catchtable.co.kr/ct/shop/kea?date=260731&personCount=2");
  assert.equal(selectionMatchesConfig(config), false);
});

test("table selection and deposit notice are independently detected", () => {
  installDom(`
    <div role="dialog"><h2>테이블 타입 선택</h2><label><input type="radio" />홀</label><button>다음</button></div>
    <div role="dialog"><h2>예약금 안내</h2><button>확인</button></div>`);
  assert.equal(hasTableTypeDialog(), true);
  assert.ok(findTableTypeDialog("hall"));
  assert.ok(findDepositNotice());
});

test("final booking UI is a user handoff", () => {
  installDom('<button>자동결제로 예약하기</button>');
  assert.equal(isUserHandoffScreen(), true);
});

test("engine clicks one matching slot only once before verification", async () => {
  installDom(
    '<main><button aria-disabled="false" data-busy="false">오후 12:00</button></main>',
    "https://app.catchtable.co.kr/ct/shop/kea?date=260730&personCount=2",
  );
  const events = [];
  globalThis.chrome = { runtime: { sendMessage: (event) => { events.push(event); return Promise.resolve(); } } };
  const button = document.querySelector("button");
  let clicks = 0;
  button.addEventListener("click", () => { clicks += 1; });

  const engine = new ReservationEngine();
  engine.start(config);
  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.stop(false);

  assert.equal(clicks, 1);
  assert.equal(events.filter((event) => event.state === "VERIFYING_NEXT").length >= 1, true);
});

test("manifest content script is bundled without module imports", () => {
  const code = readFileSync(new URL("../dist/content/index.js", import.meta.url), "utf8");
  assert.equal(/\bimport\s*(?:["'{*])/.test(code), false);
  assert.match(code, /chrome\.runtime\.onMessage/);
});
