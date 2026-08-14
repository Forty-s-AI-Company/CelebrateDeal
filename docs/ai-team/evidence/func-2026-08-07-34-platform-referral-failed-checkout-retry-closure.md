# FUNC-2026-08-07-34 — Platform referral failed-checkout retry closure

## 發現與修正

本 WP 找到一個真實的販售流程 P1：平台方案 checkout 在 provider session 建立失敗，或收到 provider `failed` webhook 時，原本會留下尚未付款的 `PlatformReferralAttribution` snapshot。買家使用同一個推薦點擊重試時，該 click 仍被舊失敗訂閱佔用，可能因唯一鍵衝突而無法重新開始 checkout。

修正範圍：

- `src/app/(app)/billing/plans/actions.ts`：checkout setup／metadata persistence 失敗時，在同一個 transaction 將 pending payment transaction 標為 failed、釋放該 pending subscription 的 referral snapshot，再標記 subscription 為 `payment_failed`。
- `src/lib/payment-webhooks.ts`：provider `failed` callback 僅釋放仍為 `pending_payment` 的 subscription snapshot；已付款或已產生 accounting history 的 attribution 不會被刪除。
- 測試補強 provider checkout setup failure 的 retry-release、failed payment webhook 的 pending subscription／attribution regression，以及 synthetic referral fixture cleanup。

這保留了「付款成功前不產生 commission」與「成功 attribution snapshot 不可變身分」的邊界；沒有放寬 assertion、unique constraint 或付款驗證。

## 驗證證據

- Billing plan action suite：10/10 PASS。
- 針對 failed webhook 的本機單測：1/1 PASS。
- 本機 `payment-webhooks.test.ts`：37/40 PASS；3 個 failure 中 2 個是既有本機 dev database 缺少 FIN-29 `disputeCaseId` schema，未採為 product evidence，另 1 個是本 WP 初次暴露的 synthetic referral fixture cleanup，已修正並由後續 targeted test 驗證。
- Corrected disposable PostgreSQL：container `celebratedeal-func34b`、database `celebratedeal_test`、28/28 migrations applied；四個關聯 suite 共 61/61 PASS；cleanup PASS，無 residual container。
- `npm run typecheck`、四個 touched source/test file 的 scoped ESLint、`git diff --check`：PASS。
- 未在本 WP 重跑 global coverage；最近 authoritative global coverage 仍為 statements 42.36%、branches 48.07%、functions 51.11%、lines 61.68%，對既有 threshold 63/57/60/65 的 `FAIL_REMAINING_SOURCE_INVENTORY`。coverage gate 沒有阻擋這次功能修正。

## 分數與安全邊界

- canonical total：73.5；CAT04 6.0、CAT10 4.5；`current_goal_score_change=0`。
- 本 WP 是 local product closure，不足以預支 CAT04 的 staging／PayUni Sandbox provider receipt，也不足以預支 CAT10 的真人 owner／external monitoring evidence。
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- 未操作 Production、正式 DB、正式付款／退款、寄信、deployment、push、merge；未讀取 secrets；未重試 FIN-08AA、WP-196、WP-197 或任何 terminal external command。

## 回滾

回滾範圍僅為本 WP 的兩個 product source hunks、測試補強與本 WP evidence metadata；沒有 migration 或外部副作用。disposable container 已清除。
