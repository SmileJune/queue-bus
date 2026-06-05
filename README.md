# QueueBus

QueueBus는 광역버스 정류장의 물리적 줄서기를 위치정보 기반 가상 대기열로 전환해, 이용자가 정류장 앞에 계속 서 있지 않아도 내 순번과 다음 버스 승차 가능성을 알 수 있게 하는 LBS 기반 대중교통 대기 관리 PoC입니다. 축적된 대기 수요는 운수사와 운영기관에 제공되어 배차 간격 조정, 예비차 투입, 현장 안내 인력 배치의 판단 근거로 활용될 수 있습니다.

이 저장소는 2026 LBS 스타트업 챌린지 아이디어 분야 제출을 위한 문서, 데이터 템플릿, 발표용 React 프로토타입을 포함합니다. 실제 상용 서비스 개발보다 사업계획서와 PoC 설계의 완성도를 우선합니다.

## 프로젝트 목표

- QueueBus 사업계획서와 1페이지 요약서 작성
- 위치정보, AI, 개인정보 보호, PoC 검증 계획을 심사 기준에 맞게 정리
- 현장 관찰 및 mock API 데이터를 CSV로 준비
- 사용자 체크인, 가상 대기표, 내 앞 대기 인원, 다음 버스 승차 가능성, 탑승 호출, 운영자 대시보드를 보여주는 MVP 프로토타입 제공

## 실행 방법

```bash
npm install
npm run dev
```

개발 서버가 뜨면 브라우저에서 안내된 localhost URL을 열면 됩니다.

빌드 확인:

```bash
npm run build
```

## 폴더 구조

```text
docs/
  01-business-plan-draft.md
  02-one-page-summary.md
  03-ai-technical-plan.md
  04-poc-plan.md
  05-competition-fit.md
  06-service-flow.md
  07-differentiation.md
  08-application-form-business-plan.md
  09-data-api-survey.md
  10-gbis-data-collection.md
  11-m4137-dongtan-targets.md
  12-mini-pc-collector.md
  13-dashboard-design.md
  14-analysis-data-requirements.md
  15-gbis-evidence-report.md
  16-submission-prep-checklist.md
  17-field-observation-pack.md
  18-submission-visual-assets.md
deploy/
  systemd/
data/
  field-observation-template.csv
  bus-seat-sample.csv
  queuebus-sample-events.csv
  kr-holidays.json
  gbis-targets.example.json
  gbis-targets.json
  gbis-seat-snapshots.csv
  gbis-boarded-estimates.csv
src/
  App.tsx
  data/mockData.ts
  lib/prediction.ts
  styles.css
  types.ts
```

## 주요 기능

- 사용자 화면: 주변 정류장 선택, 노선 선택, 위치 인증, 고정 대기번호 발급, 내 앞 대기 인원, 탑승 가능성 안내, 호출 대상 대기번호 구간
- 운영자 화면: 정류장/노선별 대기 인원, 예상 탑승 가능 인원, 호출 인원, 혼잡/기상 위험, 시간대별 대기 수요 차트, 운수사 운영 판단용 수요 신호, PoC 지표
- 예측 로직: 잔여좌석 예측, 탑승 가능성 산정, 호출 인원 계산, 호출 타이밍 계산, 혼잡 위험 점수 계산
- GBIS 수집: M4137 출근 동탄→서울, 퇴근 서울→동탄 잔여좌석 스냅샷 누적 및 요약

## 공모전 제출 준비 흐름

1. `docs/01-business-plan-draft.md`를 팀 상황과 실제 PoC 후보 정류장에 맞게 보완합니다.
2. `docs/02-one-page-summary.md`를 참가 신청서 또는 발표자료 첫 장의 요약 문장으로 활용합니다.
3. `docs/08-application-form-business-plan.md`를 HWP 사업계획서 양식에 맞춰 옮겨 적습니다.
4. `docs/09-data-api-survey.md`로 실제 연동 가능한 버스정보 API와 잔여좌석 필드 근거를 확인합니다.
5. `docs/10-gbis-data-collection.md` 절차에 따라 경기도 GBIS 잔여좌석 스냅샷을 누적합니다.
6. `docs/05-competition-fit.md`로 아이디어 분야 평가지표별 강점을 점검합니다.
7. `data/field-observation-template.csv`로 현장 관찰 데이터를 1회 이상 수집합니다.
8. `docs/16-submission-prep-checklist.md`와 `docs/17-field-observation-pack.md`로 제출 전 준비와 현장조사 동선을 점검합니다.
9. `npm run submission:assets`로 제출용 도표를 생성합니다.
10. 프로토타입을 실행해 사용자 흐름과 운영자 대시보드를 발표 시연에 사용합니다.

## 현재 가정

- MVP는 실제 버스정보 API를 호출하지 않고 mock CSV/TypeScript 데이터를 사용합니다.
- GBIS 수집 스크립트는 PoC 검증용 데이터 적재 경로이며, 프로토타입 화면은 아직 mock 데이터를 기본값으로 사용합니다.
- 위치 인증은 사용자 좌표와 정류장 좌표의 Haversine 거리 계산으로 100m 이내 체크인을 허용합니다.
- AI는 초기 PoC에서 규칙 기반/이동평균 수준으로 구현하고, 데이터 축적 후 LightGBM, XGBoost, 이상탐지 모델로 고도화합니다.
- 운영자 대시보드는 개인 단위 위치가 아니라 정류장/노선 단위 집계 데이터만 표시합니다.
