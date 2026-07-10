# Karpathy Guidelines 한국어 Codex 플러그인

이 플러그인은 Codex에서 사용할 수 있는 한국어 행동 지침 스킬을 제공합니다.

## 포함된 스킬

- `karpathy-guidelines-ko`: 코딩, 리뷰, 리팩터링 시 가정을 드러내고, 과설계를 피하며, 최소 변경과 검증 가능한 성공 기준을 유지하도록 돕는 스킬

## 파일 구조

```text
.codex-plugin/plugin.json
skills/karpathy-guidelines-ko/SKILL.md
```

## 사용 예

```text
karpathy-guidelines-ko 스킬 기준으로 이 PR을 리뷰해줘.
```

```text
이 버그를 수정하기 전에 가정, 선택지, 성공 기준을 먼저 정리해줘.
```

```text
과설계 없이 요청 범위 안에서만 구현해줘.
```
