import {
  AlertTriangle,
  Bell,
  Bus,
  CheckCircle2,
  Clock3,
  Gauge,
  LayoutDashboard,
  MapPin,
  Navigation,
  Route as RouteIcon,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  fieldObservationEvents,
  hourlyDemand,
  pocMetrics,
  routes,
  seatDeltaSamples,
  stations,
  vehicles,
} from "./data/mockData";
import {
  analyzeFieldObservations,
  buildPrediction,
  canCheckIn,
  estimateBoardedCountFromSeatDelta,
  haversineDistanceMeters,
} from "./lib/prediction";
import type {
  FieldAiInsight,
  FieldObservationEvent,
  PredictionResult,
  RiskLevel,
  RouteInfo,
  SeatDeltaEstimate,
  SeatDeltaSample,
  Station,
} from "./types";

type Tab = "passenger" | "operator" | "ai";
type LocationMode = "inside" | "outside";

const MAX_CALL_COUNT = 10;
const NO_SHOW_RATE = 0.2;
const WEATHER_RISK_SCORE = 82;

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("passenger");
  const [selectedStationId, setSelectedStationId] = useState("55305");
  const selectedStation =
    stations.find((station) => station.id === selectedStationId) ?? stations[0];
  const stationRoutes = routes.filter((route) => selectedStation.routes.includes(route.id));
  const [selectedRouteId, setSelectedRouteId] = useState(stationRoutes[0].id);
  const selectedRoute =
    routes.find((route) => route.id === selectedRouteId) ?? stationRoutes[0];
  const selectedVehicle =
    vehicles.find((vehicle) => vehicle.routeId === selectedRoute.id) ?? vehicles[0];
  const [locationMode, setLocationMode] = useState<LocationMode>("inside");
  const [checkedIn, setCheckedIn] = useState(false);
  const [called, setCalled] = useState(false);

  useEffect(() => {
    if (!selectedStation.routes.includes(selectedRouteId)) {
      setSelectedRouteId(selectedStation.routes[0]);
      setCheckedIn(false);
      setCalled(false);
    }
  }, [selectedRouteId, selectedStation]);

  const simulatedUserLocation = useMemo(() => {
    if (locationMode === "inside") {
      return { lat: selectedStation.lat + 0.00029, lng: selectedStation.lng + 0.0002 };
    }

    return { lat: selectedStation.lat + 0.0031, lng: selectedStation.lng + 0.0026 };
  }, [locationMode, selectedStation]);

  const distanceMeters = Math.round(
    haversineDistanceMeters(simulatedUserLocation, {
      lat: selectedStation.lat,
      lng: selectedStation.lng,
    }),
  );
  const isCheckInAllowed = canCheckIn(distanceMeters);
  const queuePosition = selectedRoute.queueLength + 1;
  const displayedQueueLength = selectedRoute.queueLength + (checkedIn ? 1 : 0);

  const prediction = buildPrediction({
    currentRemainingSeats: selectedVehicle.remainSeatCount,
    currentStationSeq: selectedVehicle.currentStationSeq,
    targetStationSeq: selectedVehicle.targetStationSeq,
    averageBoardingPerStop: selectedVehicle.averageBoardingPerStop,
    averageAlightingPerStop: selectedVehicle.averageAlightingPerStop,
    queuePosition,
    queueLength: displayedQueueLength,
    noShowRate: NO_SHOW_RATE,
    etaMinutes: selectedVehicle.etaMinutes,
    maxCallCount: MAX_CALL_COUNT,
    averageWalkToQueueSeconds: 90,
    alignmentBufferSeconds: 30,
    waitingCount: displayedQueueLength,
    expectedWaitMinutes: selectedRoute.averageWaitMinutes,
    weatherRiskScore: WEATHER_RISK_SCORE,
  });

  const peopleAhead = checkedIn
    ? called
      ? Math.min(6, Math.max(queuePosition - 1, 0))
      : Math.max(queuePosition - 1, 0)
    : 0;
  const callRangeStart = checkedIn ? Math.max(queuePosition - peopleAhead, 1) : 1;
  const callRangeEnd =
    prediction.callCount > 0 ? callRangeStart + prediction.callCount - 1 : callRangeStart;
  const selectedSeatDelta =
    seatDeltaSamples.find((sample) => sample.routeId === selectedRoute.id) ??
    seatDeltaSamples[0];
  const seatDeltaEstimate = estimateBoardedCountFromSeatDelta(
    selectedSeatDelta.beforeRemainSeatCount,
    selectedSeatDelta.afterRemainSeatCount,
  );
  const fieldAiInsight = analyzeFieldObservations(fieldObservationEvents);

  function handleStationChange(stationId: string) {
    setSelectedStationId(stationId);
    setCheckedIn(false);
    setCalled(false);
  }

  function handleRouteChange(routeId: string) {
    setSelectedRouteId(routeId);
    setCheckedIn(false);
    setCalled(false);
  }

  function handleCheckIn() {
    if (!isCheckInAllowed) return;
    setCheckedIn(true);
    setCalled(false);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">QB</div>
          <div>
            <p className="eyebrow">2026 LBS 스타트업 챌린지 아이디어 분야</p>
            <h1>QueueBus PoC</h1>
          </div>
        </div>
        <div className="topbar-summary">
          <span>위치 인증형 가상 대기열</span>
          <span>AI 호출 최적화</span>
          <span>정류장 혼잡 데이터</span>
        </div>
      </header>

      <nav className="tabbar" aria-label="QueueBus prototype tabs">
        <button
          className={activeTab === "passenger" ? "tab active" : "tab"}
          onClick={() => setActiveTab("passenger")}
          type="button"
        >
          <Ticket size={18} />
          사용자 플로우
        </button>
        <button
          className={activeTab === "operator" ? "tab active" : "tab"}
          onClick={() => setActiveTab("operator")}
          type="button"
        >
          <LayoutDashboard size={18} />
          운영자 대시보드
        </button>
        <button
          className={activeTab === "ai" ? "tab active" : "tab"}
          onClick={() => setActiveTab("ai")}
          type="button"
        >
          <Gauge size={18} />
          AI 예측 로직
        </button>
      </nav>

      {activeTab === "passenger" && (
        <PassengerFlow
          stations={stations}
          selectedStation={selectedStation}
          selectedRoute={selectedRoute}
          stationRoutes={stationRoutes}
          prediction={prediction}
          checkedIn={checkedIn}
          called={called}
          peopleAhead={peopleAhead}
          callRangeStart={callRangeStart}
          callRangeEnd={callRangeEnd}
          locationMode={locationMode}
          distanceMeters={distanceMeters}
          isCheckInAllowed={isCheckInAllowed}
          queuePosition={queuePosition}
          displayedQueueLength={displayedQueueLength}
          onStationChange={handleStationChange}
          onRouteChange={handleRouteChange}
          onLocationModeChange={setLocationMode}
          onCheckIn={handleCheckIn}
          onCall={() => {
            if (prediction.callCount > 0) {
              setCalled(true);
            }
          }}
          onReset={() => {
            setCheckedIn(false);
            setCalled(false);
          }}
        />
      )}

      {activeTab === "operator" && (
        <OperatorDashboard
          selectedStation={selectedStation}
          selectedRoute={selectedRoute}
          prediction={prediction}
          displayedQueueLength={displayedQueueLength}
          seatDeltaSample={selectedSeatDelta}
          seatDeltaEstimate={seatDeltaEstimate}
          fieldAiInsight={fieldAiInsight}
        />
      )}

      {activeTab === "ai" && (
        <AiPanel
          selectedRoute={selectedRoute}
          prediction={prediction}
          seatDeltaSample={selectedSeatDelta}
          seatDeltaEstimate={seatDeltaEstimate}
          fieldEvents={fieldObservationEvents}
          fieldAiInsight={fieldAiInsight}
          queuePosition={queuePosition}
          peopleAhead={peopleAhead}
          displayedQueueLength={displayedQueueLength}
        />
      )}
    </div>
  );
}

