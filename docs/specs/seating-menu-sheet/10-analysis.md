# RT-07 야키토리묵 복합 좌석·메뉴 단계 분석

## 저장 trace

IndexedDB의 `run-f2430af0-c4c8-448f-929b-9f2891456935`에서 다음 terminal snapshot을 확인했다.

```text
buttons: 취소 | 확인
dialog label/title: 없음
text: 전체 / 테이블 / 카운터 / 해당 금액은 예약금입니다. / 필수 메인 메뉴 선택
fingerprint: ss-9d69dd31
```

이 실행은 post-slot 단계가 아니라 이미 열린 바텀시트를 entry 화면으로 인식하지 못해 종료됐다.

## live DOM

2026-07-14 야키토리묵, 2026-07-23, 2명, 17:00에서 재현했다.

- `role="presentation"` MUI bottom sheet이며 `role="dialog"`는 없다.
- 좌석 탭은 `전체`, `테이블`, `카운터` 링크다.
- 카드마다 h3 제목과 `role="checkbox"` 메뉴 control이 하나씩 있다.
- 테이블·카운터 카드의 checkbox aria-label은 같은 메뉴명이다.
- 한 카드를 선택한 뒤 `확인`하면 예약 폼으로 이동한다.
- 폼의 예약 정보에 선택 좌석이 표시된다.

## 판정

기존 `table_type`은 좌석 radio만, `menu`는 메뉴 checkbox/수량만 처리한다. 이 화면은 한 checkbox가 좌석과 필수 메뉴를 동시에 선택하므로 둘 중 하나로 위장하면 사용자 선호 하나를 잃는다. 별도 `seating_menu` kind로 모델링한다.
