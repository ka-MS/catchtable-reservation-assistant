# Tier 2-2 - 구현 계획

## 1. TDD 순서

### Task 1 - wake coordinator

실패 테스트를 먼저 작성한다.

- EXACT/STRONG 현재 cycle 수용
- WEAK/NONE 거부
- stale, duplicate sequence, 이전 cycle 거부
- matching slot 없음과 malformed timing 거부
- body가 fallback sleep을 즉시 깨움
- cycle 종료 후 pending signal 폐기

구현 파일:

- `src/content/availability-dom-wake.ts`
- `tests/availability-dom-wake.test.mjs`

### Task 2 - orchestrator 연결

- target cycle 등록 시 coordinator를 arm한다.
- body correlation 뒤 `offer()` 결과를 구조화 trace에 추가한다.
- DOM scan loop가 pending signal 또는 비동기 wake를 소비한다.
- body burst 동안 10ms, 그 외에는 기존 25ms를 사용한다.
- 후보는 기존 `SlotAdapter` 경로로만 반환·재검증한다.

오케스트레이터 테스트:

- EXACT/STRONG wake 후 DOM 발견
- WEAK/NONE, 날짜·인원 불일치, 이전 cycle은 baseline과 동일
- body 선행/DOM 선행
- wake 후 후보 없음 -> 다음 토글
- click 직전 후보 소실 -> 탐색 재개
- body 없음 -> 기존 fallback 성공
- malformed event와 observer/probe 예외 -> baseline 결과 유지
- dry-run 클릭 0회

### Task 3 - RT-04

- 20ms settling 뒤 즉시 selected인 경우 추가 지연 없이 scan하는 회귀 테스트를 유지한다.
- 늦은 selection은 기존 10ms polling과 60ms 상한을 지킨다.
- 20ms, 40ms, 60ms는 실제 p95와 stale DOM 부재 근거가 없어 변경하지 않는다.

### Task 4 - 자동 검증

```bash
npm run check
```

- typecheck
- 전체 test
- dist validation
- MAIN/ISOLATED independence validation

### Task 5 - live와 적대적 리뷰

- extension id, version, load path 확인
- 확장 재로드
- 실제 매장에서 최종 예약을 발생시키지 않는 dry-run 또는 비최종 실행
- live trace에서 body 경로 부재 시 fallback 유지 확인
- 결제·약관·최종 예약 클릭 0회 확인
- finding 수정 후 전체 게이트 재실행

live 검증에서 예약 drawer의 실제 슬롯이 `main` 밖 portal에 있고 배경 복제본만 `main` 아래에 있는 사례가 발견되면, 해당 구조를 fixture로 고정한 뒤 `SlotAdapter`의 가시 후보 범위만 수정한다. body 또는 로그 데이터를 클릭 근거로 사용하지 않는다.

## 2. 완료 판정

코드·자동 검증·비최종 live 검증이 끝나도 RT-10M 표본 전에는 성능 완료로 판정하지 않는다. 문서 상태는 `fallback 보존형 구현 완료, RT-10M 재측정 대기`로 기록한다.
