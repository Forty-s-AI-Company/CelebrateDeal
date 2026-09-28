# CelebrateDeal 下一輪工作

更新：2026-09-28。部署來源與驗收證據以 [CURRENT.md](CURRENT.md) 為準；Goal 尚未完成。

登入阻擋已解除。[9 月 28 日唯讀盤點](sandbox-readonly-reconciliation-20260928.md)已用精確合成訂單查詢官方 Sandbox，結果「尚無資料」；資料庫仍 pending／無 provider reference。接續完成 Sandbox 缺 reference 查單修復的獨立 review、protected PR、部署及單次唯讀驗證。這不授權重送舊交易，也不代表新版訂單閉環完成。Funnel 前置條件的即時 counts 已全部確認為 0，需補正常流程。

1. **Funnel 專案發布前置條件**：#343 已全綠合入。唯讀 run 36377871155 已確認既有合成 Funnel 公開頁 NOT_FOUND，具名合成專案 DRAFT。先核對該專案的有效價格商品、active 表單、live／可預約諮詢與有效 verified PaymentMethodReference；補齊正常產品流程，再以正常 action 發布專案。不得直接修改 DB 狀態或偽造付款方式。PayUni adapter 缺完整綁定能力；須確認既有 reference 與官方 Sandbox 能力，不能將一般 checkout 成功視為綁卡完成。資料狀態改變前不要重跑相同公開頁診斷。
2. **PayUni 原交易先對帳**：唯讀 run 36260940732 沒有 provider 查單參考值，queryAttempts=0。官方 Sandbox 已登入，精確合成訂單後台查詢無資料；補足缺 reference 的 authenticated API 唯讀觀察，不需重新提供 Token。原交易釐清且確認安全後，才建立新合成付款驗證 callback、持久化訂單及重複 callback 冪等性。不得重送原交易或退款。
3. **Stream 隔離**：既有唯讀 probe 僅回報 reachable，非正式範圍仍未證實。需要可審查的非正式 Cloudflare account／資源及綁定權限證據，不能用 R2 bucket 隔離或連線成功代替。不要讀取 Secret Store／Token 值；未證實隔離前不建立 Stream 資源。
4. **固定站回歸**：目前 `29ba9f6a` 的核心 browser 36371696707、R2 36371701629 均 PASS。應用來源或相關資料設定變更後，對精確的新來源重新驗證。Funnel 唯讀診斷模式只能檢查既有合成公開頁，不能替完整建立→編輯→發布→匿名 desktop/mobile 旅程驗收。
5. **CI 不穩定測試**：舊候選 36372141599 的數位交付測試曾首次失敗、retry 通過；#342／#343 的兩組完整 CI 都已通過，但根因尚未證實。保留 fail-on-flaky；若復發，用固定分類／行號診斷，不盲目重跑或降低 assertion。
6. **尚未整合／非核心**：依[盤點](integration-inventory-20260924.md)拆分 #210／#211 的學員入口、LINE 圖文選單、聯盟入口與商品差異。表單提交、checkout 非付款階段、影片處理等仍缺固定站證據；Production 另行授權與驗收。

## 交接

本輪主代理單獨整合，未 dispatch 子代理；沒有宣稱實際觀測到模型／推理參數。既有授權涵蓋 codex/* push、全綠受保護 PR merge、非 Production staging 更新。原工作目錄未知變更保留；固定來源仍是 `29ba9f6a`，master 在 #343 為 `229084e4`。不因文件或 provider 連線可用而將 Goal 標完成。
