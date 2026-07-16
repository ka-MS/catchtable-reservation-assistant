# 실행 진단 설계

## 컴포넌트

```text
RunSession
  -> DiagnosticRecorder.breadcrumb()       메모리 ring, 최대 3개
  -> DiagnosticRecorder.failure()          rich snapshot 생성
  -> DiagnosticTransport.save()
  -> runtime.sendMessage ACK
  -> DiagnosticSnapshotRepository
  -> IndexedDB snapshots

Side Panel
  -> EXPORT_RUN_DIAGNOSTIC
  -> events + snapshots
  -> DiagnosticBundleBuilder
  -> catchtable-diagnostic-{runId}.zip
```

`DiagnosticRecorder`는 DOM을 아는 Content 전용 컴포넌트다. Repository와 Bundle Builder는 DOM을 모르며 공유 스키마만 사용한다.

## 캡처 정책

### Breadcrumb

- 예약 진입·날짜/인원 준비·대기·슬롯 클릭 이후·후속 진행의 선택된 저빈도 상태 전이 직후
- 주요 `action` 이벤트 직후
- 초기 설정/검증/시계 동기화, `REFRESHING_SLOTS`, `SLOT_DETECTED`, `DATE_TOGGLE_CYCLE`, slot polling, mutation callback, XHR body callback에서는 생성하지 않음
- fragment 없이 구조 요약만 보유
- 최근 3개를 넘으면 오래된 항목 폐기

### Failure

- `diagnosticHandOff`, `timedOut`, 처리되지 않은 예외에서 1회 생성
- 현재 stage, reason, error, 전달된 Adapter diagnostics를 포함
- 최근 breadcrumb 3개와 한 batch로 저장
- 정상 `handOff`, `STOPPED`, `DRY_RUN_COMPLETED`는 저장하지 않음

## 데이터 계약

```ts
interface DiagnosticSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  runId: string;
  capturedAt: number;
  kind: "breadcrumb" | "failure";
  stage: RunState;
  adapter: string;
  trigger: "state" | "action" | "failure";
  reason: string;
  strategy: string | null;
  confidence: number | null;
  evidence: string[];
  queries: DiagnosticQueryEvidence[];
  environment: DiagnosticEnvironment;
  headings: DiagnosticElement[];
  buttons: DiagnosticElement[];
  radios: DiagnosticElement[];
  checkboxes: DiagnosticElement[];
  surfaces: DiagnosticSurface[];
  calendar: DiagnosticCalendar;
  slots: DiagnosticSlots;
  fingerprint: string;
  previousFingerprint: string | null;
  fragmentHtml?: string;
  error?: TraceError;
}
```

실제 Adapter가 strategy/confidence를 제공하지 않는 단계는 `null`을 저장한다. post-slot의 기존 `postSlotStrategy`, `postSlotCertainty`, `postSlotEvidence`는 변환해 보존한다.

## 환경

- query/hash를 제거한 URL과 URL kind
- document title, readyState, visibilityState, `hasFocus()`
- viewport, visual viewport, DPR, scroll 위치
- activeElement 요약
- 확장 버전은 run record에서 bundle manifest로 제공

## DOM 수집

- heading, button, radio, checkbox, date cell, slot 후보
- 활성 dialog, presentation, fixed/sticky 후보
- tag, role, 정제 text, aria-label/pressed/checked/selected/disabled, rect
- 진단 selector와 전체/visible match count
- 현재 월, 날짜 cell 수, 선택 날짜, 슬롯 후보 labels
- 구조 fingerprint와 이전 breadcrumb fingerprint

## Fragment 정제

활성 dialog/presentation이 있으면 해당 surface를, 없으면 실패 stage와 관련된 후보 요소의 최소 공통 영역을 선택한다. 다음 규칙으로 새 DOM 문자열을 재구성한다.

- 허용 태그와 구조만 유지
- `script`, `style`, `iframe`, `canvas`, `svg`, `img`, event handler 제거
- `value`, `src`, `href`, `style`, `contenteditable` 제거
- `role`, `type`, 제한된 aria/data 속성, disabled/checked/selected만 유지
- 전화번호·이메일·카드처럼 보이는 긴 숫자 마스킹
- 최대 64KiB

fragment는 실행 가능한 fixture가 아니라 진단 증거다.

## 저장

IndexedDB `catchtable-reserve-telemetry` version 2:

```text
runs       기존 유지
events     기존 유지
snapshots
  keyPath: snapshotId
  index: runId
```

v1→v2 업그레이드는 `snapshots`만 생성한다. run 삭제와 prune은 동일 transaction에서 연결 snapshot을 삭제한다.

## 번들

```text
catchtable-diagnostic-{runId}.zip
  manifest.json
  run.csv
  events.jsonl
  dom-snapshots.jsonl
  environment.json
  fragments/{snapshotId}.html
```

`dom-snapshots.jsonl`에서는 `fragmentHtml`을 제거하고 `fragmentFile`만 기록한다. ZIP은 side panel에서 메모리로 생성하며 저장 방식 ZIP으로 불필요한 압축 CPU를 쓰지 않는다.

## 실패 격리

- 진단 캡처·전송·저장·ZIP 실패는 예약 상태를 바꾸지 않는다.
- Content는 진단 저장을 최대 750ms 기다린다.
- 서비스 워커 재시작으로 메시지 채널이 끊긴 경우 snapshotId 기반 idempotent put을 전제로 한 번만 재시도한다.
- 저장 실패 시 terminal Trace는 계속 남는다.
- 개인정보 정제 실패 시 fragment를 버리고 구조 요약만 저장한다.
