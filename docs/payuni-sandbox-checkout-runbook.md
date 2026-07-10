# PayUni Sandbox Checkout Manual Test Runbook

最後更新：2026-07-09

## 目的

本文件用來驗收 CelebrateDeal PayUni sandbox checkout、paid webhook、refunded webhook、duplicate webhook 與 reconciliation。此流程不提交任何真實 secret 到 repo；所有 HashKey / HashIV / merchant id 只放在 Vercel / 本機 `.env.local`。

## 前置條件

- [ ] PayUni sandbox merchant id 已取得。External required
- [ ] PayUni sandbox HashKey / HashIV 已取得。External required
- [ ] `PAYMENT_PROVIDER=payuni`
- [ ] `PAYUNI_ENV=sandbox`
- [ ] `PAYUNI_MERCHANT_ID` 已設定
- [ ] `PAYUNI_HASH_KEY` 已設定
- [ ] `PAYUNI_HASH_IV` 已設定
- [ ] `NEXT_PUBLIC_APP_URL` 指向 staging 或本機 tunnel URL

## Checkout Form Post 欄位

CelebrateDeal server-side checkout 只會信任後端 Product price，不接受 client amount。

PayUni `upp` form post 應包含：

- `MerID`
- `Version`
- `EncryptInfo`
- `HashInfo`

預期 endpoint：

- sandbox：`https://sandbox-api.payuni.com.tw/api/upp`
- production：`https://api.payuni.com.tw/api/upp`
- 若 PayUni 後台提供不同 sandbox URL，請以 `PAYUNI_API_BASE_URL` 覆蓋。External required

`EncryptInfo` 內應包含：

- `MerID`
- `MerTradeNo`
- `TradeAmt`
- `Timestamp`
- `ProdDesc`
- `ReturnURL`
- `NotifyURL`
- `VendorId`
- `ReferralCode`

`ReturnURL` / `NotifyURL`：

```txt
https://<app-domain>/api/webhooks/payments?provider=payuni&source=return
https://<app-domain>/api/webhooks/payments?provider=payuni&source=notify
```

## Manual Test Steps

1. 在後台建立一個 active product，價格設定為測試金額。
2. 開啟 `/live/:slug`。
3. 點擊商品 CTA 觸發 `/api/payments/checkout`。
4. 確認 response 內 `amountCents` 等於 Product price。
5. 確認前台以 `form_post` 送出 PayUni `upp` 欄位。
6. 在 PayUni sandbox 完成付款。External required
7. 檢查 `/admin/billing/webhooks` 是否收到 paid webhook。
8. 開啟 `/admin/billing/webhooks/:id`，確認 PayUni diagnostics：
   - `EncryptInfo` present
   - `HashInfo` present
   - `hashInfoVerification=pass`
   - reconciliation checks pass

## Sandbox Fixtures

Repo 已提供：

- `src/lib/payment-providers/payuni-fixtures.ts`
- `paid`
- `refunded`
- `duplicate_paid`

手動產生 fixture `curl`：

```bash
npm run payuni:fixture -- paid --print-curl --vendor-id <vendorId> --vendor-slug <vendorSlug>
npm run payuni:fixture -- refunded --print-curl --vendor-id <vendorId> --vendor-slug <vendorSlug>
npm run payuni:fixture -- duplicate_paid --print-curl --vendor-id <vendorId> --vendor-slug <vendorSlug>
```

直接打本機或 staging webhook：

```bash
npm run payuni:fixture -- paid --post --url http://localhost:31023 --vendor-id <vendorId> --vendor-slug <vendorSlug>
npm run payuni:fixture -- refunded --post --url http://localhost:31023 --vendor-id <vendorId> --vendor-slug <vendorSlug>
```

本機測試：

```bash
npm run test -- src/lib/payment-providers/payuni.test.ts
```

## Refund / Duplicate 驗收

- paid webhook 建立或更新 `PaymentTransaction`。
- duplicate paid webhook 不重複建立交易。
- refunded webhook 建立 `RefundRecord`。
- refunded webhook 更新 `PaymentTransaction.refundedAmountCents`。
- 帶 `ReferralCode` 的 paid webhook 建立 `AffiliateCommission`。
- refunded webhook 會 void 或建立負向 commission adjustment。

## 錯誤診斷

若 `/admin/billing/webhooks/:id` 顯示 `hashInfoVerification=fail`：

- 檢查 PayUni sandbox HashKey / HashIV 是否和 env 一致。
- 檢查 `PAYUNI_ENV` 與 PayUni dashboard endpoint 是否一致。
- 檢查 webhook URL 是否帶 `?provider=payuni`。
- 檢查 dashboard 是否使用正確 merchant id。

敏感資料規則：

- `HashKey` / `HashIV` 不可出現在 repo、log、audit log、admin raw payload。
- `EncryptInfo` / `HashInfo` 在 admin UI 只顯示長度與驗簽結果。
- production webhook body 若需要排錯，只能在受控環境短期擷取並立即刪除。

## External Required

- PayUni sandbox dashboard credentials。
- PayUni sandbox checkout 實際付款。
- PayUni sandbox refund 操作。
- PayUni production merchant 審核與正式 webhook URL 設定。
