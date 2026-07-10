# 예시

네 가지 원칙을 실제 코드 작업에 적용하는 예시입니다. 각 예시는 LLM이 흔히 잘못하는 방식과 더 나은 대응을 함께 보여줍니다.

---

## 1. 코딩 전에 생각하기

### 예시 1: 숨겨진 가정

**사용자 요청:** "사용자 데이터 내보내기 기능을 추가해줘"

**잘못된 대응: 가정을 확인하지 않고 구현**

```python
def export_users(format='json'):
    users = User.query.all()

    if format == 'json':
        with open('users.json', 'w') as f:
            json.dump([u.to_dict() for u in users], f)
    elif format == 'csv':
        with open('users.csv', 'w') as f:
            writer = csv.DictWriter(f, fieldnames=['id', 'email', 'name'])
            writer.writeheader()
            writer.writerows([u.to_dict() for u in users])

    return f"Exported {len(users)} users"
```

문제:

- 모든 사용자를 내보내도 되는지 확인하지 않음
- 파일 위치를 임의로 정함
- 포함할 필드를 임의로 정함
- CSV 필드가 실제 데이터 구조와 맞는지 확인하지 않음

**더 나은 대응: 가정과 선택지를 먼저 드러내기**

```text
구현 전에 확인이 필요합니다.

1. 범위: 전체 사용자입니까, 필터된 일부 사용자입니까?
2. 형태: 브라우저 다운로드, 백그라운드 작업, API 응답 중 무엇입니까?
3. 필드: 어떤 사용자 필드를 포함해야 합니까? 민감 정보가 있을 수 있습니다.
4. 규모: 일반적으로 몇 명 정도를 내보냅니까?

가장 단순한 시작점은 페이지네이션된 JSON API 엔드포인트입니다.
파일 내보내기가 필요하다면 요구사항을 더 확인해야 합니다.
```

### 예시 2: 여러 해석

**사용자 요청:** "검색을 빠르게 해줘"

**잘못된 대응: 조용히 하나의 해석을 선택**

```python
@lru_cache(maxsize=1000)
async def search(query: str) -> list[Result]:
    ...
```

문제:

- 응답 시간을 줄이려는 것인지, 처리량을 늘리려는 것인지, 체감 속도를 개선하려는 것인지 확인하지 않음
- 캐싱, 비동기 처리, 인덱스 같은 해결책을 한꺼번에 추가할 위험이 있음

**더 나은 대응: 목표를 분리**

```text
"검색을 빠르게"는 세 가지로 해석될 수 있습니다.

1. 응답 시간 단축: DB 인덱스, 빈번한 쿼리 캐시
2. 동시 처리량 증가: 비동기 처리, 커넥션 풀 조정
3. 체감 속도 개선: 부분 결과, 로딩 상태, 점진적 렌더링

현재 병목을 먼저 측정한 뒤 가장 작은 변경부터 적용하겠습니다.
우선순위가 응답 시간인지 처리량인지 알려주세요.
```

---

## 2. 단순함 우선

### 예시 1: 과도한 추상화

**사용자 요청:** "할인 계산 함수를 추가해줘"

**잘못된 대응: 한 번 쓰는 로직에 전략 패턴 도입**

```python
class DiscountStrategy:
    def calculate(self, amount: float) -> float:
        raise NotImplementedError

class PercentageDiscount(DiscountStrategy):
    def __init__(self, percentage: float):
        self.percentage = percentage

    def calculate(self, amount: float) -> float:
        return amount * (self.percentage / 100)

class DiscountCalculator:
    def __init__(self, strategy: DiscountStrategy):
        self.strategy = strategy

    def apply(self, amount: float) -> float:
        return self.strategy.calculate(amount)
```

**더 나은 대응: 현재 필요한 최소 함수**

```python
def calculate_discount(amount: float, percent: float) -> float:
    return amount * (percent / 100)
```

복잡성은 여러 할인 유형이 실제 요구사항으로 등장했을 때 추가합니다.

### 예시 2: 추측성 기능

**사용자 요청:** "사용자 설정을 DB에 저장해줘"

**잘못된 대응: 캐시, 검증, 병합, 알림까지 추가**

```python
class PreferenceManager:
    def __init__(self, db, cache=None, validator=None):
        self.db = db
        self.cache = cache or InMemoryCache()
        self.validator = validator or DefaultValidator()

    def save(self, user_id: int, prefs: dict, merge: bool = True, notify: bool = False):
        ...
```

**더 나은 대응: 요청된 저장만 구현**

```python
def save_preferences(db, user_id: int, preferences: dict):
    db.execute(
        'UPDATE users SET preferences = ? WHERE id = ?',
        (json.dumps(preferences), user_id),
    )
```

