import { parseFunnelWebinarSettings } from "@/lib/funnel-webinar";

/**
 * I-5：一頁式網站上所有「活動時間」的單一資料來源。
 *
 * 時間只來自漏斗的 Webinar 排程（`flow.webinar`，UTC 保存、附時區）與伺服器提供的
 * 報名截止時間（漏斗營運設定的 deadline）。活動資訊列、倒數、加入行事曆、場次狀態與
 * 文字動態欄位都讀這裡，範本不得寫死日期。全部是純函式：伺服器與瀏覽器輸出一致。
 */
export type FunnelEventSchedule = {
  /** IANA 時區，例如 Asia/Taipei。 */
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  replayEndsAt: string | null;
  /** 報名截止（伺服器 deadline）；沒有設定時為 null。 */
  registrationClosesAt: string | null;
  /** 活動名稱（頁面設定 eventTitle）；沒有設定時為 null。 */
  title: string | null;
};

export const FUNNEL_EVENT_DEFAULT_TIMEZONE = "Asia/Taipei";
export const FUNNEL_EVENT_TBA = "時間公布中";
/** 沒有結束時間時，直播狀態的預設長度。 */
const DEFAULT_DURATION_MS = 90 * 60_000;

function instant(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function isFunnelTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/u.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; }
}

/** 從漏斗 webinar 設定與伺服器資料組出排程；任何欄位不合法都視為未設定。 */
export function funnelEventSchedule(input: { webinar?: unknown; registrationClosesAt?: unknown; title?: unknown }): FunnelEventSchedule {
  const webinar = parseFunnelWebinarSettings(input.webinar);
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 240) : null;
  return {
    timezone: webinar?.timezone ?? FUNNEL_EVENT_DEFAULT_TIMEZONE,
    startsAt: webinar?.startsAt ?? null,
    endsAt: webinar?.endsAt ?? null,
    replayEndsAt: webinar?.replayEndsAt ?? null,
    registrationClosesAt: instant(input.registrationClosesAt),
    title,
  };
}

/** 元件自訂時間（`source: "manual"`），給非 Webinar 漏斗的一頁式網站使用。 */
export function manualFunnelEventSchedule(base: FunnelEventSchedule, props: Record<string, unknown>): FunnelEventSchedule {
  const startsAt = instant(props.startsAt);
  const endsAt = instant(props.endsAt);
  return {
    ...base,
    timezone: isFunnelTimezone(props.timezone) ? props.timezone : base.timezone,
    startsAt,
    endsAt: startsAt && endsAt && Date.parse(endsAt) > Date.parse(startsAt) ? endsAt : null,
    replayEndsAt: null,
  };
}

export type FunnelEventPhase = "unscheduled" | "upcoming" | "live" | "replay" | "ended";
export const FUNNEL_EVENT_PHASE_LABELS: Readonly<Record<FunnelEventPhase, string>> = {
  unscheduled: "時間未定", upcoming: "開場前", live: "直播中", replay: "回放期", ended: "已結束",
};

/** 時間區間左閉右開，與 `getFunnelWebinarState` 相同；沒有結束時間時以 90 分鐘計。 */
export function funnelEventPhase(schedule: Pick<FunnelEventSchedule, "startsAt" | "endsAt" | "replayEndsAt">, now: number): FunnelEventPhase {
  if (!schedule.startsAt) return "unscheduled";
  const start = Date.parse(schedule.startsAt);
  const end = schedule.endsAt ? Date.parse(schedule.endsAt) : start + DEFAULT_DURATION_MS;
  if (now < start) return "upcoming";
  if (now < end) return "live";
  if (schedule.replayEndsAt && now < Date.parse(schedule.replayEndsAt)) return "replay";
  return "ended";
}

function parts(iso: string, timezone: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const output: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("zh-TW", { ...options, timeZone: timezone }).formatToParts(new Date(iso))) output[part.type] = part.value;
  return output;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;
function weekdayIndex(iso: string, timezone: string): number {
  const { year, month, day } = parts(iso, timezone, { year: "numeric", month: "numeric", day: "numeric" });
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
}

/** 「2026 年 11 月 5 日」。 */
export function formatFunnelEventDate(iso: string, timezone: string, options: { year?: boolean } = {}): string {
  const { year, month, day } = parts(iso, timezone, { year: "numeric", month: "numeric", day: "numeric" });
  return `${options.year === false ? "" : `${year} 年 `}${month} 月 ${day} 日`;
}

/** 「週四」。 */
export function formatFunnelEventWeekday(iso: string, timezone: string): string {
  return `週${WEEKDAYS[weekdayIndex(iso, timezone)]}`;
}

