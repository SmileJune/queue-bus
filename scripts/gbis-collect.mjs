#!/usr/bin/env node
import {
  ENDPOINTS,
  appendCsvRows,
  describeGbisKeySelection,
  fetchGbisJson,
  getField,
  getItems,
  getResponseHeader,
  parseArgs,
  readJsonFile,
  toStringOrEmpty,
} from "./gbis-client.mjs";
import {
  DEFAULT_HOLIDAY_CALENDAR_PATH,
  kstAnalysisFields,
  loadHolidayDates,
} from "./peak-windows.mjs";

const SNAPSHOT_COLUMNS = [
  "collected_at",
  "source_query_time",
  "kst_date",
  "kst_time",
  "kst_weekday",
  "kst_minute_of_day",
  "kst_time_bucket_15m",
  "is_weekday",
  "is_holiday",
  "day_type",
  "time_peak_window",
  "snapshot_type",
  "target_label",
  "target_direction",
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

const configPath = args.config ?? "data/gbis-targets.json";
let config;

try {
  config = await readJsonFile(configPath);
} catch (error) {
  console.error(`[gbis:collect] Cannot read ${configPath}. Copy data/gbis-targets.example.json first.`);
  console.error(`[gbis:collect] ${error.message}`);
  process.exit(1);
}

const targetDirection = args.direction ?? args["target-direction"];
const targets = (config.targets ?? [])
  .filter((target) => target.enabled !== false)
  .filter((target) => !targetDirection || target.direction === targetDirection);
const outputPath = args.out ?? config.outputPath ?? "data/gbis-seat-snapshots.csv";
const intervalSeconds = Number(args.interval ?? config.pollIntervalSeconds ?? 60);
const holidayDates = loadHolidayDates(
  args["holiday-calendar"] ?? config.holidayCalendarPath ?? DEFAULT_HOLIDAY_CALENDAR_PATH,
);
const includeLocationSnapshots = parseBoolean(
  args.locations ?? config.includeLocationSnapshots ?? true,
);
const includeArrivalSnapshots = parseBoolean(
  args.arrivals ?? config.includeArrivalSnapshots ?? false,
);

if (targets.length === 0) {
  console.error("[gbis:collect] No enabled targets in config.");
  process.exit(1);
}

if (args.once) {
  await collectAndAppend();
} else {
  console.log(`[gbis:collect] Collecting ${targets.length} target(s) every ${intervalSeconds}s.`);
  if (targetDirection) {
    console.log(`[gbis:collect] Target direction: ${targetDirection}.`);
  }
  console.log(`[gbis:collect] Location snapshots: ${includeLocationSnapshots ? "route-normalized" : "off"}.`);
  console.log(`[gbis:collect] Arrival snapshots: ${includeArrivalSnapshots ? "on" : "off"}.`);
  console.log(`[gbis:collect] Key slots: ${formatKeyPolicySummary()}.`);
  console.log("[gbis:collect] Press Ctrl+C to stop.");
  await collectAndAppend();
  const timer = setInterval(() => {
    collectAndAppend().catch((error) => {
      console.error(`[gbis:collect] ${error.message}`);
    });
  }, intervalSeconds * 1000);

  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\n[gbis:collect] Stopped.");
    process.exit(0);
  });
}

async function collectAndAppend() {
  const rows = [];
  const targetsByRoute = new Map();

  for (const target of targets) {
    const routeTargets = targetsByRoute.get(target.routeId) ?? [];
    routeTargets.push(target);
    targetsByRoute.set(target.routeId, routeTargets);
  }

  for (const routeTargets of targetsByRoute.values()) {
    try {
      if (includeLocationSnapshots) {
        rows.push(...await collectLocationsForTargets(routeTargets));
      }

      for (const target of routeTargets) {
        if (shouldCollectArrivals(target)) {
          rows.push(...await collectArrivalItem(target));
        }
      }
    } catch (error) {
      const routeId = routeTargets[0]?.routeId ?? "unknown-route";
      console.error(`[gbis:collect] ${routeId}: ${error.message}`);
    }
  }

  await appendCsvRows(outputPath, SNAPSHOT_COLUMNS, rows);
  console.log(`[gbis:collect] ${new Date().toISOString()} appended ${rows.length} row(s) to ${outputPath}.`);
}

async function collectLocationsForTargets(routeTargets) {
  const target = routeTargets[0];
  const collectedAt = new Date().toISOString();
  const payload = await fetchGbisJson(
    ENDPOINTS.busLocations,
    { routeId: target.routeId },
  );
  const header = getResponseHeader(payload);
  const items = getItems(payload, ["busLocationList"]);

  return items.map((item) => ({
    ...baseRouteLocationRow(target, collectedAt, header),
    veh_id: getField(item, "vehId"),
    plate_no: getField(item, "plateNo"),
    current_station_id: getField(item, "stationId"),
    current_station_seq: getField(item, "stationSeq"),
    state_cd: getField(item, "stateCd"),
    remain_seat_count: getField(item, "remainSeatCnt"),
    route_type_cd: getField(item, "routeTypeCd"),
    crowded: getField(item, "crowded"),
    low_plate: getField(item, "lowPlate"),
    tagless_cd: getField(item, "taglessCd"),
  }));
}

