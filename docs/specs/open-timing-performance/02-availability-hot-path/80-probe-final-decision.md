# RT-05 XHR probe final decision

**결정일:** 2026-07-15
**상태:** DONE

## 1. 결정

MAIN-world XHR availability probe는 **진단·성능 실험 전용으로 유지하고 기본 비활성화**한다.

- 일반 실행: wrapper를 설치하지 않고 기존 25ms bounded DOM 경로만 사용한다.
- 사용자가 고급 설정의 `XHR 응답 진단`을 명시적으로 켠 실행: wrapper와 channel을 설치하고 기존 Tier 2-2 wake 경로를 허용한다.
- 활성 상태에서도 body는 DOM scan만 깨운다. 후보 선택, click, 상태 전이는 `SlotAdapter`의 DOM 재검증이 소유한다.

## 2. 선택지 평가

### 제거

선택하지 않았다. 실제 오픈 20건에서 신뢰 가능한 POPULATED body를 관측했고, 7건에서 wake 수락과 후보 발견까지 작동했다. 향후 counterfactual 계측과 진단에 재사용 가치가 있다.

### 운영 기본 활성

선택하지 않았다. wake가 다음 25ms scan보다 실제로 빨랐다는 직접 자료가 없고, 사용자 확인 성공 3건도 모두 DOM fallback이었다. MAIN `XMLHttpRequest.prototype` wrapper의 사이트 호환성 비용을 성능 이득으로 정당화하지 못했다.

### 진단 전용·기본 비활성

채택했다. 검증된 fallback을 운영 기본으로 유지하면서 실측 기능은 사용자가 의도적으로 활성화한 실행에만 제한한다.

## 3. 설정 계약

```ts
availabilityProbeEnabled?: boolean
```

- 새 폼 기본값: `false`
- 구버전 저장 설정·즐겨찾기·예약 작업의 누락값: `false`로 정규화
- `true`: MAIN bundle 주입을 시도하고 성공한 경우에만 `shadowChannelId` 생성
- `false` 또는 누락: `executeScript`를 호출하지 않으며 channel도 만들지 않음
- 주입 실패: 실행 실패로 전파하지 않고 DOM fallback 유지

설정은 실행 의도 fingerprint에 넣지 않는다. 동일 예약의 진단 여부만 달라졌다고 히스토리를 중복 보관하지 않는다.

## 4. 안전 계약

1. 비활성 상태에서 prototype wrapper 설치 0회
2. 활성 상태의 원본 XHR 의미 보존
3. run 종료·만료 시 자기 wrapper만 원복
4. probe·bridge·trace 실패가 DOM 실행 결과를 변경하지 않음
5. body 직접 click 금지
6. `WEAK/NONE`, stale, duplicate, inactive cycle, 범위 불일치 body 거부

기존 probe 의미·복원·독립성 테스트는 유지하고, 이번 결정에는 비활성 주입 0회와 활성 MAIN bundle 1회 테스트를 추가한다.

## 5. 운영 지침

- 중요한 실제 예약: 기본값 `off` 유지
- 실제 오픈 성능 연구: 정상 크기 전면 창에서만 명시적으로 `on`
- 최소화·작은 분할 창의 결과는 환경 진단 정보가 없으면 성능 표본에서 제외
- 실행은 오픈 최소 60초 전에 시작하고 창을 최소화하지 않는다. 관측 20초 미만 실행들이 동결 clock uncertainty 상위를 차지한 실측 기반 권고이며 절대 조건은 아니다 ([90-redteam-review](90-redteam-review.md) F3)
- probe가 꺼져도 날짜 토글, DOM polling, SlotAdapter와 후속 예약 흐름은 그대로 동작

## 6. 재평가 gate

기본 활성 또는 제거를 다시 검토하려면 다음 자료가 필요하다.

- 같은 build·설정·환경의 동질 actual-open 표본
- accepted wake마다 `baselineNextScanAt`, `wakeScanAt`, `wakeAdvanceMs` 기록
- DOM fallback 또는 A/B 표본과 비교 가능한 counterfactual
- 후보·클릭 정확성 100%, dropped 0, 사용자 개입 없음
- 공식 p95를 주장할 수 있는 별도 tail 표본과 분석 방법 사전 고정
- 성능 표본은 정밀 토글 직전 동결된 ReferenceClock confidence·uncertainty 조건을 함께 만족 ([90-redteam-review](90-redteam-review.md) F3)

그 전에는 현재 20/40/60ms 상수를 변경하거나 XHR wake 성능 이득을 제품 설명에 사용하지 않는다.

## 7. 알려진 한계

이 결정의 근거인 26건 actual-open은 전량 `availabilityProbeEnabled` 필드가 없는 RT-05 이전 빌드, 즉 **probe 상시 주입 상태**에서 수집됐다 ([90-redteam-review](90-redteam-review.md) F1). 운영 기본으로 채택한 wrapper 미설치 구성은 dry-run과 자동 테스트로만 검증됐고 actual-open 표본이 없다. fallback 코드 경로는 동일하므로 결정을 바꾸지 않지만, 다음 실제 오픈 1건을 probe off로 실행해 확인 표본을 남긴다.

## 8. Tier 2-2 종료 판정

RT-05 최소 완료 조건인 운영 정책 문서화, 설정 표현, 비활성 wrapper 미설치, 활성 회귀 보존을 충족한다. Tier 2-2는 **fallback 보존형 구현 및 실제 오픈 기능 검증 완료**로 종료한다.

공식 p95와 XHR wake 성능 이득은 후속 측정 backlog다. 이는 Tier 2-2 종료를 막지 않으며 body actuator 승격도 허용하지 않는다.
