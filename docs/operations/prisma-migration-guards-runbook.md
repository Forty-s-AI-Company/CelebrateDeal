# Prisma migration 防護 runbook

適用：F-026（B02-03、B04-08）、F-063（B04-09）、B04-04。最後更新：2026-10-20（PR #452 審查修正後）。

## 1. 所有 public 表啟用 RLS（`20261020090000_enable_rls_all_tables`）

- 對 `public` 中 `relkind in ('r','p')` 且尚未啟用的表（含 `_prisma_migrations`）執行 `ENABLE ROW LEVEL SECURITY`。不建立 policy，不使用 `FORCE`。Prisma 以 table owner 連線，不受影響；Supabase Data API 角色（`anon`、`authenticated`）在沒有 policy 時一律拒絕，加上沒有 grant，形成兩道防線。
- 預設權限沿用 `20260724150000_harden_supabase_data_api`，本 migration 不重做。
- 目標 schema 是 `current_schema()`，也就是 Prisma 實際 migrate 的 schema（`DIRECT_URL` 的 `?schema=`）。Supabase 上是 `public`，CI 併發測試的 disposable 庫是 `wp17_ci`／`wp18_ci`。該 schema 內沒有 `Vendor` 表時（不用 `_prisma_migrations` 判斷，因為 Prisma 的 shadow 庫重放 migration 時沒有這張表），migration 會直接 `RAISE EXCEPTION`，不會動到其他 schema。兩個 db test 也以連線的 `current_schema()` 為準，所以 `test:db:concurrency` 在 `wp18_ci` 重跑時同樣成立。
- 可重跑：只處理 `relrowsecurity = false` 的表；全部已啟用時不做任何事。

### 1.1 前置條件：migration 角色必須擁有表的 owner 權限

`ENABLE ROW LEVEL SECURITY` 需要 table owner 的權限，`BYPASSRLS` 不夠。執行 `prisma migrate deploy` 的角色（`DIRECT_URL` 的使用者）必須是每張「尚未啟用 RLS」表的 owner，或是會繼承（INHERIT）該 owner 權限的成員。

- migration 會在改動任何表之前先檢查：只要有一張待處理的表不符合 `pg_has_role(current_user, owner, 'USAGE')`，就 `RAISE EXCEPTION`，一次列出所有不符的表名與 owner。這種情況下不會改動任何表。
  - 這裡用 `USAGE`，不用 `MEMBER`。`USAGE` 才代表「實際擁有 owner 的權限」：以 `WITH INHERIT FALSE` 授予的成員，`MEMBER` 為 true 但 `USAGE` 為 false，`ALTER TABLE` 仍然會失敗。凡是 `USAGE` 為 true 的角色，`MEMBER` 一定也為 true。
- staging 現況（2026-10-20 主對話唯讀查證）：public 表 97 張 owner 為 `postgres`、52 張 owner 為 `prisma`。`pg_has_role('postgres','prisma','MEMBER')` 為 true，反向為 false。prisma-owned 的表都已開 RLS，所以以 `postgres` 執行可以成功。
- 部署前，以 **migration 角色**（staging 與 production 各執行一次，唯讀）確認以下查詢回傳 0 列：

  ```sql
  select t.tablename, t.tableowner,
         pg_has_role(current_user, t.tableowner, 'MEMBER') as is_member,
         pg_has_role(current_user, t.tableowner, 'USAGE')  as has_owner_privileges
  from pg_tables t
  where t.schemaname = 'public'
    and not t.rowsecurity
    and not pg_has_role(current_user, t.tableowner, 'USAGE');
  ```

  如果有列：改用那些表的 owner 執行 migration，或先由 owner 把 owner 權限授予 migration 角色。不要在 migration 裡改 owner。
