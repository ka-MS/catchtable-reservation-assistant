# 2026-07-11 후속 단계 전환 오판 수정 작업 로그

## 문제

실제 오픈런 실행에서 테이블 타입 `다음` 클릭 성공 약 43ms 뒤 `설정한 테이블 타입을 선택할 수 없습니다`로 인계됐다. 사이트는 정상적으로 다음 화면(추가 상품)으로 진행했으므로 인계는 오판이었다.

## 실측 (하오카오스탠)

확장과 동일한 `activeDialog`/`enabledChoices` 판정을 페이지에 주입하고 15ms 폴링으로 전환 순간을 계측했다.

```text
t=49ms   다음 클릭
t=65ms   모든 label[role="radio"]에 aria-disabled="true" (dialog는 계속 렌더, aria-checked 유지)
t=193ms  테이블 dialog DOM 제거, 다음 dialog 활성
```

추가로 유료 `예약금 안내` dialog(`aria-modal="true"`, 버튼 `이전`/`확인`)와 당일 예약 확인 dialog(`오늘 방문이 맞으신가요?`)를 실측해 `docs/analysis/site-behavior.md`에 기록했다. 실측 중 예약을 확정하거나 결제 단계로 진입하지 않았다.

## 수정

1. `advanceTable`/`advanceMenu`: 활성 선택지가 0개면 `blocked` 대신 `waiting`으로 전환 중 재시도. 활성 선택지가 있는데 설정과 불일치할 때만 `blocked`.
2. `advanceDeposit`: `예약금 0원 결제` 라디오가 비활성이면 `waiting`, 라디오 자체가 없으면 기존대로 `blocked`.
3. `예약금 안내` dialog 지원 추가: `deposit_notice` 판정 후 활성화된 `확인` 클릭으로 진행. 결제 실행이 아니며 예약 폼 인계 경계는 그대로다.

`waiting`은 오케스트레이터의 후속 단계 5초 제한 안에서만 재시도하므로 무기한 대기는 없다.

## 검증

- 실패 테스트 4개를 먼저 작성해 RED 확인 후 구현했다.
- `npm run check` 전체 통과.
