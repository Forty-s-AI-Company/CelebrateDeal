# 固定 staging migration 套用

本流程只供受保護 `master` 手動觸發，目標為既有固定 staging Supabase project `ocbugvgojrunvenozsbx`。它不處理 Production，也不切換 Vercel alias。預期把固定資料庫的 Prisma migration 從 58 筆補到 79 筆，然後才部署新版應用與重跑瀏覽器／PayUni Sandbox 驗收。**隔離重播通過並不代表固定資料庫已更新。**

## 前置證據

1. 在本 workflow 所在的受保護 `master` commit 上執行 `Staging isolated migration replay`，結果 `PASS`，保存其 run ID。重播收據必須是現行 `celebratedeal-staging-isolated-migration-replay/v1`，確認固定來源 58 筆、待補 21 筆、隔離重播 21 筆、來源摘要與目標 schema 相符，且來源資料庫寫入為 0。
2. 21 個待補 SQL 已逐一審查，均未刪除或改寫既有資料；固定 staging 是非 Production，且本次 staging 更新已獲授權。`ALL_DISPOSABLE_SYNTHETIC` 字串不能證明資料性質，對本批增量 SQL 也不是技術前提，因此不再要求該輸入。以最新重播 run ID 手動觸發 `Staging migration apply`，唯一輸入為 `replay_run_id`。workflow 會留下觸發者與 run ID 的稽核紀錄，向 GitHub API 核對 producer 的 `workflow_dispatch`、成功狀態、`master`、精確 workflow 路徑與相同 commit；它只接受 artifact `celebratedeal-staging-isolated-migration-replay` 內的 `celebratedeal-staging-migration-replay.json`。
3. 套用前，runner 再驗證固定 Preview GitHub Deployment lineage、受保護來源 PR #277、master 與固定來源的 migration Git tree 完全相同、資料庫 URL 對應固定 staging project，以及 live migration history 是無未解決錯誤且 checksum 相符的 58 筆前綴。`Vendor.enabledFeatureModules` 必須尚不存在。任何一項不符都停止，不能把失敗重播標為成功。

這 21 個已審視的 SQL 沒有 `DROP`、`TRUNCATE`、`DELETE FROM` 或更新既有列的語句；它們主要新增欄位、表、索引與約束。隔離重播已在 staging 的一次性快照上通過。Prisma datasource URL 設定五秒 `lock_timeout` 與六十秒 `statement_timeout`，分別限制等待鎖及取得鎖後的單一語句執行時間；在一次性本機 PostgreSQL 驗證過 URL options 的鎖逾時，不以 `PGOPTIONS` 代替。此流程未產生可保留的加密回復備份，因此仍有 schema 套用失敗或套用期間新寫入導致約束衝突的風險。失敗時 runner 記錄 `FAILED` 與套用已嘗試，**不自動重試**；必須先檢查固定 DB 當下 history 與 schema，再決定修復。不要把此流程視為備份或回滾機制。

runner 不輸出資料庫 URL、密碼或 Prisma／psql 原始輸出；收據只保留狀態、筆數、正規化錯誤碼，以及受保護 master commit、apply／replay run ID、migration tree、固定 Preview host 與不含密碼的資料庫 identity digest。`PASS` 只表示 migration history 79 筆與預期 schema 物件已驗證，後續固定 staging 新版部署、登入後功能與 Sandbox 交易仍須分別驗收。
