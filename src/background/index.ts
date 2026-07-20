import type {
  ActiveRun,
  CommandResponse,
  ContentCommand,
  PanelCommand,
  ReservationConfig,
  RunEvent,
  RunEventMessage,
  RunState,
  ShopSnapshot,
} from "../shared/types.js";
import { validateReservationConfig } from "../shared/config.js";
import { finishJob as finishScheduledJob } from "../shared/scheduled-jobs.js";
import type { AttemptControlMessage } from "../shared/run-control/protocol.js";
import { isShopUrl } from "./navigation.js";
import { appendRunEvent, SerialTaskQueue } from "./storage.js";
import { SavedConfigRepository } from "./saved-config-repository.js";
import { ScheduledJobRepository } from "./scheduled-job-repository.js";
import { JobScheduler } from "./scheduler.js";
import { createPageRuntimePort } from "./page-runtime-port.js";
import { runTerminalEffects } from "./terminal-effects.js";
import { RunSupervisor } from "./run-supervisor.js";
import type { TraceBatch } from "../shared/telemetry/types.js";
import type { DiagnosticSnapshotBatchMessage } from "../shared/diagnostics/types.js";
import { IndexedDbTraceRepository } from "./telemetry/indexeddb-repository.js";
import { LiveTraceHub } from "./telemetry/live-trace-hub.js";
import { TraceIngestor } from "./telemetry/trace-ingestor.js";
import { ensureAvailabilityProbe } from "./availability-probe.js";
import { captureRunExecutionContext } from "./run-execution-context.js";

const TERMINAL_STATES = new Set<RunState>([
  "DRY_RUN_COMPLETED",
  "HANDED_OFF",
  "COMPLETED",
  "STOPPED",
  "TIMED_OUT",
  "FAILED",
]);
const eventWrites = new SerialTaskQueue();
const traceWrites = new SerialTaskQueue();
const savedConfigWrites = new SerialTaskQueue();
const traceRepository = new IndexedDbTraceRepository();
const liveTraceHub = new LiveTraceHub();
const traceIngestor = new TraceIngestor(traceRepository, liveTraceHub, () => chrome.runtime.getManifest().version);

async function recordStartFailure(
  runId: string,
  config: ReservationConfig,
  message: string,
  error?: unknown,
  scheduledJobId?: string,
): Promise<void> {
  await traceWrites.enqueue(() => traceIngestor.recordBackgroundFailure(runId, config, message, error, scheduledJobId)).catch((traceError) => {
    console.error("실행 실패 추적을 저장하지 못했습니다.", traceError);
  });
}
const savedConfigs = new SavedConfigRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (values) => chrome.storage.local.set(values),
}, () => crypto.randomUUID(), () => Date.now());

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

async function updateSavedConfigs(command: Extract<PanelCommand, { type: "SAVE_FAVORITE" } | { type: "DELETE_SAVED" } | { type: "CLEAR_SAVED" }>): Promise<CommandResponse> {
  if (command.type === "SAVE_FAVORITE") {
    const errors = validateReservationConfig(command.config, Number.NEGATIVE_INFINITY);
    if (errors.length > 0) return { ok: false, error: errors.join(" ") };
    await savedConfigWrites.enqueue(() => savedConfigs.upsert("favorites", command.config));
    return { ok: true };
  }
  if (command.type === "DELETE_SAVED") {
    await savedConfigWrites.enqueue(() => savedConfigs.remove(command.list, command.id));
    return { ok: true };
  }
  await savedConfigWrites.enqueue(() => savedConfigs.clear(command.list));
  return { ok: true };
}

