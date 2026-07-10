# 기존 자산 인벤토리

**조사일:** 2026-07-10  
**기준 커밋:** `cb15c27`  
**분류 기준:** KEEP / REVISE / DEPRECATE / DELETE

현재 저장소는 기준 커밋 이전에 Git 이력이 없었다. 따라서 `cb15c27`을 재구축 전 상태의 보존 지점으로 사용한다. DELETE 항목은 이 커밋에서 언제든 복원할 수 있다.

| 경로 | 분류 | 판단 근거 | 보존/폐기 및 대체 문서 | 처리 커밋 |
|---|---|---|---|---|
| `.agents/plugins/marketplace.json` | KEEP | 개발 도구 설정이며 제품 동작과 독립적 | 그대로 보존 | `cb15c27` |
| `.gitignore` | KEEP | 생성물 제외 기준 | 그대로 보존 | `cb15c27` |
| `AGENTS.md` | KEEP | 현재 작업 규율 | 그대로 보존 | `cb15c27` |
| `CODEX_USAGE.md` | KEEP | 개발 도구 사용 안내 | 제품 문서와 분리해 보존 | `cb15c27` |
| `EXAMPLES.md` | KEEP | 개발 도구 예시 | 제품 문서와 분리해 보존 | `cb15c27` |
| `README.md` | REVISE | 구 제품 모델과 실행법 포함 | 새 MVP 범위·설치·테스트·제한사항으로 전면 개정 | 최종 문서 커밋 |
| `plugins/karpathy-guidelines-ko/.codex-plugin/plugin.json` | KEEP | 개발 보조 플러그인 | 그대로 보존 | `cb15c27` |
| `plugins/karpathy-guidelines-ko/README.md` | KEEP | 개발 보조 문서 | 그대로 보존 | `cb15c27` |
| `plugins/karpathy-guidelines-ko/skills/karpathy-guidelines-ko/SKILL.md` | KEEP | 개발 행동 지침 | 그대로 보존 | `cb15c27` |
| `docs/README.md` | REVISE | 문서 인덱스는 필요하나 구조가 변경됨 | 새 공식 문서 인덱스로 교체 | 새 기준 문서 커밋 |
| `docs/01-overview.md` | DEPRECATE | 시작/종료 시간 중심의 과거 제품 설명 | 이력만 보존, `docs/specs/product-requirements.md`로 대체 | 폐기 기준 커밋 |
| `docs/02-architecture.md` | DEPRECATE | 상시 Content Script와 구 상태 모델 전제 | `docs/design/architecture.md`로 대체 | 폐기 기준 커밋 |
| `docs/05-roadmap.md` | DEPRECATE | 새 단계 범위와 우선순위 불일치 | `docs/plans/mvp-implementation.md`로 대체 | 폐기 기준 커밋 |
| `docs/06-decisions.md` | DEPRECATE | 실측 전 결정과 현 기준 혼재 | `docs/design/decisions/` ADR로 대체 | 폐기 기준 커밋 |
| `docs/08-status.md` | DEPRECATE | 실패 구현을 완료 상태로 표현 | `docs/worklog/HANDOFF.md`로 대체 | 폐기 기준 커밋 |
| `docs/phases/README.md` | DELETE | 새 구현 계획과 중복되는 빈 구조 | Git 이력만 보존 | 폐기 기준 커밋 |
| `docs/phases/01-extension-foundation.md` | DEPRECATE | 잘못된 1차 구현 완료 기준 | `docs/plans/mvp-implementation.md`로 대체 | 폐기 기준 커밋 |
| `docs/progress/README.md` | DELETE | HANDOFF·worklog와 중복 | Git 이력만 보존 | 폐기 기준 커밋 |
| `docs/progress/active/.gitkeep` | DELETE | 제거될 빈 디렉터리 표식 | 불필요 | 폐기 기준 커밋 |
| `docs/progress/done/.gitkeep` | DELETE | 제거될 빈 디렉터리 표식 | 불필요 | 폐기 기준 커밋 |
| `docs/specs/README.md` | REVISE | 스펙 인덱스 역할은 유효 | 새 공식 스펙 인덱스로 교체 | 새 기준 문서 커밋 |
| `docs/specs/00-goal-and-workflow.md` | REVISE | 분석→설계→구현→검증→적대적 리뷰 흐름은 유효 | 새 상태·산출물 경로에 맞게 개정 | 최종 문서 커밋 |
| `docs/specs/01-reservation-automation-spec.md` | DEPRECATE | 시작/종료 시간, 슬롯 이후 진행, PAUSED 전제 | `docs/specs/product-requirements.md`, `automation-boundary.md`로 대체 | 폐기 기준 커밋 |
| `docs/specs/05-ai-implementation-meta-prompt.md` | DEPRECATE | 일회성 외부 저장소 참조 프롬프트 | 본 재구축 기록과 공식 문서로 대체 | 폐기 기준 커밋 |
| `docs/specs/10-analysis.md` | DEPRECATE | 일부 실제 관찰과 잘못된 셀렉터가 혼재 | 검증된 사실만 `docs/analysis/site-behavior.md`로 이관 | 폐기 기준 커밋 |
| `docs/specs/20-design.md` | DEPRECATE | 슬롯 이후 자동 진행과 구 상태 모델 전제 | 새 아키텍처·상태 머신으로 대체 | 폐기 기준 커밋 |
| `docs/specs/30-implementation.md` | DEPRECATE | 실패 구현을 설명 | `docs/plans/mvp-implementation.md`로 대체 | 폐기 기준 커밋 |
| `docs/specs/40-verification.md` | DEPRECATE | 추측 fixture 기반 통과 결과 | `docs/testing/test-strategy.md`와 새 검증 기록으로 대체 | 폐기 기준 커밋 |
| `docs/specs/50-adversarial-review.md` | REVISE | 실패 원인 일부는 회귀 기준으로 유효 | `docs/analysis/legacy-review.md`에 흡수 후 폐기 표시 | 폐기 기준 커밋 |
| `manifest.json` | REVISE | 상시 주입과 동적 주입을 함께 사용 | on-demand 주입만 사용하는 MV3 manifest로 교체 | 구현 기반 커밋 |
| `package.json` | REVISE | 도구 선택은 유효, 테스트 구성이 부족 | clean/typecheck/test/check 스크립트로 개정 | 구현 기반 커밋 |
| `package-lock.json` | REVISE | 패키지 변경 결과물 | 새 package.json에 맞춰 재생성 | 구현 기반 커밋 |
| `tsconfig.json` | REVISE | strict와 ES2022는 유효 | 새 디렉터리와 테스트 가능 구조에 맞춰 개정 | 구현 기반 커밋 |
| `scripts/copy-static.mjs` | REVISE | 정적 파일 복사 책임은 유효 | 새 manifest·sidepanel 경로를 복사하도록 개정 | 구현 기반 커밋 |
| `src/shared/types.ts` | DELETE | 잘못된 설정·상태 모델 | 새 설정·상태·메시지 모델로 교체 | 구현 기반 커밋 |
| `src/background.ts` | DELETE | 상시/동적 이중 주입과 구 저장 모델 | `src/background/index.ts`로 교체 | 구현 기반 커밋 |
| `src/content/index.ts` | DELETE | 주입 가드 없는 구 엔진 부트스트랩 | on-demand 단일 주입 부트스트랩으로 교체 | 구현 기반 커밋 |
| `src/content/adapter.ts` | DELETE | 실사이트와 불일치하는 추측 셀렉터 포함 | 실측 adapter 모듈들로 교체 | 구현 기반 커밋 |
| `src/content/engine.ts` | DELETE | 영구 PAUSED, Date.now 직접 사용, 구 제품 흐름 | 새 오케스트레이터와 명시적 상태 머신으로 교체 | 구현 기반 커밋 |
| `src/sidepanel/index.ts` | DELETE | 예약 오픈 시각이 없는 구 폼 모델 | 새 설정 UI로 교체 | UI 구현 커밋 |
| `src/sidepanel/sidepanel.html` | DELETE | 시작/종료 시간 중심 UI | 예약 오픈 일시 중심 UI로 교체 | UI 구현 커밋 |
| `src/sidepanel/sidepanel.css` | DELETE | 구 마크업 전용 스타일 | 새 UI와 함께 교체 | UI 구현 커밋 |
| `tests/adapter.test.mjs` | DELETE | 추측 DOM을 성공 기준으로 고정 | 실측 fixture 기반 테스트로 교체 | 테스트 커밋 |
| `tests/performance.mjs` | DELETE | 잘못된 후보 선택 로직의 속도만 측정 | 새 통합 테스트와 계측으로 교체 | 테스트 커밋 |

## 분류 요약

- KEEP: 개발 규율과 도구 보조 파일 8개
- REVISE: 공식 인덱스·목표·빌드 설정 10개
- DEPRECATE: 과거 맥락은 남기되 공식 기준으로 사용할 수 없는 문서 14개
- DELETE: Git 스냅샷 외 보존 가치가 낮거나 잘못된 구현·테스트 12개

## 구현 착수 게이트

다음 문서가 현재 저장소 안에서 완결된 뒤에만 구현 기반을 교체한다.

- `docs/specs/product-requirements.md`
- `docs/specs/ui-requirements.md`
- `docs/specs/automation-boundary.md`
- `docs/analysis/site-behavior.md`
- `docs/design/state-machine.md`
- `docs/design/architecture.md`
- `docs/testing/test-strategy.md`
- `docs/plans/mvp-implementation.md`

