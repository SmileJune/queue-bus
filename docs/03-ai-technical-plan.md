# QueueBus AI 기술 적용 계획

## AI 적용 원칙

QueueBus의 AI는 공정한 순번을 대체하지 않습니다. 순번은 위치 인증 완료 시점 기준 선착순으로 부여하고, AI는 예측과 운영 최적화에만 사용합니다.

AI가 하지 않는 일:

- 대기 순번 결정
- 특정 사람 우선 탑승 판단
- 줄 순서 임의 변경
- 기사에게 강제 정차 명령

AI가 하는 일:

- 대기 수요 예측
- 차량별 탑승 가능 인원 예측
- 사용자별 탑승 가능성 예측
- 호출 인원·호출 타이밍 최적화
- 혼잡·위험 예측
- 노쇼·위치조작 이상탐지

## 1. Demand Forecast AI

### 목표

특정 정류장, 노선, 시간대에 몇 명이 대기할지 예측합니다.

### 입력 데이터

- station_id
- route_id
- 요일, 시간대
- 과거 체크인 수
- 최근 대기열 길이
- 버스 배차 간격
- 날씨, 기온
- 공휴일 여부
- 이전 차량 탑승 실패 추정치

### 출력 데이터

- 예상 대기 인원
- 혼잡도 등급: 낮음, 보통, 높음, 위험
- 예상 평균 대기시간
- 운영자 알림

### MVP 모델

- 요일/시간대별 이동평균
- 최근 3~5개 차량 도착 전 대기열 평균
- 날씨 위험 가중치

### 고도화 모델

- LightGBM 또는 XGBoost 회귀 모델
- Prophet, ARIMA, Temporal Fusion Transformer 등 시계열 모델
- 이벤트/날씨/학기/공휴일 변수를 결합한 수요 예측 모델

### 예측 로직 예시

```text
expectedWaitingCount =
  timeSlotAverage
  * weatherMultiplier
  + recentQueueDelta
  + failedBoardingCarryOver
```

### 평가 지표

- MAE: 예상 대기 인원과 실제 대기 인원의 평균 절대 오차
- MAPE: 시간대별 수요 예측 오차율
- 혼잡 등급 정확도
- 운영자 알림의 Precision/Recall

## 2. SeatFlow AI

### 목표

이번 버스가 목표 정류장에 도착했을 때 몇 명을 더 태울 수 있을지 예측합니다.

### 입력 데이터

- 현재 차량 잔여좌석
- 현재 차량이 위치한 정류장 순번
- 목표 정류장까지 남은 정류장 수
- 중간 정류장별 과거 탑승/하차 패턴
- 요일, 시간대
- 배차 간격
- 만차 발생 이력
- 날씨

### 출력 데이터

- 목표 정류장 도착 시 예상 잔여좌석
- 예상 탑승 가능 인원
- 만차 가능성
- 예측 신뢰도

### MVP 모델

현재 잔여좌석과 남은 정류장 수 기반 휴리스틱을 사용합니다.

```text
expectedRemainingSeats =
  currentRemainingSeats
  - expectedBoardingBeforeTarget
  + expectedAlightingBeforeTarget

expectedBoardingBeforeTarget =
  averageBoardingPerStop * remainingStopsToTarget

expectedAlightingBeforeTarget =
  averageAlightingPerStop * remainingStopsToTarget
```

### 고도화 모델

- 정류장별 승하차 패턴 회귀 모델
- 차량/노선/시간대별 잔여좌석 예측 모델
- 실시간 버스 위치 및 배차 간격을 반영한 온라인 업데이트

### 평가 지표

- 예상 잔여좌석 MAE
- 만차 예측 AUC
- 호출 인원 대비 실제 탑승 성공률
- 과소 호출/과다 호출 비율

## 3. Boarding Probability AI

### 목표

사용자에게 이번 차량 또는 다음 차량을 탈 수 있는 가능성을 확률로 안내합니다.

### 입력 데이터

- 내 대기번호
- 내 앞 대기 인원
- 현재 대기열 길이
- 이번 차량 예상 탑승 가능 인원
- 앞순번 노쇼율
- 버스 도착 예정 시간
- 과거 같은 시간대 탑승 성공률

### 출력 데이터

- 다음 차량 탑승 가능성
- 다음다음 차량 탑승 가능성
- 예상 대기시간
- 사용자 안내 문구

### MVP 모델

```text
expectedNoShowCount = queuePositionBeforeMe * noShowRate
effectivePosition = queuePosition - expectedNoShowCount

if effectivePosition <= expectedRemainingSeats:
  probability = high
else if effectivePosition <= expectedRemainingSeats + expectedNoShowCount + 3:
  probability = medium
else:
  probability = low
```

