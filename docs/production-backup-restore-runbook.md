# CelebrateDeal Production 自管備份／還原 Runbook

適用於 Supabase Free Plan 無 managed project backups 的期間。本方案使用加密邏輯備份，不取代正式收費後應評估的 provider-managed backups 或 PITR。Supabase 升級 Pro 之後的步驟見文末 §A～§E（2026-10-19 新增，F-058／F-074）。

## 安全界線

- 僅可使用 Production 的 `DIRECT_URL`，並由 SecretManagement 或 Windows Credential Manager 在執行期注入。Credential Manager 使用時，完整連線字串僅放在 credential password 欄位。
- 禁止把連線字串、密碼、token、age 私鑰、備份檔或解密檔提交至 Git、寫入腳本或放入 log。
- 備份目的地必須是既有的 off-site、存取控制目的地；不可只保存在同一台執行 Windows 的電腦。
- Google Drive adapter 必須使用專用帳號或專用資料夾，並以 rclone `drive.file` scope 優先限制存取範圍。rclone OAuth config 與 remote path 只能由執行期 secret 注入。
- 還原演練只能對隔離目標進行，絕不可覆蓋 Production。

## 作業節奏

| 項目 | 目標 |
|---|---|
| 每日邏輯備份 | 每日一次，正式販售前至少連續 7 日成功 |
| 付款／migration 前備份 | 每次重大資料變更前 |
| RPO | 初始 24 小時；有常態付款後調整為 4–8 小時 |
| RTO | 初始 60 分鐘內完成隔離 restore 與驗證 |
| 保留 | 7 daily / 4 weekly / 3 monthly |
| 還原演練 | 每月一次，及每次備份工具重大變更後 |

## 驗收順序

1. 先跑 `ops/backup/tests/Test-BackupTooling.ps1`，確認工具只有 plan mode。
2. 管理者在受控終端機設定秘密與 public recipient，並確認 off-site 目的地 ACL。
3. 在明確核准後執行一次加密備份。
4. 離線執行 archive verification：checksum、解密與 `pg_restore --list`。
5. 對隔離 PostgreSQL／獨立 Supabase 專案執行 restore drill，記錄實測 RTO 與 aggregate 一致性。乾淨的本機 PostgreSQL 預設只還原應用程式擁有的 `public` schema；完整加密 archive 仍保留 Supabase 管理 schema，平台層完整還原需使用隔離 Supabase 專案另行演練。
6. 只有上述證據齊全，才可勾選 go-live checklist 的 backup restore gate。

## 保留與告警

- 在第一輪 restore drill 簽核前，只能人工檢視 retention，禁止自動刪除 archive。
- 簽核後才可由備份擁有者依 7 daily / 4 weekly / 3 monthly 規則刪除過期的**加密** archive。
- Task Scheduler 必須設定非零 exit code 的告警；可選 alert handler 僅接收 `Status`、`ArchiveId`、`ErrorCategory`，不可接收或回傳 secret。
- Google Drive adapter 上傳後必須以 rclone checksum check 驗證；驗證失敗不得標記備份成功。

## 何時升級 provider-managed backup

開始正式收費、RPO 低於 24 小時、需要 PITR、無法維護 Windows 排程與異地保存，或 restore drill 未能穩定達到 RTO 時，應改採含 backups 的 Supabase 方案或同等受管備份服務。

---

## A. Supabase Pro：每日備份與 PITR（F-058／B04-01，等 owner 升級，D-07）

本節在 owner 完成 Supabase 升級後才執行；本 repo 的程式與代理都不會自行升級、啟用或還原。

