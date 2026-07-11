# 정밀 타이밍 로그·고급 설정 검증

## 자동 검증

- 최종 인접 클릭 시각, 오픈 대비 값과 계획 오차
- 최종 목표 클릭 시각, 오픈 대비 값과 계획 오차
- 슬롯 감지 및 슬롯 선택의 명시적인 서버 시각
- Side Panel 다중 행 타이밍 문자열과 밀리초 세 자리
- 사전 시작 50ms 허용, 125ms 거부
- 배포 HTML의 50ms step과 고급 설정 설명

## 완료 게이트

```bash
npm run check
git diff --check
```

실제 Catchtable 지연값은 확장 새로고침 후 동일 조건을 여러 번 실행해 비교한다.

## 검증 결과

- `npm run check`: 성공
- 단위·fixture 테스트: 111개 통과
- dist 및 저장소 독립성 검사: 성공
- `git diff --check`: 성공
