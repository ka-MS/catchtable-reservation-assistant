# RT-02 clock sample setting contract 적대적 리뷰

## 검토 결과

### 같은 이름의 telemetry 훼손 가능성

`clockSampleCount` 검색 결과 실행 코드에는 `orchestrator.ts`의 실제 estimate 기록과 trace viewer 판독만 남았다. 사용자 설정 제거가 진단 metric 제거로 번지지 않았다.

### legacy 저장 데이터 거부 가능성

config validator는 알려진 필드만 검증하고 추가 property를 금지하지 않는다. history/favorite와 scheduled job sanitizer도 같은 validator를 사용한다. 자동 테스트와 실제 Chrome 저장 데이터로 모두 확인했다.

### eager migration 위험

기존 저장 객체를 일괄 재작성하지 않는다. 읽을 때 추가 property를 무시하고 사용자가 폼에서 새 config를 만들 때만 자연스럽게 제거한다. 따라서 예약 작업의 다른 필드를 불필요하게 변환하지 않는다.

### 시계 동작 변경 가능성

ReferenceClock rolling sampler, estimator, 재보정 시점은 변경하지 않았다. RT-02는 UI·설정 계약만 정리한다.

## 잔여 위험

- 오래된 설계·worklog에는 당시 `clockSampleCount` 설정 설명이 역사 기록으로 남아 있다. 현재 계약은 architecture와 본 spec을 기준으로 한다.
- future schema가 추가 property를 금지하는 strict parser로 바뀌면 명시적 legacy migration이 필요하다.

## 결론

차단 finding 없음. 변경은 dead setting 제거에 한정되고, 실제 시계 계측과 과거 저장 데이터의 실행 가능성은 유지된다.
