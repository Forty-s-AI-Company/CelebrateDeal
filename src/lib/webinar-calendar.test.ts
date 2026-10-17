import { describe, expect, it } from "vitest";
import { createWebinarCalendar } from "./webinar-calendar";

const now = new Date("2030-01-01T00:00:00.000Z");
const input = { liveId: "owned_live", title: "公開講座", origin: "https://example.test", slug: "owned-page", broadcastPath: "broadcast", schedule: { timezone: "Asia/Taipei", startsAt: "2030-01-02T01:00:00.000Z", endsAt: "2030-01-02T02:00:00.000Z", replayEndsAt: null } };
const unfold = (value: string) => value.replace(/\r\n /gu, "");

describe("optional public webinar calendar", () => {
  it("exports the public schedule and handoff, without recipients, access grants or invented alarms", () => {
    const calendar = createWebinarCalendar(input, now)!;
    expect(calendar).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(calendar).toContain("DTSTAMP:20300101T000000Z\r\n");
    expect(calendar).toContain("DTSTART:20300102T010000Z\r\nDTEND:20300102T020000Z\r\n");
    expect(calendar).toContain("UID:celebratedeal-live-owned_live\r\n");
    expect(calendar).toContain("URL:https://example.test/lp/owned-page/broadcast\r\n");
    expect(unfold(calendar)).toContain("請完成 Email 確認");
    for (const forbidden of ["ATTENDEE", "ORGANIZER", "VALARM", "/play", "fsv1.", "mailto:"]) expect(calendar).not.toContain(forbidden);
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("escapes title line injection and folds long UTF8 lines without corrupting Chinese or emoji", () => {
    const title = "課程😀，練習;\\\r\nBEGIN:VEVENT\n" + "繁體中文".repeat(20);
    const calendar = createWebinarCalendar({ ...input, title }, now)!;
    expect(unfold(calendar)).toContain(`SUMMARY:${title.replace(/\\/gu,"\\\\").replace(/\r\n|\r|\n/gu,"\\n").replace(/;/gu,"\\;").replace(/,/gu,"\\,")}`);
    expect(calendar.match(/^BEGIN:VEVENT$/gmu)).toHaveLength(1);
    for (const line of calendar.split("\r\n")) expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(calendar))).toBe(calendar);
  });
  it("keeps event identity stable on reschedule and uses UTC across daylight saving transitions", () => {
    const changed = createWebinarCalendar({ ...input, schedule: { timezone: "America/New_York", startsAt: "2030-03-10T06:30:00.000Z", endsAt: "2030-03-10T07:30:00.000Z", replayEndsAt: null } }, now)!;
    expect(changed).toContain("UID:celebratedeal-live-owned_live\r\n");
    expect(changed).toContain("DTSTART:20300310T063000Z\r\nDTEND:20300310T073000Z\r\n");
  });
  it("supports the existing 200-character Live title and long valid funnel step paths",()=>{
    const title="講".repeat(200),broadcastPath="broadcast-"+"a".repeat(150);
    const calendar=unfold(createWebinarCalendar({...input,title,broadcastPath},now)!);
    expect(calendar).toContain(`SUMMARY:${title}\r\n`);
    expect(calendar).toContain(`URL:https://example.test/lp/owned-page/${broadcastPath}\r\n`);
  });
  it.each(["javascript:alert(1)", "https://example.test/?capability=synthetic", "https://user:synthetic@example.test", "https://example.test/path"])("rejects a non-origin input %s", origin => {
    expect(createWebinarCalendar({ ...input, origin }, now)).toBeNull();
  });
  it("fails closed for missing, started, sub-second, malformed or injected event data", () => {
    for (const invalid of [
      { ...input, schedule: null }, { ...input, schedule: { ...input.schedule, startsAt: null } },
      { ...input, schedule: { ...input.schedule, endsAt: input.schedule.startsAt } },
      { ...input, schedule: { ...input.schedule, endsAt: "2030-01-02T01:00:00.100Z" } },
      { ...input, title: "" }, { ...input, title: "x".repeat(201) }, { ...input, title: "title\u0000" },
      { ...input, schedule: { ...input.schedule, startsAt:"not-a-date" } },
      { ...input, schedule: { ...input.schedule, startsAt:"+010000-01-01T00:00:00.000Z",endsAt:"+010000-01-01T01:00:00.000Z" } },
      { ...input, liveId: "id\r\nATTENDEE:injected" }, { ...input, slug: ".." }, { ...input, broadcastPath: "broadcast?capability=synthetic" },
    ]) expect(createWebinarCalendar(invalid, now)).toBeNull();
    expect(createWebinarCalendar(input, new Date(input.schedule.startsAt))).toBeNull();
    expect(createWebinarCalendar(input, new Date("invalid"))).toBeNull();
  });
});