- 應用程式的連線角色也要是所有 public 表的 owner，或具備 `BYPASSRLS`。否則啟用 RLS 後，該角色讀不到資料（沒有 policy 時一律拒絕）。以應用程式角色執行以下查詢，預期 0 列；如果有列，再確認 `select rolbypassrls from pg_roles where rolname = current_user`：

  ```sql
  select tablename, tableowner from pg_tables
  where schemaname = 'public' and not pg_has_role(current_user, tableowner, 'USAGE');
  ```

- `_prisma_migrations` 也會開 RLS。目前 migration 角色是 owner，或具備 `BYPASSRLS`，所以沒有影響。日後如果改用既不是 owner、也沒有 `BYPASSRLS` 的 migration 角色，`migrate` 會讀不到 migration 紀錄，必須先處理。

### 1.2 鎖與部署時段

- `ENABLE ROW LEVEL SECURITY` 只改 catalog，不重寫表、不掃表，但每張表都要取得 ACCESS EXCLUSIVE 鎖，**而且這些鎖會一路持有到 migration commit**。migration 在等第 N 張表時，其他連線對前 N−1 張已鎖的表（依字母序，例如 `AffiliateCommission`、`CommerceOrder`）的讀寫都要排隊。如果 app 交易已持有後面某張表的鎖，又來要前面那張表，就可能 deadlock，被 `deadlock_timeout` 中止的可能是 app 交易。
- migration 設定交易層級的 `lock_timeout = 2s`。這限制了每張表的等待時間，也限制了其他請求的最長排隊時間；整體可能排隊的時間大約等於「待處理表數 × 每張表的取鎖時間」。staging 約有 70 張表要處理。
- **請在低流量時段部署**，部署前先用 `pg_stat_activity` 確認沒有長交易。
- 取不到鎖、owner 檢查失敗或任何錯誤時，整個 migration 回滾，不會改動任何表。但 `_prisma_migrations` 會留下 failed 紀錄，之後所有 deploy 都會被擋住，直到處理完畢：
  1. 排除原因（等長交易結束，或依 1.1 修正執行角色）。
  2. `npx prisma migrate resolve --rolled-back 20261020090000_enable_rls_all_tables`
  3. `npx prisma migrate deploy`
- 部署後確認：`select count(*) from pg_tables where schemaname = 'public' and not rowsecurity;` 應為 0。

### 1.3 CI 守門

- `src/lib/rls-catalog.db.test.ts` 在 `npm run test:coverage` 的 disposable PostgreSQL 執行。`scripts/run-combined-coverage.mjs` 會在 **migrate 之前**建立 `anon`、`authenticated`、`service_role`（NOLOGIN），並模擬 Supabase 的 `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES/SEQUENCES/FUNCTIONS TO anon, authenticated, service_role`。因此 `20260724150000` 的收回、後續 migration 中「角色存在才執行」的語句，都會和在 Supabase 上一樣真正執行。測試會斷言以下四點：
  - 每張 public 表都已啟用 RLS。
  - `anon`、`authenticated`、PUBLIC 沒有任何表權限。
  - 沒有 policy 開放給這三者。
  - 新建的表不會透過預設權限交給這兩個角色。
- 在沒有上述 fixture 的本機庫跑這個測試時，測試會自行建立 NOLOGIN 角色作為 fallback。這種情況下只能證明 RLS 與 PUBLIC 兩部分。
- 注意：role 是 cluster 層級的物件。在 loopback cluster 跑過一次後，`anon`、`authenticated`、`service_role` 會留在該 cluster 的所有資料庫。這些角色不能登入，也不擁有任何物件。

## 2. Migration 名稱單調性（`scripts/migration-order-check.mjs`）

