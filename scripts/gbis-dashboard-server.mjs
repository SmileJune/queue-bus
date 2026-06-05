#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import {
  parseArgs,
  readCsvRows,
  toNumberOrNull,
} from "./gbis-client.mjs";
import {
  DEFAULT_HOLIDAY_CALENDAR_PATH,
  dayTypeForParts,
  formatPeakWindowLabels,
  isInPeakWindow,
  kstParts as parseKstParts,
  loadHolidayDates,
  peakWindowsForDirection,
} from "./peak-windows.mjs";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? process.env.GBIS_DASHBOARD_PORT ?? 4175);
const host = args.host ?? process.env.GBIS_DASHBOARD_HOST ?? "0.0.0.0";
const snapshotPath = args.snapshots ?? "data/gbis-seat-snapshots.csv";
const estimatesPath = args.estimates ?? "data/gbis-boarded-estimates.csv";
const configPath = args.config ?? "data/gbis-targets.json";
const holidayCalendarPath = args["holiday-calendar"] ?? DEFAULT_HOLIDAY_CALENDAR_PATH;
const holidayDates = loadHolidayDates(holidayCalendarPath);
const READINESS_SAMPLE_GOAL = 30;
const READINESS_DAY_GOAL = 3;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/") {
      sendHtml(response, dashboardHtml());
      return;
    }

    if (url.pathname === "/api/summary") {
      const windowHours = Number(url.searchParams.get("windowHours") ?? 12);
      const payload = await buildSummary(windowHours);
      sendJson(response, payload);
      return;
    }

    if (url.pathname.startsWith("/data/")) {
      await sendDataFile(url.pathname, response);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, host, () => {
  console.log(`[gbis:dashboard] http://${host}:${port}`);
  console.log(`[gbis:dashboard] snapshots=${snapshotPath}`);
});

