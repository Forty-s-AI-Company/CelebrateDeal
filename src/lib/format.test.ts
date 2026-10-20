import { describe, expect, it } from "vitest";
import { formatCurrency, formatDateTime, formatTimeZoneLabel, toSlug } from "./format";

describe("format helpers", () => {
  it("formats TWD without fractional digits", () => {
    expect(formatCurrency(168000, "TWD")).toContain("1,680");
  });

  it("creates URL-safe slugs while keeping Chinese words", () => {
    expect(toSlug(" 夏季 新品 Live!! ")).toBe("夏季-新品-live");
  });

  it("formats date-times in Taipei time regardless of the runtime time zone", () => {
    // 12:00 UTC 就是台灣 20:00；講師排 20:00 的場次不能在列表顯示 12:00。
    expect(formatDateTime("2026-11-01T12:00:00.000Z")).toContain("晚上8:00");
    expect(formatDateTime(new Date("2026-11-01T12:00:00.000Z"))).toContain("晚上8:00");
    expect(formatDateTime("2026-11-01T12:00:00.000Z", "UTC")).toContain("中午12:00");
  });

  it("labels the default zone as Taiwan time and keeps other zones as IANA names", () => {
    expect(formatTimeZoneLabel("Asia/Taipei")).toBe("台灣時間");
    expect(formatTimeZoneLabel("America/New_York")).toBe("America/New_York");
  });
});
