import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { ReservationFormAdapter } from "../dist/content/adapter/reservation-form.js";

function fixtureHtml(name) {
  return readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
}

function documentFromFixture(name, url) {
  return new JSDOM(fixtureHtml(name), { url }).window.document;
}

function documentFor(body, url = "https://app.catchtable.co.kr/ct/reservation/form") {
  return new JSDOM(`<!doctype html><body>${body}</body>`, { url }).window.document;
}

const FORM_URL = "https://app.catchtable.co.kr/ct/reservation/form?isDepositFree=1";
const PAID_FORM_URL = "https://app.catchtable.co.kr/ct/reservation/form?openRegisterCard=0";
const SUCCESS_URL = "https://app.catchtable.co.kr/ct/mydining/my/planned";

// 우블랑(A/C) 기대값 — site-behavior.md §12.3/§12.4, header > h1 텍스트는 §12.8.
const ZERO_EXPECTATION = { shopDisplayName: "우블랑", dateText: "08월 10일", personText: "2명" };
const ZERO_SUCCESS_EXPECTATION = {
  shopDisplayName: "우블랑", listingDateText: "2026.08.10 (월)", personText: "2명",
};
// 더피제리아마켓(B) 기대값 — site-behavior.md §12.6, header > h1/방문예정 표기는 §12.7-§12.8.
const PAID_EXPECTATION = {
  shopDisplayName: "더피제리아마켓 하남미사", dateText: "08월 11일", personText: "2명",
};
const PAID_SUCCESS_EXPECTATION = {
  shopDisplayName: "더피제리아마켓 하남미사", listingDateText: "2026.08.11 (화)", personText: "2명",
};
const MAX_AMOUNT = 500_000;

function options(expectation, successExpectation, maxPaymentAmountKrw = MAX_AMOUNT) {
  return { expectation, successExpectation, maxPaymentAmountKrw };
}

// ---- C: 비로그인 ----

test("C(비로그인)는 login_required로 분류되고 제출 action은 0회다", () => {
  const document = documentFromFixture("catchpay-non-login.html", FORM_URL);
  let submitClicks = 0;
  document.querySelectorAll("button").forEach((button) => {
    if (button.textContent?.trim() === "자동결제로 예약하기") {
      button.addEventListener("click", () => { submitClicks += 1; });
    }
  });
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "login_required");
  assert.equal(submitClicks, 0);
  // inspect 자체는 읽기 전용이며 fingerprint만으로 action이 거절되는지도 확인한다.
  assert.equal(adapter.submitOuter(inspection.fingerprint), false);
  assert.equal(submitClicks, 0);
});

// ---- A: 로그인 0원 ----

test("A(로그인 0원)는 CatchPay checked·일반결제 미선택, current 0원, 필수 10개, 빈 multiline 3개, optional 0개로 분류된다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  const { optionalAgreementFingerprint, ...facts } = inspection.facts;
  assert.match(optionalAgreementFingerprint, /^[a-f0-9]{8}$/);
  assert.deepEqual(facts, {
    currentAmountKrw: 0,
    catchPayChecked: true,
    generalPaymentSelected: false,
    requiredAgreementCount: 10,
    uncheckedRequiredAgreementCount: 10,
    emptyRequiredMultilineCount: 3,
    optionalAgreementCount: 0,
    checkedOptionalAgreementCount: 0,
  });
});

// ---- B: 로그인 유료 ----

