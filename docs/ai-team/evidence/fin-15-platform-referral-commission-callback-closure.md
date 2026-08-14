# FIN-15 — Platform referral verified payment callback and refund ledger closure

日期：2026-08-07  
結果：`COMPLETE_LOCAL_COMMISSION_CALLBACK_REFUND`；這是本機 callback／退款帳本功能證據，不是 payout、staging、PayUni Sandbox 或 Production readiness 證據。

## 完成範圍

- 新增獨立 `PlatformReferralCommission` 與 append-only `PlatformReferralCommissionLedgerEntry`，不重用商家 `AffiliateCommission`。
- 只有既有、由 server 建立且含 trusted `platformSubscriptionId` metadata 的 pending `PaymentTransaction`，在 verified paid webhook 中才可 accrual；provider payload 不能自行選 subscription、vendor 或推薦人。
- commission 保存 immutable attribution code／rate／currency／month snapshot；paid event 以 payment transaction 與 event identity 去重。
- partial refund 追加負向 ledger，full refund 追加完整 reversal 並將 commission 標記 `void`；重播不會重複入帳，也不會讓餘額變成負數。
- payout read model／batch、KYC／稅務／人工 payout approval，以及真正平台方案 checkout／付款 initiation 尚未包含在本 WP。

## 可追溯驗收結果

- `src/lib/payment-webhooks.test.ts`＋`src/lib/platform-referral-commission.test.ts`：2 files，40 passed、0 failed、0 skipped。
- Prisma／architecture／payout contract：3 files，5/5 passed；Prisma inventory 為 61 models／19 migrations。
- loopback disposable PostgreSQL：`validate`、`migrate deploy`、`migrate status` 全數 PASS，19/19 migrations up to date；container 與 temp root cleanup 均 PASS。
- full Vitest：179 files、1304 passed、0 failed、0 skipped。
- Node contracts：620/620 passed；API registry：30/30；TypeScript：PASS；ESLint：0 errors、2 個既有 warnings；`npm run release:verify:local`：`verified`；`git diff --check`：PASS。

## Coverage 與外部邊界

`npm run test:coverage` 的 Vitest 與 Node contract 都通過，但 global coverage gate 仍失敗：Statements `39.15%`、Branches `45.04%`、Functions `47.54%`、Lines `59.53%`，既有門檻為 `63/57/60/65`。scripts attribution 為 `27.23/35.54/33.37/46.63`，src attribution 為 `83.15/75.99/83.46/85.82`。沒有降低 threshold、inventory、exclude、skip 或 assertion。

本 WP 沒有執行 staging、PayUni Sandbox、Production、正式付款／退款、寄信或人工法律／財務／release sign-off；沒有讀取 `.env*`、Token、Cookie、Secret 或正式資料。FIN-08AA、WP-196、WP-197 均未重試，staged index 維持空白。

CAT04 維持 `6.0`、CAT06 `7.0`、CAT10 `4.5`、總分 `73.5`；`SANDBOX_READY=false`、`PRODUCTION_READY=false`。下一個 finance work package 是獨立 platform payout read model／batch 與 owner payout controls，並需另取得授權的 staging／PayUni Sandbox 對帳證據。

證據報告：`.ai-team/reports/fin15-platform-referral-commission-callback-closure.json`。
