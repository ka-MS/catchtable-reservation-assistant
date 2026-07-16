import assert from "node:assert/strict";
import test from "node:test";
import { captureRunExecutionContext } from "../dist/background/run-execution-context.js";

test("run execution context joins tab and window focus state", async () => {
  const context = await captureRunExecutionContext(7, {
    get: async () => ({ id: 7, windowId: 11, active: false }),
  }, {
    get: async () => ({ focused: true }),
  }, () => 123);

  assert.deepEqual(context, {
    capturedAt: 123,
    tabId: 7,
    windowId: 11,
    tabActive: false,
    windowFocused: true,
  });
});

test("run execution context degrades without blocking START", async () => {
  const context = await captureRunExecutionContext(9, {
    get: async () => { throw new Error("tab unavailable"); },
  }, {
    get: async () => { throw new Error("must not be called"); },
  }, () => 456);

  assert.deepEqual(context, {
    capturedAt: 456,
    tabId: 9,
    windowId: null,
    tabActive: false,
    windowFocused: null,
  });
});
