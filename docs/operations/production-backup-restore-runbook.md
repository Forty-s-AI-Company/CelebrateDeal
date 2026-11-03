# Production 備份 workflow 與隔離還原演練

對應：O-20(b)、F-058（還原演練收據）、F-074（`pg_trgm` 位置）、F-064（migration 前必須有備份）。
相關文件：`docs/production-backup-restore-runbook.md`（自管備份總覽、§B 隔離還原步驟、§C 帳務彙總 SQL、§D `pg_trgm`、§E `CSRF_SECRET`）、`docs/production-database-runbook.md` §5.1（`production-migrate.yml`）、`docs/launch/staging-backup-recovery.md`（staging 版的做法）。

本文件只說明 GitHub 上的 `Production backup` workflow：它產生什麼、怎麼觸發與核准、怎麼拿它的產物做隔離還原演練並記錄 RTO。Supabase 受管備份（Pro 每日備份、PITR）見上述總覽 §A。

## 1. 為什麼需要這個 workflow

`scripts/production-migrate.mjs` 的 `deploy` 只接受同時符合下列條件的 `backup_run_id`（全部寫在程式裡，改動要經 PR）：

| 條件 | 值 |
|---|---|
| workflow 路徑 | `.github/workflows/production-backup.yml`（`PRODUCTION_BACKUP_WORKFLOW`） |
| repository | run 與 head repository 都是本 repo（fork 不算） |
| 分支與事件 | `head_branch=master`；`workflow_dispatch` 或 `schedule` |
| 來源 commit | `run.head_sha` 必須在 master 的歷史上：compare API 的 `<head_sha>...master` 為 `ahead` 或 `identical`，且 merge base 就是 `head_sha` |
| 結果 | `status=completed`、`conclusion=success` |
| backup job | jobs API 中恰好一個名為 `backup`（`PRODUCTION_BACKUP_JOB`）的 job，`completed`／`success`，且 `head_sha` 相同 |
| 時間 | run 的 `updated_at` 在 24 小時內（`BACKUP_MAX_AGE_MS`），且不在未來 |
| artifact | 名稱 `production-database-backup-<run id>`、未過期、大小 > 0 |

沒有這樣的 run，`deploy` 在連資料庫之前就停止（`BACKUP_RUN_*`、`BACKUP_JOB_NOT_SUCCESSFUL`、`BACKUP_ARTIFACT_MISSING`）。能通過上述檢查的，只有「master 歷史上某個 commit 的 `.github/workflows/production-backup.yml`、在 master 上觸發、`backup` job 成功」的 run；這個檔案的內容受 master 分支保護與 PR 審查約束，因此只要 master 上的版本正確，gate 就只會接受它產生的備份。

## 2. workflow 做了什麼

`.github/workflows/production-backup.yml`（執行腳本 `scripts/production-backup.mjs`，契約測試 `scripts/production-backup.test.mjs`）：

1. **觸發限制**：只有 `workflow_dispatch`，沒有任何 input（不能指定其他目標）；兩個 job 的條件都是 `github.ref == 'refs/heads/master' && github.ref_protected`。`backup` job 使用 GitHub environment `production`，所以每次都停在「Waiting for review」，由 required reviewer 核准後才拿得到 secret 與 variable。
2. **兩個 job，第三方套件不碰憑證**：
   - `contract`（沒有 environment、沒有 secret）：`npm ci --ignore-scripts` 後跑 `production-backup`、`production-migrate`、`staging-migrate` 的契約測試。
   - `backup`（`needs: contract`，environment `production`）：不執行 npm，`scripts/production-backup.mjs` 只用 Node 內建模組（契約測試會檢查它與它引用的檔案）。注入憑證前，先以 digest 拉取 PostgreSQL 17.10 client 映像（`postgres@sha256:742f40ea…2193`，ECR 鏡像優先、Docker Hub 備援，與 CI 相同），並下載 `age` v1.3.1 官方 release、以 GitHub 公布的 SHA-256 驗證後才解壓（不使用會漂移的 apt 版本）。
