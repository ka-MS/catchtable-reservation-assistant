import assert from "node:assert/strict";
import test from "node:test";
import { OpenRunOrchestrator } from "../dist/content/orchestrator.js";

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: 1_000,
    reservationDate: "2026-07-30",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [1140],
    postSlotEnabled: true,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: 3_000,
    entryMode: "prepared",
    dryRun: true,
    preOpenLeadMs: 300,
    toggleIntervalMs: 400,
    clockSampleCount: 3,
    ...overrides,
  };
}

function harness({
  slotAfterCycles = 1,
  clickResult = true,
  entry = { inspect: () => ({ reservationOpen: true, ctaAvailable: true, waitingOnly: false }), openReservation: () => true },
  person = { inspect: () => ({ ready: true, targetAvailable: true, targetSelected: true }), select: () => true },
  prepareTarget = () => ({ status: "ready", message: "목표 날짜가 준비됐습니다." }),
  postSlot = { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
} = {}) {
  let now = 0;
  let cycles = 0;
  let slotClicks = 0;
  const dateClicks = [];
  const dateClickTimes = [];
  const events = [];
  const calendar = {
    inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
    prepareTarget,
    clickDate: (date) => {
      dateClicks.push(date);
      dateClickTimes.push({ date, at: now });
      if (date === "2026-07-30") cycles += 1;
      return true;
    },
  };
  const slots = {
    readAvailableSlots: () => cycles >= slotAfterCycles ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [],
    clickSlot: () => {
      slotClicks += 1;
      return clickResult;
    },
  };
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    syncClock: async () => ({
      offsetMs: 0,
      sampleCount: 3,
      spreadMs: 2,
      fallback: false,
      method: "boundary",
      precisionMs: 20,
    }),
    calendar,
    entry,
    person,
    slots,
    postSlot,
    sleep: async (ms, signal) => {
      if (signal.aborted) return false;
      now += ms;
      return true;
    },
    emit: (event) => events.push(event),
    runId: () => "run-1",
  });
  return {
    orchestrator,
    dateClicks,
    dateClickTimes,
    events,
    get slotClicks() { return slotClicks; },
    get now() { return now; },
  };
}

test("dry-run detects a prioritized slot without clicking", async () => {
  const h = harness({ slotAfterCycles: 2 });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(h.slotClicks, 0);
  assert.deepEqual(h.dateClicks, ["2026-07-29", "2026-07-30", "2026-07-29", "2026-07-30"]);
  assert.equal(h.dateClickTimes.filter((click) => click.date === "2026-07-30").at(-1)?.at, 1_000);
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");
  assert.equal(detected?.data?.timingStage, "slot_detected");
  assert.equal(detected?.data?.adjacentTimingServerAtMs, 960);
  assert.equal(detected?.data?.adjacentOpenDeltaMs, -40);
  assert.equal(detected?.data?.adjacentScheduleDriftMs, 0);
  assert.equal(detected?.data?.targetTimingServerAtMs, 1_000);
  assert.equal(detected?.data?.targetOpenDeltaMs, 0);
  assert.equal(detected?.data?.targetScheduleDriftMs, 0);
  assert.equal(detected?.data?.timingServerAtMs, 1_020);
  assert.equal(detected?.data?.openDeltaMs, 20);
  assert.deepEqual(h.events.filter((event) => event.kind === "state").map((event) => event.data?.state), [
    "CONFIGURED",
    "VALIDATING",
    "SYNCING_CLOCK",
    "PREPARING_PAGE",
    "WAITING_FOR_OPEN",
    "REFRESHING_SLOTS",
    "SLOT_DETECTED",
    "DRY_RUN_COMPLETED",
  ]);
});

