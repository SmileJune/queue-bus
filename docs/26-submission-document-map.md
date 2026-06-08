# 제출 문서 구성 맵

목적: 문서와 데이터가 많아졌으므로, 공식 제출 파일에 무엇을 넣고 무엇은 내부 근거로만 보관할지 정리합니다.

## 1. 공식 제출 파일 4종

| 공식 제출 파일 | 넣을 내용 | 원천 파일 | 비고 |
| --- | --- | --- | --- |
| `아이디어_QueueBus팀_참가신청서.pdf` | 팀명, 대표자, 연락처, 지원분야, 서비스명, 개인정보성 기본 정보 | 공식 양식, [27-application-copy-paste.md](/Users/yun-iljun/programming/queue-bus/docs/27-application-copy-paste.md), [02-one-page-summary.md](/Users/yun-iljun/programming/queue-bus/docs/02-one-page-summary.md), [submission/pdf/아이디어_QueueBus팀_참가신청서.pdf](/Users/yun-iljun/programming/queue-bus/submission/pdf/아이디어_QueueBus팀_참가신청서.pdf) | 개인정보 입력 및 서명/날인 필요 |
| `아이디어_QueueBus팀_사업계획서.pdf` | QueueBus 본문 전체, 표, 도표, 프로토타입 캡처 | [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md), [27-application-copy-paste.md](/Users/yun-iljun/programming/queue-bus/docs/27-application-copy-paste.md), [submission/pdf/아이디어_QueueBus팀_사업계획서.pdf](/Users/yun-iljun/programming/queue-bus/submission/pdf/아이디어_QueueBus팀_사업계획서.pdf) | PDF 제출본 생성 |
| `아이디어_QueueBus팀_동의서.pdf` | 개인정보수집·이용동의서 및 서약서 | 공식 양식, [submission/pdf/아이디어_QueueBus팀_동의서.pdf](/Users/yun-iljun/programming/queue-bus/submission/pdf/아이디어_QueueBus팀_동의서.pdf) | 개인정보 입력, 동의 체크, 대표자 서명/날인 필요 |
| `아이디어_QueueBus팀_신분증사본.pdf` | 청년 1인 이상 신분증 사본 | 사용자 준비 | 주민등록번호 뒷자리 등 불필요 정보 마스킹 |

## 2. 사업계획서 본문에 직접 넣을 내용

최종 제출용 사업계획서는 [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md)를 기준으로 작성합니다. 다른 문서는 원천 근거일 뿐, 그대로 모두 붙이지 않습니다.

