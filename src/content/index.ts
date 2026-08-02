import { abortableSleep } from "../shared/scheduler.js";
import type {
  AttemptControlMessage, AttemptOutcome, AttemptStatusResponse, TerminalRunState,
} from "../shared/run-control/protocol.js";
import type { ContentCommand, RunEventMessage, ShopSnapshot } from "../shared/types.js";
import { CalendarAdapter } from "./adapter/calendar.js";
import { EntryAdapter } from "./adapter/entry.js";
import { PersonAdapter } from "./adapter/person.js";
import { SlotAdapter } from "./adapter/slots.js";
import { PostSlotAdapter } from "./adapter/post-slot.js";
import { createSlotRefreshWatch } from "./adapter/slot-refresh-watch.js";
import { createSlotDomMutationWatch } from "./adapter/slot-dom-mutation-watch.js";
import { captureStageSnapshot } from "./adapter/snapshot.js";
import { captureDiagnosticSnapshot } from "./diagnostics/dom-snapshot.js";
import { DiagnosticRecorder } from "./diagnostics/recorder.js";
import { RuntimeDiagnosticTransport } from "./diagnostics/runtime-transport.js";
import { createAvailabilityShadowBridge } from "./availability-shadow-bridge.js";
import { createReferenceClockSampler } from "./reference-clock-sampler.js";
import { dispatchRunEvent } from "./dispatch.js";
import { OpenRunOrchestrator } from "./orchestrator.js";
import { BatchTraceProcessor } from "./telemetry/batch-processor.js";
import { PortTraceTransport } from "./telemetry/port-transport.js";
import { TraceLogger } from "./telemetry/trace-logger.js";
import { capturePreparationPageContext } from "./preparation-observation.js";
import { WaitingAdapter } from "./adapter/waiting.js";
import { createWaitingCtaWake, WaitingRunOrchestrator } from "./waiting-orchestrator.js";
import { ReservationFormAdapter } from "./adapter/reservation-form.js";
import { CompletionCoordinator } from "./completion-coordinator.js";
import type { CompletionDispatchAck } from "../shared/run-control/protocol.js";

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
  const diagnosticRecorder = new DiagnosticRecorder(
    (input) => captureDiagnosticSnapshot(document, input),
    new RuntimeDiagnosticTransport(),
  );
  const availabilityShadow = createAvailabilityShadowBridge(window);

  interface AttemptControlState {
    logicalRunId: string;
    attemptId: string;
    phase: "PREPARING" | "EXECUTING" | "FINISHING";
    pendingOutcome?: AttemptOutcome;
  }
  let attempt: AttemptControlState | null = null;

  const sendControl = (message: AttemptControlMessage): Promise<unknown> =>
    chrome.runtime.sendMessage(message);

  const completion = new CompletionCoordinator({
    adapter: new ReservationFormAdapter(document),
    now: () => Date.now(),
    sleep: abortableSleep,
    claim: async (phase, fingerprint) => {
      const current = attempt;
      if (!current) return false;
      try {
        const ack = await sendControl({
          type: "COMPLETION_DISPATCH_CLAIM",
          logicalRunId: current.logicalRunId,
          attemptId: current.attemptId,
          phase,
          fingerprint,
        }) as CompletionDispatchAck;
        return ack.ok && ack.dispatchGranted;
      } catch {
        return false;
      }
    },
    telemetry: (phase, attributes) => {
      traceLogger.record("ACTION_PERFORMED", "info", "예약 완주 단계를 관측했습니다.", {
        state: "COMPLETING_RESERVATION",
        attributes: { completionPhase: phase, ...attributes },
      });
    },
  });

  // flush 완료 뒤에만 전송하고, ACK 없으면 제한 재시도, {ok:false}는 중단(§5.4).
  // 끝내 ACK가 없으면 reset 없이 현재 terminal을 유지한다 — GET_ATTEMPT_STATUS가 겸수신.
  async function deliverOutcome(state: AttemptControlState, outcome: AttemptOutcome, flushOk: boolean): Promise<void> {
    state.pendingOutcome = outcome;
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        const ack = await sendControl({
          type: "ATTEMPT_FINISHED",
          logicalRunId: state.logicalRunId,
          attemptId: state.attemptId,
          outcome,
          flush: { ok: flushOk },
        }) as { ok?: boolean } | undefined;
        if (ack && typeof ack.ok === "boolean") return;
      } catch {
        // SW 재기동 등 전송 실패 — 제한 재시도.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

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
    slotDomMutationWatch: createSlotDomMutationWatch(document),
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
    diagnostics: diagnosticRecorder,
    captureSnapshot: () => {
      try {
        return captureStageSnapshot(document);
      } catch {
        return null;
      }
    },
    capturePreparationContext: () => capturePreparationPageContext(document),
    readShopDisplayName: () => {
      const headings = Array.from(document.querySelectorAll("h1"))
        .map((heading) => heading.textContent?.trim() ?? "")
        .filter(Boolean);
      return headings.length === 1 ? headings[0] : null;
    },
    completion,
    attemptPhase: (phase) => {
      if (!attempt) return;
      attempt.phase = phase;
      void sendControl({
        type: "ATTEMPT_PHASE_CHANGED",
        logicalRunId: attempt.logicalRunId,
        attemptId: attempt.attemptId,
        phase,
      }).catch(() => undefined);
    },
    runId: () => crypto.randomUUID(),
  });
  const waiting = new WaitingRunOrchestrator({
    clock,
    monotonicClock,
    referenceClock: (config) => createReferenceClockSampler(config.targetUrl, { monotonicClock, sleep: abortableSleep }),
    cta: new WaitingAdapter(document),
    wake: createWaitingCtaWake(document),
    sleep: abortableSleep,
    emit: (event) => {
      const message: RunEventMessage = { type: "RUN_EVENT", event };
      dispatchRunEvent((m) => chrome.runtime.sendMessage(m), message);
    },
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
    if (message.type === "READ_SHOP_SNAPSHOT") {
      // 날짜·인원은 별도 필드로 반영되므로 URL에는 남기지 않는다(예약 날짜 쿼리 등으로 중복 표시 방지).
      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      const snapshot: ShopSnapshot = {
        url: url.toString(),
        selectedDate: new CalendarAdapter(document).readSelectedDate(),
        selectedPersonCount: new PersonAdapter(document).readSelectedCount(),
      };
      sendResponse({ ok: true, data: snapshot });
      return;
    }
    if (message.type === "START") {
      if (running) {
        // 동일 attemptId 재수신은 멱등 재응답한다(§5.4 nextAttempt 전이 원자성).
        sendResponse(attempt?.attemptId === message.runId
          ? { ok: true }
          : { ok: false, error: "이미 실행 중입니다." });
        return;
      }
      running = true;
      const control: AttemptControlState | null = message.logicalRunId === undefined
        ? null
        : { logicalRunId: message.logicalRunId, attemptId: message.runId, phase: "PREPARING" };
      attempt = control;
      availabilityShadow.configure(message.shadowChannelId ?? null);
      diagnosticRecorder.start(message.runId);
      traceLogger.start(message.runId, message.config, message.scheduledJobId,
        message.logicalRunId === undefined ? undefined : {
          logicalRunId: message.logicalRunId,
          attemptIndex: message.attemptIndex ?? 0,
          ...(message.resetCause === undefined ? {} : { resetCause: message.resetCause }),
        });
      if (control) {
        void sendControl({
          type: "ATTEMPT_PHASE_CHANGED",
          logicalRunId: control.logicalRunId,
          attemptId: control.attemptId,
          phase: "PREPARING",
        }).catch(() => undefined);
      }
      void orchestrator.start(message.config, message.runId, message.executionContext, message.authorization)
        .then(async (result) => {
          if (!control) return;
          control.phase = "FINISHING";
          const outcome: AttemptOutcome = result.preparation !== undefined && result.state === "HANDED_OFF"
            ? {
              kind: "preparation_failed",
              state: "HANDED_OFF",
              cause: result.preparation.cause,
              attempts: result.preparation.attempts,
              message: result.message,
              finishedAt: Date.now(),
            }
            : {
              kind: "terminal",
              state: result.state as TerminalRunState,
              message: result.message,
              finishedAt: Date.now(),
            };
          let flushOk = false;
          try {
            flushOk = await traceLogger.forceFlush();
          } catch {
            flushOk = false;
          }
          if (!flushOk) {
            // durable 실패 시 1회 재flush(§5.4) — 복구 진행은 결과와 무관하다.
            try {
              flushOk = await traceLogger.forceFlush();
            } catch {
              flushOk = false;
            }
          }
          await deliverOutcome(control, outcome, flushOk);
        })
        .finally(() => {
          availabilityShadow.configure(null);
          diagnosticRecorder.reset();
          running = false;
        });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "START_WAITING") {
      if (running) {
        sendResponse({ ok: false, error: "이미 실행 중입니다." });
        return;
      }
      running = true;
      void waiting.start(message.config, message.runId).finally(() => {
        running = false;
      });
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "GET_ATTEMPT_STATUS") {
      if (!attempt || attempt.attemptId !== message.attemptId) {
        sendResponse({ attemptId: message.attemptId, running: false, phase: null } satisfies AttemptStatusResponse);
        return;
      }
      sendResponse({
        attemptId: attempt.attemptId,
        running: running && attempt.phase !== "FINISHING",
        phase: attempt.phase,
        ...(attempt.pendingOutcome === undefined ? {} : { pendingOutcome: attempt.pendingOutcome }),
      } satisfies AttemptStatusResponse);
      return;
    }
    if (message.type === "STOP") {
      orchestrator.stop();
      waiting.stop();
      sendResponse({ ok: true });
    }
  });
}

export {};
