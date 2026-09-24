# CelebrateDeal 目前版本與上線缺口

更新：2026-09-24（Asia/Taipei）。這是本輪 Goal 的現況入口；驗收狀態以對應 source 與部署的當次證據為準。歷史完成紀錄不能直接升級成新版驗收。

## 來源與站台

- 最新 `master`：`a476ce34abdbb93d67b89a1abffa40496e1fdc0d`；對應 GitHub CI run `35674751757` 為 success。
- 本輪整合分支：`codex/launch-integration-20260924`，從上述 master 建立。原 `codex/one-stop-webinar-flow` 工作目錄保留既有 80 個 tracked 變更與 38 個 untracked 檔案，不直接重設或覆寫。
- PR #210 與 #211 目前皆為 CONFLICTING。將 #210 對 master 做唯讀 `git merge-tree`，有 376 個衝突路徑，其中 296 個在 `src`。先逐項對齊現有 master，不直接合併舊樹。
- 指定 staging 網址的首頁與 `/api/health` 曾於 2026-09-24 回應 200；Vercel `inspect` 顯示 alias 所指 deployment `dpl_Dtp88X6L4iD7a6fWAKXFfqLycp6N`、target `preview`、state `READY`、建立時間 2026-09-03。該 inspect 回應沒有 Git source SHA。故這個 200 不是新版程式證明。
- staging Vercel 專案 `celebrate-deal-staging` 與一般專案 `celebrate-deal` 為兩個不同 project。`vercel.json` 對 master 設定不自動部署；合併與 staging 更新分別驗收。master branch protection 要求 `quality` 綠燈，禁止跳過。

## 目前判定

| 範圍 | 狀態 | 可用證據與下一個 Gate |
|---|---|---|
| master CI | 已通過既有基準 | run `35674751757` 對舊 master SHA；本輪整合 candidate 尚未驗證 |
| 核心功能 | 本輪 candidate 未驗收 | 必須對 Auth/tenant、Funnel 保存發布、訂單、商家日常流程做同一 source 的 review、測試與 staging browser smoke |
| Git 整合 | 進行中 | PR #210/#211 與本機 dirty diff 按功能、測試與文件比對；不能把 commit divergence 當作待合功能數 |
| 指定 staging | 舊 deployment 正常回應，尚非新版 | 需新 READY preview 的 source SHA/tree、deployment ID、alias 指向及真實操作驗證 |
| PayUni | Sandbox，外部閉環未證明 | 至少一筆合成成功付款→callback→持久化訂單與重複 callback 冪等性；退款／對帳另列完整財務閉環 |
| Production | 未進入本輪 | 正式環境、正式付款、正式資料與寄信另行處理 |

## 本輪工作與下一輪

執行順序、驗收及權限見 [Goal Plan](goal-plan-20260924.md)，目前整合差異見 [Git inventory](integration-inventory-20260924.md)。細節與未完成新功能收斂到 [下一輪清單](NEXT-CYCLE.md)。

舊的 release audit、owner packet、scorecard 與 WP 文件保留作當時的歷史證據。若它們與此頁的當次 source/deployment 證據不同，以較新的同源驗證為準；不得直接改寫舊紀錄。
