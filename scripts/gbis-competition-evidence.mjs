#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import {
  parseArgs,
  readCsvRows,
  readJsonFile,
  toNumberOrNull,
} from "./gbis-client.mjs";
import {
  DEFAULT_HOLIDAY_CALENDAR_PATH,
  PEAK_WINDOWS,
  dayTypeForParts,
  isInPeakWindow,
  kstParts,
  loadHolidayDates,
} from "./peak-windows.mjs";

const args = parseArgs(process.argv.slice(2));
const snapshotPath = args.snapshots ?? "data/gbis-seat-snapshots.csv";
const estimatesPath = args.estimates ?? "data/gbis-boarded-estimates.csv";
const configPath = args.config ?? "data/gbis-targets.json";
const outputPath = args.out ?? "docs/15-gbis-evidence-report.md";
const holidayCalendarPath = args["holiday-calendar"] ?? DEFAULT_HOLIDAY_CALENDAR_PATH;
const minSamples = Number(args["min-samples"] ?? 30);
const minDays = Number(args["min-days"] ?? 3);
const minBucketSamples = Number(args["min-bucket-samples"] ?? 8);

try {
  const [snapshots, estimates, config] = await Promise.all([
    readCsvRows(snapshotPath),
    readCsvRows(estimatesPath).catch(() => []),
    readJsonFile(configPath),
  ]);
  const holidayDates = loadHolidayDates(holidayCalendarPath);
  const targets = (config.targets ?? [])
    .filter((target) => target.enabled !== false)
    .sort((a, b) => Number(a.targetStationSeq ?? a.staOrder) - Number(b.targetStationSeq ?? b.staOrder));
  const report = buildReport(snapshots, estimates, targets, holidayDates);

  await writeFile(outputPath, report);
  console.log(`[gbis:evidence] Wrote ${outputPath}.`);
} catch (error) {
  console.error(`[gbis:evidence] ${error.message}`);
  process.exit(1);
}