3. **連線字串**：與 `production-migrate.mjs` 共用 `parseProductionDatabaseUrl`，只接受固定的 Production 專案（`FIXED_PRODUCTION_REF`），staging ref 一律拒絕；強制 TLS（`sslmode=require`），transaction pooler（6543）改走 session（5432）。URL 只以 `PG*` 環境變數交給容器，不出現在任何命令列；密碼與主機名稱先以 `::add-mask::` 遮罩。
4. **傾印（與 staging 相同格式）**：一個 psql session 開 `REPEATABLE READ, READ ONLY` 交易，設定 `row_security = off`（與 `pg_dump` 相同：若連線角色會被 RLS 過濾，查詢直接報錯，而不是默默數到 0），再 `pg_export_snapshot()`，在同一個 snapshot 上：
   - `pg_dump --format=custom --no-owner --no-privileges --schema=public --lock-wait-timeout=60s`；
   - 讀 `_prisma_migrations` 的已套用數量與最新名稱；
   - 跑總覽 §C 的帳務彙總 SQL（契約測試保證與 §C 逐字相同）。
   因為是同一個 snapshot，彙總值與 archive 內容一致，還原後可逐列比對。彙總 SQL 若因 Production 尚未套用新 migration 而失敗，備份仍然成功，receipt 記 `aggregates=UNAVAILABLE`（避免「master 改了欄位 → 備份失敗 → migration 永遠無法套用」的死結）。
5. **離線檢查**：在 `--network none` 的容器以 `pg_restore --list` 驗證 archive 可讀，且含 `TABLE DATA public _prisma_migrations`；再以 `pg_restore --schema-only` 讀 index DDL，記錄 `pg_trgm` operator class 所在 schema（F-074：`public`／`extensions`／`none`／`ambiguous`）。
6. **加密與上傳**：明文只存在 runner 的 `/dev/shm`（tmpfs，0700 目錄，至少 1 GiB 可用），以 `age` 加密給 repo 內審查過的公鑰 `ops/backup/keys/production-backup.agepub` 後立即刪除。腳本在做任何事之前，先比對這個檔案的 SHA-256（換行統一為 LF）與 environment variable `PRODUCTION_BACKUP_RECIPIENT_SHA256`；未設定或不符就拒絕執行。這樣即使有人用 PR 換掉公鑰檔，也無法同時改掉 owner 在 environment 設定的值。artifact `production-database-backup-<run id>` 只含：
   - `production-public-<run id>.dump.age`（archive 密文）
   - `production-aggregates-<run id>.txt.age`（彙總密文；彙總失敗時沒有這個檔）
   - `SHA256SUMS`（密文的 SHA-256）
   - `production-backup-receipt.json`（不含資料：工具版本、映像 digest、TOC 筆數、migration 數與最新名稱、`pg_trgm` schema、recipient 的 SHA-256、檔案大小與 SHA-256）
   保留 30 天（`retention-days: 30`），不壓縮。log 只會出現固定代碼、數字與 SHA-256。

### 範圍與限制

- 這是 `public` schema 的邏輯備份，與 staging 相同。不含 Supabase 管理的 schema、角色與擴充本身（`--schema` 模式下 `pg_dump` 不輸出 `CREATE EXTENSION`），也不含 Storage 物件。完整的平台層還原要靠 Supabase 受管備份或 PITR（總覽 §A）。
- 公開 repo 的 artifact 任何登入的 GitHub 使用者都能下載，所以只上傳密文。對應的 age 私鑰必須由 owner 離線保管；**私鑰遺失＝這些備份全部無法還原**。第一次執行後一定要做 §4 的演練，證明手上的私鑰對得上（receipt 的 `recipientSha256` 應等於 `age-keygen -y <identity> | tr -d '\n' | sha256sum` 的結果）。
- 加密欄位（MFA、個資等）另外依賴 `CSRF_SECRET`，見總覽 §E；只有 age 私鑰還不夠。
- 資料量受 runner 的 tmpfs 限制（標準 runner 約 8 GiB）。Production 資料量接近時要改設計。

## 3. 觸發與核准

**owner 一次性設定**（GitHub → Settings → Environments → `production`）：

| 項目 | 內容 |
|---|---|
| Environment | `production`（workflow 寫小寫；GitHub 的 environment 名稱不分大小寫，與 OWNER-ACTIONS 的 `Production` 是同一個） |
| Required reviewer | 已於 2026-10-27 設定為 a25814740（O-20(a)）；deployment branch policy 為 protected branches（目前只有 `master` 受保護） |
| Secret | `PRODUCTION_DATABASE_URL`：Production 的 Supavisor session（5432）或 transaction（6543）pooler 連線字串，使用者 `postgres.<固定 ref>`；與 `production-migrate.yml` 共用同一個 secret |
| Variable | `PRODUCTION_BACKUP_RECIPIENT_SHA256`：`ops/backup/keys/production-backup.agepub` 的 SHA-256（64 個小寫十六進位字元）。owner 自行計算，例如 `git show origin/master:ops/backup/keys/production-backup.agepub \| sha256sum`（Git Bash／Linux／macOS 的 `shasum -a 256` 亦可），並先確認這把公鑰對應自己離線保管的私鑰（`age-keygen -y <identity>` 的輸出應等於檔案中的 `age1…` 行）。未設定或不符時備份一律拒絕。換公鑰時要同時開 PR 與更新這個 variable |

