# 2026-07-11 후속 화면 DOM 복원력 작업 로그

## 목표

Catchtable 후속 dialog의 작은 접근성 라벨 변경은 계속 처리하고, 모호하거나 구조가 바뀐 화면은 클릭하지 않고 진단 정보와 함께 사용자에게 인계한다.

## 구현

- visible dialog에서 허용된 제목·버튼·control 개수만 추출하는 `PostSlotInspection` 모듈을 추가했다.
- 정확 aria-label을 우선하고 제목과 단계 고유 구조를 함께 만족하는 fallback classifier를 추가했다.
- 모든 inspection에 certainty, strategy, evidence, fingerprint와 제한된 diagnostics를 첨부했다.
- 행동 직전에 kind와 fingerprint를 재검증해 stale inspection의 클릭을 차단했다.
- hidden control을 판별과 행동에서 제외하고 0원 예약금의 설명형 라벨을 제한적으로 허용했다.
- unknown 진단을 실행 이벤트와 Side Panel 기록에 표시한다.

## 안전 경계

입력값, body text, 전체 HTML은 수집하지 않는다. 유료 전용 예약금, 약관, 최종 예약은 자동 진행하지 않는다. 폼 프로모션 문구는 추가 DOM 실측 전까지 정확 `확인했어요`만 허용한다.

## 검증

신규 기능과 적대적 리뷰 테스트를 RED/GREEN으로 추가했다. 전체 기준은 78 tests, dist 검증, 독립성 검사다.
