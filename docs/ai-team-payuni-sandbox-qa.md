# AI Team PayUni Sandbox QA

AI Team 的 `delivery-qa` 外部驗收現在會在變更成功合併到 staging source revision 後執行一次。測試使用 headless Playwright 操作 staging 直播頁，並驗證：

1. PayUni Sandbox 結帳與付款回呼
2. PayUni 查詢結果與 CelebrateDeal 訂單對帳
3. Sandbox 退款及退款狀態回查

設定位置是 `.ai-team/project.yaml` 的 `external_qa`。實際命令固定為 `npm run qa:payuni:sandbox`，只允許 `PAYUNI_ENV=sandbox`、核准的 staging HTTPS host，以及明確的 QA/退款開關；正式交易不會由 AI Team 自動執行。

首次啟用前，在不提交 Git 的 `.env.local` 補上：

```dotenv
PAYUNI_SANDBOX_QA_ENABLED=true
PAYUNI_SANDBOX_REFUND_ENABLED=true
PAYUNI_TEST_APP_URL=https://staging.example.test
PAYUNI_STAGING_ALLOWED_HOST=staging.example.test
PAYUNI_PRODUCTION_APP_HOST=celebratedeal.carry-digital-nomad.in.net
PAYUNI_TEST_LIVE_PATH=/live/summer-glow-live
PAYUNI_TEST_CARD_NUMBER=        # 可留白，使用 PAYUNI_SANDBOX_ONETIME_CARD_NO
PAYUNI_TEST_EXPIRY=MMYY
PAYUNI_TEST_CVV=123
```

執行前必須用 `vercel inspect https://staging.example.test` 確認 target 不是
Production。已知正式網域 `celebratedeal.carry-digital-nomad.in.net` 會被腳本直接
拒絕，即使誤把它填進 Staging 白名單也不會送出 Sandbox 結帳。

Staging callback host 必須可由未登入 Vercel 的外部服務直接連線。QA 會在輸入測試
卡前檢查 `GET /api/health`；若 host 仍受 Deployment Protection 保護，會直接停止。
不得在 `ReturnURL`、`NotifyURL`、PayUni Dashboard 或任何使用者可見網址加入
`x-vercel-protection-bypass` 或 `VERCEL_AUTOMATION_BYPASS_SECRET`。PayUni 會保存
NotifyURL，且付款完成後會把 ReturnURL 顯示給付款者。

若 Preview 受 Vercel Authentication 保護，請建立獨立且公開的非 Production Staging
host，再將 `NEXT_PUBLIC_APP_URL`、`PAYUNI_TEST_APP_URL` 與
`PAYUNI_STAGING_ALLOWED_HOST` 一起改成該 host。不要以 Shareable Link 或 automation
bypass URL 取代公開 callback host。

若開關未設為 `true`，AI Team 會記錄 `not-configured` 並繼續開發，不會反覆建立交易。若已啟用但驗收失敗，該 revision 會停在 `external-qa-failed`，等待人工查看 receipt 後再由下一個修正 revision 重新驗收。

收據只保存 revision、通過的檢查摘要、錯誤分類與輸出雜湊，不保存卡號、HashKey、HashIV、Webhook Secret 或原始瀏覽器輸出。