function buildReport(snapshots, estimates, targets, holidayDates) {
  const locationRows = dedupeBy(
    snapshots.filter((row) => row.snapshot_type === "location" && validSeat(row.remain_seat_count)),
    (row) => [
      row.collected_at,
      row.route_id,
      row.veh_id || row.plate_no,
      row.current_station_seq,
      row.remain_seat_count,
      row.state_cd,
    ].join("|"),
  );
  const arrivalRows = snapshots.filter((row) => row.snapshot_type === "arrival" && validSeat(row.remain_seat_count));
  const targetStats = targets.map((target) => targetSeatStats(target, locationRows, holidayDates));
  const directionStats = summarizeDirections(targetStats);
  const eveningStats = targetStats.filter((stat) => stat.direction === "서울→동탄");
  const morningStats = targetStats.filter((stat) => stat.direction === "동탄→서울");
  const eveningWindowStats = stationWindowStats(targets, locationRows, holidayDates, "서울→동탄");
  const outboundWindowStats = stationWindowStats(targets, locationRows, holidayDates, "동탄→서울");
  const weekendOutboundStats = outboundWindowStats
    .filter((stat) => stat.window === "휴일 외출 10:00-14:00");
  const riskRows = stationBucketRisk(targets, locationRows, holidayDates, "서울→동탄").slice(0, 12);
  const weekendOutboundRiskRows = stationBucketRisk(targets, locationRows, holidayDates, "동탄→서울", 4)
    .filter((stat) => stat.window === "휴일 외출 10:00-14:00")
    .filter((stat) => stat.samples >= 4)
    .slice(0, 8);
  const boardingRows = boardingStats(targets, estimates, "서울→동탄");
  const weekendOutboundBoardingRows = boardingStats(
    targets,
    estimates.filter((row) => isWindowTime("휴일 외출 10:00-14:00", row.after_collected_at, holidayDates)),
    "동탄→서울",
  );
  const generatedAt = new Date().toISOString();
  const allCollectedAt = snapshots.map((row) => row.collected_at).filter(Boolean);

  return [
    "# GBIS 수집 데이터 제출 근거 리포트",
    "",
    `생성 시각: ${formatKst(generatedAt)} KST`,
    "",
    "## 1. 데이터 범위",
    "",
    markdownTable([
      ["항목", "값"],
      ["원본 스냅샷 행", formatNumber(snapshots.length)],
      ["위치 스냅샷 행", formatNumber(locationRows.length)],
      ["도착 스냅샷 행", formatNumber(arrivalRows.length)],
      ["탑승 추정 행", formatNumber(estimates.length)],
      ["대상 노선", unique(targets.map((target) => target.routeName || target.routeId)).join(", ")],
      ["대상 정류장", `${targets.length}곳`],
      ["수집 시작", formatKst(minDate(allCollectedAt))],
      ["최근 수집", formatKst(maxDate(allCollectedAt))],
    ]),
    "",
    "## 2. 제출 근거로서의 자체 평가",
    "",
    "- 강점: 공공데이터포털 경기도 GBIS 공식 API에서 수집한 차량별 잔여좌석, 정류장 순번, 도착 예측 데이터를 사용하므로 주관적 체감보다 객관성이 높습니다.",
    "- 강점: 정류장별, 시간대별로 `10석 이하`, `p20 잔여좌석`, `0석 신호`를 계산해 다음 버스 승차 가능성과 호출 구간을 판단할 수 있습니다.",
    "- 강점: 좌석 감소량을 이용해 하차가 많지 않다는 가정하의 최소 탑승 수요를 추정할 수 있어 QueueBus 호출 인원과 운수사 수요 알림 산정 논리를 설명할 수 있습니다.",
    "- 한계: GBIS만으로 실제 줄 선 인원, 미탑승 인원, 보행로 점유, 사용자 대기시간은 직접 관측되지 않습니다.",
    "- 한계: 현재는 M4137 1개 노선, 약 3일 관측이므로 시장 전체 근거가 아니라 PoC 후보 정류장 근거로 제시해야 합니다.",
    "- 보완: 제출 전 현장 관찰 1회 이상으로 실제 대기열 길이, 탑승 인원, 미탑승 인원을 기록하면 데이터 근거의 설득력이 크게 올라갑니다.",
    "",
    "## 3. 방향별 분석 준비도",
    "",
    markdownTable([
      ["방향", "대상", "준비 완료", "부분 준비", "샘플", "관측일", "0석 신호", "10석 이하 신호"],
      ...directionStats.map((stat) => [
        stat.direction,
        stat.targets,
        stat.readyTargets,
        stat.partialTargets,
        formatNumber(stat.samples),
        stat.days,
        pct(stat.zeroRate),
        pct(stat.le10Rate),
      ]),
    ]),
    "",
    "판정 기준: 정류장별 피크 샘플 30개 이상, 관측일 3일 이상이면 준비 완료로 봅니다.",
    "",
    "## 4. 퇴근길 핵심 근거",
    "",
    markdownTable([
      ["순번", "정류장", "샘플", "관측일", "p20 좌석", "중앙값", "0석 신호", "10석 이하", "제출 해석"],
      ...eveningStats.map((stat) => [
        stat.seq,
        stat.station,
        stat.samples,
        stat.days,
        stat.p20,
        stat.median,
        pct(stat.zeroRate),
        pct(stat.le10Rate),
        evidenceInterpretation(stat),
      ]),
    ]),
    "",
    "퇴근길은 서울 도심 후반부로 갈수록 승차 가능성이 급격히 달라집니다. 특히 명동입구와 명동성당은 p20 잔여좌석이 0석이고 저좌석 신호가 높아, 사용자가 계속 줄을 서는 대신 대기번호로 기다리며 다음 버스 승차 가능성을 안내받아야 하는 구간이라는 근거로 사용할 수 있습니다.",
    "",
    "## 5. 평일/휴일 퇴근 패턴 차이",
    "",
    markdownTable([
      ["순번", "정류장", "피크창", "샘플", "p20 좌석", "중앙값", "0석 신호", "10석 이하"],
      ...eveningWindowStats.map((stat) => [
        stat.seq,
        stat.station,
        stat.window,
        stat.samples,
        stat.p20,
        stat.median,
        pct(stat.zeroRate),
        pct(stat.le10Rate),
      ]),
    ]),
    "",
    "휴일 복귀는 아직 1일 데이터라 보조 근거로만 쓰는 것이 안전합니다. 다만 서울역 이후의 p20이 0석으로 떨어지는 패턴은 평일보다 더 강하게 나타납니다.",
    "",
    "## 6. 퇴근 15분 단위 호출·다음차 안내 구간",
    "",
    markdownTable([
      ["피크창", "시간", "순번", "정류장", "샘플", "p20 좌석", "중앙값", "안내 신호", "정책"],
      ...riskRows.map((stat) => [
        stat.window,
        stat.bucket,
        stat.seq,
        stat.station,
        stat.samples,
        stat.p20,
        stat.median,
        pct(stat.zeroRate),
        stat.policy,
      ]),
    ]),
    "",
    "이 표는 제출서의 `호출 인원 조정`, `다음차 안내`, `운수사 피크 수요 알림` 근거로 쓰기 좋습니다. 단, 셀별 샘플이 8개 미만인 구간은 정책 판단에서 제외했습니다.",
    "",
    "## 7. 좌석 감소 기반 최소 탑승 수요",
    "",
    markdownTable([
      ["순번", "정류장", "추정건수", "최소 탑승 합계", "평균", "p80", "최대", "수요 절단 비율"],
      ...boardingRows.map((stat) => [
        stat.seq,
        stat.station,
        stat.rows,
        stat.totalEstimated,
        stat.avgEstimated,
        stat.p80Estimated,
        stat.maxEstimated,
        pct(stat.censoredRate),
      ]),
    ]),
    "",
    "하차가 많지 않다는 가정하에서는 정류장 통과 전후 잔여좌석 감소량을 최소 탑승 수요로 볼 수 있습니다. 다만 좌석이 소진된 상태로 떠난 차량은 실제 수요가 관측값보다 클 수 있으므로 `수요 절단`으로 표시해야 합니다.",
    "",
    "## 8. 주말 점심 동탄→서울 예비 근거",
    "",
    markdownTable([
      ["순번", "정류장", "샘플", "p20 좌석", "중앙값", "0석 신호", "10석 이하", "해석"],
      ...weekendOutboundStats.map((stat) => [
        stat.seq,
        stat.station,
        stat.samples,
        stat.p20,
        stat.median,
        pct(stat.zeroRate),
        pct(stat.le10Rate),
        evidenceInterpretation(stat),
      ]),
    ]),
    "",
    "주말 점심 외출 시간대도 병목 후보입니다. 아직 1일치라 본문 핵심 근거보다는 보조 근거로 쓰는 것이 안전하지만, 한신더휴 이후부터 p20 좌석이 0석으로 떨어지고 후반 정류장은 0석 비율이 매우 높게 나타났습니다.",
    "",
    "아래 시간대 표는 예비 지표이므로 셀별 샘플 4개 이상만 표시합니다.",
    "",
    markdownTable([
      ["시간", "순번", "정류장", "샘플", "p20 좌석", "중앙값", "안내 신호"],
      ...weekendOutboundRiskRows.map((stat) => [
        stat.bucket,
        stat.seq,
        stat.station,
        stat.samples,
        stat.p20,
        stat.median,
        pct(stat.zeroRate),
      ]),
    ]),
    "",
    "주말 점심 최소 탑승 추정:",
    "",
    markdownTable([
      ["순번", "정류장", "추정건수", "최소 탑승 합계", "평균", "p80", "수요 절단 비율"],
      ...weekendOutboundBoardingRows.map((stat) => [
        stat.seq,
        stat.station,
        stat.rows,
        stat.totalEstimated,
        stat.avgEstimated,
        stat.p80Estimated,
        pct(stat.censoredRate),
      ]),
    ]),
    "",
    "## 9. 제출본에 추가하면 좋은 자료",
    "",
    "- 대시보드 캡처: 정류장별 준비도, 최신 수집 상태, 좌석 프로파일 화면",
    "- 차트 1: 다음 버스 승차 가능성 판단 지표",
    "- 차트 2: 평일 퇴근 호출·다음차 안내 heatmap",
    "- 차트 3: 서울역 이후 명동 구간에서 승차 가능성이 급변하는 정류장 순번 그래프",
    "- 현장 사진: 실제 대기줄, 바닥 노선번호 위치, 주변 분산 대기 가능 공간, 보행로 점유 여부",
    "- 현장 관찰표: 같은 시간대 실제 대기 인원, 탑승 인원, 미탑승 인원",
    "",
    "## 10. 제출 문구 초안",
    "",
    "> M4137 노선을 대상으로 경기도 GBIS 공식 API에서 차량별 잔여좌석과 정류장 순번을 수집한 결과, 퇴근 시간대 서울 도심 후반 정류장에서 승차 가능성이 시간대별로 크게 달라지는 패턴이 확인됐다. QueueBus는 이 데이터를 사용자 위치 인증 기반 대기열과 결합해, 이용자가 줄에 계속 서 있지 않아도 이번 버스와 다음 버스의 승차 가능성을 판단하도록 돕고, 탑승 가능성이 높은 대기번호 구간만 호출한다. 동시에 정류장별·시간대별 대기 수요 신호를 운수사와 운영기관에 제공해 배차 간격 조정과 현장 운영 판단의 근거를 만든다.",
    "",
    "## 부록. 출근길 예비 지표",
    "",
    markdownTable([
      ["순번", "정류장", "샘플", "관측일", "p20 좌석", "중앙값", "0석 신호", "10석 이하"],
      ...morningStats.map((stat) => [
        stat.seq,
        stat.station,
        stat.samples,
        stat.days,
        stat.p20,
        stat.median,
        pct(stat.zeroRate),
        pct(stat.le10Rate),
      ]),
    ]),
    "",
  ].join("\n");
}

