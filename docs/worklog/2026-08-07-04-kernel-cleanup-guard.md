# 2026-08-07-04 커널 cleanup 가드 (#27)

## 한 것

- `RunKernel.execute()`의 `finally`에서 `flow.cleanup()`을 `try`로 감쌌다.
  흐름 훅이 던져도 기준시계 정지·동결 표본 trace·flush가 실행되고
  `RunResult`가 정상 반환된다.
- `RunSession.cleanup()` 안의 `deps.slotWatch?.stop()`도 감쌌다. 커널
  가드만으로는 흐름 cleanup이 중간에 끊겨 mutation observer가 남는다.
- `tests/kernel-lifecycle.test.mjs` 3번을 새 계약으로 교체했다.

[#27](https://github.com/ka-MS/catchtable-reservation-assistant/issues/27),
SP-025/02 PR 리뷰에서 나왔다.

## 내린 결정

**두 층을 다 넣었다.** 커널 경계 가드와 흐름 내부 wrap은 막는 것이 다르다.

| 층 | 막는 것 |
|---|---|
| 커널 `try { flow.cleanup(); }` | 훅이 커널의 정리·flush·`RunResult`를 무너뜨리는 것 |
| 흐름 안 `slotWatch.stop()` wrap | 흐름 자신의 원복이 중간에 끊겨 observer가 남는 것 |

한 층만 넣으면 각각 나머지가 뚫린다.

**커널 가드는 테스트로 증명되지 않는다는 것을 확인하고 남겼다.** 아래 참조.

## 검토했다 버린 선택지

- **커널 가드만** — #27이 적은 결과 4건은 막지만 mutation observer 누수가
  남는다.
- **흐름 내부 wrap만** — 현재 흐름은 안전해지지만 훅 경계 계약이 안 선다.
  두 번째 흐름이 던지면 #27이 그대로 재발한다. 리뷰가 지적한 지점이 정확히
  이것이다.
- **`availabilityWake.reset()`까지 감싸기** — 내부 필드 초기화라 던지지
  않는다. `AGENTS.md` §2(불가능한 상황에 오류 처리 늘리지 않기).
- **커널 가드를 테스트하려고 `RunKernel`을 export** — 테스트 전용 API
  표면을 늘리게 된다.

## 남은 것 — 커널 가드는 커버리지 0이다

흐름 내부 wrap을 넣은 뒤 `cleanup()`이 실질적으로 던지지 않게 되면서,
커널 가드에 도달하는 경로가 사라졌다. **가드를 제거하고 돌려도 3개 테스트가
전부 통과한다**(실제로 확인했다).

죽은 코드가 아니라 훅 경계의 계약이다. 두 번째 예약 흐름이 들어오면 그
흐름의 `cleanup()`은 이 wrap을 갖고 있지 않다. 다만 지금은 기계적으로
증명할 수 없으므로 코드 주석과 이 기록으로 남긴다. **커버리지 0을 근거로
지우면 #27이 되살아난다.**

## 곁가지 — build-regression이 주석 길이에 걸렸다

`tests/build-regression.test.mjs`는 `dist`에서 `dispose()`와 flush 사이 거리가
800자 이내인지로 "같은 finally 블록"을 확인한다. 처음 쓴 긴 주석이 815자를
만들어 실패했다.

**한도를 올리지 않고 주석을 줄였다(536자).** 그 검사는 PIN 폐기가 비동기
flush보다 먼저임을 지키는 보안 가드이고, 설명문 때문에 느슨하게 만들 이유가
없다. 긴 설명은 테스트 파일과 이 문서에 있다.

## 배운 것

"고쳤다"를 테스트 통과로 확인하고 끝낼 뻔했다. 두 층을 넣으면 안쪽 층이
바깥 층을 가려서, 바깥 층은 통과 여부와 무관해진다. 가드를 빼고 돌려본
뒤에야 드러났다.

SP-026에서 성공 기준이 catch **개수**만 봐서 경계 **범위**를 놓쳤던 것과
같은 종류다. **테스트가 통과하는 것과 그 테스트가 무엇을 증명하는지는
다르다.** 새 방어 코드를 넣을 때는 그것을 빼고 돌려서 실패하는지 확인한다.

## 산출물

- 이슈: [#27](https://github.com/ka-MS/catchtable-reservation-assistant/issues/27)
- 선행: [SP-025/02](../specs/orchestrator-extensibility/02-kernel-flow-boundary/40-verification.md)
