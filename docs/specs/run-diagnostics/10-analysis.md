# 실행 진단 분석

## 현재 구조

현재 실행 로그는 다음 경로를 따른다.

```text
OpenRunOrchestrator
  -> TraceLogger
  -> BatchTraceProcessor
  -> runtime.Port
  -> TraceIngestor
  -> IndexedDB runs/events
  -> Side Panel live view / CSV export
```

`captureStageSnapshot()`은 예기치 않은 터미널 전이에서 제목·버튼·160자 텍스트·fingerprint를 만들고 Trace attribute에 평탄화한다. 별도 DOM snapshot 저장소나 HTML fragment는 없다.

## 문제

- 활성 dialog가 없으면 `main`으로 폴백해 portal, fixed dock, overlay를 놓칠 수 있다.
- Trace attribute는 최대 64개, 문자열 500자로 제한돼 DOM 진단 원본을 담을 수 없다.
- 실패 순간만 보면 클릭 직전 화면이 이미 사라졌을 수 있다.
- Adapter 판별 전략과 후보 제외 이유가 단계마다 비대칭이다.
- CSV는 시간축 분석에는 적합하지만 구조화 DOM과 HTML fragment에는 부적합하다.

## 선택지

### TraceEvent에 JSON 문자열 포함

구현은 작지만 live 전송과 CSV가 비대해지고 문자열 제한에 걸린다. 제외한다.

### 별도 IndexedDB 생성

기존 DB 버전을 건드리지 않지만 실행 삭제·보관·내보내기가 두 DB로 갈린다. 제외한다.

### 같은 DB의 별도 object store

Trace와 진단 저장 계약을 분리하면서 runId로 수명주기를 묶을 수 있다. 이 방식을 선택한다.

## 위험 분석

1. **성능:** DOM 전체 직렬화는 탐색 루프에서 금지한다. 단계 전이·주요 action에서 구조 요약만 만든다.
2. **시점:** 최근 3개 breadcrumb를 ring buffer로 유지하고 실패 순간 상세 캡처와 함께 저장한다.
3. **저장 경쟁:** Content가 저장 ACK를 기다리는 `forceFlush`를 제공한다. 실패 결과 자체는 저장 실패로 바꾸지 않는다.
4. **개인정보:** HTML 전체가 아니라 활성 surface와 관련 영역만 수집하고 속성·텍스트를 허용 목록으로 재구성한다.
5. **용량:** breadcrumb에는 HTML을 넣지 않고 실패 fragment는 64KiB, 요소 목록은 종류별 24개로 제한한다.
6. **정확성:** selector 기반이 아닌 판별에는 selector를 꾸며내지 않는다. 실제 진단 query, strategy, evidence와 match count를 구분한다.

## 범위 제외

- 화면 캡처
- 네트워크 요청·응답 본문
- computed style 전체
- Shadow DOM·React 상태 복원
- 원격 수집기 전송

