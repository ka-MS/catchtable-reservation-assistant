# 네비게이션 파이프라인 설계

**작성:** 2026-07-11 · **상태:** 승인(구현 기준)

## D1. 2층 파이프라인

페이지 이동은 콘텐츠 스크립트가 살아남지 못하므로 층을 나눈다. 단, 실측상 진입 이후는 전부 SPA라 진입·날짜는 콘텐츠 층에 둔다.

```
[세션 층 — background]                 [실행 층 — content script]
navigate → inject(기존 ensureContent)  →  enter_reservation → select_date → 기존 오픈런
```

- background의 `sameRestaurant` 거부를 navigate 단계로 대체한다(다르면 `chrome.tabs.update` + 로드 감지 후 위임).
- 긴 대기(`WAITING_FOR_OPEN`)는 콘텐츠 스크립트에 유지한다.

## D2. 명시적 진입 모드와 후속 토글

파이프라인은 구간으로 나뉘지만, 실행 여부는 하나의 순서형 멈춤 지점(runUntil)이 아니라 명시적 진입 모드와 기존 후속 진행 토글로 정한다. 단일 runUntil은 "맨 앞부터 어디까지"라 앞 구간을 건너뛰는 조합을 표현하지 못하므로 채택하지 않는다.

```
[이동모드] → 슬롯감지 → 슬롯클릭 → [후속→예약폼]
   ↑ 토글        └─── 기본(항상) ───┘      ↑ 토글
```

- **슬롯감지 → 슬롯클릭 = 기본.** 파이프라인 구분일 뿐 별도 토글이 없다.
- **자동 준비 = 이번 개발 대상.** `url이동 → 예약창열기 → 날짜선택 → 인원선택`을 하나로 묶은 선택 구간. 이번 범위에서는 통째로 on/off (내부 세부 멈춤 없음).
- **후속선택 자동진행(폼) = 기존 토글** 그대로.
- 안전점검(dry-run)은 별개 안전장치로 유지한다.

`pagePrepared`의 boolean 의미를 뒤집어 재사용하지 않는다. `entryMode: "auto" | "prepared"`를 도입한다.

| 설정 | 의미 |
|---|---|
| `entryMode=auto` | 목표 URL 이동, 예약창 진입, 목표 월·날짜·인원 자동 준비 |
| `entryMode=prepared` | 사용자가 현재 탭에서 모달·날짜·인원을 준비했으며 자동 진입 생략 |
| `postSlotEnabled` | 슬롯 클릭 후 폼까지 후속 선택 진행 여부(기존 유지) |

- 이전 저장 데이터의 `pagePrepared=true`는 `prepared`, `false`는 `auto`로 읽는다. 새 저장부터 `entryMode`만 기록한다.
- 조합 제약: 폼 진행은 슬롯클릭을 전제한다(안전점검 dry-run이면 폼 진행 불가).

## D3. 단계 계약 (`entryMode=auto`)

| 단계 | 층 | 입력 | 성공 | 실패 |
|---|---|---|---|---|
| navigate | background | targetUrl | 탭이 목표 URL + 로드 완료 | FAILED |
| inject | background | tabId | PING ok (기존 `ensureContent`) | FAILED |
| enter_reservation | content | — | 날짜 셀 관측 폴링 성공 | `예약하기` 부재(웨이팅 전용 등) → HANDED_OFF |
| select_date | content | reservationDate | 목표 월 이동 후 `targetSelected` | HANDED_OFF |
| select_person | content | personCount | `input[name=personCount]:checked`.value === personCount | HANDED_OFF |
| (기존 오픈런) | content | 기존 config | 기존 그대로 | 기존 그대로 |

- `entryMode=prepared`면 위 4단계를 건너뛰고 기존 `PREPARING_PAGE`부터 시작한다.
- 진입 앵커는 `aside#dock`의 `예약하기` 버튼(텍스트 판별). 가게별 위젯 변형에 의존하지 않는다.
- 진입 성공은 시간이 아니라 날짜 셀 출현 관측으로 판정한다.
- 목표 월 이동은 표시 월 텍스트가 실제로 달라질 때까지 다음 클릭을 금지한다. 목표 날짜가 렌더됐지만 disabled면 인계한다.
- **`select_person` 실측 완료**(site-behavior §5.1): 앵커 `input[type="radio"][name="personCount"][value="<N>"]`(label 래핑), 상태 `input.checked`. 기본 `2명`이라 `personCount=2`는 무동작. hidden 노드는 제외하고 `value` 중복을 방어적으로 제거한다.

## D4. 인터페이스 변경

- `ReservationConfig`에서 `pagePrepared`를 제거하고 `entryMode`를 추가한다. Side Panel 로드 시 구 저장 형식만 변환한다.
- content에 `EntryPort { inspect(): 진입상태, openReservation(): boolean }` 신설 — 기존 포트 패턴 준수. 진입 앵커는 `aside#dock`의 `예약하기`(텍스트 판별).
- 날짜 정밀 토글은 기존 `CalendarPort.clickDate`를 유지하고, 준비용 목표 월·날짜 선택 계약을 추가한다.
- content에 `PersonPort { inspect(personCount), select(personCount) }`를 신설한다.
- 상태 추가: `NAVIGATING`, `ENTERING_RESERVATION`, `SELECTING_DATE`, `SELECTING_PERSON`. `docs/architecture/state-machine.md`·사이드패널 라벨(`STATE_LABEL`/`STATE_BADGE`)·이벤트 포맷 동반 수정.
- `PREPARING_PAGE` 검증은 안전망으로 유지한다. 자동 진입이 성공하면 이 검증은 통과하고, 실패하면 기존대로 `HANDED_OFF`.
- 사이드패널: `자동 준비`와 `현재 페이지 사용`을 명시적으로 선택하는 `entryMode` 입력을 제공한다.

## D5. 미결 항목 결정

- **하이드레이션 시점(콜드 로드):** 별도 타이밍 실측 불필요. background가 `chrome.tabs.onUpdated` status `complete` + 재주입(`ensureContent`) 완료 후 content로 위임하고, `enter_reservation`가 dock `예약하기` 버튼 출현을 폴링한다. 진입 성공은 시간이 아니라 날짜 셀 관측으로 판정하므로 콜드/웜 로드 편차를 관측이 흡수한다.
- **지원 URL 형태:** v1은 매장 상세 경로(`/ct/shop/<slug>`, slug는 가독형·불투명 ID 모두)만 지원한다. `/ct/map/...` 검색 결과나 공유 단축 링크는 범위 밖 — `navigate` 전 검증에서 상세 경로가 아니면 `FAILED`로 명확히 실패시킨다.
- **워크플로 B 회귀 검증:** fixture 기반 단위·통합 테스트 뒤 Chrome DevTools MCP로 `dist` 확장을 새로고침하고 Side Panel 입력·상태·로그, Background 탭 이동, extension IndexedDB의 run/event를 E2E 검증한다. 별도 확장 디버그 출력은 추가하지 않고 기존 UI 로그와 telemetry를 근거로 사용한다.

## 이번 범위 밖 (Out)

결제·개인정보 입력·요청 큐/다중 스케줄러·취소 스나이핑·타 사이트 어댑터·알림. 큐/다중 예약은 세션 층 확장으로 수용 가능한 구조만 확보한다.
