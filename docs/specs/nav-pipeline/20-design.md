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

## D2. 구간별 독립 토글 (runUntil 아님)

파이프라인은 구간으로 나뉘지만, 실행 여부는 **하나의 순서형 멈춤 지점(runUntil)이 아니라 기존 boolean 토글 조합**으로 정한다. 단일 runUntil은 "맨 앞부터 어디까지"라 앞 구간(이동)을 건너뛰는 조합을 표현하지 못하므로 채택하지 않는다.

```
[이동모드] → 슬롯감지 → 슬롯클릭 → [후속→예약폼]
   ↑ 토글        └─── 기본(항상) ───┘      ↑ 토글
```

- **슬롯감지 → 슬롯클릭 = 기본.** 파이프라인 구분일 뿐 별도 토글이 없다.
- **이동모드 = 이번 개발 대상.** `url이동 → 예약창열기 → 날짜선택 → 인원선택`을 하나로 묶은 선택 구간. 이번 범위에서는 통째로 on/off (내부 세부 멈춤 없음).
- **후속선택 자동진행(폼) = 기존 토글** 그대로.
- 안전점검(dry-run)은 별개 안전장치로 유지한다.

### 기존 두 체크박스가 이미 토글이다 (새 설정 없음)

이번 작업은 설정 필드를 늘리지 않는다. 기존 사이드패널 체크박스 두 개가 그대로 구간 토글이다.

| 기존 체크박스 (config 필드) | 의미 | 이번 작업에서의 역할 |
|---|---|---|
| `pagePrepared` "페이지에서 예약 모달과 인원을 준비했습니다" | 지금은 수동 준비 단언(필수) | **이동모드 on/off 스위치.** 해제 = 이동모드 실행(자동 이동·진입·날짜·인원), 체크 = 이동 건너뛰기(이미 준비됨) |
| `postSlotEnabled` "후속 선택 자동 진행" | 슬롯 클릭 후 폼까지 진행 여부 | 변경 없음 |

- `pagePrepared`는 **삭제하지 않는다.** 의미가 "수동으로 준비했다"에서 "이동을 건너뛴다"로 확장될 뿐이다.
- 지금 `pagePrepared`는 `required`(필수 체크)지만, 이제 **해제도 유효한 선택**(자동 이동)이므로 그 제약을 푼다.
- 조합 제약: 폼 진행은 슬롯클릭을 전제한다(안전점검 dry-run이면 폼 진행 불가).

## D3. 단계 계약 (이동모드 = `pagePrepared` 해제 시)

| 단계 | 층 | 입력 | 성공 | 실패 |
|---|---|---|---|---|
| navigate | background | targetUrl | 탭이 목표 URL + 로드 완료 | FAILED |
| inject | background | tabId | PING ok (기존 `ensureContent`) | FAILED |
| enter_reservation | content | — | 날짜 셀 관측 폴링 성공 | `예약하기` 부재(웨이팅 전용 등) → HANDED_OFF |
| select_date | content | reservationDate | `targetSelected` (기존 inspect 재사용) | HANDED_OFF |
| select_person | content | personCount | `input[name=personCount]:checked`.value === personCount | HANDED_OFF |
| (기존 오픈런) | content | 기존 config | 기존 그대로 | 기존 그대로 |

- `pagePrepared` 체크 시 위 4단계를 건너뛰고 기존 `PREPARING_PAGE`부터 시작(현행 동작).
- 진입 앵커는 `aside#dock`의 `예약하기` 버튼(텍스트 판별). 가게별 위젯 변형에 의존하지 않는다.
- 진입 성공은 시간이 아니라 날짜 셀 출현 관측으로 판정한다.
- **`select_person` 실측 완료**(site-behavior §5.1): 앵커 `input[type="radio"][name="personCount"][value="<N>"]`(label 래핑), 상태 `input.checked`. 기본 `2명`이라 `personCount=2`는 무동작. 복제 노드가 많으므로 visible 스코핑 + value 중복 제거 필요. 표시 상한 초과 값은 대상 매장에서 확인.

## D4. 인터페이스 변경

- **`ReservationConfig` 필드 변경 없음.** `postSlotEnabled`·`pagePrepared` 유지, 새 필드 없음. `pagePrepared`의 `required` 제약만 해제.
- content에 `EntryPort { inspect(): 진입상태, openReservation(): boolean }` 신설 — 기존 포트 패턴 준수. 진입 앵커는 `aside#dock`의 `예약하기`(텍스트 판별).
- 날짜 선택은 기존 `CalendarPort.clickDate` 재사용.
- 상태 추가: `NAVIGATING`, `ENTERING_RESERVATION`, `SELECTING_DATE`(인원 포함 여부는 select_person 실측 후 결정). `docs/design/state-machine.md`·사이드패널 라벨(`STATE_LABEL`/`STATE_BADGE`)·이벤트 포맷 동반 수정.
- `PREPARING_PAGE` 검증은 안전망으로 유지한다. 자동 진입이 성공하면 이 검증은 통과하고, 실패하면 기존대로 `HANDED_OFF`.
- 사이드패널: `pagePrepared` 체크박스 라벨을 이동모드 의미가 드러나게 다듬는다(예: 해제 시 자동 이동함을 명시). 체크박스 자체는 유지.

## D5. 미결 항목 결정

- **하이드레이션 시점(콜드 로드):** 별도 타이밍 실측 불필요. background가 `chrome.tabs.onUpdated` status `complete` + 재주입(`ensureContent`) 완료 후 content로 위임하고, `enter_reservation`가 dock `예약하기` 버튼 출현을 폴링한다. 진입 성공은 시간이 아니라 날짜 셀 관측으로 판정하므로 콜드/웜 로드 편차를 관측이 흡수한다.
- **지원 URL 형태:** v1은 매장 상세 경로(`/ct/shop/<slug>`, slug는 가독형·불투명 ID 모두)만 지원한다. `/ct/map/...` 검색 결과나 공유 단축 링크는 범위 밖 — `navigate` 전 검증에서 상세 경로가 아니면 `FAILED`로 명확히 실패시킨다.
- **워크플로 B 회귀 검증:** 사이드패널을 AI가 읽을 수 없으므로(다른 확장 페이지 접근 차단) 확장 UI 검증은 사용자 주도로 남긴다. 자동 회귀는 기존 fixture 기반 단위/통합 테스트로 커버하고, 확장 디버그 출력 추가는 도입하지 않는다(YAGNI).

## 이번 범위 밖 (Out)

결제·개인정보 입력·요청 큐/다중 스케줄러·취소 스나이핑·타 사이트 어댑터·알림. 큐/다중 예약은 세션 층 확장으로 수용 가능한 구조만 확보한다.