| 사업계획서 위치 | 넣을 내용 | 원천 파일 |
| --- | --- | --- |
| 표지/개요 | 서비스명, 한 줄 정의, 좌석예약이 아니라 위치 인증형 정류장 대기 관리라는 포지션 | [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md), [02-one-page-summary.md](/Users/yun-iljun/programming/queue-bus/docs/02-one-page-summary.md) |
| 핵심 검증 상태 | 검증된 사실, 현재 가정, PoC 검증 항목 | [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md) |
| 문제 인식 | 줄서기, 탑승 불확실성, 보행로 점유, 운영 데이터 부족 | [01-business-plan-draft.md](/Users/yun-iljun/programming/queue-bus/docs/01-business-plan-draft.md), [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md) |
| 현장 실사 | 2026-06-02 이주택지 관찰 결과, 미탑승 발생 사례 | [field-observation-2026-06-02.csv](/Users/yun-iljun/programming/queue-bus/data/field-observation-2026-06-02.csv), [17-field-observation-pack.md](/Users/yun-iljun/programming/queue-bus/docs/17-field-observation-pack.md) |
| GBIS 예비 검증 | M4137 잔여좌석 데이터, 0석 신호, 10석 이하 신호 | [15-gbis-evidence-report.md](/Users/yun-iljun/programming/queue-bus/docs/15-gbis-evidence-report.md), [gbis-evening-station-buckets.csv](/Users/yun-iljun/programming/queue-bus/data/gbis-evening-station-buckets.csv) |
| 해결 방안/서비스 흐름 | 위치 인증, 대기번호, 내 앞 대기 인원, 호출 보류/다음차 안내 | [06-service-flow.md](/Users/yun-iljun/programming/queue-bus/docs/06-service-flow.md), [07-differentiation.md](/Users/yun-iljun/programming/queue-bus/docs/07-differentiation.md) |
| LBS 활용 | 사용자 위치, 정류장 좌표, 버스 위치, 위치 이탈, 주변 대기 공간 | [03-ai-technical-plan.md](/Users/yun-iljun/programming/queue-bus/docs/03-ai-technical-plan.md), [25-service-operations-architecture.md](/Users/yun-iljun/programming/queue-bus/docs/25-service-operations-architecture.md) |
| AI 활용 | SeatFlow AI, Boarding Probability, Call Optimizer, 위험 감지 | [20-ai-mvp-design.md](/Users/yun-iljun/programming/queue-bus/docs/20-ai-mvp-design.md), [21-ai-model-catalog.md](/Users/yun-iljun/programming/queue-bus/docs/21-ai-model-catalog.md), [22-ai-training-validation-plan.md](/Users/yun-iljun/programming/queue-bus/docs/22-ai-training-validation-plan.md) |
| 모델 검증 | LightGBM baseline 대비 개선, 보수 호출 정책 | [23-seatflow-model-report.md](/Users/yun-iljun/programming/queue-bus/docs/23-seatflow-model-report.md), [24-seatflow-model-comparison.md](/Users/yun-iljun/programming/queue-bus/docs/24-seatflow-model-comparison.md), [seatflow-model-comparison.json](/Users/yun-iljun/programming/queue-bus/data/seatflow-model-comparison.json) |
| 시장성/BM | 초기 후보 정류장, 지자체 PoC, SaaS 과금, 운수사 리포트 | [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md), [05-competition-fit.md](/Users/yun-iljun/programming/queue-bus/docs/05-competition-fit.md) |
| 개인정보/리스크 | 위치정보 최소 수집, 집계 대시보드, GPS 오차, 노쇼, 앱 미사용자 대응 | [25-service-operations-architecture.md](/Users/yun-iljun/programming/queue-bus/docs/25-service-operations-architecture.md), [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md) |
| PoC 계획/KPI | 정류장 1곳, 노선 1~2개, 대기시간 감소, 호출 응답률, 미탑승 감지율 | [04-poc-plan.md](/Users/yun-iljun/programming/queue-bus/docs/04-poc-plan.md), [16-submission-prep-checklist.md](/Users/yun-iljun/programming/queue-bus/docs/16-submission-prep-checklist.md) |
| 팀 역량/일정 | 산출물 기반 실행 근거, 공모전 이후 1개월 실행계획 | [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md) |

## 3. 사업계획서에 넣을 이미지

HWP/PDF에는 PNG 또는 JPG를 우선 삽입합니다. SVG는 원본 수정용으로만 보관합니다.

| 삽입 위치 | 이미지 파일 | 캡션 방향 |
| --- | --- | --- |
| 1장 또는 기술성 | [queuebus-service-flow.png](/Users/yun-iljun/programming/queue-bus/docs/assets/queuebus-service-flow.png) | 좌석예약이 아닌 위치 인증형 대기 관리 흐름 |
| 데이터 근거 | [gbis-evening-station-risk.png](/Users/yun-iljun/programming/queue-bus/docs/assets/gbis-evening-station-risk.png) | 다음 버스 승차 가능성 판단 근거 |
| 기술성/시장성 | [gbis-evening-heatmap.png](/Users/yun-iljun/programming/queue-bus/docs/assets/gbis-evening-heatmap.png) | 시간대별 호출 보류/다음차 안내 필요 구간 |
| 개인정보 보호 | [privacy-data-flow.png](/Users/yun-iljun/programming/queue-bus/docs/assets/privacy-data-flow.png) | 개인 위치 대신 집계 지표 중심 운영 |
| 기술 구현 | [prototype-passenger-checkin.jpg](/Users/yun-iljun/programming/queue-bus/docs/assets/prototype-passenger-checkin.jpg) | 위치 인증, 대기번호, 호출 보류 사용자 화면 |
| PoC 계획 | [prototype-operator-dashboard.jpg](/Users/yun-iljun/programming/queue-bus/docs/assets/prototype-operator-dashboard.jpg) | 운영자 미탑승 위험 감지 화면 |
| AI 활용 | [prototype-ai-prediction.jpg](/Users/yun-iljun/programming/queue-bus/docs/assets/prototype-ai-prediction.jpg) | SeatFlow AI와 보수 호출 정책 |

