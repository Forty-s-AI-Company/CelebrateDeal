# WP-20 任意時間窗造訪紀錄

已核准 M2 範圍內的 additive persistence。僅本機 disposable PostgreSQL 與合成資料驗證，尚未部署。

- LiveMetricVisitor 保留穩定第一方瀏覽器識別；LiveMetricVisit 每次造訪獨立 id、server-observed visitedAt，同租戶/場次/版本/visitor 複合 FK。
- id 為 UUID 冪等鍵；DB 禁止覆寫、重複 insert 會唯一衝突。尚未實作 API 的 exact-replay receipt，不能宣稱網路重送流程已完成。
- 指定 [S,T) 查詢使用每次 visitedAt；同 visitor 多次事件去重成瀏覽器分母。S 前第一次造訪不會使 S 後回訪消失。
- 不 backfill 舊 firstVisitedAt 作為完整歷史。collectionStartedAt 並非新造訪收集器的覆蓋證明；啟用/完整性 watermark 仍需明確實作。
- INSERT/UPDATE guard 要求 read committed；UPDATE 全拒絕，insert 驗證 collection/lifetime/visitor。DELETE 同樣限制 isolation，保留資料清理能力。
- 新增或刪除事件依 [S,T) 邊界使重疊報表 stale，清空 result/lease；依 version→report 鎖順序與 report create 互斥。
- RLS 無 policy，PUBLIC/API roles 撤銷權限；只由核准 server writer 寫入。必須保留 Auth/Migration 獨立深度審查。

驗證涵蓋：回訪、S 包含/T 排除、租戶拒絕、未來與早於 visitor 的時間拒絕、不可改寫、重複鍵、repeatable-read 寫入拒絕、insert/delete invalidation、RLS 與權限。尚缺並行 report/visit race 專屬測試、收集 API exact replay、讀取 adapter、端到端與獨立審查。

回滾：未部署變更僅撤回新增 migration、schema visit model/relation 及本次 runner 精確差異。測試 DB 由 owned runner teardown。任何已部署環境回滾需先停收集並另行規劃資料處理，不提供正式 destructive down migration。
