# PayUni 付款回呼（UPP 2.0）營運手冊

適用：`/api/webhooks/payments?provider=payuni`（Notify 與 Return）、`/api/jobs/webhook-retry`、財務後台 Webhook 對帳中心。
依據：F-037（B03-01）、R448-01～R448-07（`docs/review-2026Q4/31-pr448-lineA-review.md`）。

## 1. 判斷規則（程式：`src/lib/payment-providers/payuni.ts` 的 `payUniUppEventType`）

| 回呼內容（已驗簽） | 系統處理 | HTTP |
|---|---|---|
| 內外層 `Status=SUCCESS`、`TradeStatus=1`、`PaymentType=1`（信用卡） | paid，eventId `TradeNo:1` | 200 |
| `TradeStatus` 2／3／4／9 | failed，eventId `TradeNo:<狀態>` | 200 |
| `TradeStatus` 0／8（取號、待確認） | 不改任何狀態；audit `payment_webhook_not_actionable`（reason `trade_pending`） | Notify 200；Return 導向 `payment=pending` |
| `TradeStatus=1` 但 `PaymentType≠1`，或內／外層 Status 不是 SUCCESS（含外層缺漏） | **人工對帳**：建立 `WebhookEvent`（status `needs_manual_reconciliation`、eventType `manual_reconciliation`）、該筆 pending 交易加上 `metadata.paymentManualReconciliation` 不會被庫存逾期釋放、Sentry error 告警、audit 記 MerTradeNo／TradeNo／TradeStatus／PaymentType | Notify 200；Return 導向 `payment=review`（平台方案付款導回 `/billing/plans`） |
| 其他 TradeStatus、帶 `EventType` 的 UPP payload | fail closed（400 invalid_payload） | 400 |

人工對帳紀錄寫入失敗時回 500，讓 PayUni 重送，不會無聲丟掉。

## 2. 人工對帳（needs_manual_reconciliation）

1. 財務後台「Webhook 對帳中心」的「待人工對帳」卡片列出筆數；事件 payload 的 `reconciliation` 有 reason、MerTradeNo、TradeNo、TradeStatus、PaymentType 與比對到的交易 ID。
2. 以 PayUni 後台或交易查詢確認是否真的收款、付款方式與金額。`queryPayment` 對非信用卡的已收款交易回 `manual_reconciliation` 類別。
3. 處置二選一並寫 audit：在 PayUni 退款給買家（非信用卡依 PayUni 規則）；或經 owner 同意後人工補單。這兩種處置目前都沒有自動流程。
4. 處置完成後再移除交易的 `paymentManualReconciliation` 標記。標記還在時，庫存逾期 job 會回報 `held`，不會釋放。

## 3. 部署前檢查：舊格式 PayUni paid 事件（R448-02）

F-037 之前的程式把任何 `Status=SUCCESS` 都判為 paid，eventId 為 `TradeNo`（不含 `:`），舊 snapshot 也沒有保存 TradeStatus／PaymentType。新程式的 retry 會把這類事件改成 `needs_manual_reconciliation`，不會重送；但部署前仍須在 staging 與 production 各跑一次以下**唯讀**查詢，結果應為 0 列：

```sql
SELECT status, count(*) AS events
FROM "WebhookEvent"
WHERE provider = 'payuni'
  AND "eventId" !~ '^.+:[0-9]{1,2}$'
  AND status IN ('received', 'failed', 'retrying')
  AND ("eventType" = 'paid' OR payload #>> '{normalized,eventType}' = 'paid')
GROUP BY status;
```

不為 0 時：逐筆以 PayUni 交易查詢確認後人工處置，在 PR／STATE 記錄筆數與處置結果（只記事件 ID 與結論，不記 payload）。

部署後追蹤待人工對帳的筆數：

```sql
SELECT count(*) FROM "WebhookEvent" WHERE status = 'needs_manual_reconciliation';
```

## 4. 正式收款前必修

- **R448-03（B03-13）**：UPP paid 路徑仍從已簽章的 payload 讀 `VendorId`／`VendorSlug`／`ReferralCode`。未知訂單仍可能憑 payload 指定 vendor 或 referral，建立權威付款與佣金。封測（Sandbox）時風險低，可以接受；**正式收款前必修**：UPP 回呼不讀這三個欄位，`payment-webhooks.ts` 對正式 provider 只接受既有 checkout 交易。
- **R448-07（B03-04）**：只修了一半。NetAmount 缺漏時改回 undefined，已不會寫成 0；但 `gatewayFeeCents` 仍是 0，月結不扣金流手續費。手續費費率與負擔方仍是 owner 決策。

## 5. 待 Sandbox 樣本驗證

1. Notify 與 Return 是否都帶外層 `Status`（R448-05）。若 Notify 沒帶，所有付款都會進人工對帳，必須在第一筆 Sandbox 付款時確認。
2. TradeStatus 4／9 是否會出現在 UPP 回呼（R448-04）。卡片失敗（2）之後，能不能用同一個 MerTradeNo 在 UPP 頁重試成 1。如果能，failed 會先釋放升級折抵，必須先調整這條路徑。
3. TradeStatus 8 之後，PayUni 會不會再送一次最終 Notify。
4. `Credit=1` 是否真的只顯示信用卡；Apple／Google／Samsung Pay 回報的 PaymentType 是什麼。
5. NotifyURL 回非 2xx 時，PayUni 的重送次數與間隔。
6. 真實回呼有沒有 `NetAmount`／`GatewayFee`／`VendorId`／`ReferralCode`。
7. GitHub environment 與 Vercel staging 的 `CSRF_SECRET` 是否一致（R448-06，QA 財務帳號的 TOTP factor 用它加密）。
