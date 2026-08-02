import assert from "node:assert/strict";
import test from "node:test";
import { WaitingRunOrchestrator } from "../dist/content/waiting-orchestrator.js";
import { validateWaitingConfig } from "../dist/shared/waiting-config.js";

const OPEN_AT = 1_800_000_000_000;

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: OPEN_AT,
    stopAtMs: OPEN_AT + 60_000,
    dryRun: false,
    preOpenLeadMs: 3_000,
    pollIntervalMs: 25,
    refreshIntervalMs: 500,
    ...overrides,
  };
}

/** 가상 시계: sleep이 곧 시간 진행이므로 실제 대기 없이 오픈 순간까지 결정적으로 흐른다. */
function harness(options = {}) {
  const {
    openAtFacts = { present: true, label: "웨이팅 등록하기", registerable: true, onsiteOnly: false, refreshAvailable: true },
    closedFacts = {
      present: true, label: "온라인 웨이팅오전 9시 30분에 오픈",
      registerable: false, onsiteOnly: false, refreshAvailable: true,
    },
    releaseAtMs = OPEN_AT,
    clickSucceeds = true,
    refreshSucceeds = true,
    snapshots = null,
  } = options;
  let nowMs = OPEN_AT - 60_000;
  const events = [];
  let clicks = 0;
  let refreshClicks = 0;
  const refreshAtMs = [];
  let wakeListener = null;
  const state = { wakeStarted: 0, wakeStopped: 0, inspections: 0 };
  const orchestrator = new WaitingRunOrchestrator({
    clock: { now: () => nowMs },
    monotonicClock: { now: () => nowMs },
    referenceClock: () => ({
      latest: null,
      sampleOnce: async () => null,
      ingest: () => undefined,
      drainSamples: () => [],
      start: async () => undefined,
      stop: () => undefined,
    }),
    cta: {
      inspect: () => {
        state.inspections += 1;
        return nowMs >= releaseAtMs ? openAtFacts : closedFacts;
      },
      clickRegister: () => {
        if (!clickSucceeds) return false;
        clicks += 1;
        return true;
      },
      clickRefresh: () => {
        if (!refreshSucceeds) return false;
        refreshClicks += 1;
        refreshAtMs.push(nowMs);
        return true;
      },
    },
    wake: {
      start: (listener) => {
        state.wakeStarted += 1;
        wakeListener = listener;
      },
      stop: () => {
        state.wakeStopped += 1;
        wakeListener = null;
      },
    },
    sleep: async (ms) => {
      nowMs += ms;
      return true;
    },
    emit: (event) => events.push(event),
    ...(snapshots === null ? {} : { captureSnapshot: () => snapshots.shift() ?? null }),
    runId: () => "run-waiting",
  });
  return {
    orchestrator, events, state, wake: () => wakeListener, now: () => nowMs,
    clicks: () => clicks, refreshClicks: () => refreshClicks, refreshAtMs,
  };
}

test("waiting orchestrator clicks the cta at open and hands off", async () => {
  const h = harness();
  const result = await h.orchestrator.start(config(), "run-waiting");
  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.clicks(), 1);
  const states = h.events.filter((event) => event.kind === "state").map((event) => event.data.state);
  assert.deepEqual(states, [
    "CONFIGURED", "VALIDATING", "SYNCING_CLOCK", "WAITING_FOR_OPEN",
    "WATCHING_WAITING_CTA", "WAITING_CTA_DISPATCHED", "HANDED_OFF",
  ]);
});

test("waiting orchestrator does not click before the cta is released", async () => {
  const h = harness({ releaseAtMs: OPEN_AT + 5_000 });
  await h.orchestrator.start(config(), "run-waiting");
  const dispatch = h.events.find((event) => event.data?.state === "WAITING_CTA_DISPATCHED");
  assert.ok(dispatch, "클릭 상태 전이가 있어야 한다");
  assert.ok(h.now() >= OPEN_AT + 5_000, "활성화 시각 이전에는 클릭하지 않는다");
  assert.equal(h.clicks(), 1);
});