async function buildSummary(windowHours) {
  const [snapshots, estimates, config] = await Promise.all([
    readCsvRows(snapshotPath).catch(() => []),
    readCsvRows(estimatesPath).catch(() => []),
    readConfig().catch(() => ({ targets: [] })),
  ]);
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const enabledTargets = (config.targets ?? []).filter((target) => target.enabled !== false);
  const targetByLabel = new Map(
    enabledTargets.map((target) => [target.label, target]),
  );
  const allLocationRows = snapshots
    .filter((row) => row.snapshot_type === "location")
    .filter((row) => {
      const seats = toNumberOrNull(row.remain_seat_count);
      return seats !== null && seats >= 0;
    });
  const locationRows = snapshots
    .filter((row) => row.snapshot_type === "location")
    .filter((row) => new Date(row.collected_at).getTime() >= cutoff)
    .filter((row) => {
      const seats = toNumberOrNull(row.remain_seat_count);
      return seats !== null && seats >= 0;
    });
  const estimateRows = estimates
    .filter((row) => new Date(row.after_collected_at || row.before_collected_at).getTime() >= cutoff);
  const allUniqueVehicleSamples = dedupeVehicleLocationRows(allLocationRows);
  const uniqueVehicleSamples = dedupeBy(locationRows, (row) => `${row.collected_at}|${row.veh_id || row.plate_no}`);
  const latestRowsByVehicle = latestBy(uniqueVehicleSamples, (row) => row.veh_id || row.plate_no);
  const stationProfiles = buildStationProfiles(uniqueVehicleSamples, enabledTargets);
  const analysisReadiness = buildAnalysisReadiness(allUniqueVehicleSamples, enabledTargets);
  const latestCollectedAt = maxDate([
    ...locationRows.map((row) => row.collected_at),
    ...estimateRows.map((row) => row.after_collected_at),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    collection: {
      latestCollectedAt,
      latestAgeSeconds: latestCollectedAt
        ? Math.round((Date.now() - new Date(latestCollectedAt).getTime()) / 1000)
        : null,
      snapshotRows: snapshots.length,
      locationRows: locationRows.length,
      routeSampleRows: uniqueVehicleSamples.length,
      estimateRows: estimates.length,
      uniqueVehicleSamples: uniqueVehicleSamples.length,
      vehiclesInWindow: latestRowsByVehicle.length,
      targets: enabledTargets.length,
    },
    directionSummaries: summarizeProfileDirections(stationProfiles),
    analysisReadiness,
    targetSummaries: summarizeTargets(uniqueVehicleSamples, targetByLabel, latestRowsByVehicle),
    vehicleStates: latestRowsByVehicle
      .map((row) => ({
        vehicleId: row.veh_id,
        plateNo: row.plate_no,
        currentStationSeq: numberValue(row.current_station_seq),
        stateCd: row.state_cd,
        remainSeatCount: numberValue(row.remain_seat_count),
        crowded: numberValue(row.crowded),
        collectedAt: row.collected_at,
      }))
      .sort((a, b) => a.currentStationSeq - b.currentStationSeq),
    seatSeries: buildSeatSeries(uniqueVehicleSamples),
    stationProfiles,
    boardingSummaries: summarizeBoardingEstimates(estimateRows),
    estimateRows: estimateRows.slice(-100).reverse(),
  };
}

function dedupeVehicleLocationRows(rows) {
  return dedupeBy(
    rows,
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
}

async function readConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

function summarizeProfileDirections(profiles) {
  return profiles.map((profile) => ({
    direction: profile.direction,
    rows: profile.sampleRows,
    vehicles: profile.vehicles,
    minSeats: profile.minSeats,
    avgSeats: profile.avgSeats,
    maxSeats: profile.maxSeats,
    latestCollectedAt: profile.latestCollectedAt,
  }));
}

function summarizeTargets(rows, targetByLabel, latestRowsByVehicle) {
  return [...targetByLabel.values()].map((target) => {
    const targetSeq = Number(target.targetStationSeq ?? 0);
    const direction = directionFromLabel(target.label);
    const passRows = rows.filter((row) => numberValue(row.current_station_seq) === targetSeq);
    const stats = summarizeRows(passRows);
    const approaching = latestRowsByVehicle
      .map((row) => ({
        plateNo: row.plate_no,
        currentStationSeq: numberValue(row.current_station_seq),
        remainSeatCount: numberValue(row.remain_seat_count),
        remainingStops: targetSeq - numberValue(row.current_station_seq),
        stateCd: row.state_cd,
      }))
      .filter((row) => row.remainingStops >= 0)
      .sort((a, b) => a.remainingStops - b.remainingStops)
      .slice(0, 3);

    return {
      label: target.label,
      direction,
      targetStationName: target.targetStationName ?? "",
      targetStationSeq: targetSeq,
      mobileNo: target.mobileNo ?? "",
      rows: stats.rows,
      vehicles: stats.vehicles,
      minSeats: stats.minSeats,
      avgSeats: stats.avgSeats,
      maxSeats: stats.maxSeats,
      nextVehicles: approaching,
      latestCollectedAt: stats.latestCollectedAt,
    };
  }).sort((a, b) => a.targetStationSeq - b.targetStationSeq);
}

function summarizeBoardingEstimates(rows) {
  const directionGroups = summarizeEstimateGroups(rows, (row) => directionFromLabel(row.target_label));
  const targetGroups = summarizeEstimateGroups(rows, (row) => row.target_label);

  return {
    byDirection: directionGroups,
    byTarget: targetGroups,
  };
}

function buildAnalysisReadiness(rows, targets) {
  const targetRows = targets
    .filter((target) => target.enabled !== false)
    .map((target) => buildTargetReadiness(rows, target));
  const directionGroups = new Map();

  for (const row of targetRows) {
    const current = directionGroups.get(row.direction) ?? {
      direction: row.direction,
      peakWindow: row.peakWindow,
      targets: 0,
      readyTargets: 0,
      partialTargets: 0,
      samples: 0,
      days: new Set(),
      latestCollectedAt: "",
    };

    current.targets += 1;
    current.readyTargets += row.status === "ready" ? 1 : 0;
    current.partialTargets += row.status === "partial" ? 1 : 0;
    current.samples += row.samples;
    row.dayKeys.forEach((day) => current.days.add(day));
    current.latestCollectedAt = maxDate([current.latestCollectedAt, row.latestCollectedAt]);
    directionGroups.set(row.direction, current);
  }

  const byDirection = [...directionGroups.values()].map((group) => ({
    direction: group.direction,
    peakWindow: group.peakWindow,
    targets: group.targets,
    readyTargets: group.readyTargets,
    partialTargets: group.partialTargets,
    samples: group.samples,
    days: group.days.size,
    latestCollectedAt: group.latestCollectedAt,
  }));

  return {
    sampleGoal: READINESS_SAMPLE_GOAL,
    dayGoal: READINESS_DAY_GOAL,
    readyTargets: targetRows.filter((row) => row.status === "ready").length,
    partialTargets: targetRows.filter((row) => row.status === "partial").length,
    targets: targetRows.length,
    byDirection,
    byTarget: targetRows,
  };
}

function buildTargetReadiness(rows, target) {
  const direction = directionFromLabel(target.label);
  const targetDirection = target.direction ?? targetDirectionFromLabel(target.label);
  const peakWindows = peakWindowsForDirection(targetDirection);
  const targetSeq = toNumberOrNull(target.targetStationSeq ?? target.staOrder);
  const peakRows = rows.filter((row) => {
    if (row.route_id !== String(target.routeId ?? "")) {
      return false;
    }

    if (targetSeq === null || toNumberOrNull(row.current_station_seq) !== targetSeq) {
      return false;
    }

    const parts = kstParts(row.collected_at);
    if (!parts) {
      return false;
    }

    const dayType = dayTypeForParts(parts, holidayDates);
    return peakWindows.length === 0
      ? true
      : peakWindows.some((window) => isInPeakWindow(parts, dayType, window));
  });
  const dayKeys = new Set(peakRows.map((row) => kstParts(row.collected_at)?.dateKey).filter(Boolean));
  const vehicleKeys = new Set(peakRows.map((row) => `${kstParts(row.collected_at)?.dateKey}|${row.veh_id || row.plate_no}`).filter(Boolean));
  const latestCollectedAt = maxDate(peakRows.map((row) => row.collected_at));
  const samples = peakRows.length;
  const days = dayKeys.size;
  const status = samples >= READINESS_SAMPLE_GOAL && days >= READINESS_DAY_GOAL
    ? "ready"
    : samples > 0
      ? "partial"
      : "waiting";

  return {
    label: target.label,
    direction,
    peakWindow: peakWindows.length > 0 ? formatPeakWindowLabels(peakWindows) : "전체",
    targetStationName: target.targetStationName ?? "",
    targetStationSeq: targetSeq,
    mobileNo: target.mobileNo ?? "",
    samples,
    days,
    vehicles: vehicleKeys.size,
    latestCollectedAt,
    status,
    dayKeys: [...dayKeys],
  };
}

function kstParts(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return parseKstParts(date);
}

function summarizeGroups(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    const seats = numberValue(row.remain_seat_count);
    const current = groups.get(key) ?? {
      key,
      rows: 0,
      seatSum: 0,
      minSeats: seats,
      maxSeats: seats,
      vehicleIds: new Set(),
      latestCollectedAt: "",
    };

    current.rows += 1;
    current.seatSum += seats;
    current.minSeats = Math.min(current.minSeats, seats);
    current.maxSeats = Math.max(current.maxSeats, seats);
    current.vehicleIds.add(row.veh_id || row.plate_no);
    current.latestCollectedAt = maxDate([current.latestCollectedAt, row.collected_at]);
    groups.set(key, current);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    vehicles: [...group.vehicleIds].filter(Boolean).length,
    avgSeats: group.rows > 0 ? round1(group.seatSum / group.rows) : 0,
  }));
}

