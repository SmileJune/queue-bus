#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseArgs } from "./gbis-client.mjs";
import {
  DEFAULT_HOLIDAY_CALENDAR_PATH,
  currentPeakWindow,
  kstParts,
  loadHolidayDates,
} from "./peak-windows.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsage();
  process.exit(0);
}

const holidayCalendarPath = args["holiday-calendar"] ?? DEFAULT_HOLIDAY_CALENDAR_PATH;
const holidayDates = loadHolidayDates(holidayCalendarPath);
const now = args.now ? new Date(args.now) : new Date();
const activeWindow = args.force
  ? { label: "forced", targetDirection: args.direction ?? args["target-direction"] }
  : currentPeakWindow(now, holidayDates);

if (!activeWindow) {
  const parts = kstParts(now);
  console.log(`[gbis:peak-arrivals] inactive at ${parts.dateKey} ${parts.timeText} KST.`);
  process.exit(0);
}

const collectorArgs = [
  "scripts/gbis-collect.mjs",
  "--once",
  "--locations",
  "false",
  "--arrivals",
  "true",
];

if (activeWindow.targetDirection) {
  collectorArgs.push("--direction", activeWindow.targetDirection);
}

if (args.config) {
  collectorArgs.push("--config", args.config);
}

collectorArgs.push("--holiday-calendar", holidayCalendarPath);

if (args.out) {
  collectorArgs.push("--out", args.out);
}

if (args["dry-run"]) {
  console.log(`[gbis:peak-arrivals] active window: ${activeWindow.label}`);
  if (activeWindow.targetDirection) {
    console.log(`[gbis:peak-arrivals] target direction: ${activeWindow.targetDirection}`);
  }
  console.log(`[gbis:peak-arrivals] dry run: node ${collectorArgs.join(" ")}`);
  process.exit(0);
}

console.log(`[gbis:peak-arrivals] active window: ${activeWindow.label}`);
if (activeWindow.targetDirection) {
  console.log(`[gbis:peak-arrivals] target direction: ${activeWindow.targetDirection}`);
}
const child = spawn(process.execPath, collectorArgs, { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`[gbis:peak-arrivals] collector terminated by ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 0);
});

function printUsage() {
  console.log(`Usage:
  npm run gbis:collect:peak-arrivals
  npm run gbis:collect:peak-arrivals -- --dry-run
  npm run gbis:collect:peak-arrivals -- --dry-run --now 2026-06-03T02:00:00.000Z
  npm run gbis:collect:peak-arrivals -- --force --out /tmp/peak-arrivals-test.csv

Runs target-specific arrival snapshots only during active peak windows:
- Weekday outbound 06:30-09:30 KST
- Weekday return 16:00-20:30 KST
- Holiday/weekend outbound 10:00-14:00 KST
- Holiday/weekend return 16:00-20:00 KST

Outside those windows it exits without calling GBIS.`);
}
