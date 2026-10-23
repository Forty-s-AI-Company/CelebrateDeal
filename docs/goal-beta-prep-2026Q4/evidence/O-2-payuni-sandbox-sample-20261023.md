# O-2 PayUni Sandbox 付款樣本（2026-10-23）

- 環境：staging（`celebrate-deal-staging.carry-digital-nomad.in.net`，部署 `dpl_FPzL7VRC…`，commit a8c07b01）＋ PayUni Sandbox。合成商品 `WP4 Synthetic Sandbox Product`（NT$1），owner 以買家身分手動付款，Email 使用保留網域 `example.com`，未使用任何真實客戶或卡片資料。
- 結果頁：顯示「付款完成」，訂單金額 NT$1、退款金額 NT$0。

## 資料庫核對（唯讀）

| 項目 | 結果 |
|---|---|
| CommerceOrder 狀態 | `paid`；total／paid 皆 100（cents），refunded 0 |
| PaymentTransaction | `paid`；provider `payuni`；mode `platform`；gross 100、gateway fee 0、platform fee 0、net 100 |
| paidAt／occurredAt | 2026-10-23 13:00:16.941（UTC），兩者一致 |
| WebhookEvent | 1 筆 `paid`，`processed`，retryCount 0，建立 13:00:16.84、處理完 13:00:17.25 |

## 去識別化的 PayUni 回呼樣本（F-037 對照）

- 外層 `Status`：`SUCCESS`
- 內層 `TradeStatus`：`1`（已付款）
- `PaymentType`：`1`（信用卡）
- 其餘欄位：`MerID`、`MerTradeNo`、`TradeAmt`、`TradeNo`（皆已遮罩或僅存雜湊，不保存加密內容；`EncryptInfo`／`HashInfo` 在診斷中為 `[redacted]`）
- 結論：實際回呼的 `Status=SUCCESS`＋`TradeStatus=1` 與 F-037 程式的判斷一致，訂單與交易都正確轉為 paid，且事件只處理一次。

## 尚未驗證

- `TradeStatus` 4／9（失敗或取消）、`Credit=1` 欄位、Apple Pay／Google Pay 的 `PaymentType`、重複通知、部分與重複退款：留給 10-30 的 O-12 完整演練。
- 手續費在 NT$1 時為 0，需用較大金額（例如 NT$100 以上的合成商品）確認依合約費率計算（F-040）。
- LINE 內建瀏覽器開啟付款頁尚未測。
