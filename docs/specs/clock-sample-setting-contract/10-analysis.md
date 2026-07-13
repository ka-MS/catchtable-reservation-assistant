# RT-02 clock sample 설정 계약 분석

## 현재 결함

고급 설정의 `시계 표본`은 3~9회 측정값처럼 표시되고 `ReservationConfig.clockSampleCount`에 저장된다. 그러나 현재 ReferenceClock은 첫 bootstrap 표본 뒤 1.75초 주기의 rolling sampler를 계속 실행하며 이 설정을 읽지 않는다.

동일 이름의 trace attribute `clockSampleCount`는 estimator가 실제 사용한 표본 수다. 이는 유효한 진단값이므로 설정 필드와 구분해야 한다.

## 선택지

1. 설정을 sampler buffer나 최소 표본 수에 연결: UI의 "측정 횟수" 의미와 여전히 다르고 시계 알고리즘을 불필요하게 바꾼다.
2. 품질 설정으로 재정의: 새 정책과 검증 근거가 필요해 RT-02 범위를 넘는다.
3. 무효 사용자 설정만 제거: 현재 rolling clock 동작을 그대로 유지하고 거짓 제어만 없앤다.

## 결정

3번을 선택한다. UI, form model, `ReservationConfig`, validator에서 설정 필드를 제거한다. trace의 실제 관측 `clockSampleCount`는 유지한다.

## 저장 호환성

JavaScript 저장 객체의 추가 필드는 구조 검증에서 무시된다. 따라서 과거 `reservationConfig`, `draftForm`, history/favorites, scheduledJobs에 `clockSampleCount`가 있어도 로드·실행을 거부하지 않는다. 폼으로 불러와 새 config를 만들거나 다시 저장하면 해당 legacy 필드는 자연스럽게 빠진다.

## 범위 밖

- ReferenceClock period, buffer, estimator 변경
- trace metric 이름 변경
- 기존 chrome.storage 전체의 즉시 rewrite
