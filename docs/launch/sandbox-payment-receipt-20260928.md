# 新版 Sandbox 買家付款閉環收據

2026-09-28：[受保護 run 36416149015](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36416149015) **PASS**。Runner 為 master `d04595136e4a718f676b2ca40ce82162ab3163ee`（PR #347），應用來源為固定 staging 的 `5d5b814681525427ae8f787a75b7ef27fa64ed29`。目標為 `celebrate-deal-staging-g1b7eu9um-a25814740s-projects.vercel.app`，與新版固定 alias 核心瀏覽器驗證來源相同。

本次只啟動一次 `wp4-payuni-sandbox-payment-only`。GitHub dispatch 回覆 HTTP 504，隨後以 run 清單確認任務已建立，因此未重送 dispatch。Run conclusion 為 success，CI receipt validator 與下載後的同版本 validator 均通過。

## 實際驗收

收據 schema：`celebratedeal-mvp-payuni-payment-only/v1`；environment `sandbox`；result `PASS`；failure `NONE`。

| 驗收 | 證據 |
| --- | --- |
| 合成 checkout 與單次付款 | fixtureReady、sameOriginAdmission、checkoutCreated、paymentAttemptReserved、payuniFormAccepted 均 true；browserPaymentSubmissions=1、transactionsCreated=1、payments=1 |
| 簽章 callback 與訂單持久化 | returnCallbackMapped=true、orderPersisted=true；runner 核對實際 signed Return callback、paid transaction 及 paid order |
| 重複 callback 冪等性 | duplicateCallbackVerified=true、callbackReplays=1、orderProofPosts=2；重播前後核對相同的持久化訂單／事件／庫存證明 |
| 無退款 | refundPosts=0、refunds=0、reconcilePosts=0；refundCompleted=false、reconciled=false |
| 資料安全 | sanitized=true；envFilesRead、envEnumerated、rawLogsPersisted、rawIdentifiersPersisted、rawUrlsPersisted、secretsPersisted、arbitraryInputAccepted、sideEffectBudgetExceeded 均 false |

Artifact：`secure-staging-wp4-payuni-sandbox-payment-only-5d5b814681525427ae8f787a75b7ef27fa64ed29`（ID `10968260795`），固定檔名 `wp4-payuni-sandbox-payment-only-receipt.json`。不保存簽章 body、卡片或交易識別資料。

## 界線

這是獨立的新合成訂單，沒有重送或退款原 source `00099f7e3b3c8a7e923047e1ab72a827fcb78e4c` 的未明交易。舊交易仍以既有唯讀收據記錄 PENDING／UNREFERENCED_NOT_FOUND，不由新訂單成功推論其結果。

此 PASS 不證明 PayUni 綁卡能力、不補足 Funnel 專案發布前置條件，也不涵蓋 Stream 非正式範圍或 Production。CORE_STAGING_READY 仍需完成 CURRENT 所列其餘驗收。
