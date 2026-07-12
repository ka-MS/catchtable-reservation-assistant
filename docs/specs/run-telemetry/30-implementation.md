# 실행 텔레메트리 구현 계획

## 패키지

```text
src/shared/telemetry/types.ts
src/shared/telemetry/codes.ts
src/content/telemetry/trace-logger.ts
src/content/telemetry/batch-processor.ts
src/content/telemetry/port-transport.ts
src/background/telemetry/indexeddb-repository.ts
src/background/telemetry/trace-ingestor.ts
src/background/telemetry/live-trace-hub.ts
src/sidepanel/telemetry/trace-view.ts
```

## 구현 순서

1. 순수 스키마·redaction·batch 정책
2. IndexedDB schema·조회·보존
3. Port batch·ACK·재연결
4. Background 시작 실패와 Content lifecycle 변환
5. 날짜 토글 사이클 trace
6. 실행 히스토리·증분 Viewer
7. 기존 `runEvents` dual-write 제거와 호환 migration

OpenTelemetry 런타임 패키지는 설치하지 않는다. API·Processor·Exporter 경계만 적용해 현재 무런타임 의존성과 Content IIFE 번들을 유지한다.

## 구현 결과

- `TraceLogger`, `BatchTraceProcessor`, `PortTraceTransport`를 Content에 연결했다.
- batch 크기 도달도 0ms timer로 넘겨 `record()` 안에서 Port 전송하지 않는다.
- ACK 전 이벤트를 보존하고 disconnect 뒤 재연결·재전송한다.
- Background trace 작업은 단일 직렬 큐에서 IDB 저장·종료·조회·삭제 순서를 보장한다.
- 수동·예약 실행의 시작 실패와 탭 종료·URL 이탈을 Background trace로 기록한다.
- 날짜 왕복마다 구조화된 `DATE_TOGGLE_CYCLE`을 기록한다.
- Side Panel에 최근 실행 선택·삭제와 최근 상세 100행 증분 Viewer를 추가했다.
- 기존 `runEvents`는 현재 상태와 미니로그 호환을 위해 유지하고 상세 이력의 원본은 IndexedDB로 전환했다.
