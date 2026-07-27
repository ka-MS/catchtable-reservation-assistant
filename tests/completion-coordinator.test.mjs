import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { CompletionCoordinator } from "../dist/content/completion-coordinator.js";
import { ReservationFormAdapter } from "../dist/content/adapter/reservation-form.js";

const FORM_URL = "https://app.catchtable.co.kr/ct/reservation/form?isDepositFree=1";
const INTENT = {
  shopSlug: "woo_blanc_",
  shopDisplayName: "우블랑",
  reservationDate: "2026-08-10",
  selectedMinutes: 720,
  personCount: 2,
};

function fixture(name) {
  return readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
}

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/woo_blanc_",
    openAtMs: 1,
    reservationDate: "2026-08-10",
    personCount: 2,
    timeRange: { startMinutes: 660, endMinutes: 1260 },
    priorityTimes: [],
    postSlotEnabled: true,
    paymentMethodAutoAdvance: true,
    paymentMethodPolicy: "selected_allowed",
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: 999_999,
    entryMode: "auto",
    dryRun: false,
    preOpenLeadMs: 0,
    toggleIntervalMs: 100,
    availabilityProbeMode: "off",
    reservationCompletionEnabled: true,
    maxPaymentAmountKrw: 500_000,
    requiredFormDefaultAnswer: "없음",
    ...overrides,
  };
}

function harness(document, onSleep = () => {}) {
  let now = 100;
  const claims = [];
  const telemetry = [];
  const coordinator = new CompletionCoordinator({
    adapter: new ReservationFormAdapter(document),
    now: () => now,
    sleep: async (ms, signal) => {
      now += ms;
      onSleep();
      return !signal.aborted;
    },
    claim: async (phase, fingerprint) => {
      claims.push({ phase, fingerprint });
      return true;
    },
    telemetry: (phase, attributes) => telemetry.push({ phase, attributes }),
  });
  return { coordinator, claims, telemetry };
}

function showSuccess(document, name) {
  document.defaultView.history.pushState({}, "", "/ct/mydining/my/planned");
  document.documentElement.innerHTML = fixture(name);
}

test("0원 폼은 필수 입력·약관 뒤 outer claim 1회와 성공 근거로 완료한다", async () => {
  const document = new JSDOM(fixture("catchpay-zero-form.html"), { url: FORM_URL }).window.document;
  let outerClicks = 0;
  let authorizationTakes = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => {
      assert.equal(authorizationTakes, 1, "0원 제출 전에 one-shot authorization을 폐기해야 한다");
      outerClicks += 1;
      showSuccess(document, "catchpay-success.html");
    });
  const { coordinator, claims, telemetry } = harness(document);
  const result = await coordinator.run(config(), INTENT, new AbortController().signal, () => {
    authorizationTakes += 1;
    return ["9", "8", "7", "6"].join("");
  });
  assert.equal(result.kind, "completed", JSON.stringify(result));
  assert.equal(outerClicks, 1);
  assert.equal(authorizationTakes, 1);
  assert.deepEqual(claims.map((claim) => claim.phase), ["outer"]);
  assert.deepEqual(telemetry.map((event) => event.phase), [
    "form_ready", "outer_claim", "outer_dispatch", "success_observed",
  ]);
  assert.equal(telemetry[0].attributes.catchPaySelected, true);
  assert.equal(telemetry[0].attributes.generalPaymentSelected, false);
  assert.equal([...document.querySelectorAll('input[type="checkbox"]')]
    .filter((input) => (input.closest("label")?.textContent ?? "").includes("[선택]"))
    .some((input) => input.checked), false);
});

