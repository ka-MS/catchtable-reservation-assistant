# Tier 1 — 기준시계 신뢰성 분석

**우산 분석:** `../open-timing-performance-analysis.md` (사고 전말·실측 제약·원칙은 그쪽이 단일 출처. 여기서는 Tier 1 범위만 다룬다.)

## 현재 구조와 한계

- `clock-sync.ts`가 오픈 직전 `clockSampleCount`개(3~9) HEAD 요청을 **버스트**로 두 번(초기·최종) 보낸다.
- `selectClockEstimate`(`shared/clock.ts`)가 boundary(초 경계 교차) 또는 median으로 단일 `offsetMs`를 낸다. worklog 09에서 "과반 합의" 방어를, worklog 10~11에서 샘플 상세·표본수 계측을 붙였다.
- `MonotonicEpochClock`이 `offset` 앵커를 들고 `serverNow = mono + offset`을 제공한다(이미 단조, 유지).

### 왜 뚫렸나 (2026-07-13 실측)

1. **버스트는 시간 창이 좁다.** 5~9개를 수백 ms 안에 몰아 뽑으면, 그 순간 스큐 풀(오프셋 ~+1초)이 표본의 과반을 차지할 수 있다. 그러면 "과반 합의"가 오히려 오염된 값을 통과시킨다(에스콘디도: 초기·최종 둘 다 +1000 락).
2. **단일 offset은 불확실성을 숨긴다.** median ±530 같은 넓은 불확실성이 있어도 오케스트레이터엔 숫자 하나만 전달돼, 그 값을 진실로 믿고 ~1초 일찍 토글을 시작했다.
3. **boundary가 가짜 경계에 속는다.** 서로 다른 풀 샘플 쌍이 만드는 Date 점프(+1000)를 진짜 초 경계로 오인한다.

## Tier 1이 바꾸는 것 / 안 바꾸는 것

**바꾼다**
- 버스트 → 대기 시간(WAITING_FOR_OPEN 동안) **시간 분산 rolling 샘플링**.
- `Date` 점 추정 → **구간 최대 피복** 추정 + 클러스터 분리 기반 confidence/uncertainty.
- 단일 `offsetMs` → `ReferenceClockEstimate`(하한/중심/상한·불확실성·confidence·클러스터 지지·RTT 통계·표본수·관측 스팬·소스·갱신 mono).
- 고정 `preOpenLeadMs` 진입 → **uncertainty 기반 adaptive armLead**(상한 사용).
- 단일 프레임 로그 → **3-프레임 로그**.

**안 바꾼다 (behavior-neutral except 진입 시점)**
- 슬롯 감지·클릭 경로, 토글 프리미티브, 자동화 경계. 클릭 트리거는 여전히 슬롯 응답/DOM.
- `MonotonicEpochClock` 앵커 모델(offset만 새 estimator가 공급).

## 제약

- **P1~P3(우산 §2):** 시계 표본은 same-origin `app` HEAD `Date`뿐(ct-api Date·payload 시각 불가). 1초 해상도.
- **배경 탭 스로틀:** Chrome 88+ 배경 탭 체인 타이머는 ~1s로 묶인다. rolling 샘플러 주기는 ≥1s여야 배경에서도 산다(분산 샘플링과 자연히 합치). 오픈 직전 고빈도 구간은 Tier 3 탭 활성화에 의존 — Tier 1은 **저빈도 분산 학습**만 책임진다.
- **정밀 토글 루프에 시계 요청·storage·메시지 추가 금지**(단조 시계 패키지 제약 승계).
- 페이지 재로딩을 넘는 앵커 복구 불필요(새 Content Script는 다시 학습).

## 성공 기준

시계 오차를 0으로 만드는 것이 아니다.

- 경쟁 클러스터가 있으면 **틀린 값을 자신 있게 고르지 않는다**(LOW confidence + 넓은 uncertainty).
- uncertainty가 클수록 **더 일찍 관측을 시작**하되(armLead↑) 클릭은 앞당기지 않는다.
- 에스콘디도 스큐 재현 표본에서 estimator가 다수(~0) 클러스터를 고르거나, 못 고르면 LOW로 내리고 armLead를 충분히 늘린다.
- 실오픈 재현에서 오픈 전 불필요 토글이 사라지고, 3-프레임 로그로 시계/서버/DOM/클릭 지연을 분리 판독할 수 있다.
