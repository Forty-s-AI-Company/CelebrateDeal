# Prisma migration 防護 runbook

適用：F-026（B02-03、B04-08）、F-063（B04-09）、B04-04。最後更新：2026-10-20。

## 1. 所有 public 表啟用 RLS（`20261020090000_enable_rls_all_tables`）

- 對 `public` 中 `relkind in ('r','p')` 且尚未啟用的表執行 `ENABLE ROW LEVEL SECURITY`。不建立 policy，不使用 `FORCE`。Prisma 以 table owner 連線，不受影響；Supabase Data API 角色（`anon`、`authenticated`）在沒有 policy 時一律拒絕，加上沒有 grant，形成兩道防線。
- 預設權限沿用 `20260724150000_harden_supabase_data_api`，本 migration 不重做。
- 可重跑：只處理 `relrowsecurity = false` 的表；全部已啟用時不做任何事。
- 鎖：每張表需要短暫的 ACCESS EXCLUSIVE（只改 catalog，不重寫、不掃表）。migration 內設定交易層級的 `lock_timeout = 5s`。遇到長交易時整個 migration 回滾，不會讓後續請求排隊。重試步驟：
  1. 找出並等待長交易結束（`pg_stat_activity`）。
  2. `npx prisma migrate resolve --rolled-back 20261020090000_enable_rls_all_tables`
  3. `npx prisma migrate deploy`
- 部署前在 staging 唯讀確認（需要 owner 授權）：
  - 應用程式的連線角色是所有 public 表的 owner，或具備 `BYPASSRLS`。否則啟用 RLS 後，該角色讀不到資料。
    `select c.relname, pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and pg_get_userbyid(c.relowner) <> current_user;`（以應用程式角色執行，預期 0 列；如果有列，再確認 `select rolbypassrls from pg_roles where rolname=current_user`）
  - 部署後：`... and not relrowsecurity` 應為 0 列。
- CI 守門：`src/lib/rls-catalog.db.test.ts` 在 `npm run test:coverage` 的 disposable PostgreSQL 執行，會斷言以下四點：每張 public 表都已啟用 RLS；`anon`、`authenticated`、PUBLIC 沒有任何表權限；沒有 policy 開放給這三者；新建的表不會透過預設權限交給這兩個角色。本機 PostgreSQL 沒有這兩個角色時，測試會先建立 NOLOGIN role。

## 2. Migration 名稱單調性（`scripts/migration-order-check.mjs`）

- CI 的 `Migration name order` 步驟排在 `migrate deploy` 前面。PR 新增的 migration 目錄必須符合 `<YYYYMMDDHHMMSS>_<snake_case>`，而且名稱要排在 `origin/master` 最新的 migration 之後。merge base 上已有的 migration 不能刪除或改名。
- 失敗時：rebase 到最新的 master，把新的 migration 目錄改成更晚的時間戳，同步更新 `PRISMA_INVARIANTS.md` 裡的名稱，然後重跑。
- 本機：`node scripts/migration-order-check.mjs`（可用 `MIGRATION_ORDER_BASE_REF` 指定其他 base ref）。

## 3. Schema drift（`scripts/prisma-drift-check.mjs`）

- CI 的 `Prisma schema drift against migrations` 步驟會建立專用的 `celebratedeal_shadow_ci` 庫，然後執行：

  ```bash
  npx prisma migrate diff --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url <loopback>/celebratedeal_shadow_ci --script
  ```

  輸出的每一句都必須列在 `scripts/prisma-drift-allowlist.json`。不在清單上的句子，代表出現新的 drift，檢查失敗。清單上的句子如果消失了，檢查也會失敗：可能是 schema 已經修正，也可能是某個 migration 刪掉了該物件，兩種情況都要在同一個 PR 裡刻意更新 allowlist。
- 這份輸出就是 `prisma migrate dev` 下一次會產生的 SQL，其中包含 `DROP INDEX`（trgm GIN）、`DROP CONSTRAINT`（租戶複合 FK）。**禁止把 `migrate dev` 的輸出直接提交成 migration**；新 migration 一律手寫，或逐句人工檢查。
- Prisma 6 不比對 partial index，所以 4 個 partial unique（`ConsultationBooking_active_slot_key`、`LiveQuestion_one_spotlight_per_live_key`、`PostPurchaseCredit_vendorId_sourceOrderId_active_key`、`TeamMembershipRelationship_one_active_upline`）和 3 個 trgm GIN 改由 `src/lib/prisma-unmanaged-indexes.db.test.ts` 直接斷言存在。
- 本機（shadow 只接受 loopback 上的 `celebratedeal_shadow_ci` 或 `celebratedeal_e2e`，Prisma 會清空它）：

  ```bash
  PRISMA_DRIFT_SHADOW_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/celebratedeal_e2e?schema=public \
    node scripts/prisma-drift-check.mjs                 # 比對 allowlist
  PRISMA_DRIFT_SHADOW_DATABASE_URL=... node scripts/prisma-drift-check.mjs --print-statements   # 列出目前所有 drift
  ```

- 2026-10-20 基準共 100 句：trgm GIN 3、schema 未宣告的一般索引 3、schema 未宣告的 FK 11、FK 形狀不符 3、欄位 default 1、FK 名稱不符 54、索引名稱不符 25（大多是 PostgreSQL 63 bytes 截斷）。逐步把一般索引與名稱補進 schema（`@@index(..., map: "原名")`、relation `map:`）之後，同步刪掉對應的 allowlist 條目。
