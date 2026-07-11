# 설정 히스토리·즐겨찾기 설계

**상태:** 승인

## 저장 모델

```ts
interface SavedConfig {
  id: string;
  savedAt: number;
  fingerprint: string;
  config: ReservationConfig;
}
```

- 키: `configHistory`, `configFavorites`
- 각각 최대 20건, 최신순
- ID: `crypto.randomUUID()`
- fingerprint: 정규화 URL, 예약 날짜, 인원, 희망 시간, 우선순위, 테이블 타입, 메뉴 키워드
- 같은 fingerprint는 새 snapshot으로 대체한다.
- `openAtMs`, `stopAtMs`, 실행 모드 등 전체 config는 최신 값으로 갱신한다.

## 저장 시점

- 히스토리: Background가 유효한 START 명령을 접수해 pending run을 만든 직후 저장
- 즐겨찾기: Side Panel의 명시적 저장 명령
- 폼 복원: 과거 오픈·종료 시각도 변경 없이 채움. 다음 START에서 기존 검증이 안내한다.

## 소유권

- 조회: Side Panel의 `storage.local.get`과 `storage.onChanged`
- 변경: Background 메시지로 직렬 처리
- 리스트 계산: `shared/saved-configs.ts` 순수 함수
- UI 렌더링: `sidepanel/saved-configs-view.ts`

## 메시지

- `SAVE_FAVORITE(config)`
- `DELETE_SAVED(list, id)`
- `CLEAR_SAVED(list)`

## UI

- 실행 요약 아래 접힌 `최근 설정` 영역
- 히스토리/즐겨찾기 탭
- 행 본문 클릭으로 폼 복원
- 행 삭제 아이콘과 탭 전체 삭제 아이콘
- 즐겨찾기 탭에 현재 설정 저장 버튼
- 전체 삭제만 사용자 확인

## 비범위

- 성공·실패 결과 연동
- 즐겨찾기 이름 편집
- 내보내기·가져오기
- 자동 실행 스케줄링
