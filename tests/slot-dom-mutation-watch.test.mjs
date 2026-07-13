import assert from "node:assert/strict";
import test from "node:test";
import { SlotDomMutationWatch } from "../dist/content/adapter/slot-dom-mutation-watch.js";

test("mutation watch records only generation and monotonic callback time", () => {
  const root = {};
  let callback = null;
  let observed = null;
  let disconnected = 0;
  let now = 10;
  const watch = new SlotDomMutationWatch(
    (next) => {
      callback = next;
      return {
        observe: (target, options) => { observed = { target, options }; },
        disconnect: () => { disconnected += 1; },
      };
    },
    root,
    () => now,
  );

  watch.start();
  assert.deepEqual(observed, {
    target: root,
    options: { subtree: true, childList: true, attributes: true },
  });
  assert.deepEqual(watch.snapshot(), { generation: 0, lastMutationMonoMs: null });
  now = 25;
  callback();
  assert.deepEqual(watch.snapshot(), { generation: 1, lastMutationMonoMs: 25 });
  watch.stop();
  assert.equal(disconnected, 1);
});
