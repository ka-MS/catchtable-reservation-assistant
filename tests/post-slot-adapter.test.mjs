import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { PostSlotAdapter } from "../dist/content/adapter/post-slot.js";

function documentFor(body, url = "https://app.catchtable.co.kr/ct/shop/taeo") {
  return new JSDOM(`<!doctype html><body>${body}</body>`, { url }).window.document;
}

function fixture(name) {
  return readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
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
  assert.equal(inspection.kind, "table_type");
  assert.deepEqual(inspection.options, ["홀", "바"]);
  assert.equal(inspection.certainty, "exact");
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
  assert.equal(inspection.kind, "menu");
  assert.deepEqual(inspection.options, ["디너 오마카세", "디너 오마카세 사케 페어링 코스"]);
  assert.equal(inspection.certainty, "exact");
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

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "extras");
  assert.equal(inspection.certainty, "exact");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "acted");
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

// Live DOM measured 2026-07-11 at dotgabinugak: quantity menus expose
// input[type=number aria-label="<메뉴명> 수량"] with per-menu 수량 추가/감소 buttons.
// The progress button stays DOM-enabled even when the required quantity is unmet.
function quantityMenuDocument({ firstValue = 0, secondValue = 0 } = {}) {
  const document = documentFor(`
    <div role="dialog" aria-modal="true" aria-label="메뉴 선택">
      <button aria-label="한우맡김차림 수량 감소" ${firstValue === 0 ? "disabled" : ""}>-</button>
      <input type="number" aria-label="한우맡김차림 수량" value="${firstValue}">
      <button aria-label="한우맡김차림 수량 추가">+</button>
      <button aria-label="한우맡김차림(전통주페어링 포함) 수량 감소" ${secondValue === 0 ? "disabled" : ""}>-</button>
      <input type="number" aria-label="한우맡김차림(전통주페어링 포함) 수량" value="${secondValue}">
      <button aria-label="한우맡김차림(전통주페어링 포함) 수량 추가">+</button>
      <button>이전</button>
      <button data-next>확인</button>
    </div>
  `);
  for (const input of document.querySelectorAll('input[type="number"]')) {
    const name = input.getAttribute("aria-label").replace(/ ?수량$/, "");
    const plus = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === `${name} 수량 추가`);
    const minus = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === `${name} 수량 감소`);
    plus.addEventListener("click", () => {
      input.value = String(Number(input.value) + 1);
      minus.disabled = false;
    });
    minus.addEventListener("click", () => {
      input.value = String(Math.max(0, Number(input.value) - 1));
      if (input.value === "0") minus.disabled = true;
    });
  }
  return document;
}

test("quantity menu fills the person count one step at a time then confirms", () => {
  const document = quantityMenuDocument();
  let confirmClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { confirmClicks += 1; });
  const adapter = new PostSlotAdapter(document);
  const config = { tablePreference: "any", menuKeyword: "", personCount: 2 };

  assert.equal(adapter.advance(adapter.inspect(), config).status, "acted");
  assert.equal(document.querySelector('[aria-label="한우맡김차림 수량"]').value, "1");
  assert.equal(adapter.advance(adapter.inspect(), config).status, "acted");
  assert.equal(document.querySelector('[aria-label="한우맡김차림 수량"]').value, "2");
  assert.equal(confirmClicks, 0);
  assert.equal(adapter.advance(adapter.inspect(), config).status, "acted");
  assert.equal(confirmClicks, 1);
  assert.equal(document.querySelector('[aria-label*="전통주페어링"][aria-label$="수량"]').value, "0");
});

test("quantity menu honors the menu keyword", () => {
  const document = quantityMenuDocument();
  const adapter = new PostSlotAdapter(document);
  const config = { tablePreference: "any", menuKeyword: "전통주", personCount: 1 };

  assert.equal(adapter.advance(adapter.inspect(), config).status, "acted");
  assert.equal(document.querySelector('[aria-label="한우맡김차림(전통주페어링 포함) 수량"]').value, "1");
  assert.equal(document.querySelector('[aria-label="한우맡김차림 수량"]').value, "0");
});

