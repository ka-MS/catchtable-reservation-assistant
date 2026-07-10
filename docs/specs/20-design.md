# 20. 설계 - 1차 DINING 예약 어댑터

**상태:** passed  
**작성:** 2026-07-10  
**근거:** [10-analysis.md](10-analysis.md)

## 목표와 경계

이 설계는 로그인된 Chrome의 Catchtable `DINING` 예약 페이지 한 흐름만 지원한다. 감지와 비최종 클릭은 Content Script에서 끝내고, Side Panel과 Service Worker는 설정·상태 전달만 담당한다.

자동화는 조건과 일치하는 시간 슬롯 선택, 조건부 테이블 타입 선택, 예약금 안내의 비최종 `확인`까지만 진행한다. 결제 정보 입력 화면, 약관 동의, CAPTCHA, 로그인, 최종 예약 버튼은 항상 사용자 인계 상태다.

## 사용자 설정

필수 설정은 기존 사양대로 식당 URL, 날짜, 인원, 희망 시작·종료 시간이다.

선택 설정에 `tableTypePreference`를 추가한다.

| 값 | 동작 |
| --- | --- |
| `none` (기본값) | 테이블 타입 대화상자가 나타나면 자동화를 멈추고 사용자에게 인계 |
| `hall` | 활성화된 `홀` 라디오만 선택 |
| `room` | 활성화된 `룸` 라디오만 선택 |
| `bar` | 활성화된 `바` 라디오만 선택 |

기본값에서 첫 번째 테이블 타입을 임의로 선택하지 않는다. 좌석 유형은 예약 조건이며, 빠른 클릭보다 잘못된 좌석 선택을 막는 것이 우선이다. 대화상자가 아예 나타나지 않으면 이 설정과 관계없이 다음 단계로 진행한다.

## 구성과 메시지

| 구성 요소 | 책임 |
| --- | --- |
| Side Panel | 설정 입력·검증, 감시 시작/중지, 현재 상태 및 마지막 결과 표시 |
| Service Worker | 설정을 `chrome.storage`에 저장, 활성 탭으로 명령 중계, Side Panel에 상태 전달 |
| Content Script | 현재 페이지의 DOM 관찰·상태 판별·즉시 클릭·중복 클릭 차단 |

메시지 형식은 판별 경로를 지연시키지 않는 작은 객체로 고정한다.

```ts
type Command =
  | { type: "START"; config: ReservationConfig }
  | { type: "STOP" };

type StatusEvent = {
  type: "STATUS";
  state: AutomationState;
  detail: string;
  at: number;
  retryCount: number;
};
```

`ReservationConfig`와 `AutomationState`는 공유 TypeScript 모듈에 두고, Content Script는 마지막 수신 설정을 메모리에 보관한다. 후보 발견에서 클릭 호출까지 `chrome.runtime.sendMessage` 또는 저장소 쓰기를 하지 않는다.

Content Script는 주입 직후 `CONTENT_READY`를 보낸다. Service Worker는 저장된 감시 탭·설정과 발신 탭이 일치할 때만 `START`를 다시 전달한다. 따라서 감시 탭의 새로고침 또는 동일 탭의 페이지 재진입 뒤에는 감시가 복구되고, 다른 탭에는 설정이 전파되지 않는다.

확장이 이미 열린 탭에 설치된 경우에는 `START` 메시지 전달 실패를 감지해 Service Worker가 `content/index.js`를 현재 탭에 한 번 주입한 뒤 같은 명령을 재전달한다. 이 경로에는 `scripting` 권한만 추가하며, 대상은 설정을 시작한 Catchtable 탭으로 한정한다.

## DOM 어댑터 계약

선택자는 관찰 근거가 있는 ARIA와 사용자에게 보이는 텍스트만 사용한다. 해시된 CSS class와 시간 텍스트만으로 한 노드를 특정하지 않는다.

| 어댑터 함수 | 판별·동작 |
| --- | --- |
| `readSelection()` | 접근 가능한 이름이 날짜·인원 형식인 단일 버튼과 현재 URL의 `date`, `personCount`를 읽어 설정과 비교 |
| `findMatchingSlot()` | `main button[aria-disabled]`에서 표시 중인 노드만 남기고, `aria-disabled="false"`와 `data-busy="false"`이며 시간 범위와 일치하는 단일 슬롯을 반환 |
| `clickSlotOnce()` | 슬롯의 안정 키와 클릭 세대를 기록한 뒤 동기 `click()` 호출 |
| `findTableTypeDialog()` | 보이는 대화상자의 라디오와 `다음` 버튼을 찾음. 대화상자가 없으면 `null` |
| `selectConfiguredTableType()` | 설정된 라벨과 일치하고 활성화된 라디오를 선택한 뒤 `다음`을 한 번 클릭 |
| `findDepositNotice()` | 제목 `예약금 안내`와 보이는 단일 `확인` 버튼을 함께 확인 |
| `confirmDepositNotice()` | 검증된 안내 대화상자의 `확인`을 한 번 클릭 |
| `detectUserHandoff()` | 약관 동의 UI 또는 `자동결제로 예약하기`를 찾으면 사용자 인계 |

