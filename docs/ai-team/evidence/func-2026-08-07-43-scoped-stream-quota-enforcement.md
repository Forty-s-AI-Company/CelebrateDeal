# FUNC-2026-08-07-43｜Per-member／per-page Stream quota enforcement

## 結果

完成 B16 的核心產品功能。直播規則現在可設定成員與推廣頁的 Stream 月分鐘上限；伺服器在寫入 immutable usage ledger 前，會依本場直播、本月、成員 allocation seconds 與推廣頁 watch seconds 做 fail-closed 檢查。上限跨越時沿用安全 429，不會自動扣款或靜默轉嫁給 owner。

使用量頁新增 80% 與 100% 的 deterministic in-app notification，提醒付款人與相關成員。這是產品內通知，尚未宣稱 email／push 或 payment provider notification 已完成。

## 實作範圍

- `src/lib/live-quota-policy.ts`
  - 解析、去重與範圍驗證 `memberQuotas`／`pageQuotas`。
  - 舊 policy 沒有這兩個欄位時仍使用空陣列，保留相容行為。
- `src/app/actions.ts`
  - 儲存直播規則前驗證成員與推廣頁都屬於目前 vendor。
- `src/lib/stream-usage.ts`
  - member quota 以 allocation ledger seconds 計算。
  - page quota 以同一 live／月份的 immutable watch seconds 計算。
  - Serializable transaction 遇到 concurrency conflict 時 fail closed。
- `src/lib/stream-quota.ts`
  - 提供 scoped quota enforcement 與 80%／100% notification decision helper。
- 直播建立／編輯頁
  - 提供 member／page quota JSON 設定欄位與限制說明。
- billing usage page
  - 顯示 deterministic in-app quota notification。

## 驗證

- quota、billing、admission、action、component regression：11 files／227 tests，227 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- schema／migration：沒有變更；沒有執行 migration。
- staging／PayUni／Production：全部未接觸。

## 分數與限制

- readiness truth：PASS；canonical total 仍為 73.5。
- CAT04=6.0、CAT10=4.5；sandbox_ready=false、production_ready=false；current Goal score change=0。
- payment method reference、auto-charge、email／push notification、provider failure retry、grace period、停用與 fallback policy 仍未完成，本輪不把 B19 宣稱完成。
- Global coverage 本輪未重跑。最新 authoritative pre-package baseline 是 QUAL-2026-08-07-30 的 statements／branches／functions／lines 42.53／48.19／51.34／61.86 對 63／57／60／65，exit 1 `FAIL_REMAINING_SOURCE_INVENTORY`；這不是本輪 current-tree coverage。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、正式資料或付款資料；沒有 staging、PayUni、Production、部署、push 或 merge，也沒有重試 FIN-08AA、WP-196、WP-197。

下一個產品工作是 payment method reference 與 provider adapter 的 sandbox-safe contract；只有具備真實授權與 sandbox receipt 後，才會處理 CAT04 分數更新。
