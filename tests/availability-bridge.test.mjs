import assert from "node:assert/strict";
import test from "node:test";
import { AvailabilityShadowBridge } from "../dist/content/availability-shadow-bridge.js";

function validEvent(channelId = "channel-1") {
  return {
    source: "ct-reserve-main",
    type: "AVAILABILITY_SHADOW_EVENT",
    schemaVersion: 1,
    channelId,
    sequence: 1,
    requestDate: "260801",
    personCount: 2,
    classification: "EMPTY",
    availableMinutes: [],
    responseStatus: 200,
    requestSentMonoMs: 1,
    responseCompletedMonoMs: 2,
    bodyReadCompletedMonoMs: 3,
    payloadClassifiedMonoMs: 4,
  };
}

test("bridge validates source and channel, timestamps receipt, and deactivates", () => {
  let listener = null;
  const posted = [];
  const windowObject = {};
  const host = {
    windowObject,
    addMessageListener: (next) => { listener = next; },
    removeMessageListener: (next) => { if (listener === next) listener = null; },
    postMessage: (message) => posted.push(message),
    monotonicNow: () => 99,
  };
  const bridge = new AvailabilityShadowBridge(host);
  const events = [];
  bridge.configure("channel-1");
  bridge.start(5_000, (event) => events.push(event));
  assert.equal(posted[0].type, "AVAILABILITY_SHADOW_ACTIVATE");

  listener({ source: {}, data: validEvent() });
  listener({ source: windowObject, data: validEvent("wrong") });
  listener({ source: windowObject, data: validEvent() });
  assert.equal(events.length, 1);
  assert.equal(events[0].bridgeReceivedMonoMs, 99);

  bridge.stop();
  assert.equal(posted.at(-1).type, "AVAILABILITY_SHADOW_DEACTIVATE");
  assert.equal(listener, null);
});
