# CLAUDE.md

@AGENTS.md

## Claude Code 전용 지침

위 import로 모든 AI의 공통 작업 기준을 불러옵니다. 이 파일에는
Claude Code에만 필요한 사용법만 둡니다.

- Catchtable 실사이트 실측과 확장 E2E 작업에는
  `.claude/skills/catchtable-recon/`을 사용합니다.
- Chrome과 확장을 조작할 때는
  `.claude/skills/use-chrome-devtools/`을 따르고, `claude-in-chrome`보다
  프로젝트 `.mcp.json`의 `chrome-devtools` 서버를 우선합니다.
- 본격적인 Chrome 작업 전
  `docs/testing/chrome-devtools-mcp-ai-guide.md`를 읽습니다.
- 확장 ID, 버전과 로드 경로는 저장된 예시를 가정하지 말고 현재
  Chrome에서 확인합니다.
- 제품 상태, 아키텍처와 정책을 이 파일에 복사하지 않습니다. 현재
  기준은 `docs/README.md`에서 확인합니다.
