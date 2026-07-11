# 단조 서버 시계 검증

## 자동 검증

- 앵커 이후 monotonic 경과 시간 반영
- 재앵커 시 서버 epoch 기준 교체
- wall clock이 실행 중 5초 이동해도 목표 클릭 스케줄 유지
- wall clock 점프 중 HEAD RTT를 monotonic 시간으로 계산
- 오픈 직전 재동기화와 기존 deadline 회귀
- 사전 시작 0·200·3000ms에서 동일한 오픈 5초 전 재동기화
- 긴 사전 시작에서 토글을 지연하지 않는 조기 재동기화
- 카운트다운이 계산 완료된 단조 서버 시각을 중복 보정 없이 표시

## 완료 게이트

```bash
npm run check
git diff --check
```

## 결과

- `npm run check` 통과
- 단위·fixture 테스트 118개 통과
- `dist` 검증 및 모듈 독립성 검증 통과
- `git diff --check` 통과

실사이트에서는 로컬 로그 시각과 서버 상세 시각이 의도적으로 다를 수 있으며, 오픈 대비 지연은 서버 상세 시각을 기준으로 판독한다.
