# FUNC-2026-08-07-35 — Platform referral direct-entry／readonly UI closure

## 發現與修正

本 WP 關閉方案推薦的真實 P1：使用者從 `/r/[code]` 進入後，platform referral cookie 可能在之後的直接 `/billing/plans` 入口被沿用；同時方案頁沒有顯示目前推薦人，買家無法知道本次訂單是否會歸因給誰。

修正範圍：

- 官方推薦入口現在導向 `/billing/plans?referral=1`，並使用 server-created click 的 HttpOnly cookie。
- 方案頁只有在明確 referral context、目前 cookie 與資料庫 click 一致且 click 未過期／code 仍 active 時，才顯示推薦人 ID、名稱、`已記錄` 狀態，並帶入唯讀 hidden click context。
- 直接進入方案網址不讀取舊 platform referral cookie，顯示「未記錄推薦人」與重新點擊官方連結的提示；client reset route 會清除 team 與 platform attribution cookie。
- 付款 server action 只在表單 click context 與 HttpOnly cookie 相同，且後續由資料庫驗證 click 時才建立 attribution；直接進入或 forged context 不會繼承舊推薦人。
- 方案 checkout redirect 保留明確 referral context，讓結帳頁繼續顯示同一個 readonly attribution 狀態。

## 驗證證據

- 本機 route／page／action focused suite：6 files／53 tests PASS。
- Direct-entry reset component：2/2 PASS。
- Corrected disposable PostgreSQL：container `celebratedeal-func35b`、database `celebratedeal_test`、28/28 migrations applied；route、direct-entry、billing action/page、platform referral domain、payment webhook 共 7 files／70 tests PASS；cleanup PASS，無 residual container。
- `npm run typecheck`、touched source/test scoped ESLint、`git diff --check`：PASS。
- 未在本 WP 重跑 global coverage；最近 authoritative global coverage 仍為 statements 42.36%、branches 48.07%、functions 51.11%、lines 61.68%，對 threshold 63/57/60/65 的 `FAIL_REMAINING_SOURCE_INVENTORY`。未降低 threshold、exclude、inventory、skip 或 assertion，coverage 沒有阻擋功能驗證。

## 分數與安全邊界

- canonical total：73.5；CAT04 6.0、CAT10 4.5；`current_goal_score_change=0`。
- 這是 local product closure，不預支 CAT04 staging／PayUni Sandbox receipt，也不預支 CAT10 真人 owner／external monitoring evidence。
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- 未操作 Production、正式 DB、正式付款／退款、寄信、deployment、push、merge；未讀取 secrets；未重試 FIN-08AA、WP-196、WP-197 或任何 terminal external command。

## 回滾

回滾範圍僅為本 WP 的 referral route、direct-entry reset、方案 page/action、platform referral helper、component/test 與 evidence metadata；沒有 migration 或外部副作用。disposable container 已清除。
