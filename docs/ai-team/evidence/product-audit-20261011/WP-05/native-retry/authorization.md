# WP-05 授權與 ownership

2026-10-12，使用者在說明加密短效草稿儲存、新資料表與 migration 後明確答覆「可以」。scope-proposal.md 所列精確範圍已核准；不解鎖 WP11、WP20 或 D-2～D-6。唯一 writer 為主代理；獨立 worktree 基底 efb8b7e9。禁止推送／部署／正式資料與正式資料庫；migration 只在另建 disposable DB 驗證，不更動既有測試 DB。

實作分為儲存與 migration、原生POST安全返回、公開頁欄位回填、錯誤與重送端到端驗證。全部完成並通過同snapshot獨立深度review／acceptance前，不標WP05 READY。新儲存層先完成，未接線階段不得宣稱303已完成。

TTL候選實作10分鐘；到期不可讀，清理採每次讀寫最多100筆的到期回收，不新增排程。若無後續請求，物理密文可能仍存在；不得把存取到期宣稱為準時實體刪除。無key／storage時fail-closed，整體原生流程需明示無法保留欄位，不能宣稱成功回填。
