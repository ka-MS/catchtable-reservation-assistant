import assert from "node:assert/strict";
import test from "node:test";
import { CalendarAdapter } from "../dist/content/adapter/calendar.js";
import { loadFixture } from "./fixture-helper.mjs";

test("calendar inspection finds the selected target and nearest available date", async () => {
  const dom = await loadFixture("calendar.html");
  const adapter = new CalendarAdapter(dom.window.document);
  assert.deepEqual(adapter.inspect("2026-07-30"), {
    targetAvailable: true,
    targetSelected: true,
    adjacentDate: "2026-07-29",
  });
});

test("calendar click re-resolves the measured date cell", async () => {
  const dom = await loadFixture("calendar.html");
  const adapter = new CalendarAdapter(dom.window.document);
  let clicks = 0;
  dom.window.document.querySelector('[aria-label*="7월 29"]')?.addEventListener("click", () => clicks++);
  assert.equal(adapter.clickDate("2026-07-29"), true);
  assert.equal(clicks, 1);
  assert.equal(adapter.clickDate("2026-07-31"), false);
});

test("calendar inspection refuses to invent an adjacent date", async () => {
  const dom = await loadFixture("calendar-no-adjacent.html");
  const adapter = new CalendarAdapter(dom.window.document);
  assert.equal(adapter.inspect("2026-07-30").adjacentDate, null);
});

test("calendar preparation waits for a month transition before another click", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const next = dom.window.document.querySelector('[aria-label="Next page"]');
  let clicks = 0;
  next.addEventListener("click", () => { clicks += 1; });

  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  assert.equal(adapter.prepareTarget("2026-09-10").status, "waiting");
  assert.equal(clicks, 1);

  const month = Array.from(dom.window.document.querySelectorAll("button"))
    .find((button) => button.textContent.replace(/\s+/g, "") === "2026년7월");
  month.replaceChildren("2026년 8월");
  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  assert.equal(clicks, 2);
});

test("calendar preparation retries a month click that produced no visible transition", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const next = dom.window.document.querySelector('[aria-label="Next page"]');
  let clicks = 0;
  let now = 0;
  next.addEventListener("click", () => { clicks += 1; });
  const adapter = new CalendarAdapter(dom.window.document, () => now);

  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  now = 500;
  assert.equal(adapter.prepareTarget("2026-09-10").status, "waiting");
  now = 750;
  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  assert.equal(clicks, 2);
});

test("calendar preparation bounds retries when the displayed month never changes", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const next = dom.window.document.querySelector('[aria-label="Next page"]');
  let clicks = 0;
  let now = 0;
  next.addEventListener("click", () => { clicks += 1; });
  const adapter = new CalendarAdapter(dom.window.document, () => now);

  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  now = 750;
  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  now = 1_500;
  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  now = 2_250;
  assert.deepEqual(adapter.prepareTarget("2026-09-10"), {
    status: "blocked",
    message: "달력 월 전환을 확인할 수 없습니다.",
  });
  assert.equal(clicks, 3);
});

test("calendar preparation advances across multiple displayed months", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const month = Array.from(dom.window.document.querySelectorAll("button"))
    .find((button) => button.textContent.replace(/\s+/g, "") === "2026년7월");
  const adapter = new CalendarAdapter(dom.window.document);

  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  month.replaceChildren("2026년 8월");
  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  month.replaceChildren("2026년 9월");
  const target = dom.window.document.createElement("div");
  target.setAttribute("role", "button");
  target.setAttribute("aria-label", "목요일, 9월 10, 2026");
  target.setAttribute("aria-pressed", "false");
  target.addEventListener("click", () => target.setAttribute("aria-pressed", "true"));
  dom.window.document.querySelector("section").append(target);

  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  assert.equal(adapter.prepareTarget("2026-09-10").status, "ready");
});

test("calendar preparation keeps waiting through a transient missing month heading", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const month = Array.from(dom.window.document.querySelectorAll("button"))
    .find((button) => button.textContent.replace(/\s+/g, "") === "2026년7월");
  let now = 0;
  const adapter = new CalendarAdapter(dom.window.document, () => now);

  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
  month.replaceChildren();
  now = 100;
  assert.equal(adapter.prepareTarget("2026-09-10").status, "waiting");
  month.replaceChildren("2026년 8월");
  assert.equal(adapter.prepareTarget("2026-09-10").status, "acted");
});

