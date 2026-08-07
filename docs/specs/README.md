# 제품 사양과 완료 패키지

## 현재 기준

- [최종 목표와 개발 흐름](00-goal-and-workflow.md)
- [제품 요구사항](product-requirements.md)
- [Side Panel UI 요구사항](ui-requirements.md)
- [자동화 경계](automation-boundary.md)
- [CatchPay 예약 완주](catchpay-reservation-completion/00-index.md)
- [Run control plane](run-control-plane/20-design.md)

## 패키지 카탈로그

| ID / 계층 | 최초 추가일 | 영역 | 상태 | 작업명 | 패키지 |
|---|---|---|---|---|---|
| SP-001 | 2026-07-11 | 슬롯·후속 | 완료 | 후속 화면 복원력 | [post-slot-resilience/10-analysis.md](post-slot-resilience/10-analysis.md) |
| SP-002 | 2026-07-11 | 예약 흐름 | 완료 | 자동 진입 | [nav-pipeline/10-analysis.md](nav-pipeline/10-analysis.md) |
| SP-003 | 2026-07-11 | UI·운영 | 완료 | 설정 히스토리·즐겨찾기 | [saved-configs/10-analysis.md](saved-configs/10-analysis.md) |
| SP-004 | 2026-07-11 | 관측·진단 | 완료 | 정밀 타이밍 진단 | [timing-diagnostics/10-analysis.md](timing-diagnostics/10-analysis.md) |
| SP-005 | 2026-07-11 | 타이밍·Availability | 완료 | 단조 서버 시계 | [monotonic-server-clock/10-analysis.md](monotonic-server-clock/10-analysis.md) |
| SP-006 | 2026-07-11 | UI·운영 | 완료 | 예약 작업 스케줄러 | [scheduler/20-design.md](scheduler/20-design.md) |
| SP-007 | 2026-07-12 | UI·운영 | 완료 | Side Panel UX | [sidepanel-ux/20-design.md](sidepanel-ux/20-design.md) |
| SP-008 | 2026-07-12 | 관측·진단 | 완료 | 실행 텔레메트리 | [run-telemetry/10-analysis.md](run-telemetry/10-analysis.md) |
| SP-009 | 2026-07-12 | 실행 구조 | 완료 | 오케스트레이터 리팩터링 | [orchestrator-refactor/10-scope.md](orchestrator-refactor/10-scope.md) |
| SP-010 | 2026-07-12 | 타이밍·Availability | 완료 | 슬롯 XHR 관찰 | [xhr-slot-watch/10-analysis-design.md](xhr-slot-watch/10-analysis-design.md) |
| SP-011 | 2026-07-13 | 타이밍·Availability | 진행 | 오픈 타이밍 성능 우산 | [open-timing-performance/open-timing-performance-analysis.md](open-timing-performance/open-timing-performance-analysis.md) |
| SP-011/T1 | — | — | — | 기준시계 신뢰성 | [open-timing-performance/01-reference-clock-reliability/10-analysis.md](open-timing-performance/01-reference-clock-reliability/10-analysis.md) |
| SP-011/T1/RT-15 | — | — | — | 기준시계 원시 표본 trace | [open-timing-performance/01-reference-clock-reliability/01-raw-sample-trace/00-index.md](open-timing-performance/01-reference-clock-reliability/01-raw-sample-trace/00-index.md) |
| SP-011/T2 | — | — | — | Availability 핫패스 | [open-timing-performance/02-availability-hot-path/10-analysis.md](open-timing-performance/02-availability-hot-path/10-analysis.md) |
| SP-011/T2/T2-1 | — | — | — | Shadow 관찰·안전 기반 | [open-timing-performance/02-availability-hot-path/01-observation-safety/10-analysis.md](open-timing-performance/02-availability-hot-path/01-observation-safety/10-analysis.md) |
| SP-011/T2/T2-2 | — | — | — | 제어 경로 활성화 | [open-timing-performance/02-availability-hot-path/02-control-activation/10-analysis.md](open-timing-performance/02-availability-hot-path/02-control-activation/10-analysis.md) |
| SP-011/T2/RT-14 | — | — | — | EXACT EMPTY cycle 조기 종료 | [open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/00-index.md](open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/00-index.md) |
| SP-011/T3 | — | — | — | 런타임 견고성 | [open-timing-performance/03-runtime-resilience/10-analysis.md](open-timing-performance/03-runtime-resilience/10-analysis.md) |
| SP-011/T3/RT-16 | — | — | — | 오픈 전 준비 복원력 | [open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/00-index.md](open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/00-index.md) |
| SP-011/T3/RT-16/RT-16A | — | — | — | 준비 단계 관측성 | [open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/01-rt16a-observability/10-design.md](open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/01-rt16a-observability/10-design.md) |
| SP-011/T3/RT-16/RT-16B | — | — | — | 실행 간 준비 상태 격리 | [open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/02-rt16b-state-isolation/10-design.md](open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/02-rt16b-state-isolation/10-design.md) |
| SP-011/T3/RT-16/RT-16C | — | — | — | 준비 단계 bounded recovery | [open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/03-rt16c-bounded-recovery/10-design.md](open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/03-rt16c-bounded-recovery/10-design.md) |
| SP-012 | 2026-07-14 | 슬롯·후속 | 완료 | 슬롯 조상 가시성 | [slot-ancestor-visibility/10-analysis.md](slot-ancestor-visibility/10-analysis.md) |
| SP-013 | 2026-07-14 | 슬롯·후속 | 완료 | 슬롯 전환 결과 | [slot-transition-outcomes/10-analysis.md](slot-transition-outcomes/10-analysis.md) |
| SP-014 | 2026-07-14 | 타이밍·Availability | 완료 | Availability 사이클 상관 | [availability-cycle-correlation/10-analysis.md](availability-cycle-correlation/10-analysis.md) |
| SP-015 | 2026-07-14 | 타이밍·Availability | 완료 | 시계 표본 설정 계약 | [clock-sample-setting-contract/10-analysis.md](clock-sample-setting-contract/10-analysis.md) |
| SP-016 | 2026-07-14 | 슬롯·후속 | 완료 | 예약금 안내 `다음` | [deposit-notice-next/10-analysis.md](deposit-notice-next/10-analysis.md) |
| SP-017 | 2026-07-14 | 슬롯·후속 | 완료 | 복합 좌석·메뉴 | [seating-menu-sheet/10-analysis.md](seating-menu-sheet/10-analysis.md) |
| SP-018 | 2026-07-14 | 예약 흐름 | 완료 | 예약 흐름 호환성 | [reservation-flow-compatibility/reservation-flow-compatibility.md](reservation-flow-compatibility/reservation-flow-compatibility.md) |
| SP-018/01 | — | — | — | 신형 달력 DOM 호환 | [reservation-flow-compatibility/01-calendar-dom-compatibility/10-analysis.md](reservation-flow-compatibility/01-calendar-dom-compatibility/10-analysis.md) |
| SP-018/02 | — | — | — | 결제 방식 자동 진행 | [reservation-flow-compatibility/02-payment-method-auto-advance/10-analysis.md](reservation-flow-compatibility/02-payment-method-auto-advance/10-analysis.md) |
| SP-018/03 | — | — | — | RT-07 복합 좌석·메뉴 실제 검증 | [reservation-flow-compatibility/03-seating-menu-live-validation/10-analysis.md](reservation-flow-compatibility/03-seating-menu-live-validation/10-analysis.md) |
| SP-018/04 | — | — | — | 실제 예약 폼 E2E | [reservation-flow-compatibility/04-live-form-e2e-verification/10-analysis.md](reservation-flow-compatibility/04-live-form-e2e-verification/10-analysis.md) |
| SP-019 | 2026-07-15 | 관측·진단 | 완료 | 실행 진단 bundle | [run-diagnostics/run-diagnostics.md](run-diagnostics/run-diagnostics.md) |
| SP-020 | 2026-07-16 | 실행 구조 | 현재 기준 | Run control plane | [run-control-plane/20-design.md](run-control-plane/20-design.md) |
| SP-021 | 2026-07-20 | UI·운영 | 완료 | 예약 설정 빠른 동작 | [reservation-quick-actions/10-design.md](reservation-quick-actions/10-design.md) |
| SP-022 | 2026-07-25 | 예약 완주 | 현재 기준 | CatchPay 예약 완주 | [catchpay-reservation-completion/00-index.md](catchpay-reservation-completion/00-index.md) |
| SP-022/01 | — | — | — | 예약 폼 변형 복원력 | [catchpay-reservation-completion/01-form-variant-resilience/00-index.md](catchpay-reservation-completion/01-form-variant-resilience/00-index.md) |
| SP-023 | 2026-07-30 | 개발·릴리스 | 진행 | 릴리스 버저닝 | [release-versioning/00-index.md](release-versioning/00-index.md) |
| SP-024 | 2026-08-05 | UI·운영 | 완료 | Side Panel 온보딩 투어 | [onboarding-tour/10-design.md](onboarding-tour/10-design.md) |
| SP-025 | 2026-08-07 | 실행 구조 | 완료 | 오케스트레이터 확장성 기반 | [orchestrator-extensibility/00-index.md](orchestrator-extensibility/00-index.md) |
| SP-025/01 | — | — | — | 관측 분리 | [orchestrator-extensibility/01-observation-split/30-implementation.md](orchestrator-extensibility/01-observation-split/30-implementation.md) |
| SP-025/02 | — | — | — | 커널·흐름 경계 | [orchestrator-extensibility/02-kernel-flow-boundary/40-verification.md](orchestrator-extensibility/02-kernel-flow-boundary/40-verification.md) |
| SP-025/03 | — | — | — | 핫패스 전략 추출 | [orchestrator-extensibility/03-hot-path-extraction/40-verification.md](orchestrator-extensibility/03-hot-path-extraction/40-verification.md) |
| SP-026 | 2026-08-07 | 관측·진단 | 완료 | 관측 실패 정책 | [observation-failure-policy/40-verification.md](observation-failure-policy/40-verification.md) |

