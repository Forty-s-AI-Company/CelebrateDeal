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
 * 進站公告的唯一靜態來源。94% 是本階段估算，不代表正式金流或使用者 staging 驗收已完成。
 */
export const ANNOUNCEMENT_FEED: readonly Announcement[] = [
  {
    id: "goal-progress-2026-08-18-v4",
    version: "2026-08-18-v4",
    publishedAt: "2026-08-18",
    title: "目前 Goal 進度更新",
    summary: "本階段估算 94%：本機完整一條龍 E2E 已通過，包含報名驗證、直播互動、商品浮窗、持續播放器、待付款訂單與課後信入列。",
    progressPercent: 94,
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
    ],
    incomplete: [
      "staging 部署與使用者線上驗收尚未完成。",
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
    ],
    nextSteps: [
      "部署目前里程碑到固定 staging。",
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
