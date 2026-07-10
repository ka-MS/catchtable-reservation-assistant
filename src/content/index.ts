import { ReservationEngine } from "./engine.js";
import type { Command } from "../shared/types.js";

const engine = new ReservationEngine();

chrome.runtime.onMessage.addListener((message: Command, _sender, sendResponse) => {
  if (message.type === "START") {
    engine.start(message.config);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "STOP") {
    engine.stop();
    sendResponse({ ok: true });
  }
});

chrome.runtime.sendMessage({ type: "CONTENT_READY" }).catch(() => undefined);