1. **確認專案與區域**：Dashboard 左上角確認是 production 專案（目前在 `ap-south-1` 孟買，與 Vercel `hnd1` 跨區，見 `docs/staging-production-env-vars.md` §6）。先決定是否遷移到東京；遷移本身就是一次完整的備份＋還原，應在本 runbook 的演練通過之後做。
2. **升級方案**：Organization → Billing → 改為 Pro。Pro 會自動開始每日備份（保留 7 天），不需要額外設定。
3. **確認每日備份**：Project → Database → Backups → Scheduled backups，隔天確認出現第一筆，記下時間（UTC）與狀態，不記錄任何連線資訊。
4. **（選用）啟用 PITR**：RPO 要低於 24 小時才需要。Project Settings → Add-ons → Point in Time Recovery，選保留天數；PITR 需要較大的 compute add-on，費用由 owner 決定。啟用後 Database → Backups 會出現 Point in Time 分頁。
5. **禁止在原專案按 Restore 做演練**：Supabase 的 Restore 會覆寫該專案。演練一律走 §B 的隔離還原；若 Dashboard 提供「還原到新專案」，只能還原到新建立、名稱含 `restore-drill` 的專案，演練結束後刪除。
6. **自管加密備份照常保留**：provider 備份與 `ops/backup` 的加密邏輯備份互為備援；至少在第一次隔離還原演練簽核前，兩者都要有。
7. 每一步完成後，在 `reports/` 的收據記錄：日期、操作者、方案、備份保留天數、PITR 是否啟用。不寫任何連線字串、專案 ref 以外的識別資料。

## B. 隔離還原演練（還原到 loopback PostgreSQL 17）

目標：證明「一份真實備份可以在隔離環境還原、帳務數字一致」，並量測 RTO。全程不碰 Production 的寫入，也不覆寫任何既有資料庫。

0. **備份當下產生彙總快照**（PR #447 審查 m4）：與 `pg_dump` 同一個 snapshot（例如先 `pg_export_snapshot()` 再以 `--snapshot` 傾印），或在備份完成後立刻以唯讀連線，對來源跑一次 §C 的 SQL，把輸出與 archive 一起加密保存（例如 `<archive-id>.aggregates.txt.age`）。只記聚合值，不含個資。使用 PITR 還原時，改在還原出的時間點產生這份快照。
1. **準備隔離目標**：本機 PostgreSQL 17，只聽 `127.0.0.1`，建立空資料庫 `celebratedeal_restore_drill_<日期>`。連線字串存在 SecretManagement（例如 `CelebrateDeal.Restore.IsolatedTarget`），`sslmode=disable` 只允許 loopback（`Set-CelebrateDealPostgresEnvironment -AllowLocalNonTls` 會強制檢查）。
2. **乾跑**：

   ```powershell
   pwsh -File ops/backup/Invoke-CelebrateDealRestoreDrill.ps1 `
     -EncryptedArchive <archive.dump.age> `
     -IsolationTargetSecretName CelebrateDeal.Restore.IsolatedTarget `
     -DryRun
   ```

   `-DryRun` 只檢查 archive 是否存在、`age`／`pg_restore`／`psql` 是否可用，並印出完整步驟、擴充準備 SQL 與 `pg_restore` 參數；不讀密鑰、不解密、不連資料庫，即使同時帶 `-Execute` 也一樣。
3. **執行**：同一指令改帶 `-Execute -Confirmation RESTORE-TO-ISOLATED-TARGET`。腳本會：解密到暫存檔 → 以 `pg_restore --schema-only` 找出 archive 期望的 `pg_trgm` schema（見 §D）→ 在目標建立 `extensions` schema、`pgcrypto` 與 `pg_trgm` → 只還原 `public` → 刪除暫存檔。成功時輸出 `{"isolatedRestore":"passed","elapsedSeconds":…,"trigramExtensionSchema":…}`，失敗只輸出安全分類（例如 `pg_restore_extension_compatibility`）。
4. **驗證結構與筆數**：`ops/backup/Test-CelebrateDealRestoreEvidence.ps1 -Execute`（逐表 count、migration 清單、欄位結構）。
5. **驗證帳務彙總**：對隔離還原庫跑 §C 的 SQL，與第 0 步「備份當下的彙總快照」逐列比對，必須完全相同。**不要拿持續寫入中的 Production 比對**：備份後的任何交易、退款或結算都會讓比對失敗，失去驗收作用。
6. **驗證加密資料可讀**（需 owner 明確授權後才執行）：
   - 預設只在 **staging 備份＋staging 的 `CSRF_SECRET`＋合成資料**上做；不得把 Production 根金鑰與可解密的正式個資同時放到開發機。
   - 不啟動整個 app；用只解密單一欄位、只輸出 PASS／FAIL 的唯讀腳本抽查一筆合成資料的加密欄位（腳本尚未建立，列為待辦）。若暫時只能起 app，必須清空所有 provider env（Email、LINE、PayUni、Sentry DSN、Cloudflare），且只連隔離還原庫。
   - Production 備份的解密驗證，需要 owner 另行授權並指定執行環境與在場人員。
   - 缺對應金鑰就判定演練失敗（見 §E）。
7. **收尾**：刪除隔離資料庫與暫存檔；把 §C 的比對結果與 RTO 記到下方表格與 `reports/` 收據（只記數字與 PASS／FAIL）。

### RTO 記錄表

| 日期 | 備份來源（provider daily／PITR／ops 加密備份） | 備份時間（UTC） | migration 數 | 解密＋還原秒數（`elapsedSeconds`） | 驗證完成總分鐘數 | 結構一致 | 帳務彙總一致 | 加密欄位可讀 | 執行者 | 簽核者 |
|---|---|---|---|---|---|---|---|---|---|---|
| （第一次演練填寫） | | | | | | | | | | |

目標：初始 RTO 60 分鐘內（本文件「作業節奏」表）；超過就記錄原因並調整。

## C. 帳務彙總一致性檢查 SQL

只回傳筆數與加總，不含任何個資。備份當下的快照（§B 第 0 步）與隔離還原庫各跑一次，輸出必須逐列相同。2026-10-19 已在套用全部 108 條 migration 的 loopback PostgreSQL 17（空資料庫）執行成功，命令與輸出見 `reports/review-2026Q4/B-line-B4-loopback-receipt.md`。

```sql
SELECT 'migrations' AS item, count(*)::text AS row_count, NULL::text AS sum_1, NULL::text AS sum_2, NULL::text AS sum_3
  FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL
