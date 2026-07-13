# RT-10 cycle-correlated availability timing

## 목표

target 날짜 클릭 cycle과 MAIN XHR 응답, ISOLATED bridge, DOM mutation, DOM 후보를 같은 correlation record로 연결한다.

## 수행

1. `docs/specs/availability-cycle-correlation/`에 분석·설계·TDD 계획을 작성했다.
2. target click marker를 ISOLATED에서 MAIN으로 await 없이 전달하고, XHR send 전·후 marker 결합을 지원했다.
3. `AvailabilityCorrelationTracker`에 `EXACT/STRONG/WEAK/NONE`, cycle별 최신 request, bounded record를 구현했다.
4. 별도 `SlotDomMutationWatch`로 target click 뒤 mutation generation과 시각을 수집했다.
5. body·DOM trace에 cycle, request sequence, correlation id, bridge/response-to-DOM 지연을 기록했다.
6. 적대적 리뷰에서 DOM 선행 순서 경합을 발견해 `dom_compare_late` 결합을 추가하고 observer 시작을 슬롯 탐색 시점으로 좁혔다.
7. 전체 자동 게이트와 Chrome extension reload, live 비표적 응답 배제, IndexedDB seq·event count를 검증했다.

## 결과

- 과거 cycle body가 이후 DOM 후보와 섞이지 않는다.
- `WEAK/NONE`은 성능 집계 가능한 cycle body로 저장되지 않는다.
- 관측 실패는 날짜 토글, DOM 선택, click, 상태 전이를 바꾸지 않는다.
- 테스트 236/236 통과
- live 비표적 응답은 `cycle=null`, `NONE`으로 저장됨
- 실제 오픈 양성 표본은 미확보이며 `RT-10M` 후속 측정으로 분리함

## 다음 작업

별도 브랜치에서 RT-02 `clockSampleCount` UI·저장 계약을 분석한다.
