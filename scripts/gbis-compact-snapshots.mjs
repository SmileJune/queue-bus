#!/usr/bin/env node
import {
  parseArgs,
  readCsvRows,
  writeCsvRows,
} from "./gbis-client.mjs";

const SNAPSHOT_COLUMNS = [
  "collected_at",
  "source_query_time",
  "snapshot_type",
  "target_label",
  "route_id",
  "route_name",
  "target_station_id",
  "target_station_name",
  "target_station_seq",
  "target_sta_order",
  "veh_id",
  "plate_no",
  "current_station_id",
  "current_station_seq",
  "state_cd",
  "arrival_rank",
  "location_no",
  "predict_time_sec",
  "remain_seat_count",
  "route_type_cd",
  "crowded",
  "low_plate",
  "tagless_cd",
  "result_code",
  "result_message",
];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

const inputPath = args.in ?? "data/gbis-seat-snapshots.csv";
const outputPath = args.out ?? "data/gbis-seat-snapshots.compact.csv";

try {
  const rows = await readCsvRows(inputPath);
  const compacted = compactSnapshotRows(rows);
  await writeCsvRows(outputPath, SNAPSHOT_COLUMNS, compacted);
  console.log(`[gbis:compact] ${rows.length} row(s) -> ${compacted.length} row(s).`);
  console.log(`[gbis:compact] Wrote ${outputPath}.`);
} catch (error) {
  console.error(`[gbis:compact] ${error.message}`);
  process.exit(1);
}

function compactSnapshotRows(rows) {
  const seenLocationKeys = new Set();
  const compacted = [];

  for (const row of rows) {
    if (row.snapshot_type !== "location") {
      compacted.push(row);
      continue;
    }

    const key = [
      row.collected_at,
      row.route_id,
      row.veh_id || row.plate_no,
      row.current_station_id,
      row.current_station_seq,
      row.state_cd,
      row.remain_seat_count,
    ].join("|");

    if (seenLocationKeys.has(key)) {
      continue;
    }

    seenLocationKeys.add(key);
    compacted.push(normalizeLocationRow(row));
  }

  return compacted;
}

function normalizeLocationRow(row) {
  return {
    ...row,
    target_label: `route-${row.route_id}-location`,
    target_station_id: "",
    target_station_name: "",
    target_station_seq: "",
    target_sta_order: "",
    arrival_rank: "",
    location_no: "",
    predict_time_sec: "",
  };
}

function printUsage() {
  console.log(`Usage:
  npm run gbis:compact
  npm run gbis:compact -- --in data/gbis-seat-snapshots.csv --out data/gbis-seat-snapshots.compact.csv

The compactor keeps arrival rows as-is and rewrites duplicated location rows
into one route-level row per collected_at + route + vehicle + station sample.`);
}
