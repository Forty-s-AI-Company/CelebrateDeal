# CelebrateDeal 固定 staging 現況

更新：2026-09-28（Asia/Taipei）。本頁只把對應部署來源的受保護收據標為 PASS；歷史收據不能替新版驗收。指定站點：[celebrate-deal-staging.carry-digital-nomad.in.net](https://celebrate-deal-staging.carry-digital-nomad.in.net)。

## 來源與驗收

本次核對的 live master 為 `18dc11e8cd23c6100a21fcd370ca187a6f6af9c0`。PR #338（Funnel 報表獨立載入）、#339（文件）、#340（Dashboard 明細獨立載入）皆已通過受保護檢查並 squash merge；先前 Vercel 建置限額已解除。固定站跟隨 `codex/staging-release-20260926` Preview 分支，目前來源 `f0c8285763a819e18c0e48dcaa397aa6ab47c62f`，Ready immutable host 為 `celebrate-deal-staging-ssvvrtuvw-a25814740s-projects.vercel.app`。GitHub Deployment `6700980893` 與下列收據確認來源及 alias 一致。本輪未部署 Production。

[PR #341](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/341) 補上 Funnel 編輯器導頁及 Dashboard 明細 GET 的有限、去識別診斷；本機 20 項 runner 測試 PASS，受保護 CI 尚在執行。取得新收據後再依根因修復，不盲目重跑。

| 範圍 | 狀態 | 最新可用證據與界線 |
| --- | --- | --- |
| master、部署來源與固定 alias | **PASS：來源綁定** | GitHub Deployment 6700980893、browser run 36368967262、R2 run 36368969912 均核對到 `f0c82857`；不代表功能全過 |
| Dashboard 導頁與關鍵 JS／CSS | **BLOCKED：明細未就緒** | [run 36368967262](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36368967262) 對 `f0c82857` 完成 desktop/mobile 各五頁及兩組導覽／hydration 互動。Dashboard HTML 200、外框與 KPI 可見（6 個讀取操作），兩種 viewport 的明細仍不可見。0 頁面錯誤、同站 5xx、關鍵資源失敗；session 均撤銷。framework alert 是 Next.js route announcer，非應用錯誤；實際 Dashboard alert 為 false。其餘頁面通過不能算整體 PASS |
| Funnel 建立→模板→儲存→發布→匿名公開頁 | **BLOCKED：編輯器導頁** | [run 36367356009](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36367356009) 對前一來源 `d1fd6a1c` 建立與套用模板成功，已越過 OPERATIONS_NOT_READY；Edit Page 後未在 15 秒內抵達編輯器，EDITOR_UNAVAILABLE。後續儲存／發布／公開頁尚未驗證。0 付款、退款、寄信，session 撤銷；此結果不是目前來源完整驗收 |
| R2 staging 圖片上傳與公開讀取 | **PASS：目前來源** | [run 36368969912](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36368969912) 對 `f0c82857` 完成合成圖片預簽、PUT、完成回報及公開 GET 各一次；staging bucket 與 r2.dev 均 VERIFIED，0 瀏覽器錯誤／不安全請求，session 撤銷。公開 bucket 只供 staging 合成資料 |
| Stream 非正式資源範圍 | **未驗證** | [唯讀 provider run 36218278700](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36218278700) 只證明連線可用，回報 `nonProductionScope=unverified`；無法在不讀 Secret 的條件下證明 Vercel 綁定 token 只可存取非正式資源 |
| PayUni 新版 Sandbox 訂單閉環 | **BLOCKED** | [run 36217020374](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36217020374) 一次 Sandbox 表單提交後結果不明。[唯讀 run 36260940732](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36260940732) 顯示本地 `PENDING`、provider `UNKNOWN`、callback `NOT_OBSERVED`、`PROVIDER_MISSING`，無查單參考值，`queryAttempts=0`。2026-09-28 Chrome 官方 Sandbox 後台仍在登入畫面，未能唯讀對帳；不得重送未明交易或退款。舊版 [run 36142862467](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36142862467) 的成功閉環不等於新版 PASS |
| PR #210／#211 獨有功能 | **尚未整合** | 兩支舊 PR 仍有衝突及失敗檢查；學員入口、LINE 圖文選單、聯盟入口與商品差異須按功能盤點，見[整合清單](integration-inventory-20260924.md) |
| Production | **未評定** | 本輪未授權正式部署、正式資料、正式付款或不可逆 migration |

## 結論與證據規則

`CORE_STAGING_READY` **尚未成立**。固定站完整核心瀏覽器旅程與新版 PayUni Sandbox 的成功付款、callback、持久化訂單及重複 callback 冪等性都需要新證據，才可將 Goal 標為完成。R2 的 PASS 不涵蓋 Stream。下一步見 [NEXT-CYCLE.md](NEXT-CYCLE.md)；較舊部署、migration 與付款收據保留在 [Goal 執行紀錄](goal-progress-20260924.md) 與 Git 歷史，不作目前版本的 PASS。
