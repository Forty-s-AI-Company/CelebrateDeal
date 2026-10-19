# 固定 Staging 加密備份的隔離回復演練

固定備份 runner 的最早受保護 master SHA 是
`e13084f37edf9669f47c02351e646972201ae211`（PR #288）。
後續 master 執行的備份仍須驗證該 SHA 的後代關係，且備份 workflow、
runner 與加密／artifact 驗證程式的 Git blob 必須符合已審查的固定清單。

這個 workflow 只接受符合上述來源檢查、在受保護 `master` 執行的
`Secure staging validation` 備份 run ID。它先用 GitHub API
核對成功的 workflow、commit、分支與兩個固定 artifact，再下載 SHA
`9193326824b8b6bf774bdfa28e4783a1a1b8f304` 的加密備份與 sanitized receipt。
下載後再次驗證 receipt、密文格式與 SHA-256，才進入私鑰步驟。
原始 migration manifest 固定到該來源的 tree SHA
`8204bf3ce05a309035f55b2f90aaffb18aed05c8`，並逐一重讀 migration blobs；
後續 master 新增 migration 不會使保留期限內的既有備份失去驗證能力。

受保護 GitHub Environment `Preview – celebrate-deal-staging` 需新增 **尚未配置**
的 variable `STAGING_BACKUP_AGE_RECIPIENT` 與 secret `STAGING_BACKUP_AGE_IDENTITY`。
前者是新的 staging 專用 age 公鑰，後者是配對私鑰。由授權持有者安全配置；
私鑰不可放進 repository、workflow input、
issue、log 或 artifact。本 workflow 不建立、不讀取現有 secret，也不連接 Staging DB。

私鑰僅在 recovery step 注入 process environment，立即寫入 runner 的 `/dev/shm`
0700 目錄／0600 檔案。先由 `age-keygen -y` 導出公鑰並比對備份 receipt 的
recipient digest，再用 `age -d` 將明文放在同一 tmpfs，核對原始 dump digest。
PostgreSQL 17 container 使用 `--network none`、資料目錄與 `/tmp` 的 tmpfs，
還原只寫入該一次性 container。完成後核對已套用 migration 數量與備份 receipt，
清除 container、明文與私鑰，僅上傳 sanitized recovery receipt。

`recoverability=PROVEN_ISOLATED` 只代表該次下載、解密與隔離還原實測成功；
`migrationAuthorization` 仍為 `BLOCKED`。最後 21 筆 migration SQL 的資料相容性
演練及 staging 實際修改都屬於獨立 gate。缺私鑰、artifact 逾期或來源不符時
一律停止，不能將本機合約測試當成回復成功。

備份是 `public` schema 的邏輯 archive，不包含 Supabase 管理的角色、其他 schema
或擴充安裝位置。隔離容器先於 `extensions` schema 建立 `pgcrypto`；`pg_trgm`
則照 archive index DDL 引用的 schema 建立（見下節）。其他依賴位置不符時，還原會
失敗並回報 `BLOCKED`。此演練不聲稱完整的 Supabase project restore。

## `pg_trgm` 位置（F-074，2026-10-19）

`g7_54` migration 建立 `pg_trgm` 時沒有指定 schema，位置取決於當時的
`search_path`，所以不能假設。主對話已唯讀查證 staging：**`pg_trgm` 在 `public`
（1.6），`pgcrypto` 與 `uuid-ossp` 在 `extensions`**。archive 的 index 因此引用
`public.gin_trgm_ops`。

- 原本 runner 固定只在 `extensions` 建立 `pg_trgm`，對 staging 一定會還原失敗。
- 現在 runner 在準備目標前先跑 `pg_restore --schema-only`，從 archive 的 index
  DDL 找出 `pg_trgm` 的 schema（同時引用兩個 schema 就停止，沒有引用就用
  `extensions`），再照來源位置建立。還原 job 刻意不連來源資料庫，所以以 archive
  DDL 作為來源位置的依據。兩種位置的單元測試在 `scripts/staging-backup-recovery.test.mjs`，
  loopback 重現在 `reports/review-2026Q4/B-line-B4-loopback-receipt.md`。
- 這個 runner 不在 blob 白名單內（白名單只鎖備份端），改動走一般審查。
- Production 的隔離還原步驟、RTO 記錄表與帳務彙總 SQL 見
  [`production-backup-restore-runbook.md`](../production-backup-restore-runbook.md) §B～§D。