test("a hidden stale checkbox does not mask visible quantity controls", () => {
  const document = quantityMenuDocument();
  document.querySelector('[role="dialog"]').insertAdjacentHTML(
    "afterbegin",
    '<button role="checkbox" aria-label="이전 메뉴" hidden></button>',
  );
  const adapter = new PostSlotAdapter(document);

  const result = adapter.advance(
    adapter.inspect(),
    { tablePreference: "any", menuKeyword: "", personCount: 1 },
  );

  assert.equal(result.status, "acted");
  assert.equal(document.querySelector('[aria-label="한우맡김차림 수량"]').value, "1");
});

test("quantity menu clears another menu's quantity before filling the target", () => {
  const document = quantityMenuDocument({ secondValue: 1 });
  const adapter = new PostSlotAdapter(document);
  const config = { tablePreference: "any", menuKeyword: "", personCount: 1 };

  assert.equal(adapter.advance(adapter.inspect(), config).status, "acted");
  assert.equal(document.querySelector('[aria-label="한우맡김차림(전통주페어링 포함) 수량"]').value, "0");
  assert.equal(adapter.advance(adapter.inspect(), config).status, "acted");
  assert.equal(document.querySelector('[aria-label="한우맡김차림 수량"]').value, "1");
});

test("quantity menu blocks when the add button cannot reach the person count", () => {
  const document = quantityMenuDocument();
  document.querySelector('[aria-label="한우맡김차림 수량 추가"]').disabled = true;
  const adapter = new PostSlotAdapter(document);

  const result = adapter.advance(adapter.inspect(), { tablePreference: "any", menuKeyword: "", personCount: 2 });
  assert.equal(result.status, "blocked");
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
  assert.equal(inspection.kind, "deposit_notice");
  assert.equal(inspection.certainty, "exact");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(confirmClicks, 1);
  assert.equal(prevClicks, 0);
});

test("exact deposit notice advances with next and never clicks previous", () => {
  const document = documentFor(fixture("post-slot-deposit-notice-next-exact.html"));
  let previousClicks = 0;
  let nextClicks = 0;
  document.querySelector("[data-previous]").addEventListener("click", () => { previousClicks += 1; });
  document.querySelector("[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "deposit_notice");
  assert.equal(inspection.certainty, "exact");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(nextClicks, 1);
  assert.equal(previousClicks, 0);
});

test("supported deposit notice accepts a next progress button", () => {
  const document = documentFor(fixture("post-slot-deposit-notice-next-supported.html"));
  let nextClicks = 0;
  document.querySelector("[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "deposit_notice");
  assert.equal(inspection.certainty, "supported");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "acted");
  assert.equal(nextClicks, 1);
});

test("an unknown dialog with next is not treated as a deposit notice", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="고객 요청 확인">
      <h2>고객 요청 확인</h2>
      <button data-next>다음</button>
    </div>
  `);
  let nextClicks = 0;
  document.querySelector("[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "unknown");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "blocked");
  assert.equal(nextClicks, 0);
});

test("deposit notice next is blocked when a payment choice is present", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="예약금 안내">
      <input type="radio" aria-label="예약금 결제" checked>
      <button data-next>다음</button>
    </div>
  `);
  let nextClicks = 0;
  document.querySelector("[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "deposit_notice");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "" }).status, "blocked");
  assert.equal(nextClicks, 0);
});