function targetSeatStats(target, rows, holidayDates) {
  const targetSeq = String(target.targetStationSeq ?? target.staOrder);
  const targetRows = rows.filter((row) =>
    String(row.route_id) === String(target.routeId) &&
    String(row.current_station_seq) === targetSeq &&
    isTargetPeak(row, target.direction, row.collected_at, holidayDates),
  );
  const seats = targetRows
    .map((row) => toNumberOrNull(row.remain_seat_count))
    .filter((seat) => seat !== null && seat >= 0);
  const days = new Set(targetRows.map((row) => row.kst_date || kstParts(new Date(row.collected_at)).dateKey).filter(Boolean));
  const vehicles = new Set(targetRows.map((row) => row.veh_id || row.plate_no).filter(Boolean));

  return {
    direction: target.direction,
    seq: Number(targetSeq),
    station: target.targetStationName,
    samples: seats.length,
    days: days.size,
    vehicles: vehicles.size,
    ready: seats.length >= minSamples && days.size >= minDays,
    partial: seats.length > 0,
    ...seatDistribution(seats),
  };
}

function summarizeDirections(stats) {
  return [...groupBy(stats, (stat) => stat.direction).entries()]
    .map(([direction, directionStats]) => {
      const samples = sum(directionStats.map((stat) => stat.samples));
      const days = new Set();
      const weightedZero = sum(directionStats.map((stat) => stat.zeroRate * stat.samples));
      const weightedLe10 = sum(directionStats.map((stat) => stat.le10Rate * stat.samples));

      for (const stat of directionStats) {
        for (let index = 0; index < stat.days; index += 1) {
          days.add(`${stat.seq}:${index}`);
        }
      }

      return {
        direction,
        targets: directionStats.length,
        readyTargets: directionStats.filter((stat) => stat.ready).length,
        partialTargets: directionStats.filter((stat) => !stat.ready && stat.partial).length,
        samples,
        days: Math.max(...directionStats.map((stat) => stat.days), 0),
        zeroRate: ratio(weightedZero, samples),
        le10Rate: ratio(weightedLe10, samples),
      };
    });
}