SELECT 'PaymentTransaction:' || status, count(*)::text,
       sum("grossAmountCents")::text, sum("netAmountCents")::text, sum("refundedAmountCents")::text
  FROM public."PaymentTransaction" GROUP BY status
UNION ALL
SELECT 'RefundRecord:' || status, count(*)::text,
       sum("refundAmountCents")::text, sum("gatewayFeeRefundCents")::text, sum("platformFeeRefundCents")::text
  FROM public."RefundRecord" GROUP BY status
UNION ALL
SELECT 'Settlement:' || status || ':' || CASE WHEN "lockedAt" IS NULL THEN 'unlocked' ELSE 'locked' END, count(*)::text,
       sum("grossRevenueCents")::text, sum("payoutableAmountCents")::text, sum("finalPayoutAmountCents")::text
  FROM public."Settlement" GROUP BY status, ("lockedAt" IS NULL)
UNION ALL
SELECT 'Invoice:' || status, count(*)::text,
       sum("subtotalCents")::text, sum("taxCents")::text, sum("totalCents")::text
  FROM public."Invoice" GROUP BY status
UNION ALL
SELECT 'AffiliateCommission:' || status::text, count(*)::text,
       sum("orderAmountCents")::text, sum("commissionBaseAmountCents")::text, sum("commissionAmountCents")::text
  FROM public."AffiliateCommission" GROUP BY status
UNION ALL
SELECT 'AffiliatePayout:' || status, count(*)::text,
       sum("commissionAmountCents")::text, sum("adjustmentAmountCents")::text, sum("finalAmountCents")::text
  FROM public."AffiliatePayout" GROUP BY status
UNION ALL
SELECT 'CoursePayout:' || status, count(*)::text,
       sum("commissionAmountCents")::text, sum("adjustmentAmountCents")::text, sum("finalAmountCents")::text
  FROM public."CoursePayout" GROUP BY status
UNION ALL
SELECT 'PayoutItem:' || status, count(*)::text,
       sum("payoutAmountCents")::text, NULL::text, NULL::text
  FROM public."PayoutItem" GROUP BY status
UNION ALL
SELECT 'WebhookEvent:' || status, count(*)::text, NULL::text, NULL::text, NULL::text
  FROM public."WebhookEvent" GROUP BY status
