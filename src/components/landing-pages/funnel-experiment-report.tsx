import type { FunnelReports } from "@/lib/funnel-operations-service";
import { experimentArmLabels } from "./funnel-display-labels";

/** 僅呈現既有歸因紀錄，不據此自動選定勝出組別或變更驗證資格。 */
export function FunnelExperimentReport({ rows }: { rows: FunnelReports["experiments"] }) {
  return <section aria-label="A/B 二次確認統計" className="mt-4 space-y-2 text-sm">
    <h3 className="font-semibold">A/B 二次確認統計</h3>
    <p>以下涵蓋整個網站的實驗，沿用已儲存的最近天數，不受步驟篩選影響。瀏覽依瀏覽時間、報名依報名時間計入；瀏覽包含重新整理。</p>
    <p>已確認筆數是這段期間報名者目前的 Email 確認狀態，可能包含期間結束後的確認；不是期間內完成確認的人數。資料上限與上方統計相同。這些筆數不代表到場、觀看或轉換提升。</p>
    {rows.length ? rows.map((row) => <p key={`${row.id}-${row.arm}`} className="break-all">
      實驗 {row.id} · {row.arm === "control" || row.arm === "variant" ? experimentArmLabels[row.arm] : "未知組別"} · 瀏覽次數 {row.pageViews} · 報名筆數 {row.submissions} · 目前已確認筆數 {row.verifiedSubmissions}
    </p>) : <p>此範圍尚無可歸因至實驗的紀錄。</p>}
  </section>;
}
