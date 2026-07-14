import { describe, expect, it } from "vitest";
import { formatLiveCountdown } from "./live-countdown";

describe("formatLiveCountdown", () => {
  const now = new Date("2026-07-15T08:00:00.000Z");

  it("formats the remaining time for a future live", () => {
    const scheduledAt = new Date("2026-07-16T10:05:00.000Z");

    expect(formatLiveCountdown(scheduledAt, now)).toBe("1 天 2 小時 5 分鐘");
  });

  it("reports a live as started when its scheduled time has arrived or passed", () => {
    expect(formatLiveCountdown(now, now)).toBe("已開始");
    expect(formatLiveCountdown("2026-07-15T07:59:59.000Z", now)).toBe("已開始");
  });

  it("returns null for an invalid scheduled or reference time", () => {
    expect(formatLiveCountdown("not-a-date", now)).toBeNull();
    expect(formatLiveCountdown(now, "not-a-date")).toBeNull();
  });
});
