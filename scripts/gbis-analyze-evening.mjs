#!/usr/bin/env node
import {
  parseArgs,
  readCsvRows,
  readJsonFile,
  toNumberOrNull,
  writeCsvRows,
} from "./gbis-client.mjs";
import {
  DEFAULT_HOLIDAY_CALENDAR_PATH,
  dayTypeForParts,
  kstParts,
  loadHolidayDates,
} from "./peak-windows.mjs";

const DIRECTION = "서울→동탄";
const SNAPSHOT_TYPE_LOCATION = "location";
const SNAPSHOT_TYPE_ARRIVAL = "arrival";

const args = parseArgs(process.argv.slice(2));
const snapshotPath = args.snapshots ?? "data/gbis-seat-snapshots.csv";
const estimatesPath = args.estimates ?? "data/gbis-boarded-estimates.csv";
const configPath = args.config ?? "data/gbis-targets.json";
const holidayCalendarPath = args["holiday-calendar"] ?? DEFAULT_HOLIDAY_CALENDAR_PATH;
const minSamples = Number(args["min-samples"] ?? 30);
const minBucketSamples = Number(args["min-bucket-samples"] ?? 8);
const stationBucketOutputPath = args["station-buckets-out"] ?? "data/gbis-evening-station-buckets.csv";

const STATION_BUCKET_COLUMNS = [
  "window",
  "bucket",
  "seq",
  "station",
  "samples",
  "days",
  "vehicles",
  "min",
  "p10",
  "p20",
  "median",
  "avg",
  "max",
  "zero_rate_pct",
  "le10_rate_pct",
  "buffer",
  "call_count",
  "policy",
];

try {
  const [snapshots, estimates, config] = await Promise.all([
    readCsvRows(snapshotPath),
    readCsvRows(estimatesPath).catch(() => []),
    readJsonFile(configPath),
  ]);
  const holidayDates = loadHolidayDates(holidayCalendarPath);
  const targets = (config.targets ?? [])
    .filter((target) => target.enabled !== false && target.direction === DIRECTION)
    .sort((a, b) => Number(a.targetStationSeq ?? a.staOrder) - Number(b.targetStationSeq ?? b.staOrder));

  if (targets.length === 0) {
    throw new Error(`No enabled targets for ${DIRECTION}.`);
  }

  await printEveningAnalysis(snapshots, estimates, targets, holidayDates);
} catch (error) {
  console.error(`[gbis:analyze:evening] ${error.message}`);
  process.exit(1);
}

