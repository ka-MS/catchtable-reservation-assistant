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
    reservationCompletionEnabled: false, maxPaymentAmountKrw: 0, requiredFormDefaultAnswer: "",
    ...overrides,
  };
}

// 실제 PIN처럼 보일 수 있는 리터럴을 소스에 남기지 않도록 자릿수를 런타임에 조합한다.
function runtimePinSentinel(digits) {
  return digits.map(String).join("");
}

// 값뿐 아니라 "catchPayPin" 키 자체가 어느 깊이에도 없는지 재귀적으로 확인한다.
function containsKey(value, key) {
  if (Array.isArray(value)) return value.some((item) => containsKey(item, key));
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
    return Object.values(value).some((item) => containsKey(item, key));
  }
  return false;
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

test("startManual은 authorization을 initial START에만 전달하고 storage에는 남기지 않는다", async () => {
  const h = harness();
  await h.supervisor.ready;
  const pin = runtimePinSentinel([4, 8, 1, 5]);
  const authorization = { catchPayPin: pin };
  const response = await h.supervisor.startManual(config(), authorization);
  assert.equal(response.ok, true);
  assert.equal(h.calls.starts.length, 1);
  assert.deepEqual(h.calls.starts[0].authorization, authorization);
  const stored = [...h.store.values()];
  const serializedStorage = JSON.stringify(stored);
  assert.equal(serializedStorage.includes(pin), false);
  assert.equal(containsKey(stored, "catchPayPin"), false); // reservationConfig/logicalRun/activeRun에 키 자체가 없다
});

test("recovery START는 initial attempt의 authorization을 물려받지 않는다", async () => {
  const h = harness();
  await h.supervisor.ready;
  const pin = runtimePinSentinel([9, 0, 2, 6]);
  await h.supervisor.startManual(config(), { catchPayPin: pin });
  const run = h.store.get("logicalRun");
  await h.supervisor.onAttemptFinished({
    type: "ATTEMPT_FINISHED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    outcome: prepFailed(), flush: { ok: true },
  });
  await h.settle();
  const recoveryStart = h.calls.starts.at(-1);
  assert.equal(recoveryStart.attemptIndex, 1);
  assert.equal("authorization" in recoveryStart, false);
  const stored = [...h.store.values()];
  const serializedStorage = JSON.stringify(stored);
  assert.equal(serializedStorage.includes(pin), false);
  assert.equal(containsKey(stored, "catchPayPin"), false);
});

test("scheduled START에는 authorization이 없다", async () => {
  const h = harness();
  await h.supervisor.ready;
  const job = { id: "job-1", createdAt: 0, updatedAt: 0, status: "scheduled", config: config(), result: null };
  const result = await h.supervisor.startScheduled(job);
  assert.equal(result.ok, true);
  assert.equal(h.calls.starts.length, 1);
  assert.equal("authorization" in h.calls.starts[0], false);
  assert.equal(containsKey([...h.store.values()], "catchPayPin"), false);
});

test("PIN 형식 오류는 정적 메시지만 반환하고 값을 노출하지 않는다", async () => {
  const h = harness();
  await h.supervisor.ready;
  const malformed = "not-a-pin";
  const response = await h.supervisor.startManual(config(), { catchPayPin: malformed });
  assert.equal(response.ok, false);
  assert.equal(response.error.includes(malformed), false);
  assert.equal(h.calls.starts.length, 0);
  assert.equal(h.calls.traces.some(([, message]) => typeof message === "string" && message.includes(malformed)), false);
});

test("busy 실패는 authorization 값을 trace나 오류 메시지에 남기지 않는다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const pin = runtimePinSentinel([2, 6, 9, 0]);
  const response = await h.supervisor.startManual(config(), { catchPayPin: pin });
  assert.equal(response.ok, false);
  assert.match(response.error, /이미 실행 중인 작업/);
  assert.equal(h.calls.traces.every(([, message]) => typeof message !== "string" || !message.includes(pin)), true);
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

test("unknown logical run은 completion dispatch claim도 거부한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  const ack = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: "lr-x", attemptId: "run-x",
    phase: "outer", fingerprint: "fp-x",
  });
  assert.deepEqual(ack, { ok: false, reason: "unknown_logical_run" });
});

