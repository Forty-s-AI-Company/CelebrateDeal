# CelebrateDeal 固定 staging 現況

更新：2026-09-28（Asia/Taipei）。本頁只把對應部署來源的受保護收據標為 PASS；歷史收據不能替新版驗收。指定站點：[celebrate-deal-staging.carry-digital-nomad.in.net](https://celebrate-deal-staging.carry-digital-nomad.in.net)。

## 來源與驗收

本次核對的 live master 為 `ec7b9aad745126182112267c78bf45124cf1bda4`。PR #338（Funnel 報表獨立載入）、#339（文件）、#340（Dashboard 明細獨立載入）、#341（有限診斷）皆已通過受保護檢查並 squash merge。固定站跟隨 `codex/staging-release-20260926` Preview 分支，目前來源為 `29ba9f6a6f389227df85e3fd46b693e6fe523331`，Ready immutable host 為 `celebrate-deal-staging-3cen4xz0d-a25814740s-projects.vercel.app`；GitHub Deployment `6701426702` 與下列受保護收據核對一致。

2026-09-28 已確認固定 staging Supabase 資料庫位於 Tokyo（ap-northeast-1），但原 Vercel Functions 位於 iad1。僅將 celebrate-deal-staging 專案的 Functions 設定調整為 Tokyo hnd1，重新部署後 `vercel inspect` 確認 hnd1，固定 alias 指向新版。原 f0c82857 的 [診斷 run 36370972008](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36370972008) 為 desktop 明細 GET 已發出但未回應、mobile 已完成；Tokyo 新版完整核心瀏覽器 PASS。這支持跨區延遲是重要因素，但不代表所有路徑效能均已驗證。本輪未部署 Production。

| 範圍 | 狀態 | 最新可用證據與界線 |
| --- | --- | --- |
| master、部署來源與固定 alias | **PASS：來源綁定** | GitHub Deployment 6701426702 與 browser／Funnel／R2 收據均核對到 `29ba9f6a`；不代表所有功能全過 |
| Dashboard 導頁與關鍵 JS／CSS | **PASS：目前來源** | [run 36371696707](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371696707) 對 `29ba9f6a` 完成 desktop/mobile 各五頁及兩組導覽／hydration 互動。兩種 viewport 的 KPI（6 讀取）與明細（13 讀取）可見，明細 GET 均 2xx 且完成；0 頁面錯誤、同站 5xx、關鍵資源失敗、不安全請求，session 均撤銷。framework alert 是 Next.js route announcer，非應用錯誤 |
| Funnel 建立→模板→儲存→發布→匿名公開頁 | **BLOCKED：匿名公開頁** | [run 36371699449](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371699449) 對 `29ba9f6a` 建立、模板、EDITOR_READY、儲存草稿與發布皆成功；PUBLIC_DESKTOP_FAILED，mobile 未執行。0 頁面錯誤、付款、退款、寄信，session 撤銷。程式要求所屬 SalesProject 已發布，runner 尚未執行專案發布；合成專案即時狀態仍待唯讀核對，不能先當成已證實根因 |
| R2 staging 圖片上傳與公開讀取 | **PASS：目前來源** | [run 36371701629](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371701629) 對 `29ba9f6a` 完成合成圖片預簽、PUT、完成回報及公開 GET 各一次；staging bucket 與 r2.dev 均 VERIFIED，0 瀏覽器錯誤／不安全請求，session 撤銷。公開 bucket 只供 staging 合成資料 |
| Stream 非正式資源範圍 | **未驗證** | [唯讀 provider run 36218278700](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36218278700) 只證明連線可用，回報 `nonProductionScope=unverified`；無法在不讀 Secret 的條件下證明 Vercel 綁定 token 只可存取非正式資源 |
| PayUni 新版 Sandbox 訂單閉環 | **BLOCKED** | [run 36217020374](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36217020374) 一次 Sandbox 表單提交後結果不明。[唯讀 run 36260940732](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36260940732) 顯示本地 `PENDING`、provider `UNKNOWN`、callback `NOT_OBSERVED`、`PROVIDER_MISSING`，無查單參考值，`queryAttempts=0`。2026-09-28 Chrome 官方 Sandbox 後台仍在登入畫面，未能唯讀對帳；不得重送未明交易或退款。舊版 [run 36142862467](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36142862467) 的成功閉環不等於新版 PASS |
| PR #210／#211 獨有功能 | **尚未整合** | 兩支舊 PR 仍有衝突及失敗檢查；學員入口、LINE 圖文選單、聯盟入口與商品差異須按功能盤點，見[整合清單](integration-inventory-20260924.md) |
| Production | **未評定** | 本輪未授權正式部署、正式資料、正式付款或不可逆 migration |

## 結論與證據規則

`CORE_STAGING_READY` **尚未成立**。固定站完整核心瀏覽器旅程與新版 PayUni Sandbox 的成功付款、callback、持久化訂單及重複 callback 冪等性都需要新證據，才可將 Goal 標為完成。R2 的 PASS 不涵蓋 Stream。下一步見 [NEXT-CYCLE.md](NEXT-CYCLE.md)；較舊部署、migration 與付款收據保留在 [Goal 執行紀錄](goal-progress-20260924.md) 與 Git 歷史，不作目前版本的 PASS。
