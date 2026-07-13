# RT-10 cycle correlation 구현 계획

1. quality 판정·bounded tracker 순수 테스트를 작성한다.
2. cycle marker 스키마, bridge 전달, MAIN probe의 선행·후행 marker 결합 테스트를 작성한다.
3. DOM mutation generation watch를 TDD로 추가한다.
4. 오케스트레이터가 target click marker와 cycle record를 등록하고 body/DOM trace를 같은 correlation id로 기록하게 한다.
5. 기존 제어 결과·slot click 수·state가 관측 유무와 동일한지 회귀 테스트한다.
6. 전체 게이트, live 비최종 실행, trace 판독, 적대적 리뷰를 수행한다.

## 예상 변경 파일

- `src/shared/availability-shadow.ts`
- `src/main-world/xhr-probe.ts`
- `src/main-world/probe-message-bridge.ts`
- `src/content/availability-shadow-bridge.ts`
- `src/content/availability-correlation.ts`
- `src/content/adapter/slot-dom-mutation-watch.ts`
- `src/content/orchestrator.ts`
- `src/content/index.ts`
- 관련 단위·오케스트레이터 테스트
