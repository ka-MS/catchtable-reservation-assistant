import assert from "node:assert/strict";
import test from "node:test";
import {
  configFingerprint,
  removeSavedConfig,
  sanitizeSavedConfigs,
  upsertSavedConfig,
} from "../dist/shared/saved-configs.js";

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/sushi_sujung?date=260730",
    openAtMs: 1_000,
    reservationDate: "2026-07-30",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [1140, 1110],
    postSlotEnabled: true,
    paymentMethodAutoAdvance: true,
    paymentMethodPolicy: "selected_allowed",
    tablePreference: "bar",
    menuKeyword: " 디너   오마카세 ",
    stopAtMs: 601_000,
    entryMode: "auto",
    dryRun: false,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 150,
    ...overrides,
  };
}

test("fingerprint represents booking intent rather than run timestamps", () => {
  const first = configFingerprint(config());
  const rerun = configFingerprint(config({
    targetUrl: "https://app.catchtable.co.kr/ct/shop/sushi_sujung/",
    openAtMs: 9_000,
    stopAtMs: 609_000,
    menuKeyword: "디너 오마카세",
  }));
  assert.equal(first, rerun);
  assert.notEqual(first, configFingerprint(config({ personCount: 3 })));
  assert.notEqual(first, configFingerprint(config({ timeRange: { startMinutes: 720, endMinutes: 840 } })));
});

test("upsert replaces an equivalent snapshot and keeps newest-first order", () => {
  const old = upsertSavedConfig([], config(), { id: "old", savedAt: 10 });
  const other = upsertSavedConfig(old, config({ reservationDate: "2026-07-31" }), { id: "other", savedAt: 20 });
  const replaced = upsertSavedConfig(other, config({ openAtMs: 30, stopAtMs: 600_030 }), { id: "new", savedAt: 30 });

  assert.deepEqual(replaced.map((item) => item.id), ["new", "other"]);
  assert.equal(replaced[0].config.openAtMs, 30);
});

test("upsert caps each list at twenty and remove deletes only one id", () => {
  let items = [];
  for (let index = 0; index < 22; index += 1) {
    items = upsertSavedConfig(items, config({ reservationDate: `2026-08-${String(index + 1).padStart(2, "0")}` }), {
      id: `id-${index}`,
      savedAt: index,
    });
  }
  assert.equal(items.length, 20);
  assert.equal(items[0].id, "id-21");
  assert.equal(items.at(-1).id, "id-2");
  assert.equal(removeSavedConfig(items, "id-10").some((item) => item.id === "id-10"), false);
});

test("sanitize drops corrupt snapshots, repairs fingerprints, and sorts newest first", () => {
  const valid = config();
  const result = sanitizeSavedConfigs([
    { id: "older", savedAt: 10, fingerprint: "stale", config: valid },
    { id: "broken", savedAt: 30, fingerprint: "broken", config: { targetUrl: "bad" } },
    { id: "newer", savedAt: 20, fingerprint: "stale", config: config({ reservationDate: "2026-07-31" }) },
  ]);

  assert.deepEqual(result.map((item) => item.id), ["newer", "older"]);
  assert.equal(result[1].fingerprint, configFingerprint(valid));
});

test("sanitize accepts legacy payment settings and the current config shape", () => {
  const {
    paymentMethodAutoAdvance: _removedAutoAdvance,
    paymentMethodPolicy: _removedPolicy,
    ...legacy
  } = config({ clockSampleCount: 9 });
  const current = config({ reservationDate: "2026-07-31" });
  const result = sanitizeSavedConfigs([
    { id: "legacy", savedAt: 10, fingerprint: "", config: legacy },
    { id: "current", savedAt: 20, fingerprint: "", config: current },
  ]);
  assert.deepEqual(result.map((item) => item.id), ["current", "legacy"]);
  assert.equal(result.find((item) => item.id === "legacy").config.paymentMethodAutoAdvance, true);
  assert.equal(result.find((item) => item.id === "legacy").config.paymentMethodPolicy, "selected_allowed");
});