ORDER BY 1;
```

欄位對照（單位都是分）：PaymentTransaction 的 sum_1～3 是 gross／net／refunded；RefundRecord 是 refund／gatewayFeeRefund／platformFeeRefund；Settlement 依 `status` 與是否鎖定分組，是 grossRevenue／payoutable／finalPayout；Invoice 是 subtotal／tax／total；AffiliateCommission 是 orderAmount／commissionBase／commission；AffiliatePayout 與 CoursePayout 是 commission／adjustment／final；PayoutItem 是 payoutAmount；WebhookEvent 只計數。

## D. `pg_trgm` 擴充的 schema（F-074／B04-21）

- migration `20260810051000_g7_54_form_submission_search_indexes` 執行 `CREATE EXTENSION IF NOT EXISTS pg_trgm` 時沒有指定 schema，`gin_trgm_ops` 也沒有限定，所以位置取決於當時的 `search_path`，**不能假設，一律以中繼資料查詢或 archive DDL 為準**。已知事實：staging（主對話 2026-10-19 唯讀查證）的 `pg_trgm` 在 `public`（1.6），`pgcrypto` 與 `uuid-ossp` 在 `extensions`；loopback PG17 套用全部 migration 後也在 `public`。Production 尚未查證。
- `pg_dump` 會把 index 寫成 `extensions.gin_trgm_ops` 或 `public.gin_trgm_ops`，但只還原 `public` 時不會帶出擴充本身，所以目標若沒有在同一個 schema 預先建立 `pg_trgm`，三個 `FormSubmission_*_trgm_idx` 會建立失敗（2026-09-29 收據的失敗原因；2026-10-19 以合成資料在 loopback PG17 對兩種放置方式重現並驗證修正，命令與輸出見 `reports/review-2026Q4/B-line-B4-loopback-receipt.md`）。
- `Invoke-CelebrateDealRestoreDrill.ps1` 的處理：`-TrigramExtensionSchema auto`（預設）從 archive 的 schema-only DDL 找出被引用的 schema；找不到就用 `extensions`；同時引用兩個 schema 就停止。目標上若已有 `pg_trgm` 但在別的 schema，會 `ALTER EXTENSION pg_trgm SET SCHEMA` 搬過去。也可手動指定 `extensions` 或 `public`。
- staging 的 GitHub 還原 runner（`scripts/staging-backup-recovery.mjs`）原本固定在 `extensions` 建立，對 staging（`public`）一定會失敗。已改為先以 `pg_restore --schema-only` 讀 archive 的 index DDL，照來源位置建立 `pg_trgm`（`pgcrypto` 仍在 `extensions`），兩種位置都有測試。這個檔案不在 `staging-backup-recovery-source.mjs` 的 blob 白名單內（白名單只鎖備份端的檔案），先前「受 blob 白名單保護」的說法是錯的。
- 日後的新 migration：建立擴充一律寫 `WITH SCHEMA extensions`，operator class 寫成 `extensions.gin_trgm_ops`。既有 migration 不改（migration 只能往前）。

## E. `CSRF_SECRET`：備份與還原必須一併處理的加密根金鑰（F-031①／B04-03）

- `CSRF_SECRET` 是應用層資料加密根金鑰（`src/lib/sensitive-data.ts` 以它經 HMAC 衍生 AES-256-GCM 金鑰；沒有它時改用 `JOB_SECRET`）。MFA secret、LINE 憑證、買家與收件個資、私訊、tracking token、學員通知、發票請求、交付網址與各種雜湊索引都依賴它。詳細清單見 `docs/staging-production-env-vars.md` §7。
- **禁止輪替。** 目前密文沒有 key id，換金鑰等於所有加密資料永久不可讀。
- **每份備份都要能對應到備份當下的 `CSRF_SECRET` 版本**（若該環境曾以 `JOB_SECRET` 作為來源，也要保存）。金鑰放在與備份分開保管的密碼管理器，備份清單只記「金鑰版本代號」，不記值。
- **還原時缺對應金鑰＝加密資料全部不可讀**：資料表、筆數、§C 的帳務彙總都會一致，但個資與 MFA 無法解密、雜湊查詢全部對不上。因此 §B 第 6 步「加密欄位可讀」是必要驗收項，不可省略。
- age 私鑰（解密備份檔）與 `CSRF_SECRET`（解密欄位）是兩把不同的金鑰，兩把都要在還原時可取得，且都不得與備份檔放在同一處。
