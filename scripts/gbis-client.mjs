import { readFileSync } from "node:fs";
import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const GBIS_BASE_URL = "https://apis.data.go.kr/6410000";

export const ENDPOINTS = {
  routeList: "/busrouteservice/v2/getBusRouteListv2",
  routeStations: "/busrouteservice/v2/getBusRouteStationListv2",
  stationList: "/busstationservice/v2/getBusStationListv2",
  stationRoutes: "/busstationservice/v2/getBusStationViaRouteListv2",
  busLocations: "/buslocationservice/v2/getBusLocationListv2",
  busArrivalItem: "/busarrivalservice/v2/getBusArrivalItemv2",
};

loadDotEnv();

const LOCATION_KEY_SPLIT_HOUR_KST = 12;
const DEFAULT_ALERT_STATE_PATH = "data/gbis-alert-state.json";
const DEFAULT_ALERT_COOLDOWN_MINUTES = 60;

export function parseArgs(argv) {
  const args = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=");
    const key = rawKey.trim();

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

export function getServiceKey(options = {}) {
  return selectServiceKey(undefined, options).value;
}

export function describeGbisKeySelection(endpoint, options = {}, date = new Date()) {
  const selected = selectServiceKey(endpoint, options, date);

  return {
    slot: selected.slot,
    configuredSlots: getConfiguredServiceKeys().map((key) => key.slot),
    isEncoded: selected.isEncoded,
  };
}

function selectServiceKey(endpoint, options = {}, date = new Date()) {
  const keys = getConfiguredServiceKeys();

  if (keys.length === 0) {
    throw new Error(
      "GBIS_SERVICE_KEY is required. Use the decoded data.go.kr key when possible.",
    );
  }

  const requestedSlot = Number(options.keySlot);
  if (Number.isInteger(requestedSlot) && requestedSlot > 0) {
    return keys.find((key) => key.slot === requestedSlot) ?? keys[0];
  }

  if (endpoint === ENDPOINTS.busLocations && keys.length > 1) {
    return kstHour(date) < LOCATION_KEY_SPLIT_HOUR_KST ? keys[0] : keys[1];
  }

  return keys[0];
}

function getConfiguredServiceKeys() {
  const slots = [
    { slot: 1, keyName: "GBIS_SERVICE_KEY", encodedName: "GBIS_SERVICE_KEY_IS_ENCODED" },
    { slot: 2, keyName: "GBIS_SERVICE_KEY_2", encodedName: "GBIS_SERVICE_KEY_2_IS_ENCODED" },
  ];

  return slots
    .map((slot) => ({
      slot: slot.slot,
      value: process.env[slot.keyName],
      isEncoded: process.env[slot.encodedName] === "1",
    }))
    .filter((slot) => Boolean(slot.value));
}

function kstHour(date) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value;

  return Number(hour ?? 0);
}

function loadDotEnv(path = ".env") {
  let text;

  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unwrapEnvValue(rawValue);
  }
}

function unwrapEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function buildGbisUrl(endpoint, params = {}, options = {}) {
  const serviceKey = selectServiceKey(endpoint, options);
  return buildGbisUrlWithKey(endpoint, params, serviceKey);
}

function buildGbisUrlWithKey(endpoint, params = {}, serviceKey) {
  const query = new URLSearchParams({ format: "json" });

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }

  if (serviceKey.isEncoded) {
    return `${GBIS_BASE_URL}${endpoint}?serviceKey=${serviceKey.value}&${query.toString()}`;
  }

  query.set("serviceKey", serviceKey.value);
  return `${GBIS_BASE_URL}${endpoint}?${query.toString()}`;
}

export async function fetchGbisJson(endpoint, params = {}, options = {}) {
  const candidates = serviceKeyCandidates(endpoint, options);
  const quotaFailures = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const serviceKey = candidates[index];
    const url = buildGbisUrlWithKey(endpoint, params, serviceKey);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    const body = await response.text();

    if (response.ok) {
      return parseGbisJsonBody(body);
    }

    if (response.status === 429) {
      quotaFailures.push({ slot: serviceKey.slot, body });

      if (index < candidates.length - 1) {
        const nextSlot = candidates[index + 1].slot;
        console.warn(`[gbis:client] ${endpoint}: key slot ${serviceKey.slot} quota exceeded; retrying with slot ${nextSlot}.`);
        continue;
      }

      if (quotaFailures.length === candidates.length) {
        await notifyGbisQuotaAlert(endpoint, quotaFailures);
      }
    }

    throw gbisRequestError(response.status, body, quotaFailures);
  }

  throw new Error("GBIS request failed before any API call was attempted.");
}

function serviceKeyCandidates(endpoint, options = {}) {
  const primary = selectServiceKey(endpoint, options);
  const retryEnabled = options.retryOnQuota !== false;

  if (!retryEnabled) {
    return [primary];
  }

  return [
    primary,
    ...getConfiguredServiceKeys().filter((key) => key.slot !== primary.slot),
  ];
}

function parseGbisJsonBody(body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`GBIS response was not JSON: ${body.slice(0, 300)}`);
  }
}

function gbisRequestError(status, body, quotaFailures) {
  const quotaSlots = quotaFailures.map((failure) => failure.slot);
  const slotText = quotaSlots.length > 0 ? ` on key slot(s) ${quotaSlots.join(", ")}` : "";

  return new Error(`GBIS request failed with HTTP ${status}${slotText}: ${body.slice(0, 300)}`);
}

