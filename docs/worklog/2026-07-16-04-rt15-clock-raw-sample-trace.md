# RT-15 기준시계 원시 표본 trace 구현

**날짜:** 2026-07-16
**범위:** 기존 기준시계 ring buffer를 terminal trace·CSV·진단 bundle에 연결. estimator와 예약 hot path 변경 없음.

## 배경

기존 `CLOCK_SYNCED`는 estimate 요약만 남겨 개별 HEAD 표본의 RTT, 서버 Date와 offset interval을 사후 재구성할 수 없었다. `ReferenceClockSampler`가 이미 최대 64개 표본을 보유하므로 새 수집기 없이 기존 ring을 활용했다.

## 구현

- sampler에 `drainSamples()`를 추가해 ring을 순서대로 넘기고 `latest` estimate는 유지했다.
- actual arm에서 sampler를 stop/drain해 RunSession 메모리에 동결했다.
- arm 전 종료는 terminal 경계에서 같은 동작을 수행한다.
- terminal `finally`에서 표본당 `CLOCK_SAMPLE` event를 만들고 기존 trace flush에 합류시켰다.
- raw event는 `state=null`로 저장해 기존 terminal state와 종료 시각을 보존한다.
- Side Panel 운영 목록에서는 raw event를 숨기고, CSV와 진단 bundle에는 전체 필드를 유지했다.
- 숨겨진 최대 64건 뒤에도 운영 이벤트 100건을 읽도록 상세 조회 limit을 200으로 올렸다.

## 비변경

- HEAD sampling 주기와 ring 상한 64
- estimator, confidence, monotonic anchor
- armLead와 날짜 토글·슬롯 선택·클릭
- IndexedDB schema와 store

## 검증과 리뷰

- `npm run check`: typecheck, `323/323` tests, dist, MAIN/ISOLATED independence 통과
- `git diff --check` 통과
- drain 수명주기, normal/early terminal, bootstrap 실패, trace 예외, 저장소 terminal 보존, UI 비노출, CSV 필드를 회귀 테스트로 고정했다.
- terminal 전 Content context 강제 종료나 trace queue overflow에서는 일부 raw 표본이 유실될 수 있다. hot path 전송을 피하기 위한 best-effort 진단 trade-off로 수용했다.

## 판정

RT-15를 `DONE`으로 종료한다. 실제 표본 품질과 hindsight 재추정은 다음 live run의 CSV·진단 bundle에서 확인한다.
