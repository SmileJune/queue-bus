#!/usr/bin/env node
import {
  ENDPOINTS,
  fetchGbisJson,
  getItems,
  parseArgs,
  printRows,
} from "./gbis-client.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help || args._.length < 2) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const [command, value] = args._;
const limit = Number(args.limit ?? 40);

try {
  if (command === "route") {
    const payload = await fetchGbisJson(ENDPOINTS.routeList, { keyword: value });
    const rows = getItems(payload, ["busRouteList"]);
    printRows(rows, [
      "routeId",
      "routeName",
      "routeTypeCd",
      "routeTypeName",
      "regionName",
      "startStationName",
      "endStationName",
      "adminName",
    ], limit);
  } else if (command === "station") {
    const payload = await fetchGbisJson(ENDPOINTS.stationList, { keyword: value });
    const rows = getItems(payload, ["busStationList"]);
    printRows(rows, [
      "stationId",
      "stationName",
      "mobileNo",
      "regionName",
      "centerYn",
      "x",
      "y",
    ], limit);
  } else if (command === "station-routes") {
    const payload = await fetchGbisJson(ENDPOINTS.stationRoutes, { stationId: value });
    const rows = getItems(payload, ["busRouteList"]);
    printRows(rows, [
      "routeId",
      "routeName",
      "routeTypeCd",
      "routeTypeName",
      "staOrder",
      "routeDestName",
      "regionName",
    ], limit);
  } else if (command === "route-stations") {
    const payload = await fetchGbisJson(ENDPOINTS.routeStations, { routeId: value });
    const rows = getItems(payload, ["busRouteStationList"]);
    printRows(rows, [
      "stationSeq",
      "stationId",
      "stationName",
      "mobileNo",
      "regionName",
      "turnYn",
      "x",
      "y",
    ], limit);
  } else {
    throw new Error(`Unknown lookup command: ${command}`);
  }
} catch (error) {
  console.error(`[gbis:lookup] ${error.message}`);
  process.exit(1);
}

function printUsage() {
  console.log(`Usage:
  GBIS_SERVICE_KEY=... npm run gbis:lookup -- route <route-name-or-number>
  GBIS_SERVICE_KEY=... npm run gbis:lookup -- station <station-name-or-number>
  GBIS_SERVICE_KEY=... npm run gbis:lookup -- station-routes <station-id>
  GBIS_SERVICE_KEY=... npm run gbis:lookup -- route-stations <route-id>

Options:
  --limit <n>  Rows to print. Use 0 for all rows. Default: 40`);
}
