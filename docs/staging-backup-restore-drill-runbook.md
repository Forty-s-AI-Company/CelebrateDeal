# CelebrateDeal Staging 備份與還原演練 Runbook

最後驗證：2026-07-22

## 1. 目的與範圍

這份文件只處理 CelebrateDeal 的 **Supabase Staging PostgreSQL**。目標是讓團隊能驗證邏輯備份可讀、可還原、migration history 完整，且還原過程不會碰到 Production。

本文件不授權下列操作：

- 還原到目前正在使用的 Staging project。
- 建立或刪除 Supabase project。
- 修改 Production 資料庫、Vercel、付款或退款。
- 將備份、資料庫 URL、密碼、access token、測試資料或 customer data 放進 Git、測試報告或聊天紀錄。

## 2. 2026-07-22 已驗證狀態

| 項目 | 狀態 | 結論 |
| --- | --- | --- |
| Staging project | `ACTIVE_HEALTHY`，Tokyo | 可作為來源資料庫。 |
| Supabase organization plan | Free | 不可把平台自動日備份當成已具備的保護。 |
| PITR | 未啟用 | 不能選擇秒級時間點還原。 |
| 可列出的邏輯備份 | 0 | 目前沒有可用的 dashboard 邏輯備份證據。 |
| 既有演練 | 隔離 PostgreSQL container 邏輯還原通過，RTO 21 秒 | 驗證了 SQL 還原步驟，不能當作 Supabase project restore 證據。 |
| WSL direct connection | 不可達 | `db.<project-ref>.supabase.co:5432` 只解析 IPv6，而目前 WSL 沒有 IPv6 egress。 |
| WSL 備份工具 | 未就緒 | 現有 `supabase` 指向 Windows binary，且沒有 `pg_dump` / `psql`。 |

