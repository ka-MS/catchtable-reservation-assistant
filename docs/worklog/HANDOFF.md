# HANDOFF

**갱신:** 2026-08-07
**Blocking backlog:** 없음 (`main` 기준)

## 진행 중 브랜치

`codex/docs-orchestrator-extensibility` — 오케스트레이터 확장성 기반
([SP-025](../specs/orchestrator-extensibility/00-index.md)). 문서만
추가한다. 코드 변경 없음.

새 예약 흐름(웨이팅·줄서기) 추가 가능성을 검토하면서 `orchestrator.ts`의
구조를 측정했다. 결과는
[10-analysis.md](../specs/orchestrator-extensibility/10-analysis.md)에
있다. 코드베이스는 과설계 상태가 아니며(클래스 상속 0건, 파일 중앙값
82줄, 흐름 종속 코드 35.6%), 문제는 `orchestrator.ts` 안에서 제어와
관측이 섞인 과소설계다.

동작 무변경 리팩터 4단계(`01` 관측 분리 → `02` 커널·흐름 경계 →
`03` 핫패스 전략 추출 → `04` 전략 일반화·흐름 선택)를 순차 브랜치로
진행한다. 각 단계는 독립적으로 배포 가능하며, 앞 단계 결과에 따라
뒤 단계의 범위를 재평가하거나 취소한다. 장기 브랜치는 쓰지 않는다.

`04`에만 진입 게이트가 있다. **실측 근거가 있는 두 번째 예약 흐름의
spec 또는 evidence**가 확보되기 전에는 진입하지 않으며, 미확보 시
이 패키지는 `03`에서 완료 처리한다. `01`~`03`은 오픈런 코드만으로
결정·검증할 수 있어 게이트가 없다.

**새 예약 흐름 자체는 이 패키지 범위 밖이다.** 웨이팅·줄서기의
실사이트 실측 근거가 아직 없다.

## 직전 완료 작업

`codex/fix-form-intent-and-final-button` (`#16`, `#18`로 병합됨)
— 예약 폼 변형 복원력
([SP-022/01](../specs/catchpay-reservation-completion/01-form-variant-resilience/00-index.md)).
`intent_mismatch` 원인(시각 표기 불일치), `예약하기` CTA 변형,
`예약을 완료했습니다` 완료 문구 변형을 수정하고 실패 근거 관측을
추가했다. `npm run check` 538/538 통과.

1차 사용자 E2E(`run-fd532ce8`)에서 폼 판정과 최종 제출은 통과해 실제
예약이 생성됐으나 완료 문구 불일치로 `COMPLETED`에 도달하지 못했다.
그 실측(site-behavior §12.22)으로 완료 문구 판정을 수정했다.

2차 E2E에서 다른 매장 3곳이 모두 `COMPLETED`로 완주했다고 사용자가
확인했다(§12.23). 서로 다른 4개 매장에서 suffix 판정이 성립한다.
**병합 전 조건은 해제됐다.**

성공 실행 번들(`run-c6782244`, mangam)로 `success_observed` 세 boolean,
제출 1회, 비저장 경계를 대조 확인했다. 성공 화면 스냅샷 제목과 실패
경로 evidence는 성공 실행이 실패 스냅샷을 남기지 않아 미기록으로
남는다. 병합을 막는 항목은 아니다.

필수 multiline 카운트 관련 의심은 오독으로 판명됐다. 번들의
`requiredFormDefaultAnswer`가 빈 문자열인 것은 telemetry 비저장 처리
결과이며 런타임 값이 아니다. 판정 결함은 없다.

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

- `npm run check`: 540/540 tests, typecheck, dist validation,
  MAIN/ISOLATED independence 통과 (2026-08-07 `main` @ `0fa0af2` 기준.
  아래 Chrome E2E 항목은 예약 완주 구현 당시 518/518 시점의 기록이다)
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
