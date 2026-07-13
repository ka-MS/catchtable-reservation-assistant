# RT-10 cycle correlation 분석

## 현재 결함

Tier 2-1은 request sequence와 response·분류·bridge 시각을 남기지만 target 날짜 클릭 cycle과 결합하지 않는다. `latestTargetShadow`와 최초 claim도 run 전체에 남아 이전 cycle body와 이후 DOM 후보가 비교될 수 있다.

`PerformanceResourceTiming` arrival은 날짜 정보가 없어 canceled 인접 요청과 target 요청을 구분할 수 없다. 따라서 기존 `lastArrivalAt`은 제어 deadline 보조값으로 유지하되 성능 상관 근거로 사용하지 않는다.

## 관측 경계

- MAIN probe는 사이트 XHR 의미를 바꾸지 않는다.
- cycle marker 전달을 기다리거나 target click을 지연하지 않는다.
- body·bridge·mutation 관측 실패는 날짜 토글, DOM 스캔, click, timeout, 상태 전이를 바꾸지 않는다.
- body 후보만으로 클릭하지 않는다.
- 동기 DOM 전체 검색을 계측 목적으로 추가하지 않는다.

## 필요한 계약

1. target click마다 run-local `cycle`과 monotonic click 기준점을 등록한다.
2. ISOLATED bridge가 marker를 MAIN에 best-effort로 보낸다.
3. MAIN XHR probe는 날짜·인원이 일치하는 request에 marker를 결합한다.
4. marker가 request send보다 늦게 도착해도 진행 중 observation에 소급 결합할 수 있다.
5. 같은 `cycle`, `requestSequence`, `correlationId`로 body와 DOM compare trace를 조회한다.
6. DOM observer generation으로 target click 뒤 mutation 여부를 판정한다.
7. `EXACT/STRONG/WEAK/NONE`을 명시적인 규칙으로 계산한다.

## 범위 밖

- body 기반 직접 클릭 또는 토글 중단
- 40/60ms 토글 정책 변경
- 실제 오픈 표본 없이 Tier 2-2 성능 결론 확정
- 결제·약관·최종 예약 자동화
