# B-04 回執：資料與 Migration 審查

- 執行者：B-04 reviewer（Opus，唯讀）
- 日期：2026-10-19
- 產出：`docs/review-2026Q4/14-data-migration.md` 與本回執。內容由 reviewer 以回報訊息交付；reviewer 的角色限制禁止寫檔，兩個檔案由主對話代為寫入。
- 修改既有檔案：無。沒有任何 git 寫入；沒有讀取 `.env*`；沒有連線任何資料庫（含 staging、Supabase）。暫存的分析腳本只放在 session scratchpad。
- Skill `supabase:supabase-postgres-best-practices`：此代理環境沒有 Skill 工具，改依一般 PostgreSQL 與 Supabase 最佳實務判斷。

## 基線確認

- `git rev-parse HEAD` 為 `78621ca32cabfc016a69504c996c107785987cc2`，`git describe --tags --exact-match HEAD` 為 `review-baseline-2026Q4`，兩者一致。

## 閱讀的文件

- `docs/review-2026Q4/01-system-map.md` 第 3 節觀察與第 4 節（Prisma）
- `docs/codex-goal/PRISMA_INVARIANTS.md`（全文）
- `docs/production-database-runbook.md`、`docs/production-backup-restore-runbook.md`、`docs/launch/staging-migration-apply.md`
- `docs/staging-backup-restore-drill-2026-07-22.md`、`docs/launch/staging-backup-recovery.md`、`docs/launch/prelaunch-engineering-receipt-20260929.md:40-48`、`docs/production-go-live-checklist.md`、`docs/launch/local-database-development.md`、`docs/staging-production-env-vars.md`（grep）

## 執行過的命令（摘要）

1. 基線：`git rev-parse HEAD`、`git describe --tags --exact-match HEAD`、`ls prisma`、`ls prisma/migrations | wc -l`（共 109 項，即 108 個目錄＋lock）、`wc -l`／`grep -c '^model '`／`grep -c '^enum '`
2. Schema 型別：`grep` 搜尋 `Float`、`Decimal`、`Json`、`Timestamptz`、`onDelete` 分布（Cascade 192、Restrict 148、SetNull 17、NoAction 1），以及 `deletedAt`／`archivedAt`
3. 用 Python 腳本（scratchpad 的 `parse.py`、`q1.py`、`drift.py`，以 `python -I` 執行）：
   - 把 schema 解析成 JSON
   - 列出缺 `vendorId` 的 model（17 個）
   - 列出財務 model 的 Cascade 關聯
   - 列出各父表（User／FormSubmission／Live／Product／PaymentTransaction／CommerceOrder／Affiliate）的子關聯刪除行為
   - 列出主要財務 model 的 unique、index、金額欄位
   - 找出沒有前導索引的 FK（56 個）
   - 比對 schema 與 migration 的索引名稱（schema 預期 471 個，migration 實有 482 個）
   - 統計各財務表的 CHECK 數量
   - 列出 7/24 RLS hardening 之後新建、但沒有 `ENABLE ROW LEVEL SECURITY` 的表
4. Migration 掃描：
   - `grep` 搜尋 `DROP`、`TRUNCATE`、`DELETE FROM`、`ALTER COLUMN TYPE`、`SET NOT NULL`、`RENAME`
   - 用 Python 找「新增 NOT NULL 卻沒有 DEFAULT」的欄位（結果 0）
   - 統計各 migration 的 `UPDATE` 數量
   - `grep` 搜尋 `CONCURRENTLY`、`NOT VALID`、`BEGIN`／`COMMIT`、`RAISE EXCEPTION`、`CREATE EXTENSION`
   - 閱讀 `20260806090000`、`20260808235500`、`20261006140000`、`20261007002000`、post-purchase 系列 4 條、`20260724150000`、`20261006120000:262-282`、`20260810051000`、`20260725230000`
5. 合併順序：`git log --diff-filter=A --format=%ad/%cd -- 'prisma/migrations/*/migration.sql'`，比對名稱排序（找到 18 個逆序合併），並以 commit 日期抽查確認
6. 刪除路徑：`grep` 搜尋 `\.(delete|deleteMany)\(`（排除測試），確認 app 內沒有 Vendor、User、Live、Product、PaymentTransaction、CommerceOrder 的刪除路徑
7. 加密：閱讀 `src/lib/sensitive-data.ts`、`src/lib/bank-account.ts`（keyring、`resolveStoredBankAccount`）、`scripts/backfill-bank-account-encryption.ts`；`grep` 所有 `encryptSensitiveValue`、`decryptSensitiveValue`、`deriveSensitiveDataKey` 的呼叫點與 purpose；`grep` 搜尋 `CSRF_SECRET` 在 docs 與 ops 中的出現位置
8. Seed 與 bootstrap：閱讀 `prisma/seed.ts:1-110`、`scripts/local-database-safety.ts`；`grep` 搜尋 `billingPlan.(create|upsert)`
9. Workflow：閱讀 `.github/workflows/staging-migrate.yml`、`scripts/staging-migrate.mjs`、`vercel.json`、`vercel.staging.json`、`prisma.config.ts`；`git show --stat e54cfa87 7fcb8bb5`；`grep` 檢查 `ci.yml` 中的 migrate 與 diff 步驟
10. 金流冪等相關：閱讀 `payment-webhooks.ts:228-337,1270-1301`、`api/webhooks/payments/route.ts:140-260`、`payuni.ts:60-80,955-1000`、`payuni.test.ts:640-680`、`api/payments/checkout/route.ts:147-151,870-900`、`invoice-actions.ts:68-72,160-185`、`platform-plan-checkout.ts:218-221,405-430`、`actions.ts:1872-1989`、`inventory-reservations.ts:145-180`
11. 索引推估：閱讀 `dashboard-read-model.ts:120-285`、`affiliates/page.tsx:10-30`、`orders/page.tsx:30-46`、`live-chat-analytics.ts:36-61`、`student-portal.ts:60-80`、`live-purchase-broadcasts.ts:30-50`、`landing-page-service.ts:540-560`、`interaction-actions.ts`（三處刪除）
12. 其他：`src/lib/db.ts`、`src/lib/env.ts:280-330`、`src/lib/audit.ts`、`src/lib/public-policy-content.ts`（grep）；`ls -la prisma/dev.db`、`git check-ignore -v prisma/dev.db`
13. 測試：`npx vitest run scripts/prisma-invariant-inventory.test.ts`，結果 Test Files 1 passed、Tests 1 passed

## 沒做到的事與限制

- 沒有執行 `prisma migrate diff --from-migrations … --shadow-database-url`，因為需要 shadow DB。B04-04 的漂移是靜態比對的結果，建議在 CI 補這一步來確認。
- 沒有查 staging 或 Production 的實際狀態，因為依規定不得連線：RLS 與 grant、TimeZone、目前套用的 migration 數、連線池參數、是否已跑過銀行帳號 backfill，這些都需要 owner 授權後做只讀查詢。
- 索引建議沒有用實際資料跑 `EXPLAIN`，一律標為推估（MINOR／NIT）。
- PayUni 是否會對同一 TradeNo 推送退款或爭議通知（B04-13），無法從 repo 確認，需要查 PayUni 文件或在 Sandbox 驗證。

## 結果

BLOCKER 1（B04-01）、MAJOR 6（B04-02～07）、MINOR 15（B04-08～22）、NIT 3（B04-23～25）。