- CI 的 `Migration name order` 步驟排在 `migrate deploy` 前面。
- `prisma/migrations/` 下的**每個目錄**都會檢查，不會因為名稱格式不符就略過。Prisma 會套用任何含 `migration.sql` 的目錄，所以以下這類名稱都會直接判定失敗並列出：camelCase（`20261001000000_AddFoo`）、含連字號、時間戳不是 14 位數。
- PR 新增的目錄必須符合 `<YYYYMMDDHHMMSS>_<lowercase_snake_case>`，而且要排在 base branch 最新的 migration 之後。PR 事件與一般 push 以 `origin/master` 為 base；push 到 master 時以 `HEAD^1`（squash merge 的 parent）為 base，事後也能偵測繞過保護的亂序合併。
- merge base 上已有的 migration 不能刪除、改名或修改內容。內容檢查用 `git diff <merge-base> -- prisma/migrations`，涵蓋已 commit 與尚未 commit 的修改。修改已套用的 migration 會讓已套用的環境與全新環境的 schema 悄悄分歧，`migrate deploy` 本身不會擋。
- 失敗時：
  - 名稱落後：rebase 到最新的 master，把**本 PR 新增、而且尚未套用到任何共用環境（staging 等）**的 migration 目錄改成更晚的時間戳，同步更新 `PRISMA_INVARIANTS.md` 裡的名稱，然後重跑。
  - 如果該 migration 已經套用到共用環境，**不可以改名**：改名後，共用環境會留下舊名的 applied 紀錄，新名又會再套用一次，非冪等的 DDL 會失敗。這種情況要保留原 migration，把需要的變更寫成新的 forward migration。
  - 修改既有 migration：還原修改，改成新增 forward migration。
- 本機：`node scripts/migration-order-check.mjs`（可用 `MIGRATION_ORDER_BASE_REF` 指定其他 base ref，例如 `HEAD^1`）。

## 3. Schema drift（`scripts/prisma-drift-check.mjs`）

- CI 的 `Prisma schema drift against migrations` 步驟會建立專用的 `celebratedeal_shadow_ci` 庫，然後執行：

  ```bash
  npx prisma migrate diff --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url <loopback>/celebratedeal_shadow_ci --script
  ```

  輸出的每一句都必須列在 `scripts/prisma-drift-allowlist.json`。不在清單上的句子，代表出現新的 drift，檢查失敗。清單上的句子如果消失了，檢查也會失敗：可能是 schema 已經修正，也可能是某個 migration 刪掉了該物件。屬於 trgm GIN 與 FK 類別的條目消失時，錯誤訊息會明示「這是租戶／業務不變式，不要刪條目，請修 migration」。
- 這份輸出就是 `prisma migrate dev` 下一次會產生的 SQL，其中包含 `DROP INDEX`（trgm GIN）、`DROP CONSTRAINT`（租戶複合 FK）。**禁止把 `migrate dev` 的輸出直接提交成 migration**；新 migration 一律手寫，或逐句人工檢查。
- 本機（shadow 只接受 loopback 上的 `celebratedeal_shadow_ci` 或 `celebratedeal_e2e`，Prisma 會清空它）：

  ```bash
  PRISMA_DRIFT_SHADOW_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/celebratedeal_e2e?schema=public \
    node scripts/prisma-drift-check.mjs                 # 比對 allowlist
  PRISMA_DRIFT_SHADOW_DATABASE_URL=... node scripts/prisma-drift-check.mjs --print-statements   # 列出目前所有 drift
  ```

- 2026-10-20 基準共 100 句：trgm GIN 3、schema 未宣告的一般索引 3、schema 未宣告的 FK 11、FK 形狀不符 3、欄位 default 1、FK 名稱不符 54、索引名稱不符 25（大多是 PostgreSQL 63 bytes 截斷）。逐步把一般索引與名稱補進 schema（`@@index(..., map: "原名")`、relation `map:`）之後，同步刪掉對應的 allowlist 條目。

### 3.1 drift check 的盲區

Prisma 6 的 `migrate diff` **不比對**以下物件，這些物件被刪除或改寫時，drift check 不會發現：

