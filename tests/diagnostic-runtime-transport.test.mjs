import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeDiagnosticTransport } from "../dist/content/diagnostics/runtime-transport.js";

test("runtime diagnostic transport requires a successful storage ACK", async () => {
  const messages = [];
  const transport = new RuntimeDiagnosticTransport(async (message) => {
    messages.push(message);
    return { ok: true };
  });
  await transport.save("run-1", [{ snapshotId: "ss-1" }]);
  assert.equal(messages[0].type, "SAVE_DIAGNOSTIC_SNAPSHOTS");
  assert.equal(messages[0].runId, "run-1");

  const failed = new RuntimeDiagnosticTransport(async () => ({ ok: false, error: "blocked" }));
  await assert.rejects(() => failed.save("run-1", []), /blocked/);
});

test("runtime diagnostic transport retries one rejected message channel", async () => {
  let attempts = 0;
  const transport = new RuntimeDiagnosticTransport(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("service worker restarted");
    return { ok: true };
  });

  await transport.save("run-1", [{ snapshotId: "ss-1" }]);
  assert.equal(attempts, 2);
});
