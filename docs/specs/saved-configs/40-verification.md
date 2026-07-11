# 설정 히스토리·즐겨찾기 검증

## 자동 검증

- 같은 예약 의도의 최신 snapshot 대체와 최대 20건 제한
- URL·메뉴 키워드 정규화와 실행 시각 제외 fingerprint
- storage repository의 저장·단건 삭제·전체 삭제
- 손상된 snapshot 폐기, 최신순 정렬과 fingerprint 복구
- 지난 오픈 일시 snapshot의 폼 변환 허용과 구조 오류 차단
- 히스토리·즐겨찾기 탭, 행 복원, 수동 저장과 삭제 이벤트
- Side Panel 정적 배포물과 전체 기존 기능 회귀

## 완료 게이트

```bash
npm run check
git diff --check
```

## 수동 확인

확장 새로고침 후 실제 Side Panel에서 히스토리 자동 추가, 즐겨찾기 저장, 폼 복원, 단건·전체 삭제를 확인한다. 저장 항목을 불러오는 동작만으로 오픈런이 시작되지 않아야 한다.

## 검증 결과

- `npm run check`: 성공
- 단위·fixture 테스트: 102개 통과
- dist 및 저장소 독립성 검사: 성공
- `git diff --check`: 성공
- 420px 정적 Side Panel 렌더: 입력 grid 단일 열 전환, 가로 넘침 없음