- partial index：5 個 partial unique（`ConsultationBooking_active_slot_key`、`LiveQuestion_one_spotlight_per_live_key`、`PostPurchaseCredit_vendorId_sourceOrderId_active_key`、`SettlementAdjustmentRequest_one_pending_per_settlement`、`TeamMembershipRelationship_one_active_upline`）。這 5 個連同 3 個 trgm GIN，改由 `src/lib/prisma-unmanaged-indexes.db.test.ts` 比對完整的 `pg_get_indexdef`。
- CHECK constraint，包含帳務與金額相關的 CHECK（B04-07）。
- trigger、function、RLS 狀態、policy、grant（RLS 與 grant 由 `rls-catalog.db.test.ts` 把關）。
- FK 只以名稱比對：同名重建但欄位不同（例如拿掉 `vendorId`）時，diff 仍輸出同一句 DROP，check 會通過。

## 4. 部署前檢查：重複訂單號（`20261021110100_payment_order_number_unique`，F-050）

這條 migration 先檢查 `PaymentTransaction` 是否有重複的 `(providerName, orderNumber)`，有就 `RAISE EXCEPTION` 中止，接著才建 `PaymentTransaction_providerName_orderNumber_key`。如果目標資料庫真的有重複（舊產生器是秒級時間戳加 `Math.random` 6 碼），`migrate deploy` 會停在 failed（P3009），後面的 `20261021110200`、`20261021110300`、`20261021110400` 也一起被擋住。所以部署前必須先用唯讀方式確認。

**步驟**

1. 用唯讀連線（或唯讀交易 `BEGIN READ ONLY; … ROLLBACK;`）在目標資料庫執行下面的查詢。查詢只回傳數量，不輸出訂單號或租戶。

   ```sql
   SELECT count(*) AS duplicate_groups, coalesce(sum(group_rows), 0) AS duplicate_rows
     FROM (
       SELECT count(*) AS group_rows
         FROM "PaymentTransaction"
        WHERE "orderNumber" IS NOT NULL
        GROUP BY "providerName", "orderNumber"
       HAVING count(*) > 1
     ) duplicates;
   ```

2. `duplicate_groups = 0`：把日期與結果記錄到下方表格，再部署。
3. `duplicate_groups > 0`：不要部署。由 owner 授權後逐組人工判斷（哪一筆是 PayUni 實際收款的交易、另一筆是否從未付款），處理完再查一次，結果為 0 才部署。不要修改這條 migration。
4. 若部署時仍失敗（P3009）：確認原因是重複資料後，處理資料，執行 `prisma migrate resolve --rolled-back 20261021110100_payment_order_number_unique`，再重新部署。
5. `CREATE UNIQUE INDEX` 不是 concurrent，建立期間會擋 `PaymentTransaction` 的寫入；目前表很小，仍建議在低流量時段部署。

**查詢紀錄**

| 環境 | 日期 | `duplicate_groups` | 執行者 | 備註 |
|---|---|---|---|---|
| staging | 2026-10-21 | 0 | 主對話（唯讀） | 可套用 F-050 migration |
| production | 待執行 | — | owner | 部署前由 owner 再查一次並補記 |

### 4.1 退款完成後的 post-refund hook 失敗（F-045）

admin、webhook、對帳與非 PayUni 手動退款都在交易內呼叫 `applyPostRefundInTransaction`。如果它因為 inventory reservation 的租戶或商品不一致，或商品回補筆數不是 1 而 throw，代表資料本身不一致，不是暫時性錯誤：PayUni 退款若已成功，本機會停在 pending，之後對帳也會遇到同一個錯誤。遇到這種情況要人工核對 reservation、商品與付款，不要重送退款。本 PR 部署前已完成對帳的歷史退款不會補跑 hook，beta 期間若有這類資料，需另外用唯讀查詢確認庫存。

## 5. 後續項目（不在 PR #452 處理）

