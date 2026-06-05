#!/usr/bin/env node
import {
  parseArgs,
  readCsvRows,
  readJsonFile,
  toNumberOrNull,
  writeCsvRows,
} from "./gbis-client.mjs";

const DERIVED_COLUMNS = [
  "target_label",
  "route_id",
  "route_name",
  "target_station_id",
  "target_station_name",
  "target_station_seq",
  "veh_id",
  "plate_no",
  "before_collected_at",
  "after_collected_at",
  "before_station_seq",
  "after_station_seq",
  "before_remain_seat_count",
  "after_remain_seat_count",
  "seat_delta",
  "estimated_boarded_count",
  "demand_lower_bound",
  "is_demand_censored",
  "notes",
];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

const inputPath = args.in ?? "data/gbis-seat-snapshots.csv";
const outputPath = args.out ?? "data/gbis-boarded-estimates.csv";
const configPath = args.config ?? "data/gbis-targets.json";

try {
  const [snapshots, config] = await Promise.all([
    readCsvRows(inputPath),
    readJsonFile(configPath).catch(() => ({ targets: [] })),
  ]);
  const estimates = deriveBoardingEstimates(snapshots, config.targets ?? []);
  await writeCsvRows(outputPath, DERIVED_COLUMNS, estimates);
  console.log(`[gbis:derive] Wrote ${estimates.length} estimate row(s) to ${outputPath}.`);
} catch (error) {
  console.error(`[gbis:derive] ${error.message}`);
  process.exit(1);
}

