import { readFileSync } from "node:fs";

export const DEFAULT_HOLIDAY_CALENDAR_PATH = "data/kr-holidays.json";

export const PEAK_WINDOWS = [
  {
    name: "weekday-morning",
    label: "평일 출근 06:30-09:30",
    dayTypes: ["weekday"],
    targetDirection: "동탄→서울",
    startMinute: 6 * 60 + 30,
    endMinute: 9 * 60 + 30,
  },
  {
    name: "weekday-evening",
    label: "평일 퇴근 16:00-20:30",
    dayTypes: ["weekday"],
    targetDirection: "서울→동탄",
    startMinute: 16 * 60,
    endMinute: 20 * 60 + 30,
  },
  {
    name: "holiday-outbound",
    label: "휴일 외출 10:00-14:00",
    dayTypes: ["weekend", "public_holiday"],
    targetDirection: "동탄→서울",
    startMinute: 10 * 60,
    endMinute: 14 * 60,
  },
  {
    name: "holiday-return",
    label: "휴일 복귀 16:00-20:00",
    dayTypes: ["weekend", "public_holiday"],
    targetDirection: "서울→동탄",
    startMinute: 16 * 60,
    endMinute: 20 * 60,
  },
];

export function loadHolidayDates(path = DEFAULT_HOLIDAY_CALENDAR_PATH) {
  try {
    const payload = JSON.parse(readFileSync(path, "utf8"));
    const holidays = Array.isArray(payload) ? payload : payload.holidays ?? [];

    return new Set(holidays.map((holiday) =>
      typeof holiday === "string" ? holiday : holiday.date,
    ).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function kstParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    timeText: `${parts.hour}:${parts.minute}`,
    timeTextWithSeconds: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekdayText: parts.weekday,
    weekday: weekdayMap[parts.weekday] ?? 0,
    minuteOfDay: hour * 60 + minute,
  };
}

export function dayTypeForParts(parts, holidayDates) {
  if (holidayDates.has(parts.dateKey)) {
    return "public_holiday";
  }

  if (parts.weekday === 0 || parts.weekday === 6) {
    return "weekend";
  }

  return "weekday";
}

export function currentPeakWindow(date, holidayDates, windows = PEAK_WINDOWS) {
  const parts = kstParts(date);
  const dayType = dayTypeForParts(parts, holidayDates);

  return windows.find((window) =>
    window.dayTypes.includes(dayType) &&
    parts.minuteOfDay >= window.startMinute &&
    parts.minuteOfDay <= window.endMinute,
  );
}

export function peakWindowsForDirection(direction, windows = PEAK_WINDOWS) {
  return windows.filter((window) => window.targetDirection === direction);
}

export function isInPeakWindow(parts, dayType, window) {
  return window.dayTypes.includes(dayType) &&
    parts.minuteOfDay >= window.startMinute &&
    parts.minuteOfDay <= window.endMinute;
}

export function kstAnalysisFields(iso, holidayDates) {
  const parts = kstParts(new Date(iso));
  const dayType = dayTypeForParts(parts, holidayDates);
  const peakWindow = PEAK_WINDOWS.find((window) => isInPeakWindow(parts, dayType, window));

  return {
    kst_date: parts.dateKey,
    kst_time: parts.timeTextWithSeconds,
    kst_weekday: parts.weekdayText,
    kst_minute_of_day: parts.minuteOfDay,
    kst_time_bucket_15m: formatMinuteOfDay(Math.floor(parts.minuteOfDay / 15) * 15),
    is_weekday: dayType === "weekday",
    is_holiday: dayType === "weekend" || dayType === "public_holiday",
    day_type: dayType,
    time_peak_window: peakWindow?.label ?? "",
  };
}

export function formatPeakWindowLabels(windows) {
  return windows.map((window) => window.label).join(" / ");
}

function formatMinuteOfDay(minuteOfDay) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
