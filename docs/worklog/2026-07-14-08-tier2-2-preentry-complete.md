# 2026-07-14 Tier 2-2 pre-entry audit

## 목표

Tier 2-2 착수 전에 RT-01, RT-10, RT-02, RT-06, RT-07을 프로젝트 워크플로우대로 완료하고 진입 조건을 확정한다.

## 완료 항목

| 항목 | 결과 | 산출물 |
|---|---|---|
| RT-01 | 슬롯 click dispatch와 후속 화면 확인 분리 | `docs/specs/slot-transition-outcomes/` |
| RT-10 | cycle·XHR·DOM 상관관계와 관측 독립성 계약 구현 | `docs/specs/availability-cycle-correlation/` |
| RT-02 | 효력이 없는 `clockSampleCount` 사용자 설정 제거와 legacy 호환 | `docs/specs/clock-sample-setting-contract/` |
| RT-06 | 예약금 안내 `확인/다음` 변형과 선택 control 안전 차단 | `docs/specs/deposit-notice-next/` |
| RT-07 | 좌석·필수 메뉴 결합 바텀시트 지원 | `docs/specs/seating-menu-sheet/` |

각 항목은 별도 `codex/` 브랜치에서 분석, 설계, TDD 구현, 검증, 적대적 리뷰 문서를 작성하고 커밋한 뒤 `main`에 병합했다.

## 최종 게이트

clean `main`에서 `npm run check`를 다시 실행했다.

- typecheck 통과
- 테스트 245/245 통과
- dist validation 통과
- MAIN/ISOLATED independence validation 통과
- 다섯 항목 모두 backlog `DONE`
- 다섯 spec 디렉터리 모두 `10/20/30/40/50` 보유

## 진입 판정

fallback을 보존하고 클릭 직전 DOM 재검증을 유지하는 Tier 2-2 분석·구현에 진입할 수 있다.

- RT-10M은 다음 실제 오픈에서 `EXACT` 또는 `STRONG` 표본을 얻기 전까지 성능 이득 확정과 body 기반 actuator 승격을 금지한다. Tier 2-2 착수 자체는 막지 않는다.
- RT-05는 XHR probe 운영 정책을 정하는 Tier 2-2 종료 게이트다.
- RT-04는 Tier 2-2 내부에서 다룰 pending 항목이다.
- RT-07 전체 live 자동 흐름은 기존 날짜 준비 판정에서 먼저 인계된 제한을 해당 검증 문서에 보존했다.

## 다음 작업

Tier 2-2 축소 설계를 분석 단계부터 시작한다. target 날짜·인원이 검증된 body 이벤트만 wake-up 신호 후보로 사용하고, body만으로 클릭하지 않는다.