async function printEveningAnalysis(snapshots, estimates, targets, holidayDates) {
  const targetSeqs = new Set(targets.map((target) => String(target.targetStationSeq ?? target.staOrder)));
  const locationRows = dedupeBy(
    snapshots.filter((row) =>
      row.snapshot_type === SNAPSHOT_TYPE_LOCATION &&
      targetSeqs.has(String(row.current_station_seq)) &&
      isEveningPeak(row, row.collected_at, holidayDates) &&
      validSeat(row.remain_seat_count),
    ),
    (row) => [
      row.collected_at,
      row.route_id,
      row.veh_id || row.plate_no,
      row.current_station_seq,
      row.remain_seat_count,
      row.state_cd,
    ].join("|"),
  );
  const arrivalRows = snapshots.filter((row) =>
    row.snapshot_type === SNAPSHOT_TYPE_ARRIVAL &&
    row.target_direction === DIRECTION &&
    isEveningPeak(row, row.collected_at, holidayDates) &&
    validSeat(row.remain_seat_count),
  );
  const rankOneArrivalRows = arrivalRows.filter((row) => String(row.arrival_rank) === "1");
  const eveningEstimates = estimates.filter((row) =>
    row.target_label?.includes("seoul-to-dongtan") &&
    isEveningPeak(row, row.after_collected_at, holidayDates),
  );

  console.log("\n퇴근길 분석 기준");
  console.table([{
    direction: DIRECTION,
    targets: targets.length,
    location_samples: locationRows.length,
    rank1_arrival_samples: rankOneArrivalRows.length,
    boarding_estimates: eveningEstimates.length,
    first_seen: minDate(locationRows.map((row) => row.collected_at)),
    last_seen: maxDate(locationRows.map((row) => row.collected_at)),
  }]);

  const stationStats = targets.map((target) =>
    stationSeatStats(target, locationRows.filter((row) =>
      String(row.current_station_seq) === String(target.targetStationSeq ?? target.staOrder),
    )),
  );
  console.log("\n정류장별 잔여좌석 분포");
  console.table(stationStats.map((stat) => ({
    seq: stat.seq,
    station: stat.station,
    samples: stat.samples,
    days: stat.days,
    vehicles: stat.vehicles,
    min: stat.min,
    p10: stat.p10,
    p20: stat.p20,
    median: stat.median,
    avg: stat.avg,
    zero_rate: pct(stat.zeroRate),
    le10_rate: pct(stat.le10Rate),
    ready: stat.samples >= minSamples ? "Y" : "N",
  })));

  console.log("\n피크창별 잔여좌석 분포");
  console.table(windowStats(locationRows, holidayDates).map((stat) => ({
    window: stat.window,
    samples: stat.samples,
    days: stat.days,
    vehicles: stat.vehicles,
    min: stat.min,
    p20: stat.p20,
    median: stat.median,
    avg: stat.avg,
    zero_rate: pct(stat.zeroRate),
    le10_rate: pct(stat.le10Rate),
  })));

  console.log("\n정류장 x 피크창 잔여좌석 분포");
  console.table(stationWindowStats(targets, locationRows, holidayDates).map((stat) => ({
    seq: stat.seq,
    station: stat.station,
    window: stat.window,
    samples: stat.samples,
    p20: stat.p20,
    median: stat.median,
    avg: stat.avg,
    zero_rate: pct(stat.zeroRate),
    le10_rate: pct(stat.le10Rate),
  })));

  const stationBuckets = stationBucketStats(targets, locationRows, holidayDates);
  await writeCsvRows(stationBucketOutputPath, STATION_BUCKET_COLUMNS, stationBuckets.map((stat) => ({
    window: stat.window,
    bucket: stat.bucket,
    seq: stat.seq,
    station: stat.station,
    samples: stat.samples,
    days: stat.days,
    vehicles: stat.vehicles,
    min: stat.min,
    p10: stat.p10,
    p20: stat.p20,
    median: stat.median,
    avg: stat.avg,
    max: stat.max,
    zero_rate_pct: round(stat.zeroRate * 100, 1),
    le10_rate_pct: round(stat.le10Rate * 100, 1),
    buffer: stat.buffer,
    call_count: stat.callCount,
    policy: stat.policy,
  })));

  console.log(`\n정류장 x 15분 분석 CSV: ${stationBucketOutputPath}`);
  console.log(`15분 셀 최소 샘플 기준: ${minBucketSamples}`);

  console.log("\n평일 퇴근 정류장 x 15분 호출 인원 heatmap");
  console.table(callHeatmap(stationBuckets, "평일 퇴근 16:00-20:30"));

  console.log("\n휴일 복귀 정류장 x 15분 호출 인원 heatmap");
  console.table(callHeatmap(stationBuckets, "휴일 복귀 16:00-20:00"));

  console.log("\n위험 셀 상위");
  console.table(riskCells(stationBuckets).map((stat) => ({
    window: stat.window,
    bucket: stat.bucket,
    seq: stat.seq,
    station: stat.station,
    samples: stat.samples,
    p20: stat.p20,
    median: stat.median,
    zero_rate: pct(stat.zeroRate),
    le10_rate: pct(stat.le10Rate),
    policy: stat.policy,
  })));

  console.log("\n15분 버킷별 만석 위험");
  console.table(bucketStats(locationRows).map((stat) => ({
    bucket: stat.bucket,
    samples: stat.samples,
    vehicles: stat.vehicles,
    min: stat.min,
    p20: stat.p20,
    median: stat.median,
    avg: stat.avg,
    zero_rate: pct(stat.zeroRate),
    le10_rate: pct(stat.le10Rate),
  })));

  const boardingStats = targets.map((target) =>
    targetBoardingStats(target, eveningEstimates.filter((row) => row.target_label === target.label)),
  );
  console.log("\n정류장별 최소 탑승 추정");
  console.table(boardingStats.map((stat) => ({
    seq: stat.seq,
    station: stat.station,
    rows: stat.rows,
    total_min_boarded: stat.totalEstimated,
    avg_min_boarded: stat.avgEstimated,
    p80_min_boarded: stat.p80Estimated,
    max_min_boarded: stat.maxEstimated,
    censored_rate: pct(stat.censoredRate),
    increased_rows: stat.increasedRows,
  })));

  console.log("\n보수적 호출 인원 초안");
  console.table(stationStats.map((stat) => {
    const buffer = callBuffer(stat.p20);
    const callCount = Math.max(0, Math.floor((stat.p20 ?? 0) - buffer));
    return {
      seq: stat.seq,
      station: stat.station,
      p20_seats: stat.p20,
      zero_rate: pct(stat.zeroRate),
      buffer,
      call_count: callCount,
      policy: callPolicy(stat, callCount),
    };
  }));

  const rankOneStats = targets.map((target) =>
    stationSeatStats(target, rankOneArrivalRows.filter((row) => row.target_label === target.label)),
  );
  console.log("\n다음 차량 도착 API 기준");
  console.table(rankOneStats.map((stat) => ({
    seq: stat.seq,
    station: stat.station,
    samples: stat.samples,
    p20: stat.p20,
    median: stat.median,
    avg: stat.avg,
    zero_rate: pct(stat.zeroRate),
    le10_rate: pct(stat.le10Rate),
  })));
}

