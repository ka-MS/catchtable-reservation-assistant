# 2026-08-07-05 changelog에 refactor 노출 (#23 준비)

## 한 것

`release-please-config.json`에 `changelog-sections`를 추가해 `refactor:`를
changelog에 노출시켰다. `feat`·`fix`·`perf`·`revert`·`deps`도 함께 명시했다.

## 왜

SP-025의 01·02가 `orchestrator.ts`를 1,630 → 1,287줄로 재구조화했는데
changelog에 한 줄도 없다. `release-type: node` 기본값이 `feat`·`fix`만
노출하고 나머지를 숨기기 때문이다.

`v1.1.2` 이후 커밋은 `docs` 4 · `refactor` 2 · `fix` 2 · `chore` 2다.
릴리스 노트가 `fix` 2줄만 보여주는 것은 실제 변경량을 크게 축소한다.

## 내린 결정

**설정으로 처리하고 릴리스 PR 본문은 손대지 않는다.** Release Please는
main에 커밋이 들어올 때마다 릴리스 PR을 재생성한다. 손으로 쓴 노트는
다음 푸시에 덮인다. 설정을 바꾸면 03이 병합될 때 자동으로 잡힌다.

**`docs`는 계속 숨긴다.** spec 패키지 작업이 커밋을 여러 개 만든다
(`v1.1.2` 이후만 4건). 노출하면 릴리스 노트가 문서 커밋으로 덮인다.

**타입 전체를 나열한다.** `changelog-sections`는 기본값을 병합하지 않고
**대체한다.** `feat`·`fix`를 빼면 그것들이 사라진다. 이 함정 때문에
필요한 것만 적지 않고 전부 적었다.

## 검토했다 버린 선택지

- **`#23` 본문을 손으로 편집** — 다음 푸시에 덮인다.
- **`CHANGELOG.md` 직접 편집** — Release Please가 소유한 파일이라 충돌한다.
- **`refactor:`가 버전을 올리게 설정** — 이 설정으로는 안 되고, 된다 해도
  구조 변경마다 패치 버전이 오르는 것은 원하는 바가 아니다. `refactor:`는
  여전히 릴리스를 유발하지 않고, 다른 커밋이 릴리스를 띄울 때 함께 보인다.

## 남은 것

`refactor:`는 버전을 올리지 않으므로 **SP-025 03을 `v1.1.3` 전에 병합해야**
01·02·03이 한 릴리스에 담긴다. 03을 릴리스 뒤로 미루면 다음 `fix:`가 나올
때까지 어떤 릴리스에도 담기지 않는다.

## 검증

병합 후 `#23`이 재생성되면서 `Code Refactoring` 섹션에 01(`13027bf`)과
02(`ae992c5`)가 나타나는지로 확인한다.

## 산출물

- 릴리스 PR: [#23](https://github.com/ka-MS/catchtable-reservation-assistant/pull/23)
- 절차: `docs/development/release-process.md`
