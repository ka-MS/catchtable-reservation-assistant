import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { PostSlotAdapter } from "../dist/content/adapter/post-slot.js";

function documentFor(body, url = "https://app.catchtable.co.kr/ct/shop/taeo") {
  return new JSDOM(`<!doctype html><body>${body}</body>`, { url }).window.document;
}

function wireChoice(document, selector) {
  for (const choice of document.querySelectorAll(selector)) {
    choice.addEventListener("click", () => {
      for (const peer of document.querySelectorAll(selector)) peer.setAttribute("aria-checked", "false");
      choice.setAttribute("aria-checked", "true");
      document.querySelector("button[data-next]").disabled = false;
    });
  }
}

test("table type uses the configured option and advances", () => {
  // Live DOM measured 2026-07-10: role=dialog/radiogroup/radio and aria-checked.
  const document = documentFor(`
    <div role="dialog" aria-label="테이블 타입 선택">
      <div role="radiogroup" aria-label="테이블 타입">
        <label role="radio" aria-label="홀" aria-checked="false" aria-disabled="false">홀</label>
        <label role="radio" aria-label="바" aria-checked="false" aria-disabled="false">바</label>
      </div>
      <button data-next disabled>다음</button>
    </div>
  `);
  wireChoice(document, '[role="radio"]');
  let nextClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.deepEqual(inspection, { kind: "table_type", options: ["홀", "바"] });
  assert.equal(adapter.advance(inspection, { tablePreference: "bar", menuKeyword: "" }).status, "acted");
  assert.equal(document.querySelector('[aria-label="바"]').getAttribute("aria-checked"), "true");
  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "bar", menuKeyword: "" }).status, "acted");
  assert.equal(nextClicks, 1);
});

test("any table type selects the first enabled option and a missing preference blocks", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="테이블 타입 선택">
      <label role="radio" aria-label="홀" aria-checked="false" aria-disabled="true">홀</label>
      <label role="radio" aria-label="바" aria-checked="false" aria-disabled="false">바</label>
      <button data-next disabled>다음</button>
    </div>
  `);
  wireChoice(document, '[role="radio"]');
  const adapter = new PostSlotAdapter(document);
  const inspection = adapter.inspect();

  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(document.querySelector('[aria-label="바"]').getAttribute("aria-checked"), "true");

  const blockedDocument = documentFor(document.body.innerHTML);
  const blocked = new PostSlotAdapter(blockedDocument);
  assert.equal(blocked.advance(blocked.inspect(), { tablePreference: "room", menuKeyword: "" }).status, "blocked");
});

test("menu selection matches a keyword before advancing", () => {
  // Live DOM measured 2026-07-10 at sushi_sujung: checkbox buttons inside the menu dialog.
  const document = documentFor(`
    <div role="dialog" aria-label="메뉴 선택">
      <button role="checkbox" aria-label="디너 오마카세" aria-checked="false"></button>
      <button role="checkbox" aria-label="디너 오마카세 사케 페어링 코스" aria-checked="false"></button>
      <button data-next disabled>다음</button>
    </div>
  `, "https://app.catchtable.co.kr/ct/shop/sushi_sujung");
  wireChoice(document, '[role="checkbox"]');
  let nextClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.deepEqual(inspection, {
    kind: "menu",
    options: ["디너 오마카세", "디너 오마카세 사케 페어링 코스"],
  });
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "사케" }).status, "acted");
  assert.equal(document.querySelector('[aria-label*="사케"]').getAttribute("aria-checked"), "true");
  const completion = adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "사케" });
  assert.equal(completion.completed, true);
  assert.equal(nextClicks, 1);
});

test("deposit-free flow advances but a paid-only dialog blocks", () => {
  // Live DOM measured 2026-07-10: native radio inputs with stable aria-label values.
  const document = documentFor(`
    <div role="dialog" aria-label="예약금 결제 방법 선택">
      <input type="radio" aria-label="예약금 0원 결제" checked>
      <input type="radio" aria-label="예약금 결제">
      <button data-next>다음</button>
    </div>
  `);
  let nextClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(nextClicks, 1);

  const paidOnly = new PostSlotAdapter(documentFor(`
    <div role="dialog" aria-label="예약금 결제 방법 선택">
      <input type="radio" aria-label="예약금 결제" checked>
      <button data-next>다음</button>
    </div>
  `));
  assert.equal(paidOnly.advance(paidOnly.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "blocked");
});

test("reservation form and unknown dialogs are distinguished", () => {
  const form = new PostSlotAdapter(documentFor("<main></main>", "https://app.catchtable.co.kr/ct/reservation/form?isDepositFree=1"));
  assert.deepEqual(form.inspect(), { kind: "form" });

  const unknown = new PostSlotAdapter(documentFor('<div role="dialog" aria-label="알 수 없는 단계"></div>'));
  assert.deepEqual(unknown.inspect(), { kind: "unknown", label: "알 수 없는 단계" });
});
