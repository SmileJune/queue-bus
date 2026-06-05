# GBIS 데이터 수집 절차

## 목표

경기도 GBIS의 실시간 버스 위치/도착 API를 주기적으로 호출해 차량별 잔여좌석 스냅샷을 누적합니다. 이후 같은 차량이 목표 정류장을 통과하기 전후의 잔여좌석 차이로 최소 탑승 인원을 추정합니다.

MVP 가정은 `하차 인원 0명`입니다. 따라서 좌석이 줄어든 만큼을 탑승 인원으로 보고, 통과 후 잔여좌석이 0석이면 실제 대기 수요는 관측값 이상으로 표시합니다.

## 1. API 키 준비

공공데이터포털에서 경기도 버스 API 활용신청 후 인증키를 발급받습니다. 가능하면 `Decoding` 키를 사용합니다.

```bash
export GBIS_SERVICE_KEY="발급받은 Decoding 인증키"
export GBIS_SERVICE_KEY_2="추가 Decoding 인증키"
```

이미 URL 인코딩된 키만 사용할 경우 다음 값을 함께 지정합니다.

```bash
export GBIS_SERVICE_KEY_IS_ENCODED=1
export GBIS_SERVICE_KEY_2_IS_ENCODED=1
```

2개 키가 있으면 위치 API는 KST 00:00~11:59에 1번 키, 12:00~23:59에 2번 키를 사용합니다. 도착 API는 `동탄→서울` 방향을 1번 키, `서울→동탄` 방향을 2번 키로 나눠 사용합니다.

선택된 키에서 HTTP 429가 발생하면 같은 호출을 다른 키로 1회 재시도합니다. 설정된 모든 키가 429를 반환하면 호출은 실패 처리하고, 알림 웹훅이 설정된 경우 알림을 보냅니다.

```bash
export GBIS_ALERT_WEBHOOK_URL="Slack/Discord/Google Chat incoming webhook URL"
export GBIS_ALERT_WEBHOOK_FORMAT="slack" # discord를 쓰면 discord
export GBIS_ALERT_COOLDOWN_MINUTES=60
```

## 2. 후보 노선/정류소 ID 찾기

노선 검색:

```bash
npm run gbis:lookup -- route M5107
```

정류소 검색:

```bash
npm run gbis:lookup -- station 강남역
```

정류소를 지나는 노선과 정류소 순번 확인:

```bash
npm run gbis:lookup -- station-routes <stationId>
```

노선의 전체 경유 정류소와 `stationSeq` 확인:

```bash
npm run gbis:lookup -- route-stations <routeId>
```

수집 설정에는 `routeId`, `targetStationId`, `targetStationSeq`, `staOrder`가 필요합니다. `station-routes`의 `staOrder`와 `route-stations`의 `stationSeq`가 같은 목표 정류장을 가리키는지 확인합니다.

## 3. 수집 대상 설정

예시 파일을 복사합니다.

```bash
cp data/gbis-targets.example.json data/gbis-targets.json
```

`data/gbis-targets.json`에서 대상 노선과 정류소를 채우고 `enabled`를 `true`로 바꿉니다.

```json
{
  "pollIntervalSeconds": 60,
  "outputPath": "data/gbis-seat-snapshots.csv",
  "targets": [
    {
      "enabled": true,
      "label": "gangnam-m5107-evening",
      "routeId": "replace-with-gbis-route-id",
      "routeName": "M5107",
      "targetStationId": "replace-with-gbis-station-id",
      "targetStationName": "강남역 광역버스 정류장",
      "targetStationSeq": 15,
      "staOrder": 15
    }
  ]
}
```

## 4. 스냅샷 수집

한 번만 호출해서 파일 형식과 API 응답을 확인합니다.

```bash
npm run gbis:collect:once
```

퇴근/출근 시간대 또는 미니PC에서 계속 누적합니다.

```bash
npm run gbis:collect
```

