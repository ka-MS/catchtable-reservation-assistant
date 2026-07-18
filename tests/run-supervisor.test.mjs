import assert from "node:assert/strict";
import test from "node:test";
import { RunSupervisor } from "../dist/background/run-supervisor.js";
import { createLogicalRun, applyAttemptOutcome, markRecoveryDispatched, applyPhaseChange } from "../dist/shared/run-control/logical-run.js";

const SHOP = "https://app.catchtable.co.kr/ct/shop/kea";

function config(overrides = {}) {
  return {
    targetUrl: SHOP,
    openAtMs: 300_000, reservationDate: "2026-08-20", personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 }, priorityTimes: [],
    postSlotEnabled: false, paymentMethodAutoAdvance: false, paymentMethodPolicy: "selected_allowed",
    tablePreference: "any", menuKeyword: "", stopAtMs: 900_000,
    entryMode: "auto", dryRun: true, preOpenLeadMs: 300, toggleIntervalMs: 400,
    ...overrides,
  };
}

const prepFailed = (overrides = {}) => ({
  kind: "preparation_failed", state: "HANDED_OFF", cause: "DATE_SELECTION_STALLED",
  attempts: 2, message: "목표 날짜 선택 전환을 확인할 수 없습니다.", finishedAt: 10_000, ...overrides,
});

function harness({ seed = {}, status = () => null, nowMs = 1_000 } = {}) {
  const store = new Map(Object.entries(seed));
  const calls = {
    reenters: [], injects: 0, starts: [], stops: 0, effects: [],
    traces: [], statusRequests: [], createdTabs: 0, decisionAtReenter: [],
  };
  let idSeq = 0;
  const state = { nowMs };
  const hooks = {};
  const deps = {
    storage: {
      get: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) if (store.has(key)) out[key] = store.get(key);
        return out;
      },
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      },
    },
    port: {
      navigateIfNeeded: async () => { await hooks.gateNavigation?.(); },
      forceReenter: async (_tabId, url) => {
        calls.decisionAtReenter.push(store.get("logicalRun")?.attempts?.[0]?.decision ?? null);
        calls.reenters.push(url);
      },
      inject: async () => { calls.injects += 1; },
      ping: async () => true,
      startAttempt: async (_tabId, command) => {
        hooks.interceptStart?.(command);
        calls.starts.push(command);
        return { ok: true };
      },
      stopAttempt: async () => { calls.stops += 1; return true; },
      getAttemptStatus: async (_tabId, attemptId) => {
        calls.statusRequests.push(attemptId);
        return status(attemptId);
      },
    },
    effects: async (run) => { calls.effects.push({ logicalRunId: run.logicalRunId, status: run.status }); },
    trace: {
      startFailure: async (...args) => { calls.traces.push(["startFailure", args[2]]); },
      backgroundTerminal: async (...args) => { calls.traces.push(["backgroundTerminal", args[4]]); },
      recovery: async (_runId, _config, code) => { calls.traces.push(["recovery", code]); },
    },
    probe: async () => false,
    captureContext: async () => undefined,
    activeTab: async () => ({ id: 7, url: SHOP }),
    createTab: async () => { calls.createdTabs += 1; return 8; },
    validate: () => [],
    saveHistory: () => undefined,
    newId: () => `id-${++idSeq}`,
    now: () => state.nowMs,
  };
  const supervisor = new RunSupervisor(deps);
  return {
    supervisor, store, calls, state, hooks,
    settle: () => supervisor.whenIdle(),
  };
}

test("startManual은 logicalRun을 영속하고 attemptIndex 0 START를 보낸다", async () => {
  const h = harness();
  await h.supervisor.ready;
  const response = await h.supervisor.startManual(config());
  assert.equal(response.ok, true);
  const run = h.store.get("logicalRun");
  assert.equal(run.status, "PREPARING");
  assert.deepEqual(h.calls.starts.map((s) => ({ runId: s.runId, logicalRunId: s.logicalRunId, attemptIndex: s.attemptIndex })),
    [{ runId: run.currentAttemptId, logicalRunId: run.logicalRunId, attemptIndex: 0 }]);
  assert.equal(h.store.get("activeRun").runId, run.currentAttemptId);
  const busy = await h.supervisor.startManual(config());
  assert.equal(busy.ok, false);
  assert.match(busy.error, /이미 실행 중인 작업/);
});