function stationSeatStats(target, rows) {
  const seats = rows
    .map((row) => toNumberOrNull(row.remain_seat_count))
    .filter((seat) => seat !== null && seat >= 0);
  const days = new Set(rows.map((row) => row.kst_date || kstParts(new Date(row.collected_at)).dateKey).filter(Boolean));
  const vehicles = new Set(rows.map((row) => row.veh_id || row.plate_no).filter(Boolean));
  const seq = Number(target.targetStationSeq ?? target.staOrder);

  return {
    seq,
    station: target.targetStationName,
    samples: seats.length,
    days: days.size,
    vehicles: vehicles.size,
    ...seatDistribution(seats),
  };
}

function targetBoardingStats(target, rows) {
  const estimates = rows
    .map((row) => toNumberOrNull(row.estimated_boarded_count))
    .filter((count) => count !== null && count >= 0);
  const increasedRows = rows.filter((row) => String(row.notes ?? "").includes("seat_count_increased")).length;

  return {
    seq: Number(target.targetStationSeq ?? target.staOrder),
    station: target.targetStationName,
    rows: rows.length,
    totalEstimated: sum(estimates),
    avgEstimated: round(avg(estimates), 1),
    p80Estimated: percentile(estimates, 0.8),
    maxEstimated: estimates.length ? Math.max(...estimates) : null,
    censoredRate: ratio(rows.filter((row) => row.is_demand_censored === "true").length, rows.length),
    increasedRows,
  };
}

