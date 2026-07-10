# Codex 사용 안내

이 폴더에는 Codex에서 바로 쓸 수 있는 지침이 두 가지 형태로 들어 있습니다.

## 1. 프로젝트별 지침으로 사용

가장 단순한 방법입니다.

1. 대상 프로젝트 루트에 [AGENTS.md](AGENTS.md)를 복사하거나 기존 `AGENTS.md`에 병합합니다.
2. Codex를 해당 프로젝트에서 실행합니다.
3. Codex는 이 지침을 작업 중 행동 규칙으로 사용합니다.

## 2. Codex 플러그인으로 사용

재사용 가능한 스킬 형태로 쓰고 싶을 때 사용합니다.

```text
.agents/plugins/marketplace.json
plugins/karpathy-guidelines-ko/.codex-plugin/plugin.json
plugins/karpathy-guidelines-ko/skills/karpathy-guidelines-ko/SKILL.md
```

핵심 스킬 파일은 다음 위치입니다.

```text
plugins/karpathy-guidelines-ko/skills/karpathy-guidelines-ko/SKILL.md
```

## 포함된 한국어 지침

- 코딩 전에 가정과 불확실성을 드러내기
- 요청받지 않은 기능과 추상화를 추가하지 않기
- 필요한 줄만 외과적으로 변경하기
- 성공 기준과 검증 방법을 먼저 정하기

## 추천 사용 방식

일반 프로젝트에는 `AGENTS.md`를 사용합니다. 여러 프로젝트에서 반복해서 재사용하려면 플러그인 구조를 사용합니다.