test("준비 정체 → RESET: 결정 영속 후 ACK, reenter→inject→START, 원자적 전이와 projection 초기화", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  const ack = await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    outcome: prepFailed(), flush: { ok: true },
  });
  assert.deepEqual(ack, { ok: true, decision: "RESET_PAGE" });
  await h.settle();
  const after = h.store.get("logicalRun");
  assert.equal(after.status, "PREPARING");
  assert.equal(after.resetCount, 1);
  assert.equal(after.attempts.length, 2);
  assert.equal(after.currentAttemptId, after.attempts[1].runId);
  assert.equal(after.recovery, undefined);
  // 행동 전에 결정이 영속돼 있었다(§5.4) — reenter 시점 store 스냅샷으로 증명.
  assert.deepEqual(h.calls.decisionAtReenter, ["RESET_PAGE"]);
  assert.deepEqual(h.calls.reenters, [SHOP]);
  const second = h.calls.starts.at(-1);
  assert.equal(second.runId, after.currentAttemptId);
  assert.equal(second.attemptIndex, 1);
  assert.equal(second.resetCause, "DATE_SELECTION_STALLED");
  assert.equal(h.store.get("activeRun").runId, after.currentAttemptId);
  assert.deepEqual(h.store.get("runEvents"), []);
  assert.deepEqual(h.calls.effects, []); // RESET 중에는 어떤 terminal 효과도 없다
  assert.equal(h.calls.traces.some(([kind, code]) => kind === "recovery" && code === "RECOVERY_DECIDED"), true);
  assert.equal(h.calls.traces.some(([kind, code]) => kind === "recovery" && code === "RECOVERY_DISPATCHED"), true);
});

test("ACK 유실 재전송은 저장된 decision 재ACK — resetCount·recovery 이중 실행 없음", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  const message = {
    type: "ATTEMPT_FINISHED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    outcome: prepFailed(), flush: { ok: true },
  };
  await h.supervisor.onAttemptFinished(message);
  await h.settle();
  const startsAfterFirst = h.calls.starts.length;
  const replay = await h.supervisor.onAttemptFinished(message);
  await h.settle();
  assert.deepEqual(replay, { ok: true, decision: "RESET_PAGE" });
  assert.equal(h.store.get("logicalRun").resetCount, 1);
  assert.equal(h.calls.starts.length, startsAfterFirst);
  const conflict = await h.supervisor.onAttemptFinished({ ...message, outcome: prepFailed({ message: "다른 메시지" }) });
  assert.deepEqual(conflict, { ok: false, reason: "outcome_conflict" });
});

test("2번째 정체는 HANDOFF로 종결하고 효과를 1회 실행한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const first = h.store.get("logicalRun");
  await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: first.logicalRunId, attemptId: first.currentAttemptId,
    outcome: prepFailed(), flush: { ok: true },
  });
  await h.settle();
  const second = h.store.get("logicalRun");
  const ack = await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: second.logicalRunId, attemptId: second.currentAttemptId,
    outcome: prepFailed(), flush: { ok: true },
  });
  await h.settle();
  assert.deepEqual(ack, { ok: true, decision: "HANDOFF" });
  const final = h.store.get("logicalRun");
  assert.equal(final.status, "TERMINAL");
  assert.equal(typeof final.terminalEffectsCompletedAt, "number");
  assert.deepEqual(h.calls.effects, [{ logicalRunId: final.logicalRunId, status: "TERMINAL" }]);
});

test("EXECUTING 진입 후 준비 실패 outcome은 RESET 없이 HANDOFF", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  const phaseAck = await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  assert.deepEqual(phaseAck, { ok: true });
  assert.equal(h.store.get("logicalRun").status, "EXECUTING");
  const ack = await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    outcome: prepFailed(), flush: { ok: true },
  });
  assert.deepEqual(ack, { ok: true, decision: "HANDOFF" });
});

