import { describe, expect, it } from "vitest";
import { quickWebinarContent, quickWebinarSchedule, QuickWebinarInputSchema } from "./quick-webinar";
import { parseFunnelStepPages } from "./funnel-step-pages";

describe("quick webinar schedule and generated content", () => {
  it("uses the vendor timezone and authoritative duration for all three pages", () => {
    const schedule = quickWebinarSchedule("2030-08-01T10:00", "Asia/Taipei", 1800, new Date("2030-07-01"));
    expect(schedule.startsAt.toISOString()).toBe("2030-08-01T02:00:00.000Z");
    expect(schedule.endsAt.toISOString()).toBe("2030-08-01T02:30:00.000Z");
    expect(schedule.replayEndsAt.toISOString()).toBe("2030-08-08T02:30:00.000Z");
    const content = quickWebinarContent("synthetickey", "合成講座", "synthetic-webinar", "Asia/Taipei", schedule);
    expect(parseFunnelStepPages(content)).not.toBeNull();
    expect(content.flow.steps.filter(s => !s.isSystem).map(s => s.type)).toEqual(["webinar_registration_page", "webinar_thank_you_page", "webinar_broadcast_page"]);
    expect(content.flow.webinar?.startsAt).toBe(schedule.startsAt.toISOString());
    expect(JSON.stringify(content)).toContain("已收到報名資料，請完成 Email 確認");
    expect(JSON.stringify(content)).not.toContain("請填入實際講者");
    expect(JSON.stringify(content)).not.toContain('"type":"video"');
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 43201])("rejects unavailable duration %s", duration => {
    expect(() => quickWebinarSchedule("2030-08-01T10:00", "Asia/Taipei", duration, new Date("2030-07-01"))).toThrow("schedule_invalid");
  });
  it.each(["invalid", "2030-03-10T02:30", "2030-11-03T01:30"])("fails closed on invalid or ambiguous local time %s", local => {
    expect(() => quickWebinarSchedule(local, "America/New_York", 600, new Date("2029-01-01"))).toThrow("schedule_invalid");
  });
  it("rejects starts in the past and unsupported timezones", () => {
    expect(() => quickWebinarSchedule("2020-01-01T10:00", "Asia/Taipei", 600)).toThrow("schedule_invalid");
    expect(() => quickWebinarSchedule("2030-01-01T10:00", "invalid/zone", 600)).toThrow("schedule_invalid");
  });
  it("rejects extra caller fields rather than accepting caller-owned tenant/end-time facts", () => {
    expect(QuickWebinarInputSchema.safeParse({ requestId: "12345678-1234-4123-8123-123456789abc", videoId: "video", startsAtLocal: "2030-08-01T10:00", title: "", vendorId: "foreign" }).success).toBe(false);
  });
});