test("auto entry opens the reservation, prepares date and person, then uses the existing safety check", async () => {
  let reservationOpen = false;
  let datePrepared = false;
  let personSelected = false;
  const actions = [];
  const h = harness({
    entry: {
      inspect: () => ({ reservationOpen, ctaAvailable: true, waitingOnly: false }),
      openReservation: () => {
        reservationOpen = true;
        actions.push("entry");
        return true;
      },
    },
    prepareTarget: () => {
      if (datePrepared) return { status: "ready", message: "목표 날짜가 준비됐습니다." };
      datePrepared = true;
      actions.push("date");
      return { status: "acted", message: "목표 날짜를 선택했습니다." };
    },
    person: {
      inspect: () => ({ ready: true, targetAvailable: true, targetSelected: personSelected }),
      select: () => {
        personSelected = true;
        actions.push("person");
        return true;
      },
    },
  });

  const result = await h.orchestrator.start(config({ entryMode: "auto" }));

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(actions, ["entry", "date", "person"]);
  assert.deepEqual(h.events.filter((event) => event.kind === "state").map((event) => event.data?.state).slice(0, 8), [
    "CONFIGURED",
    "VALIDATING",
    "SYNCING_CLOCK",
    "ENTERING_RESERVATION",
    "SELECTING_DATE",
    "SELECTING_PERSON",
    "PREPARING_PAGE",
    "WAITING_FOR_OPEN",
  ]);
});

test("auto entry hands off safely when the restaurant is waiting-only", async () => {
  const h = harness({
    entry: {
      inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }),
      openReservation: () => false,
    },
  });

  const result = await h.orchestrator.start(config({ entryMode: "auto" }));

  assert.equal(result.state, "HANDED_OFF");
  assert.match(h.events.at(-1)?.message ?? "", /웨이팅/);
});

test("auto entry never substitutes an unavailable person count", async () => {
  let selections = 0;
  const h = harness({
    person: {
      inspect: () => ({ ready: true, targetAvailable: false, targetSelected: false }),
      select: () => {
        selections += 1;
        return true;
      },
    },
  });

  const result = await h.orchestrator.start(config({ entryMode: "auto", personCount: 20 }));

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(selections, 0);
  assert.match(h.events.at(-1)?.message ?? "", /20명/);
});

test("actual mode clicks one slot and hands off at the reservation form", async () => {
  const h = harness();
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.slotClicks, 1);
  const slotSelected = h.events.find((event) => event.data?.state === "SLOT_SELECTED");
  assert.equal(typeof slotSelected?.data?.openDeltaMs, "number");
  assert.equal(slotSelected?.data?.openDeltaMs, slotSelected?.serverAt - 1_000);
  assert.equal(slotSelected?.data?.timingStage, "slot_selected");
  assert.equal(slotSelected?.data?.timingServerAtMs, slotSelected?.serverAt);
  assert.match(slotSelected?.message ?? "", /시간 선택을 완료/);
  assert.equal(h.events.some((event) => event.data?.state === "ADVANCING_RESERVATION"), true);
  const handedOff = h.events.at(-1);
  assert.equal(handedOff?.data?.state, "HANDED_OFF");
  assert.match(handedOff?.message ?? "", /예약 폼/);
  assert.equal(typeof handedOff?.data?.openDeltaMs, "number");
  assert.equal(typeof handedOff?.data?.timingServerAtMs, "number");
  assert.equal(handedOff?.data?.openDeltaMs, handedOff?.data?.timingServerAtMs - 1_000);
});