test("required-only group의 지연 반영을 bounded 확인하고 재클릭 없이 완료한다", async () => {
  const document = new JSDOM(fixture("catchpay-paid-form.html"), { url: FORM_URL }).window.document;
  const requiredLabels = [...document.querySelectorAll("label")]
    .filter((label) => (label.textContent ?? "").includes("[필수]"));
  requiredLabels.forEach((label) => { label.querySelector("input").checked = true; });
  const blockedRequired = requiredLabels.at(-1).querySelector("input");
  blockedRequired.checked = false;
  blockedRequired.addEventListener("click", (event) => event.preventDefault());
  const groupLabel = [...document.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "모두 동의합니다");
  groupLabel.lastChild.textContent = "모두 동의합니다.";
  const groupInput = groupLabel.querySelector("input");
  let groupClicks = 0;
  let pendingGroupCommit = false;
  groupInput.addEventListener("click", () => {
    groupClicks += 1;
    pendingGroupCommit = true;
  });
  let outerClicks = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => {
      outerClicks += 1;
      showSuccess(document, "catchpay-success.html");
      const paragraphs = document.querySelectorAll("li p");
      paragraphs[0].textContent = "더피제리아마켓 하남미사";
      paragraphs[1].textContent = "2026.08.11 (화) · 오전 11:00 · 2명";
    });
  const { coordinator } = harness(document, () => {
    if (!pendingGroupCommit) return;
    pendingGroupCommit = false;
    requiredLabels.forEach((label) => { label.querySelector("input").checked = true; });
  });
  const paidIntent = {
    ...INTENT,
    shopSlug: "pizzeriamarket",
    shopDisplayName: "더피제리아마켓 하남미사",
    reservationDate: "2026-08-11",
    selectedMinutes: 660,
  };
  const result = await coordinator.run(
    config(),
    paidIntent,
    new AbortController().signal,
    () => ["1", "2", "3", "4"].join(""),
  );
  assert.equal(result.kind, "completed", JSON.stringify(result));
  assert.equal(groupClicks, 1);
  assert.equal(outerClicks, 1);
});

test("유료 폼은 one-shot PIN이 없으면 outer claim과 클릭 전에 인계한다", async () => {
  const document = new JSDOM(fixture("catchpay-paid-form.html"), { url: FORM_URL }).window.document;
  let outerClicks = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => { outerClicks += 1; });
  const { coordinator, claims } = harness(document);
  const paidIntent = {
    ...INTENT,
    shopSlug: "pizzeriamarket",
    shopDisplayName: "더피제리아마켓 하남미사",
    reservationDate: "2026-08-11",
    selectedMinutes: 660,
  };
  const result = await coordinator.run(config(), paidIntent, new AbortController().signal, () => undefined);
  assert.equal(result.kind, "handed_off");
  assert.equal(outerClicks, 0);
  assert.equal(claims.length, 0);
});

test("유료 폼은 outer·pin claim을 각각 한 번만 받은 뒤 성공 근거로 완료한다", async () => {
  const document = new JSDOM(fixture("catchpay-paid-form.html"), { url: FORM_URL }).window.document;
  let innerClicks = 0;
  const paidIntent = {
    ...INTENT,
    shopSlug: "pizzeriamarket",
    shopDisplayName: "더피제리아마켓 하남미사",
    reservationDate: "2026-08-11",
    selectedMinutes: 660,
  };
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => {
      const pinDocument = new JSDOM(fixture("catchpay-pin.html"), { url: FORM_URL }).window.document;
      document.body.append(document.importNode(pinDocument.querySelector('[role="dialog"]'), true));
      let digits = 0;
      for (const button of document.querySelectorAll("button")) {
        if (/^\d$/.test(button.textContent?.trim() ?? "")) {
          button.addEventListener("click", () => {
            digits += 1;
            if (digits === 4) {
              [...document.querySelectorAll("button")]
                .find((candidate) => candidate.textContent?.trim() === "결제하기").disabled = false;
            }
          });
        }
      }
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "결제하기")
        .addEventListener("click", () => { innerClicks += 1; });
    });
  const { coordinator, claims, telemetry } = harness(document, () => {
    if (innerClicks > 0 && document.location.pathname !== "/ct/mydining/my/planned") {
      showSuccess(document, "catchpay-success.html");
      const paragraphs = document.querySelectorAll("li p");
      paragraphs[0].textContent = "더피제리아마켓 하남미사";
      paragraphs[1].textContent = "2026.08.11 (화) · 오전 11:00 · 2명";
    }
  });
  const testPin = ["1", "2", "3", "4"].join("");
  const result = await coordinator.run(config(), paidIntent, new AbortController().signal, () => testPin);
  assert.equal(result.kind, "completed", JSON.stringify(result));
  assert.deepEqual(claims.map((claim) => claim.phase), ["outer", "pin"]);
  assert.equal(claims[1].fingerprint, claims[0].fingerprint,
    "Background durable claim은 outer와 pin에 같은 예약 fingerprint를 요구한다");
  assert.equal(JSON.stringify(claims).includes(testPin), false);
  assert.deepEqual(telemetry.map((event) => event.phase), [
    "form_ready",
    "payment_authorization",
    "outer_claim",
    "outer_dispatch",
    "pin_surface",
    "pin_claim",
    "pin_dispatch",
    "success_observed",
  ]);
  assert.equal(telemetry[1].attributes.paymentPinProvided, true);
  assert.equal(JSON.stringify(telemetry).includes(testPin), false);
});

