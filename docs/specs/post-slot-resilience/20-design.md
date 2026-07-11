# 후속 화면 복원력 설계

## 판별 모델

부동소수점 confidence 대신 `exact | supported | unknown`을 사용한다.

- `exact`: 알려진 정확 `aria-label`과 단계가 일치한다.
- `supported`: 정규화한 dialog 제목과 단계 고유 control 구조가 함께 일치한다.
- `unknown`: 위 조건을 충족하지 않는다.

## Snapshot

`DialogSnapshot`은 최신 visible dialog에서 다음 허용 정보만 추출한다.

```text
URL 종류, 접근성 라벨, 제목, 버튼 문구·disabled 상태,
radio/checkbox/수량 control 개수, 예약금 0원 control 존재 여부, fingerprint
```

fingerprint는 허용 정보의 정규화된 구조를 해시하며 입력값과 전체 DOM은 포함하지 않는다.

## 실행 계약

```text
captureDialogSnapshot
→ classifyDialog
→ decide action
→ capture/classify again
→ kind와 fingerprint 재검증
→ DOM target 재조회
→ 1회 행동
```

화면이 바뀌면 `waiting`, 증거가 부족하면 `unknown`, 금지된 결제 흐름이면 `blocked`를 반환한다.

## 단계별 필수 조건

- 테이블: 알려진 라벨 또는 테이블 선택 제목과 radio 구조
- 메뉴: 알려진 라벨 또는 메뉴 선택 제목과 checkbox/수량 구조
- 추가 상품: 추가 상품 제목과 `다음` 진행 버튼
- 예약금 안내: 예약금 안내 제목과 `확인` 버튼
- 예약금 방법: 예약금 결제 방법 제목 또는 0원 control과 진행 버튼
- 폼 안내: 예약 폼 URL과 활성 `확인했어요` 버튼

정확 라벨 화면은 전환 중 control이 아직 없거나 모두 disabled여도 기존처럼 단계로 판별하고 행동 단계에서 대기한다.
