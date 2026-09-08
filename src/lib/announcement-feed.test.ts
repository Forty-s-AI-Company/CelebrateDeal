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
  it("keeps the canonical feed truthful and bounded", () => {
    expect(ANNOUNCEMENT_FEED).toHaveLength(3);
    const [latest] = ANNOUNCEMENT_FEED;
    expect(latest.id).toBe("goal-progress-2026-09-09-v14");
    expect(latest.version).toBe("2026-09-09-v14");
    expect(latest.summary).toContain("全生命週期 webinar funnel");
    expect(latest.progressPercent).toBe(100);
    expect(latest.progressPercent).toBeGreaterThanOrEqual(0);
    expect(latest.progressPercent).toBeLessThanOrEqual(100);
    expect(latest.completed).toEqual(expect.arrayContaining([
      "Webinar funnel 已串起 evergreen、automation、CRM、報名、互動與課後流程。",
      "LINE 官方帳號登入、通知綁定與 6 格 Rich Menu studio 已完成。",
      "學生入口支援 passwordless magic link、課程交付與發票檢視。",
      "ECPay provider adapter 已加入 CheckMacValue 驗證與 webhook 流程。",
      "Ultimate 12-step golden journey 已納入本機驗收與可追蹤測試。",
    ]));
    expect(latest.incomplete).toEqual(expect.arrayContaining([
      "正式 staging、LINE provider、寄信服務與外部媒體仍需沙盒驗證。",
      "正式金流與 production deployment 仍需獨立授權與 release gate。",
    ]));
    expect(latest.changes).toEqual(expect.arrayContaining([
      "新增 LINE 通知 delivery binding 與 Rich Menu 編輯流程。",
      "新增學生 passwordless 入口、交付內容與 invoice viewer。",
      "補上 webinar funnel 的 evergreen、automation 與 CRM lifecycle。",
      "新增 ECPay CheckMacValue 與付款 webhook adapter。",
      "補上最新 12 步驟 golden journey 驗收案例。",
    ]));
    expect(latest.nextSteps).toEqual(expect.arrayContaining([
      "在 staging 以測試帳號驗證 LINE、Email、媒體與付款 sandbox 的端到端流程。",
      "staging 通過後，再安排 production release review。",
    ]));
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
