import assert from "node:assert/strict";
import test from "node:test";
import { createXhrAvailabilityProbe } from "../dist/main-world/xhr-probe.js";

class FakeXhr {
  static instances = [];
  listeners = new Map();
  responseText = "";
  responseType = "";
  status = 200;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method, url) {
    this.opened = { method, url };
    return "open-result";
  }

  setRequestHeader(name, value) {
    this.headers ??= {};
    this.headers[name] = value;
    return "header-result";
  }

  send(body) {
    this.body = body;
    return "send-result";
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  finish(responseText) {
    this.responseText = responseText;
    this.listeners.get("loadend")?.call(this);
  }
}

function harness() {
  let mono = 10;
  let epoch = 1_000;
  const posted = [];
  const timers = new Map();
  let timerId = 0;
  const host = {
    XMLHttpRequest: FakeXhr,
    monotonicNow: () => ++mono,
    epochNow: () => epoch,
    postMessage: (message) => posted.push(message),
    setTimer: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimer: (id) => timers.delete(id),
  };
  return { host, posted, timers, setEpoch: (value) => { epoch = value; } };
}

test("XHR probe observes only time-slot requests and preserves original call results", () => {
  const { host, posted } = harness();
  const originalOpen = FakeXhr.prototype.open;
  const originalSend = FakeXhr.prototype.send;
  const probe = createXhrAvailabilityProbe(host);
  probe.activate({ channelId: "run-channel", expiresAtEpochMs: 2_000 });

  const unrelated = new FakeXhr();
  unrelated.open("GET", "https://example.com/other");
  unrelated.send("unrelated-secret");
  unrelated.finish("{}");

  const xhr = new FakeXhr();
  assert.equal(xhr.open("POST", "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots?shopRef=private"), "open-result");
  assert.equal(xhr.setRequestHeader("yymmdd", "260801"), "header-result");
  xhr.setRequestHeader("personcount", "2");
  assert.equal(xhr.send("encrypted-body-must-not-be-read"), "send-result");
  xhr.finish(JSON.stringify({ data: { inputDate: "260801", personCount: 2, timeSlotMap: {} } }));

  assert.equal(posted.length, 1);
  assert.equal(posted[0].classification, "EMPTY");
  assert.equal(posted[0].requestDate, "260801");
  assert.equal(posted[0].personCount, 2);
  assert.equal(posted[0].responseStatus, 200);
  assert.equal(JSON.stringify(posted[0]).includes("encrypted-body"), false);
  assert.equal(JSON.stringify(posted[0]).includes("shopRef"), false);

  probe.deactivate();
  assert.equal(FakeXhr.prototype.open, originalOpen);
  assert.equal(FakeXhr.prototype.send, originalSend);
});

test("aborted or failed XHR is irrelevant rather than a malformed payload", () => {
  const { host, posted } = harness();
  const probe = createXhrAvailabilityProbe(host);
  probe.activate({ channelId: "run-channel", expiresAtEpochMs: 2_000 });
  const xhr = new FakeXhr();
  xhr.open("POST", "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots");
  xhr.setRequestHeader("yymmdd", "260801");
  xhr.setRequestHeader("personcount", "2");
  xhr.send("opaque");
  xhr.status = 0;
  xhr.finish("");
  assert.equal(posted[0].classification, "IRRELEVANT");
  assert.equal(posted[0].responseStatus, 0);
  probe.deactivate();
});

test("XHR probe installation is idempotent and expiry restores wrappers", () => {
  const { host, timers, setEpoch } = harness();
  const originalSend = FakeXhr.prototype.send;
  const probe = createXhrAvailabilityProbe(host);
  probe.activate({ channelId: "first", expiresAtEpochMs: 2_000 });
  const wrappedSend = FakeXhr.prototype.send;
  probe.activate({ channelId: "second", expiresAtEpochMs: 2_000 });
  assert.equal(FakeXhr.prototype.send, wrappedSend);
  assert.equal(timers.size, 1);
  setEpoch(2_000);
  [...timers.values()][0]();
  assert.equal(FakeXhr.prototype.send, originalSend);
});

test("observer setup failure never blocks the original XHR send", () => {
  const { host } = harness();
  const probe = createXhrAvailabilityProbe(host);
  probe.activate({ channelId: "run-channel", expiresAtEpochMs: 2_000 });
  const xhr = new FakeXhr();
  xhr.addEventListener = () => { throw new Error("observer unavailable"); };
  xhr.open("POST", "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots");
  xhr.setRequestHeader("yymmdd", "260801");
  xhr.setRequestHeader("personcount", "2");
  assert.equal(xhr.send("opaque"), "send-result");
  assert.equal(xhr.body, "opaque");
  probe.deactivate();
});
