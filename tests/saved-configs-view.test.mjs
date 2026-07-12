import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { SavedConfigsView } from "../dist/sidepanel/saved-configs-view.js";

function saved(id, date) {
  return {
    id,
    savedAt: 10,
    fingerprint: id,
    config: {
      targetUrl: "https://app.catchtable.co.kr/ct/shop/sushi_sujung",
      openAtMs: 1_000,
      reservationDate: date,
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
      clockSampleCount: 9,
    },
  };
}

test("saved config view switches tabs and dispatches load, save and delete actions", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  const dom = new JSDOM(html);
  const actions = [];
  const view = new SavedConfigsView(dom.window.document, {
    load: (config) => actions.push(["load", config.reservationDate]),
    saveFavorite: () => actions.push(["save"]),
    remove: (list, id) => actions.push(["remove", list, id]),
    clear: (list) => actions.push(["clear", list]),
  }, () => 2_000);
  view.render([saved("history-1", "2026-07-30")], [saved("favorite-1", "2026-08-01")]);

  dom.window.document.querySelector('[data-saved-action="load"]').click();
  dom.window.document.querySelector('[data-saved-list="favorites"]').click();
  dom.window.document.querySelector('[data-saved-action="save-favorite"]').click();
  dom.window.document.querySelector('[data-saved-action="remove"]').click();
  dom.window.document.querySelector('[data-saved-action="clear"]').click();

  assert.deepEqual(actions, [
    ["load", "2026-07-30"],
    ["save"],
    ["remove", "favorites", "favorite-1"],
    ["clear", "favorites"],
  ]);
  assert.match(dom.window.document.querySelector("#saved-config-list").textContent, /8월 1일/);
  assert.match(dom.window.document.querySelector("#saved-config-list").textContent, /지난 오픈/);
  // 즐겨찾기 탭이 활성이므로 "저장일" 라벨이 보인다.
  assert.match(dom.window.document.querySelector("#saved-config-list").textContent, /저장일/);
});

test("history items label the saved timestamp as recent use", async () => {
  const html = await readFile("dist/sidepanel/sidepanel.html", "utf8");
  const dom = new JSDOM(html);
  const view = new SavedConfigsView(dom.window.document, {
    load: () => undefined, saveFavorite: () => undefined, remove: () => undefined, clear: () => undefined,
  }, () => 2_000);
  view.render([saved("history-1", "2026-07-30")], []);
  assert.match(dom.window.document.querySelector("#saved-config-list").textContent, /최근 사용/);
});
