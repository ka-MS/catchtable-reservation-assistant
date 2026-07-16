# RT-15 적대적 검토 — 기준시계 원시 표본 trace

## 결론

정각 hot path에서 전송하지 않고 terminal의 기존 trace flush에 합류시키는 현재 구현을 수용한다. estimator, anchor, armLead와 슬롯 제어에는 변화가 없다.

## 공격 시나리오와 방어

| 시나리오 | 결과 |
|---|---|
| actual arm과 terminal 정리에서 stop이 중복 호출됨 | port 참조를 먼저 비워 stop/drain을 한 번만 수행 |
| arm 전 조기 종료 | terminal 사유로 현재 ring을 drain하고 동일 flush 사용 |
| raw event가 최종 상태를 덮음 | `state=null`로 기록하고 저장소 회귀 테스트로 `finalState`·`finishedAt` 보존 확인 |
| raw event 64건이 운영 로그 100건을 밀어냄 | 상세 조회 200건, 화면 필터 후 최근 운영 이벤트 100건 표시 |
| trace exporter가 throw | 표본별 예외 격리, terminal 결과 유지 |
| sampler drain이 estimate를 무효화 | ring만 비우고 `latest` 유지 |
| 서로 다른 실행 표본 혼입 | RunSession 소유 frozen batch로 한정, 소비 직전 참조 제거 |
| raw 표본이 무제한 증가 | 기존 ring 상한 64 유지 |

## 리뷰 중 확인·수정한 결함

terminal event 뒤 `CLOCK_SAMPLE`에 terminal state를 반복해 싣는 경우 저장소 pruning과 종료 시각 갱신을 불필요하게 반복할 수 있었다. raw event의 `state`를 `null`로 고정하고, FAILED 뒤 raw event를 append해도 최종 상태·종료 시각이 보존되는 저장소 테스트를 추가했다.

새 저장소 테스트가 다음 pruning 테스트와 데이터를 공유하던 격리 문제도 확인해 해당 test run을 종료 시 삭제하도록 수정했다.

## 잔여 위험

1. actual arm 뒤 Content context가 terminal `finally` 전에 강제 종료되면 RunSession 메모리에 동결한 표본은 유실될 수 있다. hot path 전송을 피하기 위해 수용한 trade-off다.
2. `CLOCK_SAMPLE`은 일반 trace queue 정책을 따르므로 queue overflow나 500ms flush timeout에서 일부가 유실될 수 있다. 예약 제어보다 진단 완전성을 낮게 두는 기존 정책을 유지한다.
3. 표본은 서버 풀 스큐를 관측하게 할 뿐 하나의 참 오프셋을 보장하지 않는다. 사후 분석에서도 cluster와 uncertainty를 함께 해석해야 한다.
4. 이번 검증은 자동 저장·표시·export 계약까지다. 실제 HEAD 분포의 사후 재추정 가능성은 다음 live run CSV에서 확인한다.

## 판정

잔여 위험은 진단 전용 데이터의 best-effort 성격과 hot-path 무부하 원칙 안에서 수용 가능하다. RT-15를 `DONE`으로 종료한다.
