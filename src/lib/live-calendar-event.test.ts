import { describe, expect, it } from "vitest";
import { buildGoogleCalendarUrl, buildLiveCalendarIcs, escapeIcsText } from "./live-calendar-event";

const event = {
  uid: "live_1",
  title: "新品發表, 直播;現場\n加碼",
  startsAt: new Date("2026-11-05T12:30:00.000Z"),
  url: "https://app.example.test/live/demo",
};

describe("live calendar event", () => {
  it("builds a CRLF ICS with UTC times, a default one hour length and escaped text", () => {
    const ics = buildLiveCalendarIcs(event, new Date("2026-10-21T00:00:00.000Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261105T123000Z\r\n");
    expect(ics).toContain("DTEND:20261105T133000Z\r\n");
    expect(ics).toContain("DTSTAMP:20261021T000000Z\r\n");
    expect(ics).toContain("SUMMARY:新品發表\\, 直播\\;現場\\n加碼");
    expect(ics).toContain("UID:live_1@celebratedeal");
  });

  it("cannot be used to inject extra ICS properties", () => {
    expect(escapeIcsText("a\r\nEND:VEVENT")).toBe("a\\nEND:VEVENT");
    const ics = buildLiveCalendarIcs({ ...event, title: "x\r\nEND:VEVENT\r\nBEGIN:VEVENT" });
    expect(ics.match(/^BEGIN:VEVENT/gmu)).toHaveLength(1);
    expect(ics.match(/^END:VEVENT/gmu)).toHaveLength(1);
  });

  it("folds long lines at 75 octets without breaking characters", () => {
    const ics = buildLiveCalendarIcs({ ...event, title: "直".repeat(80) });
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /gu, "")).toContain(`SUMMARY:${"直".repeat(80)}`);
  });

  it("builds a Google Calendar template link in UTC", () => {
    const url = new URL(buildGoogleCalendarUrl({ ...event, durationMinutes: 90 }));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261105T123000Z/20261105T140000Z");
    expect(url.searchParams.get("details")).toContain("https://app.example.test/live/demo");
  });
});
