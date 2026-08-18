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
    expect(ANNOUNCEMENT_FEED).toHaveLength(1);
    const [latest] = ANNOUNCEMENT_FEED;
    expect(latest.id).toBe("goal-progress-2026-08-18-v5");
    expect(latest.version).toBe("2026-08-18-v5");
    expect(latest.summary).toContain("本階段估算 95%");
    expect(latest.progressPercent).toBe(95);
    expect(latest.progressPercent).toBeGreaterThanOrEqual(0);
    expect(latest.progressPercent).toBeLessThanOrEqual(100);
    expect(latest.completed).toEqual(expect.arrayContaining([
      "核心報名流程已完成。",
      "觀看流程已完成。",
      "商品浮窗已完成。",
      "播放器已完成。",
      "Email 3/3/8 設定與 before/during/post 排程已通過 unit + DB 驗證。",
      "公告中心 Playwright 7/7 已通過。",
      "staging Preview READY，health/database check 已通過。",
      "商品自訂結帳欄位已完成：支援友善編輯、前台填寫、後端驗證、加密答案與訂單快照。",
      "自訂欄位 migration 已在 disposable PostgreSQL 完成 57/57 套用與清理驗證。",
      "完整一條龍 production-mode E2E 已通過，包含報名、Email 驗證、直播、指定秒數互動、商品浮窗、結帳與課後信。",
      "內部結帳跨頁維持同一個播放器節點，直接開啟結帳頁則不會顯示不存在的直播。",
      "固定 staging 已更新至本次 WP7 一條龍里程碑，登入頁、健康檢查與最新消息視窗已通過線上 smoke。",
    ]));
    expect(latest.incomplete).toEqual(expect.arrayContaining([
      "使用者 staging 線上驗收尚未完成。",
      "Hobby staging 尚未註冊每分鐘 Cron；endpoint 可人工觸發，尚不宣稱自動執行。",
      "正式金流仍排除於本階段驗證。",
    ]));
    expect(latest.changes).toEqual(expect.arrayContaining([
      "Email 冪等／legacy cutover／lifecycle 已納入目前里程碑。",
      "公告視窗已提供進站最新消息與版本抑制。",
      "固定 staging 已更新。",
      "商品表單新增最多 10 個自訂結帳欄位，可新增、刪除、排序與設定必填／選項。",
      "同一防重送識別若答案不同會拒絕舊訂單重播，避免畫面與訂單資料不一致。",
      "播放器改由根 layout 持有，切到內部結帳頁時不會重建媒體節點。",
      "新增 WP7 一條龍 disposable PostgreSQL＋Playwright 驗收與可稽核 receipt。",
      "固定 staging 最新消息更新為 95%，並列出本次完成、未完成與下一步。",
    ]));
    expect(latest.nextSteps).toEqual(expect.arrayContaining([
      "等待使用者驗證 staging 的報名、直播、浮窗與結帳體驗。",
      "go-live 前決定採用 Pro 或外部 scheduler。",
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
