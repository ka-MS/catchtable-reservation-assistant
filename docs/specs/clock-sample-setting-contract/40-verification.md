# RT-02 clock sample setting contract 검증

## 자동 검증

다음 계약을 테스트로 고정했다.

- 현재 `ReservationConfig`는 `clockSampleCount` 없이 유효하다.
- legacy 추가 property가 있어도 config validator가 거부하지 않는다.
- legacy history/favorite와 scheduled job을 정리 과정에서 유지한다.
- legacy draft를 현재 form model로 변환하면 새 config에서 해당 property가 빠진다.
- trace의 `clockSampleCount`는 실제 estimator 관측 수로 계속 표시한다.
- Side Panel 정적 산출물에는 `clock-samples` 입력과 `시계 표본` 문구가 없다.

```text
npm run check
TypeScript: PASS
Tests: 238/238 PASS
dist validation: PASS
module independence: PASS
git diff --check: PASS
```

## Chrome live 확인

2026-07-14 unpacked extension `0.2.0`을 `dist`에서 다시 로드했다.

- 확장 ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- 고급 설정에는 `사전 시작`, `토글 간격`만 표시됨
- 기존 draft와 현재 config의 legacy property가 남아 있어도 Side Panel 정상 로드
- legacy property가 있는 scheduled job 19건, history 20건, favorites 5건 정상 표시
- 현재 form model 변환 결과는 `clockSampleCount`를 포함하지 않음
- Side Panel console error/warning 없음

저장 데이터를 검증 목적으로 수정하거나 예약을 실행하지 않았다.

## 판정

효과가 없던 사용자 설정은 제거됐고 과거 저장 데이터는 그대로 읽힌다. 실제 시계 estimator와 telemetry의 관측 표본 수 계약은 변경되지 않았다. RT-02 완료 조건을 충족한다.
