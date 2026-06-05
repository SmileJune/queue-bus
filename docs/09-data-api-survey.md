# QueueBus 데이터/API 조사

조사일: 2026-05-28

## 결론

QueueBus PoC에서 잔여좌석 변화량으로 탑승 인원을 추정하려면 1순위는 경기도 GBIS API입니다. 경기 API는 `remainSeatCnt`가 명시되어 있고, 차량 ID, 차량번호, 정류소 순번, 상태코드까지 함께 받을 수 있어 정류장 통과 전후 스냅샷을 만들기 가장 좋습니다.

서울 API도 일부 광역버스에서 잔여좌석으로 해석 가능한 값을 제공합니다. 다만 필드 설명이 `재차인원 또는 잔여좌석수(routeType = 6)`처럼 조건부라서, 실제 후보 노선 호출 결과를 보고 노선별 의미를 검증해야 합니다.

전국 TAGO, TMAP, 카카오, 네이버, ODsay 계열은 위치/도착/경로 보강에는 쓸 수 있지만, 공개 문서 기준으로 QueueBus의 좌석 변화량 추정에 바로 쓸 수 있는 명확한 잔여좌석 API는 확인되지 않았습니다.

## 공공데이터

| 구분 | 제공자 | API/데이터 | QueueBus 활용 | 좌석수 적합도 | 확인 결과 |
| --- | --- | --- | --- | --- | --- |
| 1순위 | 경기도 GBIS | 버스위치정보 조회 | 노선별 운행 차량 전체의 현재 정류소 순번, 차량 ID, 잔여좌석 추적 | 높음 | `getBusLocationListv2` 응답에 `remainSeatCnt`, `stationSeq`, `stateCd`, `vehId`, `plateNo`가 있음 |
| 1순위 | 경기도 GBIS | 버스도착정보 조회 | 대상 정류장 기준 1·2번째 도착 차량 ETA와 잔여좌석 조회 | 높음 | `remainSeatCnt1`, `remainSeatCnt2`, `predictTimeSec1/2`, `vehId1/2`가 있음 |
| 1순위 | 경기도 GBIS | 정류소/노선 조회 | 정류소 ID, 노선 ID, 노선유형, 경유 정류소 순번 매핑 | 높음 | 정류소 검색, 노선 검색, 경유 정류소 목록으로 ID 매핑 가능 |
| 2순위 | 서울특별시 | 버스도착정보조회 서비스 | 서울 광역버스의 도착 차량별 혼잡/만차/좌석 추정 | 중간 | `brdrde_Num`, `reride_Num`가 조건부로 재차인원 또는 잔여좌석수 의미를 가짐 |
| 2순위 | 서울특별시 | 버스위치정보조회 서비스 | 차량 위치, 차량번호, 혼잡도, 정류소 도착 여부 | 중간 | 위치 API에는 명확한 잔여좌석 필드보다 `congetion` 중심 |
| 2순위 | 서울특별시 | 정류소/노선 정보 조회 | 서울 정류소 ID, ARS ID, 노선 ID, 노선별 경유 정류소 매핑 | 높음 | 정류소명/좌표/노선 경유 정보 조회 가능 |
| 보조 | 국토교통부 TAGO | 버스도착정보 | 전국 정류소별 ETA 보강 | 낮음 | 공식 상세 페이지 기준 실시간 도착정보는 가능하지만 잔여좌석 필드는 확인되지 않음 |
| 보조 | 인천교통정보센터 | 버스정보/OPEN-API | 인천 노선 후보 확장 시 별도 확인 | 미확정 | 공식 센터에 OPEN-API 메뉴와 버스정보시스템은 있으나, 공개 문서 기준 좌석 필드까지는 확인 필요 |

## 사설/상용 API

| 구분 | 제공자 | API/서비스 | QueueBus 활용 | 좌석수 적합도 | 확인 결과 |
| --- | --- | --- | --- | --- | --- |
| 보조 | ODsay | 대중교통 정보/길찾기 API | 정류장·노선·도착정보 보강, 공공데이터 연동 보조 | 낮음 | 실시간 버스 위치/도착 API는 있으나, 실시간 도착정보는 공공데이터 제공 지역에 종속된다고 안내 |
| 보조 | TMAP Mobility | TMAP 대중교통 API | 출발지/목적지 대중교통 경로, 보행 경로, 정류장 경로 정보 | 낮음 | 경로 탐색 API 중심이며 잔여좌석 필드는 확인되지 않음 |
| 보조 | Kakao Mobility | 내비/길찾기 API | 자동차 길찾기, 미래 운행 정보, 위치 기반 보조 | 낮음 | 공식 길찾기 API는 자동차/경로 중심. 카카오맵 API는 대중교통 정류장·노선·실시간 위치정보를 제공하지 않는다고 안내 |
| 보조 | Kakao Maps | 지도/로컬 API | 지도 표시, 장소/주소 검색, 정류장 주변 POI 보조 | 낮음 | 지도/로컬 기능 중심. 버스 실시간 데이터는 별도 API로 제공하지 않음 |
| 보조 | NAVER Maps | 지도/경로 API | 지도 표시, 좌표/장소/일반 경로 보조 | 낮음 | 공개 지도 API는 지도·경로 중심으로 확인. 버스 잔여좌석 API는 확인되지 않음 |

