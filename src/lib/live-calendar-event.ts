export const LIVE_CALENDAR_DEFAULT_DURATION_MINUTES = 60;

export type LiveCalendarEvent = {
  uid: string;
  title: string;
  startsAt: Date;
  url: string;
  durationMinutes?: number;
};

function utcStamp(date: Date) {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function endsAt(event: LiveCalendarEvent) {
  return new Date(event.startsAt.getTime() + (event.durationMinutes ?? LIVE_CALENDAR_DEFAULT_DURATION_MINUTES) * 60_000);
}

/** RFC 5545 TEXT escaping; also removes control characters so values cannot inject extra ICS lines. */
export function escapeIcsText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\\/gu, "\\\\")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,")
    .replace(/\r\n|\r|\n/gu, "\\n");
}

/** Fold to 75 octets per RFC 5545 §3.1 without splitting a UTF-8 sequence. */
function foldLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + charSize > limit) {
      parts.push(current);
      current = char;
      size = charSize;
    } else {
      current += char;
      size += charSize;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildLiveCalendarIcs(event: LiveCalendarEvent, now = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CelebrateDeal//Live Registration//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}@celebratedeal`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(event.startsAt)}`,
    `DTEND:${utcStamp(endsAt(event))}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(`直播間連結：${event.url}`)}`,
    `URL:${escapeIcsText(event.url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function buildGoogleCalendarUrl(event: LiveCalendarEvent) {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", event.title);
  url.searchParams.set("dates", `${utcStamp(event.startsAt)}/${utcStamp(endsAt(event))}`);
  url.searchParams.set("details", `直播間連結：${event.url}`);
  return url.href;
}