**每次執行**：

1. Actions → `Production backup` → Run workflow，分支選 `master`。從其他分支觸發時兩個 job 都會因 `if` 被跳過，也拿不到 environment 的 secret；就算那個 run 顯示成功，`production-migrate` 也會因 `head_branch` 不是 `master`（以及 `backup` job 沒有成功）拒絕它。
2. 由 required reviewer 在 run 頁面按 **Review deployments → Approve**。
3. 成功後記下 run ID。用 `gh run view <run id>` 或 run 頁面確認 artifact `production-database-backup-<run id>` 存在；log 的 `PRODUCTION_BACKUP_ARCHIVE_SHA256` 應與 artifact 內 `SHA256SUMS` 第一行相同。
4. 24 小時內把這個 run ID 填入 `Production migrate` 的 `backup_run_id`。超過 24 小時要重跑備份。

**失敗代碼**（只會印出代碼，不印原始錯誤）：

| 代碼 | 意義與處理 |
|---|---|
| `PRODUCTION_DATABASE_*`、`PRODUCTION_PROJECT_MISMATCH` | secret 不是固定 Production 專案的合法連線字串，修正 secret |
| `PRODUCTION_BACKUP_DUMP_FAILED <類別>` | `AUTHENTICATION`、`DNS`、`NETWORK`、`TLS`、`VERSION_MISMATCH`（伺服器版本高於 17）、`LOCK_TIMEOUT`（有長交易或 migration 持鎖，稍後重試）、`SNAPSHOT`、`PERMISSION`、`STORAGE`、`OTHER` |
| `PRODUCTION_BACKUP_ARCHIVE_INVALID` | archive 無法列出或缺 `_prisma_migrations` 資料 |
| `PRODUCTION_BACKUP_IMAGE_UNVERIFIED`、`PRODUCTION_BACKUP_AGE_UNAVAILABLE` | 工具準備失敗，重跑 |
| `PRODUCTION_BACKUP_TMPFS_UNAVAILABLE` | runner 的 `/dev/shm` 不可用或空間不足 |
| `PRODUCTION_BACKUP_RECIPIENT_UNPINNED` | environment variable `PRODUCTION_BACKUP_RECIPIENT_SHA256` 未設定或格式錯誤 |
| `PRODUCTION_BACKUP_RECIPIENT_PIN_MISMATCH` | repo 內的公鑰檔與 variable 不符：可能有人換了公鑰，先查 `git log -- ops/backup/keys/production-backup.agepub`，確認無誤才更新 variable |
| `PRODUCTION_BACKUP_RECIPIENT_INVALID`、`PRODUCTION_BACKUP_ENCRYPTION_FAILED` | 公鑰檔或加密失敗；不會上傳任何東西 |

任何失敗都會刪除明文與未完成的輸出目錄，upload step 不會執行，因此不會產生可通過 gate 的 run。

## 4. 隔離還原演練（F-058 收據）

全程不連 Production、不覆寫任何既有資料庫。目標與 RTO 定義沿用總覽 §B：初始 RTO 60 分鐘，計時從「開始解密」到「驗證完成」。

1. **選定備份**：一次成功的 `Production backup` run（保留期 30 天內）。記下 run ID 與 receipt 的 `files[].sha256`。
2. **下載與驗證密文**（owner 授權的電腦）：

   ```bash
   gh run download <run id> --name production-database-backup-<run id> --dir <演練工作目錄>
   cd <演練工作目錄> && sha256sum -c SHA256SUMS
   ```

   核對 receipt 的 `recipientSha256` 與手上私鑰導出的公鑰相同，再進行下一步。
