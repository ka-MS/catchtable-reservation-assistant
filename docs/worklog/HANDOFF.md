# HANDOFF

**갱신:** 2026-08-06
**Blocking backlog:** 없음 (`main` 기준)

## 진행 중 브랜치

`codex/fix-form-intent-and-final-button` — 예약 폼 변형 복원력
([SP-022/01](../specs/catchpay-reservation-completion/01-form-variant-resilience/00-index.md)).
`intent_mismatch` 원인(시각 표기 불일치)과 `예약하기` CTA 변형을
수정하고 실패 근거 관측을 추가했다. `npm run check` 534/534 통과.

**병합 전 조건:** 실사이트 E2E는 사용자가 진행하기로 했고 아직
완료되지 않았다. `40-verification.md`의 확인 항목을 채우기 전에는
병합하지 않는다.

## 현재 제품 상태

- 단일 매장·탭·날짜 오픈런, 자동 페이지 준비와 예약 작업 스케줄러가
  구현돼 있다.
- 슬롯 이후 테이블·메뉴·추가 상품·예약금·결제 방식 호환 경로가
  구현돼 있다.
- 예약 완주는 사용자 opt-in이다. 실측된 CatchPay 0원·유료 경로에서
  필수 입력·필수 약관과 최종 제출을 처리하고, 성공 path·정확한 완료
  문구·동일 예약 방문예정이 모두 일치할 때만 `COMPLETED`로 종료한다.
- `RunSupervisor` control plane은 attempt 결과, RESET_PAGE 최대 1회,
  service worker reconcile, terminal 효과와 outer/PIN durable claim을
  소유한다.
- telemetry는 IndexedDB `runs`, `events`, `snapshots`에 저장하며
  Side Panel에서 CSV와 진단 ZIP을 내보낼 수 있다.

## 현재 정책

- 신규 Side Panel 폼의 `availabilityProbeMode` 기본값은
  `empty_exit`이다.
- 모드가 없는 구 저장값은 `off`, legacy
  `availabilityProbeEnabled=true`는 `observe`로 복원한다.
- `empty_exit` 기본 활성은 의도된 제품 결정이다. 과거 RT-05·RT-14
  문서의 기본 `off` 서술은 당시 상태 기록이며 현재 기본값이 아니다.
- 예약 완주는 기본 false다.
- CatchPay PIN은 첫 수동 attempt의 일회성 authorization이며 저장
  설정·예약 작업·storage·telemetry·diagnostic에 기록하지 않는다.
- 유료 scheduled job은 PIN을 저장하지 않으므로 outer submit 전에
  인계한다.
- submit claim 뒤 결과 불명, 잘못된 PIN, 닫힌 PIN 화면과 full
  reload는 자동 재제출하지 않는다.

## 최신 검증 기준

CatchPay 예약 완주 구현·적대적 리뷰 수정 뒤 기준은 다음과 같다.

- `npm run check`: 518/518 tests, typecheck, dist validation,
  MAIN/ISOLATED independence 통과
- 통제된 Chrome:
  - 0원 CatchPay 실예약 생성 뒤 사용자 취소
  - 비로그인 `login_required`, submit 0회
  - 20,000원 유료 CatchPay outer/PIN submit 각 1회,
    `COMPLETED` 확인 뒤 사용자 취소
- 성공 run event `seq=1..63`, snapshot 0
- 세 Chrome 프로필의 extension storage·IndexedDB에 raw PIN key 없음

현재 checkout에서 작업을 마칠 때는 아래 명령을 다시 실행한다.

```bash
npm run check
git diff --check
```

## 기준 문서

- 제품: `docs/specs/product-requirements.md`
- 자동화 경계: `docs/specs/automation-boundary.md`
- 상태: `docs/architecture/state-machine.md`
- 아키텍처: `docs/architecture/overview.md`
- 테스트: `docs/testing/test-strategy.md`
- 예약 완주: `docs/specs/catchpay-reservation-completion/`
- control plane: `docs/specs/run-control-plane/`
- 실사이트 사실: `docs/analysis/site-behavior.md`
- 원본 evidence: `docs/evidence/`

## Non-blocking 후속

- RT-11: 동질 actual-open 공식 p95·wake counterfactual
- RT-12: 현재 probe-off 구성 actual-open 확인 표본
- RT-13: `inactive_cycle` 기회비용 분석
- ExecutionPhase control plane Phase 3
- 사전 점검, DOM drift 대응과 취소 자리 감시

후속 우선순위는 `docs/plans/next-development.md`, 상세 상태는
`docs/backlog/post-tier2-1-stabilization.md`를 따른다.