## MVP 수집 설계

경기 광역/직행좌석 노선을 PoC 후보로 잡는 경우 다음 방식이 가장 현실적입니다.

1. `getBusRouteListv2`로 노선번호를 검색해 `routeId`와 `routeTypeCd`를 확보합니다.
2. `getBusStationListv2` 또는 주변 정류소 조회로 정류소 `stationId`와 좌표를 확보합니다.
3. 경유 정류소 목록으로 목표 정류장의 `stationSeq` 또는 `staOrder`를 매핑합니다.
4. `getBusLocationListv2`를 주기적으로 호출해 `vehId`, `stationSeq`, `stateCd`, `remainSeatCnt`를 저장합니다.
5. 차량이 목표 정류장 직전/도착/출발 상태를 지나는 동안의 좌석 스냅샷 차이를 계산합니다.
6. 하차 인원은 MVP에서 0명으로 둡니다.

```text
estimatedBoardedCount =
  max(beforeRemainSeatCount - afterRemainSeatCount, 0)

if afterRemainSeatCount == 0:
  demandLowerBound = estimatedBoardedCount
  demandCensored = true
```

`afterRemainSeatCount`가 0이면 실제 대기 수요는 관측값보다 클 수 있으므로 `n명 이상`으로 표시합니다.

실제 수집 스크립트와 실행 절차는 `docs/10-gbis-data-collection.md`에 정리합니다.

## 주의사항

- 잔여좌석은 승객 수요의 직접 관측값이 아니라 좌석 변화의 간접 관측값입니다.
- 중간 하차 인원을 0명으로 두면 탑승 인원은 보수적으로 과소/과대 추정될 수 있습니다. 특히 누군가 하차하면 실제 탑승 인원은 `before - after`보다 더 많을 수 있습니다.
- 동일 차량을 추적하려면 차량번호보다 `vehId`를 우선 사용하고, API별 `vehId` 제공 여부와 갱신 주기를 실호출로 검증해야 합니다.
- 서울 API의 `brdrde_Num`, `reride_Num`은 노선유형과 구분 필드에 따라 의미가 달라질 수 있으므로 실제 후보 노선별 샘플 호출 검증이 필요합니다.
- 네이버지도/카카오맵 화면 크롤링은 사용하지 않습니다. 공식 API, 공개 데이터, 수기 관찰, 사용자 동의 기반 앱 이벤트만 사용합니다.

## 확인 출처

- 경기도 버스도착정보 조회: https://www.data.go.kr/data/15080346/openapi.do
- 경기버스정보 버스도착정보 목록조회 매뉴얼: https://gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrivalStation
- 경기버스정보 버스도착정보 항목조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusArrival
- 경기버스정보 버스위치정보 목록조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusLocation
- 경기버스정보 노선번호 목록조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusRoute
- 경기버스정보 경유정류소 목록조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusRouteStation
- 경기버스정보 정류소명/번호 목록조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusStation
- 경기버스정보 정류소 경유노선 목록조회 매뉴얼: https://www.gbis.go.kr/gbis2014/publicService.action?cmd=mBusStationRoute
- 서울특별시 버스도착정보조회 서비스: https://www.data.go.kr/data/15000314/openapi.do
- 서울특별시 버스위치정보조회 서비스: https://www.data.go.kr/data/15000332/openapi.do
- 서울 열린데이터광장 버스운행정보: https://data.seoul.go.kr/dataList/19/literacyView.do
- 국토교통부 TAGO 버스도착정보: https://www.data.go.kr/data/15098530/openapi.do
- 인천교통정보센터: https://www.fitic.go.kr/
- ODsay LAB 가이드: https://lab.odsay.com/guide/guide
- TMAP 대중교통 API: https://transit.tmapmobility.com/docs/routes
- Kakao Mobility 길찾기 API: https://developers.kakaomobility.com/guide/navi-api/start.html
- Kakao Maps API: https://apis.map.kakao.com/
- Kakao DevTalk 대중교통 API 제공 여부 답변: https://devtalk.kakao.com/t/api/144613
