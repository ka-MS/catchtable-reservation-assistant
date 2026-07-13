import {
  AVAILABILITY_SHADOW_ACTIVATE_TYPE,
  AVAILABILITY_SHADOW_DEACTIVATE_TYPE,
  AVAILABILITY_SHADOW_ISOLATED_SOURCE,
  AVAILABILITY_SHADOW_TARGET_CYCLE_TYPE,
  isAvailabilityShadowEvent,
  type AvailabilityTargetCycleMarker,
  type ReceivedAvailabilityShadowEvent,
} from "../shared/availability-shadow.js";

interface MessageEventLike {
  source: unknown;
  data: unknown;
}

interface BridgeHost {
  windowObject: unknown;
  addMessageListener(listener: (event: MessageEventLike) => void): void;
  removeMessageListener(listener: (event: MessageEventLike) => void): void;
  postMessage(message: unknown): void;
  monotonicNow(): number;
}

export type AvailabilityShadowListener = (event: ReceivedAvailabilityShadowEvent) => void;

export class AvailabilityShadowBridge {
  private channelId: string | null = null;
  private listener: AvailabilityShadowListener | null = null;
  private listening = false;
  private readonly onMessage = (event: MessageEventLike): void => {
    const channelId = this.channelId;
    if (!this.listener || !channelId || event.source !== this.host.windowObject) return;
    if (!isAvailabilityShadowEvent(event.data, channelId)) return;
    this.listener({ ...event.data, bridgeReceivedMonoMs: this.host.monotonicNow() });
  };

  constructor(private readonly host: BridgeHost) {}

  configure(channelId: string | null): void {
    this.channelId = channelId;
  }

  start(expiresAtEpochMs: number, listener: AvailabilityShadowListener): void {
    if (!this.channelId) return;
    this.listener = listener;
    if (!this.listening) {
      this.host.addMessageListener(this.onMessage);
      this.listening = true;
    }
    this.host.postMessage({
      source: AVAILABILITY_SHADOW_ISOLATED_SOURCE,
      type: AVAILABILITY_SHADOW_ACTIVATE_TYPE,
      schemaVersion: 1,
      channelId: this.channelId,
      expiresAtEpochMs,
    });
  }

  markTargetCycle(marker: AvailabilityTargetCycleMarker): void {
    if (!this.channelId) return;
    this.host.postMessage({
      source: AVAILABILITY_SHADOW_ISOLATED_SOURCE,
      type: AVAILABILITY_SHADOW_TARGET_CYCLE_TYPE,
      schemaVersion: 1,
      channelId: this.channelId,
      ...marker,
    });
  }

  stop(): void {
    if (this.channelId) {
      this.host.postMessage({
        source: AVAILABILITY_SHADOW_ISOLATED_SOURCE,
        type: AVAILABILITY_SHADOW_DEACTIVATE_TYPE,
        schemaVersion: 1,
        channelId: this.channelId,
      });
    }
    if (this.listening) this.host.removeMessageListener(this.onMessage);
    this.listener = null;
    this.listening = false;
  }
}

export function createAvailabilityShadowBridge(windowObject: Window): AvailabilityShadowBridge {
  return new AvailabilityShadowBridge({
    windowObject,
    addMessageListener: (listener) => windowObject.addEventListener("message", listener as unknown as EventListener),
    removeMessageListener: (listener) => windowObject.removeEventListener("message", listener as unknown as EventListener),
    postMessage: (message) => windowObject.postMessage(message, "*"),
    monotonicNow: () => performance.now(),
  });
}
