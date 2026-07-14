# RT-10M 누와 실제 오픈 분석

**측정일:** 2026-07-15 KST
**확장 버전:** 0.2.0
**판정:** 실제 오픈 기능 검증 완료, body wake 성능 이득 미입증

## 1. 입력 표본

사용자가 내보낸 누와 CSV 4개를 실행별로 분석했다.

- 로컬 PC: 3개
- 신규 PC: 1개
- 모든 CSV: dropped 0, seq 연속
- 신규 PC 4분할 실패 4건 중 CSV가 제공된 것은 1건

원본 CSV에는 예약 설정, 전체 Trace event, 동적 attributes가 포함돼 있다. Windows의 `Zone.Identifier` 파일은 측정 데이터가 아니다.

## 2. 전면 성공 실행

실행 `run-ec3acf59-2e31-48c5-a558-b7dd184d7a01`은 18:00 일치 슬롯을 클릭하고 예약금 안내를 거쳐 예약 폼에 인계됐다. trace 종료 뒤 최종 예약 성공은 사용자가 확인했다.

| 단계 | 서버 오픈 대비 | 이전 주요 단계 대비 |
|---|---:|---:|
| target 날짜 클릭 | +690ms | - |
| XHR resource arrival | +814ms | +124ms |
| DOM 후보 감지 | +884ms | +70ms |
| 슬롯 클릭 dispatch | +893ms | +9ms |
| 후속 dialog 확인 | +1560ms | +667ms |
| 예약 폼 최초 관측 | +1857ms | +297ms |
| 예약 폼 인계 이벤트 | +2253ms | +396ms |

감지 시 ReferenceClock uncertainty는 29ms, confidence는 MEDIUM이었다. `EXACT POPULATED` response는 DOM보다 약 74ms 빨랐지만 bridge 전달에 약 57ms가 소요돼 bridge 이후 DOM까지 남은 시간은 약 16ms였다.

해당 body는 cycle 3 응답이 cycle 4 시작 뒤 도착해 `inactive_cycle`로 거절됐다. 슬롯은 cycle 4의 기존 DOM scan이 찾았고 `wakeUsed=false`였다. 따라서 실제 성공은 fallback 안전성을 검증하지만 body wake 성능 성공 표본은 아니다.

## 3. 최소화 실행

실행 `run-5881d898-a394-4244-a694-07e2d5ea0205`는 cycle 1의 `EXACT POPULATED` body wake를 수용했다.

- bridge delay: 약 124ms
- response-to-DOM: 약 606ms
- wake-to-DOM: 약 482ms
- `wakeFallbackUsed=true`
- 서버 기준 슬롯 클릭: 약 +1297ms
- 클릭 후 5초 안에 후속 화면 미확인
- 종료 스냅샷: 슬롯 모달 유지

실행 `run-8984299b-a323-4278-a799-4da514d9c20a`는 초기 cycle도 약 2초 간격이었고 이후 20~37초 공백이 발생했다. `POPULATED` body 1건은 설정 시간 범위와 일치하지 않아 `no_matching_slot`으로 정상 거절됐고 사용자가 실행을 중지했다.

두 실행은 사용자가 최소화 상태였다고 보고했다. 지연과 화면 상태의 연관성은 강하지만 trace에 `visibilityState`, focus, viewport가 없어 인과관계는 확정하지 않는다.

## 4. 신규 PC 4분할 실행

실행 `run-b413a0d5-d2ed-4642-bee3-d4aea20d04ac`은 `ENTERING_RESERVATION`에서 5초 동안 예약 CTA를 찾지 못해 인계됐다.

- 이벤트 7개, dropped 0
- URL kind: `shop`
- snapshot buttons/headings/text: 비어 있음
- 예약 CTA 클릭: 0회

현행 `EntryAdapter`는 보이는 `aside#dock` 내부에서 정확한 `예약하기` 버튼만 허용한다. 작은 responsive layout에서 dock 구조가 달라졌거나 페이지 렌더가 완료되지 않았을 가능성이 있지만 CSV만으로 구분할 수 없다. 나머지 3개 실패도 같은 현상이었다는 사용자 관측은 보조 근거로만 사용한다.

## 5. 성능 판정

실제 오픈에서 일치 슬롯을 클릭한 표본은 2개지만 정상 크기 전면 표본은 1개뿐이다. p50/p95 계산이나 상수 변경에는 부족하다.

관측된 로컬 병목:

1. 전면 성공: target click에서 XHR arrival까지 124ms
2. 전면 성공: bridge 이후 DOM까지 16ms, DOM 감지에서 클릭까지 9ms
3. 최소화: wake 이후 DOM까지 482ms와 큰 cycle scheduling 지연

25ms DOM polling이나 20/40/60ms 상수가 주요 병목이라는 증거는 없다. body wake가 실제 오픈 클릭을 단축한 표본도 없다. 중요한 예약 전에 hot path를 변경하면 검증된 fallback 성공 경로를 훼손할 위험이 더 크다.

## 6. 후속 작업

1. 중요한 예약에는 현재 빌드를 사용하고 창을 최소화하지 않는다.
2. 정상 크기의 보이는 창을 사용한다. 작은 4분할은 responsive CTA를 검증하기 전까지 피한다.
3. 즉시 실행에서 사용자가 모달·날짜·인원을 미리 준비할 수 있으면 `entryMode=prepared`를 사용한다.
4. 다음 진단에는 `visibilityState`, focus, viewport 크기와 entry snapshot을 포함한다.
5. 작은 viewport의 실제 CTA DOM을 확보한 뒤에만 EntryAdapter 지원 범위를 수정한다.
6. 추가 전면 일치 표본이 생길 때까지 20/40/60ms와 cycle 정책을 유지한다.
