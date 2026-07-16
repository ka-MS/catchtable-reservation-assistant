import assert from "node:assert/strict";
import test from "node:test";
import { createPageRuntimePort } from "../dist/background/page-runtime-port.js";

const SHOP = "https://app.catchtable.co.kr/ct/shop/kea";

function harness({ tabUrl = SHOP, pingResponses = [{ ok: true }] } = {}) {
  const calls = { updates: [], reloads: 0, scripts: 0, messages: [] };
  let listeners = [];
  let currentUrl = tabUrl;
  let pingIndex = 0;
  const tabs = {
    get: async (tabId) => ({ id: tabId, status: "complete", url: currentUrl }),
    update: async (_tabId, properties) => {
      calls.updates.push(properties.url);
      currentUrl = properties.url;
      return { status: "complete", url: currentUrl };
    },
    reload: async () => {
      calls.reloads += 1;
      // 실제 Chrome처럼 reload 후 complete 이벤트를 발화한다.
      queueMicrotask(() => {
        for (const listener of [...listeners]) {
          listener(7, { status: "complete" }, { id: 7, status: "complete", url: currentUrl });
        }
      });
    },
    onUpdated: {
      addListener: (listener) => listeners.push(listener),
      removeListener: (listener) => { listeners = listeners.filter((l) => l !== listener); },
    },
  };
  const port = createPageRuntimePort({
    tabs,
    executeScript: async () => { calls.scripts += 1; },
    sendMessage: async (_tabId, command) => {
      calls.messages.push(command);
      if (command.type === "PING") {
        const response = pingResponses[Math.min(pingIndex, pingResponses.length - 1)];
        pingIndex += 1;
        if (response instanceof Error) throw response;
        return response;
      }
      if (command.type === "GET_ATTEMPT_STATUS") {
        return { attemptId: command.attemptId, running: true, phase: "PREPARING" };
      }
      return { ok: true };
    },
  });
  return { port, calls };
}

test("navigateIfNeeded는 같은 매장이면 이동하지 않는다", async () => {
  const h = harness();
  await h.port.navigateIfNeeded(7, SHOP);
  assert.deepEqual(h.calls.updates, []);
  const other = harness({ tabUrl: "https://app.catchtable.co.kr/ct/shop/other" });
  await other.port.navigateIfNeeded(7, SHOP);
  assert.deepEqual(other.calls.updates, [SHOP]);
});

test("forceReenter는 같은 URL에서도 reload로 문서를 다시 로드한다", async () => {
  const h = harness();
  await h.port.forceReenter(7, SHOP);
  assert.equal(h.calls.reloads, 1);
  assert.deepEqual(h.calls.updates, []);
});

test("inject는 PING 성공 시 주입을 건너뛰고, 2차 PING 실패 시 던진다", async () => {
  const h = harness({ pingResponses: [{ ok: true }] });
  await h.port.inject(7);
  assert.equal(h.calls.scripts, 0);

  const failing = harness({ pingResponses: [new Error("no receiver"), new Error("no receiver")] });
  await assert.rejects(() => failing.port.inject(7), /실행 코드를 연결할 수 없습니다/);
  assert.equal(failing.calls.scripts, 1);

  const injected = harness({ pingResponses: [new Error("no receiver"), { ok: true }] });
  await injected.port.inject(7);
  assert.equal(injected.calls.scripts, 1);
});

test("getAttemptStatus는 수신 실패 시 null을 돌려준다", async () => {
  const h = harness();
  const status = await h.port.getAttemptStatus(7, "run-a1");
  assert.deepEqual(status, { attemptId: "run-a1", running: true, phase: "PREPARING" });
  const dead = createPageRuntimePort({
    tabs: {
      get: async () => ({}), update: async () => ({}), reload: async () => undefined,
      onUpdated: { addListener: () => undefined, removeListener: () => undefined },
    },
    executeScript: async () => undefined,
    sendMessage: async () => { throw new Error("dead"); },
  });
  assert.equal(await dead.getAttemptStatus(7, "run-a1"), null);
});
