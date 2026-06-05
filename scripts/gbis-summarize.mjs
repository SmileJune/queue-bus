#!/usr/bin/env node
import {
  parseArgs,
  readCsvRows,
  readJsonFile,
  toNumberOrNull,
} from "./gbis-client.mjs";

const args = parseArgs(process.argv.slice(2));
const snapshotPath = args.snapshots ?? "data/gbis-seat-snapshots.csv";
const estimatesPath = args.estimates ?? "data/gbis-boarded-estimates.csv";
const configPath = args.config ?? "data/gbis-targets.json";

try {
  const [snapshots, estimates, config] = await Promise.all([
    readCsvRows(snapshotPath),
    readCsvRows(estimatesPath),
    readJsonFile(configPath).catch(() => ({ targets: [] })),
  ]);
  printSnapshotSummary(snapshots, config.targets ?? []);
  printEstimateSummary(estimates);
} catch (error) {
  console.error(`[gbis:summarize] ${error.message}`);
  process.exit(1);
}

function printSnapshotSummary(rows, targets) {
  const locationRows = dedupeBy(
    rows.filter((row) => row.snapshot_type === "location"),
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
  const enabledTargets = targets.filter((target) => target.enabled !== false);
  const groups = enabledTargets.length > 0
    ? summarizeDirections(locationRows, enabledTargets)
    : summarizeByGroup(locationRows, (row) => directionFromLabel(row.target_label));

  console.log("\nSnapshot summary by direction");
  console.table(groups.map((group) => ({
    direction: group.key ?? group.direction,
    rows: group.count,
    vehicles: group.vehicleCount,
    min_seats: group.minSeats,
    avg_seats: group.avgSeats,
    max_seats: group.maxSeats,
    first_seen: group.firstSeen,
    last_seen: group.lastSeen,
  })));

  const stationGroups = enabledTargets.length > 0
    ? summarizeTargets(locationRows, enabledTargets)
    : summarizeByGroup(locationRows, (row) => row.target_label);
  console.log("\nSnapshot summary by target");
  console.table(stationGroups.map((group) => ({
    target: group.key ?? group.target,
    rows: group.count,
    vehicles: group.vehicleCount,
    min_seats: group.minSeats,
    avg_seats: group.avgSeats,
    max_seats: group.maxSeats,
    first_seen: group.firstSeen,
    last_seen: group.lastSeen,
  })));
}

function summarizeDirections(rows, targets) {
  const groups = new Map();

  for (const target of targets) {
    const direction = directionFromLabel(target.label);
    const targetSeq = toNumberOrNull(target.targetStationSeq ?? target.staOrder);
    if (targetSeq === null) {
      continue;
    }

    const current = groups.get(direction) ?? {
      key: direction,
      seqs: [],
    };
    current.seqs.push(targetSeq);
    groups.set(direction, current);
  }

  return [...groups.values()].map((group) => {
    const minSeq = Math.min(...group.seqs);
    const maxSeq = Math.max(...group.seqs);
    const rangeRows = rows.filter((row) => {
      const seq = toNumberOrNull(row.current_station_seq);
      return seq !== null && seq >= minSeq && seq <= maxSeq;
    });
    return {
      key: group.key,
      ...summarizeRows(rangeRows),
    };
  });
}

function summarizeTargets(rows, targets) {
  return targets
    .map((target) => {
      const targetSeq = toNumberOrNull(target.targetStationSeq ?? target.staOrder);
      const passRows = rows.filter((row) => targetSeq !== null && toNumberOrNull(row.current_station_seq) === targetSeq);
      return {
        key: `${target.label}`,
        ...summarizeRows(passRows),
      };
    })
    .sort((a, b) => (a.key > b.key ? 1 : -1));
}

function printEstimateSummary(rows) {
  if (rows.length === 0) {
    console.log("\nBoarding estimate summary\nNo estimate rows yet. Keep collecting until vehicles pass target stops.");
    return;
  }

  const groups = new Map();

  for (const row of rows) {
    const direction = directionFromLabel(row.target_label);
    const current = groups.get(direction) ?? {
      direction,
      rows: 0,
      estimatedBoardedCount: 0,
      censoredRows: 0,
      firstSeen: "",
      lastSeen: "",
    };

    current.rows += 1;
    current.estimatedBoardedCount += toNumberOrNull(row.estimated_boarded_count) ?? 0;
    current.censoredRows += row.is_demand_censored === "true" ? 1 : 0;
    current.firstSeen = minDateString(current.firstSeen, row.before_collected_at);
    current.lastSeen = maxDateString(current.lastSeen, row.after_collected_at);
    groups.set(direction, current);
  }

  console.log("\nBoarding estimate summary by direction");
  console.table([...groups.values()]);
}

function summarizeByGroup(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const seats = toNumberOrNull(row.remain_seat_count);
    if (seats === null || seats < 0) {
      continue;
    }

    const key = keyFn(row);
    const current = groups.get(key) ?? {
      key,
      count: 0,
      seatSum: 0,
      minSeats: seats,
      maxSeats: seats,
      vehicles: new Set(),
      firstSeen: "",
      lastSeen: "",
    };

    current.count += 1;
    current.seatSum += seats;
    current.minSeats = Math.min(current.minSeats, seats);
    current.maxSeats = Math.max(current.maxSeats, seats);
    current.vehicles.add(row.veh_id || row.plate_no);
    current.firstSeen = minDateString(current.firstSeen, row.collected_at);
    current.lastSeen = maxDateString(current.lastSeen, row.collected_at);
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    vehicleCount: [...group.vehicles].filter(Boolean).length,
    avgSeats: group.count === 0 ? 0 : Math.round((group.seatSum / group.count) * 10) / 10,
  }));
}

function summarizeRows(rows) {
  if (rows.length === 0) {
    return {
      count: 0,
      vehicleCount: 0,
      minSeats: null,
      avgSeats: null,
      maxSeats: null,
      firstSeen: "",
      lastSeen: "",
    };
  }

  const seats = [];
  const vehicles = new Set();
  let firstSeen = "";
  let lastSeen = "";

  for (const row of rows) {
    const seat = toNumberOrNull(row.remain_seat_count);
    if (seat === null || seat < 0) {
      continue;
    }

    seats.push(seat);
    vehicles.add(row.veh_id || row.plate_no);
    firstSeen = minDateString(firstSeen, row.collected_at);
    lastSeen = maxDateString(lastSeen, row.collected_at);
  }

  return {
    count: seats.length,
    vehicleCount: [...vehicles].filter(Boolean).length,
    minSeats: seats.length ? Math.min(...seats) : null,
    avgSeats: seats.length
      ? Math.round((seats.reduce((sum, seat) => sum + seat, 0) / seats.length) * 10) / 10
      : null,
    maxSeats: seats.length ? Math.max(...seats) : null,
    firstSeen,
    lastSeen,
  };
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

function directionFromLabel(label) {
  label = String(label ?? "");

  if (label.includes("dongtan-to-seoul")) {
    return "출근 동탄→서울";
  }

  if (label.includes("seoul-to-dongtan")) {
    return "퇴근 서울→동탄";
  }

  return "미분류";
}

function minDateString(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return new Date(candidate).getTime() < new Date(current).getTime() ? candidate : current;
}

function maxDateString(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}
