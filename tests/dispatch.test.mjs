import assert from "node:assert/strict";
import test from "node:test";
import { dispatchRunEvent } from "../dist/content/dispatch.js";

test("dispatchRunEvent forwards the message to the sender", () => {
  const sent = [];
  dispatchRunEvent((m) => { sent.push(m); return Promise.resolve(); }, { type: "RUN_EVENT" });
  assert.deepEqual(sent, [{ type: "RUN_EVENT" }]);
});

test("dispatchRunEvent swallows a synchronous throw (invalidated extension context)", () => {
  // chrome.runtime.sendMessage throws synchronously (not a rejected promise)
  // when the extension context is invalidated after a reload/bfcache. A bare
  // `.catch()` cannot catch that, so the run must not be interrupted here.
  assert.doesNotThrow(() => {
    dispatchRunEvent(() => { throw new Error("Extension context invalidated."); }, { type: "RUN_EVENT" });
  });
});

test("dispatchRunEvent swallows an async rejection (service worker restart)", async () => {
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on("unhandledRejection", onUnhandled);
  dispatchRunEvent(() => Promise.reject(new Error("port closed")), { type: "RUN_EVENT" });
  await new Promise((r) => setTimeout(r, 10));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, null);
});
