# RT-15 검증 — 기준시계 원시 표본 trace

## 자동 검증

2026-07-16 기준 다음 명령을 통과했다.

```bash
npm run check
git diff --check
```

결과:

- 전체 테스트 `323/323`
- TypeScript typecheck 통과
- dist 검증 통과
- MAIN/ISOLATED 독립성 검증 통과

## 고정한 회귀 계약

- sampler drain은 최대 64개 ring의 순서를 유지하고 내부 ring만 비운다.
- drain 뒤 `latest` estimate는 유지되며 두 번째 drain은 빈 배열이다.
- 정상 arm은 표본을 `armed` 사유로 한 번만 동결한다.
- arm 전 종료는 표본을 `terminal` 사유로 한 번만 동결한다.
- bootstrap 실패는 raw event를 만들지 않는다.
- raw trace 예외는 최종 실행 결과를 변경하지 않는다.
- `CLOCK_SAMPLE`은 terminal 상태를 싣지 않아 기존 `finalState`와 `finishedAt`을 덮지 않는다.
- Side Panel 운영 목록은 raw event를 숨기고 기존 최신 100건을 유지한다.
- CSV는 `CLOCK_SAMPLE` code와 모든 raw scalar attribute를 보존한다.

## Trace 필드

테스트 표본 하나에 대해 index/total, freeze reason, monotonic `t0/t1`, 서버 Date, RTT, offset lower/center/upper, cache 여부가 정확히 기록되는 것을 확인했다.

## 판정

RT-15 구현 gate를 통과했다. 다음 실제 실행부터 별도 설정 없이 raw sample이 terminal flush에 포함된다. 화면 운영 로그에는 표시되지 않으며 CSV·진단 bundle에서 확인한다.