상시 수집 기본 설정은 `pollIntervalSeconds: 60`, `includeArrivalSnapshots: false`입니다. 이 경우 같은 노선의 위치 API를 60초마다 1회 호출합니다. 위치 스냅샷은 대상 정류장 수만큼 반복 저장하지 않고, 노선/차량 단위로 1행만 저장합니다. 정류장별 도착 API까지 켜면 호출량과 저장 행이 대상 정류장 수만큼 늘어나므로 짧은 검증 때만 사용합니다.

```bash
npm run gbis:collect:once -- --arrivals true
```

도착 API만 확인할 때는 위치 스냅샷을 끄고 실행합니다.

```bash
npm run gbis:collect:once -- --locations false --arrivals true
```

피크 시간대 자동 보강 수집은 다음 스크립트를 사용합니다. 평일 출근 06:30~09:30, 평일 퇴근 16:00~20:30, 휴일/주말 외출 10:00~14:00, 휴일/주말 복귀 16:00~20:00 KST에만 실제 GBIS 호출을 하고, 그 외 시간에는 바로 종료합니다. 활성 창에 맞는 방향의 정류장만 호출합니다.

```bash
npm run gbis:collect:peak-arrivals
```

누적 파일:

```text
data/gbis-seat-snapshots.csv
```

주요 컬럼:

- `snapshot_type`: `location` 또는 `arrival`
- `kst_date`, `kst_time`, `kst_weekday`: KST 기준 날짜, 시각, 요일
- `kst_minute_of_day`, `kst_time_bucket_15m`: 시간대 집계용 분 단위 값과 15분 버킷
- `is_weekday`, `is_holiday`, `day_type`, `time_peak_window`: 평일/휴일 구분과 활성 피크 창
- `target_label`: `location`은 `route-<routeId>-location`, `arrival`은 대상 정류장 라벨
- `target_direction`: 대상 정류장 방향. `arrival` 행에 채워지고 route-level `location` 행은 비워둡니다.
- `veh_id`: 차량 ID
- `current_station_seq`: 현재 차량 정류소 순번
- `state_cd`: 0 교차로통과, 1 정류소 도착, 2 정류소 출발
- `remain_seat_count`: 차내 빈자리 수. `-1`은 정보 없음
- `predict_time_sec`: 도착 예정 초

기존 중복 저장 CSV를 정리할 때는 다음 명령을 사용합니다.

```bash
npm run gbis:compact -- --out data/gbis-seat-snapshots.compact.csv
```

compaction은 `arrival` 행은 그대로 유지하고, `location` 행만 `collected_at + route_id + vehicle + current_station_seq + remain_seat_count` 기준으로 중복 제거합니다.

## 5. 탑승 인원 추정치 생성

스냅샷을 기반으로 목표 정류장 통과 전후 좌석 차이를 계산합니다.

```bash
npm run gbis:derive
```

출력 파일:

```text
data/gbis-boarded-estimates.csv
```

계산식:

```text
estimated_boarded_count =
  max(before_remain_seat_count - after_remain_seat_count, 0)

if after_remain_seat_count == 0:
  demand_lower_bound = max(before_remain_seat_count, estimated_boarded_count)
  is_demand_censored = true
```

`notes`에 `seat_count_increased`가 있으면 하차 발생 또는 API 갱신 타이밍 차이 가능성이 있으므로 해당 차량은 수기 검토 대상으로 둡니다.

## 운영 메모

- 실제 PoC 전에는 10~15분 정도 짧게 수집해 `remain_seat_count`가 후보 노선에서 정상 제공되는지 먼저 확인합니다.
- 동일 차량 추적은 차량번호보다 `veh_id`를 우선합니다.
- 수집 주기는 60초부터 시작합니다. 너무 촘촘한 호출은 트래픽 한도와 이용 정책을 확인한 뒤 조정합니다.
- 정류장 통과 후 좌석 감소가 즉시 반영되지 않을 수 있으므로, 초기 분석에서는 원본 스냅샷과 추정 결과를 함께 봅니다.
