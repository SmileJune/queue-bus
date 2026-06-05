# 제출 준비 체크리스트

확인일: 2026-05-30  
대상: 2026 LBS 스타트업 챌린지 아이디어 분야  
팀명 가칭: QueueBus 팀

## 1. 공식 제출 기준

| 항목 | 내용 |
| --- | --- |
| 모집 기간 | 2026-05-11(월) ~ 2026-06-10(수) 16:00 |
| 제출 방법 | 이메일 제출 |
| 접수처 | LBS@kmac.co.kr |
| 공식 요강 | https://www.korealbs.or.kr/2026/contest.asp |
| 접수 안내 | https://www.korealbs.or.kr/2026/entry.asp |

공식 페이지의 접수 안내에 따르면 제출 파일명은 `지원분야_기업명(팀명)_제출서류명` 형식으로 각각 작성합니다. 아이디어 분야는 공고 시작일 기준 청년(34세 이하) 개인 또는 팀이 대상이며, 팀이면 청년 1인 이상이 포함되어야 합니다.

## 2. 제출 파일 목록

| 파일 | 제출 형식 | 현재 상태 | 담당 |
| --- | --- | --- | --- |
| `아이디어_QueueBus팀_참가신청서.pdf` | 대표자 서명/날인 PDF | 공식 양식 다운로드 후 작성 필요 | 사용자 |
| `아이디어_QueueBus팀_사업계획서.hwp` 또는 PDF/Word | 사업계획서 | [08-application-form-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/08-application-form-business-plan.md) 원고 보강 중 | Codex + 사용자 |
| `아이디어_QueueBus팀_동의서.pdf` | 개인정보수집 이용동의서 및 서약서, 대표자 서명/날인 PDF | 공식 양식 다운로드 후 작성 필요 | 사용자 |
| `아이디어_QueueBus팀_신분증사본.pdf` | 청년 1인 이상 신분증 사본 | 개인정보 마스킹 후 준비 필요 | 사용자 |

사업계획서는 공식 양식에 직접 옮길 때 20페이지 이내로 유지하고, 표·그래프·현장 사진·프로토타입 캡처를 핵심 페이지만 삽입합니다.

## 3. 현장조사 전 완료할 작업

| 우선순위 | 작업 | 산출물 | 상태 |
| --- | --- | --- | --- |
| P0 | 공식 제출 요건 확인 | 본 체크리스트 | 완료 |
| P0 | 사업계획서 본문에 GBIS 객관 근거 반영 | [08-application-form-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/08-application-form-business-plan.md), [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md) | 완료 |
| P0 | 제출 근거 리포트 정리 | [15-gbis-evidence-report.md](/Users/yun-iljun/programming/queue-bus/docs/15-gbis-evidence-report.md) | 완료, 제출 전 재생성 필요 |
| P0 | 삽입용 도표 생성 | [18-submission-visual-assets.md](/Users/yun-iljun/programming/queue-bus/docs/18-submission-visual-assets.md) | 완료 |
| P1 | 현장조사 계획표 고정 | [17-field-observation-pack.md](/Users/yun-iljun/programming/queue-bus/docs/17-field-observation-pack.md) | 완료 |
| P1 | 프로토타입 화면 캡처 목록 확정 | [prototype-passenger-checkin.jpg](/Users/yun-iljun/programming/queue-bus/docs/assets/prototype-passenger-checkin.jpg), [prototype-operator-dashboard.jpg](/Users/yun-iljun/programming/queue-bus/docs/assets/prototype-operator-dashboard.jpg), [prototype-ai-prediction.jpg](/Users/yun-iljun/programming/queue-bus/docs/assets/prototype-ai-prediction.jpg) | 완료 |
| P1 | HWP 양식에 원고 이관 | 제출용 HWP | 최종 원고 작성 완료, 공식 양식 이관 필요 |
| P1 | AI MVP 구현 가능성 설명 보강 | [20-ai-mvp-design.md](/Users/yun-iljun/programming/queue-bus/docs/20-ai-mvp-design.md) | 완료 |
| P1 | AI 종류·예측기술 상세 설명 보강 | [21-ai-model-catalog.md](/Users/yun-iljun/programming/queue-bus/docs/21-ai-model-catalog.md) | 완료 |
| P1 | AI 학습·검증·과적합 방지 설계 | [22-ai-training-validation-plan.md](/Users/yun-iljun/programming/queue-bus/docs/22-ai-training-validation-plan.md) | 완료 |
| P1 | SeatFlow 학습 모델 MVP 구현 | [23-seatflow-model-report.md](/Users/yun-iljun/programming/queue-bus/docs/23-seatflow-model-report.md), [seatflow-training-dataset.csv](/Users/yun-iljun/programming/queue-bus/data/seatflow-training-dataset.csv) | 완료 |
| P1 | SeatFlow 모델 비교 및 1차 모델 선정 | [24-seatflow-model-comparison.md](/Users/yun-iljun/programming/queue-bus/docs/24-seatflow-model-comparison.md), [seatflow-model-comparison.json](/Users/yun-iljun/programming/queue-bus/data/seatflow-model-comparison.json) | 완료 |
| P1 | 실서비스 운영·이벤트 로그 설계 | [25-service-operations-architecture.md](/Users/yun-iljun/programming/queue-bus/docs/25-service-operations-architecture.md) | 완료 |
| P2 | 개인정보/위치정보 보호 구조도 삽입 | `docs/assets/privacy-data-flow.svg`, `docs/assets/privacy-data-flow.png` | 완료 |
| P2 | 서비스 흐름도 삽입 | `docs/assets/queuebus-service-flow.svg`, `docs/assets/queuebus-service-flow.png` | 완료 |