async function collectArrivalItem(target) {
  const collectedAt = new Date().toISOString();
  const payload = await fetchGbisJson(ENDPOINTS.busArrivalItem, {
    stationId: target.targetStationId,
    routeId: target.routeId,
    staOrder: target.staOrder,
  }, { keySlot: arrivalKeySlotForTarget(target) });
  const header = getResponseHeader(payload);
  const items = getItems(payload, ["busArrivalItem"]);

  return items.flatMap((item) => [1, 2].map((rank) => {
    const vehId = getField(item, `vehId${rank}`);
    const plateNo = getField(item, `plateNo${rank}`);
    const remainSeatCount = getField(item, `remainSeatCnt${rank}`);

    if (!vehId && !plateNo) {
      return null;
    }

    return {
      ...baseRow(target, collectedAt, header, "arrival"),
      veh_id: vehId,
      plate_no: plateNo,
      current_station_id: target.targetStationId,
      current_station_seq: target.staOrder,
      state_cd: getField(item, `stateCd${rank}`),
      arrival_rank: rank,
      location_no: getField(item, `locationNo${rank}`),
      predict_time_sec: getField(item, `predictTimeSec${rank}`),
      remain_seat_count: remainSeatCount,
      route_type_cd: getField(item, "routeTypeCd"),
      crowded: getField(item, `crowded${rank}`),
      low_plate: getField(item, `lowPlate${rank}`),
      tagless_cd: getField(item, `taglessCd${rank}`),
    };
  }).filter(Boolean));
}

function baseRow(target, collectedAt, header, snapshotType) {
  return {
    collected_at: collectedAt,
    source_query_time: header.queryTime,
    ...kstAnalysisFields(collectedAt, holidayDates),
    snapshot_type: snapshotType,
    target_label: toStringOrEmpty(target.label),
    target_direction: toStringOrEmpty(target.direction),
    route_id: toStringOrEmpty(target.routeId),
    route_name: toStringOrEmpty(target.routeName),
    target_station_id: toStringOrEmpty(target.targetStationId),
    target_station_name: toStringOrEmpty(target.targetStationName),
    target_station_seq: toStringOrEmpty(target.targetStationSeq),
    target_sta_order: toStringOrEmpty(target.staOrder),
    veh_id: "",
    plate_no: "",
    current_station_id: "",
    current_station_seq: "",
    state_cd: "",
    arrival_rank: "",
    location_no: "",
    predict_time_sec: "",
    remain_seat_count: "",
    route_type_cd: "",
    crowded: "",
    low_plate: "",
    tagless_cd: "",
    result_code: header.resultCode,
    result_message: header.resultMessage,
  };
}

function baseRouteLocationRow(target, collectedAt, header) {
  return {
    ...baseRow(target, collectedAt, header, "location"),
    target_label: `route-${toStringOrEmpty(target.routeId)}-location`,
    target_direction: "",
    target_station_id: "",
    target_station_name: "",
    target_station_seq: "",
    target_sta_order: "",
  };
}

function printUsage() {
  console.log(`Usage:
  GBIS_SERVICE_KEY=... npm run gbis:collect:once
  GBIS_SERVICE_KEY=... npm run gbis:collect -- --config data/gbis-targets.json

Options:
  --config <path>   Target config path. Default: data/gbis-targets.json
  --out <path>      Snapshot CSV output path.
  --interval <sec>  Polling interval for continuous collection.
  --direction <direction> Only collect targets with this direction, e.g. 서울→동탄.
  --holiday-calendar <path> Holiday calendar JSON. Default: data/kr-holidays.json
  --locations <bool> Collect route-level location snapshots. Default: true.
  --arrivals <bool> Also collect target-specific arrival snapshots. Default: config value.
  --once            Collect one batch and exit.

Location snapshots are stored once per route vehicle sample. Target-specific rows are
only appended for arrival snapshots when arrivals are enabled.`);
}

function shouldCollectArrivals(target) {
  const targetValue = target.includeArrivalSnapshots;
  const enabled = targetValue === undefined
    ? includeArrivalSnapshots
    : parseBoolean(targetValue);

  return enabled && target.targetStationId && target.staOrder;
}

function arrivalKeySlotForTarget(target) {
  if (target.keySlot) {
    return Number(target.keySlot);
  }

  return target.direction === "서울→동탄" ? 2 : 1;
}

function formatKeyPolicySummary() {
  const morning = describeGbisKeySelection(ENDPOINTS.busLocations, {}, new Date("2026-01-01T02:59:00.000Z"));
  const afternoon = describeGbisKeySelection(ENDPOINTS.busLocations, {}, new Date("2026-01-01T03:00:00.000Z"));
  const outbound = describeGbisKeySelection(ENDPOINTS.busArrivalItem, { keySlot: 1 });
  const inbound = describeGbisKeySelection(ENDPOINTS.busArrivalItem, { keySlot: 2 });

  return `location KST 00-11 slot ${morning.slot}, 12-23 slot ${afternoon.slot}; arrivals 동탄→서울 slot ${outbound.slot}, 서울→동탄 slot ${inbound.slot}`;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}