function bucketStats(rows) {
  const groups = groupBy(rows, (row) => row.kst_time_bucket_15m || timeBucket(row.collected_at));

  return [...groups.entries()]
    .map(([bucket, bucketRows]) => {
      const seats = bucketRows
        .map((row) => toNumberOrNull(row.remain_seat_count))
        .filter((seat) => seat !== null && seat >= 0);
      const vehicles = new Set(bucketRows.map((row) => row.veh_id || row.plate_no).filter(Boolean));

      return {
        bucket,
        samples: seats.length,
        vehicles: vehicles.size,
        ...seatDistribution(seats),
      };
    })
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function windowStats(rows, holidayDates) {
  return [...groupBy(rows, (row) => peakWindowLabel(row, row.collected_at, holidayDates)).entries()]
    .map(([window, windowRows]) => {
      const seats = windowRows
        .map((row) => toNumberOrNull(row.remain_seat_count))
        .filter((seat) => seat !== null && seat >= 0);
      const days = new Set(windowRows.map((row) => row.kst_date || kstParts(new Date(row.collected_at)).dateKey).filter(Boolean));
      const vehicles = new Set(windowRows.map((row) => row.veh_id || row.plate_no).filter(Boolean));

      return {
        window,
        samples: seats.length,
        days: days.size,
        vehicles: vehicles.size,
        ...seatDistribution(seats),
      };
    })
    .sort((a, b) => a.window.localeCompare(b.window));
}

function stationWindowStats(targets, rows, holidayDates) {
  const stats = [];

  for (const target of targets) {
    const seq = String(target.targetStationSeq ?? target.staOrder);
    const targetRows = rows.filter((row) => String(row.current_station_seq) === seq);

    for (const [window, windowRows] of groupBy(targetRows, (row) => peakWindowLabel(row, row.collected_at, holidayDates)).entries()) {
      stats.push({
        seq: Number(seq),
        station: target.targetStationName,
        window,
        samples: windowRows.length,
        ...seatDistribution(windowRows
          .map((row) => toNumberOrNull(row.remain_seat_count))
          .filter((seat) => seat !== null && seat >= 0)),
      });
    }
  }

  return stats.sort((a, b) => a.seq - b.seq || a.window.localeCompare(b.window));
}

function stationBucketStats(targets, rows, holidayDates) {
  const stats = [];

  for (const target of targets) {
    const seq = String(target.targetStationSeq ?? target.staOrder);
    const targetRows = rows.filter((row) => String(row.current_station_seq) === seq);
    const groups = groupBy(targetRows, (row) =>
      [
        peakWindowLabel(row, row.collected_at, holidayDates),
        row.kst_time_bucket_15m || timeBucket(row.collected_at),
      ].join("|"),
    );

    for (const [key, bucketRows] of groups.entries()) {
      const [window, bucket] = key.split("|");
      const seats = bucketRows
        .map((row) => toNumberOrNull(row.remain_seat_count))
        .filter((seat) => seat !== null && seat >= 0);
      const days = new Set(bucketRows.map((row) => row.kst_date || kstParts(new Date(row.collected_at)).dateKey).filter(Boolean));
      const vehicles = new Set(bucketRows.map((row) => row.veh_id || row.plate_no).filter(Boolean));
      const distribution = seatDistribution(seats);
      const buffer = callBuffer(distribution.p20);
      const callCount = Math.max(0, Math.floor((distribution.p20 ?? 0) - buffer));
      const baseStat = {
        seq: Number(seq),
        station: target.targetStationName,
        window,
        bucket,
        samples: seats.length,
        days: days.size,
        vehicles: vehicles.size,
        ...distribution,
        buffer,
        callCount,
      };

      stats.push({
        ...baseStat,
        policy: baseStat.samples < minBucketSamples
          ? "데이터 보강"
          : callPolicy(baseStat, callCount),
      });
    }
  }

  return stats.sort((a, b) =>
    a.window.localeCompare(b.window) ||
    a.seq - b.seq ||
    a.bucket.localeCompare(b.bucket),
  );
}

function callHeatmap(stats, window) {
  const windowStats = stats.filter((stat) => stat.window === window);
  const buckets = [...new Set(windowStats.map((stat) => stat.bucket))].sort();
  const rowsByStation = groupBy(windowStats, (stat) => `${stat.seq}|${stat.station}`);

  return [...rowsByStation.entries()]
    .sort((a, b) => Number(a[0].split("|")[0]) - Number(b[0].split("|")[0]))
    .map(([stationKey, stationStats]) => {
      const [seq, station] = stationKey.split("|");
      const row = { seq: Number(seq), station };
      const byBucket = new Map(stationStats.map((stat) => [stat.bucket, stat]));

      for (const bucket of buckets) {
        row[bucket] = compactCallCell(byBucket.get(bucket));
      }

      return row;
    });
}

function compactCallCell(stat) {
  if (!stat) {
    return "-";
  }

  if (stat.samples < minBucketSamples) {
    return `보강(${stat.samples})`;
  }

  if (stat.policy === "호출 보류/다음차 안내") {
    return `보류 z${round(stat.zeroRate * 100, 0)}`;
  }

  if (stat.policy === "소수 호출") {
    return `소수${stat.callCount}`;
  }

  return String(stat.callCount);
}

function riskCells(stats) {
  return stats
    .filter((stat) => stat.samples >= minBucketSamples)
    .sort((a, b) =>
      b.zeroRate - a.zeroRate ||
      (a.p20 ?? 999) - (b.p20 ?? 999) ||
      b.le10Rate - a.le10Rate ||
      a.window.localeCompare(b.window) ||
      a.bucket.localeCompare(b.bucket) ||
      a.seq - b.seq,
    )
    .slice(0, 20);
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

function isEveningPeak(row, iso, holidayDates) {
  if (row.time_peak_window === "평일 퇴근 16:00-20:30" || row.time_peak_window === "휴일 복귀 16:00-20:00") {
    return true;
  }

  const parts = kstParts(new Date(iso));
  const dayType = row.day_type || dayTypeForParts(parts, holidayDates);
  const endMinute = dayType === "weekday" ? 20 * 60 + 30 : 20 * 60;

  return parts.minuteOfDay >= 16 * 60 && parts.minuteOfDay <= endMinute;
}

function peakWindowLabel(row, iso, holidayDates) {
  if (row.time_peak_window) {
    return row.time_peak_window;
  }

  const parts = kstParts(new Date(iso));
  const dayType = row.day_type || dayTypeForParts(parts, holidayDates);

  return dayType === "weekday" ? "평일 퇴근 16:00-20:30" : "휴일 복귀 16:00-20:00";
}

function validSeat(value) {
  const seat = toNumberOrNull(value);
  return seat !== null && seat >= 0;
}

function callBuffer(p20Seats) {
  if (p20Seats === null || p20Seats <= 0) {
    return 0;
  }

  return Math.max(2, Math.ceil(p20Seats * 0.15));
}

function callPolicy(stat, callCount) {
  if (stat.zeroRate >= 0.2 || (stat.p20 ?? 0) <= 2) {
    return "호출 보류/다음차 안내";
  }

  if (callCount <= 3) {
    return "소수 호출";
  }

  if (stat.le10Rate >= 0.5) {
    return "보수 호출";
  }

  return "일반 호출";
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

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
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

function pct(value) {
  return `${round(value * 100, 1)}%`;
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