test("deposit method prefers zero deposit and accepts an already selected active method", () => {
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

  const paidDocument = documentFor(`
    <div role="dialog" aria-label="예약금 결제 방법 선택">
      <input type="radio" checked>
      <button data-paid-next>다음</button>
    </div>
  `);
  let paidNextClicks = 0;
  paidDocument.querySelector("[data-paid-next]").addEventListener("click", () => { paidNextClicks += 1; });
  const paidOnly = new PostSlotAdapter(paidDocument);
  assert.equal(paidOnly.advance(paidOnly.inspect(), {
    tablePreference: "any",
    menuKeyword: "",
    paymentMethodAutoAdvance: true,
    paymentMethodPolicy: "selected_allowed",
  }).status, "acted");
  assert.equal(paidNextClicks, 1);
});

test("zero-only payment policy never advances an already selected paid method", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="예약금 결제 방법 선택">
      <input type="radio" aria-label="예약금 결제 20,000원" checked>
      <button data-next>다음</button>
    </div>
  `);
  let nextClicks = 0;
  document.querySelector("[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const result = adapter.advance(adapter.inspect(), {
    tablePreference: "any",
    menuKeyword: "",
    paymentMethodAutoAdvance: true,
    paymentMethodPolicy: "zero_only",
  });

  assert.equal(result.status, "blocked");
  assert.match(result.message, /예약금 0원/);
  assert.equal(nextClicks, 0);
});

test("deposit method hands off when auto advance is off or no active method is selected", () => {
  const selectedDocument = documentFor(`
    <div role="dialog" aria-label="예약금 결제 방법 선택">
      <input type="radio" aria-label="예약금 0원 결제" checked>
      <button data-next>다음</button>
    </div>
  `);
  let nextClicks = 0;
  selectedDocument.querySelector("[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const disabled = new PostSlotAdapter(selectedDocument);
  const disabledResult = disabled.advance(disabled.inspect(), {
    tablePreference: "any",
    menuKeyword: "",
    paymentMethodAutoAdvance: false,
  });
  assert.equal(disabledResult.status, "blocked");
  assert.equal(nextClicks, 0);

  const unselected = new PostSlotAdapter(documentFor(`
    <div role="dialog" aria-label="예약금 결제 방법 선택">
      <input type="radio" aria-label="예약금 결제">
      <button>다음</button>
    </div>
  `));
  assert.equal(unselected.advance(unselected.inspect(), {
    tablePreference: "any",
    menuKeyword: "",
    paymentMethodAutoAdvance: true,
  }).status, "blocked");
});

test("zero-deposit auto-payment notice advances only with the measured evidence", () => {
  const document = documentFor(fixture("post-slot-payment-method-notice.html"));
  let reserveClicks = 0;
  document.querySelector("[data-reserve]").addEventListener("click", () => { reserveClicks += 1; });
  const adapter = new PostSlotAdapter(document);
  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "payment_method_notice");
  assert.equal(adapter.advance(inspection, {
    tablePreference: "any",
    menuKeyword: "",
    paymentMethodAutoAdvance: true,
  }).status, "acted");
  assert.equal(reserveClicks, 1);

  const lookalike = new PostSlotAdapter(documentFor(`
    <div role="dialog"><p>다른 프로모션입니다.</p><button>이 방식으로 예약</button></div>
  `));
  assert.equal(lookalike.inspect().kind, "unknown");
});

test("deposit-free flow accepts the measured payment-method title", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="reservation step">
      <h2>결제 방식 선택</h2>
      <input type="radio" aria-label="예약금 0원 결제 혜택" checked>
      <input type="radio" aria-label="일반 예약금 결제">
      <button data-next>다음</button>
    </div>
  `);
  let nextClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);
  const inspection = adapter.inspect();

  assert.equal(inspection.kind, "deposit");
  assert.equal(inspection.certainty, "supported");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "", personCount: 2 }).status, "acted");
  assert.equal(nextClicks, 1);
});