test("PIN overlay 아래 결제금액이 바뀌면 digit·pin claim·내부 제출을 하지 않는다", async () => {
  const document = new JSDOM(fixture("catchpay-paid-form.html"), { url: FORM_URL }).window.document;
  const paidIntent = {
    ...INTENT,
    shopSlug: "pizzeriamarket",
    shopDisplayName: "더피제리아마켓 하남미사",
    reservationDate: "2026-08-11",
    selectedMinutes: 660,
  };
  let digitClicks = 0;
  let innerClicks = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => {
      const amountLabel = [...document.querySelectorAll("p, dt, span, div, h1, h2, h3")]
        .find((element) => element.textContent?.trim() === "총 결제 금액");
      amountLabel.nextElementSibling.textContent = "30,000원";
      const pinDocument = new JSDOM(fixture("catchpay-pin.html"), { url: FORM_URL }).window.document;
      const dialog = document.importNode(pinDocument.querySelector('[role="dialog"]'), true);
      for (const button of dialog.querySelectorAll("button")) {
        if (/^\d$/.test(button.textContent?.trim() ?? "")) {
          button.addEventListener("click", () => { digitClicks += 1; });
        }
      }
      dialog.querySelector("button:last-of-type")?.addEventListener("click", () => { innerClicks += 1; });
      document.body.append(dialog);
    });
  const { coordinator, claims } = harness(document);
  const result = await coordinator.run(
    config(),
    paidIntent,
    new AbortController().signal,
    () => ["1", "2", "3", "4"].join(""),
  );
  assert.equal(result.kind, "handed_off");
  assert.equal(digitClicks, 0);
  assert.equal(innerClicks, 0);
  assert.deepEqual(claims.map((claim) => claim.phase), ["outer"]);
});

test("outer 제출 뒤 비지원 PIN surface는 대기·입력·pin claim 없이 즉시 결과불명 인계한다", async () => {
  const document = new JSDOM(fixture("catchpay-paid-form.html"), { url: FORM_URL }).window.document;
  const paidIntent = {
    ...INTENT,
    shopSlug: "pizzeriamarket",
    shopDisplayName: "더피제리아마켓 하남미사",
    reservationDate: "2026-08-11",
    selectedMinutes: 660,
  };
  let digitClicks = 0;
  let sleeps = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => {
      const pinDocument = new JSDOM(fixture("catchpay-pin.html"), { url: FORM_URL }).window.document;
      const dialog = document.importNode(pinDocument.querySelector('[role="dialog"]'), true);
      const digit = [...dialog.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "0");
      digit.remove();
      for (const button of dialog.querySelectorAll("button")) {
        if (/^\d$/.test(button.textContent?.trim() ?? "")) {
          button.addEventListener("click", () => { digitClicks += 1; });
        }
      }
      document.body.append(dialog);
      sleeps = 0;
    });
  const { coordinator, claims } = harness(document, () => { sleeps += 1; });
  const result = await coordinator.run(
    config(),
    paidIntent,
    new AbortController().signal,
    () => ["1", "2", "3", "4"].join(""),
  );

  assert.equal(result.kind, "handed_off");
  assert.equal(result.claimed, true);
  assert.match(result.message, /PIN 키패드 구조/);
  assert.equal(sleeps, 0);
  assert.equal(digitClicks, 0);
  assert.deepEqual(claims.map((claim) => claim.phase), ["outer"]);
});