const jobWrites = new SerialTaskQueue();
const scheduledJobs = new ScheduledJobRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (values) => chrome.storage.local.set(values),
}, () => crypto.randomUUID(), () => Date.now());
const pageRuntimePort = createPageRuntimePort({
  tabs: {
    get: (tabId) => chrome.tabs.get(tabId),
    update: async (tabId, properties) => (await chrome.tabs.update(tabId, properties)) ?? {},
    reload: (tabId) => chrome.tabs.reload(tabId),
    onUpdated: chrome.tabs.onUpdated,
  },
  executeScript: async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content/index.js"] });
  },
  sendMessage: (tabId, command) => chrome.tabs.sendMessage(tabId, command),
});
const supervisor = new RunSupervisor({
  storage: {
    get: (keys) => chrome.storage.local.get(keys),
    set: (values) => chrome.storage.local.set(values),
  },
  port: pageRuntimePort,
  effects: (run) => runTerminalEffects(run, {
    setBadge: async (color, text) => {
      await chrome.action.setBadgeBackgroundColor({ color });
      await chrome.action.setBadgeText({ text });
    },
    notify: (notificationId, message) => {
      // 운영체제 알림 실패는 상태 저장과 Side Panel 표시를 막지 않는다.
      chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
        title: "Catchtable Reserve",
        message,
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn("운영체제 알림을 표시하지 못했습니다.", chrome.runtime.lastError.message);
        }
      });
    },
    finishJob: (jobId, state, message, finishedAt) => jobWrites.enqueue(() => scheduledJobs.update(
      (jobs) => finishScheduledJob(jobs, jobId, { state, message, finishedAt }, Date.now()),
    )).then(() => undefined),
  }),
  trace: {
    startFailure: (runId, config, message, error, jobId) => recordStartFailure(runId, config, message, error, jobId),
    backgroundTerminal: (runId, startedAt, config, state, message, jobId) => traceWrites.enqueue(
      () => traceIngestor.recordBackgroundTerminal(runId, startedAt, config, state, message, jobId),
    ),
    recovery: (runId, config, code, message, attributes, jobId) => traceWrites.enqueue(
      () => traceIngestor.recordRecovery(runId, config, code, message, attributes, jobId),
    ),
  },
  probe: (tabId, enabled) => ensureAvailabilityProbe(tabId, enabled, chrome.scripting),
  captureContext: (tabId) => captureRunExecutionContext(tabId, {
    get: (id) => chrome.tabs.get(id),
  }, {
    get: (windowId) => chrome.windows.get(windowId),
  }),
  activeTab: async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab === undefined ? undefined : { id: tab.id, url: tab.url };
  },
  createTab: async (url) => {
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    if (tab.id === undefined) throw new Error("예약 실행 탭을 만들 수 없습니다.");
    return tab.id;
  },
  validate: (config, nowMs) => validateReservationConfig(config, nowMs),
  saveHistory: (config) => {
    void savedConfigWrites.enqueue(() => savedConfigs.upsert("history", config)).catch((error) => {
      console.warn("최근 설정을 저장하지 못했습니다.", error);
    });
  },
  newId: () => crypto.randomUUID(),
  now: () => Date.now(),
});
const supervisorReady = supervisor.ready;

const jobScheduler = new JobScheduler({
  repository: scheduledJobs,
  alarms: {
    create: (name, info) => chrome.alarms.create(name, info),
    clear: (name) => chrome.alarms.clear(name),
  },
  launch: (job) => supervisor.startScheduled(job),
  notify: (message) => {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
      title: "Catchtable Reserve",
      message,
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn("운영체제 알림을 표시하지 못했습니다.", chrome.runtime.lastError.message);
      }
    });
  },
  now: () => Date.now(),
});

