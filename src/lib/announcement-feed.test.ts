import { describe, expect, it, vi } from "vitest";
import {
  ANNOUNCEMENT_FEED,
  ANNOUNCEMENT_SUPPRESSION_STORAGE_KEY,
  getLocalDate,
  parseSuppression,
  readSuppression,
  sortAnnouncements,
  writeSuppression,
} from "./announcement-feed";

describe("announcement feed", () => {
  it("shows an honest current staging status and labels earlier estimates as history", () => {
    expect(ANNOUNCEMENT_FEED).toHaveLength(3);
    const [latest, ...history] = ANNOUNCEMENT_FEED;
    expect(latest).toMatchObject({
      id: "staging-validation-2026-09-26-v1",
      version: "2026-09-26-v1",
      publishedAt: "2026-09-26",
      progressPercent: null,
    });
    expect(latest.summary).toContain("尚未驗收完成");
    expect(latest.incomplete).toEqual(expect.arrayContaining([
      expect.stringContaining("Dashboard 明細"),
      expect.stringContaining("沙盒驗證"),
    ]));
    expect(history.every((item) => item.title.startsWith("歷史紀錄：")
      && item.summary.includes("不代表目前 staging 驗收"))).toBe(true);
    expect(history.map((item) => item.progressPercent)).toEqual([98, 95]);
  });

  it("sorts announcements from newest to oldest without mutating the feed", () => {
    const older = { ...ANNOUNCEMENT_FEED[0], id: "older", version: "2026-08-01-v1", publishedAt: "2026-08-01" };
    const input = [older, ANNOUNCEMENT_FEED[0]];
    expect(sortAnnouncements(input).map(({ id }) => id)).toEqual([
      ANNOUNCEMENT_FEED[0].id,
      "older",
    ]);
    expect(input[0].id).toBe("older");
  });

  it("uses the browser-local calendar date", () => {
    expect(getLocalDate(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
    expect(getLocalDate(new Date(2026, 8, 8))).toBe("2026-09-08");
  });

  it("only accepts the exact two-field suppression shape", () => {
    expect(parseSuppression(JSON.stringify({ version: "v1", localDate: "2026-08-18" }))).toEqual({
      version: "v1",
      localDate: "2026-08-18",
    });
    expect(parseSuppression(JSON.stringify({ version: "v1", localDate: "2026-08-18", extra: true }))).toBeNull();
    expect(parseSuppression("not-json")).toBeNull();
  });

  it("fails open when suppression storage is broken and writes only version/date", () => {
    const brokenStorage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
    };
    expect(readSuppression(brokenStorage, "v1", "2026-08-18")).toBe(true);
    expect(() => writeSuppression(brokenStorage, "v1", "2026-08-18")).not.toThrow();

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    writeSuppression(storage, "v1", "2026-08-18");
    expect(values.get(ANNOUNCEMENT_SUPPRESSION_STORAGE_KEY)).toBe(
      JSON.stringify({ version: "v1", localDate: "2026-08-18" }),
    );
    expect(readSuppression(storage, "v1", "2026-08-18")).toBe(false);
    expect(readSuppression(storage, "v2", "2026-08-18")).toBe(true);
    expect(readSuppression(storage, "v1", "2026-08-19")).toBe(true);
  });
});
