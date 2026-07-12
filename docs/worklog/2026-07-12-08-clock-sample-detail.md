# 2026-07-12-08 시계 동기화 샘플별 계측 로깅

## 배경

D 병합 검증 실런에서 초기 시계 보정(−80ms, 주장 정밀도 ±302ms)과 최종 보정(+1154ms, ±150ms)이 1,234ms 어긋났다. 모노토닉 시계는 54초 사이에 표류할 수 없으므로 둘 중 하나는 주장 정밀도를 크게 벗어난 추정이다. 후보 가설: ① 페이지 로드 직후 고지연 샘플이 boundary 경계를 오배치, ② 백엔드/CDN 인스턴스 간 시계 편차가 가짜 초 경계를 생성, ③ boundary 방식이 경계 쌍 하나만 쓰는 구조적 취약성. 기존 metric에는 샘플별 데이터가 없어 가설을 판별할 수 없었다.

## 변경

- `shared/clock.ts` — `ClockEstimate.sampleDetail: string | null` 추가. `selectClockEstimate`가 전체 샘플(중앙값에서 버려진 이상치 포함)을 `o<오프셋> l<지연> d<첫 샘플 대비 Date 틱 델타>` 형식으로 요약한다(` | ` 구분, 정수 반올림). 예: `o1490 l20 d0 | o2390 l20 d1000`.
- `content/orchestrator.ts` — `clockMetricData`가 `sampleDetail`이 있을 때만 `clockSampleDetail`을 metric 데이터에 싣는다. initial/final 두 보정 이벤트 모두 적용.
- 크기: 최대 9샘플 × ~20자 ≈ 200자로 trace attr 500자 한도 내.

## 판별 방법 (다음 실런에서)

- 샘플 간 `o` 값이 지연(`l`)과 무관하게 ~1000ms 단위로 갈라지면 → 백엔드 시계 편차(가설 ②).
- `o` 편차가 `l`이 큰 샘플에 집중되면 → 지연 비대칭(가설 ①).
- `d`가 비단조로 튀면(뒤 샘플의 Date가 앞보다 과거) → 서로 다른 서버 응답 확정.

## 검증

`npm run check` 189개 테스트 green (신규 4: boundary/median sampleDetail, 폴백 null, orchestrator metric 전달·생략). dist·independence 게이트 통과.
