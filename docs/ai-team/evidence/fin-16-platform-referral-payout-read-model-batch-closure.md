# FIN-16 — Platform referral payout read model、local batch 與 finance-admin outcome closure

日期：2026-08-07  
結果：`COMPLETE_LOCAL_PAYOUT_READ_MODEL_BATCH`；這是本機 payable／batch／人工 outcome 證據，不是外部出款、KYC、稅務或 Production readiness 證據。

## 完成範圍

- 新增獨立 `PlatformReferralPayout` 與 `PlatformReferralPayoutBatch`，按 platform referral immutable ledger 的 owner／month 彙整，不與 merchant `AffiliatePayout` 或 course `CoursePayout` 混用。
- owner／month sync 只會建立或更新 `pending` read model；已 batched／paid／void 的金額若與 immutable ledger 不一致會 fail closed，不會靜默重算。
- finance-admin 可在本機同步 ledger、建立 local batch；batch 只保存總額／筆數／月份與 payout claim，沒有銀行 credential，也不會呼叫 provider。
- `paid` 必須在 batched 後並需要人工 reference；`void` 會對每筆正餘額 commission 追加 immutable reversal，再寫入 audit log。
- KYC／稅務／推薦人 eligibility、外部銀行／支付 provider transfer 與 staging／PayUni 對帳仍未完成。

## 可追溯驗收結果

- `src/lib/platform-referral-payout.test.ts`＋`src/app/actions/platform-referral-payout-actions.test.ts`：2 files，10 passed、0 failed、0 skipped。
- full Vitest：181 files、1314 passed、0 failed、0 skipped。
- Prisma inventory：63 models／20 migrations；loopback disposable PostgreSQL 的 validate、migrate deploy、migrate status 為 20/20 up to date，container 與 temp root cleanup 均 PASS。
- TypeScript：PASS；ESLint：0 errors、2 個既有 warnings；`git diff --check`：PASS；`npm run release:verify:local`：`verified`；Node contracts：620/620。

## Coverage 與外部邊界

`npm run test:coverage` 的 Vitest 與 Node contract 都通過，但 global coverage gate 仍失敗：Statements `39.30%`、Branches `45.09%`、Functions `47.64%`、Lines `59.67%`，既有門檻為 `63/57/60/65`。scripts attribution 為 `27.23/35.54/33.37/46.63`，src attribution 為 `82.82/75.55/83.32/85.69`。沒有降低 threshold、inventory、exclude、skip 或 assertion。

本 WP 沒有執行 staging、PayUni Sandbox、Production、正式付款／退款／出款、寄信或人工法律／財務／release sign-off；沒有讀取 `.env*`、Token、Cookie、Secret 或正式資料。FIN-08AA、WP-196、WP-197 均未重試，staged index 維持空白。

CAT04 維持 `6.0`、CAT06 `7.0`、CAT10 `4.5`、總分 `73.5`；`SANDBOX_READY=false`、`PRODUCTION_READY=false`。Goal 仍為 `IN_PROGRESS`。

證據報告：`.ai-team/reports/fin16-platform-referral-payout-read-model-batch-closure.json`。