function stationWindowStats(targets, rows, holidayDates, direction) {
  const stats = [];

  for (const target of targets.filter((candidate) => candidate.direction === direction)) {
    const targetSeq = String(target.targetStationSeq ?? target.staOrder);
    const targetRows = rows.filter((row) =>
      String(row.route_id) === String(target.routeId) &&
      String(row.current_station_seq) === targetSeq &&
      isTargetPeak(row, direction, row.collected_at, holidayDates),
    );

    for (const [window, windowRows] of groupBy(targetRows, (row) => peakWindowLabel(row, direction, row.collected_at, holidayDates)).entries()) {
      const seats = windowRows
        .map((row) => toNumberOrNull(row.remain_seat_count))
        .filter((seat) => seat !== null && seat >= 0);

      stats.push({
        seq: Number(targetSeq),
        station: target.targetStationName,
        window,
        samples: seats.length,
        ...seatDistribution(seats),
      });
    }
  }

  return stats.sort((a, b) => a.seq - b.seq || a.window.localeCompare(b.window));
}

function stationBucketRisk(targets, rows, holidayDates, direction, sampleThreshold = minBucketSamples) {
  const stats = [];

  for (const target of targets.filter((candidate) => candidate.direction === direction)) {
    const targetSeq = String(target.targetStationSeq ?? target.staOrder);
    const targetRows = rows.filter((row) =>
      String(row.route_id) === String(target.routeId) &&
      String(row.current_station_seq) === targetSeq &&
      isTargetPeak(row, direction, row.collected_at, holidayDates),
    );
    const groups = groupBy(targetRows, (row) => [
      peakWindowLabel(row, direction, row.collected_at, holidayDates),
      row.kst_time_bucket_15m || timeBucket(row.collected_at),
    ].join("|"));

    for (const [key, bucketRows] of groups.entries()) {
      const [window, bucket] = key.split("|");
      const seats = bucketRows
        .map((row) => toNumberOrNull(row.remain_seat_count))
        .filter((seat) => seat !== null && seat >= 0);
      const distribution = seatDistribution(seats);
      const callCount = conservativeCallCount(distribution.p20);
      const stat = {
        window,
        bucket,
        seq: Number(targetSeq),
        station: target.targetStationName,
        samples: seats.length,
        ...distribution,
        policy: seats.length < sampleThreshold ? "데이터 보강" : callPolicy(distribution, callCount),
      };

      if (stat.samples >= sampleThreshold) {
        stats.push(stat);
      }
    }
  }

  return stats.sort((a, b) =>
    b.zeroRate - a.zeroRate ||
    (a.p20 ?? 999) - (b.p20 ?? 999) ||
    b.le10Rate - a.le10Rate ||
    a.window.localeCompare(b.window) ||
    a.bucket.localeCompare(b.bucket) ||
    a.seq - b.seq,
  );
}