async function notifyGbisQuotaAlert(endpoint, quotaFailures) {
  const webhookUrl = process.env.GBIS_ALERT_WEBHOOK_URL;

  if (!webhookUrl || !(await shouldSendQuotaAlert(endpoint, quotaFailures))) {
    return;
  }

  const slots = quotaFailures.map((failure) => failure.slot).join(", ");
  const message = [
    "[QueueBus] GBIS quota exhausted",
    `endpoint: ${endpoint}`,
    `key slots: ${slots}`,
    `time: ${new Date().toISOString()}`,
  ].join("\n");

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alertPayload(webhookUrl, message)),
    });
  } catch (error) {
    console.error(`[gbis:client] quota alert failed: ${error.message}`);
  }
}

async function shouldSendQuotaAlert(endpoint, quotaFailures) {
  const cooldownMinutes = Number(
    process.env.GBIS_ALERT_COOLDOWN_MINUTES ?? DEFAULT_ALERT_COOLDOWN_MINUTES,
  );
  const cooldownMs = Math.max(cooldownMinutes, 1) * 60 * 1000;
  const statePath = process.env.GBIS_ALERT_STATE_PATH ?? DEFAULT_ALERT_STATE_PATH;
  const alertKey = `quota:${endpoint}:${quotaFailures.map((failure) => failure.slot).join(",")}`;
  const now = Date.now();
  let state = {};

  try {
    state = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    state = {};
  }

  if (now - Number(state[alertKey] ?? 0) < cooldownMs) {
    return false;
  }

  state[alertKey] = now;
  await writeAlertState(statePath, state);
  return true;
}

async function writeAlertState(statePath, state) {
  try {
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    console.error(`[gbis:client] cannot write alert state: ${error.message}`);
  }
}

function alertPayload(webhookUrl, message) {
  const format = String(process.env.GBIS_ALERT_WEBHOOK_FORMAT ?? "").toLowerCase();

  if (format === "discord" || (!format && webhookUrl.includes("discord.com"))) {
    return { content: message };
  }

  return { text: message };
}

export function getItems(payload, keys) {
  for (const key of keys) {
    const value = findFirstValue(payload, key);
    const items = asArray(value);
    if (items.length > 0) {
      return items;
    }
  }

  return [];
}

export function getResponseHeader(payload) {
  const msgHeader = findFirstValue(payload, "msgHeader");
  const responseHeader = findFirstValue(payload, "header");
  const header = isObject(msgHeader) ? msgHeader : isObject(responseHeader) ? responseHeader : {};

  return {
    queryTime: toStringOrEmpty(header.queryTime ?? findFirstValue(payload, "queryTime")),
    resultCode: toStringOrEmpty(
      header.resultCode ?? header.headerCd ?? findFirstValue(payload, "resultCode"),
    ),
    resultMessage: toStringOrEmpty(
      header.resultMessage ?? header.headerMsg ?? findFirstValue(payload, "resultMessage"),
    ),
  };
}

export function findFirstValue(value, key) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findFirstValue(item, key);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  if (!isObject(value)) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return value[key];
  }

  for (const child of Object.values(value)) {
    const result = findFirstValue(child, key);
    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}

export function getField(object, ...names) {
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null) {
      return object[name];
    }
  }

  return "";
}

export function toStringOrEmpty(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

export function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function appendCsvRows(path, columns, rows) {
  await mkdir(dirname(path), { recursive: true });

  if (rows.length === 0) {
    await ensureCsvHeader(path, columns);
    return;
  }

  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
  await ensureCsvHeader(path, columns);
  await appendFile(path, `${lines.join("\n")}\n`, "utf8");
}

export async function writeCsvRows(path, columns, rows) {
  await mkdir(dirname(path), { recursive: true });
  const lines = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

export async function readCsvRows(path) {
  const text = await readFile(path, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export function printRows(rows, columns, limit = 40) {
  const limitedRows = limit > 0 ? rows.slice(0, limit) : rows;
  const normalized = limitedRows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])),
  );

  console.table(normalized);

  if (limit > 0 && rows.length > limit) {
    console.log(`... ${rows.length - limit} more rows. Use --limit 0 to print all rows.`);
  }
}

async function ensureCsvHeader(path, columns) {
  let text;

  try {
    await access(path);
    text = await readFile(path, "utf8");
  } catch {
    await writeFile(path, `${columns.join(",")}\n`, "utf8");
    return;
  }

  const lines = text.split(/\r?\n/);
  const headerLine = lines.find((line) => line.trim() !== "");
  if (!headerLine) {
    await writeFile(path, `${columns.join(",")}\n`, "utf8");
    return;
  }

  const currentColumns = parseCsvLine(headerLine);
  const missingColumns = columns.filter((column) => !currentColumns.includes(column));

  if (missingColumns.length === 0) {
    return;
  }

  const migratedColumns = [
    ...columns,
    ...currentColumns.filter((column) => !columns.includes(column)),
  ];
  const rows = lines
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const values = parseCsvLine(line);
      return Object.fromEntries(currentColumns.map((column, index) => [column, values[index] ?? ""]));
    });
  const migratedLines = [
    migratedColumns.join(","),
    ...rows.map((row) => migratedColumns.map((column) => csvEscape(row[column])).join(",")),
  ];

  await writeFile(path, `${migratedLines.join("\n")}\n`, "utf8");
}

function asArray(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function csvEscape(value) {
  const stringValue = toStringOrEmpty(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