## 4. 현장조사 후에만 가능한 작업

| 작업 | 제출서 반영 위치 | 완료 기준 |
| --- | --- | --- |
| 실제 대기줄 사진 삽입 | Ⅰ-1 개발 동기, Ⅱ-1 시장성 | 선택 사항. 얼굴·차량번호 식별이 어렵고 줄 길이/보행로 점유가 보이는 사진 1~2장 |
| 관찰 CSV 정리 | 부록 또는 근거 리포트 | 완료: [field-observation-2026-06-02.csv](/Users/yun-iljun/programming/queue-bus/data/field-observation-2026-06-02.csv) |
| 실제 탑승/미탑승 수치 반영 | Ⅰ-2 필요성, Ⅳ 기술성 | 완료: [19-final-submission-business-plan.md](/Users/yun-iljun/programming/queue-bus/docs/19-final-submission-business-plan.md) |
| GBIS 추정치와 현장 관찰 비교 | Ⅳ 기술성 | 완료: 잔여좌석 2석, 하차 1명, 탑승 3명 사례 반영 |
| 최종 문구 보정 | 전체 | 완료: “GBIS 예비 근거”와 “현장 관찰 결과” 분리 |

## 5. 제출본 구성안

| 페이지 구간 | 핵심 내용 | 삽입 자료 |
| --- | --- | --- |
| 1 | 서비스 한 줄 정의, 문제 배경 | 서비스 흐름도 |
| 2~3 | 현장 문제와 필요성 | 현장 사진, GBIS 정류장별 위험 차트 |
| 4~5 | 창의성/차별성 | 기존 서비스 비교표 |
| 6~8 | 시장성/BM | PoC 확장 로드맵, 운영기관 가치 |
| 9~12 | 기술 구현 | 위치 인증, 대기열, SeatFlow 예측, 호출 정책 |
| 13~14 | 데이터 근거 | GBIS 근거 표, 15분 heatmap |
| 15 | 개인정보/위치정보 보호 | 개인정보 보호 구조도 |
| 16~17 | PoC 계획과 성과지표 | 현장조사 계획, KPI |
| 18~20 | 팀 역량, 향후 일정, 기대효과 | 제출 직전 개인정보 입력 |

## 6. 제출 전 리스크 점검

| 리스크 | 대응 |
| --- | --- |
| 공식 양식 누락 | 제출 직전 공식 홈페이지에서 양식을 다시 다운로드하고 파일명 규칙 확인 |
| 아이디어 분야 자격 착오 | 대표자/팀원 나이, 위치정보사업 보유 여부, 최근 3년 동일 아이템 수상 여부 확인 |
| GBIS 데이터 과대해석 | M4137 1개 노선 PoC 후보 근거라고 표현하고, 시장 전체 추정으로 쓰지 않음 |
| 현장 사진 개인정보 | 얼굴, 차량번호, 개인 식별 가능한 화면은 촬영하지 않거나 마스킹 |
| 제출 마감 지연 | 2026-06-10 16:00 마감이므로 전날 밤 PDF까지 확정 |
