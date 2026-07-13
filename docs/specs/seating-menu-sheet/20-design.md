# RT-07 복합 좌석·메뉴 단계 설계

## 판별

`findSeatingMenuSheet()`는 visible `role=presentation` 중 다음 증거를 모두 가진 sheet만 반환한다.

- `role=checkbox` + `aria-label` control
- control별 단일 카드 안의 heading
- `확인` 버튼
- `[필수] 메인 메뉴` 안내 문구

inspection은 `kind=seating_menu`, `certainty=supported`, `strategy=seating-menu-sheet-v1`을 반환한다.

## 선택

카드 heading과 checkbox aria-label을 함께 사용한다.

| 설정 | 카드 좌석 문구 |
|---|---|
| 아무거나 | 기선택 항목 또는 첫 enabled 항목 |
| 홀 | `홀` 또는 `테이블` |
| 바 | `바` 또는 `카운터` |
| 룸 | `룸` |

메뉴 키워드가 있으면 같은 카드의 heading 또는 checkbox aria-label에도 일치해야 한다. 다른 카드가 선택돼 있으면 먼저 해제하고, 목표를 선택한 다음 별도 반복에서 `확인`한다.

## 안전 경계

- `확인`만 진행 버튼으로 허용한다.
- click 직전 kind·fingerprint를 재검증한다.
- disabled control은 후보에서 제외한다.
- 조건과 일치하는 카드가 없으면 blocked 인계한다.
- 예약 폼에서 기존 정책대로 멈추며 약관·결제·최종 예약을 건드리지 않는다.
