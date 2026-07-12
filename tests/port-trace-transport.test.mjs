import assert from "node:assert/strict";
import test from "node:test";
import { PortTraceTransport } from "../dist/content/telemetry/port-transport.js";

function port() {
  let messageListener = () => undefined;
  let disconnectListener = () => undefined;
  const messages = [];
  return {
    messages,
    postMessage: (message) => messages.push(message),
    onMessage: { addListener: (listener) => { messageListener = listener; } },
    onDisconnect: { addListener: (listener) => { disconnectListener = listener; } },
    receive: (message) => messageListener(message),
    disconnect: () => disconnectListener(),
  };
}

test("port transport reconnects after disconnect and forwards ACK", () => {
  const ports = [port(), port()];
  let connections = 0;
  globalThis.chrome = { runtime: { connect: () => ports[connections++] } };
  const transport = new PortTraceTransport();
  const acknowledgements = [];
  transport.setAckHandler((runId, lastSeq) => acknowledgements.push([runId, lastSeq]));
  const batch = { type: "TRACE_BATCH", runId: "run-1", events: [] };

  transport.send(batch);
  ports[0].receive({ type: "TRACE_ACK", runId: "run-1", lastSeq: 3 });
  ports[0].disconnect();
  transport.send(batch);

  assert.equal(connections, 2);
  assert.equal(ports[0].messages.length, 1);
  assert.equal(ports[1].messages.length, 1);
  assert.deepEqual(acknowledgements, [["run-1", 3]]);
  delete globalThis.chrome;
});
