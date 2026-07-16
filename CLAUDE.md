# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Catchtable Reserve Assistant는 예약 오픈 시각에 Catchtable(`app.catchtable.co.kr`) DINING 예약 슬롯을 감지하고, 목표 슬롯을 한 번 클릭한 뒤 사용자에게 제어권을 넘기는 개인용 Chrome Manifest V3 확장 프로그램이다.

**핵심 원칙: 이 확장은 예약을 완료하지 않는다.** 로그인, CAPTCHA, 유료 예약금 선택, 약관 동의, 결제, 최종 `예약하기` 클릭은 절대 자동화하지 않는다. 자동화는 항상 `/ct/reservation/form` 도착 또는 미지원 화면에서 `HANDED_OFF`로 종료하고 사용자에게 넘긴다. 자세한 경계는 `docs/specs/automation-boundary.md`를 따른다.

## 명령어

```bash
npm run build             # clean -> tsc -> esbuild(content, main-world probe) -> copy-static
npm run typecheck          # tsc --noEmit (strict)
npm test                   # build 후 node --test tests/*.test.mjs
npm run check:dist         # dist 산출물 검증 (manifest v3, no content_scripts, no import 잔존 등)
npm run check:independence # 코드/문서/테스트에 외부 실험 저장소 이름·경로 잔존 검사 (금지 문자열은 scripts/check-independence.mjs 참고 — 그 이름을 어디에도 새로 쓰지 말 것)
npm run check              # 위 4개를 모두 실행 (병합 전 필수 게이트)
```

단일 테스트 파일 실행 (먼저 `npm run build`로 dist를 최신 상태로 만든 뒤):

```bash
node --test tests/<name>.test.mjs
```

`npm run check`가 전부 통과해야 병합 가능하다 (`docs/development/branch-strategy.md`).

## 아키텍처

```text
Side Panel
  -> Background Service Worker
       -> on-demand Content Script
            -> OpenRunOrchestrator
                 -> StateMachine
                 -> ClockService / Scheduler
                 -> CatchtableSiteAdapter
                      -> EntryAdapter / CalendarAdapter / PersonAdapter
                      -> SlotAdapter / PostSlotAdapter
```

- `src/background/`: 탭 확인·이동, PING 후 단일 스크립트 주입, 설정/실행/이벤트 storage, 알림, IndexedDB 텔레메트리 수집.
- `src/content/`: 한 런(run)의 오케스트레이션과 실제 DOM 접근. esbuild로 IIFE 단일 번들로 만들어지며 정적 `import`가 남아있으면 빌드 검증에서 실패한다 (Content Script는 MV3에서 module을 지원하지 않음).
- `src/content/adapter/`: 실측된 CSS 선택자와 DOM 클릭만 소유하는 계층. **adapter 외의 모듈은 `querySelector`를 호출하지 않는다.**
- `src/shared/`: 설정 검증, 시간/슬롯 선택, 상태 머신 등 순수 로직. `chrome.*`, `window`, `document`를 참조하지 않으며 Chrome/DOM 없이 테스트 가능해야 한다.
- `src/main-world/`: 진단 설정(`availabilityProbeEnabled`)이 명시적으로 켜진 실행에만 별도 주입되는 MAIN-world XHR probe. body는 DOM scan을 깨울 뿐 후보 선택과 클릭은 항상 `SlotAdapter`가 소유한다.
- `src/sidepanel/`: 설정 폼, 실행 상태, 이벤트/트레이스 UI.

### 의존 규칙 (위반 시 리뷰에서 반려)

- 핵심 오케스트레이터는 CSS 선택자를 모른다.
- Clock과 Scheduler는 주입 가능한 인터페이스(`Clock.now()`, `ClockSyncAdapter.measure()`)다. 비즈니스 로직은 `Date.now()`를 직접 호출하지 않는다.
- Content Script는 storage를 직접 쓰지 않고 이벤트를 Background로 보낸다.
- 서버 동기화 후 `wall epoch + offset`을 `performance.now()`에 앵커링해 단조 서버 시계를 만든다. wait/deadline/토글 계획/서버 로그는 이 단조 시계를 쓰고, 로컬 이벤트 시각 `at`만 wall clock epoch를 유지한다.

### 상태 머신

`IDLE -> CONFIGURED -> VALIDATING -> SYNCING_CLOCK -> (entryMode=auto인 경우 ENTERING_RESERVATION -> SELECTING_DATE -> SELECTING_PERSON) -> PREPARING_PAGE -> WAITING_FOR_OPEN -> REFRESHING_SLOTS -> SLOT_DETECTED -> SLOT_CLICK_DISPATCHED -> SLOT_TRANSITION_CONFIRMED -> (설정에 따라 HANDED_OFF 또는 ADVANCING_RESERVATION) -> HANDED_OFF`