function boardingStats(targets, estimates, direction) {
  const byLabel = new Map(targets.map((target) => [target.label, target]));

  return targets
    .filter((target) => target.direction === direction)
    .map((target) => {
      const rows = estimates.filter((row) => row.target_label === target.label);
      const counts = rows
        .map((row) => toNumberOrNull(row.estimated_boarded_count))
        .filter((count) => count !== null && count >= 0);
      const candidate = byLabel.get(target.label) ?? target;

      return {
        seq: Number(candidate.targetStationSeq ?? candidate.staOrder),
        station: candidate.targetStationName,
        rows: rows.length,
        totalEstimated: sum(counts),
        avgEstimated: round(avg(counts), 1),
        p80Estimated: percentile(counts, 0.8),
        maxEstimated: counts.length ? Math.max(...counts) : null,
        censoredRate: ratio(rows.filter((row) => row.is_demand_censored === "true").length, rows.length),
      };
    });
}

function isTargetPeak(row, direction, iso, holidayDates) {
  const label = row.time_peak_window;
  const windows = PEAK_WINDOWS.filter((window) => window.targetDirection === direction);

  if (label) {
    const normalizedLabel = normalizePeakLabel(label);
    if (windows.some((window) => window.label === normalizedLabel)) {
      return true;
    }

    if (PEAK_WINDOWS.some((window) => window.label === normalizedLabel)) {
      return false;
    }
  }

  const parts = kstParts(new Date(iso));
  const dayType = row.day_type || dayTypeForParts(parts, holidayDates);

  return windows.some((window) => isInPeakWindow(parts, dayType, window));
}

