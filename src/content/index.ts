declare global {
  interface Window {
    __ctReserveInjected?: boolean;
  }
}

if (!window.__ctReserveInjected) {
  window.__ctReserveInjected = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") sendResponse({ ok: true });
  });
}

export {};
