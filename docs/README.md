# Catchtable Reserve 문서

## 시작 순서

1. [제품 요구사항](specs/product-requirements.md)
2. [자동화 경계](specs/automation-boundary.md)
3. [실사이트 실측](analysis/site-behavior.md)
4. [상태 머신](architecture/state-machine.md)
5. [아키텍처](architecture/overview.md)
6. [테스트 전략](testing/test-strategy.md)
7. [현재 HANDOFF](worklog/HANDOFF.md)

HANDOFF에 blocking backlog가 명시된 경우에만 다음 단계 진입을
중단하고 [Backlog](backlog/README.md)에서 해당 항목을 확인합니다.

## 공식 기준

현재 동작을 판단할 때 우선순위는 다음과 같습니다.

1. 실사이트 실측과 원본 evidence
2. 제품 요구사항
3. 자동화 경계
4. 상태 머신
5. 아키텍처
6. 테스트 전략
7. 기능별 완료 spec과 검증
8. 코드와 테스트

worklog과 완료된 spec의 과거 기본값·정책은 당시 상태를 기록한
이력입니다. 현재 기준과 충돌하면 위 우선순위와 HANDOFF의 명시적
정책 전환을 따릅니다.

## 문서 지도

| 영역 | 문서 |
|---|---|
| 제품·기능 패키지 | [specs/](specs/README.md) |
| 실사이트 사실 | [site-behavior.md](analysis/site-behavior.md) |
| 실측 원본 | [evidence/](evidence/README.md) |
| 상태 머신 | [state-machine.md](architecture/state-machine.md) |
| 아키텍처 | [overview.md](architecture/overview.md), [ADR·시각화](architecture/README.md) |
| 테스트 | [test-strategy.md](testing/test-strategy.md) |
| Chrome E2E 운영 | [chrome-devtools-mcp-ai-guide.md](testing/chrome-devtools-mcp-ai-guide.md) |
| 개발·릴리스 | [branch-strategy.md](development/branch-strategy.md), [release-process.md](development/release-process.md) |
| Backlog | [backlog/](backlog/README.md) |
| 작업 이력·현재 체크포인트 | [worklog/](worklog/HANDOFF.md) |
| 초기 재구축 기록 | [legacy-inventory.md](analysis/legacy-inventory.md) |

## 현재 핵심 완료 패키지

- [CatchPay 예약 완주](specs/catchpay-reservation-completion/00-index.md)
- [Run control plane](specs/run-control-plane/20-design.md)
- [예약 흐름 호환성](specs/reservation-flow-compatibility/reservation-flow-compatibility.md)
- [오픈 타이밍 성능](specs/open-timing-performance/open-timing-performance-analysis.md)
- [실행 진단 bundle](specs/run-diagnostics/run-diagnostics.md)

완료된 spec과 worklog는 현재 진입 문서가 아니라 구현 근거와 회귀
의도를 보존하는 기록입니다.
