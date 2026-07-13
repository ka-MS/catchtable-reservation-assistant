# RT-06 예약금 안내 다음 버튼 분석

## 문제

비스트로 꼬꼬뜨 실측에서 `예약금 안내` dialog의 진행 버튼이 `확인`이 아니라 `다음`이었다. inspect는 exact `deposit_notice`로 성공하지만 `advanceDepositNotice()`가 `확인`만 찾아 차단한다.

```text
dialog: 예약금 안내
buttons: 이전 | 다음
text: 예약금 안내 / 인원에 따른 예약 보증금 / 1인당 10,000원 / 2명 / 합계 20,000원
```

## 현재 계약

- exact: dialog `aria-label`이 `예약금 안내`면 `deposit_notice`
- supported: 제목에 `예약금 안내`, 0원 결제 control 없음, `확인` 버튼 존재
- action: `확인`만 클릭

## 결정

예약금 안내로 먼저 분류된 화면에 한해 `확인` 또는 `다음`을 진행 버튼으로 인정한다. `이전`, 유료 결제 선택, 약관, 최종 예약은 대상이 아니다. 일반 unknown dialog의 `다음`은 클릭하지 않는다.
