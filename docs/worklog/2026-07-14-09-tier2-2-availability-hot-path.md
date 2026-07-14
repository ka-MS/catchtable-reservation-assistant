# 2026-07-14 Tier 2-2 availability hot-path

## 목표

날짜·인원이 검증된 target body를 기존 DOM 슬롯 탐색의 wake-up 신호로만 사용하고, body 부재·거부·실패 시 기존 bounded 경로를 그대로 보존한다.

## 구현

- run-local `AvailabilityDomWake` 추가
- 현재 cycle `EXACT/STRONG`, non-stale, matching slot, 유효 timing만 수용
- body 도착 시 25ms fallback wait를 깨우고 즉시 DOM 재검사
- body bridge 뒤 최대 250ms 동안 10ms burst, 이후 기존 25ms와 다음 토글로 복귀
- body render window가 다음 토글 경계를 넘을 때 현재 cycle만 보존
- wake·폐기 사유와 response/bridge/wake/DOM timing trace 추가
- wake 및 trace 예외를 기존 제어 결과에서 격리
- SlotAdapter의 가시 후보를 `main` 밖 예약 portal까지 확장

## 적대적 리뷰 수정

1. 다음 토글이 body 대응 DOM render를 잘라내는 경계 수정
2. 실제 portal 슬롯을 `main` 제한 selector가 놓치는 문제 수정
3. 근거 없이 제거됐던 20ms stale-DOM settling 복원
4. `wake_result` trace exporter 예외 격리

각 finding은 회귀 테스트 또는 live fixture를 추가한 뒤 수정했다.

## 검증

```text
npm run check
263 tests passed
dist validation passed
independence validation passed
```

Chrome dry-run `run-9e67fd6e-29a4-4def-87f8-244f0960e84f`:

- 24 events, seq 1..24, dropped 0
- cycle 1 / request 4 / EXACT wake accepted
- portal 18:30 DOM candidate 발견
- wakeCandidateFound=true, wakeFallbackUsed=false
- wake-to-DOM 약 0.1ms, response-to-DOM 약 20.4ms
- 최종 `DRY_RUN_COMPLETED`
- 슬롯·결제·약관·최종 예약 클릭 0회

## 판정

이번 live는 이미 열린 슬롯의 기능·안전 검증이므로 실제 오픈 성능 증거가 아니다.

> fallback 보존형 구현 완료, RT-10M 재측정 대기

RT-10M 뒤 p50/p95를 판독하고, RT-05 운영 정책을 결정해야 Tier 2-2를 최종 종료할 수 있다.
