# CelebrateDeal 目前版本與上線缺口

更新：2026-09-24（Asia/Taipei）。這是本輪 Goal 的現況入口；驗收狀態以對應 source 與部署的當次證據為準。歷史完成紀錄不能直接升級成新版驗收。

## 來源與站台

- 最新 `master`：`0f1fc3e84b524edd46bb1a6946b852cf9ef74742`，由受保護 PR [#274](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/274) squash 合併。合併前 `235b496a442c18139d581db59c3b41d5eb61687f` 的兩次 `quality` run `35995602557`／`35995607497` 均 success；master 自身 [CI run `35998114044`](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/35998114044) 的結論應由 GitHub 即時狀態判定，不能預先記 PASS。合併後兩者 Git tree 相同。
- 本輪整合分支 `codex/launch-integration-20260924` 從原 master 建立；原 `codex/one-stop-webinar-flow` dirty 工作目錄未重設或覆寫。
- PR #210 與 #211 目前皆為 CONFLICTING。將 #210 對 master 做唯讀 `git merge-tree`，有 376 個衝突路徑，其中 296 個在 `src`。先逐項對齊現有 master，不直接合併舊樹。
- 指定 staging 網址的首頁與 `/api/health` 曾於 2026-09-24 回應 200；Vercel `inspect` 顯示 alias 所指 deployment `dpl_Dtp88X6L4iD7a6fWAKXFfqLycp6N`、target `preview`、state `READY`、建立時間 2026-09-03。該 inspect 回應沒有 Git source SHA。故這個 200 不是新版程式證明。
- 最新候選的 immutable Preview `celebrate-deal-staging-falb4yfd5-a25814740s-projects.vercel.app` 已 READY；Vercel list metadata 對應合併前 source `235b496a442c18139d581db59c3b41d5eb61687f`，其首頁、`/api/health` 與 `/login` 均回應 200。此 candidate 與新 master Git tree 相同，但 deployment SHA 不是 squash 後的 master SHA。它尚未切到指定 staging alias，也沒有通過登入、資料寫入或 Sandbox 訂單驗收。
- 對 `celebrate-deal-staging` 專案的 Preview process environment 做指定欄位、只輸出布林結果的檢查：PayUni 為 Sandbox 且商家綁定存在；`DATABASE_URL`、`DIRECT_URL`、`STAGING_DATABASE_URL` 未同時存在，`NEXT_PUBLIC_SUPABASE_URL` 未出現，`NEXT_PUBLIC_APP_URL` 未對上指定 staging host。資料、登入及外部操作的非 Production 隔離尚未證明，故不切 alias、不執行 mutation。
- staging Vercel 專案 `celebrate-deal-staging` 與一般專案 `celebrate-deal` 為兩個不同 project。`vercel.json` 對 master 設定不自動部署；合併與 staging 更新分別驗收。master branch protection 要求 `quality` 綠燈，禁止跳過。

## 目前判定

| 範圍 | 狀態 | 可用證據與下一個 Gate |
|---|---|---|
| master CI | 合併候選兩次 `quality` PASS；master 自身結果以 GitHub 為準 | run `35995602557`／`35995607497` 對相同 Git tree；master [run `35998114044`](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/35998114044) |
| 核心功能 | 本機與 CI 主要測試已通過；staging 操作未驗收 | Auth／checkout／order 等目標測試、本機 Funnel browser 與完整 CI browser 已通過；仍需固定 staging 的登入、資料寫入與 Sandbox 訂單證據 |
| Git 整合 | PR #274 已合併；舊 PR 仍未處置 | #210/#211 有衝突及未移植功能；對照 [Git inventory](integration-inventory-20260924.md) 後留下一輪按功能分批處理，不能宣稱「全部合完」 |
| 指定 staging | 新 immutable Preview 已 READY，alias 仍是舊部署 | 新 Preview 有 source SHA 與 HTTP 200；需補 Preview 環境隔離、核心操作驗證及 alias 切換 |
| PayUni | Sandbox，外部閉環未證明 | 至少一筆合成成功付款→callback→持久化訂單與重複 callback 冪等性；退款／對帳另列完整財務閉環 |
| Production | 未進入本輪 | 正式環境、正式付款、正式資料與寄信另行處理 |

## 本輪工作與下一輪

執行順序、驗收及權限見 [Goal Plan](goal-plan-20260924.md)，目前整合差異見 [Git inventory](integration-inventory-20260924.md)。細節與未完成新功能收斂到 [下一輪清單](NEXT-CYCLE.md)。
本輪 checkpoint 見 [執行紀錄](goal-progress-20260924.md)。

舊的 release audit、owner packet、scorecard 與 WP 文件保留作當時的歷史證據。若它們與此頁的當次 source/deployment 證據不同，以較新的同源驗證為準；不得直接改寫舊紀錄。
