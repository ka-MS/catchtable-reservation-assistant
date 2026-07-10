# Catchtable Reserve Assistant 문서

캐치테이블 예약 보조 Chrome 확장 프로그램의 계획과 설계 문서다.

## 읽는 순서

1. [specs/00-goal-and-workflow.md](specs/00-goal-and-workflow.md) - 최종 목표와 실행 규칙
2. [01-overview.md](01-overview.md) - 무엇을, 왜 만드는가
3. [08-status.md](08-status.md) - 현재 작업 상태와 다음 확인 항목
4. [05-roadmap.md](05-roadmap.md) - 전체 구현 단계
5. 작업에 맞는 상세 문서

## 문서 역할

| 작업 | 문서 |
| --- | --- |
| 최종 목표와 단계별 통과 기준 확인 | [specs/00-goal-and-workflow.md](specs/00-goal-and-workflow.md) |
| 제품 범위 확인 | [01-overview.md](01-overview.md) |
| 확장 프로그램 구성과 책임 확인 | [02-architecture.md](02-architecture.md) |
| 자동화 상세 요구사항 확인 | [specs/01-reservation-automation-spec.md](specs/01-reservation-automation-spec.md) |
| 현재 단계와 완료 기준 확인 | [phases/01-extension-foundation.md](phases/01-extension-foundation.md) |
| 되돌리기 어려운 결정의 근거 확인 | [06-decisions.md](06-decisions.md) |
| 현재 상태 확인 | [08-status.md](08-status.md) |
| 병렬 작업 기록 | [progress/README.md](progress/README.md) |

## 갱신 규칙

- 새 결정은 [06-decisions.md](06-decisions.md)에 ADR로 추가한다. 이전 결정을 바꾸면 삭제하지 않고 새 ADR에서 대체 관계를 적는다.
- 현재 계획은 `05-roadmap.md`와 `phases/`에만 적는다.
- 진행 중 작업의 상세 기록은 `progress/active/`에 둔다.
- `08-status.md`는 현재 상태의 단일 요약이다. 구현과 어긋나면 코드와 git 상태를 우선한다.
- 코드에서 자명한 파일 경로나 함수 시그니처는 문서에 중복하지 않는다.
