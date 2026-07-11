import assert from "node:assert/strict";
import test from "node:test";
import { PersonAdapter } from "../dist/content/adapter/person.js";
import { loadFixture } from "./fixture-helper.mjs";

test("person adapter selects the exact visible person value", async () => {
  const dom = await loadFixture("person.html");
  const adapter = new PersonAdapter(dom.window.document);

  assert.deepEqual(adapter.inspect(3), { ready: true, targetAvailable: true, targetSelected: false });
  assert.equal(adapter.select(3), true);
  assert.deepEqual(adapter.inspect(3), { ready: true, targetAvailable: true, targetSelected: true });
});

test("person adapter never substitutes another person value", async () => {
  const dom = await loadFixture("person.html");
  const adapter = new PersonAdapter(dom.window.document);

  assert.deepEqual(adapter.inspect(4), { ready: true, targetAvailable: false, targetSelected: false });
  assert.equal(adapter.select(4), false);
  assert.equal(dom.window.document.querySelector('input[value="2"]').checked, true);
});
