# CelebrateDeal 固定 staging 現況

更新：2026-09-27（Asia/Taipei）。本頁只把對應部署來源的受保護收據標為 PASS；歷史收據不能替新版驗收。指定站點：[celebrate-deal-staging.carry-digital-nomad.in.net](https://celebrate-deal-staging.carry-digital-nomad.in.net)。

## 來源與驗收

live master 為 `2702f4aa0cdba2309934ffd070f77ef1efc3cfeb`。固定站跟隨 `codex/staging-release-20260926` Preview 分支。最新已核對來源為 `1909c71a9c73d399ec1d8dd690ed7848947581c7`，Ready immutable host 為 `celebrate-deal-staging-7rwlta1x5-a25814740s-projects.vercel.app`。此來源包含已合入 master 的 [PR #337](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/337)。[Funnel run 36267066749](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36267066749) 已核對精確來源與固定 alias。[PR #338](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/338) 正將慢報表移出管理頁首次渲染，本機相關測試、ESLint、TypeScript 已過；`Vercel – celebrate-deal` Preview 已成功，但 `Vercel – celebrate-deal-staging` 回報「Deployment rate limited — retry in 24 hours」，故 PR 未合入、固定站尚未更新，下表結論不變。

| 範圍 | 狀態 | 最新可用證據與界線 |
| --- | --- | --- |
| master、部署來源與固定 alias | **PASS：來源綁定** | GitHub Deployment 與受保護 run 36267066749 核對到 `1909c71a`；不代表功能全過 |
| Dashboard 導頁與關鍵 JS／CSS | **前一來源 PASS；目前來源未驗證** | [run 36264888394](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36264888394) 對 `80c3e72c` 的 desktop/mobile 各五頁、KPI 6／明細 13、導覽與互動通過，0 關鍵資源失敗、頁面錯誤、同站 5xx 或不安全寫入；兩個合成 session 撤銷。先前 [run 36261193770](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36261193770) 曾有一次手機商品預覽腳本失敗，[run 36263018406](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36263018406) 曾在 Dashboard KPI 逾時；偶發問題仍需以新版收據觀察 |
| Funnel 建立→模板→儲存→發布→匿名公開頁 | **BLOCKED** | [run 36267066749](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36267066749) 建立成功並導向管理頁，兩次管理頁 GET 回 200，但 20 秒內皆未完成，模板控制項未出現，分類 `OPERATIONS_NOT_READY`；尚無後續步驟 PASS。0 付款、退款、寄信；合成 session 撤銷 |
| R2 staging 圖片上傳與公開讀取 | **前一來源 PASS；目前來源未驗證** | [run 36265531030](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36265531030) 對 `80c3e72c` 完成一筆合成圖片的預簽、PUT、完成回報、公開 r2.dev GET 與 bytes 比對；0 頁面錯誤或不安全寫入，唯一外部讀取被攔截，session 撤銷。`celebrate-deal-staging` bucket 的公開網址僅供合成資料，憑證限此 bucket，CORS 限固定 staging origin 的 PUT |
| Stream 非正式資源範圍 | **未驗證** | [唯讀 provider run 36218278700](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36218278700) 只證明連線可用，回報 `nonProductionScope=unverified`；無法在不讀 Secret 的條件下證明 Vercel 綁定 token 只可存取非正式資源 |
| PayUni 新版 Sandbox 訂單閉環 | **BLOCKED** | [run 36217020374](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36217020374) 一次 Sandbox 表單提交後結果不明。[唯讀 run 36260940732](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36260940732) 顯示本地 `PENDING`、provider `UNKNOWN`、callback `NOT_OBSERVED`、`PROVIDER_MISSING`，無查單參考值，`queryAttempts=0`。官方 Sandbox 後台目前在登入畫面，未能唯讀對帳；不得重送未明交易或退款。舊版 [run 36142862467](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36142862467) 的成功閉環不等於新版 PASS |
| PR #210／#211 獨有功能 | **尚未整合** | 兩支舊 PR 仍有衝突及失敗檢查；學員入口、LINE 圖文選單、聯盟入口與商品差異須按功能盤點，見[整合清單](integration-inventory-20260924.md) |
| Production | **未評定** | 本輪未授權正式部署、正式資料、正式付款或不可逆 migration |

## 結論與證據規則

`CORE_STAGING_READY` **尚未成立**。固定站完整核心瀏覽器旅程與新版 PayUni Sandbox 的成功付款、callback、持久化訂單及重複 callback 冪等性都需要新證據，才可將 Goal 標為完成。R2 的 PASS 不涵蓋 Stream。下一步見 [NEXT-CYCLE.md](NEXT-CYCLE.md)；較舊部署、migration 與付款收據保留在 [Goal 執行紀錄](goal-progress-20260924.md) 與 Git 歷史，不作目前版本的 PASS。
