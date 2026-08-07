# HANDOFF

**갱신:** 2026-08-07
**Blocking backlog:** 없음. [#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)은
SP-026으로 **해소**했다(2026-08-07).

## 진행 중 브랜치

`codex/fix-observation-failure-policy` — 관측 실패 정책
([SP-026](../specs/observation-failure-policy/20-design.md)). issue #20을 해소한다.

**계약: 관측은 예약 실행을 중단시키지 않는다. 대신 실패를 셈해 드러낸다.**

`RunObserver`의 모든 공개 메서드가 예외를 밖으로 내보내지 않는다. 이전에는
`trace` 10곳 중 6곳만 격리돼 있어 나머지에서 exporter가 던지면 실행이
`FAILED`로 죽었고, `emit`은 `RunResult` 자체를 막아 `ATTEMPT_FINISHED`
전달까지 차단했다.

삼킨 횟수는 `observationFailures()`로 노출되고 terminal 상태 전이 event에
`observationFailureCount`로 실린다. 실패 0이면 attribute가 붙지 않아 기존
payload는 그대로다. 진단 파이프라인이 죽은 것을 아무도 모르는 상태를 막는다.

`npm run check` 618/618 통과. 이 변경은 **동작 변경**이므로 기존 테스트 10건을
새 계약으로 뒤집었다 — 목록은 20-design §검증에 있다.

실사이트 dry-run 1회(`run-3bec38f4`)로 확인했다. **`observationFailureCount`
열이 없다 — 실제 환경의 관측 실패 0건이다.** 이 측정은 이 변경으로 처음
가능해졌다. payload 계약 밖 키도 0건이다.

남은 것: 성공 기준 4(late DOM 비교가 계속 실행됨)를 직접 검증하지 못했다.
구조적으로는 성립하나 shadow 시나리오 테스트가 없다.

다음은 **SP-025 02 커널·흐름 경계**다. 최신 `main`에서 브랜치를 만든다.

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
