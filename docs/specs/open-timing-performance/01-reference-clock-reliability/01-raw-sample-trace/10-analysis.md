# RT-15 분석 — 기준시계 원시 표본 trace

## 1. 문제

현재 trace에는 bootstrap·armed `CLOCK_SYNCED` 요약만 남는다. `ReferenceClockSampler`는 최대 64개 `ReferenceClockSample`을 메모리에 보유하지만 실행 종료 뒤 폐기하므로 다음을 사후 검증할 수 없다.

- 어떤 HEAD 표본이 dominant·competing cluster를 만들었는지
- RTT outlier와 cache 표본이 estimator에서 어떻게 제외됐는지
- 고불확실성 실행을 hindsight로 재추정할 수 있는지
- 서버 풀 스큐와 짧은 관측 시간 중 어느 쪽이 원인이었는지

## 2. 현재 재사용 가능 구조

- `ReferenceClockSampler.samples`: 기본 상한 64인 기존 ring buffer
- `ReferenceClockSample`: `t0`, `t1`, `serverDateMs`, `rttMs`, offset lower/upper, `fromCache`
- `TraceLogger -> BatchTraceProcessor -> IndexedDB`: ACK 기반 기존 trace 저장 경로
- CSV·진단 bundle: 모든 trace event의 동적 scalar attribute를 자동 내보냄

새 수집기, IndexedDB store 또는 exporter는 필요하지 않다.

## 3. 착수 순서

Backlog는 RT-15를 RT-11 shadow 비교 뒤로 배치했지만 `Blocks=없음`이고 기술적 선행 의존성도 없다. 이번 명시적 착수 결정에 따라 먼저 구현한다. RT-15는 향후 RT-11 표본의 시계 오염을 더 잘 판독하게 하지만 RT-11 wake counterfactual 계산 자체를 변경하지 않는다.

## 4. 선택지

### A. 표본당 trace event — 채택

각 원시 표본을 `CLOCK_SAMPLE` event 하나로 변환한다. scalar attribute만 사용하므로 기존 schema, IndexedDB와 CSV를 그대로 쓴다.

### B. 전체 ring을 JSON attribute 하나로 기록 — 기각

Trace string attribute는 500자로 정제되므로 최대 64개 표본이 잘린다. 예외적인 대용량 attribute 계약을 추가하면 범위가 커진다.

### C. 별도 clock-sample store — 기각

DB migration, repository, export bundle과 삭제/prune 계약이 모두 추가된다. 현재 trace event로 충분하다.

## 5. 위험

- armed 직전 64건을 trace queue에 넣으면 `batchSize=20`에 의해 즉시 transport가 실행돼 정밀 구간을 방해할 수 있다.
- terminal 뒤 raw event 64건이 Side Panel 최근 100개를 덮을 수 있다.
- normal armed와 early terminal 경로가 겹치면 중복 기록할 수 있다.
- `stop()` 중 in-flight HEAD가 abort돼도 이미 완성된 표본은 잃지 않아야 한다.

## 6. 판정

**GO.** armed에서는 sampler를 중지하고 raw ring을 메모리에 동결만 한다. terminal `finally`에서 표본당 `CLOCK_SAMPLE`을 기존 queue에 넣은 뒤 기존 `forceFlush()`로 저장한다. armed 전에 종료되면 terminal에서 중지·동결·기록을 한 번 수행한다.

브라우저 프로세스가 armed 이후 terminal 전에 강제 종료되면 동결 표본이 유실될 수 있다. 이 제한은 hot path 무부하를 우선해 수용하며, 별도 crash-safe persistence는 범위 밖이다.
