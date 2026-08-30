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
    expect(ANNOUNCEMENT_FEED).toHaveLength(2);
    const [latest] = ANNOUNCEMENT_FEED;
    expect(latest.id).toBe("goal-progress-2026-08-19-v13");
    expect(latest.version).toBe("2026-08-19-v13");
    expect(latest.summary).toContain("本機一條龍進度 98%");
    expect(latest.progressPercent).toBe(98);
    expect(latest.progressPercent).toBeGreaterThanOrEqual(0);
    expect(latest.progressPercent).toBeLessThanOrEqual(100);
    expect(latest.completed).toEqual(expect.arrayContaining([
      "Email 模板可安全插入直播入口，驗證成功、開播提醒與課後通知都使用正確的公開直播網址。",
      "即使商家在報名成功模板漏放直播網址，系統仍會在驗證完成後自動補上直播入口，不讓觀眾卡在信件裡。",
      "寄送紀錄已可篩選並辨識課後通知，保留收件遮罩、退訂、黑名單與人工重排保護。",
      "商品只有在排程商品浮窗到達指定秒數後才會出現；先前不顯示商品入口或商品清單。",
      "素材後台已驗證上傳優先：商品圖、影片與縮圖支援預覽、進度、暫停、重試與大型影片續傳；URL 僅保留於進階設定。",
      "富文字編輯器已用於報名頁與 Email 模板，可插入允許的變數並提供安全預覽。",
      "一般觀眾型的排程角色在前台會維持一般觀眾外觀；來源僅在後台、匯出與分析中標示，不計入真實互動數據。",
      "直播分析已分開顯示報名、Email 驗證、待付款訂單與 Email 寄送成功／失敗；訂單只接受伺服器驗證過的直播來源，不猜測或污染數據。",
      "production build 會先檢查 CRON、CSRF 與直播入口密鑰；避免編譯成功後才在登入頁或直播入口發生 500。",
      "GitHub Actions 的測試用環境已補齊 Cron、CSRF 與直播入口密鑰，push 時的 lint、型別、測試與 build 不會因缺少測試設定而提早停止。",
      "WP7 一條龍瀏覽器測試使用獨立的合成 Cron、CSRF 與直播入口密鑰，不讀取開發者或線上環境設定。",
    ]));
    expect(latest.incomplete).toEqual(expect.arrayContaining([
      "Vercel 今日額度已滿，本次變更尚未推送或部署 staging。",
      "正式寄信服務、Cloudflare Live Input 與外部媒體服務仍需 staging 沙盒驗證；本輪使用合成 Email／媒體資料。",
      "正式金流仍排除於本階段驗證。",
    ]));
    expect(latest.changes).toEqual(expect.arrayContaining([
      "新增直播網址變數與信件富文字安全轉譯，避免收件者拿到無法進入直播的通知。",
      "補上報名成功信的直播入口保底，模板忘記插入變數時也不會遺漏觀看連結。",
      "修正 CI synthetic 環境缺少 CRON_SECRET，讓既有的 push 品質流程可走過 production build 預檢。",
      "新增課後通知寄送紀錄篩選與畫面標籤。",
      "修正定時商品浮窗前仍可從商品分頁提前看到商品的問題。",
      "補齊手機版商品浮窗驗收斷言：商品入口只會在觸發後出現。",
      "移除一般觀眾型排程留言的前台腳本標籤，保留官方角色的官方外觀與營運端來源辨識。",
      "結帳建立待付款訂單時，會從伺服器驗證的報名 cookie 取得直播來源；分析面板新增報名、驗證、訂單與 Email 成功／失敗指標。",
      "修正 build preflight 未以 production 規則檢查的缺口；現在會在產物建立前擋住會導致登入頁 500 的缺失密鑰。",
      "修正 WP7 commerce browser runner 漏帶 production runtime 密鑰的問題，Docker 恢復後可直接執行完整主線驗收。",
    ]));
    expect(latest.nextSteps).toEqual(expect.arrayContaining([
      "Vercel 額度恢復且取得授權後，部署 staging，使用測試信箱與 staging 媒體服務驗證外部流程。",
      "staging 驗收通過後，再決定正式寄信、Live Input 與正式金流的上線設定。",
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
