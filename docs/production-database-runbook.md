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

`.env` 建議改成：

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:54329/celebratedeal_dev?schema=public"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

第一次建立：

```powershell
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

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

Production migration 指令：

```powershell
npm run db:generate
npm run db:migrate:status
npm run db:migrate:deploy
```

Production 禁止：

- 禁止使用 `prisma db push`。
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

- Supabase daily backup enabled。
- 每次 production migration 前手動 snapshot。
- 每次月結 lock settlement 前手動 snapshot。
- 每次建立 payout batch 前手動 snapshot。
- 每週至少一次 restore drill 到 staging / restore project。

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

Payout 與 affiliate ledger 的專屬 duplicate preflight、additive rollback boundary 與 snapshot restore 規則見 `docs/database/payout-ledger-migration.md`。

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
- [ ] Webhook retry / reconciliation 沒有異常

## 10. 參考資料

- Supabase Prisma guide: https://supabase.com/docs/guides/database/prisma
- Supabase changelog：public schema 新表不再預設暴露 Data API: https://supabase.com/changelog