표시 여부는 `getBoundingClientRect().width > 0 && height > 0`으로 검사한다. 각 버튼은 클릭 직전에 연결 상태와 비활성 상태를 다시 검사한다. 한 감시 세대에서 클릭한 슬롯·대화상자 버튼은 `WeakSet`과 상태 키로 중복을 막는다.

## 상태 전이

```text
IDLE -> ARMED -> WATCHING

WATCHING -> CANDIDATE -> ACTING_SLOT -> VERIFYING_NEXT
VERIFYING_NEXT -> TABLE_TYPE_SELECT    (테이블 타입 대화상자 존재)
VERIFYING_NEXT -> DEPOSIT_NOTICE       (예약금 안내 존재)
VERIFYING_NEXT -> PAUSED_USER          (결제·약관·최종 예약 UI 존재)
VERIFYING_NEXT -> RETRYING             (후보 슬롯 소진 또는 전이 시간 초과)

TABLE_TYPE_SELECT -> DEPOSIT_NOTICE    (설정된 활성 타입 선택 성공)
TABLE_TYPE_SELECT -> PAUSED_USER       (선호 없음·선호 타입 없음)

DEPOSIT_NOTICE -> VERIFYING_NEXT       (비최종 확인 클릭)

RETRYING -> WATCHING                    (새 DOM 변이 또는 제한적 재확인)
모든 감시 상태 -> STOPPED              (사용자 중지 또는 종료 시각)
```

`PAUSED_USER`는 성공 상태가 아니다. 안내 메시지는 구체적으로 `테이블 타입 선택 필요`, `최종 약관 또는 결제 확인 필요`, `로그인 또는 CAPTCHA 확인 필요`, `페이지 구조 인식 실패` 중 하나를 표시한다.

## 관찰과 재시도

- `MutationObserver`는 `document.documentElement` 하위의 `childList`, `subtree`, `attributes`를 관찰한다. 속성 관찰은 `aria-disabled`, `data-busy`, `aria-hidden`, `disabled`로 제한한다.
- 여러 변이가 한 번에 들어오면 동일 task 안에서 한 번만 평가한다. 다음 렌더링 세대는 새 평가 기회가 된다.
- 전이 대기 중에는 250ms 간격의 제한적 확인 타이머를 사용하며, 10초 안에 기대 화면이 나타나지 않으면 `RETRYING` 또는 명시적 `PAUSED_USER`로 전환한다.
- 자동 새로고침, 반복 클릭, 새 탭 열기는 사용하지 않는다. `RETRYING`은 다음 유효 DOM 변이 또는 제한적 확인에서만 후보를 다시 찾는다.

## 성능 및 측정

Content Script는 평가 시작 시각과 실제 `element.click()` 호출 시각을 `performance.now()`로 기록한다. 모의 DOM에서 100회 이상 후보 삽입을 실행해 p95가 50ms 이하인지 계산한다. 이 수치는 서버 응답, 화면 전환, 결제 페이지 로드 시간은 포함하지 않는다.

## 검증 설계

| 계층 | 검증 대상 |
| --- | --- |
| 단위 | 표시 중인 슬롯 필터링, 시간 범위, 중복 클릭 키, 테이블 타입 선호, 예약금 안내·결제 인계 판별 |
| 모의 DOM | 후보 슬롯 추가 후 1회 클릭, 노드 재렌더링, 테이블 타입 유무, 예약금 확인, 사용자 인계, 실패 후 재감시 |
| 실제 Chrome | `kea` DINING 화면에서 슬롯·조건부 대화상자·예약금 안내·결제 사용자 인계를 읽기 전용으로 재확인 |

## 미확인 사항과 보수적 처리

- `data-busy`의 전체 의미와 슬롯 소진 DOM은 아직 확인되지 않았다. `aria-disabled` 또는 `data-busy`가 예상과 다르거나 전이 시간이 초과되면 클릭을 반복하지 않고 `RETRYING`으로 간다.
- 로그인·CAPTCHA·예약 완료의 구체 DOM은 아직 확인되지 않았다. 인식하지 못한 전이 화면은 자동으로 진행하지 않고 `PAUSED_USER`로 간다.
- 날짜·인원 변경 UI는 1차 구현에서 자동 조작하지 않는다. Side Panel의 설정은 현재 예약 페이지의 선택 상태와 일치할 때만 감시를 시작한다.
