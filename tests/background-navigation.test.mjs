import assert from "node:assert/strict";
import test from "node:test";
import { navigateTab, sameRestaurant, leftReservationFlow } from "../dist/background/navigation.js";

test("sameRestaurant ignores query strings but requires the exact shop path", () => {
  assert.equal(sameRestaurant(
    "https://app.catchtable.co.kr/ct/shop/kea?date=260730",
    "https://app.catchtable.co.kr/ct/shop/kea",
  ), true);
  assert.equal(sameRestaurant(
    "https://app.catchtable.co.kr/ct/shop/other",
    "https://app.catchtable.co.kr/ct/shop/kea",
  ), false);
  assert.equal(sameRestaurant(
    "https://app.catchtable.co.kr/ct/shop/kea/",
    "https://app.catchtable.co.kr/ct/shop/kea",
  ), true);
});

test("leftReservationFlow allows the shop page and the reservation form, blocks elsewhere", () => {
  const target = "https://app.catchtable.co.kr/ct/shop/kea";
  // 같은 매장 페이지: 이탈 아님
  assert.equal(leftReservationFlow("https://app.catchtable.co.kr/ct/shop/kea?date=260730", target), false);
  // 예약 폼: 후속 흐름의 정상 목적지 — 이탈 아님 (성공 경로가 STOPPED로 오판되던 버그)
  assert.equal(leftReservationFlow("https://app.catchtable.co.kr/ct/reservation/form", target), false);
  assert.equal(leftReservationFlow("https://app.catchtable.co.kr/ct/reservation/confirm", target), false);
  // 다른 매장: 이탈
  assert.equal(leftReservationFlow("https://app.catchtable.co.kr/ct/shop/other", target), true);
  // 외부 오리진: 이탈
  assert.equal(leftReservationFlow("https://example.com/", target), true);
  // 잘못된 URL: 이탈로 간주(보수적)
  assert.equal(leftReservationFlow("not a url", target), true);
});

test("navigateTab waits for the target tab to finish loading", async () => {
  const listeners = new Set();
  let updatedTo = null;
  const tabs = {
    get: async () => ({ id: 7, status: "complete", url: updatedTo }),
    update: async (tabId, options) => {
      assert.equal(tabId, 7);
      updatedTo = options.url;
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener(7, { status: "complete", url: options.url }, { id: 7, status: "complete", url: options.url });
        }
      });
      return { id: 7, status: "loading", url: options.url };
    },
    onUpdated: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
  };

  await navigateTab(7, "https://app.catchtable.co.kr/ct/shop/kea", tabs, 1_000);

  assert.equal(updatedTo, "https://app.catchtable.co.kr/ct/shop/kea");
  assert.equal(listeners.size, 0);
});
