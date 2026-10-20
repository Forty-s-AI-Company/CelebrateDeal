import { describe, expect, it } from "vitest";
import { STATUS_LABELS, statusLabel } from "./status-labels";

describe("statusLabel", () => {
  it("translates live statuses to Traditional Chinese", () => {
    expect(statusLabel("live", "draft")).toBe("草稿");
    expect(statusLabel("live", "scheduled")).toBe("已排程");
    expect(statusLabel("live", "live")).toBe("直播中");
    expect(statusLabel("live", "ended")).toBe("已結束");
    expect(statusLabel("streamMode", "vod")).toContain("VOD");
  });

  it("never exposes raw English values and has a neutral fallback", () => {
    for (const [kind, table] of Object.entries(STATUS_LABELS)) {
      for (const [value, label] of Object.entries(table)) {
        expect(label).toMatch(/[一-鿿]/u);
        expect(statusLabel(kind as keyof typeof STATUS_LABELS, value)).toBe(label);
      }
    }
    expect(statusLabel("live", "weird_state")).toBe("未知狀態");
    expect(statusLabel("live", null)).toBe("—");
  });
});
