# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

Catchtable(app.catchtable.co.kr) DINING 예약 오픈 시각에 목표 슬롯을 감지·클릭한 뒤 사용자에게 인계하는 개인용 Chrome Manifest V3 확장. 로그인, CAPTCHA, 유료 예약금, 약관, 결제, 최종 예약 확정은 자동화하지 않는다. 문서·커밋 본문·UI는 한국어를 사용한다(커밋 제목은 `fix:`, `docs:` 등 conventional prefix).

## 명령

```bash
npm ci                      # 의존성 설치 (Node 22+)
npm run build               # tsc + esbuild → dist/
npm run typecheck           # strict 타입 검사만
npm test                    # build 후 node --test tests/*.test.mjs
npm run check               # typecheck + test + check:dist + check:independence (완료 전 필수 게이트)
```

단일 테스트 실행 — 테스트는 소스가 아니라 `dist/` 산출물을 import하므로 **빌드가 선행돼야 한다**:

```bash
npm run build && node --test tests/state-machine.test.mjs
```

- `check:dist`: dist 구성 파일 존재, MV3 여부, manifest에 `content_scripts` 없음, content/main-world 번들에 정적 `import` 잔존 없음을 검증한다.
- `check:independence`: 소스·문서가 과거 저장소 경로를 참조하지 않는지 검증한다(금지 문자열은 `scripts/check-independence.mjs` 참고 — 그 이름을 어디에도 새로 쓰지 말 것).

## 아키텍처

네 개의 실행 컨텍스트가 있으며 각각 빌드 방식이 다르다:

- `src/background/` — 서비스 워커(ES module). 탭 이동, PING 후 content script 단일 주입(`chrome.scripting`; manifest에 상시 `content_scripts` 없음), `chrome.storage` 키 단독 소유, 예약 잡 스케줄링, IndexedDB(`catchtable-reserve-telemetry`) trace 저장.
- `src/content/` — on-demand 주입, esbuild IIFE 단일 번들. `OpenRunOrchestrator`(orchestrator.ts)가 한 런을 진행하고, `adapter/`의 Site Adapter들(Entry/Calendar/Person/Slot/PostSlot)이 실측된 선택자와 DOM 조작을 소유한다.
- `src/main-world/` — MAIN world에 주입되는 XHR availability probe(esbuild IIFE 번들). 사이트의 가용성 응답을 관찰해 content script로 전달한다.
- `src/sidepanel/` — 설정·상태·이벤트 UI(ES module). `storage.onChanged`로 갱신된다.
- `src/shared/` — 설정 검증, 시간·슬롯 선택, 상태 머신(`state-machine.ts`의 `RunState` 전이 테이블), 시계, 스케줄러.

### 의존 규칙 (docs/design/architecture.md — 위반은 리뷰 거절 사유)

- shared core는 `chrome.*`, `window`, `document`를 참조하지 않는다 (Chrome/DOM 없이 테스트 가능해야 함).
- adapter 외 모듈은 `querySelector`를 호출하지 않는다. 오케스트레이터는 CSS 선택자를 모른다.
- Content Script는 storage를 직접 쓰지 않고 이벤트를 Background로 보낸다 (telemetry는 250ms/20건 Port batch).
- 비즈니스 로직은 `Date.now()`를 직접 호출하지 않는다. 같은 오리진 서버 Date 헤더로 보정한 서버 시계를 `performance.now()`에 앵커링한 단조 시계를 주입받아 사용한다. Clock과 Scheduler는 주입 가능한 인터페이스다.

### 테스트

`node --test` + jsdom. DOM 어댑터 테스트는 `tests/fixtures/*.html`(실사이트 실측 스냅샷)을 `fixture-helper.mjs`로 로드한다. IndexedDB는 fake-indexeddb를 사용한다. 실사이트 대상 검증은 dry-run을 먼저 사용한다 — 실제 슬롯 클릭은 예약 자리를 일시 점유한다.

## 문서 체계

`docs/README.md`가 인덱스. 문서 간 충돌 시 우선순위: **실측 결과 > 제품 요구사항 > 자동화 경계 > 상태 머신 > 아키텍처 > 테스트 전략 > 구현 계획 > 기존 코드·폐기 문서**. `폐기된` 제목이나 WARNING이 있는 문서는 공식 기준이 아니다.

- 새 개발 단계 진입 전 `docs/worklog/HANDOFF.md`를 확인한다. blocking backlog가 지정돼 있으면 처리하거나 명시적으로 해제하기 전까지 진행하지 않는다.
- 작업 완료 시 `docs/worklog/`에 날짜별 로그를 남기고 HANDOFF.md를 갱신하는 것이 관행이다.

## 행동 지침

`AGENTS.md`의 지침을 따른다. 핵심: 요청받지 않은 기능·추상화·유연성을 추가하지 않고, 반드시 필요한 부분만 외과적으로 변경하며(주변 코드 겸사겸사 개선 금지), 가정이 불확실하면 구현 전에 묻는다.
