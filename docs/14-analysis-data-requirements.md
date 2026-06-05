# 분석 데이터 요구사항

## 목적

3일 이상 수집 후 어떤 분석을 할 수 있는지 판단하기 위한 최소 데이터 목록입니다. GBIS 자동 수집은 좌석 흐름과 만차 구간 분석에 충분한 값을 제공하지만, 실제 대기 수요와 QueueBus 호출 성과는 현장 관찰 또는 앱 이벤트가 필요합니다.

## 자동 수집: GBIS

| 구분 | 컬럼 | 상태 | 용도 |
| --- | --- | --- | --- |
| 시간 | `collected_at`, `source_query_time` | 수집 중 | 수집 시각, API 조회 시각 |
| KST 파생 | `kst_date`, `kst_time`, `kst_weekday`, `kst_minute_of_day`, `kst_time_bucket_15m`, `is_weekday`, `is_holiday`, `day_type`, `time_peak_window` | 신규 수집분부터 자동 추가 | 요일/시간대/피크 분석 |
| 노선 | `route_id`, `route_name` | 수집 중 | 노선별 집계 |
| 대상 정류장 | `target_label`, `target_station_id`, `target_station_name`, `target_station_seq`, `target_sta_order`, `target_direction` | arrival 행 중심 | 정류장별 도착/피크 분석 |
| 차량 | `veh_id`, `plate_no` | 수집 중 | 차량별 좌석 변화 추적 |
| 위치 | `current_station_id`, `current_station_seq`, `state_cd` | 수집 중 | 정류장 통과 전후 판정 |
| 도착 | `arrival_rank`, `location_no`, `predict_time_sec` | 피크 보강 수집 중 | ETA, 1/2번째 도착 차량 분석 |
| 좌석 | `remain_seat_count`, `crowded` | 수집 중 | 만차/좌석 급감 분석 |
| 차량 속성 | `route_type_cd`, `low_plate`, `tagless_cd` | 수집 중 | 차량 유형 보조 변수 |
| 품질 | `result_code`, `result_message` | 수집 중 | API 응답 상태 점검 |

## 수기 관찰 필요

파일: `data/field-observation-template.csv`

| 컬럼 | 이유 |
| --- | --- |
| `waiting_count_before_bus_arrival` | 실제 대기 수요의 기준값 |
| `observed_boarded_count` | 좌석 변화 추정치 검증 |
| `observed_alighting_count` | `하차 0명` 가정 보정 |
| `left_waiting_count`, `failed_boarding_count` | 못 탄 사람 수, 이월 수요 추정 |
| `bus_arrival_time_kst`, `bus_departure_time_kst` | GBIS 시각과 현장 시각 매칭 |
| `remain_seat_before_arrival`, `remain_seat_after_departure` | GBIS 좌석 변화와 현장 관찰 연결 |
| `estimated_queue_length_meters`, `sidewalk_blocked_yn` | 보행로 점유/혼잡 완화 지표 |
| `weather`, `temperature_c`, `precipitation_yn` | 날씨 위험 가중치 검증 |

## 앱 이벤트 필요

파일: `data/queuebus-sample-events.csv`

| 이벤트 | 핵심 컬럼 | 이유 |
| --- | --- | --- |
| `check_in` | `queue_id`, `queue_position`, `queue_length_at_event`, `distance_meters` | 실제 QueueBus 대기열 생성 |
| `call_sent` | `called_queue_start`, `called_queue_end`, `vehicle_id`, `predict_time_sec` | 호출 구간/시점 분석 |
| `call_ack` | `call_sent_at`, `call_ack_at` | 호출 응답률과 응답 지연 |
| `boarded` | `boarded_at`, `wait_minutes` | 탑승 성공률과 대기시간 |
| `no_show` | `skip_reason`, `distance_meters` | 노쇼율과 위치 이탈 패턴 |
| `carried_over` | `vehicle_id`, `eta_minutes` | 다음 차량 이월 수요 |

## 3일 뒤 가능한 분석

- 정류장별 0석 발생 시간대
- 퇴근 서울→동탄 구간의 좌석 급감 정류장
- 차량별 잔여좌석 곡선
- 좌석 변화 기반 최소 탑승 인원 추정
- 피크 창별 호출·다음차 안내 신호
- 현장 관찰이 있으면 좌석 변화 추정치와 실제 탑승 인원 비교

## 피크 창

| 일자 구분 | 방향 | 창 |
| --- | --- | --- |
| 평일 | 동탄→서울 | 06:30~09:30 |
| 평일 | 서울→동탄 | 16:00~20:30 |
| 휴일/주말 | 동탄→서울 | 10:00~14:00 |
| 휴일/주말 | 서울→동탄 | 16:00~20:00 |

공휴일 목록은 `data/kr-holidays.json`에 둡니다. 주말과 공휴일은 휴일 패턴으로 보고, 활성 창의 방향만 도착 API를 호출합니다.

## 아직 불가능한 분석

- 앱 체크인 없는 순수 GBIS 데이터만으로 실제 줄 선 사람 수 추정
- 호출 응답률, 노쇼율, 호출 후 이동 시간 분석
- 개인별 탑승 가능성 모델 검증
- 날씨/공휴일 효과 분리

이 항목들은 현장 관찰 CSV와 앱 이벤트 로그가 추가돼야 가능합니다.
