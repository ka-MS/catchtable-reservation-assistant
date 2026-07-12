# 실행 텔레메트리 설계

## 파이프라인

```text
OpenRunOrchestrator / Background
  -> TraceLogger.record()
  -> BatchTraceProcessor
  -> runtime.Port TRACE_INGEST
  -> Background TraceIngestor
       -> IndexedDbTraceRepository
       -> ACK
       -> LiveTraceHub -> Side Panel Port
```

Content는 250ms 또는 20건마다 보낸다. Background는 별도 1초 메모리 버퍼를 두지 않고 수신 batch를 즉시 한 transaction으로 저장한다. Side Panel 전달은 저장 경로와 분리하며 저장 실패 시 ACK하지 않는다.

## 데이터 계약

```ts
type TraceSeverity = "trace" | "info" | "warn" | "error";

interface TraceEvent {
  schemaVersion: 1;
  runId: string;
  seq: number;
  code: TraceCode;
  severity: TraceSeverity;
  component: "content" | "background";
  localAt: number;
  serverAt: number | null;
  state: RunState | null;
  message: string;
  attributes: Record<string, string | number | boolean | null>;
  error?: { name: string; message: string; stack?: string };
}
```

`code`가 분석 계약이고 한국어 `message`는 사람이 읽는 snapshot이다. attribute는 허용된 primitive만 받고 stack은 오류에서만 8KB로 제한한다.

## 실행 저장소

IndexedDB `catchtable-reserve-telemetry`, version 1:

```text
runs
  keyPath: runId
  index: startedAt, finishedAt

events
  keyPath: [runId, seq]
  index: runId, [runId, seq]
```

`RunRecord`는 설정 snapshot, 시작·종료 시각, 최종 상태, event/dropped 수, 앱 버전과 scheduledJobId를 가진다. 종료 후 최근 20건만 남기고 오래된 run과 events를 같은 정리 단계에서 삭제한다.

## 전송과 복구

- batch는 `batchId`, `runId`, `firstSeq`, `lastSeq`, `events`를 가진다.
- Background는 IDB `put`으로 중복을 허용하고 저장 성공 뒤 `lastSeq` ACK를 보낸다.
- Content는 ACK된 seq까지만 큐에서 제거한다.
- Port 단절 시 재연결하고 미확인 batch를 재전송한다.
- 일반 trace 큐는 512건, 중요 이벤트 여유는 64건이다. 초과 시 오래된 trace만 제거하고 `droppedCount`를 다음 이벤트에 포함한다.
- terminal flush는 ACK를 최대 500ms 기다리는 best effort다. 브라우저 강제 종료까지 완전 보장하지 않으므로 평상시 250ms 저장을 유지한다.

## 날짜 토글 이벤트

`DATE_TOGGLE_CYCLE` 한 건에 다음 값을 기록한다.

```text
cycle, phase, adjacentDate
adjacentPlannedAt, adjacentClickedAt, adjacentClickOk
targetPlannedAt, targetClickedAt, targetClickOk
targetSelectedAt
slotScanCount, availableSlotCount, matchedSlotCount
result: NO_SLOT | SLOT_FOUND | CLICK_FAILED | SELECTION_UNCONFIRMED
```

`SLOT_DETECTED`, `SLOT_CLICKED`, `RUN_FAILED`, `RUN_TERMINATED`는 별도 중요 이벤트다.

## 출력 확장점

```ts
interface TraceRepository {
  append(batch: TraceEvent[]): Promise<void>;
  listRuns(limit: number): Promise<RunRecord[]>;
  readEvents(runId: string, limit: number): Promise<TraceEvent[]>;
  deleteRun(runId: string): Promise<void>;
}

interface TraceExporter {
  export(batch: TraceEvent[]): Promise<ExportResult>;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}
```

파일 내보내기는 Repository를 조회하는 pull service다. HTTP·OTLP는 로컬 저장 성공 뒤 outbox 기반으로 추가하며 예약 실행과 로컬 저장을 막지 않는다.

## UI

- 실행 로그 화면 상단에 최근 실행 선택 메뉴와 삭제 명령을 둔다.
- 현재 실행은 live batch를 즉시 append한다.
- 실행 선택 시 Background 조회 명령으로 최근 100개를 불러온다.
- `DocumentFragment`로 batch를 한 번에 추가하고 DOM은 100행으로 제한한다.
- 토글 사이클은 한 행 요약으로 보이고 구조화 상세는 보조 문구로 표시한다.
