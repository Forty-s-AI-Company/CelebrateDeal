# 固定 staging 隔離 migration 重播

受保護 `master` workflow 以已驗證的 Preview source `9193326824b8b6bf774bdfa28e4783a1a1b8f304` 和固定 staging DB 身分為輸入。先確認 migration 來源、58／79 完整前綴、checksum，以及一筆具有同名同 checksum 完成紀錄的歷史 rollback；來源 PostgreSQL 僅接受 read-only 查詢和 `pg_dump`。dump 僅留在 runner 記憶體與 `network=none` 容器的 tmpfs，不產生 raw dump artifact。

隔離容器還原後，先比較 migration／表／欄位數、extension 配置與各表筆數摘要；這是 aggregate 比對，**不證明每筆資料內容相同**。接著以單一 migration 交易逐一重播最後 21 個 SQL，核對預期的表、索引、約束、型別、欄位都存在，並確認原本 58 筆 migration history 未改寫。收據明確標示這是 SQL replay，沒有執行 Prisma migrate deploy。任何失敗只輸出固定錯誤類別與已成功重播數，不輸出 SQL、資料列、連線字串或資料庫錯誤原文。容器必須經 ownership label 核對後清理；清理失敗會把結果降為 `BLOCKED`。此驗證不寫 staging、不使用 Production，也不部署。

已逐檔靜態檢視 21 個 pending SQL：既有表只有 nullable 欄位、帶 default 的 NOT NULL 欄位、一般索引，以及引用新 nullable 欄位的 FK。`20260911080000_live_interaction_tenant_integrity` 檢查的 `LiveInteractionRun`／`LiveInteractionResponse` 是前一批 pending migration 才建立，故 58-migration staging 基線不可能有這兩張表的既有資料衝突。隔離重播才是這批 SQL 的資料相容性證據。

本機使用完全合成的 disposable PostgreSQL 完成一次實際演練：來源容器套用前 58 個 SQL 與合成 migration history，製作 custom dump；隔離容器還原後重播後 21 個 SQL，schema catalog 與原 58 筆 history 檢查通過，兩個容器均清理。這只驗證合成資料與本機 Docker／psql 路徑。固定 staging workflow 首次執行於來源 history 檢查安全停止：該資料庫另有一筆歷史 rollback；本次修正要求它具有對應的完成紀錄。隔離重播成功也不等於已套用 staging migration，或已具備可保留的回復備份；實際 schema 修復仍須走獨立受保護流程。

[第二次固定 staging 執行](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36085141048) 已越過 history 基準並完成隔離還原，但在來源與還原後摘要比對停下：`ISOLATED_RESTORE_MISMATCH`、來源 DB 寫入 0、SQL 重播 0。來源和一次性 PostgreSQL 的排序規則可能不同；本修正將表名／筆數對正後在 JS 中排序，並在收據分別標示 metadata、表筆數、extension 是否相符，仍要求三項全通過才重播。重新執行前不能宣稱資料相容性通過。
