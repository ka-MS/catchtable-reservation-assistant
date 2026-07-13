# RT-02 clock sample 설정 계약 설계

## 사용자 계약

고급 설정에는 실제 제어에 영향을 주는 사전 시작과 토글 간격만 표시한다. 시계 품질은 자동 rolling sampler와 estimator가 결정하며 사용자가 측정 횟수를 설정하지 않는다.

## 모델 변경

- `ReservationConfig.clockSampleCount` 제거
- `FormValues.clockSampleCount` 제거
- form parse/apply/read 경로 제거
- `validateReservationConfig()`의 3~9 검증 제거
- Side Panel input과 설명 제거

## 호환 정책

- 과거 저장 객체의 `clockSampleCount` 추가 property는 허용하고 무시한다.
- 과거 draft를 적용할 때 해당 property를 읽지 않는다.
- 과거 scheduled job은 다른 필드가 유효하면 계속 실행한다.
- 새 config와 새 저장 항목에는 해당 property를 쓰지 않는다.
- telemetry event의 `clockSampleCount`는 실제 estimator 표본 수로 유지한다.

schema version 증가는 필요 없다. 필수 필드 추가가 아니라 무효 필드 제거이며 runtime validator가 extra property를 거부하지 않기 때문이다.

## 문서

현재 architecture의 config 모델에서 필드를 제거하고 rolling clock 자동 관리임을 적는다. 과거 실험·worklog 문서는 당시 기록이므로 바꾸지 않는다.
