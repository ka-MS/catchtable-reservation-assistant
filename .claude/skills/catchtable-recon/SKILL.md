---
name: catchtable-recon
description: Use when 캐치테이블(app.catchtable.co.kr) 사이트 동작을 실측·정찰하거나, 이 확장 프로그램을 브라우저에서 직접 실행·테스트해야 할 때. DOM 구조 확인, 예약 흐름 관측, dialog 전환 계측, dry-run 검증, 사이드패널 조작, 이벤트 로그 판독이 필요한 상황.
---

# 캐치테이블 정찰 (catchtable-recon)

## 원칙

1. **사실과 절차의 분리.** 사이트의 DOM·전환·URL 사실은 이 스킬이 아니라 `docs/analysis/site-behavior.md`가 단일 출처다. 실측 전에 반드시 그 문서를 먼저 읽고, 새 사실은 그 문서에만 기록한다. 이 스킬에는 방법만 누적한다.
2. **실측되지 않은 것은 구현하지 않는다.** 추측 셀렉터·추측 전환 금지.
3. **관측 먼저, 행동은 최소.** 읽기(스크린샷·접근성 트리·주입 관측)로 답이 나오면 클릭하지 않는다.

## 안전 수칙 (항상 적용)

- **금지:** 예약 최종 확정(예약 폼의 `예약하기` 제출), 약관 동의, 결제 수단 입력·결제 실행, 예약 취소·변경, **웨이팅/줄서기 등록, `예약 오픈 알림 받기`, `빈자리 알림 신청`**(계정 알림 등록). 이 버튼들은 실측 중 클릭 대상에서 제외한다. 매장 상세 dock의 `예약하기`(달력 모달 열기)는 클릭해도 안전하다.
- 유료 예약금·수량형 메뉴는 금액이 커질 수 있다 — 수량·금액이 표시되는 화면에서는 진행 전 금액을 기록만 하고 중단한다.
- 실측은 dry-run 또는 "클릭 직전 중단" 방식. 중간 단계(테이블/메뉴/추가상품/예약금 안내)까지는 진입 가능하되, 예약 폼 제출 경계는 넘지 않는다.
- 사용자 계정 상태(로그인, 예약 내역, 알림 신청)를 바꾸는 동작은 사전 확인 없이 실행하지 않는다.

## 역할 분담

| 사용자 | AI |
|---|---|
| 확장 리로드(`chrome://extensions`), 로그인 유지, 권한 승인 | 빌드, 페이지 이동·조작, 관측·계측, 로그 판독, 문서 기록 |

핸드오프 규약: AI가 빌드 완료 후 "확장을 리로드해주세요"라고 요청하고, 사용자 확인 응답을 받은 뒤에만 테스트를 재개한다.

## 워크플로 A: 사이트 실측

1. `docs/analysis/site-behavior.md`를 읽고 이미 실측된 사실·미실측 항목을 확인한다.
2. 대상 매장 URL(`https://app.catchtable.co.kr/ct/shop/<slug>`)로 이동한다. slug를 모르면 메인에서 검색창 클릭 → 매장명 입력 → Enter → `/ct/map/search-map` 결과에서 매장명 클릭. 로그인 상태를 먼저 확인한다.
3. **가게별 변형을 전제한다.** 진입 버튼, 중간 단계 조합(테이블/메뉴/추가상품/예약금)은 식당마다 다르다. 하나의 매장 실측을 일반화하지 말고, 유형이 다른 매장 2곳 이상에서 교차 확인한 뒤에만 `[실측]`으로 승격한다.
4. 관측 도구 (우선순위순):
   - 접근성 트리(read_page) / 스크린샷 — 구조·라벨 확인
   - **판정 주입 계측**: 확장과 동일한 판정 로직(`activeDialog`/`enabledChoices` 등)을 페이지에 주입하고 15ms 폴링으로 전환 순간을 타임스탬프와 함께 기록한다. 전환 타이밍(클릭→비활성→DOM 교체)은 이 방법으로만 계측한다.
   - **전환 종류 판별**: `window.__recon` 같은 전역 계측 객체 + `history.pushState/replaceState` 후킹 + MutationObserver를 주입한 뒤 클릭한다. 전역 객체가 살아 있으면 SPA 전환, 사라지면 풀 리로드다.
   - 네트워크 관측 — API는 관측만. 직접 호출·재현 금지(요청 본문 암호화됨).

   실전에서 확인된 도구 제약:
   - **javascript_tool 반환값에 URL 전체·쿼리스트링을 포함하면 도구가 결과를 차단한다** (`[BLOCKED: Cookie/query string data]`). 항상 `location.pathname` 또는 `new URL(u, location.origin).pathname`만 반환한다.
   - **좌표 클릭은 드리프트한다.** SPA 리렌더로 좌표 측정과 클릭 사이에 요소가 이동해 오클릭이 난다. 클릭 직전 스크린샷으로 위치를 재확인하거나, find/ref 기반 클릭을 쓴다. 오클릭 후에는 URL·화면으로 현재 상태를 반드시 재확인한다.
5. 셀렉터 근거는 ARIA 속성(`role`, `aria-label`, `aria-pressed` 등)과 `data-*`만. 해시 CSS class 금지.
6. 기록: 새 사실은 `site-behavior.md`에 매장명·실측일과 함께 `[실측]` 태그로 추가. 화면으로만 본 것은 `[화면 증거]`. 세션 요약은 `docs/worklog/`에.

## 워크플로 B: 확장 직접 테스트

1. 빌드: WSL에서 `cd /home/developer/source/catchtable-reserve && npm run check` (빌드+테스트+dist 검증).
2. **[사용자]** 확장 리로드 요청 → 확인 대기.
3. 사이드패널을 일반 탭으로 연다: `chrome-extension://<확장ID>/sidepanel/sidepanel.html`. 확장 ID는 사용자에게 최초 1회 확인해 이 문서에 기록한다.
4. 대상 매장 탭을 활성화한 상태에서 사이드패널 폼에 설정을 입력한다. **AI 주도 테스트는 dry-run을 기본값**으로 한다. dry-run 해제는 사용자가 명시적으로 요청했을 때만.
5. 실행 후 판독: 사이드패널 이벤트 로그(UI) + 확장 페이지 탭에서 `chrome.storage.local.get(["activeRun","runEvents"])`을 직접 읽어 상태·이벤트를 검증한다.
6. 결과는 `docs/worklog/`에 기록. 확장 자체의 거동 발견(예: 사이드패널 탭 제약)은 이 스킬에 보강한다.

## 포인터

- 사이트 사실: `docs/analysis/site-behavior.md` (단일 출처)
- 안전 경계 결정: `docs/design/decisions/ADR-005-slot-handoff.md`
- 주입 정책: `docs/design/decisions/ADR-004-on-demand-content.md`
- DOM 재현 fixture: `tests/fixtures/`
- 파이프라인 상태 정의: `docs/design/state-machine.md`

## 미검증 항목 (검증되면 갱신)

- 사이드패널 탭 트릭이 실제로 동작하는지 (`chrome.sidePanel` API 의존 부분이 탭 컨텍스트에서 실패할 가능성)
- 확장 ID (사용자 확인 필요)