## 새 패키지 등록 규칙

스펙 작업은 패키지 생성과 이 README의 카탈로그 갱신까지를 한 변경으로
처리한다.

1. 새 최상위 패키지를 만들면 다음 미사용 SP ID를 부여하고 카탈로그에
   최초 추가일, 영역, 상태, 작업명, 진입 문서를 등록한다.
2. 하위 패키지를 만들면 새 SP ID를 부여하지 않고 카탈로그의 부모 행
   바로 아래에 계층 경로, 작업명, 진입 문서를 추가한다.
3. 패키지 이동이나 이름 변경 시 ID와 최초 추가일은 유지하고 링크만
   갱신한다. 삭제한 ID는 재사용하지 않는다.
4. 작업 단계가 바뀌면 카탈로그 상태를 함께 갱신하고 내부 링크 검사를
   통과해야 스펙 생성 또는 변경이 완료된 것으로 본다.

`최초 추가일`은 각 최상위 패키지에서 Git으로 처음 추가된 파일의
author date다. ID는 최초 추가 시각순이며, 같은 시각이면 패키지
경로 이름순으로 정한다. 부여한 ID는 이후 순서를 바꾸거나 패키지를
삭제해도 변경·재사용하지 않는다. 하위 패키지는 별도 SP ID를 만들지
않고 최상위 패키지 ID를 공유한다. `SP-011/T1/RT-15` 같은 값에서
첫 구간만 공식 SP ID이며 나머지는 내부 계층 경로다. 하위 행의
최초 추가일, 영역, 상태는 최상위 패키지 행에서 관리한다.

상태는 `현재 기준`, `진행`, `완료`, `이력`만 사용한다. 현재 기준
판정은 위 진입 목록과 HANDOFF를 따르며, 완료 패키지는 당시 결정과
회귀 근거를 보존하는 기록이다.

스펙이 참조하는 실행 원본은 [Evidence 패키지](../evidence/README.md)에
실행별로 보관합니다. 완료된 패키지의 분석·설계·구현·검증·적대적
리뷰는 당시 결정과 회귀 근거를 보존합니다.
