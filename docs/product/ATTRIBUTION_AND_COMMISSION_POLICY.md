# Attribution and Commission Policy

## MVP Attribution

- 規則：30 天 last-touch。
- URL `ref` 只提出候選，不是權威歸因。
- `/api/affiliate-clicks` 驗證 vendor、live 與 active affiliate 後，建立 click 並簽發 HttpOnly cookie。
- Cookie 綁定 vendor、click、affiliate、issuedAt、expiresAt，HMAC 竄改或跨 vendor replay 直接失效。
- Checkout 與 lead conversion 只讀 server-verified attribution，不採信 client `referralCode`。
- 停權 affiliate、過期 click、無 cookie、不同 browser/device 都不自動歸因。

## Payment and Commission

- Checkout 先建立 pending `PaymentTransaction`，signed provider webhook 只能更新既有 provider/order。
- 金額、currency、vendor 不符合 pending order 時拒絕。
- Commission rate 只讀 Affiliate DB，不採信 webhook 或 client rate。
- Payment、refund、commission adjustment 都有資料庫 unique key。
- Partial refund 以 provider event 建立 append-only negative adjustment；duplicate 不重複。
- Full refund 對未鎖 commission 標 void；locked/paid correction 以後續 adjustment 處理。
- External storefront click 永遠不是 purchase，沒有可信訂單 evidence 時不得產生 commission。

## Known Limitations

- 跨裝置需要登入 identity、CRM identity 或可信外部訂單資料，MVP 不以 fingerprint 追蹤。
- First-touch／vendor selectable policy 尚未實作。
- 外部商城個人商品 URL 與人工成交 review workflow 尚未實作。