test("waiting orchestrator dry-run detects activation without clicking", async () => {
  const h = harness();
  const result = await h.orchestrator.start(config({ dryRun: true }), "run-waiting");
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(h.clicks(), 0);
});

test("waiting orchestrator hands off onsite-only shops before waiting", async () => {
  const h = harness({
    closedFacts: {
      present: true, label: "현장 웨이팅만 가능", registerable: false, onsiteOnly: true, refreshAvailable: true,
    },
    releaseAtMs: Number.POSITIVE_INFINITY,
  });
  const result = await h.orchestrator.start(config(), "run-waiting");
  assert.equal(result.state, "HANDED_OFF");
  assert.match(result.message, /현장 웨이팅만/);
  assert.equal(h.state.wakeStarted, 0);
});

test("waiting orchestrator hands off when the dock has no waiting cta", async () => {
  const h = harness({
    closedFacts: { present: false, label: "", registerable: false, onsiteOnly: false, refreshAvailable: false },
    releaseAtMs: Number.POSITIVE_INFINITY,
  });
  const result = await h.orchestrator.start(config(), "run-waiting");
  assert.equal(result.state, "HANDED_OFF");
  assert.match(result.message, /온라인 웨이팅 버튼/);
});

test("waiting orchestrator times out when the cta never activates", async () => {
  const h = harness({ releaseAtMs: Number.POSITIVE_INFINITY });
  const result = await h.orchestrator.start(config(), "run-waiting");
  assert.equal(result.state, "TIMED_OUT");
  assert.equal(h.clicks(), 0);
  assert.ok(h.state.inspections > 1, "감시 구간에서 CTA를 반복 검사해야 한다");
});

test("waiting orchestrator hands off when the click cannot be dispatched", async () => {
  const h = harness({ clickSucceeds: false });
  const result = await h.orchestrator.start(config(), "run-waiting");
  assert.equal(result.state, "HANDED_OFF");
  assert.match(result.message, /클릭하지 못했습니다/);
  assert.ok(h.events.some((event) => event.kind === "error"));
});

test("waiting orchestrator rejects an invalid config without touching the page", async () => {
  const h = harness();
  const result = await h.orchestrator.start(config({ targetUrl: "https://example.com/ct/shop/kea" }), "run-waiting");
  assert.equal(result.state, "FAILED");
  assert.equal(h.state.inspections, 0);
  assert.equal(h.clicks(), 0);
});

test("waiting orchestrator records the post-click screen as evidence without acting on it", async () => {
  const snapshot = {
    urlKind: "shop",
    headings: ["웨이팅 등록"],
    buttons: ["매장 식사", "등록하기"],
    disabledButtons: [false, true],
    disabledButtonCount: 1,
    dialogLabel: "",
    dialogTitle: "웨이팅 등록",
    textSnippet: "인원을 선택해 주세요",
    fingerprint: "ss-abc",
  };
  const h = harness({ snapshots: [snapshot] });
  const result = await h.orchestrator.start(config(), "run-waiting");
  assert.equal(result.state, "HANDED_OFF");
  const observed = h.events.find((event) => event.data?.postClickFingerprint === "ss-abc");
  assert.ok(observed, "클릭 후 화면 관측 이벤트가 있어야 한다");
  assert.equal(observed.data.postClickButtons, "매장 식사 | 등록하기");
  assert.equal(h.clicks(), 1, "관측은 추가 클릭을 하지 않는다");
});

test("waiting orchestrator stop aborts the watch loop", async () => {
  const h = harness({ releaseAtMs: Number.POSITIVE_INFINITY });
  const started = h.orchestrator.start(config({ stopAtMs: OPEN_AT + 3_600_000 }), "run-waiting");
  h.orchestrator.stop();
  const result = await started;
  assert.equal(result.state, "STOPPED");
  assert.equal(h.clicks(), 0);
});