function deriveBoardingEstimates(snapshots, configuredTargets) {
  const targets = buildTargets(snapshots, configuredTargets);
  const locationRows = dedupeBy(
    snapshots.filter(isUsableLocationRow),
    (row) => [
      row.collected_at,
      row.route_id,
      row.veh_id || row.plate_no,
      row.current_station_id,
      row.current_station_seq,
      row.remain_seat_count,
      row.state_cd,
    ].join("|"),
  );
  const arrivalRows = snapshots.filter(isUsableArrivalRow);
  const locationsByRouteVehicle = groupRows(
    locationRows,
    (row) => `${row.route_id}|${row.veh_id || row.plate_no}`,
  );
  const arrivalsByTargetVehicle = groupRows(
    arrivalRows,
    (row) => `${row.target_label}|${row.veh_id || row.plate_no}`,
  );
  const estimates = [];

  for (const target of targets) {
    const targetSeq = toNumberOrNull(target.targetStationSeq ?? target.staOrder);
    if (!target.routeId || targetSeq === null || targetSeq <= 0) {
      continue;
    }

    const routeVehicleKeys = [...locationsByRouteVehicle.keys()]
      .filter((key) => key.startsWith(`${target.routeId}|`));
    const arrivalVehicleKeys = [...arrivalsByTargetVehicle.keys()]
      .filter((key) => key.startsWith(`${target.label}|`))
      .map((key) => `${target.routeId}|${key.split("|")[1]}`);
    const vehicleKeys = [...new Set([...routeVehicleKeys, ...arrivalVehicleKeys])];

    for (const vehicleKey of vehicleKeys) {
      const vehicleId = vehicleKey.split("|")[1];
      const rows = [
        ...(locationsByRouteVehicle.get(vehicleKey) ?? []),
        ...(arrivalsByTargetVehicle.get(`${target.label}|${vehicleId}`) ?? []),
      ].sort((a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime());

      let before = null;

      for (const row of rows) {
        const currentSeq = toNumberOrNull(row.current_station_seq);
        const stateCd = String(row.state_cd ?? "");

        if (currentSeq === null) {
          continue;
        }

        if (row.snapshot_type === "arrival") {
          before = row;
          continue;
        }

        if (currentSeq < targetSeq) {
          before = row;
          continue;
        }

        const isAfterTargetBoarding = currentSeq === targetSeq && stateCd === "2";

        if (before && isAfterTargetBoarding) {
          estimates.push(buildEstimate(target, before, row));
          before = null;
        }
      }
    }
  }

  return estimates;
}

function isUsableLocationRow(row) {
  if (row.snapshot_type !== "location") {
    return false;
  }

  const remainSeatCount = toNumberOrNull(row.remain_seat_count);
  const stationSeq = toNumberOrNull(row.current_station_seq);

  return Boolean(row.route_id && (row.veh_id || row.plate_no))
    && remainSeatCount !== null
    && remainSeatCount >= 0
    && stationSeq !== null;
}

function isUsableArrivalRow(row) {
  if (row.snapshot_type !== "arrival") {
    return false;
  }

  const remainSeatCount = toNumberOrNull(row.remain_seat_count);
  const stationSeq = toNumberOrNull(row.current_station_seq);
  const targetSeq = toNumberOrNull(row.target_station_seq);

  return Boolean(row.target_label && row.route_id && (row.veh_id || row.plate_no))
    && remainSeatCount !== null
    && remainSeatCount >= 0
    && stationSeq !== null
    && targetSeq !== null
    && targetSeq > 0;
}

function buildTargets(snapshots, configuredTargets) {
  const targets = (configuredTargets ?? [])
    .filter((target) => target.enabled !== false)
    .map((target) => ({
      label: target.label,
      routeId: String(target.routeId ?? ""),
      routeName: target.routeName ?? "",
      targetStationId: String(target.targetStationId ?? ""),
      targetStationName: target.targetStationName ?? "",
      targetStationSeq: target.targetStationSeq,
      staOrder: target.staOrder,
    }))
    .filter((target) => target.label && target.routeId);

  if (targets.length > 0) {
    return targets;
  }

  const byLabel = new Map();
  for (const row of snapshots) {
    const targetSeq = toNumberOrNull(row.target_station_seq);
    if (!row.target_label || !row.route_id || targetSeq === null || targetSeq <= 0) {
      continue;
    }

    byLabel.set(row.target_label, {
      label: row.target_label,
      routeId: row.route_id,
      routeName: row.route_name,
      targetStationId: row.target_station_id,
      targetStationName: row.target_station_name,
      targetStationSeq: row.target_station_seq,
      staOrder: row.target_sta_order,
    });
  }

  return [...byLabel.values()];
}

function groupRows(rows, keyFn) {
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

function buildEstimate(target, before, after) {
  const beforeSeats = toNumberOrNull(before.remain_seat_count) ?? 0;
  const afterSeats = toNumberOrNull(after.remain_seat_count) ?? 0;
  const seatDelta = beforeSeats - afterSeats;
  const estimatedBoardedCount = Math.max(seatDelta, 0);
  const isDemandCensored = afterSeats === 0;
  const notes = seatDelta < 0
    ? "seat_count_increased; review alighting/data timing"
    : "";

  return {
    target_label: target.label,
    route_id: target.routeId,
    route_name: target.routeName || before.route_name || after.route_name,
    target_station_id: target.targetStationId,
    target_station_name: target.targetStationName,
    target_station_seq: target.targetStationSeq,
    veh_id: before.veh_id,
    plate_no: before.plate_no,
    before_collected_at: before.collected_at,
    after_collected_at: after.collected_at,
    before_station_seq: before.current_station_seq,
    after_station_seq: after.current_station_seq,
    before_remain_seat_count: beforeSeats,
    after_remain_seat_count: afterSeats,
    seat_delta: seatDelta,
    estimated_boarded_count: estimatedBoardedCount,
    demand_lower_bound: isDemandCensored
      ? Math.max(beforeSeats, estimatedBoardedCount)
      : estimatedBoardedCount,
    is_demand_censored: isDemandCensored,
    notes,
  };
}

function printUsage() {
  console.log(`Usage:
  npm run gbis:derive
  npm run gbis:derive -- --in data/gbis-seat-snapshots.csv --out data/gbis-boarded-estimates.csv

The derivation uses the MVP assumption that nobody alights at the target stop.
Rows with after_remain_seat_count = 0 are marked as censored demand.`);
}
