import assert from "node:assert/strict";
import test from "node:test";
import { SlotRefreshWatch, isSlotRefreshEntry } from "../dist/content/adapter/slot-refresh-watch.js";

const ORIGIN = "https://app.catchtable.co.kr";

function fakeObserverFactory() {
  const state = { callback: null, observed: null, disconnected: 0 };
  const factory = (callback) => {
    state.callback = callback;
    return {
      observe: (options) => { state.observed = options; },
      disconnect: () => { state.disconnected += 1; },
    };
  };
  return { state, factory };
}

test("slot refresh entries match only the time-slots path", () => {
  assert.equal(isSlotRefreshEntry("https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots?shopRef=x", ORIGIN), true);
  assert.equal(isSlotRefreshEntry("https://ct-api.catchtable.co.kr/api/reservation/v1/dining/day-slots", ORIGIN), false);
  assert.equal(isSlotRefreshEntry("not a url", ORIGIN), false);
});

test("watch fires onArrival once per matching entry and stops cleanly", () => {
  const { state, factory } = fakeObserverFactory();
  const watch = new SlotRefreshWatch(factory, ORIGIN);
  const arrivals = [];
  watch.start(() => arrivals.push(1));
  assert.deepEqual(state.observed, { type: "resource", buffered: false });
  state.callback([
    { name: "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots?shopRef=x" },
    { name: "https://app.catchtable.co.kr/api/v3/user/lastLoginTime" },
    { name: "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots?shopRef=y" },
  ]);
  assert.equal(arrivals.length, 2);
  watch.start(() => arrivals.push(9));
  state.callback([{ name: "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots" }]);
  assert.equal(arrivals.length, 3);
  assert.equal(arrivals.includes(9), false);
  watch.stop();
  assert.equal(state.disconnected, 1);
  watch.stop();
  assert.equal(state.disconnected, 1);
});
