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
 * 進站公告的唯一靜態來源。進度沿用目前 Goal 的 canonical readiness 75.5，
 * 以整數 76% 呈現；未通過驗證的 staging／完整 E2E 不在 completed 內。
 */
export const ANNOUNCEMENT_FEED: readonly Announcement[] = [
  {
    id: "goal-progress-2026-08-18",
    version: "2026-08-18-v1",
    publishedAt: "2026-08-18",
    title: "目前 Goal 進度更新",
    summary: "核心報名、觀看、商品浮窗與播放器已完成；Email 排程仍在修正。",
    progressPercent: 76,
    completed: [
      "核心報名流程已完成。",
      "觀看流程已完成。",
      "商品浮窗已完成。",
      "播放器已完成。",
    ],
    incomplete: [
      "Email 排程正在修正，尚未宣稱整體 Email 工作完成。",
      "自訂結帳欄位尚未完成。",
      "完整 E2E 尚未完成。",
      "staging 驗證尚待完成。",
    ],
    changes: [
      "這次公告中心會在進站時提醒最新 Goal 狀態。",
      "公告內容明確分開已完成項目與仍待驗證項目。",
    ],
    nextSteps: [
      "完成 Email 排程修正並補上對應回歸證據。",
      "完成自訂結帳欄位。",
      "補齊完整 E2E 後，再進行 staging 驗證。",
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
