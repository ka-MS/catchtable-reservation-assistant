import assert from "node:assert/strict";
import test from "node:test";
import { WaitingAdapter } from "../dist/content/adapter/waiting.js";
import { loadFixture } from "./fixture-helper.mjs";

test("waiting adapter reads the disabled online waiting cta before open", async () => {
  const dom = await loadFixture("waiting-dock-closed.html");
  const facts = new WaitingAdapter(dom.window.document).inspect();
  assert.equal(facts.present, true);
  assert.equal(facts.registerable, false);
  assert.equal(facts.onsiteOnly, false);
  assert.equal(facts.label, "온라인 웨이팅오전 9시 30분에 오픈");
});

test("waiting adapter does not click while the cta is disabled", async () => {
  const dom = await loadFixture("waiting-dock-closed.html");
  const document = dom.window.document;
  let clicks = 0;
  document.querySelector("aside#dock button[disabled]").addEventListener("click", () => clicks++);
  assert.equal(new WaitingAdapter(document).clickRegister(), false);
  assert.equal(clicks, 0);
});

test("waiting adapter clicks the cta once disabled is released", async () => {
  const dom = await loadFixture("waiting-dock-open.html");
  const document = dom.window.document;
  const adapter = new WaitingAdapter(document);
  let clicks = 0;
  document.querySelectorAll("aside#dock button")[1].addEventListener("click", () => clicks++);
  assert.equal(adapter.inspect().registerable, true);
  assert.equal(adapter.clickRegister(), true);
  assert.equal(clicks, 1);
});

// 오픈 순간 disabled만 풀리고 문구가 그대로여도 클릭 가능으로 판정해야 한다.
test("waiting adapter registerability tracks the disabled attribute, not the label", async () => {
  const dom = await loadFixture("waiting-dock-closed.html");
  const document = dom.window.document;
  const adapter = new WaitingAdapter(document);
  assert.equal(adapter.inspect().registerable, false);
  document.querySelector("aside#dock button[disabled]").removeAttribute("disabled");
  assert.equal(adapter.inspect().registerable, true);
  assert.equal(adapter.inspect().label, "온라인 웨이팅오전 9시 30분에 오픈");
});

test("waiting adapter reports onsite-only shops instead of a registerable cta", async () => {
  const dom = await loadFixture("entry-waiting.html");
  const facts = new WaitingAdapter(dom.window.document).inspect();
  assert.equal(facts.present, true);
  assert.equal(facts.onsiteOnly, true);
  assert.equal(facts.registerable, false);
});

test("waiting adapter reports absence when the dock has no waiting cta", async () => {
  const dom = await loadFixture("entry.html");
  const facts = new WaitingAdapter(dom.window.document).inspect();
  assert.deepEqual(facts,
    { present: false, label: "", registerable: false, onsiteOnly: false, refreshAvailable: false });
});

test("waiting adapter clicks the innermost refresh control, not its container", async () => {
  const dom = await loadFixture("waiting-refresh.html");
  const document = dom.window.document;
  const adapter = new WaitingAdapter(document);
  const clicked = [];
  for (const element of document.querySelectorAll("[data-probe]")) {
    element.addEventListener("click", (event) => {
      if (event.target === element) clicked.push(element.dataset.probe);
    });
  }
  assert.equal(adapter.inspect().refreshAvailable, true);
  assert.equal(adapter.clickRefresh(), true);
  assert.deepEqual(clicked, ["refresh"]);
});

test("waiting adapter reports no refresh control when the section lacks one", async () => {
  const dom = await loadFixture("waiting-dock-closed.html");
  const adapter = new WaitingAdapter(dom.window.document);
  assert.equal(adapter.inspect().refreshAvailable, false);
  assert.equal(adapter.clickRefresh(), false);
});