test("B(로그인 유료)는 current 20,000원, 필수 3개, optional 0개, 필수 자유입력 0개다", () => {
  const document = documentFromFixture("catchpay-paid-form.html", PAID_FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(PAID_EXPECTATION, PAID_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  assert.equal(inspection.facts.currentAmountKrw, 20_000);
  assert.equal(inspection.facts.requiredAgreementCount, 3);
  assert.equal(inspection.facts.optionalAgreementCount, 0);
  assert.equal(inspection.facts.emptyRequiredMultilineCount, 0);
});

// ---- 금액 판정 ----

test("취소선 80,000원과 current 0원을 구분한다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  assert.equal(inspection.facts.currentAmountKrw, 0);
});

function withAmountSection(html) {
  return documentFor(`
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>
      <label><input type="radio" name="payment-type" checked />캐치페이</label>
      <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
      <label><input type="radio" name="payment-type" disabled />일반결제</label>
    </section>
    <fieldset>
      <label><input type="checkbox" checked />[필수] 약관 A</label>
    </fieldset>
    <section>${html}</section>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
}

test("current 금액 0개·복수·parse 실패·상한 초과는 ready가 아니다", () => {
  const adapter1 = new ReservationFormAdapter(withAmountSection("<p>결제금액</p><p>안내 문구만 있음</p>"));
  assert.deepEqual(adapter1.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind, "unknown");

  const adapter2 = new ReservationFormAdapter(withAmountSection("<p>결제금액</p><p>10,000원 20,000원</p>"));
  assert.equal(adapter2.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind, "unknown");

  const adapter3 = new ReservationFormAdapter(withAmountSection("<p>결제금액</p><p>일부백만원</p>"));
  assert.equal(adapter3.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind, "unknown");

  const adapter4 = new ReservationFormAdapter(withAmountSection("<p>결제금액</p><p>600,000원</p>"));
  const over = adapter4.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION, 500_000));
  assert.equal(over.kind, "unknown");
  assert.equal(over.code, "amount_over_limit");
});

test("본문·고정 하단 금액 요약이 함께 있으면 anchor별 단일 현재값이 모두 같을 때만 수렴한다", () => {
  const matching = withAmountSection(`
    <div><h3>총 결제 금액</h3><div><s>80,000원</s><span>0원</span></div></div>
    <footer><span>결제금액</span><div><span style="text-decoration-line: line-through">80,000원</span><span>0원</span></div></footer>
  `);
  const splitCurrent = matching.querySelector("footer div span:last-child");
  splitCurrent.textContent = "";
  splitCurrent.append(matching.createTextNode("0"), matching.createTextNode("원"));
  const ready = new ReservationFormAdapter(matching).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(ready.kind, "ready");
  assert.equal(ready.facts.currentAmountKrw, 0);

  const mismatching = withAmountSection(`
    <div><h3>총 결제 금액</h3><div>0원</div></div>
    <footer><span>결제금액</span><div>20,000원</div></footer>
  `);
  assert.equal(
    new ReservationFormAdapter(mismatching).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "unknown",
  );

  const ambiguousAnchor = withAmountSection(`
    <div><h3>총 결제 금액</h3><div>0원 20,000원</div></div>
    <footer><span>결제금액</span><div>0원</div></footer>
  `);
  assert.equal(
    new ReservationFormAdapter(ambiguousAnchor).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "unknown",
  );
});

// ---- 예약 intent 불일치 ----

test("날짜·인원 불일치는 ready가 아니다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const wrongDate = adapter.inspect(options({ ...ZERO_EXPECTATION, dateText: "09월 01일" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongDate.kind, "unknown");
  assert.equal(wrongDate.code, "intent_mismatch");
  const wrongPerson = adapter.inspect(options({ ...ZERO_EXPECTATION, personText: "4명" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongPerson.kind, "unknown");
  assert.equal(wrongPerson.code, "intent_mismatch");
  const wrongShop = adapter.inspect(options({ ...ZERO_EXPECTATION, shopDisplayName: "다른 매장" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongShop.kind, "unknown");
  assert.equal(wrongShop.code, "intent_mismatch");
});

// site-behavior.md §12.21: 같은 1110분을 상단 "오후 6시 30분", 하단 "오후 18:30"으로 렌더한다.
// 시각 표기는 판정에 쓰지 않으므로 두 표기 모두 ready에 도달해야 한다.
const SUSHI_EXPECTATION = { shopDisplayName: "스시 호시카이", dateText: "09월 08일", personText: "2명" };
const SUSHI_SUCCESS_EXPECTATION = {
  shopDisplayName: "스시 호시카이", listingDateText: "2026.09.08 (화)", personText: "2명",
};

test("12시간제·24시간제 시각 표기가 섞인 요약도 ready로 판정한다", () => {
  const document = documentFromFixture("catchpay-zero-form-24h-cta.html", FORM_URL);
  const inspection = new ReservationFormAdapter(document)
    .inspect(options(SUSHI_EXPECTATION, SUSHI_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  assert.equal(inspection.facts.currentAmountKrw, 0);
  assert.equal(inspection.facts.catchPayChecked, true);
  assert.equal(inspection.facts.generalPaymentSelected, false);
});

test("요약이 24시간제 한 벌뿐이어도, 12시간제 한 벌뿐이어도 날짜·인원으로 판정한다", () => {
  // 남기는 표기만 다르게 하려고 다른 한 벌을 제거한다. 하단 금액 블록과 CTA는 그대로 둔다.
  const summaryElement = (document, needle) => [...document.querySelectorAll("p, div")]
    .filter((element) => element.textContent?.includes(needle))
    .at(-1);
  for (const [keep, drop] of [["오후 18:30", "오후 6시 30분"], ["오후 6시 30분", "오후 18:30"]]) {
    const document = documentFromFixture("catchpay-zero-form-24h-cta.html", FORM_URL);
    summaryElement(document, drop).remove();
    const inspection = new ReservationFormAdapter(document)
      .inspect(options(SUSHI_EXPECTATION, SUSHI_SUCCESS_EXPECTATION));
    assert.equal(inspection.kind, "ready", keep);
  }
});

// ---- 최종 버튼 판정 — site-behavior.md §12.3/§12.4/§12.21, 20-design.md §3 ----

test("최종 버튼은 `예약하기`로 끝나는 유일한 버튼이며 두 실측 라벨을 모두 받는다", () => {
  for (const [fixture, expectation, successExpectation, label] of [
    ["catchpay-zero-form-24h-cta.html", SUSHI_EXPECTATION, SUSHI_SUCCESS_EXPECTATION, "예약하기"],
    ["catchpay-zero-form.html", ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION, "자동결제로 예약하기"],
  ]) {
    const document = documentFromFixture(fixture, FORM_URL);
    let clicks = 0;
    const target = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === label);
    target.addEventListener("click", () => { clicks += 1; });
    const adapter = new ReservationFormAdapter(document);
    const inspection = adapter.inspect(options(expectation, successExpectation));
    assert.equal(inspection.kind, "ready", label);
    assert.equal(adapter.submitOuter(inspection.fingerprint), true, label);
    assert.equal(clicks, 1, label);
  }
});

test("`예약하기`로 끝나는 버튼이 둘이면 제출하지 않고 ambiguous_final_button으로 인계한다", () => {
  const document = documentFromFixture("catchpay-zero-form-24h-cta.html", FORM_URL);
  const extra = document.createElement("button");
  extra.type = "button";
  extra.textContent = "자동결제로 예약하기";
  document.body.append(extra);
  let clicks = 0;
  for (const button of document.querySelectorAll("button")) {
    button.addEventListener("click", () => { clicks += 1; });
  }
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(SUSHI_EXPECTATION, SUSHI_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "unknown");
  assert.equal(inspection.code, "ambiguous_final_button");
  assert.equal(adapter.submitOuter(inspection.fingerprint), false);
  assert.equal(clicks, 0);
});

test("`예약하기`를 포함해도 suffix가 아닌 안내 문구 버튼은 최종 버튼이 아니다", () => {
  const document = documentFromFixture("catchpay-zero-form-24h-cta.html", FORM_URL);
  const notice = document.createElement("button");
  notice.type = "button";
  notice.textContent = "예약하기 전에 확인하세요";
  document.body.append(notice);
  assert.equal(
    new ReservationFormAdapter(document).inspect(options(SUSHI_EXPECTATION, SUSHI_SUCCESS_EXPECTATION)).kind,
    "ready",
  );
});

// ---- 실패 근거 관측 — 20-design.md §4 ----

test("intent_mismatch는 어느 비교가 깨졌는지 불리언으로 분해해 남긴다", () => {
  const document = documentFromFixture("catchpay-zero-form-24h-cta.html", FORM_URL);
  const inspection = new ReservationFormAdapter(document)
    .inspect(options({ ...SUSHI_EXPECTATION, dateText: "09월 09일" }, SUSHI_SUCCESS_EXPECTATION));
  assert.equal(inspection.code, "intent_mismatch");
  assert.equal(inspection.evidence.formUnknownCode, "intent_mismatch");
  assert.equal(inspection.evidence.formShopNameMatch, true);
  assert.equal(inspection.evidence.formPersonMatch, true);
  assert.equal(inspection.evidence.formDateMatch, false);
  assert.equal(inspection.evidence.formShopDisplayName, "스시 호시카이");
  assert.equal(inspection.evidence.formExpectedDateText, "09월 09일");
  assert.match(inspection.evidence.formSummaryTexts, /오후 18:30/);
  assert.match(inspection.evidence.formButtonTexts, /예약하기/);
  assert.equal(inspection.evidence.formFinalButtonCount, 1);
  assert.equal(inspection.evidence.formAmounts, "0");
  assert.equal(inspection.evidence.formHoldState, "active");
});

test("실패 근거는 결제 수단 행 텍스트를 담지 않고 개인정보를 마스킹한다", () => {
  const document = documentFromFixture("catchpay-zero-form-24h-cta.html", FORM_URL);
  const cardRow = document.querySelector('input[type="radio"][name="payment-type"]').closest("label");
  cardRow.append(document.createTextNode("체크하나(외환)(151*)"));
  const summary = [...document.querySelectorAll("div")]
    .find((element) => element.textContent?.trim() === "2명");
  summary.textContent = "2명 010-1234-5678 guest@example.com";
  const inspection = new ReservationFormAdapter(document)
    .inspect(options({ ...SUSHI_EXPECTATION, dateText: "09월 09일" }, SUSHI_SUCCESS_EXPECTATION));
  const serialized = JSON.stringify(inspection.evidence);
  assert.doesNotMatch(serialized, /체크하나/);
  assert.doesNotMatch(serialized, /010-1234-5678/);
  assert.doesNotMatch(serialized, /guest@example\.com/);
  assert.match(serialized, /###/);
  assert.equal(inspection.evidence.formPaymentRadioCount, 2);
  assert.equal(inspection.evidence.formCatchPayChecked, true);
});

// ---- 매장명(header h1) 판정 — site-behavior.md §12.8/§12.12, 20-design.md §4.3 ----

test("폼 매장명은 wrapper 깊이와 무관하게 유일하고 비어 있지 않은 header h1에서만 읽는다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const wrongShop = adapter.inspect(options({ ...ZERO_EXPECTATION, shopDisplayName: "다른매장" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongShop.kind, "unknown");
  assert.equal(wrongShop.code, "intent_mismatch");
  const matching = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(matching.kind, "ready");

  const wrappedHeader = withHeader(`
    <header><div><div><h1>우블랑</h1></div><button type="button">닫기</button></div></header>
  `);
  assert.equal(
    new ReservationFormAdapter(wrappedHeader).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "ready",
  );
});

function withHeader(headerHtml) {
  return documentFor(`
    ${headerHtml}
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>
      <label><input type="radio" name="payment-type" checked />캐치페이</label>
      <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
      <label><input type="radio" name="payment-type" disabled />일반결제</label>
    </section>
    <section><p>결제금액</p><p>0원</p></section>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
}

test("header h1 부재·중복·빈 값, document.title/본문 heading만 있는 변형은 매장 일치로 인정하지 않는다", () => {
  const missingHeader = withHeader("");
  const missing = new ReservationFormAdapter(missingHeader).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(missing.kind, "unknown");
  assert.equal(missing.code, "intent_mismatch");

  const duplicateHeader = withHeader(`
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
  `);
  const duplicate = new ReservationFormAdapter(duplicateHeader).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(duplicate.kind, "unknown");
  assert.equal(duplicate.code, "intent_mismatch");

  const emptyHeader = withHeader('<header><h1></h1><button type="button">닫기</button></header>');
  const empty = new ReservationFormAdapter(emptyHeader).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(empty.kind, "unknown");
  assert.equal(empty.code, "intent_mismatch");

  // document.title만 매장명을 담고 있어도 fallback으로 쓰지 않는다(§12.8: title은 공통 문자열이었지만
  // 회귀 방지로 매장명이 title에만 있는 변형도 명시적으로 고정한다).
  const titleOnlyDoc = withHeader("");
  titleOnlyDoc.title = "우블랑";
  const titleOnly = new ReservationFormAdapter(titleOnlyDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(titleOnly.kind, "unknown");
  assert.equal(titleOnly.code, "intent_mismatch");

  // 본문의 다른 heading(h2 등)에 매장명이 있어도 header h1이 아니면 인정하지 않는다.
  const bodyHeadingDoc = withHeader("");
  const h2 = bodyHeadingDoc.createElement("h2");
  h2.textContent = "우블랑";
  bodyHeadingDoc.body.prepend(h2);
  const bodyHeading = new ReservationFormAdapter(bodyHeadingDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(bodyHeading.kind, "unknown");
  assert.equal(bodyHeading.code, "intent_mismatch");
});

// ---- hold 만료·불명 ----

test("hold 만료와 countdown 불명은 ready가 아니다", () => {
  const expiredDoc = documentFor(`
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>
      <label><input type="radio" name="payment-type" checked />캐치페이</label>
      <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
      <label><input type="radio" name="payment-type" disabled />일반결제</label>
    </section>
    <section><p>결제금액</p><p>0원</p></section>
    <p>예약 찜 시간이 만료되었습니다. 예약현황에 따라 예약이 어려울 수 있습니다.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
  const expired = new ReservationFormAdapter(expiredDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(expired.kind, "hold_expired");

  const unknownCountdownDoc = documentFor(`
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>
      <label><input type="radio" name="payment-type" checked />캐치페이</label>
      <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
      <label><input type="radio" name="payment-type" disabled />일반결제</label>
    </section>
    <section><p>결제금액</p><p>0원</p></section>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
  const unknownCountdown = new ReservationFormAdapter(unknownCountdownDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(unknownCountdown.kind, "unknown");
  assert.equal(unknownCountdown.code, "hold_countdown_unknown");
});

// ---- CatchPay 판정 ----

function catchPayVariant(paymentSection) {
  return documentFor(`
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>${paymentSection}</section>
    <section><p>결제금액</p><p>0원</p></section>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
}

test("CatchPay 미선택·일반결제 선택은 ready가 아니지만 등록 안내문 부재만으로 거절하지 않는다", () => {
  const notChecked = catchPayVariant(`
    <label><input type="radio" name="payment-type" />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
  `);
  const notCheckedResult = new ReservationFormAdapter(notChecked).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(notCheckedResult.kind, "unknown");
  assert.equal(notCheckedResult.code, "catchpay_not_ready");

  const notRegistered = catchPayVariant(`
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
  `);
  const notRegisteredResult = new ReservationFormAdapter(notRegistered).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(notRegisteredResult.kind, "ready");
  assert.equal(notRegisteredResult.facts.catchPayChecked, true);
  assert.equal(notRegisteredResult.facts.generalPaymentSelected, false);

  const generalSelected = catchPayVariant(`
    <label><input type="radio" name="payment-type" />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" checked />일반결제</label>
  `);
  const generalSelectedResult = new ReservationFormAdapter(generalSelected).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(generalSelectedResult.kind, "unknown");
  assert.equal(generalSelectedResult.code, "catchpay_not_ready");
});

test("명시적 CatchPay label이 없는 2-radio 변형은 등록 안내문 없이 유일한 일반결제 반대편으로 판정한다", () => {
  const document = catchPayVariant(`
    <section>
      <div><label><span><input type="radio" name="payment-type" checked /></span></label></div>
      <div><label><span><input type="radio" name="payment-type" disabled /></span>일반결제</label></div>
    </section>
  `);
  const inspection = new ReservationFormAdapter(document).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  assert.equal(inspection.facts.catchPayChecked, true);
  assert.equal(inspection.facts.generalPaymentSelected, false);
});

test("일반결제 radio를 유일하게 식별하지 못하면 명시적 CatchPay가 checked여도 인계한다", () => {
  const document = catchPayVariant(`
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <label><input type="radio" name="payment-type" disabled /></label>
  `);
  const inspection = new ReservationFormAdapter(document).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "unknown");
  assert.equal(inspection.code, "catchpay_not_ready");
});

// ---- 방문 목적·선택/마케팅 ----

test("방문 목적과 [선택]·마케팅은 action 대상이 아니다", () => {
  const document = documentFromFixture("catchpay-non-login.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  const before = [...document.querySelectorAll('input[type="checkbox"]')].map((el) => el.checked);
  // login_required 상태이므로 agreeRequired는 아무 것도 클릭하지 않는다(대상 자체가 없음을 별도 확인).
  adapter.agreeRequired(inspection.fingerprint);
  const after = [...document.querySelectorAll('input[type="checkbox"]')].map((el) => el.checked);
  assert.deepEqual(before, after);
  // 방문 목적 checkbox는 [필수]/[선택] 마커가 없어 개별 대상에서 제외된다는 것을
  // A 폼에서 직접 확인한다: 필수 10개 계산에 방문 목적 9개가 섞이지 않아야 한다.
  const zeroForm = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const zeroAdapter = new ReservationFormAdapter(zeroForm);
  const zeroInspection = zeroAdapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(zeroInspection.facts.requiredAgreementCount, 10);
});

// ---- 개별 required 우선 처리 ----

test("개별 required를 우선 처리한다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  const groupControl = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "모두 동의합니다")
    .querySelector("input");
  assert.equal(groupControl.checked, false);
  const checkedCountBefore = [...document.querySelectorAll('input[type="checkbox"]')].filter((el) => el.checked).length;
  const acted = adapter.agreeRequired(inspection.fingerprint);
  assert.equal(acted, true);
  // 그룹 control이 아니라 개별 [필수] checkbox 중 정확히 하나가 새로 체크됐다.
  assert.equal(groupControl.checked, false);
  const checkedCountAfter = [...document.querySelectorAll('input[type="checkbox"]')].filter((el) => el.checked).length;
  assert.equal(checkedCountAfter, checkedCountBefore + 1);
});

// ---- group 동의 안전성 ----

test("개별 required 클릭이 반영되지 않으면 required-only 모두 동의합니다. group으로 fallback한다", () => {
  const document = documentFromFixture("catchpay-paid-form.html", PAID_FORM_URL);
  const requiredLabels = [...document.querySelectorAll("label")]
    .filter((label) => (label.textContent ?? "").includes("[필수]"));
  requiredLabels.forEach((label) => { label.querySelector("input").checked = true; });
  const blockedRequired = requiredLabels.at(-1).querySelector("input");
  blockedRequired.checked = false;
  blockedRequired.addEventListener("click", (event) => event.preventDefault());
  const groupLabel = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "모두 동의합니다");
  groupLabel.lastChild.textContent = "모두 동의합니다.";
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(PAID_EXPECTATION, PAID_SUCCESS_EXPECTATION));
  const groupInput = groupLabel.querySelector("input");
  groupInput.addEventListener("click", () => {
    requiredLabels.forEach((label) => { label.querySelector("input").checked = true; });
  });
  assert.equal(groupInput.checked, false);
  const acted = adapter.agreeRequired(inspection.fingerprint);
  assert.equal(acted, true);
  assert.equal(blockedRequired.checked, true);
  assert.equal(groupInput.checked, true);
});

test("optional이 섞이거나 membership가 불명인 group은 클릭하지 않는다", () => {
  const document = documentFor(`
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>
      <label><input type="radio" name="payment-type" checked />캐치페이</label>
      <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
      <label><input type="radio" name="payment-type" disabled />일반결제</label>
    </section>
    <section><p>결제금액</p><p>0원</p></section>
    <fieldset>
      <label><input type="checkbox" />모두 동의합니다</label>
      <label><input type="checkbox" checked />[필수] 약관 A</label>
      <label><input type="checkbox" checked />[필수] 약관 B</label>
      <label><input type="checkbox" />[선택] 마케팅 수신</label>
    </fieldset>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready"); // group 안전성 검사 자체를 검증하려는 것이지 다른 사유의 unknown이 아니다.
  const groupInput = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "모두 동의합니다")
    .querySelector("input");
  const acted = adapter.agreeRequired(inspection.fingerprint);
  // optional이 섞인 group은 클릭하지 않는다 — 개별 미체크 대상도 없으므로 acted는 false다.
  assert.equal(acted, false);
  assert.equal(groupInput.checked, false);
});

test("group 범위의 hidden optional native checkbox도 member 안전성 검사에 포함한다", () => {
  const document = documentFor(`
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>
      <label><input type="radio" name="payment-type" checked />캐치페이</label>
      <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
      <label><input type="radio" name="payment-type" disabled />일반결제</label>
    </section>
    <section><p>결제금액</p><p>0원</p></section>
    <div>
      <label><input type="checkbox" />모두 동의합니다.</label>
      <label><input type="checkbox" checked />[필수] 약관 A</label>
      <label><input type="checkbox" checked />[필수] 약관 B</label>
      <label style="display:none"><input type="checkbox" />[선택] 숨은 마케팅</label>
    </div>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  const group = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "모두 동의합니다.")
    .querySelector("input");
  assert.equal(adapter.agreeRequired(inspection.fingerprint), false);
  assert.equal(group.checked, false);
});

// ---- 필수 입력 채우기 ----

test("이미 채워진 필수 입력은 보존하고 빈 supported multiline만 공통 답변으로 채운다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const prefilled = [...document.querySelectorAll("textarea")][0];
  prefilled.value = "이미 입력한 알러지 정보";
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.facts.emptyRequiredMultilineCount, 2); // 하나는 이미 채워짐
  const acted = adapter.fillRequiredMultiline(inspection.fingerprint, "공통 답변");
  assert.equal(acted, true);
  assert.equal(prefilled.value, "이미 입력한 알러지 정보"); // 보존됨
  const textareas = [...document.querySelectorAll("textarea")];
  const requiredTextareas = textareas.filter((el) => (el.closest("label")?.textContent ?? "").includes("[필수]"));
  assert.equal(requiredTextareas.filter((el) => el.value === "공통 답변").length, 1); // 한 번에 하나만 채움(원자 action)
});

test("React-style instance value setter를 우회해 native textarea value setter를 사용한다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const target = [...document.querySelectorAll("textarea")][0];
  const nativeValue = Object.getOwnPropertyDescriptor(document.defaultView.HTMLTextAreaElement.prototype, "value");
  const events = [];
  target.addEventListener("input", (event) => events.push(event.constructor.name));
  target.addEventListener("change", (event) => events.push(event.type));
  Object.defineProperty(target, "value", {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set() { throw new Error("instance setter must not be used"); },
  });
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(adapter.fillRequiredMultiline(inspection.fingerprint, "공통 답변"), true);
  assert.equal(nativeValue.get.call(target), "공통 답변");
  assert.deepEqual(events, ["InputEvent", "change"]);
});

test("label·required 속성이 없는 textarea는 가장 가까운 단일 질문의 direct heading marker로 판정한다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const original = [...document.querySelectorAll("textarea")];
  for (const [index, textarea] of original.entries()) {
    const label = textarea.closest("label");
    const headingText = (label?.textContent ?? "").trim();
    const field = document.createElement("div");
    const heading = document.createElement("h4");
    heading.textContent = headingText;
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    label.replaceWith(field);
    field.append(heading, outer);
    outer.append(inner);
    inner.append(textarea);
    assert.equal(textarea.required, false);
    assert.equal(textarea.getAttribute("aria-required"), null);
    assert.equal(textarea.closest("label"), null);
    if (index === original.length - 1) heading.textContent = "선택 질문";
  }
  const optionalField = document.createElement("div");
  optionalField.innerHTML = "<h4>고객 요청사항</h4><div><textarea></textarea></div>";
  document.querySelector("main").append(optionalField);

  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  assert.equal(inspection.facts.emptyRequiredMultilineCount, 3);
  assert.equal(adapter.fillRequiredMultiline(inspection.fingerprint, "공통 답변"), true);
  assert.equal(original.filter((textarea) => textarea.value === "공통 답변").length, 1);
  assert.equal(optionalField.querySelector("textarea").value, "");
});

test("빈 기본 답변은 채우기 action을 수행하지 않는다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  const acted = adapter.fillRequiredMultiline(inspection.fingerprint, "   ");
  assert.equal(acted, false);
});

test("unsupported required input은 인계 근거다", () => {
  const document = documentFor(`
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <section>
      <label><input type="radio" name="payment-type" checked />캐치페이</label>
      <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
      <label><input type="radio" name="payment-type" disabled />일반결제</label>
    </section>
    <section><p>결제금액</p><p>0원</p></section>
    <label>[필수] 새로운 단답형 입력<input type="text" /></label>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "unknown");
  assert.equal(inspection.code, "unsupported_required_input");
});

// ---- fingerprint 변경 뒤 action 거절 ----

test("fingerprint 변경 뒤 action은 클릭·입력하지 않는다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  // fingerprint 확보 후 DOM이 바뀐다(약관 하나가 이미 체크됨) — 이 fingerprint는 stale이다.
  const anyRequired = [...document.querySelectorAll("label")]
    .find((label) => (label.textContent ?? "").includes("[필수]"))
    .querySelector("input");
  anyRequired.checked = true;
  const acted = adapter.agreeRequired(inspection.fingerprint);
  assert.equal(acted, false);
  const submitted = adapter.submitOuter(inspection.fingerprint);
  assert.equal(submitted, false);
});

test("inspection 뒤 매장·날짜·시간·인원이 바뀌면 stale action을 거절한다", () => {
  for (const mutate of [
    (document) => { document.querySelector("header > h1").textContent = "다른매장"; },
    (document) => {
      const summary = [...document.querySelectorAll("p")]
        .find((el) => (el.textContent ?? "").includes("오후 12:00"));
      summary.textContent = summary.textContent.replace("08월 10일", "08월 11일");
    },
    (document) => {
      const summary = [...document.querySelectorAll("p")]
        .find((el) => (el.textContent ?? "").includes("오후 12:00"));
      summary.textContent = summary.textContent.replace("오후 12:00", "오후 1:00");
    },
    (document) => {
      const summary = [...document.querySelectorAll("p")]
        .find((el) => (el.textContent ?? "").includes("오후 12:00"));
      summary.textContent = summary.textContent.replace("2명", "3명");
    },
  ]) {
    const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
    const adapter = new ReservationFormAdapter(document);
    const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
    assert.equal(inspection.kind, "ready");
    mutate(document);
    assert.equal(adapter.submitOuter(inspection.fingerprint), false);
  }
});

test("예약 요약을 감싼 큰 조상의 타이머 문구 변화는 stale intent로 오판하지 않는다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const main = document.querySelector("main");
  const wrapper = document.createElement("div");
  while (main.firstChild) wrapper.append(main.firstChild);
  main.append(wrapper);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  const countdown = [...document.querySelectorAll("p")]
    .find((element) => element.textContent?.includes("예약 찜"));
  countdown.textContent = "6분간 예약 찜! 시간 내 예약을 완료해주세요.";
  assert.equal(adapter.agreeRequired(inspection.fingerprint), true);
});

// ---- 외부 submit 원자 action ----

test("submitOuter는 fresh fingerprint에서만 최종 버튼을 1회 클릭한다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  let clicks = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => { clicks += 1; });
  const acted = adapter.submitOuter(inspection.fingerprint);
  assert.equal(acted, true);
  assert.equal(clicks, 1);
});

// ---- PIN 분류 ----

test("PIN은 same-origin, same-document, iframe 0, password input 0, visible digit 0~9 각각 하나로 분류된다", () => {
  const document = documentFromFixture("catchpay-pin.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "pin");
  assert.deepEqual(inspection.facts, {
    sameOrigin: true,
    sameDocument: true,
    iframeCount: 0,
    passwordInputCount: 0,
    digitCount: 10,
    innerSubmitEnabled: false,
  });
});

test("상단·본문 exact heading 중복은 유일한 keypad control 집합으로 분류한다", () => {
  const document = documentFromFixture("catchpay-pin.html", FORM_URL);
  const dialog = document.querySelector('[role="dialog"]');
  dialog.prepend(Object.assign(document.createElement("h2"), {
    textContent: "캐치페이 비밀번호 입력",
  }));
  dialog.removeAttribute("role");

  const inspection = new ReservationFormAdapter(document)
    .inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));

  assert.equal(inspection.kind, "pin");
});

test("시각적으로 렌더된 PIN surface는 aria-hidden/inert여도 분류하고 CSS 비표시는 거부한다", () => {
  const isolated = documentFromFixture("catchpay-pin.html", FORM_URL);
  const isolatedDialog = isolated.querySelector('[role="dialog"]');
  isolatedDialog.setAttribute("aria-hidden", "true");
  isolatedDialog.setAttribute("inert", "");
  assert.equal(
    new ReservationFormAdapter(isolated).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "pin",
  );

  for (const hide of [
    (dialog) => { dialog.hidden = true; },
    (dialog) => { dialog.style.display = "none"; },
    (dialog) => { dialog.style.visibility = "hidden"; },
  ]) {
    const hidden = documentFromFixture("catchpay-pin.html", FORM_URL);
    hide(hidden.querySelector('[role="dialog"]'));
    assert.notEqual(
      new ReservationFormAdapter(hidden).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
      "pin",
    );
  }
});

test("PIN modal 아래 stable context는 접근성 은닉만 허용하고 값 변경·CSS 비표시는 거부한다", () => {
  const matchesAfter = (mutate = () => {}) => {
    const document = documentFromFixture("catchpay-paid-form.html", PAID_FORM_URL);
    const background = document.createElement("div");
    background.setAttribute("aria-hidden", "true");
    background.setAttribute("inert", "");
    while (document.body.firstChild) background.append(document.body.firstChild);
    document.body.append(background);
    const pinDocument = documentFromFixture("catchpay-pin.html", PAID_FORM_URL);
    document.body.append(document.importNode(pinDocument.querySelector('[role="dialog"]'), true));
    mutate(document);
    return new ReservationFormAdapter(document).paymentContextMatchesBelowPin(
      options(PAID_EXPECTATION, PAID_SUCCESS_EXPECTATION),
      20_000,
    );
  };

  assert.equal(matchesAfter(), true);
  // 요약은 두 벌이고 판정은 그중 하나만 맞아도 통과하므로 두 벌 모두 바꿔야 stale intent다.
  assert.equal(matchesAfter((document) => {
    for (const summary of document.querySelectorAll("p")) {
      if (!summary.textContent?.includes("08월 11일")) continue;
      summary.textContent = summary.textContent.replace("08월 11일", "08월 12일");
    }
  }), false);
  assert.equal(matchesAfter((document) => {
    const radios = document.querySelectorAll('input[type="radio"][name="payment-type"]');
    radios[0].checked = false;
    radios[1].checked = true;
  }), false);
  assert.equal(matchesAfter((document) => {
    const label = [...document.querySelectorAll("p, dt, span, div, h1, h2, h3")]
      .find((element) => element.textContent?.trim() === "총 결제 금액");
    label.nextElementSibling.textContent = "30,000원";
  }), false);
  assert.equal(matchesAfter((document) => {
    document.querySelector("header h1").style.display = "none";
  }), false);
});

test("digit 누락·중복·iframe·password input 변형은 지원하지 않는다", () => {
  const missingDigit = documentFor(`
    <section><h2>캐치페이 비밀번호 입력</h2><p>비밀번호를 입력해 주세요</p>
      <button type="button">4</button><button type="button">5</button><button type="button">6</button>
      <button type="button">1</button><button type="button">3</button><button type="button">9</button>
      <button type="button">7</button><button type="button">8</button><button type="button">2</button>
      <button type="button">전체삭제</button>
      <button type="button" disabled>결제하기</button>
    </section>
  `, FORM_URL);
  const missingResult = new ReservationFormAdapter(missingDigit).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(missingResult.kind, "unknown");
  assert.equal(missingResult.code, "pin_keypad_unsupported");

  const duplicateDigit = documentFor(`
    <section><h2>캐치페이 비밀번호 입력</h2><p>비밀번호를 입력해 주세요</p>
      <button type="button">4</button><button type="button">5</button><button type="button">6</button>
      <button type="button">1</button><button type="button">3</button><button type="button">9</button>
      <button type="button">7</button><button type="button">8</button><button type="button">2</button>
      <button type="button">0</button><button type="button">0</button>
      <button type="button">전체삭제</button>
      <button type="button" disabled>결제하기</button>
    </section>
  `, FORM_URL);
  const duplicateResult = new ReservationFormAdapter(duplicateDigit).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(duplicateResult.kind, "unknown");
  assert.equal(duplicateResult.code, "pin_keypad_unsupported");

  const withIframe = documentFor(`
    <section><h2>캐치페이 비밀번호 입력</h2><p>비밀번호를 입력해 주세요</p>
      <button type="button">4</button><button type="button">5</button><button type="button">6</button>
      <button type="button">1</button><button type="button">3</button><button type="button">9</button>
      <button type="button">7</button><button type="button">8</button><button type="button">2</button>
      <button type="button">0</button>
      <button type="button">전체삭제</button>
      <button type="button" disabled>결제하기</button>
    </section>
    <iframe title="unexpected"></iframe>
  `, FORM_URL);
  const iframeResult = new ReservationFormAdapter(withIframe).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(iframeResult.kind, "unknown");
  assert.equal(iframeResult.code, "pin_keypad_unsupported");

  const withPasswordInput = documentFor(`
    <section><h2>캐치페이 비밀번호 입력</h2><p>비밀번호를 입력해 주세요</p>
      <button type="button">4</button><button type="button">5</button><button type="button">6</button>
      <button type="button">1</button><button type="button">3</button><button type="button">9</button>
      <button type="button">7</button><button type="button">8</button><button type="button">2</button>
      <button type="button">0</button>
      <button type="button">전체삭제</button>
      <button type="button" disabled>결제하기</button>
      <input type="password" />
    </section>
  `, FORM_URL);
  const passwordResult = new ReservationFormAdapter(withPasswordInput).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(passwordResult.kind, "unknown");
  assert.equal(passwordResult.code, "pin_keypad_unsupported");
});

test("PIN surface는 form path·same-origin·유일 keypad·전체삭제·내부 submit이 모두 유일해야 한다", () => {
  const wrongOrigin = documentFromFixture(
    "catchpay-pin.html",
    "https://example.com/ct/reservation/form",
  );
  assert.equal(
    new ReservationFormAdapter(wrongOrigin).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "unknown",
  );

  const wrongPath = documentFromFixture(
    "catchpay-pin.html",
    "https://app.catchtable.co.kr/ct/other",
  );
  assert.equal(
    new ReservationFormAdapter(wrongPath).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "unknown",
  );

  const duplicateHeading = documentFromFixture("catchpay-pin.html", FORM_URL);
  duplicateHeading.body.append(Object.assign(duplicateHeading.createElement("h2"), {
    textContent: "캐치페이 비밀번호 입력",
  }));
  assert.equal(
    new ReservationFormAdapter(duplicateHeading).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "pin",
  );

  const duplicateDialog = documentFromFixture("catchpay-pin.html", FORM_URL);
  duplicateDialog.body.append(duplicateDialog.querySelector('[role="dialog"]').cloneNode(true));
  assert.equal(
    new ReservationFormAdapter(duplicateDialog).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "unknown",
  );

  const missingClear = documentFromFixture("catchpay-pin.html", FORM_URL);
  [...missingClear.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "전체삭제")
    .remove();
  assert.equal(
    new ReservationFormAdapter(missingClear).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "unknown",
  );

  const duplicateSubmit = documentFromFixture("catchpay-pin.html", FORM_URL);
  const extra = duplicateSubmit.createElement("button");
  extra.textContent = "결제하기";
  duplicateSubmit.querySelector('[role="dialog"]').append(extra);
  assert.equal(
    new ReservationFormAdapter(duplicateSubmit).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION)).kind,
    "unknown",
  );
});

