import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { capturePreparationPageContext } from "../dist/content/preparation-observation.js";

test("preparation context captures focus, viewport and structural identity without body text", () => {
  const dom = new JSDOM(`<main><h1>민감한 매장명</h1><button id="reserve" role="button">예약하기</button></main>`, {
    url: "https://app.catchtable.co.kr/ct/shop/kea?token=secret",
    pretendToBeVisual: true,
  });
  const document = dom.window.document;
  document.querySelector("button").focus();
  document.hasFocus = () => true;

  const context = capturePreparationPageContext(document);

  assert.equal(context.visibilityState, "visible");
  assert.equal(context.hasFocus, true);
  assert.equal(context.activeElementTag, "button");
  assert.equal(context.activeElementRole, "button");
  assert.equal(context.activeElementId, "reserve");
  assert.equal(context.urlKind, "shop");
  assert.match(context.fingerprint, /^ss-/);
  assert.equal(JSON.stringify(context).includes("민감한 매장명"), false);
  assert.equal(JSON.stringify(context).includes("secret"), false);
});
