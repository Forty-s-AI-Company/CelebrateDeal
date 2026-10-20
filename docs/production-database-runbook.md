# CelebrateDeal Production Database Runbook

最後更新：2026-07-09

## 1. 本次資料庫正式化狀態

CelebrateDeal 已從本機 SQLite migration 流程切換成正式 PostgreSQL / Supabase-first 流程。

已完成調整：

- `prisma/schema.prisma` datasource 改為 `postgresql`。
- `prisma/schema.prisma` 新增 `directUrl = env("DIRECT_URL")`。
- `prisma.config.ts` 的 migration datasource 優先使用 `DIRECT_URL`，再 fallback 到 `DATABASE_URL`。
- 舊 SQLite migrations 已歸檔到 `prisma/migrations_sqlite_archive/`。
- 新 PostgreSQL baseline migration 已建立在 `prisma/migrations/20260709090000_postgresql_baseline/`。
- `prisma/seed.ts` 已加入 production seed 保護。
- CI 已改為啟動 PostgreSQL service 後執行 migration 與測試。

目前仍保留的本機 SQLite 檔：

- `prisma/dev.db`

這個檔案只視為舊本機 demo 資料，不再是正式 migration 來源。

## 2. SQLite 相依點盤點

正式化前的 SQLite 相依點：

| 類型 | 位置 | 處理方式 |
|---|---|---|
| Prisma provider | `prisma/schema.prisma` | 已改為 `postgresql` |
| Prisma CLI fallback | `prisma.config.ts` | 已移除 `file:dev.db` fallback，改用 PostgreSQL fallback |
| Local env | `.env` | 既有本機檔可能仍是 `file:dev.db`，正式環境不可沿用 |
| Migration lock | `prisma/migrations_sqlite_archive/migration_lock.toml` | 已歸檔 |
| SQLite migrations | `prisma/migrations_sqlite_archive/**` | 只保留查閱，不再給 production migrate 使用 |
| SQLite DB file | `prisma/dev.db` | 只保留本機舊資料，不納入 production |

## 3. Supabase 連線變數

正式環境需要至少兩條資料庫連線字串。

```env
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."
```

建議分工：

- `DATABASE_URL`：Next.js runtime 使用。部署到 Vercel 時建議使用 Supabase pooler 連線，避免 serverless 連線數暴衝。
- `DIRECT_URL`：Prisma migration 使用。建議使用 Supabase direct connection，或 Supabase 文件建議的 migration 專用連線。

注意事項：

- 不要把 `DATABASE_URL` 或 `DIRECT_URL` 設成 `NEXT_PUBLIC_*`。
- 不要把 Supabase service role key 當成資料庫連線字串。
- migration、月結、出款、webhook 對帳都會碰財務資料，production DB credential 必須放在 Vercel / GitHub Actions secrets，不可提交到 repo。
- 若未來改用 Supabase Data API 或 `supabase-js` 直接讀寫 public tables，需另外補 RLS 與 explicit grants。Supabase 2026-05-30 起新專案 public schema 新表不再預設暴露給 Data API。

## 4. 本機 PostgreSQL 開發流程

建議用 Docker 開一個本機 PostgreSQL。

```powershell
docker run --name celebratedeal-postgres `
  -e POSTGRES_USER=postgres `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=celebratedeal_dev `
  -p 54329:5432 `
  -d postgres:16-alpine
```

Migration 指令不讀 `.env*`，目標資料庫必須在 shell 內注入（F-065）。`prisma.config.ts` 會自動載入
`.env.local`，而 `vercel env pull` 預設就寫到那裡；wrapper 會把驗證過的 `DATABASE_URL` 與 `DIRECT_URL`
固定傳給 Prisma，避免 dotenv 事後補上遠端目標：

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public"
$env:DIRECT_URL=$env:DATABASE_URL
```

第一次建立：

```powershell
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

Migration 指令的目標防護（`scripts/db-migrate-guard.ts`）：

| 指令 | 實際執行 | 允許的目標 |
| --- | --- | --- |
| `npm run db:migrate` | `scripts/db-migrate-dev.ts` → `prisma migrate dev` | 只限 loopback（`localhost`／`127.0.0.1`／`::1`）上的 `celebratedeal_dev`／`_test`／`_e2e`／`_ci`／`_wp17_ci`／`_wp18_ci`；`DATABASE_URL` 與 `DIRECT_URL` 都必須通過 `assertLocalTestDatabase`。`migrate dev` 可能提示重設資料庫，因此沒有任何遠端例外。 |
| `npm run db:migrate:deploy` | `scripts/db-migrate-deploy.ts` → `prisma migrate deploy` | loopback disposable 資料庫；或同時設定 `ALLOW_REMOTE_MIGRATE_DEPLOY=1` 與已登記的 workflow 專用變數 `MIGRATE_DEPLOY_WORKFLOW`，且在該 workflow 的平台上執行。目前唯一登記的是 `vercel-staging-build`（須 `VERCEL=1`，由 `vercel.staging.json` 設定）。通用的 `GITHUB_ACTIONS`／`VERCEL` 標記本身不足以放行。 |

