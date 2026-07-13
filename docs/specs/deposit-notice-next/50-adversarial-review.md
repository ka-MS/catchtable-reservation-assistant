# RT-06 예약금 안내 다음 버튼 적대적 리뷰

## 검토 결과

### 범용 다음 클릭으로 확장될 위험

허용 label은 `deposit_notice` action 내부에만 추가했다. unknown dialog의 `다음`은 분류되지 않으며 action도 blocked다.

### 이전 버튼 오클릭

`이전`은 허용 목록에 없다. exact fixture에서 이전·다음 click count를 각각 검증한다.

### 유료 선택 화면 오인

초기 변경은 exact label을 신뢰해 선택 control이 섞인 변형에서도 진행할 수 있었다. 적대적 리뷰에서 이를 finding으로 확인했다. `advanceDepositNotice()`가 visible radio, checkbox, number input을 발견하면 사용자에게 인계하도록 수정하고 회귀 테스트를 추가했다.

### DOM 경합

기존 click 직전 kind·fingerprint 재검증과 disabled 검사를 그대로 사용한다. 화면이 바뀌면 클릭하지 않고 다시 inspect한다.

## 잔여 위험

- 같은 매장의 진행 문구가 조건에 따라 `확인`과 `다음`으로 달라지는 원인은 서버 정책에서 확인할 수 없다. 두 실측 변형만 지원한다.
- 제목과 aria-label까지 모두 바뀌면 안전하게 unknown으로 인계된다.

## 결론

선택 control 오인 finding을 수정했다. 차단 finding은 남아 있지 않으며 자동 범위는 정보성 예약금 안내의 진행에만 한정된다.
