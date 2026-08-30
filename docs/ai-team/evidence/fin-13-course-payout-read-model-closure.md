# FIN-13 — Course F/G merchant-owned payout read-model closure

日期：2026-08-07  
結果：`COMPLETE_LOCAL_FUNCTIONAL_FIX`；staging／PayUni／人工 release evidence 仍未完成。

## 修正

- 新增獨立 `CoursePayout` read model，以 vendor、recipient membership、accounting month 建立課程 F/G merchant-owned payable identity；它與 affiliate `AffiliatePayout` 分離。
- settlement lock 會從 immutable `CourseCommissionLedgerEntry` 依 recipient／month 聚合，冪等建立或更新 pending payable read model；已 paid／void 的金額衝突會 fail closed。
- finance-admin 可記錄 paid 或 void outcome：paid 必須填寫人工 reference 並通過 immutable ledger exact-match；void 必須填寫人工 reason，並追加不可變 reversal ledger entries。
- 所有 outcome 都寫入 audit log；本包沒有執行銀行、KYC、稅務、PayUni 或其他外部付款，也沒有把人工 outcome 誤稱為外部付款完成。

## 可追溯驗收結果

- 課程 payout targeted：2 files，6 passed，0 failed，0 skipped。
- architecture／Prisma inventory／AffiliatePayout separation／course payout contracts：5 files，14/14 passed。
- full Vitest：172 files，1265 passed，0 failed，0 skipped。
- Node contracts：620/620 passed。
- `tsc --noEmit`、Prisma validate／generate、`git diff --check`：PASS。
- full ESLint：exit 0、0 errors；保留既有 `scripts/wp130-cloudflare-stream-webhook-contract-runner.mjs` 兩個 unused-variable warnings，未因本包新增。
- loopback disposable PostgreSQL：16/16 migrations，`No pending migrations to apply.`
- `npm run release:verify:local`：`verified`；`npm audit --omit=dev --json`：total/high/critical 均為 0。
- `node scripts/readiness-truth-reconciliation.mjs`：`PASS`，canonical total 73.5，10 categories，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

## Coverage 邊界

`npm run test:coverage` 實際 exit 1，但功能測試與 Node contracts 均完成：Vitest 172 files／1265 passed、Node TAP 620/620。combined global statements／branches／functions／lines 為 `38.57／44.49／46.92／58.76`，低於既有 `63／57／60／65`；`src/lib` gate 為 `87.95／82.51／93.37／91.00`。scripts attribution 為 `27.23／35.54／33.37／46.63`，src attribution 為 `81.73／74.57／82.12／84.22`。本包沒有修改 coverage threshold、inventory、exclude、skip 或 assertion；失敗如實保留，繼續由 QUAL-CLOSURE 處理。

## 邊界與評分

本包沒有執行 staging、PayUni Sandbox、Production、正式付款／退款或寄信，也沒有讀取 `.env*`、Token、Cookie 或 Secret。CAT04 維持 6.0、CAT06 7.0、CAT10 4.5、總分 73.5；必要人工法律／財務／release owner sign-off 仍 pending。FIN-08AA、WP-196、WP-197 均未重試，staged index 維持空白。

證據檔：`.ai-team/reports/fin13-course-payout-read-model-closure.json`。
