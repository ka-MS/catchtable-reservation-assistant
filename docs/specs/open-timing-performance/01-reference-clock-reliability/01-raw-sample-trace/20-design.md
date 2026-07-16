# RT-15 설계 — 기준시계 원시 표본 trace

## 1. 수명주기

```text
HEAD sample
  -> ReferenceClockSampler ring(max 64)
  -> estimateReferenceClock() 현행 계산
  -> actual arm: stop + drain + RunSession 메모리에 동결
  -> terminal finally: CLOCK_SAMPLE N건 enqueue
  -> 기존 forceFlush()
```

조기 종료는 terminal `finally`에서 `stop + drain + enqueue`한다. 동결 batch는 소비 후 지워 중복 기록을 막는다.

## 2. Port 계약

`ReferenceClockPort`에 다음을 추가한다.

```ts
drainSamples(): ReferenceClockSample[];
```

- 현재 ring의 순서를 보존한 복사본을 반환하고 내부 ring을 비운다.
- `latest` estimate는 유지한다.
- 두 번째 호출은 빈 배열을 반환한다.
- 기본 64개 상한은 변경하지 않는다.

## 3. Trace 계약

새 code: `CLOCK_SAMPLE`.

표본당 scalar attributes:

- `clockSampleIndex`, `clockSampleTotal`
- `clockSampleFreezeReason`: `armed | terminal`
- `clockSampleT0MonoMs`, `clockSampleT1MonoMs`
- `clockSampleServerDateMs`, `clockSampleRttMs`
- `clockSampleOffsetLowerMs`, `clockSampleOffsetCenterMs`, `clockSampleOffsetUpperMs`
- `clockSampleFromCache`

`localAt`은 terminal enqueue 시각이므로 표본 시각 분석에는 `t0/t1`을 사용한다. 유효한 Date header로 생성된 `ReferenceClockSample`만 기록하며 네트워크 실패·Date 누락은 이번 범위에서 별도 event로 만들지 않는다.

## 4. Hot-path 격리

- actual arm에서 `deps.trace`와 `forceFlush`를 호출하지 않는다.
- raw event 생성과 transport enqueue는 terminal 상태가 확정된 뒤에만 수행한다.
- 기존 estimator와 `MonotonicEpochClock` anchor를 변경하지 않는다.
- trace 예외는 실행 결과에 영향을 주지 않는다.

## 5. Side Panel과 export

- `CLOCK_SAMPLE`은 운영 로그 목록에서 숨긴다.
- raw event 최대 64건을 제외하고도 최근 운영 이벤트 100건을 유지하도록 상세 조회 limit은 200으로 올린다.
- CSV와 진단 bundle은 기존 전체-event export를 사용하므로 raw event를 그대로 포함한다.
- IndexedDB schema version과 store는 변경하지 않는다.

## 6. 안전 불변식

1. 한 표본은 한 실행에서 최대 한 번 기록한다.
2. 서로 다른 RunSession의 표본이 섞이지 않는다.
3. ring 상한 64를 넘지 않는다.
4. actual arm 이후 시계 estimate와 anchor는 변하지 않는다.
5. raw trace 실패가 예약 상태·클릭·deadline을 바꾸지 않는다.
6. Side Panel 운영 로그 가시성을 raw event가 잠식하지 않는다.