test("PIN digit action은 위치가 아니라 매 호출 시 현재 accessible text로 button을 다시 찾는다", () => {
  const document = documentFromFixture("catchpay-pin.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  // 실제 PIN처럼 보일 수 있는 리터럴을 소스에 남기지 않도록 자릿수를 런타임에 조합한다.
  const sentinelDigits = [7, 3, 0, 5].map(String);
  const clicked = [];
  document.querySelectorAll("button").forEach((button) => {
    const text = button.textContent?.trim() ?? "";
    if (/^\d$/.test(text)) button.addEventListener("click", () => clicked.push(text));
  });
  for (const digit of sentinelDigits) {
    // 매 호출 전 keypad DOM 순서를 재배치해 위치 기반 클릭이면 실패하도록 만든다.
    const container = document.querySelector('button:not([disabled])').closest("div");
    const buttons = [...container.querySelectorAll("button")];
    buttons.reverse().forEach((button) => container.appendChild(button));
    const acted = adapter.enterPinDigit(inspection.fingerprint, digit);
    assert.equal(acted, true);
  }
  assert.deepEqual(clicked, sentinelDigits);
});

test("submitInner는 내부 결제하기 버튼이 활성일 때만 클릭한다", () => {
  const document = documentFromFixture("catchpay-pin.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  const innerButton = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "결제하기");
  assert.equal(adapter.submitInner(inspection.fingerprint), false); // 비활성 상태
  innerButton.disabled = false;
  // 버튼이 활성화됐으므로 fingerprint가 stale해졌다 — 다시 inspect해야 한다.
  assert.equal(adapter.submitInner(inspection.fingerprint), false);
  const fresh = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  let clicks = 0;
  innerButton.addEventListener("click", () => { clicks += 1; });
  assert.equal(adapter.submitInner(fresh.fingerprint), true);
  assert.equal(clicks, 1);
});

// ---- success ----

test("success는 path, 정확한 완료 메시지와 매장·날짜·시간·인원 일치 목록을 각각 facts로 반환한다", () => {
  const document = documentFromFixture("catchpay-success.html", SUCCESS_URL);
  const pageHeading = document.createElement("h1");
  pageHeading.textContent = "마이다이닝";
  document.body.prepend(pageHeading);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "success");
  assert.deepEqual(inspection.facts, {
    path: "/ct/mydining/my/planned",
    matchedMessage: true,
    listingMatch: true,
  });
});

test("완료 문구가 일반 div의 strong·text·br·span으로 분할돼도 leaf exact text로 판정한다", () => {
  const document = documentFromFixture("catchpay-success.html", SUCCESS_URL);
  const message = document.createElement("div");
  message.innerHTML = "<strong>자동결제</strong>로\n<br>\n<span>예약을 완료했습니다</span>";
  const heading = document.querySelector("h2");
  heading.parentElement.append(document.createTextNode("후속 안내"));
  heading.replaceWith(message);

  const inspection = new ReservationFormAdapter(document)
    .inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "success");
  assert.equal(inspection.facts.matchedMessage, true);
  assert.equal(inspection.facts.listingMatch, true);
});

