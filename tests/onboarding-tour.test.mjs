import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  ONBOARDING_VERSION,
  OnboardingTour,
  shouldOfferOnboarding,
} from "../dist/sidepanel/onboarding-tour.js";

async function createTour(onExit = () => {}) {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  return {
    dom,
    tour: new OnboardingTour(dom.window.document, onExit),
  };
}

test("onboarding offer appears only before the current version is seen", () => {
  assert.equal(ONBOARDING_VERSION, 1);
  assert.equal(shouldOfferOnboarding(undefined), true);
  assert.equal(shouldOfferOnboarding(0), true);
  assert.equal(shouldOfferOnboarding(1), false);
  assert.equal(shouldOfferOnboarding(2), false);
  assert.equal(shouldOfferOnboarding("1"), true);
});

test("tour stylesheet blocks user scrolling while the guide remains interactive", async () => {
  const css = await readFile("dist/sidepanel/sidepanel.css", "utf8");

  assert.match(
    css,
    /html\[data-onboarding="active"\],\s*body\[data-onboarding="active"\]\s*{[^}]*overflow:\s*hidden/s,
  );
  assert.match(css, /\.onboarding-scrim\s*{[^}]*touch-action:\s*none/s);
});

test("tour moves through the actual Side Panel targets without changing form values", async () => {
  const { dom, tour } = await createTour();
  const document = dom.window.document;
  const targetUrl = document.getElementById("target-url");
  targetUrl.value = "https://app.catchtable.co.kr/ct/shop/keep-this-value";

  tour.start(document.getElementById("form-title"));

  assert.equal(document.getElementById("onboarding-tour").hidden, false);
  assert.equal(document.getElementById("onboarding-scrim").hidden, false);
  assert.equal(document.documentElement.dataset.onboarding, "active");
  assert.equal(document.querySelector(".app-header").hasAttribute("inert"), true);
  assert.equal(document.querySelector("main").hasAttribute("inert"), true);
  assert.equal(document.getElementById("action-bar").hasAttribute("inert"), true);
  assert.equal(document.getElementById("onboarding-progress").textContent, "1 / 8");
  assert.equal(document.getElementById("onboarding-title").textContent, "새 예약 작업");
  assert.equal(
    document.getElementById("onboarding-description").textContent,
    "예약할 식당과 일정, 원하는 시간, 진행 범위와 실행 방식을 순서대로 설정합니다.",
  );
  assert.equal(document.getElementById("form-tour-heading").classList.contains("onboarding-target"), true);
  assert.equal(document.getElementById("onboarding-previous").disabled, true);

  document.getElementById("onboarding-next").click();
  assert.equal(document.getElementById("onboarding-progress").textContent, "2 / 8");
  assert.equal(document.getElementById("form-tour-heading").classList.contains("onboarding-target"), false);
  assert.equal(document.getElementById("reservation-when-card").classList.contains("onboarding-target"), true);
  assert.match(document.getElementById("onboarding-description").textContent, /캐치테이블 URL을 입력하세요/);
  assert.match(document.getElementById("onboarding-description").textContent, /열어 둔 경우/);

  document.getElementById("onboarding-previous").click();
  assert.equal(document.getElementById("onboarding-progress").textContent, "1 / 8");
  assert.equal(targetUrl.value, "https://app.catchtable.co.kr/ct/shop/keep-this-value");

  for (let index = 1; index < 6; index += 1) {
    document.getElementById("onboarding-next").click();
  }
  assert.equal(document.getElementById("onboarding-title").textContent, "실행 모드");
  assert.match(document.getElementById("onboarding-description").textContent, /테스트 작동/);
  assert.match(document.getElementById("onboarding-description").textContent, /실제 예약에서는 끈 상태/);

  document.getElementById("onboarding-next").click();
  assert.equal(document.getElementById("onboarding-progress").textContent, "7 / 8");
  assert.equal(document.getElementById("action-bar").classList.contains("onboarding-target"), false);
  assert.equal(document.getElementById("action-bar").hasAttribute("inert"), true);
  assert.equal(document.getElementById("onboarding-tour").dataset.placement, "top");
});

test("last step completes once and clears the highlighted target", async () => {
  let exits = 0;
  const { dom, tour } = await createTour(() => { exits += 1; });
  const document = dom.window.document;
  const scrollCalls = [];
  dom.window.scrollTo = (options) => { scrollCalls.push(options); };
  const returnFocus = document.getElementById("onboarding-help");
  returnFocus.disabled = false;
  tour.start(returnFocus);

  for (let index = 1; index < 8; index += 1) {
    document.getElementById("onboarding-next").click();
  }
  assert.equal(document.getElementById("onboarding-next").textContent, "완료");
  assert.equal(document.getElementById("onboarding-help").classList.contains("onboarding-target"), true);

  document.getElementById("onboarding-next").click();
  assert.equal(exits, 1);
  assert.equal(document.getElementById("onboarding-tour").hidden, true);
  assert.equal(document.getElementById("onboarding-scrim").hidden, true);
  assert.equal(document.documentElement.dataset.onboarding, undefined);
  assert.equal(document.querySelector(".app-header").hasAttribute("inert"), false);
  assert.equal(document.querySelector("main").hasAttribute("inert"), false);
  assert.equal(document.getElementById("action-bar").hasAttribute("inert"), false);
  assert.equal(document.querySelector(".onboarding-target"), null);
  assert.equal(tour.active, false);
  assert.equal(document.activeElement, returnFocus);
  assert.deepEqual(scrollCalls, [{ top: 0, left: 0, behavior: "auto" }]);
});

test("Escape exits an active tour", async () => {
  let exits = 0;
  const { dom, tour } = await createTour(() => { exits += 1; });
  const returnFocus = dom.window.document.getElementById("form-title");
  const focus = returnFocus.focus.bind(returnFocus);
  let focusOptions;
  returnFocus.focus = (options) => {
    focusOptions = options;
    focus(options);
  };
  tour.start(returnFocus);

  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));

  assert.equal(exits, 1);
  assert.equal(tour.active, false);
  assert.equal(dom.window.document.getElementById("onboarding-scrim").hidden, true);
  assert.equal(dom.window.document.documentElement.dataset.onboarding, undefined);
  assert.equal(dom.window.document.querySelector("main").hasAttribute("inert"), false);
  assert.equal(dom.window.document.activeElement, returnFocus);
  assert.deepEqual(focusOptions, { preventScroll: true });
});

test("onboarding entry stays unavailable until stored state initialization completes", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  const source = await readFile("dist/sidepanel/index.js", "utf8");

  assert.match(html, /id="onboarding-help"[^>]*disabled/);
  assert.match(html, /id="form-title"[^>]*tabindex="-1"/);
  assert.match(source, /if \(!onboardingReady\)\s*return;/);
  assert.match(source, /onboardingReady = true;\s*onboardingHelp\.disabled = false;/);
});
