# RT-10 cycle correlation 검증

## 자동 검증

다음 계약을 테스트로 고정했다.

- 명시 marker의 cycle·날짜·인원·클릭 시각 일치: `EXACT`
- marker 없는 단일 시간창 후보: `STRONG`
- 중복 후보 또는 marker 충돌: `WEAK`
- 후보 없음·비표적 응답: `NONE`
- 같은 cycle의 최신 request sequence만 DOM 비교에 사용
- body와 DOM 도착 순서가 역전돼도 `dom_compare_late`로 재결합
- MAIN marker가 request send 뒤 도착해도 진행 중 XHR에 소급 결합
- mutation watch는 generation과 monotonic callback 시각만 기록
- shadow·mutation 계측 실패는 슬롯 제어 결과와 click 수를 바꾸지 않음

```text
npm run check
TypeScript: PASS
Tests: 236/236 PASS
dist validation: PASS
module independence: PASS
git diff --check: PASS
```

## Chrome live 확인

2026-07-14 unpacked extension `0.2.0`을 `dist`에서 다시 로드했다.

- 확장 ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- 로드 위치: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`
- 확장 활성 상태와 service worker 재기동 확인
- Side Panel origin: `chrome-extension://olbclnjiehfelpfmgmdphfmenapmpaal`
- Side Panel·Catchtable console error 없음

야키토리묵 dry-run에서 다음을 확인했다.

- `run-12ac83d3-8ab7-4635-923e-9a7e646c5881`: auto entry 중 target cycle 전 발생한 `POPULATED` time-slots 응답이 `cycle=null`, `correlationQuality=NONE`, `matchesTarget=false`로 저장됨
- 요청 날짜 `260723`, 인원 2명, 후보 `1020,1140,1260`을 관측했지만 제어 신호로 사용하지 않음
- 9/9 events, seq 1..9, dropped 0, 최종 `HANDED_OFF`
- `run-69d4d2e8-8603-4cc6-9d73-10eb2aca1b67`: prepared 검사에서 7/7 events, seq 1..7, dropped 0, 최종 `HANDED_OFF`
- 두 실행 모두 결제·약관·최종 예약 동작 없이 안전 인계됨

현재 Catchtable 달력은 동일 날짜를 여러 구조로 노출한다. 기존 calendar adapter가 목표·인접 날짜를 단일하게 확정하지 못해 두 live 실행 모두 target toggle cycle 전에 인계됐다. 따라서 이번 live 검증은 비표적 응답 배제와 관측 독립성은 확인했지만 `EXACT` 또는 `STRONG` 실제 오픈 양성 표본은 만들지 못했다.

## 판정

RT-10의 cycle 상관 계약, stale 방지, 순서 독립성, 제어 독립성은 자동 게이트와 live 비표적 표본을 통과했다. 실제 오픈 `EMPTY -> POPULATED` 양성 재측정은 별도 `RT-10M`으로 유지하며, 그 전에는 Tier 2-2의 성능 이득이나 body 기반 actuator 가능성을 주장하지 않는다.
