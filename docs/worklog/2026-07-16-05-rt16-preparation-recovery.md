# RT-16 오픈 전 준비 복원력 구현

**날짜:** 2026-07-16
**상태:** 구현·자동 검증 완료, Chrome live 재현 대기

## 패키지

- RT-16A: Background run context와 Content 준비 단계 change-based trace
- RT-16B: CalendarAdapter preparation state 실행 간 reset
- RT-16C: CTA·날짜·인원 총 2회 bounded dispatch와 구조화 handoff

## 구현 결과

- `PREPARATION_OBSERVED`에 stage/phase/action/attempt/recovery decision을 기록한다.
- 클릭 시점 visibility, focus, viewport, active element, fingerprint와 START 시점 tab/window 문맥을 결합한다.
- 동일 목표 날짜의 `pendingDate`가 다음 RunSession에 누출되지 않는다.
- CTA가 discovery deadline 근처에 나타나도 클릭 뒤 confirmation budget 없이 즉시 종료하지 않는다.
- CTA·날짜·인원 전환 불변은 1초 뒤 한 번만 재시도하고 총 2회에서 handoff한다.
- 자동 새로고침, 탭 focus, SW reconcile과 Tier 2 hot path는 변경하지 않았다.

## 검증

- 전체 `npm run check`: typecheck, `335/335` tests, dist, MAIN/ISOLATED independence 통과
- `git diff --check` 통과
- Chrome DevTools는 원격 디버깅 미응답, 대체 Chrome 제어는 확장 관리 URL 보안 차단으로 live 미실행

## 다음 gate

원격 디버깅을 활성화하고 확장을 reload한 뒤 같은 매장 탭에서 달력을 닫고 동일 설정을 반복 실행한다. 독립 날짜 dispatch, 준비 trace 필드, retry 상한과 정상 `WAITING_FOR_OPEN` 진입을 확인하면 RT-16을 `DONE`으로 전환한다.