test("the request-based reservation sheet advances via the apply button", () => {
  // Live DOM measured 2026-07-12 at ishizue (site-behavior §7.2): the request sheet is a
  // MUI Drawer inside role="presentation" with no role="dialog" anywhere in the document.
  const document = documentFor(`
    <div role="presentation" style="position: fixed;">
      <div tabindex="-1">
        <h2>레스토랑 확인이 필요한 예약입니다.</h2>
        <p>레스토랑에서 확인 후 예약이 확정되며, 확정까지 다소 시간이 소요됩니다.</p>
        <input type="checkbox" />
        <button>취소</button>
        <button>예약 신청</button>
      </div>
    </div>
  `, "https://app.catchtable.co.kr/ct/shop/ishizue");
  let applyClicks = 0;
  let cancelClicks = 0;
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => b.textContent === "예약 신청").addEventListener("click", () => { applyClicks += 1; });
  buttons.find((b) => b.textContent === "취소").addEventListener("click", () => { cancelClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "request_notice");
  assert.equal(inspection.certainty, "supported");
  assert.equal(inspection.strategy, "request-sheet-v1");
  assert.equal(inspection.diagnostics.title, "레스토랑 확인이 필요한 예약입니다.");

  const action = adapter.advance(inspection, { tablePreference: "any", menuKeyword: "", personCount: 2 });
  assert.equal(action.status, "acted");
  assert.equal(applyClicks, 1);
  assert.equal(cancelClicks, 0);
  assert.equal(document.querySelector('input[type="checkbox"]').checked, false);
});

test("the shop promo interstitial is dismissed via the later button", () => {
  // Live DOM measured 2026-07-12 at ishizue (site-behavior §7.2): the promo interstitial is
  // a fixed section without any role attribute; only its button texts are stable anchors.
  const document = documentFor(`
    <div style="position: fixed;">
      <section>
        <h2>이시즈에와 비슷한 곳 둘러보기</h2>
        <button>7일간 보지 않기</button>
        <button>다음에 볼게요</button>
      </section>
    </div>
  `, "https://app.catchtable.co.kr/ct/shop/ishizue");
  let laterClicks = 0;
  let hideClicks = 0;
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => b.textContent === "다음에 볼게요").addEventListener("click", () => { laterClicks += 1; });
  buttons.find((b) => b.textContent === "7일간 보지 않기").addEventListener("click", () => { hideClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "promo_interstitial");
  assert.equal(inspection.strategy, "promo-interstitial-v1");

  const action = adapter.advance(inspection, { tablePreference: "any", menuKeyword: "", personCount: 2 });
  assert.equal(action.status, "acted");
  assert.equal(laterClicks, 1);
  assert.equal(hideClicks, 0);
});

test("reservation form and unknown dialogs are distinguished", () => {
  const form = new PostSlotAdapter(documentFor("<main></main>", "https://app.catchtable.co.kr/ct/reservation/form?isDepositFree=1"));
  assert.equal(form.inspect().kind, "form");

  const unknown = new PostSlotAdapter(documentFor('<div role="dialog" aria-label="알 수 없는 단계"></div>'));
  const unknownInspection = unknown.inspect();
  assert.equal(unknownInspection.kind, "unknown");
  assert.equal(unknownInspection.label, "알 수 없는 단계");
});

test("promotional notice on the reservation form is dismissed before handing off", () => {
  // Screen evidence 2026-07-11: a lottery promo dialog with a single 확인했어요 button
  // can cover the reservation form on arrival. DOM roles are not measured yet.
  const document = documentFor(`
    <main></main>
    <div><button>확인했어요</button></div>
  `, "https://app.catchtable.co.kr/ct/reservation/form?isDepositFree=1");
  let dismissClicks = 0;
  const dismiss = document.querySelector("button");
  dismiss.addEventListener("click", () => {
    dismissClicks += 1;
    dismiss.parentElement.remove();
  });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "form_notice");
  assert.equal(inspection.certainty, "exact");
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "", personCount: 2 }).status, "acted");
  assert.equal(dismissClicks, 1);
  assert.equal(adapter.inspect().kind, "form");
});