캐싱, 검증, 병합은 필요가 확인된 뒤 추가합니다.

---

## 3. 외과적으로 변경하기

### 예시 1: 겸사겸사 리팩터링

**사용자 요청:** "빈 이메일에서 validator가 터지는 버그를 고쳐줘"

**잘못된 대응: 관련 없는 username 검증까지 추가**

```diff
 def validate_user(user_data):
-    if not user_data.get('email'):
+    email = user_data.get('email', '').strip()
+    if not email:
         raise ValueError('Email required')

-    if '@' not in user_data['email']:
+    if '@' not in email or '.' not in email.split('@')[1]:
         raise ValueError('Invalid email')

     if not user_data.get('username'):
         raise ValueError('Username required')
+    if len(user_data['username']) < 3:
+        raise ValueError('Username too short')
```

문제:

- 이메일 검증 범위를 요청보다 넓힘
- 사용자명 검증을 새로 추가함
- 버그 수정 외 변경이 섞임

**더 나은 대응: 빈 이메일 처리만 수정**

```diff
 def validate_user(user_data):
-    if not user_data.get('email'):
+    email = user_data.get('email', '')
+    if not email or not email.strip():
         raise ValueError('Email required')

-    if '@' not in user_data['email']:
+    if '@' not in email:
         raise ValueError('Invalid email')
```

### 예시 2: 스타일 드리프트

**사용자 요청:** "업로드 함수에 로깅을 추가해줘"

**잘못된 대응: 타입 힌트, docstring, quote style 변경까지 수행**

```diff
-def upload_file(file_path, destination):
+def upload_file(file_path: str, destination: str) -> bool:
+    """Upload file to destination."""
     ...
```

**더 나은 대응: 기존 스타일을 유지하며 로깅만 추가**

```diff
+import logging
+
+logger = logging.getLogger(__name__)
+
 def upload_file(file_path, destination):
+    logger.info(f'Starting upload: {file_path}')
     try:
         with open(file_path, 'rb') as f:
             data = f.read()
```

---

## 4. 목표 중심 실행

### 예시 1: 모호한 요청을 검증 가능한 목표로 바꾸기

**사용자 요청:** "인증 시스템을 고쳐줘"

**잘못된 대응**

```text
인증 코드를 살펴보고 문제를 찾아 개선하겠습니다.
```

**더 나은 대응**

```text
"인증 시스템 수정"은 범위가 넓습니다. 먼저 구체적인 실패 조건이 필요합니다.

예를 들어 문제가 "비밀번호 변경 후 기존 세션이 유지됨"이라면:

1. 테스트 작성: 비밀번호 변경 후 기존 세션이 무효화되는지 확인
   검증: 테스트가 현재 실패해야 함
2. 구현: 비밀번호 변경 시 세션 무효화
   검증: 새 테스트 통과
3. 회귀 확인: 기존 인증 테스트 실행
   검증: 기존 테스트 통과
```

### 예시 2: 테스트 우선 검증

**사용자 요청:** "점수가 같은 항목이 있으면 정렬이 깨져"

**더 나은 대응**

```python
def test_sort_with_duplicate_scores():
    scores = [
        {'name': 'Alice', 'score': 100},
        {'name': 'Bob', 'score': 100},
        {'name': 'Charlie', 'score': 90},
    ]

    result = sort_scores(scores)

    assert result == [
        {'name': 'Alice', 'score': 100},
        {'name': 'Bob', 'score': 100},
        {'name': 'Charlie', 'score': 90},
    ]

def sort_scores(scores):
    return sorted(scores, key=lambda x: (-x['score'], x['name']))
```

검증 순서:

1. 버그를 재현하는 테스트를 먼저 작성합니다.
2. 테스트가 실패하는지 확인합니다.
3. 정렬 기준을 수정합니다.
4. 새 테스트와 기존 테스트가 통과하는지 확인합니다.

---

## 안티패턴 요약

| 원칙 | 안티패턴 | 수정 방향 |
| --- | --- | --- |
| 코딩 전에 생각하기 | 파일 형식, 필드, 범위를 조용히 가정 | 가정을 말하고 확인 |
| 단순함 우선 | 단일 계산에 전략 패턴 도입 | 필요한 함수 하나로 시작 |
| 외과적으로 변경하기 | 버그 수정 중 포맷, 타입 힌트, 주변 로직 변경 | 보고된 문제에 필요한 줄만 변경 |
| 목표 중심 실행 | "코드를 살펴보고 개선" | 재현 테스트, 수정, 회귀 검증으로 분리 |

좋은 코드는 언젠가 필요할지도 모르는 문제를 미리 크게 해결하는 코드가 아니라, 오늘의 문제를 간단하고 검증 가능하게 해결하는 코드입니다.