// site-behavior.md §12.22: 완료 문구에서 `자동결제`가 사라진 변형.
test("완료 문구가 `예약을 완료했습니다`인 변형도 세 조건을 모두 만족한다", () => {
  const document = documentFromFixture("catchpay-success-short-message.html", SUCCESS_URL);
  const inspection = new ReservationFormAdapter(document)
    .inspect(options(SUSHI_EXPECTATION, SUSHI_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "success");
  assert.deepEqual(inspection.facts, {
    path: "/ct/mydining/my/planned",
    matchedMessage: true,
    listingMatch: true,
  });
});

test("완료 문구 판정은 후속 안내를 함께 삼킨 부모 텍스트를 받지 않는다", () => {
  const document = documentFromFixture("catchpay-success-short-message.html", SUCCESS_URL);
  const span = [...document.querySelectorAll("span")]
    .find((element) => element.textContent === "예약을 완료했습니다");
  // 문구를 부모의 후속 안내 뒤로 옮기면 어떤 leaf도 문구로 끝나지 않는다.
  span.textContent = "예약을 완료했습니다 초대장을 보내 예약 정보를 공유해 주세요.";
  const inspection = new ReservationFormAdapter(document)
    .inspect(options(SUSHI_EXPECTATION, SUSHI_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "success");
  assert.equal(inspection.facts.matchedMessage, false);
});

test("성공 세 조건 각각 누락은 success·COMPLETED 근거가 아니다", () => {
  const wrongPathDoc = documentFromFixture("catchpay-success.html", "https://app.catchtable.co.kr/ct/mydining/my/history");
  const wrongPath = new ReservationFormAdapter(wrongPathDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.notEqual(wrongPath.kind, "success");

  const noMessageDoc = documentFromFixture("catchpay-success.html", SUCCESS_URL);
  noMessageDoc.querySelector("h2").textContent = "예약이 접수되었습니다";
  const noMessage = new ReservationFormAdapter(noMessageDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(noMessage.kind, "success");
  assert.equal(noMessage.facts.matchedMessage, false);

  const noListingDoc = documentFromFixture("catchpay-success.html", SUCCESS_URL);
  const listingItem = noListingDoc.querySelector("li");
  listingItem.querySelectorAll("p")[1].textContent = "2026.09.01 (화) · 오후 6:00 · 4명";
  const noListing = new ReservationFormAdapter(noListingDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(noListing.kind, "success");
  assert.equal(noListing.facts.listingMatch, false);
});