### 고도화 모델

- 로지스틱 회귀 또는 Gradient Boosting 기반 탑승 성공 확률 예측
- 사용자 행동 이력은 개인 식별성이 낮은 통계 변수로만 사용
- 대기열 변화와 버스 위치 업데이트에 따른 확률 재계산

### 평가 지표

- Brier Score
- Calibration Error
- 탑승 성공/실패 분류 정확도
- 사용자 안내 문구 만족도

## 4. Call Optimizer AI

### 목표

몇 명을 언제 기존 노선 대기 위치로 호출하고, 호출 대상 대기번호 구간을 어떻게 안내할지 결정합니다.

### 입력 데이터

- 예상 탑승 가능 인원
- 현재 대기열 순번
- 예상 노쇼율
- 한 번에 호출할 최대 인원 수
- 버스 ETA
- 사용자 평균 이동 시간
- 정렬 버퍼
- 정류장 앞 혼잡도
- 날씨 위험도

### 출력 데이터

- 호출 대상 대기번호 구간
- 호출 인원
- 사용자별 내 앞 대기 인원
- 호출 시점
- 예비 호출 여부

### MVP 모델

```text
callCount =
  min(maxCallCount, ceil(expectedRemainingSeats / (1 - noShowRate)))

callTimeBeforeArrival =
  averageWalkToQueueSeconds + alignmentBufferSeconds
```

예상 탑승 가능 인원이 8명이고 예상 노쇼율이 20%라면 호출 인원은 `ceil(8 / 0.8) = 10명`입니다.

### 고도화 모델

- 정류장별 평균 이동 시간과 응답 지연 패턴 학습
- 혼잡도가 높거나 폭염 위험이 높을 때 호출 인원을 보수적으로 조정
- 실시간 응답률에 따른 예비 호출 자동 판단

### 평가 지표

- 호출 응답률
- 호출 후 평균 기존 노선 대기 위치 도착 시간
- 호출 인원 대비 실제 탑승률
- 미도착 자동 스킵 비율

## 5. Congestion & Risk AI

### 목표

정류장 혼잡과 안전 위험을 예측해 운영자에게 제공합니다.

### 입력 데이터

- 현재 대기 인원
- 예상 평균 대기시간
- 정류장 보행로 폭 또는 점유 위험
- 날씨 위험 점수
- 버스 ETA
- 반복 만차 이력
- 민원 또는 현장 관찰 메모

### 출력 데이터

- 혼잡 위험 등급: 낮음, 보통, 높음, 위험
- 폭염/한파/우천 대기 위험
- 예상 최대 대기 인원
- 운영 권고

### MVP 모델

```text
congestionScore =
  waitingCount * 0.5
  + expectedWaitMinutes * 0.3
  + weatherRiskScore * 0.2

riskLevel:
  0~30 낮음
  31~60 보통
  61~80 높음
  81~100 위험
```

### 고도화 모델

- 시간대별 혼잡 위험 분류 모델
- 폭염/한파 영향 변수를 반영한 위험 점수 학습
- 현장 관찰 데이터와 민원 데이터를 결합한 위험 예측

### 평가 지표

- 위험 등급 예측 정확도
- 보행로 점유 위험 예측 Recall
- 폭염/한파 경고의 적시성
- 운영 권고 적용 후 혼잡 감소율

## 6. 이상탐지

### 목표

가상 줄서기 악용을 방지하고 서비스 공정성을 유지합니다.

### 탐지 대상

- 호출 후 반복 미도착
- 정류장 반경 밖 이탈
- GPS 순간이동
- 여러 계정 중복 체크인
- 위치 조작 의심 패턴

### MVP 모델

규칙 기반 탐지로 시작합니다.

- 체크인 후 100m 반경 밖 이탈이 일정 시간 이상 지속되면 대기열 유지 경고
- 호출 후 반복 미도착 횟수가 기준을 넘으면 다음 체크인 시 안내 강화
- 비정상적으로 빠른 위치 이동은 위치 재인증 요청

### 고도화 모델

- Isolation Forest 기반 이상 점수
- 위치 변화량, 호출 응답률, 계정 행동 패턴 기반 비지도 탐지
- 개인 제재보다 재인증과 안내 중심의 완화적 정책

### 평가 지표

- 위치조작 의심 탐지 Precision/Recall
- 정상 사용자의 오탐률
- 재인증 후 정상 복귀율
- 반복 노쇼 감소율
