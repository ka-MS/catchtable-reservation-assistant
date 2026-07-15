# RT-14 검증

## 자동 검증

2026-07-16 기준 다음 명령을 통과했다.

```bash
npm run check
npm run analyze:rt14
git diff --check
```

결과:

- 전체 테스트 `315/315`
- TypeScript typecheck 통과
- dist 검증 통과
- MAIN/ISOLATED 독립성 검증 통과
- RT-14 분석 재현 통과

분석 재현 핵심값:

| 지표 | 값 |
|---|---:|
| 전체 실행 | 26 |
| `EXACT EMPTY` | 94 |
| active cycle 수용 가능 | 53 |
| timing-clean | 28 / 13개 실행 |
| target click → EMPTY p50 / p95 | 125.1ms / 280.6ms |
| EMPTY → cycle 종료 p50 / p95 | 241.4ms / 248.2ms |
| 다음 target 이론 선행 p50 / p95 | 281.3ms / 310.5ms |

## 고정한 회귀 계약

- legacy `true → observe`, `false/누락 → off`
- current mode가 legacy 값보다 우선
- `off`일 때 MAIN wrapper 미설치
- current `EXACT EMPTY + empty_exit`만 조기 종료 신호 수용
- `STRONG`, stale, inactive, duplicate, malformed EMPTY 거부
- observe EMPTY는 기존 `NO_SLOT` 경로 유지
- 같은 scan의 DOM 후보가 EMPTY보다 우선
- 목표 날짜 guard 중 늦게 렌더된 DOM 후보도 최종 scan에서 우선
- 목표 날짜 selected가 풀리면 기존 fallback 유지
- trace 실패가 예약 결과를 변경하지 않음

## Chrome 검증

대상:

- extension id: `olbclnjiehfelpfmgmdphfmenapmpaal`
- load path: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`

Chrome 확장을 재로드하고 Side Panel inspect view에서 확인했다.

1. `사용 안 함`, `진단만`, `EMPTY 조기 종료` radio 3개가 표시된다.
2. 초기 선택은 `사용 안 함`이었다.
3. `EMPTY 조기 종료` 선택 후 `chrome.storage.local.draftForm.availabilityProbeMode`가 `empty_exit`으로 저장됐다.
4. Side Panel `location.reload()` 후 `empty_exit` 선택이 복원됐다.
5. 설정을 `사용 안 함`으로 되돌린 뒤 저장값이 `off`인 것을 확인했다.
6. 패널 재로드 중 런타임 오류는 관측되지 않았다.

실제 예약 실행은 하지 않았다. 이미 열린 매장의 기능 회귀는 자동 오케스트레이터 테스트로 대체했으며, 실제 성능과 요청 cadence는 비중요 실오픈 표본에서 별도로 확인한다.

## 판정

자동·Chrome 기능 gate는 통과했다. 기본값 `off`를 유지한 채 실오픈 검증 단계로 넘긴다.
