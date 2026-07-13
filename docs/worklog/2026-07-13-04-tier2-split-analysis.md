# 2026-07-13-04 Tier 2-1/2-2 분할 분석

## 목적

Availability 응답 body 관찰과 실제 클릭 경로 변경을 분리해, 실오픈 검증 전에도 안전한 기반 작업을 진행할 수 있게 한다.

## 결정

- **Tier 2-1 Shadow 관찰·안전 기반:** MAIN-world 응답 관찰, payload/transport 정찰, monotonic 타임라인, redacted fixture, claim guard shadow 검증. 기존 클릭 경로는 바꾸지 않는다.
- **Tier 2-2 제어 경로 활성화:** 2-1의 GO/REDUCE 판정 뒤에만 body 신호를 실제 claim 경로에 연결한다. 기존 PerformanceObserver+DOM 경로는 폴백으로 유지한다.

분석 과정에서 기존 전제 하나를 수정했다. 현재 액추에이터가 렌더된 슬롯 버튼 클릭이므로 body를 먼저 분류해도 responseEnd→DOM 렌더 56~182ms 전체를 제거할 수 없다. pre-DOM 액추에이터가 없으면 기대 이득은 최대 25ms DOM 폴링 제거와 후속 토글 방지에 가깝다. 따라서 2-1은 body 선행 시간뿐 아니라 그 신호를 안전하게 사용할 actuator가 있는지도 판정한다.

## 문서

- `docs/specs/open-timing-performance/02-availability-hot-path/10-analysis.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/01-observation-safety/10-analysis.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/02-control-activation/10-analysis.md`
- 우산 분석·spec index·선행 XHR 문서 교차 링크 갱신

## 분석 적대적 검토

1. **수정:** "body를 직접 보면 DOM 렌더 지연 56~182ms를 제거한다"는 기존 전제는 현재 DOM 버튼 액추에이터와 모순된다. pre-DOM 액추에이터가 없으면 버튼 렌더를 기다려야 하므로, 2-1의 목적을 선행 시간과 액추에이터 가능성 실측으로 바꿨다.
2. **수정:** `window.postMessage` channel은 페이지에서도 관찰 가능하므로 인증 수단이 아니다. 런 상관관계·stale 차단에만 쓰고 bridge 입력은 비신뢰로 취급하며, 2-2 클릭 직전 DOM 재검증을 불변식으로 추가했다.
3. **수정:** 실제 transport가 확정되지 않은 상태에서 fetch와 XHR을 모두 래핑하면 사이트 간섭 면적만 늘어난다. 2-1 첫 단계에서 DevTools로 transport를 고정하고 필요한 표면만 패치하도록 했다.
4. **유지:** claim guard는 2-1에서 순수 상태기계·shadow 제안으로 검증하되 production 클릭 소유권은 기존 단일 오케스트레이터에 둔다.
5. **유지:** Tier 1 실오픈 검증은 2-1 관찰 기반 착수를 막지 않지만, 2-2 실제 제어 활성화의 선행 조건이다.

## 다음

1. DevTools 읽기 전용 정찰로 실제 transport(fetch/XHR), request header 접근, `timeSlotMap` 변형을 확인한다.
2. 결과를 반영해 Tier 2-1 `20-design.md`를 작성하고 승인받는다.
3. TDD 구현 후 shadow E2E와 실제 오픈 로그로 GO/REDUCE/NO-GO를 판정한다.

## 검증

- 문서 링크와 경계 교차 검토
- `git diff --check`
- `npm run check`
