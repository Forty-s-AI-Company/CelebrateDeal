# 不退款的 Sandbox 買家訂單驗證

這個 runner 對應 CORE_STAGING_READY 的新訂單付款→callback→持久化訂單→重複 callback 冪等性驗收。既有 reconciliation runner 仍包含退款驗證，不能用於本輪不退款範圍。

## 執行前提

- 先合入受保護 master 並通過 CI；只能以 `Secure staging validation` 的 `wp4-payuni-sandbox-payment-only` task 執行。
- 使用精確的非 Production Preview SHA／host，通過既有 GitHub lineage 與 health gate。平台既有 CI Environment 注入 Sandbox 測試綁定，不能讀 `.env*` 或要求重新貼 Token。
- 新版固定站先取得核心瀏覽器收據，並核對 callback 的固定 staging 來源。
- 原 source `00099f7e3b3c8a7e923047e1ab72a827fcb78e4c` 不得重送。新版 API 唯讀 run 36406195116 已回覆查無該訂單；原本地訂單仍 pending，不自行改成 failed／paid 或退款。
- 新執行使用獨立來源的合成訂單。仍受伺服器持久化的單次 payment-attempt reservation 約束；不重跑已保留但結果未明的來源。

## 成功證據

獨立 schema `celebratedeal-mvp-payuni-payment-only/v1` 必須同時證明：本次單次 browser submission、精確 signed Return callback capture、paid PaymentTransaction 與 paid Order 的資料庫證明、一次相同簽章的 Notify replay，以及 replay 前後完全相同的單筆訂單／事件／庫存證明。

`refundPosts`、`refunds`、`reconcilePosts` 必須全部為 0，`refundCompleted`／`reconciled` 為 false；即使付款成功也不呼叫退款或退款對帳。這個 PASS 不能冒充原本包含退款的 reconciliation PASS。

收據固定為 `wp4-payuni-sandbox-payment-only-receipt.json`；禁止額外原始欄位，簽章 callback body 只在記憶體中用於一次 replay，不寫入收據。

## 失敗處理

付款頁若出現「確定」視窗，不會再次點擊提交。只將可辨識的欄位驗證訊息降為固定 CARD／EXPIRY／CVV／EMAIL／FIELD 分類；未知內容保持 PAYMENT_CONFIRMATION_AMBIGUOUS。不保存視窗原文、卡片或交易識別資料。

收到失敗收據先診斷該分類、查核交易狀態，不盲目重跑。未知付款結果不能推斷為失敗，也不能藉更換來源繞過舊訂單的單次保護。本文件與本機契約測試不是外部 Sandbox PASS；實際 run 收據另行記入 CURRENT。

## 程式驗證與交接

2026-09-28：本機 65 個 runner 測試、16 個 protected workflow 契約測試及 targeted lint 通過。獨立 Critical review 未發現問題；canonical assess_acceptance 對同一四檔 snapshot 回報 READY，僅代表程式工作包，尚未執行外部付款。

Requested／effective team 為 ai-team-pro；實作路由建議 Sol high，由主代理整合實作。Critical review 在既有 AGY Opus INVALID_REVIEW 未改善下，走 canonical Astra high fallback，由既有 astra_plan 唯讀審查。Observed model／effort 均 unknown。單一 writer、單一唯讀 reviewer，未新增子代理或遞迴 dispatch。下一步為 protected PR 全綠合入，再完成固定 staging 新來源核心瀏覽器驗證後，執行一次新來源的 payment-only workflow；Production 維持未授權。