Supabase 的 Free project 沒有可存取的每日自動備份；官方建議定期用 CLI 匯出邏輯備份並存放在站外安全位置。Pro、Team、Enterprise 才有 dashboard 每日備份，PITR 則是付費 add-on。詳見 [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups) 與 [Supabase Billing](https://supabase.com/docs/guides/platform/billing-on-supabase)。

## 3. 現行 Staging 保護策略

在未升級方案前，Staging 的有效策略是「加密邏輯匯出 + 隔離目標還原演練」。每次至少產生三個主備份檔，另加一組 migration history：

1. `roles.sql`：custom roles。
2. `schema.sql`：schema、constraints、indexes、functions 與 policies。
3. `data.sql`：`public` schema 的資料。

備份檔必須放在 repository 外的加密位置，例如受權限控管的密碼管理附件或加密 object storage。只在同一台開發電腦暫存不算站外備份。

資料庫備份不包含 Supabase Storage 實體物件，只保存 metadata。CelebrateDeal 的影片由 Cloudflare Stream 管理，也不會被 PostgreSQL dump 覆蓋；影片來源、Storage 檔案與資料庫 mapping 必須分開盤點。詳見 [Supabase 的備份限制](https://supabase.com/docs/guides/platform/backups)。

## 4. 演練前必備條件

以下條件有一項缺少，就只做備份可讀驗證，不進行外部 restore：

- 使用 Linux 原生 Supabase CLI、Docker Desktop 與 `psql`。目前 WSL 的 Windows CLI binary 不能使用。
- 來源與目標都使用 Session Pooler URL。Supabase 對不支援 IPv6 的環境建議 Session Pooler；不需要為此購買 IPv4 add-on。詳見 [CLI backup / restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) 與 [連線方式](https://supabase.com/docs/guides/database/connecting-to-postgres)。
- 一個全新、隔離、明確標為 restore drill 的 Supabase target project，或一個同等隔離的 PostgreSQL target。不得使用目前的 Staging project 當 target。
- 來源與 target 的資料庫連線字串都由本機安全環境注入；不得寫入 `.env.example`、commit、shell history 或 command output。
- 已確認 target 沒有任何需要保留的資料，且具有刪除 target 的人工授權。
- 已安排 Staging 外部 webhook 暫停或測試模式，避免 restore 演練期間收到真實 callback。

目前 Free organization 已有 Production 與 Staging 兩個 active project。若沒有可用的第三個隔離 target，建立 target 可能需要調整方案、付費或暫停既有 project；這三種情況都必須先取得人工授權。

## 5. 備份程序

執行者先在安全的 shell 設定這三個變數。`BACKUP_DIR` 必須是 Git repository 之外、已加密且 ACL 受限的目錄。

```bash
export SOURCE_DB_URL='從 Supabase Connect 取得的 Staging Session Pooler URL'
export BACKUP_DIR='/secure/location/celebratedeal-staging-YYYYMMDDTHHMMSSZ'
```

建立目錄與權限後，使用 Supabase CLI 依序匯出。CLI 的預設 dump 不含資料與 custom roles，因此主備份與 migration history 命令都不可省略。

```bash
install -d -m 700 "$BACKUP_DIR"

supabase db dump --db-url "$SOURCE_DB_URL" --role-only --file "$BACKUP_DIR/roles.sql"
supabase db dump --db-url "$SOURCE_DB_URL" --schema public --file "$BACKUP_DIR/schema.sql"
supabase db dump --db-url "$SOURCE_DB_URL" --data-only --use-copy \
  --schema public \
  --exclude 'storage.buckets_vectors' \
  --exclude 'storage.vector_indexes' \
  --file "$BACKUP_DIR/data.sql"
supabase db dump --db-url "$SOURCE_DB_URL" --schema supabase_migrations \
  --file "$BACKUP_DIR/history-schema.sql"
supabase db dump --db-url "$SOURCE_DB_URL" --data-only --use-copy \
  --schema supabase_migrations --file "$BACKUP_DIR/history-data.sql"

sha256sum "$BACKUP_DIR"/*.sql > "$BACKUP_DIR/SHA256SUMS"
```

只記錄檔名、檔案大小、SHA-256、建立時間與執行者，不記錄 connection string、SQL 內容、資料列內容或 customer data。

## 6. 還原演練程序

這段程序會寫入 target project。執行前需要明確人工授權，並確認 target 是全新 restore drill 專案。

1. 在 Supabase Dashboard 建立隔離 target，名稱標記為 `celebratedeal-restore-drill-YYYYMMDD`。不要使用 Production 或現有 Staging。
2. 取得 target Session Pooler URL，僅在當次安全 shell 設定 `TARGET_DB_URL`。
3. target 有 custom roles 或額外 extension 時，先依需求啟用。自訂角色的密碼不會包含在 Supabase 備份，還原後必須重新設定。
4. 先撤銷 target `public` schema 的預設 table privileges，避免 target 在 restore 後意外保留過寬權限：

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE ALL ON TABLES FROM anon, authenticated;
```

5. 以單一 transaction 還原 roles、schema、data 與 migration history。任何一個 SQL error 都要停止，不能略過。

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$BACKUP_DIR/roles.sql" \
  --file "$BACKUP_DIR/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$BACKUP_DIR/data.sql" \
  --file "$BACKUP_DIR/history-schema.sql" \
  --file "$BACKUP_DIR/history-data.sql" \
  --dbname "$TARGET_DB_URL"
```

6. 重新啟用必要的 Database Webhooks、extensions、Realtime publications 與最小 RLS / grants。這些服務設定不能因 SQL dump 成功就假設已復原。
7. 在 target 上執行 `npm run db:migrate:status`，確認 migration history 與 repository 一致。不可執行 `prisma migrate dev`、`prisma db push`、`prisma migrate reset` 或 demo seed。
8. 以 aggregate query 抽查 `Vendor`、`User`、`VendorMember`、`PaymentTransaction`、`RefundRecord`、`Settlement`、`PayoutBatch`、`PayoutItem`、`WebhookEvent`、`AuditLog` 的筆數與關聯完整性。只存 pass / fail 與筆數差異，不匯出個資或金流內容。
9. 量測從開始還原到上述驗證完成的時間，寫入演練紀錄。RTO 必須以這次真實 target 演練為準，不能沿用本機 container 的 21 秒。
10. 經人工確認驗收完成後，才刪除 temporary target 與本機短暫副本；保留加密的 source backup 與 SHA-256 manifest 至保留週期結束。

## 7. Restore Drill Checklist

### 執行前

- [ ] 來源確認是 CelebrateDeal Staging，非 Production。
- [ ] target 是新建隔離 restore drill project，非現有 Staging。
- [ ] 已取得建立與刪除 target 的人工授權。
- [ ] `SOURCE_DB_URL`、`TARGET_DB_URL` 僅存在於當次 shell / secret manager。
- [ ] Supabase CLI、Docker Desktop、`psql` 可在 WSL 原生執行。
- [ ] backup storage 已加密、站外、repository 外，且 ACL 最小化。
- [ ] 外部 webhooks 已切成測試模式或暫停。

### 備份與驗證

- [ ] `roles.sql`、`schema.sql`、`data.sql`、migration history 檔都建立成功。
- [ ] 所有檔案的 SHA-256 已寫入 manifest。
- [ ] dump 沒有放進 Git、CI artifact 或可公開的 log。
- [ ] `npm run db:migrate:status` 對 Staging 顯示一致；若 WSL 不能走 direct IPv6，改以 Session Pooler / 支援 IPv6 的 runner 驗證。

### 還原後

- [ ] `psql --single-transaction --variable ON_ERROR_STOP=1` 成功。
- [ ] migration history 與 repository 一致。
- [ ] 重要資料表與外鍵抽查通過。
- [ ] RLS、default privileges、webhooks、extensions、Realtime publications 已重新確認。
- [ ] Cloudflare Stream / Supabase Storage 實體物件另有盤點與復原策略。
- [ ] RTO、備份時間、SHA-256 manifest 與執行者已寫入非敏感演練紀錄。
- [ ] temporary target 的刪除經人工確認，沒有誤刪 Staging / Production。

## 8. 本輪可完成與待人工授權

本輪已完成 Staging project 健康、方案、PITR、可列出備份能力、WSL IPv6 及工具可用性確認。沒有執行 dump、restore、建立 project 或刪除資料。

下一個外部步驟需要人工決定其中一種 target：

1. **付費或可用的臨時 Supabase restore project**：可完成真正的 Supabase-to-Supabase 還原演練。
2. **既有本機隔離 PostgreSQL container**：可再次驗證 SQL 備份與還原，但不代表 Supabase project restore。

在選定 target 前，Staging 備份與還原成熟度維持「文件與本機彩排已完成，平台級 restore drill 未完成」。

## 9. 官方參考

- [Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres)
