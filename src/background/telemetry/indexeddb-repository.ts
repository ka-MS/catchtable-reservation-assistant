import type { RunState } from "../../shared/types.js";
import type { TraceEvent, TraceRepository, TraceRunDescriptor, TraceRunRecord } from "../../shared/telemetry/types.js";

const DB_NAME = "catchtable-reserve-telemetry";
const DB_VERSION = 1;
const TERMINAL = new Set<RunState>(["DRY_RUN_COMPLETED", "HANDED_OFF", "COMPLETED", "STOPPED", "TIMED_OUT", "FAILED"]);

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB 요청에 실패했습니다."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction이 중단됐습니다."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction에 실패했습니다."));
  });
}

export class IndexedDbTraceRepository implements TraceRepository {
  private database: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  async append(run: TraceRunDescriptor, events: TraceEvent[], extensionVersion: string): Promise<TraceRunRecord> {
    const database = await this.open();
    const transaction = database.transaction(["runs", "events"], "readwrite");
    const runs = transaction.objectStore("runs");
    const eventStore = transaction.objectStore("events");
    const previous = await request(runs.get(run.runId)) as TraceRunRecord | undefined;
    events.forEach((event) => eventStore.put(event));
    const lastState = [...events].reverse().find((event) => event.state !== null)?.state ?? previous?.finalState ?? null;
    const terminalEvent = [...events].reverse().find((event) => event.state !== null && TERMINAL.has(event.state));
    const lastSeq = events.at(-1)?.seq ?? previous?.eventCount ?? 0;
    const droppedCount = events.reduce((maximum, event) => {
      const value = event.attributes.droppedTraceCount;
      return typeof value === "number" ? Math.max(maximum, value) : maximum;
    }, previous?.droppedCount ?? 0);
    const record: TraceRunRecord = {
      ...run,
      finishedAt: terminalEvent?.localAt ?? previous?.finishedAt ?? null,
      finalState: lastState,
      eventCount: Math.max(previous?.eventCount ?? 0, lastSeq - droppedCount),
      droppedCount,
      extensionVersion,
    };
    runs.put(record);
    await completed(transaction);
    return record;
  }

  async listRuns(limit: number): Promise<TraceRunRecord[]> {
    const database = await this.open();
    const transaction = database.transaction("runs", "readonly");
    const index = transaction.objectStore("runs").index("startedAt");
    const records: TraceRunRecord[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(null, "prev");
      cursor.onerror = () => reject(cursor.error ?? new Error("실행 목록을 읽을 수 없습니다."));
      cursor.onsuccess = () => {
        if (!cursor.result || records.length >= limit) {
          resolve();
          return;
        }
        records.push(cursor.result.value as TraceRunRecord);
        cursor.result.continue();
      };
    });
    return records;
  }

  async readEvents(runId: string, limit: number): Promise<TraceEvent[]> {
    const database = await this.open();
    const transaction = database.transaction("events", "readonly");
    const store = transaction.objectStore("events");
    const range = IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    const events: TraceEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursor = store.openCursor(range, "prev");
      cursor.onerror = () => reject(cursor.error ?? new Error("실행 이벤트를 읽을 수 없습니다."));
      cursor.onsuccess = () => {
        if (!cursor.result || events.length >= limit) {
          resolve();
          return;
        }
        events.push(cursor.result.value as TraceEvent);
        cursor.result.continue();
      };
    });
    return events.reverse();
  }

  async deleteRun(runId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(["runs", "events"], "readwrite");
    transaction.objectStore("runs").delete(runId);
    const events = transaction.objectStore("events");
    const range = IDBKeyRange.bound([runId, 0], [runId, Number.MAX_SAFE_INTEGER]);
    await new Promise<void>((resolve, reject) => {
      const cursor = events.openCursor(range);
      cursor.onerror = () => reject(cursor.error ?? new Error("실행 이벤트를 삭제할 수 없습니다."));
      cursor.onsuccess = () => {
        if (!cursor.result) {
          resolve();
          return;
        }
        cursor.result.delete();
        cursor.result.continue();
      };
    });
    await completed(transaction);
  }

  async prune(limit: number): Promise<void> {
    const records = await this.listRuns(Number.MAX_SAFE_INTEGER);
    for (const record of records.slice(limit)) await this.deleteRun(record.runId);
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise((resolve, reject) => {
      const open = this.factory.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const database = open.result;
        if (!database.objectStoreNames.contains("runs")) {
          const runs = database.createObjectStore("runs", { keyPath: "runId" });
          runs.createIndex("startedAt", "startedAt");
        }
        if (!database.objectStoreNames.contains("events")) {
          const events = database.createObjectStore("events", { keyPath: ["runId", "seq"] });
          events.createIndex("runId", "runId");
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("실행 로그 데이터베이스를 열 수 없습니다."));
      open.onblocked = () => reject(new Error("실행 로그 데이터베이스 갱신이 차단됐습니다."));
    });
    return this.database;
  }
}
