# 2026-07-14 RT-02 clock sample setting contract

## 목표

실행에 반영되지 않는 `clockSampleCount` 사용자 설정을 제거하고 과거 저장 데이터와 실제 시계 telemetry의 호환성을 유지한다.

## 수행

1. `docs/specs/clock-sample-setting-contract/`에 분석·설계·TDD 계획을 작성했다.
2. `ReservationConfig`, form model, validator, Side Panel에서 dead setting을 제거했다.
3. legacy config, history/favorite, scheduled job을 계속 수용하는 회귀 테스트를 추가했다.
4. estimator의 실제 관측 수를 나타내는 trace `clockSampleCount`는 유지했다.
5. 전체 자동 게이트와 Chrome extension reload, 실제 legacy 저장 데이터 로드, console 상태를 검증했다.

## 결과

- 고급 설정은 실제 동작하는 `사전 시작`, `토글 간격`만 노출한다.
- 과거 저장 객체의 추가 property는 실행과 표시를 막지 않는다.
- 폼에서 생성되는 새 config에는 dead setting이 포함되지 않는다.
- 테스트 238/238 통과

## 다음 작업

별도 브랜치에서 RT-06 예약금 안내의 다음 동작 판별과 fixture를 분석한다.