test("Background serial queue가 outer→pin claim을 순서대로 ACK하고 completionDispatch를 영속한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  const fingerprint = "fp-kea-2026-08-20-1140-2-20000-form1";
  const outerAck = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint,
  });
  // 새로 영속된 권한만 dispatchGranted:true다 — content는 이때만 클릭한다.
  assert.deepEqual(outerAck, { ok: true, dispatchGranted: true });
  assert.deepEqual(h.store.get("logicalRun").completionDispatch, { fingerprint, outerClaimedAt: h.state.nowMs });

  // 같은 phase·fingerprint 재전송(ACK 유실 재전송 등)은 멱등 ACK지만 dispatchGranted:false —
  // 새 클릭 권한을 만들지 않아 이중 dispatch를 막는다.
  const outerReplay = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint,
  });
  assert.deepEqual(outerReplay, { ok: true, dispatchGranted: false });

  // pin-before-outer가 아니라 fingerprint 불일치는 거절한다.
  const mismatched = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "pin", fingerprint: "fp-different",
  });
  assert.deepEqual(mismatched, { ok: false, reason: "fingerprint_mismatch" });

  const pinAck = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "pin", fingerprint,
  });
  assert.deepEqual(pinAck, { ok: true, dispatchGranted: true });
  const stored = h.store.get("logicalRun").completionDispatch;
  assert.deepEqual(stored, { fingerprint, outerClaimedAt: h.state.nowMs, pinClaimedAt: h.state.nowMs });

  const pinReplay = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "pin", fingerprint,
  });
  assert.deepEqual(pinReplay, { ok: true, dispatchGranted: false });
  assert.equal(containsKey([...h.store.values()], "catchPayPin"), false);
});

test("pin-before-outer는 background에서도 거절한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  const pinFirst = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "pin", fingerprint: "fp-a",
  });
  assert.deepEqual(pinFirst, { ok: false, reason: "phase_order" });
});

test("stop은 completionDispatch에 stop 마커를 영속해 이후 outer claim을 거절한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  // 실제로는 EXECUTING 진입 전에 여러 RUN_EVENT가 activeRun.state를 CONFIGURED에서
  // 옮겨 둔다 — 이 테스트에서는 stop()의 CONFIGURED 조기 경로를 피하려고 직접 반영한다.
  h.store.set("activeRun", { ...h.store.get("activeRun"), state: "COMPLETING_RESERVATION" });
  await h.supervisor.stop();
  // pre-claim stop(outer claim이 아직 없는 상태)은 기존 STOP 전달 동작을 그대로 유지한다.
  assert.equal(h.calls.stops, 1);
  const afterStop = h.store.get("logicalRun");
  assert.deepEqual(afterStop.completionDispatch, { stopRequestedAt: h.state.nowMs });
  const rejected = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint: "fp-a",
  });
  assert.deepEqual(rejected, { ok: false, reason: "stop_requested" });
});

test("acknowledged outer claim 뒤 stop은 일반 STOP을 보내지 않고 stop 마커만 영속한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  h.store.set("activeRun", { ...h.store.get("activeRun"), state: "COMPLETING_RESERVATION" });
  const fingerprint = "fp-outer-ack-then-stop";
  const outerAck = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint,
  });
  assert.deepEqual(outerAck, { ok: true, dispatchGranted: true });
  await h.supervisor.stop();
  // 이미 허용된 outer dispatch는 취소했다고 추측하지 않는다 — 일반 STOP으로 Content의
  // 관측 루프를 abort하지 않고 stopRequestedAt만 추가한다.
  assert.equal(h.calls.stops, 0);
  const afterStop = h.store.get("logicalRun");
  assert.deepEqual(afterStop.completionDispatch, { fingerprint, outerClaimedAt: h.state.nowMs, stopRequestedAt: h.state.nowMs });
  assert.equal(afterStop.status, "EXECUTING"); // stop이 run을 임의로 종결시키지 않는다

  // stop이 outer와 pin claim 사이에 오면 pin claim은 거절돼 내부 결제를 클릭하지 않는다.
  const pinRejected = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "pin", fingerprint,
  });
  assert.deepEqual(pinRejected, { ok: false, reason: "stop_requested" });
});

test("projection lag: activeRun.state가 아직 CONFIGURED로 지연 표시돼도 acknowledged outer claim이 있으면 stop이 이를 우선한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  // 실제 RUN_EVENT projection 반영 전 activeRun.state는 startLogical이 남긴 "CONFIGURED"
  // 그대로다 — 여기서는 일부러 patch하지 않아 이 지연 경쟁을 재현한다.
  assert.equal(h.store.get("activeRun").state, "CONFIGURED");
  const fingerprint = "fp-projection-lag";
  const outerAck = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint,
  });
  assert.deepEqual(outerAck, { ok: true, dispatchGranted: true });
  await h.supervisor.stop();
  // durable logicalRun claim이 activeRun projection(지연된 CONFIGURED)보다 우선해야
  // 한다 — CONFIGURED 조기 분기로 새지 않고 stopRequestedAt만 영속한다.
  assert.equal(h.calls.stops, 0);
  const afterStop = h.store.get("logicalRun");
  assert.deepEqual(afterStop.completionDispatch, { fingerprint, outerClaimedAt: h.state.nowMs, stopRequestedAt: h.state.nowMs });
  assert.equal(afterStop.status, "EXECUTING"); // CONFIGURED 조기 분기의 강제 TERMINAL로 새지 않는다
  assert.equal(h.store.get("activeRun").state, "CONFIGURED"); // STOPPED로 단정하지 않는다
  assert.equal(h.calls.effects.length, 0); // terminateLogical이 실행되지 않았다
});