額外的 CLI 參數只接受白名單：`migrate dev` 只收 `--name`／`-n`、`--create-only`、`--skip-seed`、`--skip-generate`；
`migrate deploy` 不收任何參數，避免 `--schema`、`--config` 改寫已驗證的目標。

被拒絕時只輸出 `category=`（`missing`、`non-loopback`、`unsafe-database`、`remote-not-allowed`、
`remote-outside-workflow`、`argument-not-allowed`），不會印出 URL、主機、帳號或資料庫名稱。

**這是防誤用，不是權限控制。** 任何持有資料庫憑證的人都能直接執行 Prisma 繞過 wrapper；
真正的邊界是憑證只存在受保護的環境（GitHub Environment、Vercel 專案）裡。

若只想建立 production-safe 預設方案，不建立 demo vendor：

```powershell
$env:SEED_MODE="production-bootstrap"
npm run db:seed
```

## 5. Production Migration 策略

本專案目前不建議做「SQLite dev.db 直接搬到 production」。

正式 MVP 建議採用乾淨 PostgreSQL baseline：

1. 建立 Supabase production project。
2. 建立或確認 Prisma migration 專用 DB user。
3. 設定 production `DATABASE_URL` 與 `DIRECT_URL`。
4. 先在 staging Supabase project 跑完整 migration。
5. staging 通過 smoke test 後，再對 production 執行 migration。

Production migration 只能經 `.github/workflows/production-migrate.yml`（§5.1）執行。`npm run db:migrate:deploy`
的 wrapper 仍會拒絕任何 production 目標，不要在 shell 自行設定 `MIGRATE_DEPLOY_WORKFLOW` 繞過；
production workflow 使用自己的守門腳本 `scripts/production-migrate.mjs`，不經過該 wrapper。

Staging 由 `vercel.staging.json` 的 buildCommand 執行
`DIRECT_URL="${STAGING_DATABASE_URL:?...}" ALLOW_REMOTE_MIGRATE_DEPLOY=1 MIGRATE_DEPLOY_WORKFLOW=vercel-staging-build npm run db:migrate:deploy`：
`STAGING_DATABASE_URL` 未設定或為空時 build 直接失敗，不會退回 `DATABASE_URL`。
`.github/workflows/staging-migrate.yml` 仍走 `scripts/staging-migrate.mjs` 自己的 staging 守門。

### 5.1 Production migrate workflow（F-064，D-41）

owner 決策 D-41：Production migration 由 owner 核准、經 workflow 執行，並且先備份。

**一次性設定（owner）**

1. GitHub → Settings → Environments 建立 `production`：設定 required reviewers（owner），並勾選只允許 protected branch（`master`）。
2. 在 `production` environment 設定 secret `PRODUCTION_DATABASE_URL`：Supabase pooler 的 session 連線（`postgres.awigitueyqdqaqwbjdgu@aws-N-<region>.pooler.supabase.com`；6543 會自動改用 5432）。腳本只接受固定的 Production project ref，遇到 staging ref 會拒絕。
3. 設定變數 `PRODUCTION_BACKUP_WORKFLOW_PATH`：產生 Production 備份的 workflow 路徑（例如 `.github/workflows/production-backup.yml`）。**目前 repo 還沒有 Production 備份 workflow**，未設定或設成本 workflow 時，`deploy` 一律回 `BACKUP_WORKFLOW_NOT_CONFIGURED`，不會連線資料庫。若 owner 改用 Supabase dashboard／PITR 備份，需另外決定如何產生可驗證的 run ID（例如一個只記錄 restore point 的 workflow）。

**每次部署**

