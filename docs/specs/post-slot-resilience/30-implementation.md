# 후속 화면 복원력 구현 계획

1. 안전한 `DialogSnapshot` 추출과 fingerprint를 추가한다.
2. 기존 정확 라벨 판별을 유지하면서 제목+구조 fallback classifier를 추가한다.
3. 모든 inspection에 certainty, strategy, evidence, fingerprint, 제한된 diagnostics를 첨부한다.
4. `advance()`가 행동 직전에 현재 inspection의 kind와 fingerprint를 재검증한다.
5. orchestrator 실행 기록에 strategy, certainty, fingerprint와 unknown diagnostics를 기록한다.
6. 기존 fixture 동작과 click 횟수를 보존한다.

각 항목은 실패 테스트를 먼저 추가한 뒤 최소 구현한다.

## 구현 결과

- `post-slot-inspection.ts`에 snapshot, visible dialog/control 필터, classifier, fingerprint를 분리했다.
- 정확 `aria-label` 경로는 `aria-label-v1`으로 보존했다.
- 제목과 control 구조 fallback은 단계별 `*-title-structure-v1` 전략으로 추가했다.
- `advance()`는 현재 kind와 fingerprint가 기존 inspection과 다르면 `waiting`으로 반환한다.
- unknown 진단은 primitive 실행 이벤트 데이터로 변환되어 storage와 Side Panel 기록에 남는다.
- 예약금 0원 control은 `예약금`, `0원`, `결제`를 모두 포함하는 radio 라벨만 허용한다.