test("dialog title and control structure survive an aria-label change", () => {
  const document = documentFor(fixture("post-slot-extras-title-fallback.html"));
  let nextClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();

  assert.equal(inspection.kind, "extras");
  assert.equal(inspection.certainty, "supported");
  assert.equal(inspection.strategy, "extras-title-structure-v1");
  assert.match(inspection.fingerprint, /^ps-/);
  assert.equal(adapter.advance(inspection, { tablePreference: "any", menuKeyword: "", personCount: 2 }).status, "acted");
  assert.equal(nextClicks, 1);
});

test("advance refuses a dialog whose structure changed after inspection", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="추가 상품">
      <button data-next>다음</button>
    </div>
  `);
  let nextClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);
  const inspection = adapter.inspect();

  document.querySelector('[role="dialog"]').insertAdjacentHTML(
    "afterbegin",
    '<input type="checkbox" aria-label="새 필수 선택">',
  );
  const result = adapter.advance(inspection, { tablePreference: "any", menuKeyword: "", personCount: 2 });

  assert.equal(result.status, "waiting");
  assert.equal(nextClicks, 0);
});

test("unknown diagnostics expose structure but not input values or body text", () => {
  const document = documentFor(fixture("post-slot-unknown.html"));
  const inspection = new PostSlotAdapter(document).inspect();

  assert.equal(inspection.kind, "unknown");
  assert.equal(inspection.certainty, "unknown");
  assert.equal(inspection.strategy, "unknown-dialog-v1");
  assert.deepEqual(inspection.diagnostics.buttons, ["이전", "계속"]);
  assert.equal(inspection.diagnostics.disabledButtonCount, 1);
  assert.equal(inspection.diagnostics.checkboxCount, 0);
  assert.match(inspection.fingerprint, /^ps-/);
  assert.doesNotMatch(JSON.stringify(inspection), /private request|사용자 이름/);
});

test("hidden controls cannot support a fallback classification", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="reservation step">
      <h2>추가 상품</h2>
      <button hidden>다음</button>
    </div>
  `);

  const inspection = new PostSlotAdapter(document).inspect();

  assert.equal(inspection.kind, "unknown");
  assert.deepEqual(inspection.diagnostics.buttons, []);
});

test("a hidden form notice button is ignored", () => {
  const document = documentFor(`
    <main></main>
    <div hidden><button>확인했어요</button></div>
  `, "https://app.catchtable.co.kr/ct/reservation/form?isDepositFree=1");

  assert.equal(new PostSlotAdapter(document).inspect().kind, "form");
});