test("terminal outcome은 TERMINAL로 접수하고 효과·마커를 남긴다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  const ack = await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    outcome: { kind: "terminal", state: "DRY_RUN_COMPLETED", message: "dry-run 완료", finishedAt: 5 },
    flush: { ok: true },
  });
  await h.settle();
  assert.deepEqual(ack, { ok: true, decision: "TERMINAL" });
  assert.equal(h.calls.effects.length, 1);
  assert.equal(typeof h.store.get("logicalRun").terminalEffectsCompletedAt, "number");
});

test("unknown logical run은 ok:false로 거부한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  const ack = await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: "lr-x", attemptId: "run-x",
    outcome: prepFailed(), flush: { ok: true },
  });
  assert.deepEqual(ack, { ok: false, reason: "unknown_logical_run" });
});

test("reconcile C1: 미실행 attempt는 안전 terminal FAILED + 효과", async () => {
  const base = createLogicalRun({
    logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(), tabId: 7,
    attemptId: "run-a1", nowMs: 0,
  });
  const h = harness({
    seed: {
      logicalRun: base,
      reservationConfig: config(),
      activeRun: { runId: "run-a1", tabId: 7, state: "ENTERING_RESERVATION", startedAt: 0, updatedAt: 0 },
    },
    status: () => null,
  });
  await h.supervisor.ready;
  const run = h.store.get("logicalRun");
  assert.equal(run.status, "TERMINAL");
  assert.equal(run.attempts[0].finalState, "FAILED");
  assert.equal(run.attempts[0].message, "실행 문맥이 유실됐습니다.");
  assert.equal(h.store.get("activeRun").state, "FAILED");
  assert.equal(h.calls.effects.length, 1);
});

test("reconcile C3: FINISHING 상태 응답의 pendingOutcome을 겸수신하고 이후 재전송은 replay된다", async () => {
  const base = createLogicalRun({
    logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(), tabId: 7,
    attemptId: "run-a1", nowMs: 0,
  });
  const outcome = { kind: "terminal", state: "DRY_RUN_COMPLETED", message: "dry-run 완료", finishedAt: 5 };
  const h = harness({
    seed: { logicalRun: base, reservationConfig: config() },
    status: (attemptId) => ({ attemptId, running: false, phase: "FINISHING", pendingOutcome: outcome }),
  });
  await h.supervisor.ready;
  await h.settle();
  assert.equal(h.store.get("logicalRun").status, "TERMINAL");
  assert.equal(h.calls.effects.length, 1);
  const replay = await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: "lr-1", attemptId: "run-a1", outcome, flush: { ok: true },
  });
  assert.deepEqual(replay, { ok: true, decision: "TERMINAL" });
});

test("reconcile C6: dispatchedAt 이후 next attempt가 이미 실행 중이면 전이 쓰기만 수행한다", async () => {
  const base = createLogicalRun({
    logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(), tabId: 7,
    attemptId: "run-a1", nowMs: 0,
  });
  const decided = applyAttemptOutcome(base, "run-a1", prepFailed(), 10_000, "run-a2").run;
  const dispatched = markRecoveryDispatched(decided, 10_500);
  const h = harness({
    seed: { logicalRun: dispatched, reservationConfig: config() },
    status: (attemptId) => (attemptId === "run-a2"
      ? { attemptId, running: true, phase: "PREPARING" }
      : null),
  });
  await h.supervisor.ready;
  await h.settle();
  const run = h.store.get("logicalRun");
  assert.equal(run.currentAttemptId, "run-a2");
  assert.equal(run.status, "PREPARING");
  assert.deepEqual(h.calls.reenters, []); // 이중 reenter 없음
  assert.deepEqual(h.calls.starts, []);   // 이중 START 없음
});

