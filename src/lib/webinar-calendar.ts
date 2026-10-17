import { parseFunnelWebinarSettings } from "@/lib/funnel-webinar";

export type WebinarCalendarInput = {
  liveId: string;
  title: string;
  schedule: unknown;
  slug: string;
  broadcastPath: string;
  origin: string;
};

const escapeText = (text: string) => text.replace(/\\/gu, "\\\\").replace(/\r\n|\r|\n/gu, "\\n").replace(/;/gu, "\\;").replace(/,/gu, "\\,");
const utc = (date: Date) => date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");

/** RFC5545 folds bytes, not JS characters. Never split a UTF-8 code point. */
function fold(line: string) {
  const encoder = new TextEncoder();
  let result = "", size = 0;
  for (const character of line) {
    const length = encoder.encode(character).byteLength;
    if (size + length > 75) { result += "\r\n "; size = 1; }
    result += character; size += length;
  }
  return result;
}

/** Local, optional calendar export. It never contains recipient data or access grants. */
export function createWebinarCalendar(input: WebinarCalendarInput, now = new Date()): string | null {
  const schedule = parseFunnelWebinarSettings(input.schedule);
  if (!schedule?.startsAt || !schedule.endsAt || !Number.isFinite(now.getTime())) return null;
  const start = new Date(schedule.startsAt), end = new Date(schedule.endsAt);
  if (start.getTime() <= now.getTime() || start.getUTCFullYear() < 1 || end.getUTCFullYear() < 1 || now.getUTCFullYear() < 1 || now.getUTCFullYear() > 9999) return null;
  if (utc(end) <= utc(start)) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.liveId) || !input.title.trim() || input.title.length > 200 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.title)) return null;
  const segment = /^[A-Za-z0-9_-]{1,100}$/u;
  // Funnel step paths are validated segments without the landing slug's 100-char cap.
  if (!segment.test(input.slug) || !/^[A-Za-z0-9_-]+$/u.test(input.broadcastPath)) return null;
  let url: URL;
  try {
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || !["https:", "http:"].includes(origin.protocol)) return null;
    url = new URL(`/lp/${encodeURIComponent(input.slug)}/${encodeURIComponent(input.broadcastPath)}`, origin);
  } catch { return null; }
  // Keep the public handoff, never /play, a media URL, query capability or attendee.
  const description = `請完成 Email 確認，再依活動時間使用公開觀看入口。\n活動改期時，請更新已加入的行程。\n${url.href}`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CelebrateDeal//Webinar Calendar//ZH-TW", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:celebratedeal-live-${input.liveId}`, `DTSTAMP:${utc(now)}`, `DTSTART:${utc(start)}`, `DTEND:${utc(end)}`,
    `SUMMARY:${escapeText(input.title.trim())}`, `DESCRIPTION:${escapeText(description)}`, `URL:${url.href}`, "END:VEVENT", "END:VCALENDAR"];
  // No VALARM, attendee or organizer is invented. The user configures reminders.
  return lines.map(fold).join("\r\n") + "\r\n";
}