interface PassengerFlowProps {
  stations: Station[];
  selectedStation: Station;
  selectedRoute: RouteInfo;
  stationRoutes: RouteInfo[];
  prediction: PredictionResult;
  checkedIn: boolean;
  called: boolean;
  peopleAhead: number;
  callRangeStart: number;
  callRangeEnd: number;
  locationMode: LocationMode;
  distanceMeters: number;
  isCheckInAllowed: boolean;
  queuePosition: number;
  displayedQueueLength: number;
  onStationChange: (stationId: string) => void;
  onRouteChange: (routeId: string) => void;
  onLocationModeChange: (mode: LocationMode) => void;
  onCheckIn: () => void;
  onCall: () => void;
  onReset: () => void;
}

function PassengerFlow({
  stations,
  selectedStation,
  selectedRoute,
  stationRoutes,
  prediction,
  checkedIn,
  called,
  peopleAhead,
  callRangeStart,
  callRangeEnd,
  locationMode,
  distanceMeters,
  isCheckInAllowed,
  queuePosition,
  displayedQueueLength,
  onStationChange,
  onRouteChange,
  onLocationModeChange,
  onCheckIn,
  onCall,
  onReset,
}: PassengerFlowProps) {
  const canSimulateCall = checkedIn && prediction.callCount > 0;
  const callTitle = called
    ? "탑승 호출되었습니다"
    : prediction.callCount > 0
      ? "호출 대기 중"
      : prediction.uncertainBoardingCount > 0
        ? "호출 보류"
        : "다음차 안내";
  const callButtonLabel =
    prediction.callCount > 0
      ? "호출 상황 시뮬레이션"
      : prediction.uncertainBoardingCount > 0
        ? "호출 보류"
        : "다음차 안내";

  return (
    <main className="content-grid">
      <section className="panel stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Passenger app</p>
            <h2>사용자 화면</h2>
          </div>
          <StatusChip level={isCheckInAllowed ? "낮음" : "높음"}>
            {isCheckInAllowed ? "정류장 반경 내" : "반경 밖"}
          </StatusChip>
        </div>

        <div className="step-row" aria-label="QueueBus passenger steps">
          {["정류장", "노선", "위치 인증", "대기표", "호출"].map((step, index) => (
            <div
              className={
                index <= (called ? 4 : checkedIn ? 3 : isCheckInAllowed ? 2 : 1)
                  ? "step active"
                  : "step"
              }
              key={step}
            >
              <span>{index + 1}</span>
              {step}
            </div>
          ))}
        </div>

        <div className="card-group">
          <h3>주변 광역버스 정류장</h3>
          <div className="station-list">
            {stations.map((station) => (
              <button
                className={station.id === selectedStation.id ? "station-card selected" : "station-card"}
                key={station.id}
                onClick={() => onStationChange(station.id)}
                type="button"
              >
                <MapPin size={18} />
                <span>
                  <strong>{station.name}</strong>
                  <small>{station.distanceMeters}m · {station.waitSpace}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="card-group">
          <h3>{selectedStation.name} 노선 선택</h3>
          <div className="route-list">
            {stationRoutes.map((route) => (
              <button
                className={route.id === selectedRoute.id ? "route-card selected" : "route-card"}
                key={route.id}
                onClick={() => onRouteChange(route.id)}
                style={{ "--route-color": route.color } as CSSProperties}
                type="button"
              >
                <span className="route-badge">{route.name}</span>
                <span className="route-copy">
                  <strong>{route.destination}</strong>
                  <small>현재 {route.queueLength}명 · 예상 {route.averageWaitMinutes}분</small>
                </span>
                <StatusChip level={route.crowdLevel}>{route.crowdLevel}</StatusChip>
              </button>
            ))}
          </div>
        </div>

        <div className="verification-card">
          <div>
            <p className="eyebrow">Geofencing</p>
            <h3>위치 인증</h3>
            <p>정류장 좌표와 사용자 좌표의 거리가 100m 이내이면 체크인할 수 있습니다.</p>
          </div>
          <div className="segmented-control" aria-label="location simulation">
            <button
              className={locationMode === "inside" ? "active" : ""}
              onClick={() => onLocationModeChange("inside")}
              type="button"
            >
              <Navigation size={16} />
              반경 내
            </button>
            <button
              className={locationMode === "outside" ? "active" : ""}
              onClick={() => onLocationModeChange("outside")}
              type="button"
            >
              <MapPin size={16} />
              반경 밖
            </button>
          </div>
          <div className="distance-meter">
            <span>{distanceMeters}m</span>
            <small>{isCheckInAllowed ? "체크인 가능" : "정류장 근처에서 재시도"}</small>
          </div>
          <button
            className="primary-action"
            disabled={!isCheckInAllowed}
            onClick={onCheckIn}
            type="button"
          >
            <CheckCircle2 size={18} />
            위치 인증 후 체크인
          </button>
        </div>
      </section>

      <aside className="panel stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Boarding ticket</p>
            <h2>대기 티켓</h2>
          </div>
          <button className="ghost-action" onClick={onReset} type="button">
            초기화
          </button>
        </div>

        <div className={checkedIn ? "ticket-card issued" : "ticket-card"}>
          <div className="ticket-topline">
            <RouteIcon size={18} />
            {selectedRoute.name} · {selectedRoute.destination}
          </div>
          <div className="queue-number">
            <span>대기번호</span>
            <strong>{checkedIn ? `${queuePosition}번` : "--"}</strong>
          </div>
          <div className="queue-number ahead-number">
            <span>내 앞 대기 인원</span>
            <strong>{checkedIn ? `${peopleAhead}명` : "--"}</strong>
          </div>
          <p className="ticket-note">
            {checkedIn
              ? "대기번호는 고정되고, 앞사람 변동은 내 앞 대기 인원으로 갱신됩니다."
              : "체크인하면 노선별 선착순 대기번호가 발급됩니다."}
          </p>
        </div>

        <div className="probability-layout">
          <ProbabilityRing value={checkedIn ? prediction.nextBusProbability : 0} label="다음 차량" />
          <div className="probability-copy">
            <h3>운영 안내</h3>
            <p>
              다음다음 차량 탑승 가능성은{" "}
              <strong>{checkedIn ? `${prediction.nextNextBusProbability}%` : "--"}</strong>입니다.
            </p>
            <p>
              예상 대기 시간은{" "}
              <strong>{checkedIn ? `약 ${prediction.expectedWaitMinutes}분` : "--"}</strong>입니다.
            </p>
          </div>
        </div>

        <div className="call-card">
          <div>
            <p className="eyebrow">Call optimizer</p>
            <h3>{callTitle}</h3>
            <p>
              {called
                ? `${selectedRoute.name} 기존 대기 위치로 이동해 주세요. 현재 내 앞 대기 인원은 ${peopleAhead}명입니다. 버스 도착 예상은 ${Math.max(
                    prediction.callTimeBeforeArrivalSeconds / 60,
                    1,
                  ).toFixed(0)}분 후입니다.`
                : prediction.callCount > 0
                  ? `이번 차량 안정 호출 구간은 대기번호 ${callRangeStart}~${callRangeEnd}번입니다.`
                  : prediction.uncertainBoardingCount > 0
                    ? "이번 차량은 좌석 변동이 커서 호출은 보류하고 불확실 구간으로 안내합니다."
                    : "이번 차량은 탑승 실패 위험이 높아 다음차 안내를 우선 제공합니다."}
            </p>
          </div>
          <button
            className="primary-action"
            disabled={!canSimulateCall}
            onClick={onCall}
            type="button"
          >
            <Bell size={18} />
            {callButtonLabel}
          </button>
        </div>

        <CallRangePanel
          callCount={prediction.callCount}
          callRangeStart={callRangeStart}
          callRangeEnd={callRangeEnd}
          called={called}
          peopleAhead={peopleAhead}
          queuePosition={queuePosition}
          uncertainBoardingCount={prediction.uncertainBoardingCount}
          nextVehicleRecommendedCount={prediction.nextVehicleRecommendedCount}
        />
      </aside>
    </main>
  );
}

interface OperatorDashboardProps {
  selectedStation: Station;
  selectedRoute: RouteInfo;
  prediction: PredictionResult;
  displayedQueueLength: number;
  seatDeltaSample: SeatDeltaSample;
  seatDeltaEstimate: SeatDeltaEstimate;
  fieldAiInsight: FieldAiInsight;
}

function OperatorDashboard({
  selectedStation,
  selectedRoute,
  prediction,
  displayedQueueLength,
  seatDeltaSample,
  seatDeltaEstimate,
  fieldAiInsight,
}: OperatorDashboardProps) {
  const dashboardRoutes = routes.filter((route) =>
    selectedStation.routes.includes(route.id),
  );

  return (
    <main className="dashboard-grid">
      <section className="panel span-2">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Operator dashboard</p>
            <h2>{selectedStation.name}</h2>
          </div>
          <StatusChip level={prediction.riskLevel}>혼잡 {prediction.riskLevel}</StatusChip>
        </div>
        <div className="stat-grid">
          <StatCard
            icon={<Users size={20} />}
            label="현재 대기 인원"
            value={`${displayedQueueLength}명`}
            caption={`${selectedRoute.name} 기준`}
          />
          <StatCard
            icon={<Bus size={20} />}
            label="안정 호출"
            value={`${prediction.callCount}명`}
            caption={`보수 예측 ${prediction.conservativeRemainingSeats}석 기준`}
          />
          <StatCard
            icon={<Bell size={20} />}
            label="불확실 구간"
            value={`${prediction.uncertainBoardingCount}명`}
            caption={`안전 버퍼 ${prediction.safetyBufferSeats}석 적용`}
          />
          <StatCard
            icon={<AlertTriangle size={20} />}
            label="다음차 권장"
            value={`${prediction.nextVehicleRecommendedCount}명`}
            caption={`혼잡 ${prediction.riskLevel}, 위험 점수 ${prediction.congestionScore}/100`}
          />
          <StatCard
            icon={<Ticket size={20} />}
            label="좌석 변화 추정"
            value={
              seatDeltaEstimate.isDemandCensored
                ? `${seatDeltaEstimate.demandLowerBound}명 이상`
                : `${seatDeltaEstimate.estimatedBoardedCount}명`
            }
            caption={`${seatDeltaSample.routeName} 통과 전 ${seatDeltaSample.beforeRemainSeatCount}석 → 후 ${seatDeltaSample.afterRemainSeatCount}석`}
          />
          <StatCard
            icon={<TrendingUp size={20} />}
            label="실사 미탑승"
            value={`${fieldAiInsight.totalFailedBoardingCount}명`}
            caption={`${fieldAiInsight.leftBehindBusCount}대에서 미탑승 감지`}
          />
        </div>
      </section>

      <section className="panel span-2 stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Field AI alert</p>
            <h2>실사 기반 미탑승 위험 감지</h2>
          </div>
          <StatusChip level={fieldAiInsight.riskLevel}>{fieldAiInsight.riskLevel}</StatusChip>
        </div>
        <div className="field-alert">
          <AlertTriangle size={22} />
          <div>
            <strong>{fieldAiInsight.alertMessage}</strong>
            <p>{fieldAiInsight.operatorRecommendation}</p>
          </div>
        </div>
        <div className="field-summary-grid">
          <MetricBlock label="관측 차량" value={`${fieldAiInsight.observedBusCount}대`} />
          <MetricBlock label="총 대기" value={`${fieldAiInsight.totalWaitingCount}명`} />
          <MetricBlock label="총 탑승" value={`${fieldAiInsight.totalBoardedCount}명`} />
          <MetricBlock label="최종 잔여" value={`${fieldAiInsight.latestLeftWaitingCount}명`} />
        </div>
      </section>

      <section className="panel stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Demand chart</p>
            <h2>시간대별 대기 수요</h2>
          </div>
        </div>
        <DemandChart />
      </section>

      <section className="panel stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Route queue</p>
            <h2>노선별 운영 상태</h2>
          </div>
        </div>
        <div className="route-table">
          {dashboardRoutes.map((route) => (
            <div className="route-row" key={route.id}>
              <span className="route-badge compact" style={{ background: route.color }}>
                {route.name}
              </span>
              <span>{route.destination}</span>
              <strong>{route.id === selectedRoute.id ? displayedQueueLength : route.queueLength}명</strong>
              <StatusChip level={route.crowdLevel}>{route.crowdLevel}</StatusChip>
            </div>
          ))}
        </div>
      </section>

      <section className="panel span-2 stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PoC metrics</p>
            <h2>검증 지표 요약</h2>
          </div>
        </div>
        <div className="metric-grid">
          {pocMetrics.map((metric) => (
            <div className="metric-card" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.caption}</small>
            </div>
          ))}
        </div>
        <div className="recommendation">
          <ShieldCheck size={20} />
          <p>
            16:00부터 만차 위험이 시작됩니다. 호출 대상 대기번호 구간을 짧게 유지하고,
            아직 호출되지 않은 사용자는 분산 대기를 안내합니다.
          </p>
        </div>
      </section>
    </main>
  );
}

interface AiPanelProps {
  selectedRoute: RouteInfo;
  prediction: PredictionResult;
  seatDeltaSample: SeatDeltaSample;
  seatDeltaEstimate: SeatDeltaEstimate;
  fieldEvents: FieldObservationEvent[];
  fieldAiInsight: FieldAiInsight;
  queuePosition: number;
  peopleAhead: number;
  displayedQueueLength: number;
}

function AiPanel({
  selectedRoute,
  prediction,
  seatDeltaSample,
  seatDeltaEstimate,
  fieldEvents,
  fieldAiInsight,
  queuePosition,
  peopleAhead,
  displayedQueueLength,
}: AiPanelProps) {
  return (
    <main className="ai-grid">
      <section className="panel ai-card">
        <Bus size={22} />
        <h2>SeatFlow AI</h2>
        <p>목표 정류장 도착 시 잔여좌석을 예측하고, 운영 보정값을 적용해 안정 호출 인원으로 변환합니다.</p>
        <div className="formula-box">
          <span>잔여 정류장 {prediction.remainingStopsToTarget}개</span>
          <span>예상 탑승 -{prediction.expectedBoardingBeforeTarget.toFixed(1)}명</span>
          <span>예상 하차 +{prediction.expectedAlightingBeforeTarget.toFixed(1)}명</span>
          <span>안전 버퍼 -{prediction.safetyBufferSeats}석</span>
          <span>
            좌석 변화 추정 {seatDeltaSample.beforeRemainSeatCount}석 →{" "}
            {seatDeltaSample.afterRemainSeatCount}석
          </span>
        </div>
        <strong className="ai-result">{prediction.callCount}명 안정 호출</strong>
        <p className="ai-note">
          원 예측 {prediction.expectedRemainingSeats}석, 보수 예측{" "}
          {prediction.conservativeRemainingSeats}석입니다. 통과 후 0석이면 실제 대기 수요는{" "}
          {seatDeltaEstimate.demandLowerBound}명 이상으로 봅니다.
        </p>
      </section>

      <section className="panel ai-card">
        <Ticket size={22} />
        <h2>Boarding Probability AI</h2>
        <p>고정 대기번호, 내 앞 대기 인원, 예상 잔여좌석, 앞순번 노쇼율을 결합합니다.</p>
        <div className="formula-box">
          <span>내 대기번호 {queuePosition}번</span>
          <span>내 앞 대기 인원 {peopleAhead}명</span>
          <span>현재 대기열 {displayedQueueLength}명</span>
          <span>운영 판단 {prediction.serviceDecisionLabel}</span>
        </div>
        <strong className="ai-result">{prediction.nextBusProbability}%</strong>
        <p className="ai-note">{prediction.serviceGuidance}</p>
      </section>

      <section className="panel ai-card">
        <Bell size={22} />
        <h2>Call Optimizer AI</h2>
        <p>예상 노쇼율을 보정해 이번 차량에 호출할 대기번호 구간과 호출 시점을 계산합니다.</p>
        <div className="formula-box">
          <span>최대 호출 인원 {MAX_CALL_COUNT}명</span>
          <span>불확실 인원 {prediction.uncertainBoardingCount}명</span>
          <span>다음차 권장 {prediction.nextVehicleRecommendedCount}명</span>
          <span>호출 시점 도착 {prediction.callTimeBeforeArrivalSeconds}초 전</span>
        </div>
        <strong className="ai-result">{prediction.callCount}명 안정 호출</strong>
      </section>

      <section className="panel ai-card">
        <AlertTriangle size={22} />
        <h2>Congestion & Risk AI</h2>
        <p>대기 인원, 예상 대기시간, 날씨 위험을 점수화합니다.</p>
        <div className="formula-box">
          <span>노선 {selectedRoute.name}</span>
          <span>예상 대기 {selectedRoute.averageWaitMinutes}분</span>
          <span>기상 위험 점수 {WEATHER_RISK_SCORE}</span>
        </div>
        <strong className="ai-result">{prediction.riskLevel}</strong>
      </section>

      <section className="panel span-2 stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Field validation</p>
            <h2>실사 데이터로 검증한 운영 판단</h2>
          </div>
          <StatusChip level={fieldAiInsight.riskLevel}>미탑승 {fieldAiInsight.riskLevel}</StatusChip>
        </div>
        <div className="validation-layout">
          <div className="field-alert">
            <TrendingUp size={22} />
            <div>
              <strong>1040번 사례: 빈자리 2석 + 하차 1명 = 실제 3명 탑승</strong>
              <p>
                잔여좌석만 쓰면 {fieldAiInsight.seatOnlyPrediction ?? 0}명 예측이지만,
                하차를 반영하면 {fieldAiInsight.alightingAdjustedPrediction ?? 0}명으로 실제
                탑승과 오차 {fieldAiInsight.validationError ?? 0}명입니다.
              </p>
            </div>
          </div>
          <div className="field-summary-grid">
            <MetricBlock label="실사 차량" value={`${fieldAiInsight.observedBusCount}대`} />
            <MetricBlock label="미탑승 합계" value={`${fieldAiInsight.totalFailedBoardingCount}명`} />
            <MetricBlock label="반복 감지" value={fieldAiInsight.repeatedLeftBehind ? "Y" : "N"} />
            <MetricBlock label="최종 잔여" value={`${fieldAiInsight.latestLeftWaitingCount}명`} />
          </div>
        </div>
        <FieldObservationTable events={fieldEvents} />
      </section>

      <section className="panel span-2 stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Model migration path</p>
            <h2>MVP 이후 고도화</h2>
          </div>
        </div>
        <div className="roadmap">
          <div>
            <SlidersHorizontal size={18} />
            <strong>현재</strong>
            <span>규칙 기반, 이동평균, mock 데이터</span>
          </div>
          <div>
            <Gauge size={18} />
            <strong>PoC</strong>
            <span>현장 관찰 CSV와 이벤트 로그로 예측 오차 측정</span>
          </div>
          <div>
            <ShieldCheck size={18} />
            <strong>고도화</strong>
            <span>LightGBM/XGBoost, 시계열 예측, Isolation Forest 적용</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function FieldObservationTable({ events }: { events: FieldObservationEvent[] }) {
  return (
    <div className="field-table">
      <div className="field-row header">
        <span>시각</span>
        <span>차량</span>
        <span>대기</span>
        <span>하차</span>
        <span>탑승</span>
        <span>미탑승</span>
      </div>
      {events.map((event) => (
        <div className="field-row" key={event.id}>
          <span>{event.observedAt || "-"}</span>
          <strong>{event.plateNo}</strong>
          <span>{event.waitingCount}명</span>
          <span>{event.alightingCount === null ? "-" : `${event.alightingCount}명`}</span>
          <span>{event.boardedCount}명</span>
          <span>{event.failedBoardingCount}명</span>
        </div>
      ))}
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-block">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
    </div>
  );
}

function ProbabilityRing({ value, label }: { value: number; label: string }) {
  const percentage = Math.max(0, Math.min(value, 100));

  return (
    <div className="probability-ring" style={{ "--percent": `${percentage}%` } as CSSProperties}>
      <span>{percentage}%</span>
      <small>{label}</small>
    </div>
  );
}

function CallRangePanel({
  callCount,
  callRangeStart,
  callRangeEnd,
  called,
  peopleAhead,
  queuePosition,
  uncertainBoardingCount,
  nextVehicleRecommendedCount,
}: {
  callCount: number;
  callRangeStart: number;
  callRangeEnd: number;
  called: boolean;
  peopleAhead: number;
  queuePosition: number;
  uncertainBoardingCount: number;
  nextVehicleRecommendedCount: number;
}) {
  const visibleQueueNumbers =
    callCount > 0
      ? Array.from({ length: callCount }, (_, index) => callRangeStart + index)
      : [];

  return (
    <div className="call-range-panel">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Call range</p>
          <h3>이번 차량 안정 호출 구간</h3>
        </div>
      </div>
      {callCount > 0 ? (
        <div className="call-range-grid">
          {visibleQueueNumbers.map((number) => (
            <div
              className={[
                "call-range-cell",
                called ? "callable" : "",
                queuePosition === number ? "active" : "",
              ].join(" ")}
              key={number}
            >
              {number}번
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-call-range">
          {uncertainBoardingCount > 0 ? "불확실 구간, 호출 보류" : "이번 차량 다음차 권장"}
        </div>
      )}
      <p className="call-range-caption">
        {called
          ? `내 대기번호는 ${queuePosition}번이고 현재 내 앞 대기 인원은 ${peopleAhead}명입니다.`
          : callCount > 0
            ? `안정 호출 대상은 대기번호 ${callRangeStart}~${callRangeEnd}번입니다. 호출 전까지 정류장 앞에 줄 서지 않아도 됩니다.`
            : `불확실 ${uncertainBoardingCount}명, 다음차 권장 ${nextVehicleRecommendedCount}명으로 분리해 안내합니다.`}
      </p>
    </div>
  );
}

function DemandChart() {
  const max = Math.max(...hourlyDemand.map((item) => item.waitingCount));

  return (
    <div className="bar-chart">
      {hourlyDemand.map((item) => (
        <div className="bar-column" key={item.label}>
          <div className="bar-track">
            <div style={{ height: `${(item.waitingCount / max) * 100}%` }} />
          </div>
          <strong>{item.waitingCount}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusChip({ level, children }: { level: RiskLevel; children: ReactNode }) {
  return <span className={`status-chip ${riskClass(level)}`}>{children}</span>;
}

function riskClass(level: RiskLevel) {
  switch (level) {
    case "위험":
      return "danger";
    case "높음":
      return "high";
    case "보통":
      return "medium";
    default:
      return "low";
  }
}
