export type RiskLevel = "낮음" | "보통" | "높음" | "위험";

export interface Station {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  waitSpace: string;
  routes: string[];
}

export interface RouteInfo {
  id: string;
  name: string;
  destination: string;
  queueLength: number;
  averageWaitMinutes: number;
  headwayMinutes: number;
  crowdLevel: RiskLevel;
  color: string;
}

export interface VehicleSnapshot {
  id: string;
  routeId: string;
  plateNo: string;
  currentStationSeq: number;
  targetStationSeq: number;
  remainSeatCount: number;
  etaMinutes: number;
  state: string;
  averageBoardingPerStop: number;
  averageAlightingPerStop: number;
  confidence: number;
}

export interface HourlyDemand {
  label: string;
  waitingCount: number;
}

export interface PocMetric {
  label: string;
  value: string;
  caption: string;
}

export interface SeatDeltaSample {
  routeId: string;
  routeName: string;
  vehicleId: string;
  targetStationName: string;
  beforeRemainSeatCount: number;
  afterRemainSeatCount: number;
}

export interface FieldObservationEvent {
  id: string;
  observedAt: string;
  stationId: string;
  stationName: string;
  direction: string;
  routeName: string;
  plateNo: string;
  waitingCount: number;
  boardedCount: number;
  alightingCount: number | null;
  leftWaitingCount: number;
  failedBoardingCount: number;
  remainSeatBeforeArrival: number | null;
  memo: string;
}

export interface PredictionInput {
  currentRemainingSeats: number;
  currentStationSeq: number;
  targetStationSeq: number;
  averageBoardingPerStop: number;
  averageAlightingPerStop: number;
  queuePosition: number;
  queueLength: number;
  noShowRate: number;
  etaMinutes: number;
  maxCallCount: number;
  averageWalkToQueueSeconds: number;
  alignmentBufferSeconds: number;
  waitingCount: number;
  expectedWaitMinutes: number;
  weatherRiskScore: number;
}

export interface PredictionResult {
  remainingStopsToTarget: number;
  expectedBoardingBeforeTarget: number;
  expectedAlightingBeforeTarget: number;
  expectedRemainingSeats: number;
  nextBusProbability: number;
  nextNextBusProbability: number;
  probabilityLabel: "높음" | "보통" | "낮음";
  expectedWaitMinutes: number;
  callCount: number;
  callTimeBeforeArrivalSeconds: number;
  safetyBufferSeats: number;
  conservativeRemainingSeats: number;
  uncertainBoardingCount: number;
  nextVehicleRecommendedCount: number;
  serviceDecisionLabel: "안정 호출" | "불확실" | "다음차 권장";
  serviceGuidance: string;
  congestionScore: number;
  riskLevel: RiskLevel;
  callQueueNumbers: number[];
}

export interface SeatDeltaEstimate {
  estimatedBoardedCount: number;
  demandLowerBound: number;
  isDemandCensored: boolean;
}

export interface FieldAiInsight {
  riskLevel: RiskLevel;
  repeatedLeftBehind: boolean;
  totalWaitingCount: number;
  totalBoardedCount: number;
  totalFailedBoardingCount: number;
  observedBusCount: number;
  leftBehindBusCount: number;
  latestLeftWaitingCount: number;
  seatOnlyPrediction: number | null;
  alightingAdjustedPrediction: number | null;
  validationError: number | null;
  alertMessage: string;
  operatorRecommendation: string;
}
