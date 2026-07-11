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

범용 파이프라인 엔진·DAG를 만들지 않는다(AGENTS.md 단순함). 선형 흐름에 순서형 경계 하나를 둔다.

```ts
type RunUntil =
  | "navigated"          // URL 이동만
  | "reservation_open"   // 예약 모달 진입까지
  | "date_selected"      // 목표 날짜 선택까지
  | "slot_selected"      // 오픈런 루프 실행 + 슬롯 클릭까지 (구 postSlotEnabled=false)
  | "form";              // 후속 단계 진행해 예약 폼 도착까지 (구 postSlotEnabled=true)
```

- 경계 도달 시 설정된 `runUntil`과 비교해 멈추면 종료. 다섯 모드가 같은 코드 경로를 지나 중복 구현이 없다.
- "특정 단계부터"는 startAt이 아니라 **단계 멱등성**으로 해결한다. 이미 목표 URL이면 navigate no-op, 이미 모달이 열려 있으면 enter no-op, 이미 목표 날짜 선택이면 select no-op. 어디서 시작하든 각 단계가 "달성됐으면 통과"한다.

### 통합: 두 boolean → 하나의 순서형 (핵심 결정)

`runUntil`은 기존 두 필드를 흡수한다. 이것이 이 작업의 단순화 이득이다.

| 기존 필드 | 의미 | runUntil로 대체 |
|---|---|---|
| `postSlotEnabled: false` | 슬롯 클릭 후 정지 | `runUntil: "slot_selected"` |
| `postSlotEnabled: true` | 폼까지 진행 | `runUntil: "form"` |
| `pagePrepared: true` | "모달을 수동으로 열어뒀음" 사용자 단언 | `enter_reservation` 단계가 자동화 → 필드 제거 |

- `postSlotEnabled`, `pagePrepared` 두 boolean을 삭제하고 `runUntil` 하나로 대체한다.
- 저장된 구 설정 마이그레이션은 하지 않는다(단일 사용자 개발 도구, 최초 1회 재설정). 사이드패널 로드시 `runUntil` 부재면 기본값 `"form"`을 쓴다.

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

- `ReservationConfig`: `postSlotEnabled: boolean`·`pagePrepared: boolean` 삭제, `runUntil: RunUntil` 추가. `validateReservationConfig`·`form-model`·사이드패널 폼(체크박스 2개 → 셀렉트 1개) 동반 수정.
- content에 `EntryPort { inspect(): 진입상태, openReservation(): boolean }` 신설 — 기존 포트 패턴 준수. 진입 앵커는 `aside#dock`의 `예약하기`(텍스트 판별).
- 날짜 선택은 기존 `CalendarPort.clickDate` 재사용.
- 상태 추가: `NAVIGATING`, `ENTERING_RESERVATION`, `SELECTING_DATE`. `docs/design/state-machine.md`·사이드패널 라벨(`STATE_LABEL`/`STATE_BADGE`)·이벤트 포맷 동반 수정.
- `PREPARING_PAGE` 검증은 안전망으로 유지한다. 자동 진입이 성공하면 이 검증은 통과하고, 실패하면 기존대로 `HANDED_OFF`.

## D5. 미결 항목 결정

- **하이드레이션 시점(콜드 로드):** 별도 타이밍 실측 불필요. background가 `chrome.tabs.onUpdated` status `complete` + 재주입(`ensureContent`) 완료 후 content로 위임하고, `enter_reservation`가 dock `예약하기` 버튼 출현을 폴링한다. 진입 성공은 시간이 아니라 날짜 셀 관측으로 판정하므로 콜드/웜 로드 편차를 관측이 흡수한다.
- **지원 URL 형태:** v1은 매장 상세 경로(`/ct/shop/<slug>`, slug는 가독형·불투명 ID 모두)만 지원한다. `/ct/map/...` 검색 결과나 공유 단축 링크는 범위 밖 — `navigate` 전 검증에서 상세 경로가 아니면 `FAILED`로 명확히 실패시킨다.
- **워크플로 B 회귀 검증:** 사이드패널을 AI가 읽을 수 없으므로(다른 확장 페이지 접근 차단) 확장 UI 검증은 사용자 주도로 남긴다. 자동 회귀는 기존 fixture 기반 단위/통합 테스트로 커버하고, 확장 디버그 출력 추가는 도입하지 않는다(YAGNI).

## 이번 범위 밖 (Out)

결제·개인정보 입력·요청 큐/다중 스케줄러·취소 스나이핑·타 사이트 어댑터·알림. 큐/다중 예약은 세션 층 확장으로 수용 가능한 구조만 확보한다.
