# CelebrateDeal 下一輪工作

更新：2026-09-28。部署來源與驗收證據以 [CURRENT.md](CURRENT.md) 為準；Goal 尚未完成。

登入阻擋已解除。[9 月 28 日唯讀盤點](sandbox-readonly-reconciliation-20260928.md)已用精確合成訂單查詢官方 Sandbox，結果「尚無資料」；資料庫仍 pending／無 provider reference。查單修復 #345 已全綠合入並部署 Preview；受保護 run 36406195116 已取得 UNREFERENCED_NOT_FOUND，queryAttempts=1，付款與退款皆 0。這不授權重送舊交易，也不代表新版訂單閉環完成。Funnel 前置條件的即時 counts 已全部確認為 0，需補正常流程。

1. **Funnel 專案發布前置條件**：#343 已全綠合入。唯讀 run 36377871155 已確認既有合成 Funnel 公開頁 NOT_FOUND，具名合成專案 DRAFT。先核對該專案的有效價格商品、active 表單、live／可預約諮詢與有效 verified PaymentMethodReference；補齊正常產品流程，再以正常 action 發布專案。不得直接修改 DB 狀態或偽造付款方式。PayUni adapter 缺完整綁定能力；須確認既有 reference 與官方 Sandbox 能力，不能將一般 checkout 成功視為綁卡完成。資料狀態改變前不要重跑相同公開頁診斷。
2. **PayUni 原交易先對帳**：唯讀 run 36260940732 沒有 provider 查單參考值，queryAttempts=0。官方 Sandbox 精確合成訂單後台查詢無資料，新版 authenticated API 亦查無結果（36406195116）；不再重跑相同唯讀診斷。原訂單保留 pending、禁止重送及退款。新的獨立合成訂單測試前，先補不退款的 payment-only runner；現有 reconciliation runner 成功後會自動退款，不符合本輪範圍。付款確認視窗也需固定診斷分類，避免新訂單再留下相同不明結果。
3. **Stream 隔離**：既有唯讀 probe 僅回報 reachable。Cloudflare UI 已見 Ready 合成影片，但同一 library 也有 Production 命名資源，故非正式範圍仍未證實。需要可審查的非正式 Cloudflare account／資源及綁定權限證據，不能用 R2 bucket 隔離或連線成功代替。不要讀取 Secret Store／Token 值；未證實隔離前不建立 Stream 資源。
4. **固定站回歸**：目前 `29ba9f6a` 的核心 browser 36371696707、R2 36371701629 均 PASS。新版 Preview 5d5b8146 已 READY；先以新增 immutable_preview 模式完成切換前的核心旅程，再更新指定 alias 並重驗 fixed_alias 與 R2。應用來源或相關資料設定變更後，對精確的新來源重新驗證。Funnel 唯讀診斷模式只能檢查既有合成公開頁，不能替完整建立→編輯→發布→匿名 desktop/mobile 旅程驗收。
5. **CI 不穩定測試**：舊候選 36372141599 的數位交付測試曾首次失敗、retry 通過；#342／#343 的兩組完整 CI 都已通過，但根因尚未證實。保留 fail-on-flaky；若復發，用固定分類／行號診斷，不盲目重跑或降低 assertion。
6. **尚未整合／非核心**：依[盤點](integration-inventory-20260924.md)拆分 #210／#211 的學員入口、LINE 圖文選單、聯盟入口與商品差異。表單提交、checkout 非付款階段、影片處理等仍缺固定站證據；Production 另行授權與驗收。

## 交接

本輪主代理整合與實作；core_browser_path 僅唯讀分析，astra_plan 完成新增 Preview 驗證模式的獨立 Critical review（No findings）。AI Team Pro 路由實作 Luna high、Critical review 在既有 AGY Opus INVALID_REVIEW 後用 canonical Astra high fallback；實際模型／推理參數均未觀測，不冒稱已切換主模型。程式本機驗證與遠端驗收分開。既有授權涵蓋 codex/* push、全綠受保護 PR merge、非 Production staging 更新。原工作目錄未知變更保留；固定來源仍 29ba9f6a，已部署但未切 alias 的新版為 master 5d5b8146。Goal 尚未完成。
