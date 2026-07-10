import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { findMatchingSlot } from "../dist/content/adapter.js";

const dom = new JSDOM('<main></main>', { url: "https://app.catchtable.co.kr/ct/shop/kea?date=260730&personCount=2" });
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });

const config = {
  targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
  date: "2026-07-30",
  personCount: 2,
  startTime: "12:00",
  endTime: "12:00",
  tableTypePreference: "none",
};
const main = document.querySelector("main");
const samples = [];
for (let index = 0; index < 100; index += 1) {
  main.innerHTML = '<button aria-disabled="false" data-busy="false">오후 12:00</button>';
  const startedAt = performance.now();
  const slot = findMatchingSlot(config);
  slot.button.click();
  samples.push(performance.now() - startedAt);
}
samples.sort((left, right) => left - right);
const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
console.log(`local DOM detect-to-click p95: ${p95.toFixed(3)}ms (100 samples)`);
if (p95 > 50) process.exitCode = 1;
