# Sandbox 舊訂單唯讀查詢收據

2026-09-28：PR #345 已經兩組完整 CI（36402951306／36402985790）全綠後 squash 合入 master `5d5b814681525427ae8f787a75b7ef27fa64ed29`。

同來源 Preview `celebrate-deal-staging-g1b7eu9um-a25814740s-projects.vercel.app` 已 READY，部署 `dpl_HkdbLiibYXna3ewGGhGyPBbxYeCb`／GitHub Deployment `6707080026`，非 Production。固定 alias 仍指原健康部署，尚未切換。

受保護 [run 36406195116](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36406195116) 執行 `wp4-payuni-buyer-payment-check`。收據只含固定分類，沒有商店訂單號、金流交易號或憑證：

| 欄位 | 結果 |
| --- | --- |
| result / status | BLOCKED / UNREFERENCED_NOT_FOUND |
| localStatus / providerStatus | PENDING / UNKNOWN |
| referenceState / callbackStatus | PROVIDER_MISSING / NOT_OBSERVED |
| checkPosts / queryAttempts | 1 / 1 |
| paymentSubmissions / refundSubmissions | 0 / 0 |
| transactionSourceSha | 00099f7e3b3c8a7e923047e1ab72a827fcb78e4c |

`UNREFERENCED_NOT_FOUND` 只會在 Sandbox query 回應經 hash 驗證及解密、payload Status 為 `QUERY03001` 時產生。它與同日官方後台精確訂單查詢的「尚無資料」一致。Workflow 的 failure 是最後「必須為已確認付款成功」驗收未達成，並非查詢未執行。

原訂單仍待定，不能重送或退款，也不能把查無資料解讀為成功付款。後續付款驗證必須使用獨立合成訂單；既有完整 reconciliation runner 成功後會自動退款，不能直接用於本輪不退款的授權範圍。先補不退款的付款→callback→持久化訂單→duplicate callback 驗證路徑，並針對付款確認視窗補固定錯誤分類，避免重複產生相同不明結果。

Preview 切換前另需相同核心瀏覽器旅程證據。固定站與 Preview 收據必須分開，Preview PASS 不得覆蓋 CURRENT 的固定 alias 驗收狀態。