test("선택 약관의 checked 대상이 바뀌면 같은 선택 개수여도 제출하지 않는다", async () => {
  const document = new JSDOM(fixture("catchpay-zero-form.html"), { url: FORM_URL }).window.document;
  const optionalArea = document.createElement("section");
  optionalArea.innerHTML = `
    <label><input type="checkbox" checked />[선택] 소식 A</label>
    <label><input type="checkbox" />[선택] 소식 B</label>
  `;
  document.body.append(optionalArea);
  const [first, second] = optionalArea.querySelectorAll('input[type="checkbox"]');
  document.querySelector("textarea").addEventListener("input", () => {
    first.checked = false;
    second.checked = true;
  }, { once: true });
  let outerClicks = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => { outerClicks += 1; });
  const { coordinator, claims } = harness(document);
  const result = await coordinator.run(config(), INTENT, new AbortController().signal, () => undefined);
  assert.equal(result.kind, "handed_off");
  assert.equal(outerClicks, 0);
  assert.equal(claims.length, 0);
});

test("pre-claim stopAt에 도달했으면 outer claim과 클릭 없이 TIMED_OUT이다", async () => {
  const document = new JSDOM(fixture("catchpay-zero-form.html"), { url: FORM_URL }).window.document;
  let outerClicks = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => { outerClicks += 1; });
  const { coordinator, claims } = harness(document);
  const result = await coordinator.run(
    config({ stopAtMs: 100 }),
    INTENT,
    new AbortController().signal,
    () => undefined,
  );
  assert.equal(result.kind, "timed_out");
  assert.equal(outerClicks, 0);
  assert.equal(claims.length, 0);
});

test("outer claim이 거절되면 제출 버튼을 클릭하지 않는다", async () => {
  const document = new JSDOM(fixture("catchpay-zero-form.html"), { url: FORM_URL }).window.document;
  let clicks = 0;
  [...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "자동결제로 예약하기")
    .addEventListener("click", () => { clicks += 1; });
  let now = 0;
  const coordinator = new CompletionCoordinator({
    adapter: new ReservationFormAdapter(document),
    now: () => now,
    sleep: async (ms) => { now += ms; return true; },
    claim: async () => false,
  });
  const result = await coordinator.run(config(), INTENT, new AbortController().signal, () => undefined);
  assert.equal(result.kind, "handed_off");
  assert.equal(clicks, 0);
});

test("outer claim 뒤 예외는 secret을 노출하지 않고 결과불명 인계한다", async () => {
  const document = new JSDOM(fixture("catchpay-paid-form.html"), { url: FORM_URL }).window.document;
  const adapter = new ReservationFormAdapter(document);
  const testPin = ["8", "6", "4", "2"].join("");
  adapter.submitOuter = () => {
    throw new Error(`site handler failed: ${testPin}`);
  };
  let now = 100;
  const claims = [];
  const coordinator = new CompletionCoordinator({
    adapter,
    now: () => now,
    sleep: async (ms) => { now += ms; return true; },
    claim: async (phase, fingerprint) => {
      claims.push({ phase, fingerprint });
      return true;
    },
  });
  const paidIntent = {
    ...INTENT,
    shopSlug: "pizzeriamarket",
    shopDisplayName: "더피제리아마켓 하남미사",
    reservationDate: "2026-08-11",
    selectedMinutes: 660,
  };

  const result = await coordinator.run(config(), paidIntent, new AbortController().signal, () => testPin);

  assert.equal(result.kind, "handed_off");
  assert.equal(result.claimed, true);
  assert.match(result.message, /자동 재제출하지 않습니다/);
  assert.equal(JSON.stringify(result).includes(testPin), false);
  assert.deepEqual(claims.map((claim) => claim.phase), ["outer"]);
});
