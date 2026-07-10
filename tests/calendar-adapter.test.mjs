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
