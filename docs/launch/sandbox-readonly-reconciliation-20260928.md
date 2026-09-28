# Sandbox 舊訂單與 Funnel 唯讀盤點

日期：2026-09-28（Asia/Taipei）。master 基準 `5f250e41d619c704514ef8939b0b0cac6a1c565a`；固定 staging 仍為 `29ba9f6a6f389227df85e3fd46b693e6fe523331`。以下為官方後台及 staging SQL 的瀏覽器觀察，不是新的 CI PASS 收據。

## 已取得的唯讀證據

- 使用者完成官方 PayUni Sandbox 登入。頁面顯示 Sandbox 環境。
- staging Supabase 專案為 `ocbugvgojrunvenozsbx`（CelebrateDeal Staging／Tokyo）；未操作另一個正式專案。
- 以固定 vendor、product、buyer_order、原提交 source `00099f7e3b3c8a7e923047e1ab72a827fcb78e4c`、submission reservation 條件查詢，僅有一筆合成交易：pending、金額 100 分、provider reference 不存在，建立時間為 2026-09-26 04:11:38.932 UTC。訂單識別只用於官方 Sandbox 精確查詢，不寫入此收據。
- 官方「交易動態明細」查詢 2026-09-26 全日、所有支付方式、無指定交易狀態，結果「尚無資料」。再以精確合成商店訂單編號查詢 2026-06-28 至 2026-09-28，結果亦為「尚無資料」。這是後台 absence observation，不能視為付款成功、終止或允許重送。
- 原 run `36217020374` 的 sanitized artifact 為 `PAYMENT_CONFIRMATION_AMBIGUOUS`：一次 browser submission、零 refund/reconcile、未證明 PayUni form accepted。程式目前只知道出現「確定」按鈕，未記錄其訊息類型；不能推定該 modal 是成功確認或某一特定欄位錯誤。
- staging 中具名 `Staging Synthetic Project` 僅一筆，狀態 draft、primaryFlow live。有效且有價格的已連結商品 0、active 表單 0、直播 0、active 諮詢 0、有效 vendor verified payment method 0。僅查詢 counts，沒有 DB 寫入。

## 程式修復範圍

原唯讀 checker 因缺少 provider reference 提前退出，實際 queryAttempts=0。官方 [PHP SDK 查單範例](https://github.com/payuni/PHP_SDK/blob/main/examples/trade/Trade.php) 使用 MerTradeNo；新增的查詢能力只允許 Preview／Sandbox／WP4 executor 開啟，且為 pending、缺少 provider reference 的交易。固定 checker 仍鎖定原合成訂單，不接受 caller 自選訂單。

查詢使用既有已簽章加密 transport。只有經驗證的 QUERY03001 可記 UNREFERENCED_NOT_FOUND；未知、未驗簽或不匹配結果失敗。找到交易也不更新本地 reference/status。新狀態仍為 BLOCKED，不能替代成功付款→callback→訂單→冪等性驗收，也不會觸發 checkout、退款或 callback replay。既有正式 queryPayment 驗證仍要求已知 provider reference。

## 驗證與交接

本機相關 unit／route 94 tests、runner 61 tests、targeted ESLint、TypeScript 通過。既有 Astra 代理完成指定 7 個程式／測試檔案及 route 呼叫鏈的唯讀 Critical review，無 findings；observed model／effort 為 unknown。protected PR 尚在進行；新查詢尚未部署／執行。之後須對精確部署來源執行一次 buyer-payment-check，原合成付款保持不重送、不退款。

requested/effective team 為 ai-team-pro；主代理為唯一 writer。Opus 經 AGY discovery 驗證可用，但本次回覆 INVALID_REVIEW（exit 0，不算 review PASS），router 回報 Astra high fallback。新 spawn 遇 thread limit，重用既有 Astra 代理做唯讀獨立 review；沒有可觀測 model/effort 證據時記 unknown。Funnel 需走正常流程補足前置條件；PayUni adapter 綁定能力缺口仍在，不可偽造 verified payment method。Stream 非正式範圍仍未驗證。
