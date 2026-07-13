# 2026-07-13-05 Tier 2-1 Shadow 관찰·안전 기반

## 목적

Catchtable availability XHR을 읽기 전용으로 관찰해 body 분류와 기존 DOM 감지의 일치·선행 시간을 측정하되 예약 제어 경로는 바꾸지 않는다.

## 구현

- strict `timeSlotMap` classifier와 redacted event 계약
- on-demand MAIN-world XHR probe, 만료·명시 종료 원복
- ISOLATED bridge의 source/schema/channel/범위 검증
- body/DOM first-claim coordinator와 `AVAILABILITY_SHADOW` trace
- background best-effort 주입과 별도 MAIN IIFE build
- probe 부재·실패에도 동일한 오케스트레이터 결과를 보장하는 테스트

## live 검증

- no-match: `TIMED_OUT`, 24/24 events, dropped 0
- match: `DRY_RUN_COMPLETED`, 16/16 events, dropped 0
- body/DOM 모두 18:30 선택, agreement true
- body가 DOM보다 79.4ms 선행
- 종료 후 XHR wrapper 원복, Console error/warn 없음

## 적대적 수정

- 관찰 준비 예외의 원본 `send()` 차단 방지
- timer 상한 재무장
- status 0 취소 요청을 `IRRELEVANT`로 분리
- extension reload 뒤 stale listener/probe 구현 교체
- duplicate sequence와 최초 claim 잠금

## 판정

**REDUCE.** body 선행은 확인했지만 안전한 pre-DOM actuator가 없다. 실제 오픈 표본을 더 모은 뒤 MutationObserver 기반 DOM claim 가속만 검토한다.

## 검증

```bash
npm run check
```

228 tests green, dist 검사와 live dry-run 통과.
