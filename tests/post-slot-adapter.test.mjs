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
  adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "사케" });
  assert.equal(nextClicks, 1);
});

test("menu selection waits for a confirm button to become enabled", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="메뉴 선택">
      <button role="checkbox" aria-label="디너 오마카세" aria-checked="false"></button>
      <button data-next disabled>확인</button>
    </div>
  `);
  const choice = document.querySelector('[role="checkbox"]');
  choice.addEventListener("click", () => choice.setAttribute("aria-checked", "true"));
  const confirm = document.querySelector("button[data-next]");
  let confirmClicks = 0;
  confirm.addEventListener("click", () => { confirmClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "waiting");
  confirm.disabled = false;
  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(confirmClicks, 1);
});

test("latest extra-products dialog wins over a stale table dialog and skips products", () => {
  // Live DOM measured 2026-07-10 at haokaostan: optional products plus Previous/Next buttons.
  const document = documentFor(`
    <div role="dialog" aria-label="테이블 타입 선택">
      <label role="radio" aria-label="홀" aria-checked="true">홀</label>
      <button>다음</button>
    </div>
    <div role="dialog" aria-label="추가 상품">
      <button data-product>+</button>
      <button>이전</button>
      <button data-next>다음</button>
    </div>
  `);
  let productClicks = 0;
  let nextClicks = 0;
  document.querySelector("button[data-product]").addEventListener("click", () => { productClicks += 1; });
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  assert.deepEqual(adapter.inspect(), { kind: "extras" });
  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(productClicks, 0);
  assert.equal(nextClicks, 1);
});

test("table dialog with every radio transition-disabled waits instead of blocking", () => {
  // Live DOM measured 2026-07-11 at haokaostan: after clicking 다음, every radio gains
  // aria-disabled="true" (~65ms) while the dialog stays rendered until removal (~193ms).
  const document = documentFor(`
    <div role="dialog" aria-label="테이블 타입 선택">
      <label role="radio" aria-label="오리엔탈 숯불구이" aria-checked="true" aria-disabled="true">오리엔탈 숯불구이</label>
      <label role="radio" aria-label="2층 vip룸" aria-checked="false" aria-disabled="true">2층 vip룸</label>
      <button>다음</button>
    </div>
  `);
  const adapter = new PostSlotAdapter(document);

  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "waiting");
  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "room", menuKeyword: "" }).status, "waiting");
});

test("menu dialog with every checkbox transition-disabled waits instead of blocking", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="메뉴 선택">
      <button role="checkbox" aria-label="디너 오마카세" aria-checked="true" disabled></button>
      <button data-next>다음</button>
    </div>
  `);
  const adapter = new PostSlotAdapter(document);

  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "waiting");
});

test("deposit method with a transition-disabled free radio waits instead of blocking", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="예약금 결제 방법 선택">
      <input type="radio" aria-label="예약금 0원 결제" disabled>
      <button data-next>다음</button>
    </div>
  `);
  const adapter = new PostSlotAdapter(document);

  assert.equal(adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "" }).status, "waiting");
});

test("deposit notice dialog advances with the confirm button", () => {
  // Live DOM measured 2026-07-11 at haokaostan: aria-label="예약금 안내" with enabled 이전/확인 buttons.
  const document = documentFor(`
    <div role="dialog" aria-modal="true" aria-label="예약금 안내">
      <p>인원에 따른 예약 보증금이 발생합니다.</p>
      <button>이전</button>
      <button>확인</button>
    </div>
  `);
  let prevClicks = 0;
  let confirmClicks = 0;
  const [prev, confirm] = document.querySelectorAll("button");
  prev.addEventListener("click", () => { prevClicks += 1; });
  confirm.addEventListener("click", () => { confirmClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.deepEqual(inspection, { kind: "deposit_notice" });
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(confirmClicks, 1);
  assert.equal(prevClicks, 0);
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
