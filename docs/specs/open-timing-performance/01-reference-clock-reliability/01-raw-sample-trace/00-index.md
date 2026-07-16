# RT-15 — 기준시계 원시 표본 trace

**상태:** 구현·자동 검증 완료
**부모:** `../10-analysis.md`

## 목표

`ReferenceClockSampler`가 이미 보유한 bounded 원시 HEAD 표본을 실행 trace에 보존해 사후 시계 추정 재구성과 estimator 오류 분석을 가능하게 한다.

## 문서

1. [분석](10-analysis.md)
2. [설계](20-design.md)
3. [구현 계획](30-implementation.md)
4. [검증](40-verification.md)
5. [적대적 검토](50-adversarial-review.md)

RT-15는 진단 로그 강화다. 실시간 estimator, armLead, 예약 시각과 슬롯 제어를 변경하지 않는다.