종료 상태(`DRY_RUN_COMPLETED`, `HANDED_OFF`, `COMPLETED`, `STOPPED`, `TIMED_OUT`, `FAILED`)에 진입한 런은 다시 전이하지 않으며, `SLOT_CLICK_DISPATCHED`/`SLOT_TRANSITION_CONFIRMED`는 런당 최대 1회만 진입한다. 무기한 pause 상태는 존재하지 않는다 — 모든 대기는 감시 종료 시각(`stopAtMs`)까지만 유효하다. 전체 전이표는 `docs/design/state-machine.md`.

### 저장 모델

Background가 `chrome.storage.local`의 `schemaVersion`, `reservationConfig`, `activeRun`, `runEvents`(최대 300 링버퍼), `configHistory`/`configFavorites`(각 최대 20개)를 단독 소유한다. 상세 실행 추적(trace)은 별도로 IndexedDB `catchtable-reserve-telemetry`의 `runs`/`events`/`snapshots` store에 저장되며, Content Script가 250ms 또는 20건 단위 Port batch로 Background에 보내면 Background가 순서대로 저장 후 ACK한다.

## 테스트

- 핵심 로직(설정 검증, 시간/슬롯 선택, 상태 머신, 스케줄러)은 DOM/Chrome API 없이 단위 테스트한다.
- Site Adapter는 `tests/fixtures/*.html`을 사용하며, 각 fixture는 실측 구조 출처를 갖는다 (`tests/fixture-helper.mjs` 참고). **잘못된 DOM 가정을 테스트로 정당화하지 않는다** — fixture가 실제 사이트 구조와 다르면 실측부터 다시 한다.
- 슬롯 탐색·타이밍·무클릭 검증은 dry-run으로, 예약창 진입이나 신규 후속 화면 호환성은 통제된 실제 모드로 **예약 폼 도착까지만** 검증한다. 실제 모드 검증에서도 방문 목적·약관·결제 승인·최종 `예약하기`는 절대 조작하지 않는다.
- 새 중간 화면(테이블/메뉴/추가 상품/예약금 안내 등)을 지원 완료로 표시하려면 실측 fixture와 실제 폼 도착 증거가 모두 있어야 한다. 자세한 절차는 `docs/testing/test-strategy.md` 6장.

## 자동화 경계 (코드 변경 시 반드시 지킬 것)

- 자동화가 하는 일: 같은 오리진 서버 시간 측정, 매장 상세 URL로 탭 이동 및 dock 예약 CTA/월·날짜/인원 준비, 슬롯 탐색과 우선순위 선택, dry-run이 아닐 때 선택 슬롯 단일 클릭, (설정 시) 테이블/메뉴/예약금 안내/0원 결제 방법 처리.
- 자동화가 하지 않는 일: 로그인, CAPTCHA/대기열 우회, 설정과 다른 인원 대체, 유료 예약금 선택, 예약 폼의 방문 목적/약관/결제/최종 확정 조작, 추가 상품 수량 변경.
- `HANDED_OFF` 전환 후에는 모든 타이머/observer를 정리하고 다시 개입하지 않는다. 새 실행만 새 RunContext를 만든다.
- 전체 규칙은 `docs/specs/automation-boundary.md`.

## 문서 우선순위와 작업 흐름

문서 충돌 시 우선순위: 실측 결과 > 제품 요구사항(`docs/specs/product-requirements.md`) > 자동화 경계 > 상태 머신 > 아키텍처 > 테스트 전략 > 구현 계획 > 기존 코드/폐기 문서. 전체 인덱스는 `docs/README.md`.

**새 개발 단계를 시작하기 전에 `docs/worklog/HANDOFF.md`를 확인한다.** 여기에 blocking backlog가 명시되어 있으면 처리하거나 명시적으로 해제하기 전까지 다음 단계로 진행하지 않는다. 실사이트 실측 원본 증거는 `docs/evidence/live-runs/<날짜>/<식당>-run-<runId>/`에 실행별로 보관된다.

## 브랜치 전략

- `main`은 Chrome에 직접 로드해 쓰는 검증 완료 상태만 유지한다 — 여기서 직접 기능을 개발하지 않는다.
- 작업 브랜치는 최신 `main`에서 `codex/feat-<이름>`, `codex/fix-<이름>`, `codex/docs-<이름>` 형식으로 만들고 한 가지 목적만 담는다.
- 병합 전 `npm run check`와 `git diff --check`가 모두 통과해야 한다. 실사이트 동작에 영향을 주는 변경은 fixture/회귀 테스트와 수동 검증 결과를 함께 남긴다.

## 행동 지침

이 저장소는 속도보다 신중함을 우선하는 `AGENTS.md`의 지침(가정 명시, 최소 변경, 외과적 수정, 목표 중심 실행)을 따른다. 특히 사소해 보이는 자동화 로직 변경도 `docs/specs/automation-boundary.md`와 fixture 실측 근거 없이 추측으로 확장하지 않는다.
