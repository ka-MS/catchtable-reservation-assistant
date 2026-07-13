import {
  AVAILABILITY_SHADOW_ACTIVATE_TYPE,
  AVAILABILITY_SHADOW_DEACTIVATE_TYPE,
  AVAILABILITY_SHADOW_ISOLATED_SOURCE,
  AVAILABILITY_SHADOW_TARGET_CYCLE_TYPE,
  isAvailabilityTargetCycleMarker,
} from "../shared/availability-shadow.js";
import type { XhrAvailabilityProbe } from "./xhr-probe.js";

interface ProbeMessageEvent {
  source: unknown;
  data: unknown;
}

interface ProbeMessageHost {
  windowObject: unknown;
  addMessageListener(listener: (event: ProbeMessageEvent) => void): void;
  removeMessageListener(listener: (event: ProbeMessageEvent) => void): void;
}

export function installProbeMessageBridge(host: ProbeMessageHost, probe: XhrAvailabilityProbe): () => void {
  let activeChannel: string | null = null;
  const listener = (event: ProbeMessageEvent): void => {
    if (event.source !== host.windowObject || typeof event.data !== "object" || event.data === null) return;
    const data = event.data as Record<string, unknown>;
    if (data.source !== AVAILABILITY_SHADOW_ISOLATED_SOURCE || data.schemaVersion !== 1) return;
    if (data.type === AVAILABILITY_SHADOW_ACTIVATE_TYPE
      && typeof data.channelId === "string"
      && data.channelId.length > 0
      && data.channelId.length <= 128
      && typeof data.expiresAtEpochMs === "number"
      && Number.isFinite(data.expiresAtEpochMs)) {
      activeChannel = data.channelId;
      probe.activate({ channelId: data.channelId, expiresAtEpochMs: data.expiresAtEpochMs });
      return;
    }
    if (data.type === AVAILABILITY_SHADOW_TARGET_CYCLE_TYPE
      && data.channelId === activeChannel
      && isAvailabilityTargetCycleMarker(data)) {
      probe.markTargetCycle(data);
      return;
    }
    if (data.type === AVAILABILITY_SHADOW_DEACTIVATE_TYPE && data.channelId === activeChannel) {
      activeChannel = null;
      probe.deactivate();
    }
  };
  host.addMessageListener(listener);
  return () => host.removeMessageListener(listener);
}
