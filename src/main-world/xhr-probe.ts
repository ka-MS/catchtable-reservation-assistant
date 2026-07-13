import {
  AVAILABILITY_SHADOW_EVENT_TYPE,
  AVAILABILITY_SHADOW_MAIN_SOURCE,
  classifyAvailabilityResponse,
  normalizeReservationDate,
  type AvailabilityRequestIdentity,
  type AvailabilityShadowEvent,
  type AvailabilityTargetCycleMarker,
} from "../shared/availability-shadow.js";

interface XhrLike {
  responseText: string;
  responseType: XMLHttpRequestResponseType;
  status: number;
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
}

interface XhrConstructorLike {
  prototype: {
    open: (...args: any[]) => any;
    setRequestHeader: (...args: any[]) => any;
    send: (...args: any[]) => any;
  };
}

interface ProbeHost {
  XMLHttpRequest: XhrConstructorLike;
  monotonicNow(): number;
  epochNow(): number;
  postMessage(message: AvailabilityShadowEvent): void;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface ProbeActivation {
  channelId: string;
  expiresAtEpochMs: number;
}

export interface XhrAvailabilityProbe {
  activate(activation: ProbeActivation): void;
  markTargetCycle(marker: AvailabilityTargetCycleMarker): void;
  deactivate(): void;
}

interface RequestMetadata extends AvailabilityRequestIdentity {
  method: string;
  url: string;
}

interface RequestObservation {
  identity: AvailabilityRequestIdentity;
  requestSentMonoMs: number;
  marker: AvailabilityTargetCycleMarker | null;
}

function isTimeSlotsRequest(method: string, url: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  try {
    return new URL(url, "https://app.catchtable.co.kr").pathname.endsWith("/api/reservation/v1/dining/time-slots");
  } catch {
    return false;
  }
}

export function createXhrAvailabilityProbe(host: ProbeHost): XhrAvailabilityProbe {
  const MAX_TIMER_DELAY_MS = 2_147_000_000;
  const prototype = host.XMLHttpRequest.prototype;
  const original = {
    open: prototype.open,
    setRequestHeader: prototype.setRequestHeader,
    send: prototype.send,
  };
  const metadata = new WeakMap<object, RequestMetadata>();
  let activation: ProbeActivation | null = null;
  let expiryTimer: unknown = null;
  let sequence = 0;
  let installed = false;
  let targetMarkers: AvailabilityTargetCycleMarker[] = [];
  const pending = new Set<RequestObservation>();

  const matchingMarker = (
    identity: AvailabilityRequestIdentity,
    requestSentMonoMs: number,
  ): AvailabilityTargetCycleMarker | null => {
    const requestDate = normalizeReservationDate(identity.requestDate);
    if (requestDate === null || identity.personCount === null) return null;
    return targetMarkers
      .filter((marker) => marker.targetDate === requestDate
        && marker.personCount === identity.personCount
        && requestSentMonoMs >= marker.targetClickMonoMs - 5
        && requestSentMonoMs <= marker.targetClickMonoMs + 700)
      .at(-1) ?? null;
  };

  const deactivate = (): void => {
    activation = null;
    targetMarkers = [];
    pending.clear();
    if (expiryTimer !== null) host.clearTimer(expiryTimer);
    expiryTimer = null;
    if (!installed) return;
    if (prototype.open === wrappedOpen) prototype.open = original.open;
    if (prototype.setRequestHeader === wrappedSetRequestHeader) prototype.setRequestHeader = original.setRequestHeader;
    if (prototype.send === wrappedSend) prototype.send = original.send;
    installed = false;
  };

  function wrappedOpen(this: XhrLike, ...args: unknown[]): unknown {
    const result = Reflect.apply(original.open, this, args);
    const method = typeof args[0] === "string" ? args[0] : "";
    const url = typeof args[1] === "string" ? args[1] : "";
    metadata.set(this, { method, url, requestDate: null, personCount: null });
    return result;
  }

  function wrappedSetRequestHeader(this: XhrLike, ...args: unknown[]): unknown {
    const result = Reflect.apply(original.setRequestHeader, this, args);
    const current = metadata.get(this);
    if (!current || typeof args[0] !== "string") return result;
    const name = args[0].toLowerCase();
    if (typeof args[1] !== "string") return result;
    const value = args[1];
    if (name === "yymmdd") current.requestDate = value.slice(0, 16);
    if (name === "personcount" && /^\d+$/.test(value)) current.personCount = Number(value);
    return result;
  }

  function wrappedSend(this: XhrLike, ...args: unknown[]): unknown {
    try {
      const currentActivation = activation;
      const request = metadata.get(this);
      if (currentActivation && host.epochNow() <= currentActivation.expiresAtEpochMs
        && request && isTimeSlotsRequest(request.method, request.url)) {
        const requestSequence = ++sequence;
        const requestSentMonoMs = host.monotonicNow();
        const channelId = currentActivation.channelId;
        const identity = { requestDate: request.requestDate, personCount: request.personCount };
        const observation: RequestObservation = {
          identity,
          requestSentMonoMs,
          marker: matchingMarker(identity, requestSentMonoMs),
        };
        pending.add(observation);
        const onLoadEnd = () => {
          try {
            const responseCompletedMonoMs = host.monotonicNow();
            const successful = this.status >= 200 && this.status < 300;
            const text = (this.responseType === "" || this.responseType === "text") && successful
              ? this.responseText
              : "";
            const bodyReadCompletedMonoMs = host.monotonicNow();
            const result = successful
              ? classifyAvailabilityResponse(text, identity)
              : { classification: "IRRELEVANT" as const, availableMinutes: [] };
            const payloadClassifiedMonoMs = host.monotonicNow();
            host.postMessage({
              source: AVAILABILITY_SHADOW_MAIN_SOURCE,
              type: AVAILABILITY_SHADOW_EVENT_TYPE,
              schemaVersion: 2,
              channelId,
              sequence: requestSequence,
              cycle: observation.marker?.cycle ?? null,
              targetClickMonoMs: observation.marker?.targetClickMonoMs ?? null,
              requestDate: identity.requestDate,
              personCount: identity.personCount,
              classification: result.classification,
              availableMinutes: result.availableMinutes,
              responseStatus: this.status,
              requestSentMonoMs,
              responseCompletedMonoMs,
              bodyReadCompletedMonoMs,
              payloadClassifiedMonoMs,
            });
          } catch {
            // Shadow 관측 실패는 사이트 XHR 완료 경로로 전파하지 않는다.
          } finally {
            pending.delete(observation);
          }
        };
        try {
          this.addEventListener("loadend", onLoadEnd, { once: true });
        } catch (error) {
          pending.delete(observation);
          throw error;
        }
      }
    } catch {
      // Observer 설치 실패 시에도 아래 원본 send는 반드시 호출한다.
    }
    return Reflect.apply(original.send, this, args);
  }

  const install = (): void => {
    if (installed) return;
    prototype.open = wrappedOpen;
    prototype.setRequestHeader = wrappedSetRequestHeader;
    prototype.send = wrappedSend;
    installed = true;
  };

  return {
    activate(next): void {
      if (expiryTimer !== null) host.clearTimer(expiryTimer);
      activation = next;
      sequence = 0;
      targetMarkers = [];
      pending.clear();
      install();
      const expire = (): void => {
        const remaining = next.expiresAtEpochMs - host.epochNow();
        if (remaining <= 0) {
          deactivate();
          return;
        }
        expiryTimer = host.setTimer(expire, Math.min(remaining, MAX_TIMER_DELAY_MS));
      };
      expire();
    },
    markTargetCycle(marker): void {
      if (!activation) return;
      targetMarkers.push({ ...marker });
      if (targetMarkers.length > 16) targetMarkers.splice(0, targetMarkers.length - 16);
      for (const observation of pending) {
        if (observation.marker === null) {
          observation.marker = matchingMarker(observation.identity, observation.requestSentMonoMs);
        }
      }
    },
    deactivate,
  };
}
