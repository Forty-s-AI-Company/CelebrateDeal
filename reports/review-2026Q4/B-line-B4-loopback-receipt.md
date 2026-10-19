# 工作線 B4：pg_trgm 還原與帳務彙總 SQL 的 loopback 收據

- 日期：2026-10-19
- 分支：`codex/beta-lineB-data-ops`
- 對應：F-074（B04-21）、PR #447 審查 m7、主對話指示第 7 項
- 環境：本機一次性 PostgreSQL 17.10 cluster（`initdb -A trust`，只聽 `127.0.0.1:55417`，資料目錄在 session scratchpad，用完即停）
- 資料：全部是合成資料。沒有連 staging、Production 或任何遠端資料庫，也沒有使用真實備份或密鑰。

## 1. 合成來源

兩個來源資料庫，差別只在 `pg_trgm` 的位置：

```sql
-- celebratedeal_src_extensions 與 celebratedeal_src_public，$sch 分別是 extensions、public
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION pg_trgm WITH SCHEMA $sch;
SET search_path = public, extensions;
CREATE TABLE "FormSubmission"(id text primary key, name text);
CREATE INDEX fs_trgm ON "FormSubmission" USING GIN (name gin_trgm_ops);
INSERT INTO "FormSubmission" VALUES ('a', 'synthetic');
```

`pg_restore --schema-only --section=post-data` 的 opclass 引用分別是 `extensions.gin_trgm_ops`、`public.gin_trgm_ops`。

## 2. 修正前的流程會失敗（PowerShell 演練的還原參數）

對空的目標資料庫直接執行
`pg_restore --clean --if-exists --no-owner --no-privileges --schema=public --dbname <target> <dump>`：

| 來源位置 | 預先準備 | pg_restore exit | `fs_trgm` index | 錯誤 |
|---|---|---|---|---|
| extensions | 無 | 1 | 0 | `schema "extensions" does not exist` |
| extensions | 依偵測結果建立 | 0 | 1 | — |
| public | 無 | 1 | 0 | `operator class "public.gin_trgm_ops" does not exist` |
| public | 依偵測結果建立 | 0 | 1 | — |

## 3. `ops/backup` 的 helper（`Get-CelebrateDealTrigramSchema`、`Get-CelebrateDealExtensionPreparationSql`）

以 `pwsh` 匯入 `CelebrateDeal.Backup.Common.psm1`，對 §1 的 dump 讀 `pg_restore --schema-only --file=-`、偵測 schema、用 `psql --set ON_ERROR_STOP=1 --command <準備 SQL>` 準備目標，再以 §2 的參數還原。`preexisting=other` 表示目標事先已把 `pg_trgm` 裝在另一個 schema（驗證 `ALTER EXTENSION ... SET SCHEMA` 分支）。

```
source=extensions detected=extensions preexisting=none  prep=0 restore=0 index=1
source=extensions detected=extensions preexisting=other prep=0 restore=0 index=1
source=public     detected=public     preexisting=none  prep=0 restore=0 index=1
source=public     detected=public     preexisting=other prep=0 restore=0 index=1
none-ddl=            (沒有 trigram index 時回傳 null)
ambiguous=thrown     (同時引用兩個 schema 時拒絕)
unsafe=thrown        (schema 名稱不合法時拒絕)
category=extension_compatibility   (缺 operator class 的錯誤分類)
```

**沒有執行**：`Invoke-CelebrateDealRestoreDrill.ps1 -Execute` 的完整路徑（age 解密、SecretManagement 讀密鑰）。那需要把連線字串寫入本機的 SecretManagement／Credential Manager，本次沒有這樣做。上表驗證的是腳本 `-Execute` 路徑中偵測、準備與還原三個步驟所用的同一組 helper 與參數。`-DryRun` 與 plan-only 由 `ops/backup/tests/Test-BackupTooling.ps1` 涵蓋。

## 4. staging 還原 runner（`scripts/staging-backup-recovery.mjs`）

比照 runner 的實際流程：`pg_dump --format=custom --no-owner --no-privileges --schema=public` → `pg_restore --list` → `filteredRestoreList` → 準備 SQL → `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --use-list`。準備 SQL 直接取自 runner export 的 `archiveTrigramSchema` 與 `recoveryTargetPreparationSql`；「修正前」是固定傳入 `extensions`，等同舊 runner 寫死的 SQL。

```
{"sourcePlacement":"public","detectedSchema":"public","variant":"fixed_extensions_before_fix","prepareExit":0,"restoreExit":1,"trigramIndexes":"0"}
{"sourcePlacement":"public","detectedSchema":"public","variant":"archive_derived","prepareExit":0,"restoreExit":0,"trigramIndexes":"1"}
{"sourcePlacement":"extensions","detectedSchema":"extensions","variant":"fixed_extensions_before_fix","prepareExit":0,"restoreExit":0,"trigramIndexes":"1"}
{"sourcePlacement":"extensions","detectedSchema":"extensions","variant":"archive_derived","prepareExit":0,"restoreExit":0,"trigramIndexes":"1"}
```

結論：staging 的 `pg_trgm` 在 `public`（主對話唯讀查證），舊 runner 對 staging 的還原一定失敗；新 runner 兩種位置都成功。

**沒有執行**：runner 本身的 Docker／`/dev/shm` 路徑（本機 Docker daemon 未啟動，且 `/dev/shm` 只存在於 Linux runner）。

## 5. 帳務彙總 SQL

在 `celebratedeal_aggcheck`（空資料庫，`prisma migrate deploy` 套用全部 108 條 migration）以 `psql -v ON_ERROR_STOP=1 -f` 執行 `docs/production-backup-restore-runbook.md` §C 的 SQL，exit 0：

```
item | row_count | sum_1 | sum_2 | sum_3
migrations | 108 |  |  |
```

這證明 SQL 的資料表、欄位與型別轉換都存在且可執行。空資料庫沒有交易資料，所以**沒有驗證加總數字的正確性**；那要等真實的隔離還原演練（§B 第 0 步與第 5 步）。

## 6. 清理

演練結束後停止並刪除本機 cluster 與 scratchpad 內的 dump；沒有任何檔案留在 repo。