test("reconcile C8: TERMINAL + 효과 마커 없음 → 효과 재개", async () => {
  const base = createLogicalRun({
    logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(), tabId: 7,
    attemptId: "run-a1", nowMs: 0,
  });
  const terminal = applyAttemptOutcome(base, "run-a1",
    { kind: "terminal", state: "HANDED_OFF", message: "인계", finishedAt: 5 }, 5, "run-a2").run;
  const h = harness({ seed: { logicalRun: terminal, reservationConfig: config() } });
  await h.supervisor.ready;
  assert.equal(h.calls.effects.length, 1);
  assert.equal(typeof h.store.get("logicalRun").terminalEffectsCompletedAt, "number");
});

test("reconcile: attempt 실행 중이면 개입하지 않는다", async () => {
  const base = createLogicalRun({
    logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(), tabId: 7,
    attemptId: "run-a1", nowMs: 0,
  });
  const h = harness({
    seed: { logicalRun: base, reservationConfig: config() },
    status: (attemptId) => ({ attemptId, running: true, phase: "PREPARING" }),
  });
  await h.supervisor.ready;
  assert.equal(h.store.get("logicalRun").status, "PREPARING");
  assert.deepEqual(h.calls.effects, []);
});

test("recovery 시효: 재기동 시 오픈 임박이면 RESET 대신 terminal로 확정한다", async () => {
  const base = createLogicalRun({
    logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(), tabId: 7,
    attemptId: "run-a1", nowMs: 0,
  });
  const decided = applyAttemptOutcome(base, "run-a1", prepFailed(), 10_000, "run-a2").run;
  const h = harness({
    seed: { logicalRun: decided, reservationConfig: config() },
    nowMs: 280_000, // msToOpen 20s < RESET_MIN_LEAD_MS
  });
  await h.supervisor.ready;
  await h.settle();
  const run = h.store.get("logicalRun");
  assert.equal(run.status, "TERMINAL");
  assert.deepEqual(h.calls.reenters, []);
  assert.equal(h.calls.effects.length, 1);
});

test("탭 닫힘은 logicalRun을 STOPPED로 종결하고 효과와 trace를 남긴다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  await h.supervisor.onTabRemoved(7);
  await h.settle();
  const run = h.store.get("logicalRun");
  assert.equal(run.status, "TERMINAL");
  assert.equal(run.attempts[0].finalState, "STOPPED");
  assert.equal(h.store.get("activeRun").state, "STOPPED");
  assert.equal(h.calls.traces.some(([kind, message]) => kind === "backgroundTerminal" && /탭이 닫혔습니다/.test(message)), true);
  assert.equal(h.calls.effects.length, 1);
});

test("commitNextAttempt은 병행 도착한 next attempt의 RUN_EVENT projection을 보존한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  // content의 첫 RUN_EVENT가 commit 쓰기보다 먼저 도착하는 경쟁을 재현한다.
  h.hooks.interceptStart = (command) => {
    if (command.attemptIndex === 1) {
      h.store.set("runEvents", [{ at: 1, serverAt: null, runId: command.runId, kind: "state", message: "설정" }]);
    }
  };
  await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    outcome: prepFailed(), flush: { ok: true },
  });
  await h.settle();
  const events = h.store.get("runEvents");
  assert.equal(events.length, 1);
  assert.equal(events[0].runId, h.store.get("logicalRun").currentAttemptId);
});

test("stop은 직렬 queue를 기다리지 않고 진행 중인 시작을 즉시 취소한다", async () => {
  let releaseNavigation = () => undefined;
  const gate = new Promise((resolve) => { releaseNavigation = resolve; });
  const h = harness();
  h.hooks.gateNavigation = () => gate;
  await h.supervisor.ready;
  const startPromise = h.supervisor.startManual(config());
  await new Promise((resolve) => setTimeout(resolve, 10)); // startLogical이 navigation에서 대기
  const stopPromise = h.supervisor.stop();
  releaseNavigation();
  const startResult = await startPromise;
  assert.equal(startResult.ok, false);
  assert.match(startResult.error, /중지/);
  assert.deepEqual(h.calls.starts, []); // START는 전송되지 않았다
  assert.equal(h.store.get("activeRun").state, "STOPPED"); // FAILED가 아니라 STOPPED
  assert.equal(h.store.get("logicalRun") ?? null, null);
  await stopPromise;
});
