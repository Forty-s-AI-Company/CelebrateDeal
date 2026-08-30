export type Announcement = {
  id: string;
  version: string;
  publishedAt: string;
  title: string;
  summary: string;
  progressPercent: number;
  completed: readonly string[];
  incomplete: readonly string[];
  changes: readonly string[];
  nextSteps: readonly string[];
};

export type AnnouncementSuppression = {
  version: string;
  localDate: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const ANNOUNCEMENT_SUPPRESSION_STORAGE_KEY =
  "celebratedeal.announcement-center.suppression.v1";

/**
 * 進站公告的唯一靜態來源。98% 是本階段估算；本機一條龍已驗收，正式金流與 staging 仍不在本次範圍。
 */
export const ANNOUNCEMENT_FEED: readonly Announcement[] = [
  {
    id: "goal-progress-2026-08-19-v13",
    version: "2026-08-19-v13",
    publishedAt: "2026-08-19",
    title: "一條龍研討會本機驗收更新",
    summary: "本機一條龍進度 98%：已用隔離 PostgreSQL 與系統 Chrome 實際通過報名、驗證信、直播、排程互動、商品浮窗、持續播放器、內部待付款訂單與課後通知；Vercel 今日額度已滿，本次不部署 staging。",
    progressPercent: 98,
    completed: [
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
      "隔離 PostgreSQL 套用 57/57 migrations 後，WP7 Playwright 以系統 Chrome 實際通過 2/2；包含手機 RWD 與 axe blocking 檢查。",
      "結帳頁播放器背景與影片不再攔截表單點擊，控制列仍可操作；最新消息浮動按鈕會避開直播播放器與商品浮窗。",
      "production build 已通過 TypeScript、108 個靜態頁面、build traces 與頁面最佳化。",
    ],
    incomplete: [
      "Vercel 今日額度已滿，本次變更尚未推送或部署 staging。",
      "正式寄信服務、Cloudflare Live Input 與外部媒體服務仍需 staging 沙盒驗證；本輪使用合成 Email／媒體資料。",
      "正式金流仍排除於本階段驗證。",
    ],
    changes: [
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
      "修正非 public schema 使用 pg_trgm 時的隔離資料庫 migration runner，避免 operator class 找不到。",
      "補上本機 loopback Host origin allowlist，保留 forwarded host 不可信的安全邊界。",
      "修正播放器控制尺寸與浮動公告／商品浮窗的觸控區重疊，並讓結帳播放器背景穿透表單點擊。",
    ],
    nextSteps: [
      "Vercel 額度恢復且取得授權後，部署 staging，使用測試信箱與 staging 媒體服務驗證外部流程。",
      "staging 驗收通過後，再決定正式寄信、Live Input 與正式金流的上線設定。",
    ],
  },
  {
    id: "goal-progress-2026-08-18-v5",
    version: "2026-08-18-v5",
    publishedAt: "2026-08-18",
    title: "目前 Goal 進度更新",
    summary: "本階段估算 95%：本機完整一條龍 E2E 已通過並部署 staging，現在等待使用者線上驗收報名、直播互動、持續播放器與結帳體驗。",
    progressPercent: 95,
    completed: [
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
    ],
    incomplete: [
      "使用者 staging 線上驗收尚未完成。",
      "Hobby staging 尚未註冊每分鐘 Cron；endpoint 可人工觸發，尚不宣稱自動執行。",
      "正式金流仍排除於本階段驗證。",
    ],
    changes: [
      "Email 冪等／legacy cutover／lifecycle 已納入目前里程碑。",
      "公告視窗已提供進站最新消息與版本抑制。",
      "固定 staging 已更新。",
      "商品表單新增最多 10 個自訂結帳欄位，可新增、刪除、排序與設定必填／選項。",
      "同一防重送識別若答案不同會拒絕舊訂單重播，避免畫面與訂單資料不一致。",
      "播放器改由根 layout 持有，切到內部結帳頁時不會重建媒體節點。",
      "新增 WP7 一條龍 disposable PostgreSQL＋Playwright 驗收與可稽核 receipt。",
      "固定 staging 最新消息更新為 95%，並列出本次完成、未完成與下一步。",
    ],
    nextSteps: [
      "等待使用者驗證 staging 的報名、直播、浮窗與結帳體驗。",
      "go-live 前決定採用 Pro 或外部 scheduler。",
    ],
  },
];

export function sortAnnouncements(announcements: readonly Announcement[]) {
  return [...announcements].sort((left, right) => {
    const dateOrder = right.publishedAt.localeCompare(left.publishedAt);
    return dateOrder || right.version.localeCompare(left.version);
  });
}

export function getLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatAnnouncementDate(publishedAt: string) {
  const [year, month, day] = publishedAt.split("-");
  return year && month && day ? `${year}/${month}/${day}` : publishedAt;
}

function isSuppressionRecord(value: unknown): value is AnnouncementSuppression {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2
    && typeof record.version === "string"
    && record.version.length > 0
    && typeof record.localDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(record.localDate)
  );
}

export function parseSuppression(value: string | null) {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    return isSuppressionRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function shouldShowAnnouncement(
  suppression: AnnouncementSuppression | null,
  version: string,
  localDate: string,
) {
  return !suppression || suppression.version !== version || suppression.localDate !== localDate;
}

export function readSuppression(
  storage: StorageLike | null | undefined,
  version: string,
  localDate: string,
) {
  try {
    const value = storage?.getItem(ANNOUNCEMENT_SUPPRESSION_STORAGE_KEY) ?? null;
    return shouldShowAnnouncement(parseSuppression(value), version, localDate);
  } catch {
    // localStorage can be disabled, unavailable in private mode, or throw from a proxy.
    return true;
  }
}

export function writeSuppression(
  storage: StorageLike | null | undefined,
  version: string,
  localDate: string,
) {
  try {
    storage?.setItem(
      ANNOUNCEMENT_SUPPRESSION_STORAGE_KEY,
      JSON.stringify({ version, localDate }),
    );
  } catch {
    // Suppression is a convenience only; a storage failure must fail open next visit.
  }
}
