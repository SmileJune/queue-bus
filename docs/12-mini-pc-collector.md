# 미니PC GBIS 상시 수집 운영

## 결론

미니PC에서 상시 수집하는 방식은 QueueBus PoC에 적합합니다. GBIS 수집은 CPU보다 네트워크 안정성과 디스크 관리가 중요하므로, 저전력 미니PC나 라즈베리파이급 장비로 충분합니다.

다만 24시간 상시 수집에서는 API 호출량을 줄여야 합니다. 현재 설정은 같은 `routeId`에 대해 위치 API를 60초마다 1회 호출하고, 정류장별 도착 API는 기본으로 끕니다.

```text
60초 간격 위치 API 1회 = 하루 약 1,440회

2개 키를 12시간씩 나눠 쓰면 위치 API는 키당 하루 약 720회입니다.
```

공공데이터포털 기본 트래픽 한도 안에서 운영하기 쉬운 수준입니다. 위치 스냅샷은 노선/차량 단위로 저장하므로 대상 정류장 수가 늘어나도 기본 저장량은 차량 수에 비례합니다. 정류장별 도착 API를 켜면 대상 정류장 수만큼 호출과 저장량이 늘어나므로, 짧은 검증 시간대에만 사용합니다.

## 권장 장비/환경

- Ubuntu Server 22.04 또는 24.04 LTS
- 유선 LAN 권장
- Node.js 18 이상
- 디스크 여유 공간 20GB 이상
- 시간대: `Asia/Seoul`

## 1. 미니PC 준비

```bash
sudo timedatectl set-timezone Asia/Seoul
node -v
npm -v
```

Node.js가 없다면 설치 후 저장소를 배치합니다. 예시는 `/home/queuebus/queue-bus` 기준입니다.

```bash
sudo adduser --disabled-password --gecos "" queuebus
sudo mkdir -p /home/queuebus
sudo chown -R queuebus:queuebus /home/queuebus
```

프로젝트를 미니PC에 복사한 뒤:

```bash
cd /home/queuebus/queue-bus
npm ci
```

## 2. 인증키 설정

미니PC의 프로젝트 루트에 `.env`를 둡니다.

```bash
GBIS_SERVICE_KEY=공공데이터포털_Decoding_인증키
GBIS_SERVICE_KEY_IS_ENCODED=0
GBIS_SERVICE_KEY_2=공공데이터포털_추가_Decoding_인증키
GBIS_SERVICE_KEY_2_IS_ENCODED=0
```

`.env`는 `.gitignore`에 포함되어 있으므로 커밋하지 않습니다.

2개 키가 있으면 위치 API는 KST 00:00~11:59에 1번 키, 12:00~23:59에 2번 키를 사용합니다. 피크 도착 API는 `동탄→서울` 방향을 1번 키, `서울→동탄` 방향을 2번 키로 나눠 사용합니다.

선택된 키에서 HTTP 429가 발생하면 같은 호출을 다른 키로 1회 재시도합니다. 두 키가 모두 429를 반환하면 호출은 실패 처리하고, 알림 웹훅이 설정된 경우 알림을 보냅니다.

```bash
GBIS_ALERT_WEBHOOK_URL=Slack/Discord/Google_Chat_incoming_webhook_URL
GBIS_ALERT_WEBHOOK_FORMAT=slack
GBIS_ALERT_COOLDOWN_MINUTES=60
```

## 3. 수집 설정 확인

현재 기본 설정:

```json
{
  "pollIntervalSeconds": 60,
  "includeArrivalSnapshots": false,
  "outputPath": "data/gbis-seat-snapshots.csv"
}
```

한 번만 테스트합니다.

```bash
npm run gbis:collect:once
npm run gbis:summarize
```

정류장별 도착 API까지 임시로 확인할 때만 다음처럼 실행합니다.

```bash
npm run gbis:collect:once -- --arrivals true
```

피크 시간대 도착 API 보강 수집은 별도 스크립트가 담당합니다. 평일 06:30~09:30, 16:00~20:30 KST와 휴일/주말 10:00~14:00, 16:00~20:00 KST 안에서만 호출하고, 그 외 시간에는 호출 없이 종료합니다. 활성 창의 방향만 호출해 API 호출량을 줄입니다.

