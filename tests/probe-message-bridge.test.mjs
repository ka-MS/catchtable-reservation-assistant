import assert from "node:assert/strict";
import test from "node:test";
import { installProbeMessageBridge } from "../dist/main-world/probe-message-bridge.js";

test("MAIN message bridge can be disposed and reinstalled without duplicate activation", () => {
  const windowObject = {};
  const listeners = new Set();
  const calls = { activated: [], marked: [], deactivated: 0 };
  const host = {
    windowObject,
    addMessageListener: (listener) => listeners.add(listener),
    removeMessageListener: (listener) => listeners.delete(listener),
  };
  const probe = {
    activate: (activation) => calls.activated.push(activation),
    markTargetCycle: (marker) => calls.marked.push(marker),
    deactivate: () => { calls.deactivated += 1; },
  };
  const dispatch = (data) => {
    for (const listener of listeners) listener({ source: windowObject, data });
  };
  const activation = {
    source: "ct-reserve-isolated",
    type: "AVAILABILITY_SHADOW_ACTIVATE",
    schemaVersion: 1,
    channelId: "channel-1",
    expiresAtEpochMs: 5_000,
  };

  const disposeFirst = installProbeMessageBridge(host, probe);
  disposeFirst();
  const disposeSecond = installProbeMessageBridge(host, probe);
  dispatch(activation);
  assert.equal(calls.activated.length, 1);
  dispatch({
    source: "ct-reserve-isolated",
    type: "AVAILABILITY_SHADOW_TARGET_CYCLE",
    schemaVersion: 1,
    channelId: "channel-1",
    cycle: 5,
    targetDate: "2026-08-01",
    personCount: 2,
    targetClickMonoMs: 100,
  });
  assert.equal(calls.marked.length, 1);
  assert.equal(calls.marked[0].cycle, 5);
  dispatch({ ...activation, type: "AVAILABILITY_SHADOW_DEACTIVATE" });
  assert.equal(calls.deactivated, 1);
  disposeSecond();
  assert.equal(listeners.size, 0);
});
