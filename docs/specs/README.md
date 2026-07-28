# 제품 사양과 완료 패키지

## 현재 기준

- [최종 목표와 개발 흐름](00-goal-and-workflow.md)
- [제품 요구사항](product-requirements.md)
- [Side Panel UI 요구사항](ui-requirements.md)
- [자동화 경계](automation-boundary.md)
- [CatchPay 예약 완주](catchpay-reservation-completion/00-index.md)
- [Run control plane](run-control-plane/20-design.md)

## 사용자 기능

- [자동 진입](nav-pipeline/10-analysis.md)
- [예약 흐름 호환성](reservation-flow-compatibility/reservation-flow-compatibility.md)
- [예약 설정 빠른 동작](reservation-quick-actions/10-design.md)
- [Side Panel UX](sidepanel-ux/20-design.md)
- [예약 작업 스케줄러](scheduler/20-design.md)
- [설정 히스토리·즐겨찾기](saved-configs/10-analysis.md)
- [실행 텔레메트리](run-telemetry/10-analysis.md)
- [실행 진단 bundle](run-diagnostics/run-diagnostics.md)

## 구현 구조

- [오케스트레이터 리팩터링](orchestrator-refactor/10-scope.md)

## 슬롯·후속 화면 호환성

- [후속 화면 복원력](post-slot-resilience/10-analysis.md)
- [복합 좌석·메뉴](seating-menu-sheet/10-analysis.md)
- [예약금 안내 `다음`](deposit-notice-next/10-analysis.md)
- [슬롯 조상 가시성](slot-ancestor-visibility/10-analysis.md)
- [슬롯 전환 결과](slot-transition-outcomes/10-analysis.md)

## 시계·Availability·성능

- [정밀 타이밍 진단](timing-diagnostics/10-analysis.md)
- [단조 서버 시계](monotonic-server-clock/10-analysis.md)
- [시계 표본 설정 계약](clock-sample-setting-contract/10-analysis.md)
- [Availability 사이클 상관](availability-cycle-correlation/10-analysis.md)
- [슬롯 XHR 관찰](xhr-slot-watch/10-analysis-design.md)
- [오픈 타이밍 성능 우산](open-timing-performance/open-timing-performance-analysis.md)
  - [Tier 1 · 기준 시계 신뢰성](open-timing-performance/01-reference-clock-reliability/10-analysis.md)
  - [RT-15 · 기준 시계 원시 표본](open-timing-performance/01-reference-clock-reliability/01-raw-sample-trace/00-index.md)
  - [Tier 2 · Availability 핫패스](open-timing-performance/02-availability-hot-path/10-analysis.md)
  - [RT-14 · EXACT EMPTY 조기 종료](open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/00-index.md)
  - [Tier 3 · 런타임 견고성](open-timing-performance/03-runtime-resilience/10-analysis.md)
  - [RT-16 · 준비 복원력](open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/00-index.md)

스펙이 참조하는 실행 원본은 [Evidence 패키지](../evidence/README.md)에
실행별로 보관합니다. 완료된 패키지의 분석·설계·구현·검증·적대적
리뷰는 당시 결정과 회귀 근거를 보존합니다.
