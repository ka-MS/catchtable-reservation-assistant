# 네비게이션 파이프라인 설계

**작성:** 2026-07-11 · **상태:** 초안(구현 전 사용자 검토 대기)

## D1. 2층 파이프라인

페이지 이동은 콘텐츠 스크립트가 살아남지 못하므로 층을 나눈다. 단, 실측상 진입 이후는 전부 SPA라 진입·날짜는 콘텐츠 층에 둔다.

```
[세션 층 — background]                 [실행 층 — content script]
navigate → inject(기존 ensureContent)  →  enter_reservation → select_date → 기존 오픈런
```

- background의 `sameRestaurant` 거부를 navigate 단계로 대체한다(다르면 `chrome.tabs.update` + 로드 감지 후 위임).
- 긴 대기(`WAITING_FOR_OPEN`)는 콘텐츠 스크립트에 유지한다.

## D2. 모드 = runUntil 체크포인트 (프레임워크 금지)

범용 파이프라인 엔진·DAG를 만들지 않는다(AGENTS.md 단순함). 선형 흐름에 경계 하나를 둔다.

- `runUntil ∈ { navigated | reservation_open | date_selected | full }`
- 경계 도달 시 mode와 비교해 멈추면 종료. 네 모드가 같은 코드 경로를 지나 중복 구현이 없다.
- "특정 단계부터"는 startAt이 아니라 **단계 멱등성**으로 해결한다. 이미 목표 URL이면 navigate no-op, 이미 모달이 열려 있으면 enter no-op, 이미 목표 날짜 선택이면 select no-op. 어디서 시작하든 각 단계가 "달성됐으면 통과"한다.

## D3. 단계 계약

| 단계 | 층 | 입력 | 성공 | 실패 |
|---|---|---|---|---|
| navigate | background | targetUrl | 탭이 목표 URL + 로드 완료 | FAILED |
| inject | background | tabId | PING ok (기존 `ensureContent`) | FAILED |
| enter_reservation | content | — | 날짜 셀 관측 폴링 성공 | `예약하기` 부재(웨이팅 전용 등) → HANDED_OFF |
| select_date | content | reservationDate | `targetSelected` (기존 inspect 재사용) | HANDED_OFF |
| open_run | content | 기존 config | 기존 그대로 | 기존 그대로 |

- 진입 앵커는 `aside#dock`의 `예약하기` 버튼(텍스트 판별). 가게별 위젯 변형에 의존하지 않는다.
- 진입 성공은 시간이 아니라 날짜 셀 출현 관측으로 판정한다.

## D4. 인터페이스 변경

- `ReservationConfig`에 `runUntil` 추가. 기존 `postSlotEnabled`와의 통합 여부는 **미결**(아래).
- content에 `EntryPort { inspect(): 진입상태, openReservation(): boolean }` 신설 — 기존 포트 패턴 준수.
- 날짜 선택은 기존 `CalendarPort.clickDate` 재사용.
- 상태 추가: `NAVIGATING`, `ENTERING_RESERVATION`, `SELECTING_DATE`. `docs/design/state-machine.md`·사이드패널 라벨·이벤트 포맷 동반 수정.
- `PREPARING_PAGE` 검증은 안전망으로 유지하고 그 앞에 자동 준비 단계를 붙인다.

## 이번 범위 밖 (Out)

결제·개인정보 입력·요청 큐/다중 스케줄러·취소 스나이핑·타 사이트 어댑터·알림. 큐/다중 예약은 세션 층 확장으로 수용 가능한 구조만 확보한다.

## 미결 항목 (설계 확정 시 결정)

- `postSlotEnabled` ↔ `runUntil` 통합 여부. `postSlotEnabled=false`는 사실상 `runUntil=…(슬롯까지)`의 특수형이라 통합 후보.
- navigate 후 하이드레이션 완료 시점을 어떤 신호로 판정할지(콜드 로드 미실측).
- 지원할 URL 입력 형태(공유 단축 링크 등 미실측).
- 워크플로 B UI 검증이 사용자 주도로만 가능한 상황에서 회귀 검증을 어떻게 자동화할지(확장 디버그 출력 추가 검토).
