---
name: catchtable-recon
description: Use when 캐치테이블(app.catchtable.co.kr) 사이트 동작을 실측·정찰하거나, 이 확장 프로그램을 브라우저에서 직접 실행·테스트해야 할 때. DOM 구조 확인, 예약 흐름 관측, dialog 전환 계측, dry-run 검증, 사이드패널 조작, 이벤트 로그 판독이 필요한 상황.
---

# 캐치테이블 정찰 (catchtable-recon)

## 원칙

1. **사실과 절차의 분리.** 사이트의 DOM·전환·URL 사실은 이 스킬이 아니라 `docs/analysis/site-behavior.md`가 단일 출처다. 실측 전에 반드시 그 문서를 먼저 읽고, 새 사실은 그 문서에만 기록한다. 이 스킬에는 방법만 누적한다.
2. **실측되지 않은 것은 구현하지 않는다.** 추측 셀렉터·추측 전환 금지.
3. **관측과 행동을 구분한다.** 각 단계에서 무엇을 관측했고 무엇을 클릭했는지 기록한다.

## 역할 분담

AI가 `$use-chrome-devtools`로 확장 업데이트·새로고침, Side Panel 조작, 캐치테이블 페이지 이동, 로그 판독, IndexedDB 검증을 직접 수행한다. 로그인이나 Chrome 자체 확인 대화상자처럼 MCP가 접근하지 못하는 UI만 사용자에게 요청한다.

## 워크플로 A: 사이트 실측

1. `docs/analysis/site-behavior.md`를 읽고 이미 실측된 사실·미실측 항목을 확인한다.
2. 대상 매장 URL(`https://app.catchtable.co.kr/ct/shop/<slug>`)로 이동한다. slug를 모르면 메인에서 검색창 클릭 → 매장명 입력 → Enter → `/ct/map/search-map` 결과에서 매장명 클릭. 로그인 상태를 먼저 확인한다.
3. **가게별 변형을 전제한다.** 진입 버튼, 중간 단계 조합(테이블/메뉴/추가상품/예약금)은 식당마다 다르다. 하나의 매장 실측을 일반화하지 말고, 유형이 다른 매장 2곳 이상에서 교차 확인한 뒤에만 `[실측]`으로 승격한다.
4. 관측 도구 (우선순위순):
   - 접근성 트리(read_page) / 스크린샷 — 구조·라벨 확인
   - **판정 주입 계측**: 확장과 동일한 판정 로직(`activeDialog`/`enabledChoices` 등)을 페이지에 주입하고 15ms 폴링으로 전환 순간을 타임스탬프와 함께 기록한다. 전환 타이밍(클릭→비활성→DOM 교체)은 이 방법으로만 계측한다.
   - **전환 종류 판별**: `window.__recon` 같은 전역 계측 객체 + `history.pushState/replaceState` 후킹 + MutationObserver를 주입한 뒤 클릭한다. 전역 객체가 살아 있으면 SPA 전환, 사라지면 풀 리로드다.
   - 네트워크 관측 — API는 관측만. 직접 호출·재현 금지(요청 본문 암호화됨).

   도구별 제약 (도구에 따라 적용 여부가 다르므로 어느 도구를 쓰는지 먼저 확인한다):
   - **chrome-devtools MCP(`$use-chrome-devtools`)가 기본 도구다.** `evaluate_script`는 URL 전체·쿼리스트링 반환을 차단하지 않고(2026-07-12 실측: `location.href`를 통째로 반환 성공), `list_pages`도 전체 쿼리 URL을 그대로 노출한다. 클릭은 좌표가 아니라 스냅샷 `uid`/`ref` 기반이라 좌표 드리프트가 없다.
   - **(구 claude-in-chrome 도구를 쓸 때만 해당)** `javascript_tool` 반환값에 URL 전체·쿼리스트링을 포함하면 `[BLOCKED: Cookie/query string data]`로 결과가 차단되므로 `location.pathname`(또는 `new URL(u, location.origin).pathname`)만 반환한다. 좌표 클릭은 SPA 리렌더로 드리프트하므로 클릭 직전 스크린샷 재확인 또는 find/ref 클릭을 쓰고, 오클릭 후 URL·화면으로 상태를 반드시 재확인한다.
5. 셀렉터 근거는 ARIA 속성(`role`, `aria-label`, `aria-pressed` 등)과 `data-*`만. 해시 CSS class 금지.
6. 기록: 새 사실은 `site-behavior.md`에 매장명·실측일과 함께 `[실측]` 태그로 추가. 화면으로만 본 것은 `[화면 증거]`. 세션 요약은 `docs/worklog/`에.

## 확장 직접 테스트

확장 UI와 서비스 워커 저장소 검증에는 `$use-chrome-devtools`를 사용한다. Side Panel target이 page list에 없으면 확장 관리 페이지 target을 `chrome-extension://<id>/sidepanel/sidepanel.html`로 이동한다(`new_page`로 사이드패널 URL을 새 탭으로 여는 것은 조용히 실패할 수 있으니, 기존 target을 이 URL로 `navigate_page` 시킨다).

저장소는 **두 곳을 구분해** 검증한다 (2026-07-12 실측):
- **예약 저장·스케줄 잡·설정**은 `chrome.storage.local`에 있다. 핵심 키: `scheduledJobs`(저장된 예약 잡 배열, 각 항목에 `config`·`status`·`id`), 그 외 `reservationConfig`·`configHistory`·`configFavorites`·`activeRun`·`draftForm` 등. `chrome.storage.local.get(null)`로 덤프해 확인한다.
- **실행 텔레메트리(runs·events)**는 `catchtable-reserve-telemetry` IndexedDB에 있다.

즉 "예약 저장" 같은 스케줄 동작은 IndexedDB가 아니라 `chrome.storage.local.scheduledJobs`에서 영속을 확인해야 한다.

## 포인터

- 사이트 사실: `docs/analysis/site-behavior.md` (단일 출처)
- 주입 정책: `docs/architecture/decisions/ADR-004-on-demand-content.md`
- DOM 재현 fixture: `tests/fixtures/`
- 파이프라인 상태 정의: `docs/architecture/state-machine.md`