1. 先在 staging 跑同一批 migration（`Staging migrate`），並依 `docs/operations/prisma-migration-guards-runbook.md` 完成各 migration 的唯讀前置查詢（例如 §4 重複訂單號、§6 撥款帳號明文列）。
2. 執行 Production 備份 workflow，記下成功的 run ID。備份必須在 24 小時內完成，否則 `BACKUP_RUN_TOO_OLD`。
3. Actions → `Production migrate` → Run workflow（branch `master`）→ `mode=status`，`backup_run_id` 填上一步的 run ID。由 environment reviewer 核准。確認輸出只列出預期的 pending migration。
4. 同樣方式執行 `mode=deploy`。腳本會依序：驗證 URL 與 project ref → 以 GitHub API 確認備份 run（指定 workflow、`master`、`completed/success`、24 小時內）→ `prisma migrate status` → 歷史一致才 `prisma migrate deploy`。連線固定 `lock_timeout=5s`、`statement_timeout=60s`、`sslmode=require`。
5. 部署後再跑一次 `mode=status`，應為 `Database schema is up to date!`。

輸出只有固定代碼與 Prisma 摘要行（migration 名稱、`PRISMA_ERROR Pxxxx`、SQLSTATE），不含主機、帳號或資料值。

**常見代碼**

| 代碼 | 意義 | 處理 |
|---|---|---|
| `BACKUP_RUN_ID_INVALID`／`BACKUP_RUN_NOT_FOUND`／`BACKUP_RUN_WRONG_WORKFLOW`／`BACKUP_RUN_NOT_MASTER`／`BACKUP_RUN_NOT_SUCCESSFUL`／`BACKUP_RUN_TOO_OLD` | 備份 run 不符合條件 | 重新備份後用新的 run ID |
| `BACKUP_WORKFLOW_NOT_CONFIGURED` | 未設定 `PRODUCTION_BACKUP_WORKFLOW_PATH` | 見一次性設定第 3 點 |
| `PRODUCTION_PROJECT_MISMATCH`／`PRODUCTION_DATABASE_IS_STAGING` | secret 指向錯誤的專案 | 修正 environment secret |
| `PRODUCTION_HISTORY_DIVERGED` | 有失敗的 migration（P3009）或資料庫有本地不存在的 migration | 依下方 P3009 SOP |
| `PRODUCTION_STATUS_FAILED`／`PRODUCTION_DEPLOY_FAILED` | 連線或 migration 執行失敗 | 看 `PRISMA_ERROR`／SQLSTATE；`55P03` 是 `lock_timeout`、`57014` 是 `statement_timeout` |

### 5.2 Migration 失敗（P3009）與 `prisma migrate resolve` SOP

Prisma 把整份 `migration.sql` 以單一多語句查詢送出，PostgreSQL 會把它當成一個隱含交易：失敗時該 migration 的 DDL 會整個回滾，但 `_prisma_migrations` 會留下一筆 `finished_at IS NULL` 的失敗紀錄，之後每次 `deploy` 都回 **P3009**，直到人工標記。

1. **停止**：不要重跑 deploy、不要改 migration 檔（checksum 會不符，且 `migration-order-check` 禁止修改已合併的 migration）。
2. **判斷失敗原因**（唯讀）：從 workflow 輸出取得 `MIGRATION_FAILED <name>` 與 SQLSTATE／Prisma code；必要時由 owner 以唯讀連線查：

   ```sql
   SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
     FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL;
   ```

   常見原因：migration 內的 preflight `RAISE EXCEPTION`（資料不符合前提，例如重複訂單號、明文撥款帳號）、`lock_timeout`（55P03，熱表有長交易）、`statement_timeout`（57014，大表掃描）。
3. **確認資料庫狀態**：由於整個 migration 在交易內，失敗時物件應不存在。用唯讀查詢確認該 migration 建立的欄位／索引／constraint 確實不存在（例如 `SELECT conname FROM pg_constraint WHERE conname = '<名稱>'`）。若 migration 內有 `CREATE INDEX CONCURRENTLY` 等不能在交易內執行的語句（目前沒有），要逐一確認並清除殘留的 INVALID 索引。
4. **修正原因**：處理資料（依該 migration 的 runbook 段落，需 owner 授權）、或在低流量時段重試以避開鎖。
5. **標記為已回滾**（owner 在受控環境執行，指向 Production 的 `DIRECT_URL`）：

   ```bash
   npx prisma migrate resolve --rolled-back <migration_name>
   ```

   只在第 3 步確認物件**不存在**時使用。若確認 migration 的變更其實已完整套用（例如人工補做過），改用 `npx prisma migrate resolve --applied <migration_name>`，並在 PR 留下證據。不要直接 `UPDATE`／`DELETE` `_prisma_migrations`。
6. **重新部署**：重新備份 → `mode=status`（應只剩 pending，沒有 failed）→ `mode=deploy`。
7. 若是 migration SQL 本身有錯（不是資料或鎖的問題），由 owner 與 reviewer 一起決定，不得修改已合併的 migration 檔：做法是由 owner 以受控方式手動套用等效且正確的變更，再 `migrate resolve --applied <migration_name>`，差異以新的 forward migration 補齊。每批 migration 先在 staging 跑過，就是為了避免走到這一步。