test("disabled post-slot automation stops immediately after the slot click", async () => {
  let inspections = 0;
  const h = harness({
    postSlot: {
      inspect: () => {
        inspections += 1;
        return { kind: "table_type", options: ["홀"] };
      },
      advance: () => ({ status: "acted", message: "unexpected" }),
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false, postSlotEnabled: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.slotClicks, 1);
  assert.equal(inspections, 0);
  assert.equal(h.events.some((event) => event.data?.state === "ADVANCING_RESERVATION"), false);
  assert.match(h.events.at(-1)?.message ?? "", /슬롯 선택까지만/);
});

test("optional post-slot stages are advanced in observed order", async () => {
  const stages = [
    { kind: "table_type", options: ["홀", "바"] },
    { kind: "extras" },
    { kind: "menu", options: ["디너 오마카세"] },
    { kind: "deposit" },
    { kind: "form" },
  ];
  const actions = [];
  let index = 0;
  const h = harness({
    postSlot: {
      inspect: () => stages[index],
      advance: (stage) => {
        actions.push(stage.kind);
        index += 1;
        return { status: "acted", message: `${stage.kind} 처리` };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.deepEqual(actions, ["table_type", "extras", "menu", "deposit"]);
  assert.equal(h.events.some((event) => event.data?.postSlotStage === "menu" && "openDeltaMs" in event.data), false);
  assert.match(h.events.at(-1)?.message ?? "", /예약 폼/);
});

test("unknown post-slot screens hand off with safe structural diagnostics", async () => {
  let advances = 0;
  const unknown = {
    kind: "unknown",
    label: "새로운 예약 단계",
    certainty: "unknown",
    strategy: "unknown-dialog-v1",
    evidence: ["unsupported dialog structure"],
    fingerprint: "ps-a1b2c3d4",
    diagnostics: {
      urlKind: "shop",
      label: "새로운 예약 단계",
      title: "고객 요청 확인",
      buttons: ["이전", "계속"],
      disabledButtonCount: 1,
      radioCount: 0,
      checkboxCount: 0,
      quantityControlCount: 0,
      zeroDepositControlCount: 0,
    },
  };
  const h = harness({
    postSlot: {
      inspect: () => unknown,
      advance: () => {
        advances += 1;
        return { status: "acted", message: "unexpected" };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));
  const handoff = h.events.at(-1);

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(advances, 0);
  assert.equal(handoff?.data?.postSlotCertainty, "unknown");
  assert.equal(handoff?.data?.postSlotStrategy, "unknown-dialog-v1");
  assert.equal(handoff?.data?.postSlotFingerprint, "ps-a1b2c3d4");
  assert.equal(handoff?.data?.dialogTitle, "고객 요청 확인");
  assert.equal(handoff?.data?.dialogButtons, "이전 | 계속");
});

test("a promo notice appearing after form arrival is dismissed before handing off", async () => {
  // The promo dialog renders non-deterministically after the form loads, so the
  // orchestrator dwells on the form briefly instead of handing off on first sight.
  let inspections = 0;
  const actions = [];
  const h = harness({
    postSlot: {
      inspect: () => {
        inspections += 1;
        if (inspections < 10) return { kind: "form" };
        if (inspections === 10) return { kind: "form_notice" };
        return { kind: "form" };
      },
      advance: (stage) => {
        actions.push(stage.kind);
        return { status: "acted", message: "예약 폼 안내 창을 닫았습니다." };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.deepEqual(actions, ["form_notice"]);
  assert.equal(h.events.some((event) => event.message === "예약 폼 안내 창을 닫았습니다."), true);
  assert.match(h.events.at(-1)?.message ?? "", /예약 폼/);
});

test("late form arrival receives the full promo grace period and keeps its arrival time", async () => {
  let h;
  let formSeenAt;
  let noticeDismissed = false;
  const actions = [];
  h = harness({
    postSlot: {
      inspect: () => {
        if (h.now < 5_600) return { kind: "waiting" };
        formSeenAt ??= h.now;
        if (!noticeDismissed && h.now >= 6_100) return { kind: "form_notice" };
        return { kind: "form" };
      },
      advance: (stage) => {
        actions.push(stage.kind);
        noticeDismissed = true;
        return { status: "acted", message: "예약 폼 안내 창을 닫았습니다." };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));
  const handoff = h.events.at(-1);

  assert.equal(result.state, "HANDED_OFF");
  assert.deepEqual(actions, ["form_notice"]);
  assert.ok(h.now >= 6_100);
  assert.equal(handoff?.data?.openDeltaMs, formSeenAt - 1_000);
  assert.equal(handoff?.data?.timingServerAtMs, formSeenAt);
});

test("post-slot waiting actions are retried instead of handing off", async () => {
  let advances = 0;
  const h = harness({
    postSlot: {
      inspect: () => advances >= 2 ? { kind: "form" } : { kind: "menu", options: ["디너"] },
      advance: () => {
        advances += 1;
        return advances === 1
          ? { status: "waiting", message: "확인 버튼 활성화 대기" }
          : { status: "acted", message: "메뉴 선택 완료" };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(advances, 2);
  assert.equal(h.events.some((event) => event.message === "확인 버튼 활성화 대기"), false);
});

test("long waits resynchronize the server clock shortly before opening", async () => {
  let now = 0;
  let syncCalls = 0;
  let targetClicks = 0;
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    syncClock: async () => {
      syncCalls += 1;
      return {
        offsetMs: syncCalls === 1 ? 25 : 40,
        sampleCount: 9,
        spreadMs: 10,
        fallback: false,
        method: "boundary",
        precisionMs: 15,
      };
    },
    calendar: {
      inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
      clickDate: (date) => {
        if (date === "2026-07-30") targetClicks += 1;
        return true;
      },
    },
    slots: {
      readAvailableSlots: () => targetClicks > 0 ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [],
      clickSlot: () => true,
    },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
    sleep: async (ms) => {
      now += ms;
      return true;
    },
    emit: () => undefined,
    runId: () => "run-final-sync",
  });

  const result = await orchestrator.start(config({
    openAtMs: 10_000,
    stopAtMs: 12_000,
    dryRun: true,
  }));

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(syncCalls, 2);
});

test("monitoring terminates at stop time without slot clicks", async () => {
  const h = harness({ slotAfterCycles: Number.POSITIVE_INFINITY });
  const result = await h.orchestrator.start(config({ stopAtMs: 1_500 }));
  assert.equal(result.state, "TIMED_OUT");
  assert.equal(h.slotClicks, 0);
  assert.ok(h.now >= 1_500);
});

test("deadline wins over a slot that appears during target-date settling", async () => {
  let now = 0;
  let targetClicked = false;
  let reads = 0;
  let clicks = 0;
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    syncClock: async () => ({
      offsetMs: 0,
      sampleCount: 3,
      spreadMs: 1,
      fallback: false,
      method: "boundary",
      precisionMs: 20,
    }),
    calendar: {
      inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
      clickDate: (date) => {
        if (date === "2026-07-30") targetClicked = true;
        return true;
      },
    },
    slots: {
      readAvailableSlots: () => {
        reads += 1;
        return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
      },
      clickSlot: () => {
        clicks += 1;
        return true;
      },
    },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
    sleep: async (ms) => {
      now = targetClicked ? 1_001 : now + ms;
      return true;
    },
    emit: () => undefined,
    runId: () => "run-deadline",
  });
  const result = await orchestrator.start(config({ stopAtMs: 1_001 }));
  assert.equal(result.state, "TIMED_OUT");
  assert.equal(reads, 0);
  assert.equal(clicks, 0);
});

test("missing adjacent date hands control to the user", async () => {
  const h = harness();
  h.orchestrator = new OpenRunOrchestrator({
    clock: { now: () => 0 },
    syncClock: async () => ({
      offsetMs: 0,
      sampleCount: 3,
      spreadMs: 1,
      fallback: false,
      method: "boundary",
      precisionMs: 20,
    }),
    calendar: { inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: null }), clickDate: () => false },
    slots: { readAvailableSlots: () => [], clickSlot: () => false },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
    sleep: async () => true,
    emit: () => undefined,
    runId: () => "run-2",
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "HANDED_OFF");
});
