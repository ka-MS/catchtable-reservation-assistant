# RT-07 복합 좌석·메뉴 단계 검증

## 자동 검증

`npm run check`를 실행했다.

- TypeScript typecheck 통과
- 단위·fixture 테스트 245/245 통과
- dist validation 통과
- MAIN/ISOLATED independence validation 통과

추가된 회귀 검증은 다음을 포함한다.

- `bar` 설정이 `카운터` 카드를 선택한 뒤 다음 반복에서 `확인`함
- `hall` 설정이 `테이블` 카드에 대응함
- 없는 `room` 설정은 클릭하지 않고 blocked 처리함
- 좌석 문구가 없는 일반 필수 메뉴 presentation은 오탐하지 않음
- 오케스트레이터의 선택적 후속 단계 연속 처리에 `seating_menu`가 포함됨

## 저장 trace와 live 검증

- 저장 run `run-f2430af0-c4c8-448f-929b-9f2891456935`의 terminal snapshot에서 `전체/테이블/카운터`, 필수 메인 메뉴, `취소/확인`, fingerprint `ss-9d69dd31`을 확인했다.
- 2026-07-14 야키토리묵에서 같은 화면을 재현해 presentation sheet, 카드별 heading+checkbox, `확인` 진행 구조를 확인했다.
- `카운터` 카드를 선택하고 `확인`한 뒤 예약 폼의 예약 정보가 `카운터`로 표시되는 것을 확인했다.
- 약관, 결제, 최종 예약은 클릭하지 않았다.

## E2E 제한

배포 확장을 통한 전체 자동 흐름은 RT-07 이전 단계에서 중단됐다.

- auto run: 날짜를 클릭한 뒤 `SELECTING_DATE`에서 `목표 날짜가 현재 달력에 없습니다.`로 인계
- prepared run: `PREPARING_PAGE`에서 목표 날짜·인접 날짜 판정 실패로 인계

따라서 RT-07 자체는 live DOM과 수동 전환, 동일 구조 fixture, 배포 빌드 전체 게이트로 검증했다. 위 날짜 준비 판정은 결합형 후속 단계와 독립된 기존 문제이며 RT-07 완료 근거에 포함하지 않는다.