test("calendar preparation selects a rendered target and blocks a disabled target", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const target = dom.window.document.querySelector('[aria-label*="7월 30"]');
  target.addEventListener("click", () => target.setAttribute("aria-pressed", "true"));

  assert.equal(adapter.prepareTarget("2026-07-30").status, "acted");
  assert.equal(adapter.prepareTarget("2026-07-30").status, "ready");

  target.setAttribute("aria-pressed", "false");
  target.setAttribute("aria-disabled", "true");
  assert.equal(adapter.prepareTarget("2026-07-30").status, "blocked");
});

test("calendar preparation reset isolates the same target across consecutive runs", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const target = dom.window.document.querySelector('[aria-label*="7월 30"]');
  let clicks = 0;
  target.addEventListener("click", () => { clicks += 1; });

  assert.equal(adapter.prepareTarget("2026-07-30").status, "acted");
  assert.equal(adapter.prepareTarget("2026-07-30").status, "waiting");
  adapter.resetPreparation();
  assert.equal(adapter.prepareTarget("2026-07-30").status, "acted");
  assert.equal(clicks, 2);
});

test("calendar preparation retries a stalled date once and then blocks", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const target = dom.window.document.querySelector('[aria-label*="7월 30"]');
  let clicks = 0;
  let now = 0;
  target.addEventListener("click", () => { clicks += 1; });
  const adapter = new CalendarAdapter(dom.window.document, () => now);

  assert.equal(adapter.prepareTarget("2026-07-30").status, "acted");
  now = 999;
  assert.equal(adapter.prepareTarget("2026-07-30").status, "waiting");
  now = 1_000;
  assert.deepEqual(adapter.prepareTarget("2026-07-30"), {
    status: "acted",
    message: "2026-07-30 날짜 선택을 재시도했습니다.",
  });
  now = 2_000;
  assert.deepEqual(adapter.prepareTarget("2026-07-30"), {
    status: "blocked",
    message: "목표 날짜 선택 전환을 확인할 수 없습니다.",
    errorCode: "DATE_SELECTION_STALLED",
  });
  assert.equal(clicks, 2);
});

test("calendar preparation accepts the selected postcondition after a date retry", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const target = dom.window.document.querySelector('[aria-label*="7월 30"]');
  let now = 0;
  let clicks = 0;
  target.addEventListener("click", () => {
    clicks += 1;
    if (clicks === 2) target.setAttribute("aria-pressed", "true");
  });
  const adapter = new CalendarAdapter(dom.window.document, () => now);

  assert.equal(adapter.prepareTarget("2026-07-30").status, "acted");
  now = 1_000;
  assert.equal(adapter.prepareTarget("2026-07-30").status, "acted");
  assert.equal(adapter.prepareTarget("2026-07-30").status, "ready");
  assert.equal(clicks, 2);
});

test("Mobiscroll calendar inspection uses only the active grid", async () => {
  const dom = await loadFixture("calendar-mobiscroll.html");
  const adapter = new CalendarAdapter(dom.window.document);

  assert.deepEqual(adapter.inspect("2026-07-23"), {
    targetAvailable: true,
    targetSelected: true,
    adjacentDate: "2026-07-22",
  });
});

test("Mobiscroll calendar click re-resolves a measured date", async () => {
  const dom = await loadFixture("calendar-mobiscroll.html");
  const document = dom.window.document;
  const adapter = new CalendarAdapter(document);
  const active = document.querySelector(".mbsc-calendar-table-active");
  const target = Array.from(active.querySelectorAll(".mbsc-calendar-day"))
    .find((cell) => cell.textContent.trim() === "22");
  let clicks = 0;
  target.addEventListener("click", () => { clicks += 1; });

  assert.equal(adapter.clickDate("2026-07-22"), true);
  assert.equal(clicks, 1);
});

