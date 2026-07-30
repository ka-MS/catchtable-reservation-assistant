# ADR-006: 명시적 진입 모드와 2층 내비게이션

## 상태

승인, 2026-07-11

## 결정

- `ReservationConfig`는 `entryMode: "auto" | "prepared"`를 사용한다.
- `auto`의 탭 이동과 content 재주입은 Background가 담당한다.
- 예약 CTA, 목표 월·날짜·인원 준비와 긴 오픈 대기는 Content Script가 담당한다.
- 이전 `pagePrepared` 저장값은 Side Panel 로드 시 한 번 호환 변환한다.
- 자동 준비가 끝나도 기존 `PREPARING_PAGE` 검증을 생략하지 않는다.

## 이유

- MV3 서비스워커는 장시간 대기를 소유하기에 부적합하지만 탭 이동 뒤 content 재주입은 Background만 안정적으로 수행할 수 있다.
- `pagePrepared`의 의미를 반대로 재사용하면 UI와 검증 코드에서 지속적인 혼동이 생긴다.
- 월 이동과 인원 선택은 실측된 안정 속성이 있으며 DOM Adapter 경계 안에서 구현할 수 있다.

## 안전 조건

- 월 이동 뒤 표시 월이 바뀌기 전에는 같은 이동 버튼을 다시 클릭하지 않는다.
- 목표 날짜 또는 인원이 없으면 임의 대체하지 않고 사용자에게 인계한다.
- 웨이팅·알림·결제·최종 예약 버튼은 진입 Adapter의 검색 대상이 아니다.