test("controls under a CSS-hidden ancestor are ignored", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="reservation step">
      <h2>추가 상품</h2>
      <div style="display: none"><button>다음</button></div>
    </div>
  `);

  assert.equal(new PostSlotAdapter(document).inspect().kind, "unknown");
});

test("an aria-disabled progress button is never clicked", () => {
  const document = documentFor(`
    <div role="dialog" aria-label="추가 상품">
      <button data-next aria-disabled="true">다음</button>
    </div>
  `);
  let nextClicks = 0;
  document.querySelector("button[data-next]").addEventListener("click", () => { nextClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const result = adapter.advance(
    adapter.inspect(),
    { tablePreference: "any", menuKeyword: "", personCount: 2 },
  );

  assert.equal(result.status, "waiting");
  assert.equal(nextClicks, 0);
});

test("seating-menu sheet selects the first enabled card when no preference is configured", () => {
  const document = documentFor(fixture("post-slot-seating-menu-sheet.html"));
  const controls = [...document.querySelectorAll('[role="checkbox"]')];
  controls.forEach((control) => control.addEventListener("click", () => {
    controls.forEach((item) => item.setAttribute("aria-checked", String(item === control)));
  }));
  let confirmClicks = 0;
  document.querySelector("[data-confirm]").addEventListener("click", () => { confirmClicks += 1; });
  const adapter = new PostSlotAdapter(document);
  const runConfig = { tablePreference: "any", menuKeyword: "", personCount: 2 };

  assert.equal(adapter.advance(adapter.inspect(), runConfig).status, "acted");
  assert.equal(controls[0].getAttribute("aria-checked"), "true");
  assert.equal(controls[1].getAttribute("aria-checked"), "false");
  assert.equal(confirmClicks, 0);

  assert.equal(adapter.advance(adapter.inspect(), runConfig).status, "acted");
  assert.equal(confirmClicks, 1);
});

test("seating-menu sheet remains detectable after selection replaces the required-menu notice", () => {
  const document = documentFor(fixture("post-slot-seating-menu-selected-sheet.html"));
  let confirmClicks = 0;
  document.querySelector("[data-confirm]").addEventListener("click", () => { confirmClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  const inspection = adapter.inspect();
  assert.equal(inspection.kind, "seating_menu");
  assert.equal(adapter.advance(
    inspection,
    { tablePreference: "any", menuKeyword: "", personCount: 2 },
  ).status, "acted");
  assert.equal(confirmClicks, 1);

  assert.equal(adapter.advance(
    adapter.inspect(),
    { tablePreference: "any", menuKeyword: "", personCount: 2 },
  ).status, "waiting");
  assert.equal(confirmClicks, 1);
});

test("seating-menu sheet selects the configured counter card then confirms", () => {
  const document = documentFor(fixture("post-slot-seating-menu-sheet.html"));
  const controls = [...document.querySelectorAll('[role="checkbox"]')];
  controls.forEach((control) => control.addEventListener("click", () => {
    controls.forEach((item) => item.setAttribute("aria-checked", String(item === control)));
  }));
  let confirmClicks = 0;
  document.querySelector("[data-confirm]").addEventListener("click", () => { confirmClicks += 1; });
  const adapter = new PostSlotAdapter(document);

  let inspection = adapter.inspect();
  assert.equal(inspection.kind, "seating_menu");
  assert.equal(inspection.certainty, "supported");
  assert.equal(inspection.strategy, "seating-menu-sheet-v1");
  assert.equal(adapter.advance(inspection, { tablePreference: "bar", menuKeyword: "오마카세", personCount: 2 }).status, "acted");
  assert.equal(controls[0].getAttribute("aria-checked"), "false");
  assert.equal(controls[1].getAttribute("aria-checked"), "true");

  inspection = adapter.inspect();
  assert.equal(adapter.advance(inspection, { tablePreference: "bar", menuKeyword: "오마카세", personCount: 2 }).status, "acted");
  assert.equal(confirmClicks, 1);
});

test("seating-menu sheet maps hall to table and blocks an unavailable room", () => {
  const hallDocument = documentFor(fixture("post-slot-seating-menu-sheet.html"));
  const hallChoice = hallDocument.querySelector('[role="checkbox"]');
  hallChoice.addEventListener("click", () => hallChoice.setAttribute("aria-checked", "true"));
  const hall = new PostSlotAdapter(hallDocument);
  assert.equal(hall.advance(
    hall.inspect(),
    { tablePreference: "hall", menuKeyword: "", personCount: 2 },
  ).status, "acted");
  assert.equal(hallChoice.getAttribute("aria-checked"), "true");

  const roomDocument = documentFor(fixture("post-slot-seating-menu-sheet.html"));
  const room = new PostSlotAdapter(roomDocument);
  assert.equal(room.advance(
    room.inspect(),
    { tablePreference: "room", menuKeyword: "", personCount: 2 },
  ).status, "blocked");
});

test("generic presentation sheet with a checkbox and confirm is not a seating-menu stage", () => {
  const document = documentFor(`
    <div role="presentation">
      <div>
        <h3>디너 오마카세</h3>
        <button role="checkbox" aria-label="디너 오마카세"></button>
      </div>
      <p>[필수] 메인 메뉴를 선택해주세요.</p>
      <button>확인</button>
    </div>
  `);
  const adapter = new PostSlotAdapter(document);

  assert.equal(adapter.inspect().kind, "waiting");
});
