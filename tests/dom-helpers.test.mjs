import assert from "node:assert/strict";
import test from "node:test";
import { loadFixture } from "./fixture-helper.mjs";
import { fnvHash, isDisabled, safeText, visibleAll } from "../dist/content/adapter/dom.js";

test("fnvHash locks the current algorithm", () => {
  assert.equal(fnvHash("catchtable-reserve"), "4ad76c61");
  assert.equal(fnvHash(JSON.stringify({})), "5465b825");
  assert.equal(fnvHash("50,000원".replace(/\d+/g, "#")), "bb9a1cf1");
  assert.match(fnvHash("x"), /^[0-9a-f]{8}$/);
});

test("visibleAll returns only rendered elements", async () => {
  const dom = await loadFixture("dom-helpers.html");
  const root = dom.window.document.getElementById("root");
  const ids = visibleAll(root, "button").map((button) => button.id);
  assert.deepEqual(ids, ["b1", "b2", "b3"]);
});

test("isDisabled covers form disabled and aria-disabled on any element", async () => {
  const dom = await loadFixture("dom-helpers.html");
  const document = dom.window.document;
  assert.equal(isDisabled(document.getElementById("b1")), false);
  assert.equal(isDisabled(document.getElementById("b2")), true);
  assert.equal(isDisabled(document.getElementById("b3")), true);
  assert.equal(isDisabled(document.getElementById("d1")), true);
  assert.equal(isDisabled(document.getElementById("d2")), false);
});

test("safeText normalizes whitespace and caps length", () => {
  assert.equal(safeText("  가  나  "), "가 나");
  assert.equal(safeText("a".repeat(100)).length, 80);
  assert.equal(safeText("a".repeat(100), 10).length, 10);
  assert.equal(safeText(null), "");
});
