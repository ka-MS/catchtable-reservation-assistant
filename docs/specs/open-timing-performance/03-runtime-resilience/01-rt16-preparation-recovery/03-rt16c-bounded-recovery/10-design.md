# RT-16C 설계 — 준비 단계 bounded recovery

## 정책

| 단계 | 성공 후조건 | 복구 | 상한 |
|---|---|---|---:|
| 예약 CTA | 달력 셀 출현 | CTA 재해석·재클릭 | dispatch 2회 |
| 날짜 | 목표 날짜 selected | 같은 날짜 재해석·재클릭 | dispatch 2회 |
| 인원 | 목표 radio checked | 같은 인원 재해석·재클릭 | dispatch 2회 |

모든 대기는 기존 `stopAt`을 넘지 않는다. dispatch가 단계 deadline 근처에 일어나도 짧은 확인 budget을 갖되 무제한 연장하지 않는다.

## 분류

- `ENTRY_TRANSITION_STALLED`
- `DATE_SELECTION_STALLED`
- `PERSON_SELECTION_STALLED`
- `DOM_CONTRACT_CHANGED` 또는 기존 blocked 판정
- 인증·대기열·알 수 없는 화면은 반복하지 않고 handoff

## 비범위

- 자동 새로고침
- 탭 강제 focus
- Service Worker reconcile
- Tier 2 날짜 토글 cadence와 슬롯 claim