test("waiting config validation rejects non-shop urls and inverted windows", () => {
  assert.deepEqual(validateWaitingConfig(config(), OPEN_AT - 60_000), []);
  assert.ok(validateWaitingConfig(config({ targetUrl: "https://app.catchtable.co.kr/ct/map/search-map" }), 0).length > 0);
  assert.ok(validateWaitingConfig(config({ stopAtMs: OPEN_AT - 1 }), 0).length > 0);
  assert.ok(validateWaitingConfig(config({ pollIntervalMs: 5 }), 0).length > 0);
  assert.ok(validateWaitingConfig(config({ preOpenLeadMs: 20_000 }), 0).length > 0);
});

// 사용자 실사용 절차: 오픈 전부터 새로고침을 반복해야 CTA가 열리는 것을 볼 수 있다.
test("waiting orchestrator clicks refresh repeatedly while the cta stays disabled", async () => {
  const h = harness({ releaseAtMs: OPEN_AT + 4_000 });
  await h.orchestrator.start(config({ refreshIntervalMs: 500 }), "run-waiting");
  assert.ok(h.refreshClicks() >= 8, `새로고침을 반복해야 한다 (실제 ${h.refreshClicks()}회)`);
  const gaps = h.refreshAtMs.slice(1).map((at, index) => at - h.refreshAtMs[index]);
  assert.ok(gaps.every((gap) => gap >= 500), `새로고침 간격이 설정보다 짧아선 안 된다: ${gaps.join(",")}`);
  assert.equal(h.clicks(), 1);
});

test("waiting orchestrator starts refreshing before open, not at open", async () => {
  const h = harness({ releaseAtMs: OPEN_AT });
  await h.orchestrator.start(config({ preOpenLeadMs: 3_000, refreshIntervalMs: 500 }), "run-waiting");
  assert.ok(h.refreshAtMs.length > 0, "무장 즉시 첫 새로고침을 눌러야 한다");
  assert.ok(h.refreshAtMs[0] < OPEN_AT, `첫 새로고침이 오픈 전이어야 한다: ${h.refreshAtMs[0] - OPEN_AT}ms`);
});

test("waiting orchestrator skips refresh entirely when the interval is zero", async () => {
  const h = harness({ releaseAtMs: OPEN_AT + 2_000 });
  await h.orchestrator.start(config({ refreshIntervalMs: 0 }), "run-waiting");
  assert.equal(h.refreshClicks(), 0);
  assert.equal(h.clicks(), 1);
});

test("waiting orchestrator does not refresh when the cta is already open", async () => {
  const h = harness({ releaseAtMs: 0 });
  await h.orchestrator.start(config({ refreshIntervalMs: 500 }), "run-waiting");
  assert.equal(h.refreshClicks(), 0, "이미 열려 있으면 갱신 요청 없이 바로 클릭한다");
  assert.equal(h.clicks(), 1);
});

test("waiting orchestrator reports a missing refresh control once and keeps watching", async () => {
  const h = harness({
    closedFacts: {
      present: true, label: "온라인 웨이팅오전 9시 30분에 오픈",
      registerable: false, onsiteOnly: false, refreshAvailable: false,
    },
    releaseAtMs: OPEN_AT + 2_000,
    refreshSucceeds: false,
  });
  const result = await h.orchestrator.start(config({ refreshIntervalMs: 500 }), "run-waiting");
  const missing = h.events.filter((event) => event.kind === "error" && /새로고침 컨트롤/.test(event.message));
  assert.equal(missing.length, 1, "누락 보고는 한 번만 한다");
  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.clicks(), 1, "새로고침이 없어도 활성화되면 클릭한다");
});

test("waiting config validation rejects a refresh interval that hammers the server", () => {
  assert.deepEqual(validateWaitingConfig(config({ refreshIntervalMs: 0 }), OPEN_AT - 60_000), []);
  assert.deepEqual(validateWaitingConfig(config({ refreshIntervalMs: 200 }), OPEN_AT - 60_000), []);
  assert.ok(validateWaitingConfig(config({ refreshIntervalMs: 50 }), 0).length > 0);
  assert.ok(validateWaitingConfig(config({ refreshIntervalMs: -1 }), 0).length > 0);
  assert.ok(validateWaitingConfig(config({ refreshIntervalMs: 6_000 }), 0).length > 0);
});
