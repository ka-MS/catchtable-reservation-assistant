# Tier 2 — Availability 핫패스 패키지 분석

**상태:** 2-1/2-2 분할 확정. 2-1 분석 착수, 2-2는 실측 게이트 전 구현 금지.
**우산 분석:** `../open-timing-performance-analysis.md` §4 Tier 2.

## 1. 분할 결정

Tier 2는 관찰과 제어를 한 번에 넣지 않는다.

| 단계 | 목적 | 기존 클릭 경로 변경 |
|---|---|---|
| [Tier 2-1](01-observation-safety/10-analysis.md) | MAIN-world 응답 shadow 관찰, payload 계약·지연·중복/역전 실측, 중재 기반 검증 | 없음 |
| [Tier 2-2](02-control-activation/10-analysis.md) | 검증된 body 신호를 실제 claim/클릭 경로에 연결 | 게이트 통과 시에만 있음 |

이 분할의 이유는 두 가지다.

1. MAIN-world `fetch`/XHR 래핑은 관찰만 해도 사이트 런타임에 들어가는 침습적 변경이다. payload 구조와 transport가 실측되지 않은 상태에서 클릭까지 연결하면 원인 분리가 불가능하다.
2. 현재 액추에이터는 렌더된 슬롯 버튼 클릭이다. body를 먼저 판정해도 버튼이 DOM에 생기기 전에는 클릭할 수 없으므로, **body 감지만으로 responseEnd→DOM 렌더 56~182ms 전체를 제거한다는 기존 가정은 성립하지 않는다.** 제거 가능한 지연은 우선 폴링 간격(현재 최대 25ms)과 후속 토글 방지 비용이며, 더 큰 개선에는 별도의 안전한 pre-DOM 액추에이터가 필요하다.

## 2. 현재 코드 기준선

- `slot-refresh-watch.ts`: ISOLATED world `PerformanceObserver`가 `/dining/time-slots` 완료를 관찰한다. 현재 포트는 callback 시각만 전달하며 `responseEnd`·요청 날짜·body는 전달하지 않는다.
- `orchestrator.ts`: 신호 없음은 기존 그리드, 도착 전은 목표 클릭+700ms 콰이어스, 도착 후는 25ms 간격·최대 250ms DOM 버스트 스캔이다.
- 클릭 후보는 `SlotAdapter.readAvailableSlots()`와 `selectPreferredSlot()`로 DOM에서 다시 검증된다. body나 네트워크 신호만으로 클릭하지 않는다.
- 감지기는 단일 오케스트레이터 루프이므로 현재 중복 클릭 위험은 없다. 다중 detector를 제어 경로에 연결하는 순간 claim guard가 필요하다.
- Tier 1 `ReferenceClock`은 토글 진입 시점만 결정한다. Availability 판정과 분리되어 있으며 Tier 2에서도 이 경계를 유지한다.

## 3. 공통 불변식

- availability 요청은 사이트 UI 토글만 유발한다. 암호화된 요청을 복제하거나 직접 호출하지 않는다.
- 예약 최종 제출·약관·알림·유료 선택 자동화 경계는 바꾸지 않는다.
- body 신호가 없거나 파싱에 실패하면 기존 DOM 경로가 그대로 동작한다.
- shadow 관찰 결과만으로 클릭·토글·상태 전이를 일으키지 않는다.
- 원문 request/response body, 암호화 문자열, 개인정보는 로그나 fixture에 저장하지 않는다.

## 4. 의사결정 게이트

Tier 2-1은 지금 진행할 수 있다. Tier 2-2는 다음 조건을 모두 만족해야 한다.

1. 실제 transport와 `data.timeSlotMap` 변형을 fixture와 교차 매장 관찰로 고정한다.
2. shadow body 판정과 최종 DOM 판정 사이에 false positive가 없다.
3. body 판정→bridge→DOM 후보 출현→기존 클릭의 단조 타임라인을 측정해 실질적인 선행 시간이 확인된다.
4. body 신호를 이용할 액추에이터가 자동화 경계와 DOM 변경 안전성을 해치지 않는다. 안전한 pre-DOM 액추에이터가 없다면 2-2의 범위는 MutationObserver 기반 DOM claim 가속으로 축소하거나 종료한다.
5. 응답 역전·중복·stale 날짜·형식이 잘못된 bridge 입력에서도 런당 claim이 최대 1회임을 테스트로 증명한다.

## 5. 작업 순서

```text
2-1 분석
→ live transport/payload 읽기 전용 정찰
→ 2-1 설계 승인
→ shadow probe·계측·fixture·중재 상태기계 TDD
→ dry-run/연습 실행 비교
→ 실제 오픈 로그 판독
→ 2-2 진입/축소/종료 결정
```

2-1과 2-2는 각각 `분석 → 설계 → 구현 → 검증 → 적대적 리뷰·수정` 산출물을 독립적으로 유지한다.