```bash
npm run gbis:collect:peak-arrivals -- --dry-run
```

## 4. systemd 등록

서비스 파일의 `User`와 `WorkingDirectory`가 실제 경로와 맞는지 확인합니다.

```bash
sudo cp deploy/systemd/queuebus-gbis-collector.service /etc/systemd/system/
sudo cp deploy/systemd/queuebus-gbis-derive.service /etc/systemd/system/
sudo cp deploy/systemd/queuebus-gbis-derive.timer /etc/systemd/system/
sudo cp deploy/systemd/queuebus-gbis-dashboard.service /etc/systemd/system/
sudo cp deploy/systemd/queuebus-gbis-peak-arrivals.service /etc/systemd/system/
sudo cp deploy/systemd/queuebus-gbis-peak-arrivals.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now queuebus-gbis-collector.service
sudo systemctl enable --now queuebus-gbis-derive.timer
sudo systemctl enable --now queuebus-gbis-dashboard.service
sudo systemctl enable --now queuebus-gbis-peak-arrivals.timer
```

상태 확인:

```bash
systemctl status queuebus-gbis-collector.service
systemctl status queuebus-gbis-dashboard.service
systemctl list-timers queuebus-gbis-derive.timer
journalctl -u queuebus-gbis-collector.service -f
```

중지:

```bash
sudo systemctl stop queuebus-gbis-collector.service
sudo systemctl stop queuebus-gbis-derive.timer
sudo systemctl stop queuebus-gbis-dashboard.service
```

현재 SSH 접속 유저 홈 디렉터리에서 바로 운영할 때는 user systemd unit을 사용할 수 있습니다. 예시는 `~/queue-bus` 기준입니다.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd-user/* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now queuebus-gbis-collector.service
systemctl --user enable --now queuebus-gbis-derive.timer
systemctl --user enable --now queuebus-gbis-dashboard.service
systemctl --user enable --now queuebus-gbis-peak-arrivals.timer
```

재부팅 후 로그인 세션 없이도 user unit이 떠야 하면 한 번만 lingering을 켭니다.

```bash
sudo loginctl enable-linger "$USER"
```

## 5. 대시보드

미니PC에서 다음 명령으로 직접 실행할 수 있습니다.

```bash
npm run gbis:dashboard
```

기본 포트는 `4175`입니다.

```text
http://미니PC_IP:4175
```

대시보드 설계와 화면 구성은 `docs/13-dashboard-design.md`에 정리합니다.

## 6. 운영 루틴

매일 또는 수집 후 확인:

```bash
npm run gbis:summarize
```

데이터 파일:

- `data/gbis-seat-snapshots.csv`
- `data/gbis-boarded-estimates.csv`

장기 운영 시 CSV가 커집니다. 1~2주 단위로 백업하고 압축합니다.

```bash
mkdir -p data/archive
cp data/gbis-seat-snapshots.csv "data/archive/gbis-seat-snapshots-$(date +%F).csv"
gzip "data/archive/gbis-seat-snapshots-$(date +%F).csv"
```

중복 저장된 과거 위치 행을 줄일 때:

```bash
npm run gbis:compact -- --out data/gbis-seat-snapshots.compact.csv
cp data/gbis-seat-snapshots.csv "data/archive/gbis-seat-snapshots-before-compact-$(date +%F).csv"
mv data/gbis-seat-snapshots.compact.csv data/gbis-seat-snapshots.csv
npm run gbis:derive
```

## 판단 기준

미니PC가 적합한 경우:

- 집/사무실에서 계속 켜둘 수 있음
- 유선 인터넷이 안정적임
- 공공데이터 호출 키를 외부 서버에 두기 싫음
- PoC 기간이 1~4주 정도임

VPS나 클라우드가 더 나은 경우:

- 정전/공유기 재부팅으로 끊기면 안 됨
- 원격 접속과 백업을 안정적으로 관리해야 함
- 여러 노선을 동시에 장기간 수집해야 함
