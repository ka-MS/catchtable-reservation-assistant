import assert from "node:assert/strict";
import test from "node:test";
import { EntryAdapter } from "../dist/content/adapter/entry.js";
import { loadFixture } from "./fixture-helper.mjs";

test("entry adapter opens only the reservation CTA inside the dock", async () => {
  const dom = await loadFixture("entry.html");
  const adapter = new EntryAdapter(dom.window.document);
  const calendar = dom.window.document.querySelector("#calendar");
  let unsafeClicks = 0;
  dom.window.document.querySelector("#unsafe-reservation-submit").addEventListener("click", () => {
    unsafeClicks += 1;
  });
  dom.window.document.querySelector("#dock button").addEventListener("click", () => {
    calendar.hidden = false;
  });

  assert.deepEqual(adapter.inspect(), { reservationOpen: false, ctaAvailable: true, waitingOnly: false });
  assert.equal(adapter.openReservation(), true);
  assert.equal(unsafeClicks, 0);
  assert.deepEqual(adapter.inspect(), { reservationOpen: true, ctaAvailable: true, waitingOnly: false });
});

test("entry adapter recognizes a waiting-only restaurant without clicking it", async () => {
  const dom = await loadFixture("entry-waiting.html");
  const adapter = new EntryAdapter(dom.window.document);

  assert.deepEqual(adapter.inspect(), { reservationOpen: false, ctaAvailable: false, waitingOnly: true });
  assert.equal(adapter.openReservation(), false);
});
