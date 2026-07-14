# 2026-07-15 RT-10M 누와 실제 오픈 측정

## 결과

- CSV 4개 모두 dropped 0, seq gap 없음
- 로컬 전면 실행: 18:00 슬롯 +893ms dispatch, 예약 폼 +2252ms 인계
- 로컬 최소화 실행: 12:00 슬롯 +1297ms dispatch, 후속 화면 timeout
- 로컬 최소화 장기 실행: 큰 cycle 공백, 일치 슬롯 없음, 사용자 중지
- 신규 PC 4분할 실행: 예약 CTA 미검출로 entry 단계 인계

전면 실행의 최종 예약 성공은 사용자가 확인했다. 확장 trace가 직접 검증한 경계는 예약 폼 인계까지다.

## 판정

실제 오픈에서 fallback 경로의 슬롯 탐색·클릭·폼 인계 기능을 검증했다. body wake는 전면 성공 실행에서 사용되지 않았고 최소화 실행에서는 250ms window 뒤 fallback했다. 성능 이득을 입증하지 못했으므로 hot path 상수는 유지한다.

화면 상태가 주요 운영 변수로 관측됐지만 현 trace에는 visibility·focus·viewport가 없다. 다음 단계는 hot path 튜닝이 아니라 실행 환경 진단과 좁은 viewport CTA 실측이다.

상세 분석: `docs/specs/open-timing-performance/02-availability-hot-path/60-rt10m-nuwa-analysis.md`
