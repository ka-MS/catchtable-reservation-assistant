# Tier 2 - Availability 핫패스 분석

**상태:** Tier 2-2 종료. probe는 진단·실험 전용 기본 비활성.
**기준일:** 2026-07-14

## 1. 결정

Tier 2-2는 body 기반 직접 actuator가 아니라 **검증된 target body가 기존 DOM 탐색을 깨우는 축소 경로**로 구현한다.

```text
target body(EXACT/STRONG, matching slot)
-> 현재 cycle DOM scan wake-up
-> SlotAdapter DOM 후보 재조회
-> 기존 clickSlot(candidate)
```

body가 없거나 신뢰할 수 없으면 기존 25ms bounded DOM 탐색과 날짜 토글을 그대로 사용한다.

## 2. 근거

2026-07-14 조광201 실제 오픈 실행 `run-c5463a0b-ffe0-447b-a619-f9c545181ac0`에서 다음을 확인했다.

| 단계 | 오픈 대비 |
|---|---:|
| target body POPULATED | 약 +956ms |
| DOM 후보 관측 | +1004ms |
| 슬롯 클릭 | +1011ms |

- body 후보와 DOM 후보가 일치했고 body가 DOM보다 47.7ms 앞섰다.
- DOM 관측부터 기존 클릭 dispatch까지는 약 7ms였다.
- 대부분의 지연은 서버의 POPULATED 응답 도착 전이며, body로 DOM 렌더 자체를 제거할 수 없다.
- 날짜가 없는 `PerformanceResourceTiming`은 취소된 인접 요청과 target 요청을 구분하지 못한다.

따라서 기대 가능한 개선은 최대 25ms polling 잔여와 body 이후 DOM 확인 주기의 축소다. 실제 오픈 성능 향상은 RT-10M 재측정 전까지 주장하지 않는다.

## 3. 현재 코드 기준선

- `AvailabilityCorrelationTracker`는 cycle marker, 날짜, 인원, 요청 시각으로 `EXACT/STRONG/WEAK/NONE`을 계산한다.
- `observeAvailabilityBody()`는 body를 기록하지만 제어 경로를 깨우지 않는다.
- `runToggleCycle()`은 목표 날짜 선택 확인 후 최대 25ms 간격으로 `SlotAdapter.readAvailableSlots()`를 호출한다.
- `SlotAdapter.clickSlot()`은 후보 key를 DOM에서 다시 찾아 연결·활성 상태를 확인한다.
- body가 없을 때는 resource watch 상태에 따라 목표 클릭+700ms 또는 arrival+250ms까지 bounded 탐색한다.

## 4. 안전 조건

wake-up 후보는 다음을 모두 만족해야 한다.

1. 현재 활성 toggle cycle과 같은 cycle이다.
2. correlation quality가 `EXACT` 또는 `STRONG`이다.
3. stale 또는 중복 request sequence가 아니다.
4. body에 설정 시간 범위와 일치하는 슬롯이 있다.
5. timing 필드와 sequence가 유효하다.

body는 scan 시점만 앞당긴다. 슬롯 선택, 상태 전이, 클릭 여부는 DOM 결과만 결정한다. wake-up 처리 또는 trace가 실패하면 예외를 삼키고 기존 탐색을 계속한다.

## 5. RT-04 판정

### 40ms switch lead

`SWITCH_LEAD_MS=40`은 목표 날짜 클릭을 40ms 늦추는 대기가 아니다. 인접 날짜 클릭을 목표 클릭 그리드보다 40ms 앞에 배치한다. 이를 줄이면 React가 인접 클릭을 처리하기 전에 target 클릭이 겹칠 수 있고, 실제 오픈 p95 근거도 없다. 이번 작업에서는 유지한다.

### 60ms target selection confirmation

60ms는 슬롯 렌더 상한이 아니라 목표 날짜의 `aria-pressed` 확인 상한이다. 실제 p95 표본이 없어 상한을 유지한다. 클릭 직후 20ms는 인접 클릭 반영이 늦어 기존 `aria-pressed`와 이전 슬롯 DOM이 잠시 남는 경우를 피하는 settling guard다. 단위 테스트에서 즉시 선택 상태를 만들 수 있다는 사실만으로 실제 React DOM의 stale 구간이 없다고 증명할 수 없으므로 20ms도 유지한다.

## 6. 비목표

- body만으로 슬롯 클릭
- API 요청 복제 또는 암호화 요청 생성
- React private state 접근
- 결제, 약관 동의, 최종 예약 자동화
- RT-10M 없이 실제 성능 완료 선언

## 7. 완료 상태 표현

자동 게이트와 비최종 Chrome 검증을 통과해도 상태는 다음으로 기록한다.

> fallback 보존형 구현 완료, RT-10M 재측정 대기

RT-05는 Tier 2-2 최종 종료 전 별도 exit gate로 남긴다.

## 8. 최종 실측과 RT-05

26개 actual-open 실행의 최종 판독은 [70-live-run-analysis](70-live-run-analysis.md), probe 운영 결정은 [80-probe-final-decision](80-probe-final-decision.md)에 기록한다. 실제 오픈 기능과 fallback 안전성은 확인했지만 XHR wake 성능 이득과 공식 p95는 미입증이다.