function isWindowTime(label, iso, holidayDates) {
  if (!iso) {
    return false;
  }

  const window = PEAK_WINDOWS.find((candidate) => candidate.label === label);
  if (!window) {
    return false;
  }

  const parts = kstParts(new Date(iso));
  const dayType = dayTypeForParts(parts, holidayDates);

  return isInPeakWindow(parts, dayType, window);
}

function peakWindowLabel(row, direction, iso, holidayDates) {
  const windows = PEAK_WINDOWS.filter((window) => window.targetDirection === direction);
  const normalizedLabel = normalizePeakLabel(row.time_peak_window);

  if (normalizedLabel && windows.some((window) => window.label === normalizedLabel)) {
    return normalizedLabel;
  }

  const parts = kstParts(new Date(iso));
  const dayType = row.day_type || dayTypeForParts(parts, holidayDates);
  const window = windows.find((candidate) => isInPeakWindow(parts, dayType, candidate));

  return window?.label ?? "기타";
}

function normalizePeakLabel(label) {
  if (label === "출근 06:30-09:30") {
    return "평일 출근 06:30-09:30";
  }

  if (label === "퇴근 17:30-20:30" || label === "퇴근 16:00-20:30") {
    return "평일 퇴근 16:00-20:30";
  }

  return label ?? "";
}

function seatDistribution(seats) {
  return {
    min: seats.length ? Math.min(...seats) : null,
    p10: percentile(seats, 0.1),
    p20: percentile(seats, 0.2),
    median: percentile(seats, 0.5),
    avg: round(avg(seats), 1),
    max: seats.length ? Math.max(...seats) : null,
    zeroRate: ratio(seats.filter((seat) => seat === 0).length, seats.length),
    le10Rate: ratio(seats.filter((seat) => seat <= 10).length, seats.length),
  };
}

function evidenceInterpretation(stat) {
  if ((stat.p20 ?? 0) <= 0 || stat.zeroRate >= 0.2) {
    return "다음차 안내 필요";
  }

  if (stat.le10Rate >= 0.2 || (stat.p20 ?? 0) <= 10) {
    return "보수 호출 필요";
  }

  return "일반 호출 가능";
}

function conservativeCallCount(p20Seats) {
  if (p20Seats === null || p20Seats <= 0) {
    return 0;
  }

  const buffer = Math.max(2, Math.ceil(p20Seats * 0.15));
  return Math.max(0, Math.floor(p20Seats - buffer));
}

function callPolicy(distribution, callCount) {
  if (distribution.zeroRate >= 0.2 || (distribution.p20 ?? 0) <= 2) {
    return "호출 보류/다음차 안내";
  }

  if (callCount <= 3) {
    return "소수 호출";
  }

  return "호출 가능";
}

function validSeat(value) {
  const seat = toNumberOrNull(value);
  return seat !== null && seat >= 0;
}

function markdownTable(rows) {
  if (rows.length === 0) {
    return "";
  }

  const [headers, ...body] = rows;
  const separator = headers.map(() => "---");

  return [headers, separator, ...body]
    .map((row) => `| ${row.map(formatCell).join(" | ")} |`)
    .join("\n");
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value).replace(/\|/g, "\\|");
}

function pct(value) {
  return `${round(value * 100, 1)}%`;
}

function formatNumber(value) {
  return Number(value).toLocaleString("ko-KR");
}

function formatKst(iso) {
  if (!iso) {
    return "-";
  }

  const parts = kstParts(new Date(iso));
  return `${parts.dateKey} ${parts.timeTextWithSeconds}`;
}

function minDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] ?? "";
}

function maxDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] ?? "";
}

function timeBucket(iso) {
  const parts = kstParts(new Date(iso));
  const minute = Math.floor(parts.minuteOfDay / 15) * 15;
  const hour = Math.floor(minute / 60);
  const minutePart = minute % 60;

  return `${String(hour).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function groupBy(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  return groups;
}

function dedupeBy(rows, keyFn) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function avg(values) {
  return values.length === 0 ? null : sum(values) / values.length;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value, digits) {
  if (value === null) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