/** 24 小時制「20:00」。 */
export function formatFunnelEventClock(iso: string, timezone: string): string {
  const { hour, minute } = parts(iso, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

/** 台灣時區顯示「台灣時間」，其他時區顯示 GMT 偏移，例如「GMT+9」。 */
export function formatFunnelTimezone(timezone: string, at: string): string {
  if (timezone === "Asia/Taipei") return "台灣時間";
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" }).formatToParts(new Date(at)).find((part) => part.type === "timeZoneName")?.value;
  return offset ?? timezone;
}

/** 「90 分鐘」「2 小時」「1 小時 30 分鐘」；沒有結束時間時為 null。 */
export function formatFunnelEventDuration(schedule: Pick<FunnelEventSchedule, "startsAt" | "endsAt">): string | null {
  if (!schedule.startsAt || !schedule.endsAt) return null;
  const minutes = Math.round((Date.parse(schedule.endsAt) - Date.parse(schedule.startsAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 120 && minutes % 60 !== 0) return `${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`;
}

/** 「20:00–21:30」；沒有結束時間時只有開始時間。 */
export function formatFunnelEventTimeRange(schedule: Pick<FunnelEventSchedule, "startsAt" | "endsAt" | "timezone">): string | null {
  if (!schedule.startsAt) return null;
  const start = formatFunnelEventClock(schedule.startsAt, schedule.timezone);
  return schedule.endsAt ? `${start}–${formatFunnelEventClock(schedule.endsAt, schedule.timezone)}` : start;
}

/** 「11 月 5 日（週四）20:00（台灣時間）」；未設定時為「時間公布中」。 */
export function formatFunnelEventStart(schedule: Pick<FunnelEventSchedule, "startsAt" | "timezone">): string {
  if (!schedule.startsAt) return FUNNEL_EVENT_TBA;
  return `${formatFunnelEventDate(schedule.startsAt, schedule.timezone, { year: false })}（${formatFunnelEventWeekday(schedule.startsAt, schedule.timezone)}）${formatFunnelEventClock(schedule.startsAt, schedule.timezone)}（${formatFunnelTimezone(schedule.timezone, schedule.startsAt)}）`;
}

/* ------------------------------ 文字動態欄位 ------------------------------ */

export const FUNNEL_EVENT_DYNAMIC_FIELDS = ["webinar.title", "webinar.date", "webinar.time", "webinar.startAt", "webinar.weekday", "webinar.timezone", "webinar.duration"] as const;
export type FunnelEventDynamicField = (typeof FUNNEL_EVENT_DYNAMIC_FIELDS)[number];
export const FUNNEL_EVENT_DYNAMIC_FIELD_LABELS: Readonly<Record<FunnelEventDynamicField, string>> = {
  "webinar.title": "活動名稱", "webinar.date": "活動日期", "webinar.time": "開始～結束時間", "webinar.startAt": "完整開始時間",
  "webinar.weekday": "星期", "webinar.timezone": "時區", "webinar.duration": "活動長度",
};

export function funnelEventFieldValue(field: FunnelEventDynamicField, schedule: FunnelEventSchedule): string {
  if (field === "webinar.title") return schedule.title ?? "本場講座";
  const start = schedule.startsAt;
  if (!start) return field === "webinar.timezone" ? formatFunnelTimezone(schedule.timezone, new Date(0).toISOString()) : FUNNEL_EVENT_TBA;
  switch (field) {
    case "webinar.date": return formatFunnelEventDate(start, schedule.timezone);
    case "webinar.time": return formatFunnelEventTimeRange(schedule) ?? FUNNEL_EVENT_TBA;
    case "webinar.weekday": return formatFunnelEventWeekday(start, schedule.timezone);
    case "webinar.timezone": return formatFunnelTimezone(schedule.timezone, start);
    case "webinar.duration": return formatFunnelEventDuration(schedule) ?? FUNNEL_EVENT_TBA;
    default: return formatFunnelEventStart(schedule);
  }
}

const FIELD_PATTERN = /\{\{\s*(webinar\.[A-Za-z]+)\s*\}\}/gu;

/** 取代 `{{webinar.date}}` 這類欄位；未知欄位保留原文，方便商家發現打錯字。 */
export function resolveFunnelEventFields(text: string, schedule: FunnelEventSchedule): string {
  if (!text.includes("{{")) return text;
  return text.replace(FIELD_PATTERN, (match, field: string) => (FUNNEL_EVENT_DYNAMIC_FIELDS as readonly string[]).includes(field) ? funnelEventFieldValue(field as FunnelEventDynamicField, schedule) : match);
}

/* ------------------------------ 日期時間選擇器 ------------------------------ */

/** UTC ISO → `<input type="datetime-local">` 在指定時區的值（YYYY-MM-DDTHH:mm）。 */
export function isoToZonedLocalInput(iso: string | null | undefined, timezone: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  const { year, month, day, hour, minute } = parts(iso, timezone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${year}-${month}-${day}T${hour === "24" ? "00" : hour}:${minute}`;
}

/** `<input type="datetime-local">` 在指定時區的值 → UTC ISO（毫秒格式，與 webinar 設定相同）；格式錯誤為 null。 */
export function zonedLocalInputToIso(value: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value.trim());
  if (!match || !isFunnelTimezone(timezone)) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(wall)) return null;
  // Two passes settle the offset around DST changes.
  let guess = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = isoToZonedLocalInput(new Date(guess).toISOString(), timezone);
    const shownMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(shown);
    if (!shownMatch) return null;
    const [y, m, d, h, min] = shownMatch.slice(1).map(Number) as [number, number, number, number, number];
    guess += wall - Date.UTC(y, m - 1, d, h, min);
  }
  return isoToZonedLocalInput(new Date(guess).toISOString(), timezone) === value.trim() ? new Date(guess).toISOString() : null;
}
