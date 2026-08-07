# 02 커널·흐름 경계 — 검증

**상태:** 코드 검증 완료, 실사이트 확인 대기
**설계:** [20-design.md](20-design.md) · **구현:** [30-implementation.md](30-implementation.md)

## 성공 기준 대조

[00-index §성공 기준](../00-index.md#성공-기준) 1·3·4·5와
[20-design §성공 기준](20-design.md#성공-기준) 6·7·8이다.

| # | 기준 | 결과 |
|---|---|---|
| 1 | 기존 테스트 무수정 통과 | **충족.** `git diff --name-only -- tests/`에 기존 파일 없음 |
| 3 | `npm run check` 통과 | **충족.** 625/625, version·typecheck·dist·independence·docs |
| 4 | `git diff --check` 통과 | **충족** |
| 5 | Chrome 오픈런 dry-run 1회 | **미확인.** 아래 참조 |
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

## 미확인 항목

**성공 기준 5 (Chrome 오픈런 dry-run)는 아직 확인하지 않았다.** 이 단계는
동작 무변경이고 625개 테스트가 통과하지만, 그것이 실사이트 확인을 대신하지
않는다. 01은 dry-run 2회로 스탬핑과 payload를 확인했다.

특히 확인할 것은 다음 둘이다.

- `flow.start()`로 옮긴 shadow·slotWatch 기동이 `CONFIGURED` 전이 전에
  이뤄지는지
- cleanup 순서 변화가 telemetry flush에 영향을 주지 않는지 (이벤트 누락
  없이 실행이 종료되는지)

병합 전 확인이 필요한지는 사용자 판단이다.

## 03에 넘기는 것

`RunSession` 719줄에는 아직 핫패스와 흐름 상태 8개가 함께 있다. 03의 정확한
범위는 이 결과를 재측정해 확정한다
([00-index §재평가 지점](../00-index.md#재평가-지점)).
