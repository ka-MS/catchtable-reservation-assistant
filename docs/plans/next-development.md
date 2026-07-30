# 후속 개발 후보

**갱신일:** 2026-07-28

현재 기능 완료 상태에서 남은 항목은 모두 non-blocking이다. 실제 착수
순서는 HANDOFF와 backlog에서 선택하고, 기능 구현 전 별도 spec의
분석·설계 gate를 거친다.

## 1. Availability 성능 근거

- RT-11: 동질 actual-open 표본으로 공식 p95와 wake counterfactual
  측정
- RT-12: legacy가 아닌 현재 probe-off 구성의 actual-open 확인 표본
- RT-13: `inactive_cycle` 기회비용과 수락 완화 가능성 분석

성능 이득과 요청 증가량이 측정되기 전에는 polling·burst 상수나
신호 구조를 추측으로 바꾸지 않는다.

기준:
`docs/specs/open-timing-performance/02-availability-hot-path/70-live-run-analysis.md`,
`docs/backlog/post-tier2-1-stabilization.md`

## 2. ExecutionPhase control plane

Run control plane Phase 1·2는 준비 단계와 RESET_PAGE 복구까지
완료했다. 슬롯 선택 이후의 세부 실패 원인과 복구 정책은 공식 p95
하네스와 실제 사례를 확보한 뒤 별도 Phase 3으로 분석한다.

결제·submit claim 뒤에는 자동 RESET·재제출을 허용하지 않는 현재
결과 불명 정책을 유지한다.

## 3. 사전 점검

실행 전에 로그인, 예약 CTA, 목표 날짜·인원, 토글 가능한 인접 날짜와
서버 시계 측정 가능 여부를 읽기 전용으로 확인하는 기능이다.

사이트 요청을 늘리거나 실제 예약창을 임의 클릭하지 않는 범위와
예약 작업 실행 시점의 stale 판정을 먼저 설계해야 한다.

## 4. DOM drift 대응

- 개인정보 없는 unknown 진단을 fixture 후보로 변환
- adapter fingerprint 변화 판독
- 매장별 변형을 일반 계약으로 승격하기 위한 교차 실측 기준

진단 원본을 자동으로 코드·fixture로 변환하지 않는다. 실측 검토와
selector 승인 절차를 유지한다.

## 5. 취소 자리 감시

- 별도 `CANCELLATION` 실행 모드
- 30초 이상의 제한된 감시 간격
- 기간·종료 조건·일일 실행 시간 명시
- 슬롯 발견 뒤 기존 선택·후속 파이프라인 재사용

현재 오픈런의 25ms polling이나 날짜 토글을 장시간 감시에 그대로
사용하지 않는다.

## 완료된 기반

예약 작업·스케줄러, 저장 설정, 실행 telemetry·진단, 예약 흐름
호환성, run control plane과 CatchPay 예약 완주는 완료 spec과
worklog에서 관리한다. 이 문서에는 완료 기능의 상세 이력을 다시
복사하지 않는다.
