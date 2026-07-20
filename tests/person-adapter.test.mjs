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

test("readSelectedCount는 현재 체크된 라디오 값을 반환한다", async () => {
  const dom = await loadFixture("person.html");
  const adapter = new PersonAdapter(dom.window.document);

  assert.equal(adapter.readSelectedCount(), 2);
  adapter.select(3);
  assert.equal(adapter.readSelectedCount(), 3);
});

test("readSelectedCount는 체크된 라디오가 없으면 null을 반환한다", async () => {
  const dom = await loadFixture("person.html");
  const document = dom.window.document;
  document.querySelectorAll('input[type="radio"][name="personCount"]').forEach((input) => { input.checked = false; });
  const adapter = new PersonAdapter(document);

  assert.equal(adapter.readSelectedCount(), null);
});
