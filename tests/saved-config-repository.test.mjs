import assert from "node:assert/strict";
import test from "node:test";
import { SavedConfigRepository } from "../dist/background/saved-config-repository.js";

const config = {
  targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
  openAtMs: 1_000,
  reservationDate: "2026-07-30",
  personCount: 2,
  timeRange: { startMinutes: 1080, endMinutes: 1200 },
  priorityTimes: [],
  postSlotEnabled: false,
  tablePreference: "any",
  menuKeyword: "",
  stopAtMs: 601_000,
  entryMode: "auto",
  dryRun: true,
  preOpenLeadMs: 3_000,
  toggleIntervalMs: 150,
};

test("repository stores, removes and clears the selected list", async () => {
  const data = {};
  const storage = {
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  };
  let id = 0;
  const repository = new SavedConfigRepository(storage, () => `id-${++id}`, () => id * 10);

  await repository.upsert("history", config);
  await repository.upsert("favorites", config);
  assert.equal(data.configHistory.length, 1);
  assert.equal(data.configFavorites.length, 1);

  await repository.remove("history", data.configHistory[0].id);
  assert.deepEqual(data.configHistory, []);
  await repository.clear("favorites");
  assert.deepEqual(data.configFavorites, []);
});

test("repository treats malformed storage values as an empty list", async () => {
  const data = { configHistory: { broken: true } };
  const storage = {
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  };
  const repository = new SavedConfigRepository(storage, () => "id", () => 10);
  await repository.upsert("history", config);
  assert.equal(data.configHistory.length, 1);
});