## 4. 제출서에는 직접 넣지 말고 내부 근거로 둘 파일

| 파일 | 용도 | 제출서 반영 방식 |
| --- | --- | --- |
| [09-data-api-survey.md](/Users/yun-iljun/programming/queue-bus/docs/09-data-api-survey.md) | 버스정보 API 조사 | 본문에는 “GBIS 공식 API 활용 가능” 정도만 요약 |
| [10-gbis-data-collection.md](/Users/yun-iljun/programming/queue-bus/docs/10-gbis-data-collection.md) | GBIS 수집 방법 | 부록 또는 질의응답 대비 |
| [11-m4137-dongtan-targets.md](/Users/yun-iljun/programming/queue-bus/docs/11-m4137-dongtan-targets.md) | M4137 대상 정류장 정의 | 본문에는 후보 정류장 표만 요약 |
| [12-mini-pc-collector.md](/Users/yun-iljun/programming/queue-bus/docs/12-mini-pc-collector.md) | 미니PC 수집기 운영 | 제출서 본문에는 넣지 않음 |
| [13-dashboard-design.md](/Users/yun-iljun/programming/queue-bus/docs/13-dashboard-design.md) | 대시보드 설계 상세 | 프로토타입 캡처와 운영자 가치로 요약 |
| [14-analysis-data-requirements.md](/Users/yun-iljun/programming/queue-bus/docs/14-analysis-data-requirements.md) | 분석 데이터 요구사항 | PoC 계획 내부 근거 |
| [20-ai-mvp-design.md](/Users/yun-iljun/programming/queue-bus/docs/20-ai-mvp-design.md) | AI MVP 범위 | 본문 AI 섹션에 요약 |
| [21-ai-model-catalog.md](/Users/yun-iljun/programming/queue-bus/docs/21-ai-model-catalog.md) | AI 모듈 전체 목록 | 너무 길게 넣지 말고 핵심 5~6개만 표로 사용 |
| [22-ai-training-validation-plan.md](/Users/yun-iljun/programming/queue-bus/docs/22-ai-training-validation-plan.md) | 학습·검증 계획 | 과적합 방지 문단으로 요약 |
| [25-service-operations-architecture.md](/Users/yun-iljun/programming/queue-bus/docs/25-service-operations-architecture.md) | 운영·이벤트 로그 설계 | 리스크 대응표와 운영 구조로 요약 |

## 5. 제출하지 않을 파일

다음은 개발·운영용 파일입니다. 공식 이메일 제출물에 첨부하지 않습니다.

| 분류 | 파일/폴더 |
| --- | --- |
| React 앱 소스 | `src/`, `index.html`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts` |
| 데이터 수집 스크립트 | `scripts/` |
| systemd 배포 설정 | `deploy/` |
| 원시/학습 데이터 | `data/*.csv`, `data/*.json` 전체 |
| SVG 원본 | `docs/assets/*.svg` |

단, 발표나 심사 질의응답에서 기술 구현 증빙이 필요하면 Git 저장소 또는 화면 시연으로 보여줄 수 있습니다.

## 6. 최종 작업 순서

1. 공식 양식에 [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md)를 20페이지 이내로 이관합니다.
2. 위 이미지 7개 중 핵심 5~7개를 본문에 삽입합니다.
3. 대표자·팀원 개인정보, 청년 요건, 서명/날인을 채웁니다.
4. 파일명을 `아이디어_QueueBus팀_참가신청서.pdf`, `아이디어_QueueBus팀_사업계획서.pdf`, `아이디어_QueueBus팀_동의서.pdf`, `아이디어_QueueBus팀_신분증사본.pdf`로 맞춥니다.
5. 제출 전 PDF에서 이미지 깨짐, 페이지 수, 파일명, 서명 누락을 확인합니다.