async function recordEvent(event: RunEvent, tabId: number | undefined): Promise<void> {
  const stored = await chrome.storage.local.get(["runEvents", "activeRun"]);
  const events = Array.isArray(stored.runEvents) ? stored.runEvents as RunEvent[] : [];
  const previous = stored.activeRun as ActiveRun | null | undefined;
  const stateValue = event.data?.state;
  const state = typeof stateValue === "string" ? stateValue as RunState : previous?.state ?? "CONFIGURED";
  const activeRun: ActiveRun = {
    runId: event.runId,
    tabId: tabId ?? previous?.tabId ?? -1,
    state,
    startedAt: previous?.runId === event.runId ? previous.startedAt : event.at,
    updatedAt: event.at,
    ...(previous?.scheduledJobId === undefined ? {} : { scheduledJobId: previous.scheduledJobId }),
  };
  await chrome.storage.local.set({
    runEvents: appendRunEvent(events, event, 300),
    activeRun,
  });
  // terminal 효과(배지·알림·job 종결)는 RUN_EVENT가 아니라 supervisor의 결정 이후
  // TerminalEffects가 실행한다 — RUN_EVENT는 projection(activeRun/runEvents) 전용.
}

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = rawMessage as PanelCommand | RunEventMessage | DiagnosticSnapshotBatchMessage | AttemptControlMessage;
  if (message.type === "RUN_EVENT") {
    void eventWrites.enqueue(() => recordEvent(message.event, sender.tab?.id)).catch((error) => {
      console.error("실행 이벤트를 저장하지 못했습니다.", error);
    });
    return;
  }
  if (message.type === "SAVE_DIAGNOSTIC_SNAPSHOTS") {
    if (message.snapshots.length === 0 || message.snapshots.length > 4
      || message.snapshots.some((snapshot) => snapshot.runId !== message.runId || snapshot.schemaVersion !== 1)) {
      sendResponse({ ok: false, error: "진단 스냅샷 batch가 올바르지 않습니다." });
      return;
    }
    void traceWrites.enqueue(() => traceRepository.saveSnapshots(message.snapshots)).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "진단 스냅샷을 저장할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "ATTEMPT_FINISHED") {
    void supervisorReady.then(() => supervisor.onAttemptFinished(message)).then(sendResponse).catch((error) => {
      console.error("attempt 종결 처리에 실패했습니다.", error);
      sendResponse({ ok: false, reason: "unknown_logical_run" });
    });
    return true;
  }
  if (message.type === "ATTEMPT_PHASE_CHANGED") {
    void supervisorReady.then(() => supervisor.onPhaseChanged(message)).then(sendResponse).catch((error) => {
      console.error("attempt phase 처리에 실패했습니다.", error);
      sendResponse({ ok: false, reason: "unknown_logical_run" });
    });
    return true;
  }
  if (message.type === "PANEL_START") {
    void supervisorReady.then(() => supervisor.startManual(message.config)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행을 시작할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "PANEL_STOP") {
    void supervisorReady.then(() => supervisor.stop()).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행을 중지할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "FETCH_SHOP_SNAPSHOT") {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!isShopUrl(tab?.url) || tab.id === undefined) {
        sendResponse({ ok: false, error: "현재 탭이 캐치테이블 매장 페이지가 아닙니다." });
        return;
      }
      try {
        await pageRuntimePort.inject(tab.id);
        const response = await chrome.tabs.sendMessage(tab.id, { type: "READ_SHOP_SNAPSHOT" } satisfies ContentCommand);
        sendResponse({ ok: true, data: response.data as ShopSnapshot });
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : "현재 탭 정보를 가져올 수 없습니다." });
      }
    })();
    return true;
  }
  if (message.type === "SAVE_FAVORITE" || message.type === "DELETE_SAVED" || message.type === "CLEAR_SAVED") {
    void updateSavedConfigs(message).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "저장 설정을 변경할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "LIST_RUN_HISTORY") {
    void traceWrites.enqueue(() => traceRepository.listRuns(20)).then((runs) => sendResponse({ ok: true, data: runs })).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행 이력을 읽을 수 없습니다." });
    });
    return true;
  }
  if (message.type === "GET_RUN_TRACE") {
    void traceWrites.enqueue(() => traceRepository.readEvents(message.runId, Math.min(message.limit ?? 100, 500))).then((events) => {
      sendResponse({ ok: true, data: events });
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행 로그를 읽을 수 없습니다." });
    });
    return true;
  }
  if (message.type === "EXPORT_RUN_TRACE") {
    void traceWrites.enqueue(() => traceRepository.readEvents(message.runId, Number.MAX_SAFE_INTEGER)).then((events) => {
      sendResponse({ ok: true, data: events });
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행 로그를 내보낼 수 없습니다." });
    });
    return true;
  }
  if (message.type === "EXPORT_RUN_DIAGNOSTIC") {
    void traceWrites.enqueue(async () => ({
      events: await traceRepository.readEvents(message.runId, Number.MAX_SAFE_INTEGER),
      snapshots: await traceRepository.readSnapshots(message.runId),
    })).then((data) => {
      sendResponse({ ok: true, data });
    }).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행 진단을 내보낼 수 없습니다." });
    });
    return true;
  }
  if (message.type === "DELETE_RUN_TRACE") {
    void traceWrites.enqueue(() => traceRepository.deleteRun(message.runId)).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "실행 이력을 삭제할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "SCHEDULE_JOB") {
    void jobWrites.enqueue(() => jobScheduler.schedule(message.id, message.config)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "예약 작업을 저장할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "DELETE_JOB") {
    void jobWrites.enqueue(() => jobScheduler.delete(message.id)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "예약 작업을 삭제할 수 없습니다." });
    });
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "trace-live") {
    liveTraceHub.add(port);
    return;
  }
  if (port.name !== "trace-ingest") return;
  port.onMessage.addListener((message: TraceBatch) => {
    if (message?.type !== "TRACE_BATCH" || !Array.isArray(message.events)) return;
    void traceWrites.enqueue(() => traceIngestor.ingest(message, (ack) => port.postMessage(ack))).catch((error) => {
      console.error("실행 추적 batch를 저장하지 못했습니다.", error);
    });
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void supervisorReady.then(() => jobWrites.enqueue(() => jobScheduler.onAlarm(alarm.name))).catch((error) => {
    console.error("예약 작업 알람 처리에 실패했습니다.", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void jobWrites.enqueue(() => jobScheduler.reconcile()).catch((error) => {
    console.error("예약 작업 복구에 실패했습니다.", error);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  void jobWrites.enqueue(() => jobScheduler.reconcile()).catch((error) => {
    console.error("예약 작업 복구에 실패했습니다.", error);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void supervisorReady.then(() => supervisor.onTabRemoved(tabId)).catch((error) => {
    console.error("탭 종료 처리에 실패했습니다.", error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const url = changeInfo.url;
  void supervisorReady.then(() => supervisor.onTabUrlChanged(tabId, url)).catch((error) => {
    console.error("탭 이동 처리에 실패했습니다.", error);
  });
});