function summarizeRows(rows) {
  if (rows.length === 0) {
    return {
      rows: 0,
      vehicles: 0,
      minSeats: null,
      avgSeats: null,
      maxSeats: null,
      latestCollectedAt: "",
    };
  }

  const seats = rows.map((row) => numberValue(row.remain_seat_count));
  return {
    rows: rows.length,
    vehicles: new Set(rows.map((row) => row.veh_id || row.plate_no).filter(Boolean)).size,
    minSeats: Math.min(...seats),
    avgSeats: round1(seats.reduce((sum, seat) => sum + seat, 0) / seats.length),
    maxSeats: Math.max(...seats),
    latestCollectedAt: maxDate(rows.map((row) => row.collected_at)),
  };
}

function summarizeEstimateGroups(rows, keyFn) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key) ?? {
      key,
      rows: 0,
      estimatedBoardedCount: 0,
      demandLowerBound: 0,
      censoredRows: 0,
      latestCollectedAt: "",
    };

    current.rows += 1;
    current.estimatedBoardedCount += numberValue(row.estimated_boarded_count);
    current.demandLowerBound += numberValue(row.demand_lower_bound);
    current.censoredRows += row.is_demand_censored === "true" ? 1 : 0;
    current.latestCollectedAt = maxDate([current.latestCollectedAt, row.after_collected_at]);
    groups.set(key, current);
  }

  return [...groups.values()];
}

function buildSeatSeries(rows) {
  const byMinute = new Map();

  for (const row of rows) {
    const minute = row.collected_at.slice(0, 16);
    const current = byMinute.get(minute) ?? {
      collectedAt: `${minute}:00.000Z`,
      seats: [],
      vehicles: new Set(),
    };

    current.seats.push(numberValue(row.remain_seat_count));
    current.vehicles.add(row.veh_id || row.plate_no);
    byMinute.set(minute, current);
  }

  return [...byMinute.values()]
    .sort((a, b) => new Date(a.collectedAt).getTime() - new Date(b.collectedAt).getTime())
    .slice(-240)
    .map((entry) => ({
      collectedAt: entry.collectedAt,
      minSeats: Math.min(...entry.seats),
      avgSeats: round1(entry.seats.reduce((sum, seat) => sum + seat, 0) / entry.seats.length),
      maxSeats: Math.max(...entry.seats),
      vehicles: [...entry.vehicles].filter(Boolean).length,
    }));
}

function buildStationProfiles(rows, targets) {
  const targetsByDirection = new Map();

  for (const target of targets) {
    const seq = toNumberOrNull(target.targetStationSeq ?? target.staOrder);
    if (seq === null) {
      continue;
    }

    const direction = directionFromLabel(target.label);
    const directionTargets = targetsByDirection.get(direction) ?? [];
    directionTargets.push({
      seq,
      name: target.targetStationName ?? "",
      mobileNo: target.mobileNo ?? "",
    });
    targetsByDirection.set(direction, directionTargets);
  }

  return [...targetsByDirection.entries()].map(([direction, directionTargets]) => {
    const stationTicks = directionTargets
      .sort((a, b) => a.seq - b.seq)
      .filter((target, index, sorted) => index === 0 || target.seq !== sorted[index - 1].seq);
    const minStationSeq = Math.min(...stationTicks.map((target) => target.seq));
    const maxStationSeq = Math.max(...stationTicks.map((target) => target.seq));
    const rangeRows = rows.filter((row) => {
      const seq = toNumberOrNull(row.current_station_seq);
      const seats = toNumberOrNull(row.remain_seat_count);
      return seq !== null && seats !== null && seq >= minStationSeq && seq <= maxStationSeq;
    });
    const stats = summarizeRows(rangeRows);
    const latestVehicleStationRows = latestBy(
      rangeRows,
      (row) => `${row.veh_id || row.plate_no}|${numberValue(row.current_station_seq)}`,
    );
    const vehicleGroups = new Map();

    for (const row of latestVehicleStationRows) {
      const vehicleKey = row.veh_id || row.plate_no;
      if (!vehicleKey) {
        continue;
      }

      const current = vehicleGroups.get(vehicleKey) ?? {
        vehicleId: row.veh_id,
        plateNo: row.plate_no,
        points: [],
        latestCollectedAt: "",
      };

      current.points.push({
        stationSeq: numberValue(row.current_station_seq),
        remainSeatCount: numberValue(row.remain_seat_count),
        collectedAt: row.collected_at,
        stateCd: row.state_cd,
      });
      current.latestCollectedAt = maxDate([current.latestCollectedAt, row.collected_at]);
      vehicleGroups.set(vehicleKey, current);
    }

    const vehicleSeries = [...vehicleGroups.values()]
      .map((vehicle) => {
        vehicle.points.sort((a, b) => a.stationSeq - b.stationSeq);
        const latestPoint = vehicle.points
          .slice()
          .sort((a, b) => new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime())[0];

        return {
          ...vehicle,
          latestStationSeq: latestPoint?.stationSeq ?? null,
          latestRemainSeatCount: latestPoint?.remainSeatCount ?? null,
        };
      })
      .sort((a, b) => new Date(b.latestCollectedAt).getTime() - new Date(a.latestCollectedAt).getTime())
      .slice(0, 12);

    return {
      direction,
      minStationSeq,
      maxStationSeq,
      stationTicks,
      vehicleSeries,
      sampleRows: rangeRows.length,
      vehicles: stats.vehicles,
      minSeats: stats.minSeats,
      avgSeats: stats.avgSeats,
      maxSeats: stats.maxSeats,
      latestCollectedAt: stats.latestCollectedAt,
    };
  });
}

