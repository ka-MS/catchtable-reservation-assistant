# RT-10 cycle correlation 적대적 리뷰

## 검토 결과

### cycle 경계

body는 등록된 target cycle의 날짜·인원·monotonic 클릭 시각과 일치할 때만 `EXACT`가 된다. marker가 없을 때도 날짜·인원이 같고 허용 창에 cycle이 하나뿐인 경우만 `STRONG`이다. `WEAK`, `NONE`은 cycle record의 body로 저장하지 않는다.

### stale·교차 cycle 오염

tracker는 최근 12개 cycle만 보관하고 cycle별 최신 request sequence만 유지한다. run-global 최신 body와 최초 claim은 오케스트레이터에서 제거됐다. DOM 비교는 전달된 현재 cycle record만 조회한다.

### 제어 독립성

marker는 target click 직전에 await 없이 best-effort로 전송한다. MAIN probe, bridge, mutation watch, correlation, trace의 예외는 모두 제어 경로로 전파되지 않는다. body 후보는 click·토글 중단·deadline 변경에 사용하지 않는다.

### 계측 비용

mutation observer는 실행 시작부터가 아니라 정밀 슬롯 탐색 진입 시점에만 시작한다. callback은 DOM 조회나 trace를 수행하지 않고 generation 증가와 `performance.now()` 저장만 한다. target click·DOM 후보 시점에 snapshot을 읽는다.

## 수정한 finding

### DOM 선행 경합

초기 구현은 DOM 후보가 MAIN bridge 이벤트보다 먼저 관측되면 `NONE` compare만 남기고, 뒤늦은 동일 cycle body와 다시 결합하지 않았다. cycle record에 마지막 DOM 관측을 보관하고 accepted body가 나중에 도착하면 `dom_compare_late`를 생성하도록 수정했다. 순서 역전 테스트를 추가했다.

### 불필요한 observer 수명

초기 구현은 설정 검증과 서버 시계 대기 중에도 document subtree를 관측했다. 슬롯 탐색 진입 시 시작하도록 이동해 관측 범위를 필요한 구간으로 줄였다.

## 잔여 위험

- 실제 오픈 `EXACT/STRONG` 양성 표본은 아직 없다. correlation 계약은 검증됐지만 실환경 성능 분포는 미확정이다.
- MAIN world XHR wrapper는 진단 전용으로 유지된다. 최종 운영 정책은 RT-05에서 결정한다.
- Catchtable가 요청 경로·identity header를 바꾸면 event는 안전하게 `NONE` 또는 미관측이 되지만 측정 기능은 약화된다.
- 전체 subtree의 class/style mutation이 많은 화면에서는 observer callback 빈도가 높아질 수 있다. callback은 상수 시간이며 제어 결과와 분리했지만 실오픈 profile은 RT-10M에서 확인한다.
- 기존 calendar adapter의 중복 날짜 판별 문제로 live target cycle 진입이 막혔다. RT-10 범위에서 selector를 추측해 수정하지 않았다.

## 결론

차단 finding 없음. 리뷰에서 발견한 순서 경합과 불필요한 observer 수명을 수정했고 전체 게이트를 다시 통과했다. RT-10 구현은 완료하되 실제 오픈 성능 결론은 RT-10M 전까지 보류한다.
