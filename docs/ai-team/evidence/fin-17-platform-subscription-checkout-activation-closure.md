# FIN-17 — Platform subscription pending checkout 與 trusted activation closure

日期：2026-08-07  
結果：`COMPLETE_LOCAL_PLATFORM_SUBSCRIPTION_CHECKOUT`；這是本機付款 initiation／callback state transition 證據，不是 PayUni Sandbox、Production、外部出款或人工 release 證據。

## 完成範圍

- 方案選擇現在先建立 `pending_payment` `VendorSubscription`，再建立 server-created pending `PaymentTransaction`；金額、vendor、plan 與 platform referral binding 都由 server 重新讀取，client 欄位不能改寫付款資料。
- provider checkout boundary 支援 `BillingPlan` 顯示名稱；checkout session 只保存 bounded metadata，頁面只接受 allowlisted PayUni Sandbox／Production form action，未知 adapter 不會誤導使用者已付款。
- trusted paid webhook 只會啟用既有 pending transaction metadata 指向的 subscription，更新 `VendorUsageLimit`、結束舊 active subscription，並以 Serializable transaction 保持 callback replay idempotent。
- failed callback 會標記 `payment_failed`；full refund 會標記 `payment_refunded`。既有 FIN-15 沒有 `platform_subscription_checkout` purpose 的 transaction 不會被誤啟用。

## 可追溯驗收結果

- `/billing/plans` action／page targeted：2 files，13 passed、0 failed、0 skipped。
- `payment-webhooks.test.ts` targeted：39 passed、0 failed、0 skipped；覆蓋 paid activation、paid replay、full refund 與 failed payment。
- full Vitest：181 files、1316 passed、0 failed、0 skipped。
- Node contracts：620/620；WP-175 targeted contract：4/4。WP-175 的 source signal 已從已移除的「月底月結後付」更新為目前 UI 的 `pending 交易`，保留原有 fail-closed assertion。
- TypeScript：PASS；ESLint：0 errors、2 個既有 warnings；`git diff --check`：PASS；`npm run release:verify:local`：`verified`。

## Coverage 與外部邊界

`npm run test:coverage` 的 Vitest 與 Node contract 都通過，但 global coverage gate 仍為 `FAIL_REMAINING_SOURCE_INVENTORY`：Statements `39.35%`、Branches `45.10%`、Functions `47.61%`、Lines `59.67%`，既有門檻為 `63/57/60/65`。scripts attribution 為 `27.15/35.48/33.23/46.52`，src attribution 為 `82.58/75.05/82.96/85.40`。沒有降低 threshold、inventory、exclude、skip 或 assertion。

本 WP 沒有執行 staging、PayUni Sandbox、Production、正式付款／退款／出款、寄信或人工法律／財務／release sign-off；沒有讀取 `.env*`、Token、Cookie、Secret 或正式資料。FIN-08AA、WP-196、WP-197 均未重試，staged index 維持空白。

CAT04 維持 `6.0`、CAT06 `7.0`、CAT10 `4.5`、總分 `73.5`；`SANDBOX_READY=false`、`PRODUCTION_READY=false`。Goal 仍為 `IN_PROGRESS`。

證據報告：`.ai-team/reports/fin17-platform-subscription-checkout-activation-closure.json`。
