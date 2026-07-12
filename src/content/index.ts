import { abortableSleep } from "../shared/scheduler.js";
import type { ContentCommand, RunEventMessage } from "../shared/types.js";
import { CalendarAdapter } from "./adapter/calendar.js";
import { EntryAdapter } from "./adapter/entry.js";
import { PersonAdapter } from "./adapter/person.js";
import { SlotAdapter } from "./adapter/slots.js";
import { PostSlotAdapter } from "./adapter/post-slot.js";
import { syncServerClock } from "./clock-sync.js";
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
  const orchestrator = new OpenRunOrchestrator({
    clock,
    monotonicClock,
    syncClock: (config, signal) => syncServerClock(config.targetUrl, config.clockSampleCount, {
      clock,
      monotonicClock,
      signal,
      sleep: abortableSleep,
    }),
    entry: new EntryAdapter(document),
    calendar: new CalendarAdapter(document),
    person: new PersonAdapter(document),
    slots: new SlotAdapter(document),
    postSlot: new PostSlotAdapter(document),
    sleep: abortableSleep,
    emit: (event) => {
      traceLogger.recordRunEvent(event);
      const message: RunEventMessage = { type: "RUN_EVENT", event };
      // Service Worker 재시작 중 로그 전송이 실패해도 시간 임계 실행은 계속한다.
      void chrome.runtime.sendMessage(message).catch(() => undefined);
    },
    trace: (code, severity, message, options) => traceLogger.record(code, severity, message, options),
    flushTrace: () => traceLogger.forceFlush(),
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
      traceLogger.start(message.runId, message.config, message.scheduledJobId);
      void orchestrator.start(message.config, message.runId).finally(() => {
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
