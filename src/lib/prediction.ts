import type {
  FieldAiInsight,
  FieldObservationEvent,
  PredictionInput,
  PredictionResult,
  RiskLevel,
  SeatDeltaEstimate,
} from "../types";

const EARTH_RADIUS_METERS = 6_371_000;

export function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineDistanceMeters(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

export function canCheckIn(distanceMeters: number, radiusMeters = 100): boolean {
  return distanceMeters <= radiusMeters;
}

export function calculateExpectedRemainingSeats(input: PredictionInput) {
  const remainingStopsToTarget = Math.max(
    input.targetStationSeq - input.currentStationSeq,
    0,
  );
  const expectedBoardingBeforeTarget =
    input.averageBoardingPerStop * remainingStopsToTarget;
  const expectedAlightingBeforeTarget =
    input.averageAlightingPerStop * remainingStopsToTarget;
  const expectedRemainingSeats = Math.max(
    Math.round(
      input.currentRemainingSeats -
        expectedBoardingBeforeTarget +
        expectedAlightingBeforeTarget,
    ),
    0,
  );

  return {
    remainingStopsToTarget,
    expectedBoardingBeforeTarget,
    expectedAlightingBeforeTarget,
    expectedRemainingSeats,
  };
}

export function estimateBoardedCountFromSeatDelta(
  beforeRemainSeatCount: number,
  afterRemainSeatCount: number,
): SeatDeltaEstimate {
  const estimatedBoardedCount = Math.max(
    beforeRemainSeatCount - afterRemainSeatCount,
    0,
  );
  const isDemandCensored = afterRemainSeatCount === 0;

  return {
    estimatedBoardedCount,
    demandLowerBound: isDemandCensored
      ? Math.max(beforeRemainSeatCount, estimatedBoardedCount)
      : estimatedBoardedCount,
    isDemandCensored,
  };
}

export function analyzeFieldObservations(
  events: FieldObservationEvent[],
): FieldAiInsight {
  const observedBusCount = events.length;
  const totalWaitingCount = sumBy(events, (event) => event.waitingCount);
  const totalBoardedCount = sumBy(events, (event) => event.boardedCount);
  const totalFailedBoardingCount = sumBy(events, (event) => event.failedBoardingCount);
  const leftBehindEvents = events.filter((event) => event.failedBoardingCount > 0);
  const latestEvent = events[events.length - 1];
  const validationEvent =
    events.find(
      (event) =>
        event.remainSeatBeforeArrival !== null &&
        event.alightingCount !== null &&
        event.boardedCount > 0,
    ) ?? null;

  const repeatedLeftBehind =
    leftBehindEvents.length >= 2 ||
    leftBehindEvents.some((event, index) => {
      const nextEvent = events[events.indexOf(event) + 1];
      return index > 0 || (nextEvent?.leftWaitingCount ?? 0) > 0;
    });
  const seatOnlyPrediction = validationEvent?.remainSeatBeforeArrival ?? null;
  const alightingAdjustedPrediction =
    validationEvent && validationEvent.remainSeatBeforeArrival !== null
      ? validationEvent.remainSeatBeforeArrival + (validationEvent.alightingCount ?? 0)
      : null;
  const validationError =
    alightingAdjustedPrediction !== null && validationEvent
      ? Math.abs(alightingAdjustedPrediction - validationEvent.boardedCount)
      : null;
  const riskLevel: RiskLevel =
    repeatedLeftBehind || totalFailedBoardingCount >= 6
      ? "위험"
      : totalFailedBoardingCount > 0
        ? "높음"
        : "보통";

  return {
    riskLevel,
    repeatedLeftBehind,
    totalWaitingCount,
    totalBoardedCount,
    totalFailedBoardingCount,
    observedBusCount,
    leftBehindBusCount: leftBehindEvents.length,
    latestLeftWaitingCount: latestEvent?.leftWaitingCount ?? 0,
    seatOnlyPrediction,
    alightingAdjustedPrediction,
    validationError,
    alertMessage:
      riskLevel === "위험"
        ? "미탑승이 후속 차량에서도 해소되지 않았습니다."
        : totalFailedBoardingCount > 0
          ? "미탑승 발생 차량이 있어 다음차 안내가 필요합니다."
          : "관측 구간에서 미탑승 위험이 낮습니다.",
    operatorRecommendation:
      riskLevel === "위험"
        ? "호출 인원을 보수적으로 줄이고, 다음차 안내와 운수사 피크 수요 알림을 함께 제공하세요."
        : "현재 호출 정책을 유지하되 실제 탑승 결과를 계속 누적하세요.",
  };
}

export function calculateBoardingProbability(
  queuePosition: number,
  expectedRemainingSeats: number,
  noShowRate: number,
) {
  const usersAhead = Math.max(queuePosition - 1, 0);
  const expectedNoShowCount = usersAhead * noShowRate;
  const effectivePosition = queuePosition - expectedNoShowCount;
  const margin = expectedRemainingSeats - effectivePosition;

  const nextBusProbability =
    margin >= 0
      ? clamp(72 + margin * 4, 72, 95)
      : clamp(68 + margin * 8, 8, 68);

  const nextNextBusProbability = clamp(nextBusProbability + 43, 55, 98);
  const probabilityLabel: "높음" | "보통" | "낮음" =
    nextBusProbability >= 70 ? "높음" : nextBusProbability >= 35 ? "보통" : "낮음";

  return {
    nextBusProbability: Math.round(nextBusProbability),
    nextNextBusProbability: Math.round(nextNextBusProbability),
    probabilityLabel,
  };
}

export function calculateCallCount(
  expectedRemainingSeats: number,
  noShowRate: number,
  maxCallCount: number,
): number {
  if (expectedRemainingSeats <= 0) {
    return 0;
  }

  return Math.min(maxCallCount, Math.ceil(expectedRemainingSeats / (1 - noShowRate)));
}

export function calculateOperationalDecision(
  input: PredictionInput,
  expectedRemainingSeats: number,
  congestionScore: number,
) {
  const lowSeatRisk =
    expectedRemainingSeats <= 10 || input.currentRemainingSeats <= 10;
  const weatherRisk = input.weatherRiskScore >= 80;
  const routeUncertainty =
    Math.max(input.targetStationSeq - input.currentStationSeq, 0) >= 3;
  const safetyBufferSeats = Math.min(
    5,
    2 + (lowSeatRisk ? 1 : 0) + (weatherRisk ? 1 : 0) + (routeUncertainty ? 1 : 0),
  );
  const conservativeRemainingSeats = Math.max(
    expectedRemainingSeats - safetyBufferSeats,
    0,
  );
  const stableCallCount = Math.min(
    input.maxCallCount,
    conservativeRemainingSeats,
    input.queueLength,
  );
  const uncertainBoardingCount = Math.min(
    Math.max(expectedRemainingSeats - stableCallCount, 0),
    Math.max(input.queueLength - stableCallCount, 0),
    safetyBufferSeats,
  );
  const nextVehicleRecommendedCount = Math.max(
    input.queueLength - stableCallCount - uncertainBoardingCount,
    0,
  );
  const serviceDecisionLabel: "안정 호출" | "불확실" | "다음차 권장" =
    stableCallCount > 0
      ? "안정 호출"
      : uncertainBoardingCount > 0
        ? "불확실"
        : "다음차 권장";

  return {
    safetyBufferSeats,
    conservativeRemainingSeats,
    stableCallCount,
    uncertainBoardingCount,
    nextVehicleRecommendedCount,
    serviceDecisionLabel,
    serviceGuidance: buildServiceGuidance(
      stableCallCount,
      uncertainBoardingCount,
      nextVehicleRecommendedCount,
      congestionScore,
    ),
  };
}

export function calculateCongestionScore(
  waitingCount: number,
  expectedWaitMinutes: number,
  weatherRiskScore: number,
): number {
  const weightedScore = Math.round(
    clamp(waitingCount * 0.5 + expectedWaitMinutes * 0.3 + weatherRiskScore * 0.2, 0, 100),
  );
  if (weatherRiskScore >= 80) {
    return Math.max(weightedScore, 61);
  }

  return weightedScore;
}

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 81) return "위험";
  if (score >= 61) return "높음";
  if (score >= 31) return "보통";
  return "낮음";
}

