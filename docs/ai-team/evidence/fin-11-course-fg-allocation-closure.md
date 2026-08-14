# FIN-11 — Course F/G allocation closure

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_LOCAL_FUNCTIONAL_FIX`，不是 CAT04 或 Production readiness 通過。

## 已完成的產品閉環

- 商品可明確設定 `merchant` 或 `course` domain，以及 active 的課程內容所有人 F、promoter 比例與 policy version。
- server-created checkout 的 `productId` 才能啟動課程分潤；provider payload 不能選租戶、商品或收款人。
- F 直購只建立 F 100% allocation，不產生虛假的 G；G 成交只建立實際 promoter G 與內容所有人 F 兩筆 allocation，不沿上線關係展開 H。
- paid webhook 在 serializable transaction 內建立 immutable allocation 與 accrual ledger；重送 event 不會重複建立。
- policy 變更不會重算既有付款；退款依原始 share snapshot 追加負向 ledger，dispute 只在既有 allocation 上追加 bounded ledger entry。
- team conversion attribution 的 paid snapshot 改為不可變；相同付款交易若歸因身分漂移會 fail closed。

主要程式與 migration：

- `src/lib/course-commission.ts`
- `src/lib/course-commission-accounting.ts`
- `src/lib/payment-webhooks.ts`
- `src/app/actions/product-actions.ts`
- `src/components/product-form.tsx`
- `prisma/schema.prisma`
- `prisma/migrations/20260807080000_course_fg_allocation/migration.sql`

## 實際驗證結果

- 完整 Vitest：170 files、1258 passed、0 failed、0 skipped。
- Node contract suite：620 passed、0 failed、0 skipped。
- FIN-11 + payment webhook targeted：4 files、44 passed、0 failed、0 skipped。
- checkout、team attribution、public playback targeted：4 files、63 passed、0 failed、0 skipped。
- `npx prisma validate`、`npx tsc --noEmit`、scoped ESLint、`git diff --check`：PASS。
- disposable loopback PostgreSQL `celebratedeal_test`：`20260807080000_course_fg_allocation` corrected deploy PASS，後續 `prisma migrate deploy` 回報 no pending migrations。
- `npm run release:verify:local`：`verified`；只記錄 allowlisted environment availability，不輸出任何值。

首次 disposable migration 嘗試發現兩個 PostgreSQL 長 index 名稱截斷後碰撞；已在 migration 內改用明確短名，確認 disposable migration status 後標記該 disposable migration rolled back，再重新 deploy PASS。沒有對 staging、Production 或正式資料庫做 migration。

## 尚未取得、因此不宣稱完成的證據

- 真實 staging／PayUni Sandbox checkout、paid callback、partial/full refund reconciliation 尚未取得；FIN-08AA、WP-196、WP-197 沒有重試。
- 課程 F/G 的 merchant-owned payable 仍不是銀行出款、KYC、稅務或人工 payout approval；這些需真人 owner 證據。
- global coverage gate 仍沿用 QUAL-10 的真實 `FAIL_REMAINING_SOURCE_INVENTORY`，本包沒有降低 threshold、exclude、skip 或 assertion。

因此本 checkpoint 不改 CAT04（6.0）與總分（73.5），也不改 `SANDBOX_READY=false`／`PRODUCTION_READY=false`。

## 安全與 ownership

- `.env*`、Token、Cookie、Secret、正式客戶／付款資料：未讀取或輸出。
- Production DB、Production payment、Production deploy、外部付款與寄信：未操作。
- git staged index：空；既有使用者 dirty changes：保留。