test("Mobiscroll calendar rejects a disabled target and a malformed grid", async () => {
  const dom = await loadFixture("calendar-mobiscroll.html");
  const adapter = new CalendarAdapter(dom.window.document);

  assert.equal(adapter.prepareTarget("2026-07-13").status, "blocked");

  dom.window.document.querySelector(".mbsc-calendar-table-active .mbsc-calendar-day")?.remove();
  assert.deepEqual(adapter.inspect("2026-07-23"), {
    targetAvailable: false,
    targetSelected: false,
    adjacentDate: null,
  });
});

test("Mobiscroll calendar rejects an ambiguous displayed month", async () => {
  const dom = await loadFixture("calendar-mobiscroll.html");
  dom.window.document.querySelector("section")?.insertAdjacentHTML("afterbegin", "<button>2026년 8월</button>");

  assert.equal(new CalendarAdapter(dom.window.document).inspect("2026-07-23").targetAvailable, false);
});

test("inspectPreparation은 표시 월·목표 셀·월 이동 방향 사실을 반환한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const facts = adapter.inspectPreparation("2126-01-10"); // fixture 표시 월보다 먼 미래 → Next page
  assert.equal(facts.displayedMonth, "2026-07");
  assert.equal(facts.target, null);
  assert.deepEqual(facts.monthNavigation, { direction: "Next page", available: true });
});

test("clickMonth는 해당 방향 버튼을 한 번 클릭한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  let clicked = 0;
  dom.window.document.querySelector('button[aria-label="Next page"]')
    .addEventListener("click", () => { clicked += 1; });
  assert.equal(adapter.clickMonth("Next page"), true);
  assert.equal(clicked, 1);
});

// 아래 사실 단언들은 prepareTarget 테스트(Task 6에서 삭제)가 커버하던 DOM 판독
// 시나리오의 보존 변환이다. 월 전환 750ms×3 재시도는 preparation-step-runner.test.mjs의
// progressKey 리셋 케이스가, 날짜 1s×2 재시도는 runner exhausted 케이스가 커버한다.
test("inspectPreparation: 같은 월인데 목표 셀 없음은 이동 없는 사실로 보고한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const facts = adapter.inspectPreparation("2026-07-15");
  assert.equal(facts.displayedMonth, "2026-07");
  assert.equal(facts.target, null);
  assert.equal(facts.monthNavigation, null);
});

test("inspectPreparation: disabled 목표 날짜는 available=false 사실로 보고한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const target = dom.window.document.querySelector('[aria-label*="7월 30"]');
  target.setAttribute("aria-pressed", "false");
  target.setAttribute("aria-disabled", "true");
  const adapter = new CalendarAdapter(dom.window.document);
  assert.deepEqual(adapter.inspectPreparation("2026-07-30").target, { available: false, selected: false });
});

test("inspectPreparation: 월 제목 판독 불가는 displayedMonth null 사실이다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const month = Array.from(dom.window.document.querySelectorAll("button"))
    .find((button) => button.textContent.replace(/\s+/g, "") === "2026년7월");
  month.replaceChildren();
  const adapter = new CalendarAdapter(dom.window.document);
  assert.deepEqual(adapter.inspectPreparation("2026-09-10"),
    { displayedMonth: null, target: null, monthNavigation: null });
});

test("inspectPreparation: 월 이동 control 부재·disabled는 available=false 사실이다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const next = dom.window.document.querySelector('button[aria-label="Next page"]');
  next.setAttribute("aria-disabled", "true");
  const adapter = new CalendarAdapter(dom.window.document);
  assert.deepEqual(adapter.inspectPreparation("2026-09-10").monthNavigation,
    { direction: "Next page", available: false });
  next.remove();
  assert.deepEqual(adapter.inspectPreparation("2026-09-10").monthNavigation,
    { direction: "Next page", available: false });
});

test("inspectPreparation: Mobiscroll DOM도 동일한 사실을 산출한다", async () => {
  const dom = await loadFixture("calendar-mobiscroll.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const facts = adapter.inspectPreparation("2026-07-23");
  assert.equal(facts.displayedMonth, "2026-07");
  assert.deepEqual(facts.target, { available: true, selected: true });
  assert.deepEqual(adapter.inspectPreparation("2026-07-13").target,
    { available: false, selected: false });
});
