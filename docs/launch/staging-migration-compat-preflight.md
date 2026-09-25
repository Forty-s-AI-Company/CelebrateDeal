# 固定 staging migration 資料相容性 preflight

此 workflow 只在受保護 `master` 的 `Preview – celebrate-deal-staging` environment 手動執行，綁定目前已驗證的 Preview source `9193326824b8b6bf774bdfa28e4783a1a1b8f304` 與固定 host。執行前先核對 deployment lineage；僅在精確 staging DB 身分吻合時連線。**目前尚未執行此 workflow，沒有 staging 資料相容性 PASS 證據。**

前置條件是 `_prisma_migrations` 的 58 個已完成項目，必須是固定來源 79 個 migration 的完整前綴，checksum 相符，且沒有未解決失敗。任何基線變動都阻擋檢查；此 preflight 不會自行套用 migration。

已靜態檢視最後 21 個 migration：多數操作為建立新表、索引、型別，或對舊表新增 nullable／有 default 的欄位。`20260911080000_live_interaction_tenant_integrity` 對既有 `LiveInteractionResponse` 增加複合外鍵，且會在 SQL 內先對 run/live 與 registration/live ownership mismatch 拋錯。唯讀 preflight 對這兩種關係做包含孤兒參照的 aggregate 檢查；只輸出 `PASS`／`FAIL`，不輸出列值、身分、URL 或衝突筆數。

查詢在 `RepeatableRead` 交易的任何資料讀取前設定 `SET TRANSACTION READ ONLY`，並確認資料庫端 `transaction_read_only=on`。產物只記固定分類和讀取次數；不寫 staging、不進行 Production 操作。

通過表示這兩項已知既有資料約束在當次 snapshot 內沒有衝突。它仍不能替代套用全部 21 個 migration 的隔離還原演練，也不能證明 schema migration 本身、線上並行寫入或後續部署必然成功。實際 migration 仍須先有可保留回復備份並走獨立受保護流程。
