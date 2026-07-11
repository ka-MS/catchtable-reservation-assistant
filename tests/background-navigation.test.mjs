import assert from "node:assert/strict";
import test from "node:test";
import { navigateTab, sameRestaurant } from "../dist/background/navigation.js";

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
