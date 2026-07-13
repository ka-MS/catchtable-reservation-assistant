import assert from "node:assert/strict";
import test from "node:test";
import { SlotAdapter } from "../dist/content/adapter/slots.js";
import { selectPreferredSlot } from "../dist/shared/slot-selection.js";
import { loadFixture } from "./fixture-helper.mjs";

test("slot adapter removes ancestor-hidden duplicates and busy buttons", async () => {
  const dom = await loadFixture("slots.html");
  const adapter = new SlotAdapter(dom.window.document);
  assert.deepEqual(adapter.readAvailableSlots().map((slot) => slot.minutes), [1080, 1140, 1170]);
});

test("slot selection honors priority before earliest range match", async () => {
  const dom = await loadFixture("slots.html");
  const slots = new SlotAdapter(dom.window.document).readAvailableSlots();
  assert.equal(selectPreferredSlot(slots, { startMinutes: 1080, endMinutes: 1200 }, [1170, 1140])?.minutes, 1170);
  assert.equal(selectPreferredSlot(slots, { startMinutes: 1080, endMinutes: 1200 }, [])?.minutes, 1080);
  assert.equal(selectPreferredSlot(slots, { startMinutes: 1201, endMinutes: 1300 }, []), null);
});

test("slot click resolves the logical slot again and clicks once", async () => {
  const dom = await loadFixture("slots.html");
  const adapter = new SlotAdapter(dom.window.document);
  const candidate = adapter.readAvailableSlots().find((slot) => slot.minutes === 1140);
  let clicks = 0;
  dom.window.document.querySelector('button[data-busy="false"] span')?.parentElement?.addEventListener("click", () => undefined);
  dom.window.document.querySelector('[data-duplicate-index="1"]')?.addEventListener("click", () => clicks++);
  assert.ok(candidate);
  assert.equal(adapter.clickSlot(candidate), true);
  assert.equal(clicks, 1);
  assert.equal(adapter.clickSlot({ key: "999", minutes: 999, label: "없는 슬롯" }), false);
});
