import { createXhrAvailabilityProbe, type XhrAvailabilityProbe } from "./xhr-probe.js";
import { installProbeMessageBridge } from "./probe-message-bridge.js";

interface ProbeRegistry {
  probe: XhrAvailabilityProbe;
  disposeListener(): void;
  implementationVersion?: number;
}

const PROBE_IMPLEMENTATION_VERSION = 3;

function isProbeRegistry(value: XhrAvailabilityProbe | ProbeRegistry | undefined): value is ProbeRegistry {
  return value !== undefined && "probe" in value;
}

declare global {
  interface Window {
    __ctAvailabilityProbeV1?: XhrAvailabilityProbe | ProbeRegistry;
  }
}

const existing = window.__ctAvailabilityProbeV1;
const previousRegistry = isProbeRegistry(existing) ? existing : null;
previousRegistry?.disposeListener();
const previousProbe = existing && !isProbeRegistry(existing) ? existing : null;
const reusableProbe = previousRegistry?.implementationVersion === PROBE_IMPLEMENTATION_VERSION
  ? previousRegistry.probe
  : null;
if (!reusableProbe) (previousRegistry?.probe ?? previousProbe)?.deactivate();
const probe = reusableProbe ?? createXhrAvailabilityProbe({
    XMLHttpRequest,
    monotonicNow: () => performance.now(),
    epochNow: () => Date.now(),
    postMessage: (message) => window.postMessage(message, "*"),
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (timer) => window.clearTimeout(timer as number),
});
const disposeListener = installProbeMessageBridge({
  windowObject: window,
  addMessageListener: (listener) => window.addEventListener("message", listener as unknown as EventListener),
  removeMessageListener: (listener) => window.removeEventListener("message", listener as unknown as EventListener),
}, probe);
window.__ctAvailabilityProbeV1 = { probe, disposeListener, implementationVersion: PROBE_IMPLEMENTATION_VERSION };

export {};
