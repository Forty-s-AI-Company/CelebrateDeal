// 政策生效日與狀態判斷。獨立成小模組，讓結帳等 client 元件不必打包三份政策全文。
export const policyCenterPublication = {
  version: "2026.10.18",
  effectiveDate: "2026-11-01",
  effectiveDateLabel: "2026 年 11 月 1 日",
} as const;

export type PolicyPublicationStatus = "scheduled" | "published";

const TAIPEI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 以台灣時間（Asia/Taipei，UTC+8）的日期判斷：到達生效日（含當天）即為已生效。 */
export function resolvePolicyStatus(effectiveDate: string, now: Date = new Date()): PolicyPublicationStatus {
  const taipeiToday = new Date(now.getTime() + TAIPEI_UTC_OFFSET_MS).toISOString().slice(0, 10);
  return taipeiToday >= effectiveDate ? "published" : "scheduled";
}