3. **準備隔離目標**：二選一。
   - **本機 PostgreSQL 17**：只聽 `127.0.0.1`，空資料庫 `celebratedeal_restore_drill_<日期>`。可用 Docker：`docker run -d --network none` 的 PostgreSQL 17 容器，或依總覽 §B 的 SecretManagement 設定。
   - **隔離的 Supabase 專案**：新建、名稱含 `restore-drill` 的專案（不得是 staging 或 Production），演練後刪除。
4. **解密與還原**：
   - Windows：`ops/backup/Invoke-CelebrateDealRestoreDrill.ps1 -EncryptedArchive <production-public-<run id>.dump.age> -AgeIdentityFile <離線私鑰路徑> -IsolationTargetSecretName <隔離目標> -DryRun`，確認後改 `-Execute -Confirmation RESTORE-TO-ISOLATED-TARGET`。腳本會依 archive DDL 自動在正確 schema 建立 `pg_trgm`（`-TrigramExtensionSchema auto`），只還原 `public`，並輸出 `elapsedSeconds`。
   - 手動（任何平台）：`age -d -i <私鑰> -o <tmpfs 或加密磁碟>/restore.dump production-public-<run id>.dump.age`；在目標先 `CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA <receipt 的 dump.trigramOperatorSchema，none 時用 extensions>;`，再 `pg_restore --clean --if-exists --no-owner --no-privileges --schema=public --exit-on-error --single-transaction --dbname=<隔離目標> restore.dump`。`trigramOperatorSchema=ambiguous` 時停止，先查明原因。
5. **驗證**：
   只拿備份當下的紀錄（receipt 與解密後的彙總）比對隔離還原庫，**不連 Production、不拿即時資料比對**（備份後的交易會讓比對失敗，也違反「全程不連 Production」）。因此不要在這裡使用 `ops/backup/Test-CelebrateDealRestoreEvidence.ps1`，它會連來源資料庫並以即時資料比對。
   - 結構：在隔離還原庫查 `SELECT count(*), max(migration_name) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`，必須等於 receipt 的 `migrations.applied` 與 `migrations.latest`。
   - 帳務彙總：解密 `production-aggregates-<run id>.txt.age`（它的第一欄 `migrations` 列也要與上一項相同），對隔離還原庫跑總覽 §C 的 SQL（`psql -X -q -A -t -f -`，欄位以 `|` 分隔），兩份輸出必須逐字相同。這份彙總與 archive 出自同一個 snapshot，所以不受備份後的交易影響。receipt 為 `aggregates=UNAVAILABLE` 時，此項記為「無基準」，不得記為 PASS。
   - 加密欄位可讀：依總覽 §B 第 6 步與 §E，需 owner 另行授權。
6. **收尾**：刪除隔離資料庫、解密後的明文與工作目錄；私鑰放回離線媒體。
7. **記錄**：在總覽 §B 的「RTO 記錄表」新增一列，備份來源寫「GitHub `Production backup` run <run id>」，備份時間取 receipt 的 `finishedAtUtc`，migration 數取 `migrations.applied`，解密＋還原秒數取 `elapsedSeconds`（手動時自行計時），並在 `reports/` 留一份只含數字與 PASS／FAIL 的收據。F-058 需要「結構一致、帳務彙總一致、加密欄位可讀」三欄都是 PASS 且有簽核者。

## 5. 本機已驗證與只能在 GitHub 驗證的部分

- 2026-11-03 在本機以 Docker 對套用全部 133 個 migration 的一次性 loopback PostgreSQL 17.10（合成資料）實跑 `SNAPSHOT_SCRIPT`：傾印期間另有寫入，snapshot 內的彙總與還原後的彙總逐字相同、寫入中的新資料不在 archive 內；`pg_restore --list` 1634 筆 TOC、`pg_trgm` 判定為 `public`；`age` 加解密後位元組相同；依第 4 步的參數還原成功；錯誤密碼得到 `AUTHENTICATION`；彙總 SQL 欄位缺失時傾印仍完成且不產生彙總；加上 `row_security = off` 後，一個會被 RLS 過濾的非 owner 角色查詢直接報錯（未加時默默回 0），table owner 則正常計數。
- 只能在 GitHub 上確認：environment 核准流程與 variable、`PRODUCTION_DATABASE_URL` 對 Supavisor session pooler 的實際連線與 `pg_export_snapshot`／`--snapshot` 行為、runner 的 `/dev/shm`、`age` release 下載、artifact 上傳，以及 `production-migrate.mjs` 對真實 run 呼叫 compare／jobs API 的結果。第一次正式執行後請把 run ID 記入 receipt。