function latestBy(rows, keyFn) {
  const map = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    const current = map.get(key);

    if (!current || new Date(row.collected_at).getTime() > new Date(current.collected_at).getTime()) {
      map.set(key, row);
    }
  }

  return [...map.values()];
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

function directionFromLabel(label = "") {
  if (label.includes("dongtan-to-seoul")) {
    return "출근 동탄→서울";
  }

  if (label.includes("seoul-to-dongtan")) {
    return "퇴근 서울→동탄";
  }

  return "미분류";
}

function targetDirectionFromLabel(label = "") {
  if (label.includes("dongtan-to-seoul")) {
    return "동탄→서울";
  }

  if (label.includes("seoul-to-dongtan")) {
    return "서울→동탄";
  }

  return "";
}

function numberValue(value) {
  return toNumberOrNull(value) ?? 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function maxDate(values) {
  return values
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? "";
}

async function sendDataFile(pathname, response) {
  const relative = normalize(pathname.replace(/^\/+/, ""));
  if (!relative.startsWith("data/")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const filePath = join(process.cwd(), relative);
  const content = await readFile(filePath);
  const contentType = extname(filePath) === ".csv"
    ? "text/csv; charset=utf-8"
    : "application/octet-stream";
  response.writeHead(200, { "Content-Type": contentType });
  response.end(content);
}

function sendJson(response, payload) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QueueBus GBIS Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #18212f;
      background: #eef2f4;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; background: #eef2f4; }
    .shell { width: min(1440px, calc(100vw - 28px)); margin: 0 auto; padding: 22px 0 34px; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-bottom: 14px; }
    h1 { margin: 0; font-size: 28px; line-height: 1.1; }
    h2 { margin: 0; font-size: 18px; }
    h3 { margin: 0; font-size: 15px; }
    p { margin: 0; }
    .subtle { color: #64748b; font-size: 13px; }
    .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    button, select, a.link-button {
      min-height: 38px; border: 1px solid #ccd6dd; border-radius: 8px; background: #fff; color: #1f2937;
      font: inherit; font-weight: 800; padding: 8px 11px; text-decoration: none;
    }
    button { cursor: pointer; }
    .grid { display: grid; gap: 12px; }
    .kpis { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .main-grid { grid-template-columns: minmax(0, 1.2fr) minmax(390px, 0.8fr); align-items: start; margin-top: 12px; }
    .two-col { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panel, .kpi {
      border: 1px solid #dbe4ea; border-radius: 8px; background: rgba(255,255,255,.94);
      box-shadow: 0 10px 26px rgba(15, 23, 42, .05);
    }
    .panel { padding: 16px; }
    .kpi { padding: 13px; min-height: 92px; }
    .kpi .label { color: #64748b; font-size: 12px; font-weight: 800; }
    .kpi .value { margin-top: 8px; font-size: 24px; font-weight: 900; }
    .kpi .caption { margin-top: 5px; color: #64748b; font-size: 12px; }
    .section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .status { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; padding: 6px 10px; font-size: 12px; font-weight: 900; }
    .status.ok { background: #dcfce7; color: #166534; }
    .status.warn { background: #fef3c7; color: #92400e; }
    .status.bad { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 9px 8px; border-bottom: 1px solid #e6edf2; text-align: left; vertical-align: top; }
    th { color: #475569; font-size: 12px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bars { display: grid; gap: 9px; }
    .bar-row { display: grid; grid-template-columns: 108px minmax(0, 1fr) 64px; gap: 10px; align-items: center; font-size: 13px; }
    .bar-track { height: 12px; border-radius: 999px; background: #e5edf2; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #0f766e, #2563eb); }
    .chart { width: 100%; min-height: 260px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fbfdfe; }
    .profile-list { display: grid; gap: 12px; }
    .profile-card { border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; padding: 12px; }
    .profile-chart { min-height: 320px; margin-top: 10px; }
    .profile-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px; color: #64748b; font-size: 12px; }
    .legend { display: flex; gap: 8px 12px; flex-wrap: wrap; margin-top: 9px; }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; color: #475569; font-size: 12px; font-weight: 800; }
    .swatch { width: 11px; height: 11px; border-radius: 999px; display: inline-block; }
    .station-strip { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
    .station-chip { border: 1px solid #dbe4ea; border-radius: 999px; padding: 4px 8px; color: #475569; background: #f8fafc; font-size: 11px; font-weight: 800; }
    .vehicle-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
    .vehicle { border: 1px solid #e2e8f0; border-radius: 8px; padding: 11px; background: #fff; }
    .vehicle strong { display: block; margin-bottom: 8px; }
    .seat { font-size: 22px; font-weight: 900; }
    .seat.low { color: #b91c1c; }
    .seat.mid { color: #b45309; }
    .seat.high { color: #0f766e; }
    .pill { display: inline-flex; border-radius: 999px; background: #eff6ff; color: #1d4ed8; padding: 4px 8px; font-size: 12px; font-weight: 800; }
    .empty { padding: 16px; color: #64748b; border: 1px dashed #cbd5e1; border-radius: 8px; background: #f8fafc; }
    @media (max-width: 980px) { .kpis, .main-grid, .two-col { grid-template-columns: 1fr; } .topbar { align-items: flex-start; flex-direction: column; } .controls { justify-content: flex-start; } }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div>
        <h1>QueueBus GBIS Dashboard</h1>
        <p class="subtle">M4137 출근 동탄→서울 / 퇴근 서울→동탄 잔여좌석 수집 현황</p>
      </div>
      <div class="controls">
        <select id="windowHours">
          <option value="3">최근 3시간</option>
          <option value="6">최근 6시간</option>
          <option value="12" selected>최근 12시간</option>
          <option value="24">최근 24시간</option>
          <option value="168">최근 7일</option>
        </select>
        <button id="refresh">새로고침</button>
        <a class="link-button" href="/data/gbis-seat-snapshots.csv">원본 CSV</a>
        <a class="link-button" href="/data/gbis-boarded-estimates.csv">추정 CSV</a>
      </div>
    </header>

    <section class="grid kpis" id="kpis"></section>

    <main class="grid main-grid">
      <section class="grid">
        <div class="panel">
          <div class="section-head">
            <div>
              <h2>방향별 수집 상태</h2>
              <p class="subtle">차량 중복을 제거한 대상 구간 샘플 기준</p>
            </div>
          </div>
          <div id="directionBars" class="bars"></div>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <h2>분석 준비도</h2>
              <p class="subtle">출근/퇴근 피크 시간대에 각 정류장 순번을 실제 통과한 샘플 기준</p>
            </div>
          </div>
          <div id="readinessTable"></div>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <h2>잔여좌석 타임라인</h2>
              <p class="subtle">차량별 중복을 제거한 분 단위 평균</p>
            </div>
          </div>
          <svg id="seatChart" class="chart" role="img"></svg>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <h2>정류장별 잔여좌석 프로파일</h2>
              <p class="subtle">가로축은 정류장 순번, 세로축은 잔여좌석입니다. 시간은 상단 최근 창 필터와 최신 점 강조로 반영합니다.</p>
            </div>
          </div>
          <div id="stationProfiles" class="profile-list"></div>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <h2>정류장별 다음 차량</h2>
              <p class="subtle">현재 순번 기준 접근 중인 차량 3대</p>
            </div>
          </div>
          <div id="targetTable"></div>
        </div>
      </section>

      <aside class="grid">
        <div class="panel">
          <div class="section-head">
            <div>
              <h2>수집 상태</h2>
              <p class="subtle" id="generatedAt"></p>
            </div>
            <span id="collectorStatus" class="status warn">확인 중</span>
          </div>
          <div id="collectionTable"></div>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <h2>현재 운행 차량</h2>
              <p class="subtle">최신 위치 스냅샷 기준</p>
            </div>
          </div>
          <div id="vehicles" class="vehicle-grid"></div>
        </div>

        <div class="panel">
          <div class="section-head">
            <div>
              <h2>탑승 추정</h2>
              <p class="subtle">정류장 출발 상태가 잡힌 경우만 반영</p>
            </div>
          </div>
          <div id="boardingTable"></div>
        </div>
      </aside>
    </main>
  </div>

  <script>
    const state = { data: null };
    const $ = (selector) => document.querySelector(selector);
    const formatTime = (iso) => iso ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(iso)) : "-";
    const seatClass = (value) => value <= 5 ? "low" : value <= 20 ? "mid" : "high";

    $("#refresh").addEventListener("click", load);
    $("#windowHours").addEventListener("change", load);
    load();
    setInterval(load, 30000);

    async function load() {
      const windowHours = $("#windowHours").value;
      const response = await fetch("/api/summary?windowHours=" + encodeURIComponent(windowHours), { cache: "no-store" });
      state.data = await response.json();
      render(state.data);
    }

    function render(data) {
      renderKpis(data);
      renderCollection(data);
      renderDirectionBars(data.directionSummaries);
      renderReadiness(data.analysisReadiness);
      renderSeatChart(data.seatSeries);
      renderStationProfiles(data.stationProfiles || []);
      renderTargets(data.targetSummaries);
      renderVehicles(data.vehicleStates);
      renderBoarding(data.boardingSummaries);
      $("#generatedAt").textContent = "생성 " + formatTime(data.generatedAt);
    }

    function renderKpis(data) {
      const c = data.collection;
      $("#kpis").innerHTML = [
        kpi("마지막 수집", c.latestCollectedAt ? formatAge(c.latestAgeSeconds) : "-", formatTime(c.latestCollectedAt)),
        kpi("운행 차량", c.vehiclesInWindow + "대", "최근 " + data.windowHours + "시간"),
        kpi("차량 샘플", c.routeSampleRows.toLocaleString() + "건", "원본 " + c.locationRows.toLocaleString() + "행"),
        kpi("대상 정류장", c.targets + "곳", "설정 기준"),
        kpi("분석 준비", readinessTotal(data.analysisReadiness), "피크 통과 샘플"),
        kpi("평균 좌석", avgSeats(data.directionSummaries), "방향별 평균"),
        kpi("탑승 추정", estimateTotal(data.boardingSummaries), "좌석 변화 기반")
      ].join("");
    }

    function renderCollection(data) {
      const age = data.collection.latestAgeSeconds;
      const status = $("#collectorStatus");
      status.className = "status " + (age === null ? "bad" : age <= 90 ? "ok" : age <= 300 ? "warn" : "bad");
      status.textContent = age === null ? "데이터 없음" : age <= 90 ? "정상 수집" : age <= 300 ? "지연" : "중단 의심";
      $("#collectionTable").innerHTML = table([
        ["마지막 수집", formatTime(data.collection.latestCollectedAt)],
        ["마지막 수집 경과", data.collection.latestAgeSeconds === null ? "-" : formatAge(data.collection.latestAgeSeconds)],
        ["최근 창", data.windowHours + "시간"],
        ["중복 제거 차량 샘플", data.collection.uniqueVehicleSamples.toLocaleString()],
        ["원본 위치 행", data.collection.locationRows.toLocaleString()],
        ["대상 정류장", data.collection.targets.toLocaleString()]
      ]);
    }

    function renderDirectionBars(rows) {
      const visibleRows = rows.filter((row) => row.avgSeats !== null && row.maxSeats !== null);
      if (!visibleRows.length) {
        $("#directionBars").innerHTML = empty("최근 창에 수집 데이터가 없습니다.");
        return;
      }
      const max = Math.max(...visibleRows.map((row) => row.maxSeats), 1);
      $("#directionBars").innerHTML = visibleRows.map((row) => {
        const width = Math.max(2, Math.round((row.avgSeats / max) * 100));
        return '<div class="bar-row"><strong>' + row.direction + '</strong><div class="bar-track"><div class="bar-fill" style="width:' + width + '%"></div></div><span class="num">' + formatSeats(row.avgSeats) + '</span></div>';
      }).join("");
    }

    function renderReadiness(readiness) {
      if (!readiness || !readiness.byTarget || !readiness.byTarget.length) {
        $("#readinessTable").innerHTML = empty("분석 준비도 계산 대상이 없습니다.");
        return;
      }

      const summary = readiness.byDirection.map((row) =>
        '<span class="pill">' + row.direction + ' ' + row.readyTargets + '/' + row.targets + ' · ' + row.samples + '샘플 · ' + row.days + '일</span>'
      ).join(" ");
      const rows = readiness.byTarget.slice().sort((a, b) => a.targetStationSeq - b.targetStationSeq);
      $("#readinessTable").innerHTML =
        '<div style="margin-bottom:10px">' + summary + '</div>' +
        '<table><thead><tr><th>정류장</th><th>피크</th><th class="num">샘플</th><th class="num">일수</th><th class="num">차량</th><th>상태</th></tr></thead><tbody>' +
        rows.map((row) =>
          '<tr><td><strong>' + row.targetStationName + '</strong><br><span class="subtle">' + row.direction + ' · 순번 ' + row.targetStationSeq + '</span></td>' +
          '<td>' + row.peakWindow + '</td>' +
          '<td class="num">' + row.samples + '/' + readiness.sampleGoal + '</td>' +
          '<td class="num">' + row.days + '/' + readiness.dayGoal + '</td>' +
          '<td class="num">' + row.vehicles + '</td>' +
          '<td><span class="status ' + readinessClass(row.status) + '">' + readinessLabel(row.status) + '</span></td></tr>'
        ).join("") +
        '</tbody></table>';
    }

    function renderSeatChart(rows) {
      const svg = $("#seatChart");
      const width = svg.clientWidth || 720;
      const height = 260;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      if (rows.length < 2) {
        svg.innerHTML = '<text x="18" y="38" fill="#64748b">타임라인을 그릴 만큼 데이터가 아직 충분하지 않습니다.</text>';
        return;
      }
      const pad = { left: 38, right: 18, top: 18, bottom: 34 };
      const maxSeat = Math.max(...rows.map((row) => row.maxSeats), 1);
      const x = (index) => pad.left + (index / (rows.length - 1)) * (width - pad.left - pad.right);
      const y = (value) => height - pad.bottom - (value / maxSeat) * (height - pad.top - pad.bottom);
      const avgPath = rows.map((row, index) => (index === 0 ? "M" : "L") + x(index).toFixed(1) + " " + y(row.avgSeats).toFixed(1)).join(" ");
      const minPath = rows.map((row, index) => (index === 0 ? "M" : "L") + x(index).toFixed(1) + " " + y(row.minSeats).toFixed(1)).join(" ");
      svg.innerHTML = [
        '<line x1="' + pad.left + '" y1="' + y(0) + '" x2="' + (width - pad.right) + '" y2="' + y(0) + '" stroke="#cbd5e1"/>',
        '<line x1="' + pad.left + '" y1="' + y(maxSeat) + '" x2="' + (width - pad.right) + '" y2="' + y(maxSeat) + '" stroke="#e2e8f0"/>',
        '<path d="' + minPath + '" fill="none" stroke="#f59e0b" stroke-width="2"/>',
        '<path d="' + avgPath + '" fill="none" stroke="#0f766e" stroke-width="3"/>',
        '<text x="' + pad.left + '" y="' + (height - 10) + '" fill="#64748b" font-size="12">' + formatTime(rows[0].collectedAt) + '</text>',
        '<text x="' + (width - 220) + '" y="' + (height - 10) + '" fill="#64748b" font-size="12">' + formatTime(rows[rows.length - 1].collectedAt) + '</text>',
        '<text x="' + (width - 120) + '" y="24" fill="#0f766e" font-size="12" font-weight="800">평균</text>',
        '<text x="' + (width - 120) + '" y="44" fill="#b45309" font-size="12" font-weight="800">최소</text>'
      ].join("");
    }

    function renderStationProfiles(profiles) {
      const root = $("#stationProfiles");
      if (!profiles.length) {
        root.innerHTML = empty("정류장 프로파일을 만들 대상 데이터가 없습니다.");
        return;
      }

      root.innerHTML = profiles.map((profile, index) =>
        '<div class="profile-card">' +
          '<h3>' + profile.direction + '</h3>' +
          '<div class="profile-meta">' +
            '<span>순번 ' + profile.minStationSeq + '-' + profile.maxStationSeq + '</span>' +
            '<span>대상 ' + profile.stationTicks.length + '곳</span>' +
            '<span>샘플 ' + profile.sampleRows.toLocaleString() + '행</span>' +
            '<span>최신 ' + formatTime(profile.latestCollectedAt) + '</span>' +
          '</div>' +
          '<svg class="chart profile-chart" data-profile-index="' + index + '" role="img"></svg>' +
          '<div class="station-strip">' + stationStrip(profile.stationTicks) + '</div>' +
          '<div class="legend">' + profileLegend(profile, index) + '</div>' +
        '</div>'
      ).join("");

      document.querySelectorAll(".profile-chart").forEach((svg) => {
        renderStationProfileSvg(svg, profiles[Number(svg.dataset.profileIndex)]);
      });
    }

    function renderStationProfileSvg(svg, profile) {
      const width = svg.clientWidth || 840;
      const height = 320;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);

      const series = profile.vehicleSeries || [];
      const points = series.flatMap((vehicle) => vehicle.points || []);
      if (!points.length) {
        svg.innerHTML = '<text x="18" y="38" fill="#64748b">이 구간을 지난 차량 샘플이 아직 없습니다.</text>';
        return;
      }

      const pad = { left: 66, right: 32, top: 22, bottom: 66 };
      const maxSeat = Math.max(64, ...points.map((point) => point.remainSeatCount));
      const span = Math.max(1, profile.maxStationSeq - profile.minStationSeq);
      const x = (seq) => pad.left + ((seq - profile.minStationSeq) / span) * (width - pad.left - pad.right);
      const y = (value) => height - pad.bottom - (value / maxSeat) * (height - pad.top - pad.bottom);
      const yTicks = [0, 20, 40, 60].filter((value) => value <= maxSeat);
      if (!yTicks.includes(maxSeat)) yTicks.push(maxSeat);
      const parts = [];

      parts.push('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#fbfdfe"/>');
      for (const value of yTicks) {
        parts.push('<line x1="' + pad.left + '" y1="' + y(value).toFixed(1) + '" x2="' + (width - pad.right) + '" y2="' + y(value).toFixed(1) + '" stroke="#e2e8f0"/>');
        parts.push('<text x="8" y="' + (y(value) + 4).toFixed(1) + '" fill="#64748b" font-size="11">' + value + '</text>');
      }

      for (const tick of profile.stationTicks) {
        const tx = x(tick.seq);
        parts.push('<line x1="' + tx.toFixed(1) + '" y1="' + pad.top + '" x2="' + tx.toFixed(1) + '" y2="' + (height - pad.bottom) + '" stroke="#dbe4ea"/>');
        parts.push('<text x="' + tx.toFixed(1) + '" y="' + (height - 18) + '" fill="#475569" font-size="11" text-anchor="middle" font-weight="800">' + tick.seq + '</text>');
      }

      series.forEach((vehicle, index) => {
        const color = profileColor(index);
        const vehiclePoints = (vehicle.points || []).slice().sort((a, b) => a.stationSeq - b.stationSeq);
        if (vehiclePoints.length > 1) {
          const path = vehiclePoints.map((point, pointIndex) =>
            (pointIndex === 0 ? "M" : "L") + x(point.stationSeq).toFixed(1) + " " + y(point.remainSeatCount).toFixed(1)
          ).join(" ");
          parts.push('<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity=".86"/>');
        }

        vehiclePoints.forEach((point) => {
          const isLatest = point.collectedAt === vehicle.latestCollectedAt;
          parts.push('<circle cx="' + x(point.stationSeq).toFixed(1) + '" cy="' + y(point.remainSeatCount).toFixed(1) + '" r="' + (isLatest ? 5 : 3.4) + '" fill="' + color + '" stroke="' + (isLatest ? '#111827' : '#fff') + '" stroke-width="' + (isLatest ? 1.8 : 1.2) + '"><title>' + (vehicle.plateNo || vehicle.vehicleId) + ' · 순번 ' + point.stationSeq + ' · ' + point.remainSeatCount + '석 · ' + formatTime(point.collectedAt) + '</title></circle>');
        });
      });

      parts.push('<text x="' + (width - 112) + '" y="20" fill="#111827" font-size="11" font-weight="800">검은 테두리: 최신 점</text>');
      svg.innerHTML = parts.join("");
    }

    function renderTargets(rows) {
      if (!rows.length) {
        $("#targetTable").innerHTML = empty("정류장 데이터가 없습니다.");
        return;
      }
      $("#targetTable").innerHTML = '<table><thead><tr><th>방향</th><th>정류장</th><th class="num">통과 평균</th><th>다음 차량</th></tr></thead><tbody>' +
        rows.map((row) => '<tr><td><span class="pill">' + row.direction + '</span></td><td><strong>' + row.targetStationName + '</strong><br><span class="subtle">' + row.mobileNo + ' · 순번 ' + row.targetStationSeq + ' · 통과 ' + row.rows + '건</span></td><td class="num">' + formatSeats(row.avgSeats) + '</td><td>' + nextVehicleText(row.nextVehicles) + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function renderVehicles(rows) {
      if (!rows.length) {
        $("#vehicles").innerHTML = empty("운행 차량 데이터가 없습니다.");
        return;
      }
      $("#vehicles").innerHTML = rows.map((row) =>
        '<div class="vehicle"><strong>' + (row.plateNo || row.vehicleId) + '</strong><div class="seat ' + seatClass(row.remainSeatCount) + '">' + row.remainSeatCount + '석</div><p class="subtle">순번 ' + row.currentStationSeq + ' · 상태 ' + row.stateCd + ' · 혼잡 ' + row.crowded + '</p></div>'
      ).join("");
    }

    function renderBoarding(summary) {
      const rows = summary.byDirection || [];
      if (!rows.length) {
        $("#boardingTable").innerHTML = empty("아직 정류장 출발 상태가 잡힌 탑승 추정치가 없습니다.");
        return;
      }
      $("#boardingTable").innerHTML = '<table><thead><tr><th>방향</th><th class="num">건수</th><th class="num">추정 탑승</th><th class="num">0석 절단</th></tr></thead><tbody>' +
        rows.map((row) => '<tr><td>' + row.key + '</td><td class="num">' + row.rows + '</td><td class="num">' + row.estimatedBoardedCount + '</td><td class="num">' + row.censoredRows + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function table(rows) {
      return '<table><tbody>' + rows.map(([key, value]) => '<tr><th>' + key + '</th><td>' + value + '</td></tr>').join("") + '</tbody></table>';
    }

    function nextVehicleText(rows) {
      if (!rows.length) return '<span class="subtle">접근 차량 없음</span>';
      return rows.map((row) => '<span class="subtle">' + row.plateNo + ' · ' + row.remainingStops + '정류장 전 · ' + row.remainSeatCount + '석</span>').join("<br>");
    }

    function profileLegend(profile) {
      const series = profile.vehicleSeries || [];
      if (!series.length) return '<span class="subtle">표시할 차량 없음</span>';
      return series.slice(0, 8).map((vehicle, index) =>
        '<span class="legend-item"><span class="swatch" style="background:' + profileColor(index) + '"></span>' +
        (vehicle.plateNo || vehicle.vehicleId) + ' · 최신 ' + vehicle.latestRemainSeatCount + '석</span>'
      ).join("");
    }

    function stationStrip(ticks) {
      return (ticks || []).map((tick) =>
        '<span class="station-chip">' + tick.seq + ' ' + tick.name + '</span>'
      ).join("");
    }

    function profileColor(index) {
      const colors = ["#0f766e", "#2563eb", "#b45309", "#9333ea", "#dc2626", "#0891b2", "#4d7c0f", "#be185d", "#475569", "#7c2d12", "#1d4ed8", "#15803d"];
      return colors[index % colors.length];
    }

    function kpi(label, value, caption) {
      return '<div class="kpi"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="caption">' + caption + '</div></div>';
    }

    function empty(text) {
      return '<div class="empty">' + text + '</div>';
    }

    function formatAge(seconds) {
      if (seconds < 60) return seconds + "초 전";
      if (seconds < 3600) return Math.round(seconds / 60) + "분 전";
      return Math.round(seconds / 3600) + "시간 전";
    }

    function avgSeats(rows) {
      const validRows = rows.filter((row) => row.avgSeats !== null);
      if (!validRows.length) return "-";
      const value = validRows.reduce((sum, row) => sum + row.avgSeats, 0) / validRows.length;
      return Math.round(value * 10) / 10 + "석";
    }

    function formatSeats(value) {
      return value === null || value === undefined ? "-" : value + "석";
    }

    function readinessTotal(readiness) {
      if (!readiness || !readiness.targets) return "-";
      return readiness.readyTargets + "/" + readiness.targets;
    }

    function readinessClass(status) {
      if (status === "ready") return "ok";
      if (status === "partial") return "warn";
      return "bad";
    }

    function readinessLabel(status) {
      if (status === "ready") return "분석 가능";
      if (status === "partial") return "수집 중";
      return "대기";
    }

    function estimateTotal(summary) {
      const rows = summary.byDirection || [];
      if (!rows.length) return "0명";
      return rows.reduce((sum, row) => sum + row.estimatedBoardedCount, 0) + "명";
    }
  </script>
</body>
</html>`;
}
