import { describe, expect, it } from "vitest";
import {
  assertIanaTimeZone,
  formatZonedDateTimeLocal,
  parseZonedDateTimeLocal,
  ZonedDateTimeError,
} from "./zoned-date-time";

describe("zoned date-time helpers", () => {
  it("parses a Taipei wall time into the corresponding UTC instant", () => {
    expect(parseZonedDateTimeLocal("2026-08-20T20:00", "Asia/Taipei")).toEqual(
      new Date(Date.UTC(2026, 7, 20, 12, 0)),
    );
  });

  it("handles New York summer and winter offsets without using the host timezone", () => {
    expect(parseZonedDateTimeLocal("2026-07-01T12:00", "America/New_York")).toEqual(
      new Date(Date.UTC(2026, 6, 1, 16, 0)),
    );
    expect(parseZonedDateTimeLocal("2026-01-15T12:00", "America/New_York")).toEqual(
      new Date(Date.UTC(2026, 0, 15, 17, 0)),
    );
  });

  it("formats a UTC instant back to the merchant local input value", () => {
    expect(formatZonedDateTimeLocal(new Date(Date.UTC(2026, 7, 20, 12, 0)), "Asia/Taipei"))
      .toBe("2026-08-20T20:00");
    expect(formatZonedDateTimeLocal(new Date(Date.UTC(2026, 6, 1, 16, 0)), "America/New_York"))
      .toBe("2026-07-01T12:00");
  });

  it("preserves a valid parse and format round trip", () => {
    const localValue = "2026-11-10T09:45";
    const utcValue = parseZonedDateTimeLocal(localValue, "Asia/Taipei");

    expect(formatZonedDateTimeLocal(utcValue, "Asia/Taipei")).toBe(localValue);
  });

  it("fails closed for malformed dates and unsupported IANA zones", () => {
    expect(() => parseZonedDateTimeLocal("2026-8-20T20:00", "Asia/Taipei")).toThrowError(
      expect.objectContaining({ code: "invalid_local_time" }),
    );
    expect(() => parseZonedDateTimeLocal("2026-02-30T20:00", "Asia/Taipei")).toThrowError(
      expect.objectContaining({ code: "invalid_local_time" }),
    );
    expect(() => assertIanaTimeZone("Mars/Olympus_Mons")).toThrowError(
      expect.objectContaining({ code: "invalid_timezone" }),
    );
  });

  it("rejects a DST spring-forward gap", () => {
    try {
      parseZonedDateTimeLocal("2026-03-08T02:30", "America/New_York");
      throw new Error("expected a DST gap error");
    } catch (error) {
      expect(error).toBeInstanceOf(ZonedDateTimeError);
      expect(error).toMatchObject({ code: "nonexistent_local_time" });
    }
  });

  it("rejects a DST autumn overlap instead of guessing an offset", () => {
    expect(() => parseZonedDateTimeLocal("2026-11-01T01:30", "America/New_York")).toThrowError(
      expect.objectContaining({ code: "ambiguous_local_time" }),
    );
  });
});
