# PAYUNi 正式商店兩筆 1 元驗證

## 範圍

僅限 CelebrateDeal 指定商店、隔離的 Preview 站與測試帳號。首次綁卡交易為 1 元；收到 PAYUNi 簽章成功通知後約 10 分鐘，以該次取得的 CreditHash 發起第二筆 1 元扣款。正式站原價與正式資料庫不參與此測試。所有一般商品、方案與發票結帳在此 Preview + 正式 PAYUNi 組合下被封鎖。

使用者需分別勾選綁卡同意，以及寫明第二筆金額和時機的一次性同意。`PayUniLiveProbe` 保存同意人、版本、原文、時間及兩筆金額。每個 vendor 只允許建立一筆測試紀錄。

## 開始前

1. 在 **CelebrateDeal 商店**的 PAYUNi 正式後台核對信用卡 Token API 與信用卡幕後授權 API 權限，以及來源 IP 綁定。PureFit 商店畫面不能作為 CelebrateDeal 商店已開通的證據。金鑰及卡片資訊只存於核准的部署 Secret 管理，不貼入文件或對話。
2. 使用獨立 Preview 資料庫與指定 vendor。先執行本次 Prisma migration，再以 Preview 專屬 Secret 設定 `PAYMENT_PROVIDER=payuni`、`PAYUNI_ENV=production`、CelebrateDeal 正式商店的 `PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV`、`PAYUNI_LIVE_PROBE_ENABLED=true`、`PAYUNI_LIVE_PROBE_VENDOR_ID`、`PAYUNI_LIVE_PROBE_MERCHANT_ID` 與 `PAYUNI_LIVE_PROBE_JOB_SECRET`。兩個商店 ID 必須與實際 CelebrateDeal 商店 ID 相同。只改 `PAYUNI_ENV` 而未提供正式三件組會拒絕交易。
3. 確保 PAYUNi 能公開回呼該 Preview 站的 `/api/webhooks/payment-methods` 與 `/api/webhooks/payuni-live-probe`；不可把 Vercel bypass Secret 放在回呼 URL。
4. GitHub repository variable `PAYUNI_LIVE_PROBE_SCHEDULER_ENABLED=true` 才會啟用每 5 分鐘的排程；Preview 環境設定 `PAYUNI_LIVE_PROBE_URL`、`PAYUNI_LIVE_PROBE_HOST`、`PAYUNI_LIVE_PROBE_JOB_SECRET`。URL 必須是該 Preview 站的 `https://<host>/api/jobs/payuni-live-probe`，host 必須完全一致。排程的檢查時間與實際送款時間可能相差數分鐘。

## 驗收與停止

確認首次 PAYUNi 交易實際成功、系統已保存 verified reference 及 scheduled probe，再確認第二筆狀態為 confirmed，並在 PAYUNi 正式交易紀錄核對兩筆各 1 元與不同交易編號。僅有購買紀錄或已建立測試列，不代表第二筆扣款成功。不要在不明結果時重新送出同一筆；`ambiguous`、`missed` 須人工對帳。

完成後關閉 `PAYUNI_LIVE_PROBE_SCHEDULER_ENABLED` 和 `PAYUNI_LIVE_PROBE_ENABLED`，並移除 Preview 的正式商店金鑰。未做真實交易前，不能把此驗證標成通過。