### 5.3 大表變更規則

- 新增 CHECK／FK 一律先 `NOT VALID`，`VALIDATE CONSTRAINT` 放在**時間戳較晚的另一個 migration**。Prisma 把每個 migration 檔當成一個隱含交易，`ADD CONSTRAINT`、`DROP CONSTRAINT`、`ADD COLUMN` 取得的 ACCESS EXCLUSIVE 會持有到該檔 commit；同一個檔案裡的 VALIDATE 仍會在 ACCESS EXCLUSIVE 下掃整張表。獨立 migration 的 VALIDATE 只取 SHARE UPDATE EXCLUSIVE，不擋讀寫。
- 依資料內容可能失敗的 migration（例如 preflight `RAISE`）不要排在新程式必須用到的欄位之前；能在 migration 內安全修正資料的，改為修正並留下稽核紀錄，不要卡住整批部署。
- 先 `migrate deploy` 成功，才 promote 依賴新欄位的 app。
- 熱表（`CommerceOrder`、`FormSubmission`、`PaymentTransaction` 等）的索引改用 `CREATE INDEX CONCURRENTLY`，並放在**只含這一句**的獨立 migration（多語句的 migration 是隱含交易，`CONCURRENTLY` 不能在交易內執行；需先在 staging 演練）。
- migration 內設定交易層級 `lock_timeout`（`SELECT pg_catalog.set_config('lock_timeout', '5s', true)`），並附唯讀 preflight 查詢與失敗時的 `migrate resolve` 指引。

Production 禁止：

- 禁止使用 `prisma db push`。
- 禁止對遠端資料庫執行 `npm run db:migrate`（`prisma migrate dev`）；wrapper 會拒絕，也不得改用 `npx prisma migrate dev` 繞過。
- 禁止直接修改 production DB schema。
- 禁止在 production 執行 demo seed。
- 禁止直接刪除欄位或資料表，除非先完成備份、相容部署與 rollback 計畫。

## 6. Production Seed Policy

`prisma/seed.ts` 現在分成兩種模式。

### 6.1 Demo seed

預設 `SEED_MODE=demo`，用途是本機與測試環境建立完整展示資料。

這個模式會清空並重建多個資料表：

- vendors
- users
- billing plans
- payout batches
- webhook events
- audit logs

因此 demo seed 不可在 production 執行。

### 6.2 Production bootstrap

正式環境只允許：

```powershell
$env:NODE_ENV="production"
$env:SEED_MODE="production-bootstrap"
npm run db:seed
```

目前 production bootstrap 僅會 upsert 預設 billing plans：

- Starter
- Growth
- Team / Pro

不會建立 demo vendor、demo live、demo payment transaction、demo settlement、demo payout。

第一個 platform admin 帳號需等正式 Auth / admin role matrix 定案後，再用獨立 bootstrap script 或後台安全流程建立。

## 7. Backup Policy

正式 MVP 上線前至少要做到：

- 依 Supabase organization plan 確認可用的 backup 形式，並留下非敏感驗收紀錄。Pro、Team、Enterprise 才有 dashboard daily backup；Free plan 必須用加密的站外 logical dump。
- 每次 production migration 前建立可驗證的 backup。可用 dashboard backup 時記錄 restore point；否則建立 roles、schema、data 的 logical dump。CelebrateDeal 的 Prisma migration history 位於 `public._prisma_migrations`，已包含於 public data dump。
- 每次月結 lock settlement 前與每次建立 payout batch 前建立可驗證的 backup。
- 每週至少一次 restore drill 到隔離 staging / restore project，不得覆寫正在使用的 Staging。
- 依 [Staging 備份與還原演練 Runbook](./staging-backup-restore-drill-runbook.md) 執行，並保存 SHA-256 manifest、RTO 與驗收結果；不得保存 secret 或 customer data。

建議 RPO / RTO：

- RPO：24 小時內；月結與出款前需接近 0。
- RTO：MVP 初期 4 小時內；正式收費後目標 1 小時內。

必備抽查資料：

- `Vendor`
- `User`
- `VendorMember`
- `PaymentTransaction`
- `RefundRecord`
- `Settlement`
- `PayoutBatch`
- `PayoutItem`
- `WebhookEvent`
- `AuditLog`

## 8. Rollback Policy

資料庫 rollback 不能只依賴「反向 migration」。

建議策略：

