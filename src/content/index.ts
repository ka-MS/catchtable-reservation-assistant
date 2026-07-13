import { abortableSleep } from "../shared/scheduler.js";
import type { ContentCommand, RunEventMessage } from "../shared/types.js";
import { CalendarAdapter } from "./adapter/calendar.js";
import { EntryAdapter } from "./adapter/entry.js";
import { PersonAdapter } from "./adapter/person.js";
import { SlotAdapter } from "./adapter/slots.js";
import { PostSlotAdapter } from "./adapter/post-slot.js";
import { createSlotRefreshWatch } from "./adapter/slot-refresh-watch.js";
import { captureStageSnapshot } from "./adapter/snapshot.js";
import { createAvailabilityShadowBridge } from "./availability-shadow-bridge.js";
import { createReferenceClockSampler } from "./reference-clock-sampler.js";
import { dispatchRunEvent } from "./dispatch.js";
import { OpenRunOrchestrator } from "./orchestrator.js";
import { BatchTraceProcessor } from "./telemetry/batch-processor.js";
import { PortTraceTransport } from "./telemetry/port-transport.js";
import { TraceLogger } from "./telemetry/trace-logger.js";

declare global {
  interface Window {
    __ctReserveInjected?: boolean;
  }
}

if (!window.__ctReserveInjected) {
  window.__ctReserveInjected = true;
  const clock = { now: () => Date.now() };
  const monotonicClock = { now: () => performance.now() };
  const traceLogger = new TraceLogger(
    new BatchTraceProcessor(new PortTraceTransport(), () => crypto.randomUUID()),
    () => Date.now(),
  );
  const availabilityShadow = createAvailabilityShadowBridge(window);
  const orchestrator = new OpenRunOrchestrator({
    clock,
    monotonicClock,
    referenceClock: (config) => createReferenceClockSampler(config.targetUrl, { monotonicClock, sleep: abortableSleep }),
    entry: new EntryAdapter(document),
    calendar: new CalendarAdapter(document),
    person: new PersonAdapter(document),
    slots: new SlotAdapter(document),
    postSlot: new PostSlotAdapter(document),
    slotWatch: createSlotRefreshWatch(),
    availabilityShadow,
    sleep: abortableSleep,
    emit: (event) => {
      traceLogger.recordRunEvent(event);
      const message: RunEventMessage = { type: "RUN_EVENT", event };
      // Service Worker 재시작·확장 컨텍스트 무효화 중 전송이 실패해도(동기 throw
      // 포함) 시간 임계 실행은 계속한다.
      dispatchRunEvent((m) => chrome.runtime.sendMessage(m), message);
    },
    trace: (code, severity, message, options) => traceLogger.record(code, severity, message, options),
    flushTrace: () => traceLogger.forceFlush(),
    captureSnapshot: () => {
      try {
        return captureStageSnapshot(document);
      } catch {
        return null;
      }
    },
    runId: () => crypto.randomUUID(),
  });
  let running = false;

  chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
    const message = rawMessage as ContentCommand;
    if (message.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "START") {
      if (running) {
        sendResponse({ ok: false, error: "이미 실행 중입니다." });
        return;
      }
      running = true;
      availabilityShadow.configure(message.shadowChannelId ?? null);
      traceLogger.start(message.runId, message.config, message.scheduledJobId);
      void orchestrator.start(message.config, message.runId).finally(() => {
        availabilityShadow.configure(null);
        running = false;
      });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "STOP") {
      orchestrator.stop();
      sendResponse({ ok: true });
    }
  });
}

export {};
