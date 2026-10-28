import { describe, expect, it } from "vitest";
import {
  FUNNEL_EVENT_TBA, formatFunnelEventDuration, formatFunnelEventStart, formatFunnelEventTimeRange, funnelEventPhase, funnelEventSchedule,
  isoToZonedLocalInput, manualFunnelEventSchedule, resolveFunnelEventFields, zonedLocalInputToIso,
} from "./funnel-event-time";

const webinar = { timezone: "Asia/Taipei", startsAt: "2026-11-05T12:00:00.000Z", endsAt: "2026-11-05T13:30:00.000Z", replayEndsAt: "2026-11-08T12:00:00.000Z" };

describe("funnel event time (I-5)", () => {
  it("reads the funnel webinar schedule and the server deadline, rejecting invalid data", () => {
    const schedule = funnelEventSchedule({ webinar, registrationClosesAt: "2026-11-05T11:00:00Z", title: " 線上講座 " });
    expect(schedule).toEqual({ ...webinar, registrationClosesAt: "2026-11-05T11:00:00.000Z", title: "線上講座" });
    expect(funnelEventSchedule({ webinar: { ...webinar, timezone: "Not/AZone" } })).toMatchObject({ startsAt: null, timezone: "Asia/Taipei" });
    expect(funnelEventSchedule({ registrationClosesAt: "not a date" }).registrationClosesAt).toBeNull();
  });

  it("formats dates in the event time zone with weekday, range, zone label and duration", () => {
    const schedule = funnelEventSchedule({ webinar });
    expect(formatFunnelEventStart(schedule)).toBe("11 月 5 日（週四）20:00（台灣時間）");
    expect(formatFunnelEventTimeRange(schedule)).toBe("20:00–21:30");
    expect(formatFunnelEventDuration(schedule)).toBe("90 分鐘");
    expect(formatFunnelEventDuration({ startsAt: webinar.startsAt, endsAt: "2026-11-05T14:00:00.000Z" })).toBe("2 小時");
    expect(formatFunnelEventStart(funnelEventSchedule({ webinar: { ...webinar, timezone: "Asia/Tokyo" } }))).toBe("11 月 5 日（週四）21:00（GMT+9）");
    expect(formatFunnelEventStart(funnelEventSchedule({}))).toBe(FUNNEL_EVENT_TBA);
  });

  it("derives the event phase with half-open intervals and a 90-minute default length", () => {
    const schedule = funnelEventSchedule({ webinar });
    expect(funnelEventPhase(funnelEventSchedule({}), 0)).toBe("unscheduled");
    expect(funnelEventPhase(schedule, Date.parse(webinar.startsAt) - 1)).toBe("upcoming");
    expect(funnelEventPhase(schedule, Date.parse(webinar.startsAt))).toBe("live");
    expect(funnelEventPhase(schedule, Date.parse(webinar.endsAt))).toBe("replay");
    expect(funnelEventPhase(schedule, Date.parse(webinar.replayEndsAt))).toBe("ended");
    expect(funnelEventPhase({ startsAt: webinar.startsAt, endsAt: null, replayEndsAt: null }, Date.parse(webinar.startsAt) + 89 * 60_000)).toBe("live");
  });

  it("replaces only known dynamic fields and shows 時間公布中 without a schedule", () => {
    const schedule = funnelEventSchedule({ webinar, title: "AI 講座" });
    expect(resolveFunnelEventFields("{{webinar.title}}｜{{ webinar.date }} {{webinar.time}} {{webinar.unknown}}", schedule)).toBe("AI 講座｜2026 年 11 月 5 日 20:00–21:30 {{webinar.unknown}}");
    expect(resolveFunnelEventFields("開播：{{webinar.startAt}}", funnelEventSchedule({}))).toBe(`開播：${FUNNEL_EVENT_TBA}`);
    expect(resolveFunnelEventFields("沒有欄位", schedule)).toBe("沒有欄位");
  });

  it("round-trips the date-time picker value in the chosen time zone, including DST", () => {
    expect(isoToZonedLocalInput("2026-11-05T12:00:00.000Z", "Asia/Taipei")).toBe("2026-11-05T20:00");
    expect(zonedLocalInputToIso("2026-11-05T20:00", "Asia/Taipei")).toBe("2026-11-05T12:00:00.000Z");
    expect(zonedLocalInputToIso("2026-07-01T09:30", "America/New_York")).toBe("2026-07-01T13:30:00.000Z");
    expect(zonedLocalInputToIso("2026-12-01T09:30", "America/New_York")).toBe("2026-12-01T14:30:00.000Z");
    expect(zonedLocalInputToIso("2026-13-01T09:30", "Asia/Taipei")).toBeNull();
    expect(zonedLocalInputToIso("2026-11-05T20:00", "Bad/Zone")).toBeNull();
  });

  it("lets an element use its own times (non-webinar pages)", () => {
    const manual = manualFunnelEventSchedule(funnelEventSchedule({}), { startsAt: "2026-12-01T12:00:00Z", endsAt: "2026-12-01T11:00:00Z", timezone: "Asia/Tokyo" });
    expect(manual).toMatchObject({ startsAt: "2026-12-01T12:00:00.000Z", endsAt: null, timezone: "Asia/Tokyo" });
  });
});
