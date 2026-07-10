# Karpathy Guidelines

LLM 코딩 에이전트가 흔히 만드는 실수를 줄이기 위한 지침입니다. 원본 저장소의 Claude Code 플러그인, Cursor 룰, 공통 지침 파일의 기능을 Codex와 Claude Code에서 사용할 수 있는 구조로 옮겼습니다.

원본 아이디어는 Andrej Karpathy가 지적한 LLM 코딩 문제에서 출발합니다.

- 모델이 사용자 대신 잘못된 가정을 하고 확인 없이 진행함
- 혼란, 모순, 절충점, 반대 의견을 충분히 드러내지 않음
- 코드와 API를 과하게 복잡하게 만들고 불필요한 추상화를 쌓음
- 작업과 무관한 코드, 주석, 포맷을 바꾸는 부작용을 냄

## 구성

```text
codex-karpathy-guidelines-ko/
├─ AGENTS.md
├─ EXAMPLES.md
├─ README.md
├─ .agents/plugins/marketplace.json
└─ plugins/karpathy-guidelines-ko/
   ├─ README.md
   ├─ .codex-plugin/plugin.json
   └─ skills/karpathy-guidelines-ko/SKILL.md
```

## Codex에서 사용하는 방법

### 방법 A: 프로젝트 지침으로 사용

새 프로젝트나 기존 프로젝트 루트에 `AGENTS.md` 내용을 복사하거나 병합합니다. Codex는 프로젝트 루트의 `AGENTS.md`를 작업 지침으로 읽습니다.

### 방법 B: Codex 플러그인으로 사용

이 폴더는 Codex 로컬 플러그인 마켓플레이스 구조를 포함합니다.

```powershell
cd C:\Source\andrej-karpathy-skills\codex-karpathy-guidelines-ko
```

Codex에서 로컬 플러그인 소스로 사용할 때는 이 폴더의 `.agents/plugins/marketplace.json`이 `./plugins/karpathy-guidelines-ko`를 가리킵니다. 플러그인 자체는 다음 파일로 정의됩니다.

```text
plugins/karpathy-guidelines-ko/.codex-plugin/plugin.json
```

스킬 본문은 다음 위치에 있습니다.

```text
plugins/karpathy-guidelines-ko/skills/karpathy-guidelines-ko/SKILL.md
```

## 네 가지 원칙

| 원칙 | 줄이는 문제 |
| --- | --- |
| 코딩 전에 생각하기 | 잘못된 가정, 숨겨진 혼란, 누락된 절충점 |
| 단순함 우선 | 과설계, 불필요한 추상화 |
| 외과적으로 변경하기 | 무관한 편집, 건드리지 않아야 할 코드 변경 |
| 목표 중심 실행 | 검증 없는 구현, 약한 성공 기준 |

## 핵심 사용 패턴

작업을 시작할 때는 먼저 가정과 성공 기준을 드러냅니다.

```text
가정:
- 원본 동작은 유지한다.
- 요청된 버그만 수정한다.

성공 기준:
- 버그를 재현하는 테스트가 실패한다.
- 수정 후 같은 테스트가 통과한다.
- 관련 기존 테스트가 통과한다.
```

## 원본 기능 변환 대응표

| 원본 | Codex 변환본 |
| --- | --- |
| `.claude-plugin/plugin.json` | `plugins/karpathy-guidelines-ko/.codex-plugin/plugin.json` |
| `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json` |
| `skills/karpathy-guidelines/SKILL.md` | `plugins/karpathy-guidelines-ko/skills/karpathy-guidelines-ko/SKILL.md` |
| `CLAUDE.md` | `AGENTS.md` |
| `CURSOR.md`, `.cursor/rules/...` | Codex에서는 `AGENTS.md` 또는 스킬로 대체 |
| `README.md`, `EXAMPLES.md` | 한국어 Codex 기준 문서로 재작성 |

## 커스터마이징

프로젝트별 규칙은 `AGENTS.md` 아래에 별도 섹션으로 추가합니다.

```markdown
## 프로젝트별 지침

- TypeScript strict mode를 사용한다.
- API 엔드포인트에는 테스트를 추가한다.
- `src/utils/errors.ts`의 기존 오류 처리 패턴을 따른다.
```

## 라이선스

MIT