test("acknowledged pin claim 뒤 stop도 일반 STOP을 보내지 않고 기존 dispatch claim을 보존한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  h.store.set("activeRun", { ...h.store.get("activeRun"), state: "COMPLETING_RESERVATION" });
  const fingerprint = "fp-pin-ack-then-stop";
  await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint,
  });
  const pinAck = await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "pin", fingerprint,
  });
  assert.deepEqual(pinAck, { ok: true, dispatchGranted: true });
  await h.supervisor.stop();
  assert.equal(h.calls.stops, 0);
  const afterStop = h.store.get("logicalRun");
  // 이미 허용된 outer/pin dispatch claim은 stop 뒤에도 그대로 보존된다(취소 완료로 오판하지 않는다).
  assert.deepEqual(afterStop.completionDispatch,
    { fingerprint, outerClaimedAt: h.state.nowMs, pinClaimedAt: h.state.nowMs, stopRequestedAt: h.state.nowMs });
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

test("completion claim이 있는 EXECUTING attempt는 reconcile에서 RESET/재시작 없이 HANDED_OFF로 종결한다", async () => {
  const executing = {
    ...createLogicalRun({
      logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(), tabId: 7,
      attemptId: "run-a1", nowMs: 0,
    }),
    status: "EXECUTING",
    completionDispatch: { fingerprint: "fp-a", outerClaimedAt: 10 },
  };
  const h = harness({
    seed: {
      logicalRun: executing,
      reservationConfig: config(),
      activeRun: { runId: "run-a1", tabId: 7, state: "COMPLETING_RESERVATION", startedAt: 0, updatedAt: 0 },
    },
    status: () => null,
  });
  await h.supervisor.ready;
  const run = h.store.get("logicalRun");
  assert.equal(run.status, "TERMINAL");
  assert.equal(run.attempts[0].finalState, "HANDED_OFF");
  assert.equal(h.store.get("activeRun").state, "HANDED_OFF");
  assert.equal(h.calls.effects.length, 1); // RESET_PAGE·새 START 없이 효과 1회만
  assert.deepEqual(h.calls.reenters, []);
  assert.deepEqual(h.calls.starts, []);
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

test("acknowledged completion claim 뒤 탭이 닫히면 STOPPED가 아니라 결과불명 HANDED_OFF로 종결한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint: "fp-tab-removed",
  });
  await h.supervisor.onTabRemoved(7);
  await h.settle();
  const after = h.store.get("logicalRun");
  assert.equal(after.status, "TERMINAL");
  assert.equal(after.attempts[0].finalState, "HANDED_OFF");
  assert.equal(h.store.get("activeRun").state, "HANDED_OFF");
  // FAILED/STOPPED로 단정하지 않으므로 backgroundTerminal(STOPPED|FAILED) trace를 남기지 않는다.
  assert.equal(h.calls.traces.some(([kind]) => kind === "backgroundTerminal"), false);
  assert.equal(h.calls.effects.length, 1);
});

test("claim 없는 실행이 설정한 식당을 벗어나면 기존대로 STOPPED로 종결한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  await h.supervisor.onTabUrlChanged(7, "https://app.catchtable.co.kr/ct/mydining/my/planned");
  await h.settle();
  const run = h.store.get("logicalRun");
  assert.equal(run.status, "TERMINAL");
  assert.equal(run.attempts[0].finalState, "STOPPED");
  assert.equal(h.store.get("activeRun").state, "STOPPED");
  assert.equal(h.calls.traces.some(([kind, message]) => kind === "backgroundTerminal" && /벗어났습니다/.test(message)), true);
});

test("acknowledged claim 뒤 다른 URL/origin으로 이동하면 STOPPED가 아니라 HANDED_OFF로 종결한다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint: "fp-url-changed",
  });
  await h.supervisor.onTabUrlChanged(7, "https://app.catchtable.co.kr/ct/mydining/my/history");
  await h.settle();
  const after = h.store.get("logicalRun");
  assert.equal(after.status, "TERMINAL");
  assert.equal(after.attempts[0].finalState, "HANDED_OFF");
  assert.equal(h.store.get("activeRun").state, "HANDED_OFF");
  assert.equal(h.calls.traces.some(([kind]) => kind === "backgroundTerminal"), false);
  assert.equal(h.calls.effects.length, 1);
});

test("acknowledged claim의 정확한 success path 이동은 이탈 종결하지 않는다", async () => {
  const h = harness();
  await h.supervisor.ready;
  await h.supervisor.startManual(config());
  const run = h.store.get("logicalRun");
  await h.supervisor.onPhaseChanged({
    type: "ATTEMPT_PHASE_CHANGED", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId, phase: "EXECUTING",
  });
  await h.supervisor.onCompletionDispatchClaim({
    type: "COMPLETION_DISPATCH_CLAIM", logicalRunId: run.logicalRunId, attemptId: run.currentAttemptId,
    phase: "outer", fingerprint: "fp-success-path",
  });
  await h.supervisor.onTabUrlChanged(7, "https://app.catchtable.co.kr/ct/mydining/my/planned");
  await h.settle();
  const after = h.store.get("logicalRun");
  assert.equal(after.status, "EXECUTING"); // 이탈 종결되지 않는다
  assert.equal(h.calls.effects.length, 0);
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