export function buildPrediction(input: PredictionInput): PredictionResult {
  const seatFlow = calculateExpectedRemainingSeats(input);
  const congestionScore = calculateCongestionScore(
    input.waitingCount,
    input.expectedWaitMinutes,
    input.weatherRiskScore,
  );
  const operationalDecision = calculateOperationalDecision(
    input,
    seatFlow.expectedRemainingSeats,
    congestionScore,
  );
  const probability = calculateBoardingProbability(
    input.queuePosition,
    operationalDecision.conservativeRemainingSeats,
    input.noShowRate,
  );

  return {
    ...seatFlow,
    ...probability,
    expectedWaitMinutes: estimateWaitMinutes(
      input.queuePosition,
      Math.max(operationalDecision.conservativeRemainingSeats, 1),
      input.etaMinutes,
    ),
    callCount: operationalDecision.stableCallCount,
    callTimeBeforeArrivalSeconds:
      input.averageWalkToQueueSeconds + input.alignmentBufferSeconds,
    safetyBufferSeats: operationalDecision.safetyBufferSeats,
    conservativeRemainingSeats: operationalDecision.conservativeRemainingSeats,
    uncertainBoardingCount: operationalDecision.uncertainBoardingCount,
    nextVehicleRecommendedCount: operationalDecision.nextVehicleRecommendedCount,
    serviceDecisionLabel: operationalDecision.serviceDecisionLabel,
    serviceGuidance: operationalDecision.serviceGuidance,
    congestionScore,
    riskLevel: getRiskLevel(congestionScore),
    callQueueNumbers: Array.from(
      { length: operationalDecision.stableCallCount },
      (_, index) => index + 1,
    ),
  };
}

function buildServiceGuidance(
  stableCallCount: number,
  uncertainBoardingCount: number,
  nextVehicleRecommendedCount: number,
  congestionScore: number,
): string {
  if (stableCallCount > 0) {
    return `${stableCallCount}명까지 안정 호출하고 ${uncertainBoardingCount}명은 좌석 변동을 보며 추가 호출합니다.`;
  }

  if (uncertainBoardingCount > 0) {
    return `이번 차량은 좌석 변동성이 높아 ${uncertainBoardingCount}명만 불확실 구간으로 표시하고 호출은 보류합니다.`;
  }

  if (congestionScore >= 61 || nextVehicleRecommendedCount > 0) {
    return "이번 차량은 탑승 실패 위험이 높아 다음차 안내를 우선 제공합니다.";
  }

  return "현재 호출 대상은 없으며 다음 차량 정보를 계속 갱신합니다.";
}

function estimateWaitMinutes(
  queuePosition: number,
  expectedRemainingSeats: number,
  etaMinutes: number,
): number {
  if (queuePosition <= expectedRemainingSeats) {
    return etaMinutes;
  }

  const busesNeeded = Math.ceil(queuePosition / Math.max(expectedRemainingSeats, 1));
  return etaMinutes + (busesNeeded - 1) * 9;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((total, item) => total + getValue(item), 0);
}