1. **11 個租戶 FK 的定義守門**（MINOR-3，B02／B04）：`foreign_key_missing_in_schema` 11 條（`Live_vendorId_formId_fkey`、`Live_vendorId_messageTemplateId_fkey`、`Live_vendorId_videoId_fkey`、`LiveInteractionResponse_formSubmissionId_fkey`、`LiveInteractionResponse_vendorId_runId_fkey`、`PostPurchaseCredit_grant_fkey`、`PostPurchaseCredit_source_fkey`、`PostPurchaseCredit_source_product_fkey`、`PostPurchaseCredit_target_fkey`、`PostPurchaseCredit_target_product_fkey`、`SupportCaseEvent_buyer_case_order_fkey`），加上 `foreign_key_shape_mismatch` 3 條。`prisma migrate dev` 會產生 drop 這些 FK 的語句，而目前只以名稱守門。後續要做三件事：
   - 新增 db test，斷言這 14 條 FK 的 `pg_get_constraintdef` 完全等於預期，做法比照 partial index。
   - 把它們補進 `schema.prisma`，讓 Prisma 不再想刪除它們。
   - 為 allowlist 加上 CODEOWNERS，或規定必須經過 reviewer。
2. **帳務與金額 CHECK 的定義守門**（MINOR-6、B04-07）：以 db test 斷言 `pg_get_constraintdef`，可與第 1 項一起處理。
3. **CI workflow 頂層 `permissions: { contents: read }`**（NIT-3）：另開 PR 處理。

## 6. 部署前檢查：商家撥款帳號 legacy 欄位（`20261021140200`／`20261021140300`，F-073）

`20261021140200_payment_account_payout_verification` 不會因明文資料而失敗：部署當下仍是明文的 legacy 帳號會被改成遮罩值，並為每筆寫一列 `AuditLog`（`action = 'payment_account_legacy_plaintext_masked'`）。被遮罩、又沒有 envelope 的帳號之後不能撥款，必須請商家重新填寫。所以部署前仍要先查、先 backfill：

```sql
SELECT count(*) AS plaintext_rows
  FROM "PaymentAccount"
 WHERE "bankAccountNumber" IS NOT NULL
   AND "bankAccountNumber" NOT LIKE '****%';
```

- `plaintext_rows = 0`：記錄後部署。
- `plaintext_rows > 0`：先在同一環境跑 backfill（需 `BANK_ACCOUNT_KEYRING_JSON` 與 owner 授權），再查一次：
  1. `npx tsx scripts/backfill-bank-account-encryption.ts`：只輸出計畫（各類列數），不改資料。`incompleteAccounts`、`unrecoverableMaskedAccounts`、`unrecoverableMaskedPayouts` 任一大於 0 時要人工處理（請商家在 `/billing/payouts` 重新填寫帳號），backfill 會拒絕執行。
  2. `BANK_ACCOUNT_BACKFILL_CONFIRM=ENCRYPT_LEGACY_BANK_ACCOUNTS npx tsx scripts/backfill-bank-account-encryption.ts --execute [--batch-size 100]`：逐批加密並提交，中斷後重跑即可接續。
- 部署後查 `SELECT "vendorId", "targetId" FROM "AuditLog" WHERE action = 'payment_account_legacy_plaintext_masked'`：有列就通知那些商家重新填寫撥款帳號。
- 鎖：Prisma 把每個 migration 檔當成一個隱含交易，`ADD CONSTRAINT ... NOT VALID` 取得的 ACCESS EXCLUSIVE 會持有到該檔 commit；所以 `VALIDATE CONSTRAINT` 放在**另一個** migration（`20261021140300_payment_account_masked_check_validate`），在自己的交易內只取 SHARE UPDATE EXCLUSIVE，不擋讀寫。同一個檔案裡先 NOT VALID 再 VALIDATE 沒有效果。
- 先 `migrate deploy` 成功，才 promote 新版 app：新版程式會讀 `archivedAt`、`payoutEligibleAt`，舊 schema 上會出現 column does not exist。

| 環境 | 日期 | `plaintext_rows` | 執行者 | 備註 |
|---|---|---|---|---|
| staging | 待執行 | — | 主對話（唯讀） | |
| production | 待執行 | — | owner | 部署前由 owner 查詢並補記 |
