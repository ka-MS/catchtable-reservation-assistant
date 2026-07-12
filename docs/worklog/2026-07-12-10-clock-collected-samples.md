# 2026-07-12-10 시계 표본 수집 개수 진단

## 배경

worklog 09의 합의 검증을 실런으로 확인한 결과, 이번 실런(18:09)은 초기 median(1037ms) vs 최종 boundary(495ms)가 542ms 벌어졌다. 원인 분석:

- 초기 보정 5샘플의 인접 Date 델타가 0/+2000/0/0 — **+1000이 정확히 나오는 쌍이 없어** 경계 후보가 전부 기각되고 median으로 내려갔다(설계대로).
- median은 지연 최소 3개(72/80/84ms)를 뽑는데, 이번엔 하필 그 3개가 풀 B 2개 + 풀 A 1개로 갈려 median이 다수 풀(1037) 쪽에 안착했다. **median은 오프셋 클러스터를 모르고 순수 지연 순위만 본다.**
- 근본 대책은 표본 수를 늘리는 것 — 125ms 간격 5개는 실구간이 500~625ms뿐이라 진짜 초 경계를 볼 기회 자체가 적다.

사용자가 "표본 수를 9로 올리자"를 선택했으나 확인해보니 `sidepanel.html`의 기본값은 **이미 9**였다. 이번 실런이 5개를 쓴 것은 저장된 job 설정(브라우저 저장소, 코드 밖)이 5로 되어 있었기 때문 — 코드 수정 대상이 아니다. 대신 발견한 진짜 공백: **설정된 표본 수 대비 실제 HEAD 응답이 몇 개 도착했는지 구분할 수 없었다.** 9를 요청해도 일부가 실패하면 5개만 올 수 있는데 기존 metric으로는 "설정이 5" 상황과 구분 불가능했다.

## 변경

- `shared/clock.ts` — `ClockEstimate.collectedSamples: number` 추가(모든 분기: 빈 배열 0, boundary/median은 `samples.length`). "합의로 채택된 샘플 수"(`sampleCount`)와 별개로 "HEAD 응답이 실제로 온 개수"를 노출한다.
- `content/orchestrator.ts` — `clockMetricData`에 `clockCollectedSamples` 추가(항상 포함).
- `sidepanel/telemetry/trace-view.ts` — CLOCK_SYNCED 상세에 `collected > used`일 때만 `· 표본 N개 중 M개 사용`을 덧붙여 fetch 실패를 로그에서 바로 식별 가능하게 함.

## 사용자 조치 필요

사이드패널의 "시계 표본" 필드(저장된 job 설정)를 9로 확인·저장할 것. 코드 기본값은 이미 9이므로 새 저장 없이 진행한 이전 실런들만 5를 썼을 가능성이 있다.

## 검증

`npm run check` 197개 테스트 green (신규 6: collectedSamples 폴백·boundary·median, orchestrator metric 전달, trace-view 표본 부족 표시·생략). dist·independence 게이트 통과.
