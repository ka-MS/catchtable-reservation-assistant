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
const ZERO_EXPECTATION = { shopDisplayName: "우블랑", dateText: "08월 10일", timeText: "오후 12:00", personText: "2명" };
const ZERO_SUCCESS_EXPECTATION = {
  shopDisplayName: "우블랑", listingDateText: "2026.08.10 (월)", timeText: "오후 12:00", personText: "2명",
};
// 더피제리아마켓(B) 기대값 — site-behavior.md §12.6, header > h1/방문예정 표기는 §12.7-§12.8.
const PAID_EXPECTATION = {
  shopDisplayName: "더피제리아마켓 하남미사", dateText: "08월 11일", timeText: "오전 11:00", personText: "2명",
};
const PAID_SUCCESS_EXPECTATION = {
  shopDisplayName: "더피제리아마켓 하남미사", listingDateText: "2026.08.11 (화)", timeText: "오전 11:00", personText: "2명",
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

test("A(로그인 0원)는 CatchPay checked·등록 수단 행·일반결제 미선택, current 0원, 필수 10개, 빈 multiline 3개, optional 0개로 분류된다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "ready");
  assert.deepEqual(inspection.facts, {
    currentAmountKrw: 0,
    catchPayChecked: true,
    catchPayRegistered: true,
    generalPaymentSelected: false,
    requiredAgreementCount: 10,
    emptyRequiredMultilineCount: 3,
    optionalAgreementCount: 0,
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
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
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

// ---- 예약 intent 불일치 ----

test("날짜·시간·인원 불일치는 ready가 아니다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const wrongDate = adapter.inspect(options({ ...ZERO_EXPECTATION, dateText: "09월 01일" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongDate.kind, "unknown");
  assert.equal(wrongDate.code, "intent_mismatch");
  const wrongTime = adapter.inspect(options({ ...ZERO_EXPECTATION, timeText: "오후 6:00" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongTime.kind, "unknown");
  assert.equal(wrongTime.code, "intent_mismatch");
  const wrongPerson = adapter.inspect(options({ ...ZERO_EXPECTATION, personText: "4명" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongPerson.kind, "unknown");
  assert.equal(wrongPerson.code, "intent_mismatch");
});

// ---- 매장명(header > h1) 판정 — site-behavior.md §12.8, 20-design.md §4.3 ----

test("폼 매장명은 유일하고 비어 있지 않은 header > h1에서만 읽는다", () => {
  const document = documentFromFixture("catchpay-zero-form.html", FORM_URL);
  const adapter = new ReservationFormAdapter(document);
  const wrongShop = adapter.inspect(options({ ...ZERO_EXPECTATION, shopDisplayName: "다른매장" }, ZERO_SUCCESS_EXPECTATION));
  assert.equal(wrongShop.kind, "unknown");
  assert.equal(wrongShop.code, "intent_mismatch");
  const matching = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(matching.kind, "ready");
});

function withHeader(headerHtml) {
  return documentFor(`
    ${headerHtml}
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
    <section><p>결제금액</p><p>0원</p></section>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
}

test("header > h1 부재·중복·빈 값, document.title/본문 heading만 있는 변형은 매장 일치로 인정하지 않는다", () => {
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

  // 본문의 다른 heading(h2 등)에 매장명이 있어도 header > h1이 아니면 인정하지 않는다.
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
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
    <section><p>결제금액</p><p>0원</p></section>
    <p>예약 찜 시간이 만료되었습니다. 예약현황에 따라 예약이 어려울 수 있습니다.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
  const expired = new ReservationFormAdapter(expiredDoc).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(expired.kind, "hold_expired");

  const unknownCountdownDoc = documentFor(`
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
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
    ${paymentSection}
    <section><p>결제금액</p><p>0원</p></section>
    <p>7분간 예약 찜! 시간 내 예약을 완료해주세요.</p>
    <button type="button">자동결제로 예약하기</button>
  `, FORM_URL);
}

test("CatchPay 미선택·미등록·일반결제 선택은 ready가 아니다", () => {
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
  assert.equal(notRegisteredResult.kind, "unknown");
  assert.equal(notRegisteredResult.code, "catchpay_not_ready");

  const generalSelected = catchPayVariant(`
    <label><input type="radio" name="payment-type" />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" checked />일반결제</label>
  `);
  const generalSelectedResult = new ReservationFormAdapter(generalSelected).inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(generalSelectedResult.kind, "unknown");
  assert.equal(generalSelectedResult.code, "catchpay_not_ready");
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

test("group member가 정확히 required 3개이고 optional 0개일 때만 모두 동의합니다를 사용할 수 있다", () => {
  const document = documentFromFixture("catchpay-paid-form.html", PAID_FORM_URL);
  // 개별 [필수] 3개를 모두 미리 체크해 그룹 control만 남긴다.
  [...document.querySelectorAll("label")]
    .filter((label) => (label.textContent ?? "").includes("[필수]"))
    .forEach((label) => { label.querySelector("input").checked = true; });
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(PAID_EXPECTATION, PAID_SUCCESS_EXPECTATION));
  const groupInput = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "모두 동의합니다")
    .querySelector("input");
  assert.equal(groupInput.checked, false);
  const acted = adapter.agreeRequired(inspection.fingerprint);
  assert.equal(acted, true);
  assert.equal(groupInput.checked, true);
});

test("optional이 섞이거나 membership가 불명인 group은 클릭하지 않는다", () => {
  const document = documentFor(`
    <header><h1>우블랑</h1><button type="button">닫기</button></header>
    <section><p>예약 정보</p><p>08월 10일 (월) · 오후 12시 · 2명</p></section>
    <section><p>08월 10일(월) · 오후 12:00 · 2명</p></section>
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
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
    <label><input type="radio" name="payment-type" checked />캐치페이</label>
    <p>이 카드로 식사 금액이 자동결제 됩니다.</p>
    <label><input type="radio" name="payment-type" disabled />일반결제</label>
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
  });
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
  const adapter = new ReservationFormAdapter(document);
  const inspection = adapter.inspect(options(ZERO_EXPECTATION, ZERO_SUCCESS_EXPECTATION));
  assert.equal(inspection.kind, "success");
  assert.deepEqual(inspection.facts, {
    path: "/ct/mydining/my/planned",
    matchedMessage: true,
    listingMatch: true,
  });
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
