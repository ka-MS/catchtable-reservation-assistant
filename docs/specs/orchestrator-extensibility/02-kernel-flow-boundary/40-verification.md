# 02 커널·흐름 경계 — 검증

**상태:** 완료
**설계:** [20-design.md](20-design.md) · **구현:** [30-implementation.md](30-implementation.md)

## 성공 기준 대조

[00-index §성공 기준](../00-index.md#성공-기준) 1·3·4·5와
[20-design §성공 기준](20-design.md#성공-기준) 6·7·8이다.

| # | 기준 | 결과 |
|---|---|---|
| 1 | 기존 테스트 무수정 통과 | **충족.** `git diff --name-only -- tests/`에 기존 파일 없음 |
| 3 | `npm run check` 통과 | **충족.** 625/625, version·typecheck·dist·independence·docs |
| 4 | `git diff --check` 통과 | **충족** |
| 5 | Chrome 오픈런 dry-run 1회 | **충족.** 아래 참조 |
| 6 | 생명주기 순서 고정 테스트 | **충족.** `tests/kernel-lifecycle.test.mjs` 3건 |
| 7 | PIN 폐기가 흐름 cleanup보다 먼저임을 증명 | **충족.** 2번 테스트 |
| 8 | 기대값을 추출 전 실행으로 덤프 | **충족.** 아래 참조 |

## 테스트

625 = 622(직전 `main`) + 3(신규 생명주기). 기존 622개는 한 줄도 고치지
않았다.

`tests/kernel-lifecycle.test.mjs`가 고정하는 것.

1. **startup·cleanup 9개 호출의 시간순 배열.** shadow·slotWatch·
   mutationWatch의 start/stop, 기준시계 정지, diagnostics flush, trace flush.
2. **PIN 폐기 시점.** completion이 받은 `takePin`을 cleanup 한가운데
   (`slotWatch.stop`)에서 다시 호출해 `undefined`임을 확인한다. 폐기가
   cleanup보다 먼저 일어났다는 뜻이다. 밖에서 `dispose()`를 관측할 다른
   방법이 없어 이 우회로를 썼다.
3. **cleanup 예외 시의 현재 동작.** `slotWatch.stop()`이 던지면 이후
   cleanup과 flush가 실행되지 않고 예외가 밖으로 나간다.

3번은 바람직한 동작이라서가 아니라 **동작 무변경을 증명하려고** 고정했다.
개선하려면 별도 판단이 필요하다.

### 기준 8 — 손으로 적은 기대값은 틀렸다

초안의 기대 배열은 두 곳이 틀렸고, 추출 **전** 실행이 그걸 잡았다.

| 항목 | 손으로 적은 값 | 실제 |
|---|---|---|
| terminal 상태 | `HANDED_OFF` | `DRY_RUN_COMPLETED` |
| `referenceClock.stop` 위치 | `mutationWatch.start` 뒤 | 앞 |

기준시계는 arm 시점(`waitForOpen`)에 멈춘다. `mutationWatch`를 켜는
`searchAndReserve`보다 앞이다. 추출 후에 이 테스트를 썼다면 틀린 순서를
정답으로 굳혔을 것이다.

## 주장 대조

문서에 적은 값을 실제로 확인한 결과다.

| 주장 | 확인 |
|---|---|
| `orchestrator.ts` 1,198 → 1,287줄 | `wc -l` |
| `RunKernel` 334줄 / `RunSession` 719줄 | 클래스 선언 줄 사이 계산 |
| 기준선 1,198줄 = 01 산출물 1,190 + SP-026 8 | `git show`로 각 시점 대조 |
| 기존 테스트 무수정 | `git diff --name-only -- tests/` 빈 결과 |
| 흐름 본문이 커널 호출 재작성 외 무변경 | 재조립 스크립트가 원본 줄 구간을 그대로 이어 붙임 |

## 실사이트 확인 (성공 기준 5)

`run-3f7ecd6b-0a43-43fb-860c-c410768fd0b5` (mangam, 2026-09-03, dryRun,
`entryMode=auto`, `availabilityProbeMode=empty_exit`,
`toggleIntervalMs=100`). `DRY_RUN_COMPLETED`, 61 이벤트, **droppedCount 0**.

준비 3단계를 모두 거쳐 토글 1회에서 슬롯을 찾고 종료했다. 설계가 걱정한
두 가지를 이 번들이 답한다.

### cleanup 순서가 flush에 영향을 주는가 — 아니다

`CLOCK_SAMPLE` 17건(seq 45~61)이 `RUN_TERMINATED`(seq 44) **뒤에** 모두
남았다. 이 이벤트는 `traceFrozenReferenceClockSamples()`가 내보내며, 새
커널에서는 `finally` 안 **`flow.cleanup()` 다음** 자리다. 17건이 온전히
기록되고 `droppedCount`가 0이라는 것은 흐름 cleanup을 거친 뒤에도 기준시계
동결 표본 trace와 비동기 flush가 정상 실행됐다는 뜻이다.

즉 `PIN 폐기 → flow.cleanup() → 기준시계 정지 → 동결 표본 trace → flush`
순서가 실사이트에서 그대로 성립한다.

### shadow 기동 시점 — 누락 없음

첫 `AVAILABILITY_SHADOW`(seq 25, +1771ms)는 날짜 선택(+1694ms)이 유발한
첫 슬롯 XHR을 잡았다. 그 앞의 유일한 동작은 예약하기 클릭(+1337ms)이며
가용 슬롯 XHR을 만들지 않는다. **shadow가 놓친 응답이 없다.**

다만 shadow 기동 자체는 trace를 남기지 않으므로, 이 번들은 기동이
`CONFIGURED` 전이보다 **앞이라는 것과 모순되지 않음**을 보일 뿐 그 순서를
직접 증명하지는 않는다. 순서 자체는 `tests/kernel-lifecycle.test.mjs` 1번이
고정한다.

### 관측 실패 0건

terminal 전이(seq 44)의 attributes가 정확히
`{"eventKind":"state","state":"DRY_RUN_COMPLETED"}`다.
`observationFailureCount`가 없다 — SP-026 설계대로 실패 0이면 attribute를
싣지 않으므로, 기존 payload가 그대로임을 함께 보여준다.

### 핫패스

토글 1회, `correlationQuality=EXACT`, `wakeReason=verified_target_body`,
`wakeUsed=true`, `SLOT_FOUND`, body가 DOM보다 23.2ms 앞섰다. 스케줄 드리프트는
인접 15ms·목표 67ms다. 핫패스 동작에 변화가 없다.

### 실행 빌드 확인

`extensionVersion`은 `1.1.2`로 `main`과 이 브랜치가 같다(`refactor:`는 버전을
올리지 않는다). 동작 무변경이 목표라 구분 가능한 trace도 두지 않았으므로
**번들만으로는 어느 빌드인지 알 수 없다.**

대신 로드된 산출물을 직접 대조했다. 실행에 쓰인
`/home/developer/source/catchtable-reserve/dist`가 이 브랜치 워크트리의
빌드와 내용이 완전히 같다.

- `diff -rq` 차이 없음 (Windows 복사 흔적인 `*:Zone.Identifier` 제외)
- `dist/content/orchestrator.js` sha256 앞 16자리 `aa696328e5d8d9d6` 일치
- 그 파일에 `class RunKernel`·`flow.start()`·`flow.steps()`·`flow.cleanup()`이
  존재한다. `main` 빌드에는 없는 문자열이다

따라서 위 결과는 **이 브랜치 빌드의 실행 결과**다. 전제가 아니다.

## 미해결로 남기는 것

### 흐름 훅 예외가 커널 정리를 막는다 — [#27](https://github.com/ka-MS/catchtable-reservation-assistant/issues/27)

`flow.cleanup()`이 `try`로 감싸이지 않아, 흐름 훅이 던지면 커널 자신의
`stopReferenceClock`·동결 표본 trace·flush가 실행되지 않고 `RunResult`까지
사라진다. cleanup 안에서 감싸이지 않은 포트 호출은 `deps.slotWatch?.stop()`
하나다.

**해소됐다(2026-08-07).** 후속 `fix:`로 커널 가드와 흐름 내부 wrap을 넣었다
([워크로그](../../../worklog/2026-08-07-04-kernel-cleanup-guard.md)).
아래는 02 시점의 기록이다.

리팩터 이전과 **동일한 동작**이며 `tests/kernel-lifecycle.test.mjs` 3번이
이를 고정한다. 다만 02가 "커널이 안전 계약을 소유한다"는 경계를 세운 탓에
**의미가 달라졌다** — 이제 외부 훅이 커널의 계약을 무너뜨릴 수 있는 모양이다.

이 단계에서 고치지 않은 이유는 02가 동작 무변경 조건이기 때문이다. 같은
PR에서 고치면 중립성을 증명하려고 쓴 3번 테스트를 그 PR에서 다시 뒤집게
되어 리팩터가 중립이었다는 근거가 사라진다. 01(중립) → SP-026(의도된 변경)과
같은 분리다.

### `offsetMs` 죽은 필드

`RunKernel.offsetMs`는 `applyReferenceClockEstimate()`에서 대입만 하고 읽는
곳이 없다(선언 1회 + 대입 1회, 파일 전체). 리팩터 이전부터 있던 죽은
필드라 이 단계에서 지우지 않았다(`AGENTS.md` §3).

커널로 옮겨오면서 "커널이 소유하는 시계 상태"처럼 보이게 됐으므로 03에서
정리 대상으로 다룬다.

## 03에 넘기는 것

`RunSession` 719줄에는 아직 핫패스와 흐름 상태 8개가 함께 있다. 03의 정확한
범위는 이 결과를 재측정해 확정한다
([00-index §재평가 지점](../00-index.md#재평가-지점)).

위 `offsetMs` 죽은 필드도 03에서 함께 정리한다.
