const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;
const OFFSET_SCAN_RADIUS_MS = 3 * 24 * 60 * 60 * 1000;
const OFFSET_SCAN_STEP_MS = 30 * 60 * 1000;

const localDateTimeFormatterOptions: Intl.DateTimeFormatOptions = {
  calendar: "iso8601",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
};

export type ZonedDateTimeErrorCode =
  | "invalid_timezone"
  | "invalid_local_time"
  | "nonexistent_local_time"
  | "ambiguous_local_time"
  | "invalid_date";

export class ZonedDateTimeError extends Error {
  constructor(
    public readonly code: ZonedDateTimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ZonedDateTimeError";
  }
}

function invalidTimeZone(timeZone: string): ZonedDateTimeError {
  return new ZonedDateTimeError("invalid_timezone", `不支援的 IANA 時區：${timeZone}`);
}

export function assertIanaTimeZone(timeZone: string): string {
  if (typeof timeZone !== "string" || timeZone.length === 0 || timeZone.trim() !== timeZone) {
    throw invalidTimeZone(String(timeZone));
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).formatToParts(new Date(0));
  } catch (error) {
    if (error instanceof ZonedDateTimeError) throw error;
    throw invalidTimeZone(timeZone);
  }

  return timeZone;
}

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function readDateTimeParts(value: Date, timeZone: string): DateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    ...localDateTimeFormatterOptions,
    timeZone,
  });
  const parts = formatter.formatToParts(value);
  const partValue = (type: string) => parts.find((part) => part.type === type)?.value;
  const values = {
    year: partValue("year"),
    month: partValue("month"),
    day: partValue("day"),
    hour: partValue("hour"),
    minute: partValue("minute"),
    second: partValue("second"),
  };

  if (Object.values(values).some((part) => part === undefined)) {
    throw new ZonedDateTimeError("invalid_date", "無法讀取指定時區的日期時間。");
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function utcEpochFromParts(parts: DateTimeParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function localPartsKey(parts: DateTimeParts): string {
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function parseLocalParts(value: string): DateTimeParts {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    throw new ZonedDateTimeError("invalid_local_time", "日期時間必須符合 YYYY-MM-DDTHH:mm 格式。");
  }

  const parts: DateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
  const wallTimeEpoch = utcEpochFromParts(parts);
  const normalized = new Date(wallTimeEpoch);
  const matchesInput = normalized.getUTCFullYear() === parts.year
    && normalized.getUTCMonth() === parts.month - 1
    && normalized.getUTCDate() === parts.day
    && normalized.getUTCHours() === parts.hour
    && normalized.getUTCMinutes() === parts.minute;
  if (!matchesInput) {
    throw new ZonedDateTimeError("invalid_local_time", "日期時間不是有效的日曆時間。");
  }

  return parts;
}

function timeZoneOffsetMs(timeZone: string, instantMs: number): number {
  const localParts = readDateTimeParts(new Date(instantMs), timeZone);
  return utcEpochFromParts(localParts) - instantMs;
}

function possibleOffsets(timeZone: string, wallTimeEpoch: number): Set<number> {
  const offsets = new Set<number>();
  for (
    let instant = wallTimeEpoch - OFFSET_SCAN_RADIUS_MS;
    instant <= wallTimeEpoch + OFFSET_SCAN_RADIUS_MS;
    instant += OFFSET_SCAN_STEP_MS
  ) {
    offsets.add(timeZoneOffsetMs(timeZone, instant));
  }
  return offsets;
}

export function parseZonedDateTimeLocal(value: string, timeZone: string): Date {
  assertIanaTimeZone(timeZone);
  const localParts = parseLocalParts(value);
  const wallTimeEpoch = utcEpochFromParts(localParts);
  const targetKey = localPartsKey(localParts);
  const candidates = new Set<number>();

  for (const offsetMs of possibleOffsets(timeZone, wallTimeEpoch)) {
    const candidateMs = wallTimeEpoch - offsetMs;
    const candidateParts = readDateTimeParts(new Date(candidateMs), timeZone);
    if (localPartsKey(candidateParts) === targetKey) candidates.add(candidateMs);
  }

  if (candidates.size === 0) {
    throw new ZonedDateTimeError("nonexistent_local_time", "指定時間在此時區不存在，可能是夏令時間切換造成的空檔。");
  }
  if (candidates.size > 1) {
    throw new ZonedDateTimeError("ambiguous_local_time", "指定時間在此時區重複，可能是夏令時間切換造成的歧義。");
  }

  return new Date([...candidates][0]);
}

export function formatZonedDateTimeLocal(value: Date, timeZone: string): string {
  assertIanaTimeZone(timeZone);
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ZonedDateTimeError("invalid_date", "無法格式化無效的 UTC 日期時間。");
  }

  const parts = readDateTimeParts(value, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export const formatDateTimeLocalInTimeZone = formatZonedDateTimeLocal;
