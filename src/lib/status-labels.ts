// 集中式狀態中文對照（F-106）。畫面一律透過 statusLabel 顯示，不直接輸出資料庫原始值。
export const STATUS_LABELS = {
  live: { draft: "草稿", scheduled: "已排程", live: "直播中", ended: "已結束", archived: "已封存" },
  streamMode: { live: "即時直播", vod: "預錄影片（VOD）", simulive: "擬真直播" },
  script: { draft: "草稿", published: "已發布", archived: "已封存" },
  video: { ready: "可使用", processing: "處理中", archived: "已封存", failed: "處理失敗" },
  consultationBooking: { scheduled: "已預約", completed: "已完成", cancelled: "已取消", no_show: "未出席" },
  teamMember: { active: "啟用中", inactive: "已停用", invited: "已邀請", suspended: "已停權" },
} as const;

export type StatusKind = keyof typeof STATUS_LABELS;

/** 找不到對照時回傳「未知狀態」而不是洩漏內部原始值。 */
export function statusLabel(kind: StatusKind, value: string | null | undefined): string {
  if (!value) return "—";
  const table = STATUS_LABELS[kind] as Record<string, string>;
  return table[value] ?? table[value.toLowerCase()] ?? "未知狀態";
}