1. App rollback 優先使用 Vercel previous deployment。
2. DB migration 若已成功但 app 出錯，優先 forward fix 或 app rollback。
3. DB migration 若破壞財務資料，使用 migration 前 snapshot restore 到新 Supabase project。
4. restore 後更新 Vercel `DATABASE_URL` / `DIRECT_URL` 指向復原 DB。
5. Webhook 暫停或切 maintenance mode，避免 restore 期間重複入帳。
6. restore 後跑 reconciliation checks，確認 payment、refund、commission、settlement 一致。

禁止做法：

- 沒有備份就跑破壞性 migration。
- 直接在 production SQL editor 手動修 schema。
- 用 `db push` 覆蓋 production schema。
- 在 webhook 還持續進來時還原 DB，卻沒有暫停或重放策略。

## 9. Deployment 前 DB Checklist

- [ ] Supabase production project 已建立
- [ ] `DATABASE_URL` 已設定在 Vercel production
- [ ] `DIRECT_URL` 已設定在 Vercel production / GitHub Actions secrets
- [ ] `npm run db:migrate:status` 通過
- [ ] Staging 已執行 `npm run db:migrate:deploy`
- [ ] Production migration 前 snapshot 已完成
- [ ] Production 已執行 `npm run db:migrate:deploy`
- [ ] Production 不執行 demo seed
- [ ] Production bootstrap 只 upsert billing plans
- [ ] Smoke test 通過
- [ ] Backup restore drill 完成
- [ ] 備份形式與 organization plan 相符，且 backup / restore evidence 不含 secret 或 customer data
- [ ] Webhook retry / reconciliation 沒有異常

### 9.1 非 TWD 商品與交易盤點（唯讀，F-041）

平台的結帳、PayUni 交易、退款與月結只支援新台幣（TWD）。程式現在會拒絕非 TWD：
商品表單只送出 `TWD`、checkout 回 `422 UNSUPPORTED_CURRENCY`、PayUni 金額轉換拒絕非 TWD、
月結遇到非 TWD 交易會停止並回報 `unsupported_currency`。既有資料不用 migration 改寫，
上線前先在 staging／production 以唯讀連線執行下列查詢（需 owner 授權連線），結果為空才算通過：

```sql
-- 只讀：非 TWD 商品（含停用），供人工決定改價或下架
SELECT "vendorId", "id", "currency", "priceCents", "compareAtCents", "isActive"
FROM "Product"
WHERE "currency" <> 'TWD'
ORDER BY "vendorId", "id";

-- 只讀：非 TWD 付款交易（會讓該商家月結停止）
SELECT "vendorId", "currency", "status", COUNT(*) AS transactions, SUM("grossAmountCents") AS gross_cents
FROM "PaymentTransaction"
WHERE "currency" <> 'TWD'
GROUP BY "vendorId", "currency", "status"
ORDER BY "vendorId", "currency", "status";
```

若有結果：非 TWD 商品由商家在後台重新以新台幣填價並勾選確認後儲存（表單會要求確認，不會自動換匯）；
非 TWD 交易需人工對帳後再產生月結，不可直接以 SQL 改幣別。月結也會在當月出現屬於非 TWD 交易的退款時停止。

### 9.2 PayUni 退款事件 ID 變更前檢查（唯讀，PR #454 A-1）

舊式（非 UPP）退款通知現在以 provider 退款序號（`CloseNo`，其次 `RefundNo`）作為事件 ID；沒有序號的
退款通知不會自動入帳，而是建立 `needs_manual_reconciliation` 事件並告警。部署前確認沒有以舊 ID 卡住、
之後可能被 retry 重放的 PayUni 退款事件，結果為空才部署：

```sql
-- 只讀：仍可能被 webhook retry 重放的 PayUni 退款類事件
SELECT "id", "eventId", "eventType", "status", "retryCount", "createdAt"
FROM "WebhookEvent"
WHERE "provider" = 'payuni'
  AND "eventType" IN ('refunded', 'partially_refunded')
  AND "status" IN ('received', 'retrying', 'failed')
ORDER BY "createdAt";
```

若有結果，先人工對帳（比對 PayUni 後台退款紀錄與 `RefundRecord.providerEventId`）再決定是否處理，
不要直接 retry。部署後若退款通知與只帶 TradeNo 的既有退款無法區分，webhook 會以 `order_ambiguous` 失敗，
同樣交由財務人工對帳。

## 10. 參考資料

- Supabase Prisma guide: https://supabase.com/docs/guides/database/prisma
- Supabase changelog：public schema 新表不再預設暴露 Data API: https://supabase.com/changelog
