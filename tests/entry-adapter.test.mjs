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

test("entry adapter dismisses the promo interstitial that swallows the CTA click", async () => {
  // Live DOM measured 2026-07-12 at ishizue (site-behavior §7.2): the promo interstitial
  // appears right after the dock CTA click and keeps the calendar from opening.
  const dom = await loadFixture("entry.html");
  const document = dom.window.document;
  assert.equal(new EntryAdapter(document).dismissPromo(), false);

  document.body.insertAdjacentHTML("beforeend", `
    <div style="position: fixed;">
      <section>
        <h2>이시즈에와 비슷한 곳 둘러보기</h2>
        <button>7일간 보지 않기</button>
        <button id="promo-later">다음에 볼게요</button>
      </section>
    </div>
  `);
  let laterClicks = 0;
  document.querySelector("#promo-later").addEventListener("click", () => { laterClicks += 1; });

  assert.equal(new EntryAdapter(document).dismissPromo(), true);
  assert.equal(laterClicks, 1);
});

test("entry adapter recognizes a waiting-only restaurant without clicking it", async () => {
  const dom = await loadFixture("entry-waiting.html");
  const adapter = new EntryAdapter(dom.window.document);

  assert.deepEqual(adapter.inspect(), { reservationOpen: false, ctaAvailable: false, waitingOnly: true });
  assert.equal(adapter.openReservation(), false);
});
