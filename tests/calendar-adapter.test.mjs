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

test("Mobiscroll calendar rejects a malformed grid", async () => {
  const dom = await loadFixture("calendar-mobiscroll.html");
  const adapter = new CalendarAdapter(dom.window.document);

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

// 아래 사실 단언들은 삭제된 prepareTarget 테스트가 커버하던 DOM 판독
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
